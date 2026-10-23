/* Common duty changes invalidate the target guard's existing sessions exactly once. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54500,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='074') THROW 54500,'Migration 074 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='075') THROW 54500,'Migration 075 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
ALTER PROCEDURE gp.ManageCommonDuty @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ClientKey uniqueidentifier,@LocationId int,@Action varchar(8000),
 @AreaId bigint=NULL,@GuardUserId uniqueidentifier=NULL,@AreaName nvarchar(max)=NULL,@AssignmentId bigint=NULL,@Reason nvarchar(max)=NULL AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF @LocationId IS NULL OR @LocationId<=0 OR @ClientKey IS NULL OR @Action IS NULL OR @Action COLLATE Latin1_General_100_BIN2 NOT IN('CREATE_AREA','ASSIGN','REMOVE')
 OR DATALENGTH(@Action)<>LEN(@Action) OR @Reason IS NULL OR LEN(LTRIM(RTRIM(@Reason)))=0 OR DATALENGTH(@Reason)>600 OR(@Action='CREATE_AREA' AND(@AreaName IS NULL OR LEN(LTRIM(RTRIM(@AreaName)))=0 OR DATALENGTH(@AreaName)>200 OR @AreaId IS NOT NULL OR @GuardUserId IS NOT NULL OR @AssignmentId IS NOT NULL))
 OR(@Action='ASSIGN' AND(@AreaId IS NULL OR @AreaId<=0 OR @GuardUserId IS NULL OR @AreaName IS NOT NULL OR @AssignmentId IS NOT NULL)) OR(@Action='REMOVE' AND(@AssignmentId IS NULL OR @AssignmentId<=0 OR @AreaId IS NOT NULL OR @GuardUserId IS NOT NULL OR @AreaName IS NOT NULL)) THROW 52002,'Invalid common duty command.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@op uniqueidentifier,@cached nvarchar(max),@result nvarchar(max);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 IF gp._HasCapability(@actor,'GUARDS_MANAGE',@LocationId,NULL,0,@now)=0 OR NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@LocationId AND IsActive=1) THROW 52001,'Not authorized.',1;
 DECLARE @payload nvarchar(max)=(SELECT @LocationId locationId,@Action action,CONVERT(varchar(20),@AreaId) areaId,@GuardUserId guardUserId,@AreaName areaName,CONVERT(varchar(20),@AssignmentId) assignmentId,@Reason reason FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER);
 EXEC gp._BeginOperation @actor,'MANAGE_COMMON_DUTY',@ClientKey,@payload,@op OUTPUT,@cached OUTPUT;
 IF @cached IS NOT NULL BEGIN COMMIT;SELECT @cached;RETURN;END;
 IF @Action='CREATE_AREA'
 BEGIN
  IF EXISTS(SELECT 1 FROM gp.CommonAreas WHERE LocationId=@LocationId AND AreaName=LTRIM(RTRIM(@AreaName))) THROW 52003,'Area name already exists.',1;
  INSERT gp.CommonAreas(LocationId,AreaName) VALUES(@LocationId,LTRIM(RTRIM(@AreaName)));SET @AreaId=CONVERT(bigint,SCOPE_IDENTITY());
 END;
 IF @Action='ASSIGN'
 BEGIN
  IF @GuardUserId=@actor OR NOT EXISTS(SELECT 1 FROM gp.CommonAreas WHERE CommonAreaId=@AreaId AND LocationId=@LocationId AND IsActive=1)
   OR NOT EXISTS(SELECT 1 FROM gp.Users u JOIN gp.StaffRoleGrants g ON g.UserId=u.UserId JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId WHERE u.UserId=@GuardUserId AND u.IsActive=1 AND g.RoleCode='GUARD' AND g.ScopeType='LOCATION' AND g.LocationId=@LocationId AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@now AND(g.ValidUntilUtc IS NULL OR @now<g.ValidUntilUtc) AND c.CapabilityCode='VISITS_READ')
   OR EXISTS(SELECT 1 FROM gp.StaffRoleGrants g WHERE g.UserId=@GuardUserId AND g.RoleCode NOT IN('GUARD','RECEPTION') AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@now AND(g.ValidUntilUtc IS NULL OR @now<g.ValidUntilUtc))
   THROW 52001,'Guard or area outside scope.',1;
  IF EXISTS(SELECT 1 FROM gp.GuardCommonAreaAssignments WHERE GuardUserId=@GuardUserId AND CommonAreaId=@AreaId AND DeallocatedAtUtc IS NULL) THROW 52003,'Duty already allocated.',1;
  INSERT gp.GuardCommonAreaAssignments(GuardUserId,CommonAreaId,AssignedByUserId,ValidFromUtc,Reason) VALUES(@GuardUserId,@AreaId,@actor,@now,@Reason);SET @AssignmentId=CONVERT(bigint,SCOPE_IDENTITY());
 END;
 IF @Action='REMOVE'
 BEGIN
  SELECT @AreaId=a.CommonAreaId,@GuardUserId=a.GuardUserId FROM gp.GuardCommonAreaAssignments a JOIN gp.CommonAreas c ON c.CommonAreaId=a.CommonAreaId WHERE a.AssignmentId=@AssignmentId AND c.LocationId=@LocationId AND a.DeallocatedAtUtc IS NULL;
  IF @AreaId IS NULL THROW 52001,'Assignment outside scope.',1;
  UPDATE gp.GuardCommonAreaAssignments SET DeallocatedAtUtc=@now WHERE AssignmentId=@AssignmentId;
 END;
 IF @Action IN('ASSIGN','REMOVE') UPDATE gp.Users SET AuthorizationVersion=AuthorizationVersion+1 WHERE UserId=@GuardUserId;
 SET @result=(SELECT @op operationId,@Action action,CONVERT(varchar(20),@AreaId) areaId,CONVERT(varchar(20),@AssignmentId) assignmentId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ResultCode,MetadataJson) VALUES(@actor,'COMMON_DUTY_MANAGED','COMMON_AREA',CONVERT(varchar(20),@AreaId),@LocationId,'SUCCESS',@payload);
 EXEC gp._CompleteOperation @op,@result;COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('075',N'Invalidate guard sessions after common duty assignment and removal');COMMIT;
