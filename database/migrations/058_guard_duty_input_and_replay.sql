/* Preserve full input validation and reauthorize project entry before cached receipts. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53900,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='057') THROW 53900,'Migration 057 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='058') THROW 53900,'Migration 058 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
ALTER PROCEDURE gp.ReadGuardDutyPass @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@DutyKind varchar(8000),@DutyId bigint,
 @VisitRequestId uniqueidentifier=NULL,@CredentialHash varbinary(8000)=NULL,@CorrelationId uniqueidentifier=NULL AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF DATALENGTH(@DutyKind)<>LEN(@DutyKind) OR @DutyKind IS NULL OR @DutyKind COLLATE Latin1_General_100_BIN2 NOT IN('COMMON','PROJECT') OR @DutyId IS NULL OR @DutyId<=0 OR @LocationId IS NULL OR @LocationId<=0
 OR(@VisitRequestId IS NULL AND(@CredentialHash IS NULL OR DATALENGTH(@CredentialHash)<>32 OR @CorrelationId IS NULL)) OR(@VisitRequestId IS NOT NULL AND @CredentialHash IS NOT NULL) THROW 52002,'Invalid duty read.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@visit uniqueidentifier=@VisitRequestId,@pass uniqueidentifier,@current bit,@detail nvarchar(max),@outcome varchar(32),@lock nvarchar(255);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF gp._GuardDutyAssigned(@actor,@DutyKind,@DutyId,@LocationId,@now)=0 THROW 52001,'Not authorized.',1;
 IF @CredentialHash IS NOT NULL SELECT @visit=VisitRequestId,@pass=AccessPassId,@current=IsCurrent FROM gp.AccessPasses WHERE CredentialHash=@CredentialHash;
 IF @visit IS NOT NULL
 BEGIN
  SET @lock=N'gp:visit:'+LOWER(CONVERT(char(36),@visit));EXEC gp._TakeLock @lock,'Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
  IF gp._GuardDutyVisitAllowed(@actor,@DutyKind,@DutyId,@LocationId,@visit,@cutoff,@now)=0 SET @visit=NULL;
 END;
 IF @visit IS NOT NULL
 BEGIN
  EXEC gp._GuardDutyJson @actor,@DutyKind,@DutyId,@LocationId,@visit,@now,@detail OUTPUT;
  SET @outcome=CASE WHEN @current=0 OR JSON_VALUE(@detail,'$.passStatus')='REVOKED' THEN 'REVOKED' WHEN JSON_VALUE(@detail,'$.status')='CANCELLED' THEN 'CANCELLED'
  WHEN JSON_VALUE(@detail,'$.status')='DENIED' THEN 'DENIED' WHEN @DutyKind='COMMON' AND JSON_VALUE(@detail,'$.commonAccessAllowed')='true' THEN 'VALID'
  WHEN JSON_VALUE(@detail,'$.status')='PENDING' THEN 'PENDING' WHEN @now>=TRY_CONVERT(datetime2(3),JSON_VALUE(@detail,'$.validUntilUtc')) THEN 'EXPIRED'
  WHEN @now<TRY_CONVERT(datetime2(3),JSON_VALUE(@detail,'$.validFromUtc')) THEN 'NOT_YET_VALID'
  WHEN JSON_VALUE(@detail,'$.canEnter')='true' OR JSON_VALUE(@detail,'$.canExit')='true' THEN 'VALID' ELSE 'NOT_AUTHORIZED' END;
  IF @current=0 SET @detail=JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(@detail,'$.canEnter',CONVERT(bit,0)),'$.canExit',CONVERT(bit,0)),'$.commonAccessAllowed',CONVERT(bit,0));
 END ELSE SET @outcome='NOT_AVAILABLE';
 IF @CredentialHash IS NOT NULL INSERT gp.PassScanAttempts(AccessPassId,VisitRequestId,ActorUserId,LocationId,OutcomeCode,CorrelationId)
 VALUES(CASE WHEN @visit IS NOT NULL THEN @pass END,@visit,@actor,@LocationId,CASE WHEN @outcome='NOT_AVAILABLE' THEN 'NOT_AUTHORIZED' ELSE @outcome END,@CorrelationId);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode,MetadataJson)
 VALUES(@actor,'GUARD_DUTY_READ','VISIT',CONVERT(varchar(36),@visit),@LocationId,CASE WHEN @DutyKind='PROJECT' THEN @DutyId END,CASE WHEN @visit IS NULL THEN 'DENIED' ELSE 'SUCCESS' END,
 (SELECT @DutyKind dutyKind,CONVERT(varchar(20),@DutyId) dutyId,@outcome outcome FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
 COMMIT;SELECT(SELECT @outcome outcome,JSON_QUERY(@detail) visit FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
ALTER PROCEDURE gp.ListGuardDutyVisitors @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@DutyKind varchar(8000),@DutyId bigint,
 @Queue varchar(8000),@Search nvarchar(max)=N'',@Offset int=0 AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF DATALENGTH(@DutyKind)<>LEN(@DutyKind) OR @DutyKind IS NULL OR @DutyKind COLLATE Latin1_General_100_BIN2 NOT IN('COMMON','PROJECT') OR @DutyId IS NULL OR @DutyId<=0 OR @LocationId IS NULL OR @LocationId<=0 OR DATALENGTH(@Queue)<>LEN(@Queue) OR @Queue IS NULL OR @Queue COLLATE Latin1_General_100_BIN2 NOT IN('EXPECTED','INSIDE')
 OR(@DutyKind='COMMON' AND @Queue<>'EXPECTED') OR @Search IS NULL OR DATALENGTH(@Search)>200 OR @Offset IS NULL OR @Offset<0 OR @Offset>100000 THROW 52002,'Invalid duty queue.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@more bit=0,@result nvarchar(max);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF gp._GuardDutyAssigned(@actor,@DutyKind,@DutyId,@LocationId,@now)=0 THROW 52001,'Not authorized.',1;
 DECLARE @page table(Position int,VisitId uniqueidentifier,IsInside bit);
 INSERT @page SELECT ROW_NUMBER() OVER(ORDER BY v.SubmittedAtUtc DESC,v.VisitRequestId DESC),v.VisitRequestId,
 CASE WHEN @DutyKind='COMMON' THEN 0 WHEN v.RequestType='TEMP_ID' THEN COALESCE(ep.IsInside,0) ELSE s.IsInside END
 FROM gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId
 LEFT JOIN gp.EmployeeProjectPresence ep ON ep.VisitRequestId=v.VisitRequestId AND ep.ProjectLocationId=@DutyId
 WHERE v.LocationId=@LocationId AND gp._GuardDutyVisitAllowed(@actor,@DutyKind,@DutyId,@LocationId,v.VisitRequestId,@cutoff,@now)=1
 AND(@Search=N'' OR CHARINDEX(@Search,v.PersonName COLLATE Latin1_General_100_CI_AI)>0 OR CHARINDEX(@Search,v.PublicReference)>0 OR CHARINDEX(@Search,p.PublicPassNumber)>0)
 AND((@Queue='EXPECTED' AND v.LocalVisitDate=CONVERT(date,DATEADD(minute,330,@now)) AND v.Status IN('PENDING','APPROVED') AND p.Status IN('PENDING','ACTIVE') AND v.ValidUntilUtc>@now
 AND(@DutyKind='COMMON' OR CASE WHEN v.RequestType='TEMP_ID' THEN COALESCE(ep.IsInside,0) ELSE s.IsInside END=0))
 OR(@Queue='INSIDE' AND CASE WHEN v.RequestType='TEMP_ID' THEN COALESCE(ep.IsInside,0) ELSE s.IsInside END=1
 AND((v.RequestType='TEMP_ID' AND EXISTS(SELECT 1 FROM gp.EmployeeProjectAccessEvents e WHERE e.AccessEventId=ep.LastEventId AND e.ActorUserId=@actor AND e.EventType='ENTRY'))
 OR(v.RequestType<>'TEMP_ID' AND EXISTS(SELECT 1 FROM gp.AccessEvents e WHERE e.AccessEventId=s.LastAccessEventId AND e.ActorUserId=@actor AND e.EventType='ENTRY')))))
 ORDER BY v.SubmittedAtUtc DESC,v.VisitRequestId DESC OFFSET @Offset ROWS FETCH NEXT 51 ROWS ONLY;
 IF(SELECT COUNT(*) FROM @page)>50 BEGIN SET @more=1;DELETE @page WHERE Position=(SELECT MAX(Position) FROM @page);END;
 SET @result=(SELECT JSON_QUERY(COALESCE((SELECT v.VisitRequestId visitRequestId,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,v.PersonName personName,
 CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END requestType,
 CASE WHEN @DutyKind='PROJECT' THEN(SELECT pr.ProjectName FROM gp.ProjectLocations pl JOIN gp.Projects pr ON pr.ProjectId=pl.ProjectId WHERE pl.ProjectLocationId=@DutyId)
 ELSE(SELECT pr.ProjectName FROM gp.ProjectLocations pl JOIN gp.Projects pr ON pr.ProjectId=pl.ProjectId WHERE pl.ProjectLocationId=v.ProjectLocationId) END projectName,
 he.FullName hostName,JSON_QUERY(CASE WHEN v.RequestType='TEMP_ID' THEN gp._EmployeeProjectSummary(v.EmployeeId,@cutoff,@now,v.LocationId) END) employeeProjects,
 v.Status status,p.Status passStatus,q.IsInside isInside,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc,
 CONVERT(bit,CASE WHEN ph.PurgedAtUtc IS NULL AND ph.StorageKey IS NOT NULL THEN 1 ELSE 0 END) photoAvailable
 FROM @page q JOIN gp.VisitRequests v ON v.VisitRequestId=q.VisitId JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1
 JOIN gp.PhotoAssets ph ON ph.PhotoAssetId=v.PhotoAssetId LEFT JOIN gp.Employees he ON he.EmployeeId=v.HostEmployeeId ORDER BY q.Position FOR JSON PATH),N'[]')) visitors,@more hasMore FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
ALTER PROCEDURE gp.RecordGuardDutyMovement @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ClientKey uniqueidentifier,
 @VisitRequestId uniqueidentifier,@AccessPassId uniqueidentifier,@LocationId int,@DutyKind varchar(8000),@DutyId bigint,@EventType varchar(8000),@EntryMethod varchar(8000),
 @CredentialHash varbinary(8000)=NULL,@Reason nvarchar(max)=NULL AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF DATALENGTH(@DutyKind)<>LEN(@DutyKind) OR @DutyKind IS NULL OR @DutyKind COLLATE Latin1_General_100_BIN2<>'PROJECT' OR @DutyId IS NULL OR @DutyId<=0 OR @LocationId IS NULL OR @LocationId<=0
 OR @VisitRequestId IS NULL OR @AccessPassId IS NULL OR @ClientKey IS NULL OR @EventType IS NULL OR @EventType COLLATE Latin1_General_100_BIN2 NOT IN('ENTRY','EXIT')
 OR DATALENGTH(@EventType)<>LEN(@EventType) OR DATALENGTH(@EntryMethod)<>LEN(@EntryMethod) OR DATALENGTH(@Reason)>600 OR @EntryMethod IS NULL OR @EntryMethod COLLATE Latin1_General_100_BIN2 NOT IN('SCAN','MANUAL','RECONCILE') OR(@EntryMethod='SCAN' AND(@CredentialHash IS NULL OR DATALENGTH(@CredentialHash)<>32))
 OR(@EntryMethod<>'SCAN' AND @CredentialHash IS NOT NULL) OR(@EntryMethod='RECONCILE' AND(@EventType<>'EXIT' OR @Reason IS NULL OR LEN(LTRIM(RTRIM(@Reason)))=0)) OR(@EntryMethod<>'RECONCILE' AND @Reason IS NOT NULL) THROW 52002,'Invalid duty movement.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@type varchar(24),@employee nvarchar(64),@status varchar(12),@passStatus varchar(12),@start datetime2(3),@end datetime2(3),@inside bit,@last datetime2(3),@op uniqueidentifier,@cached nvarchar(max),@result nvarchar(max),@event bigint,@lock nvarchar(255);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF gp._GuardDutyAssigned(@actor,'PROJECT',@DutyId,@LocationId,@now)=0 THROW 52001,'Not authorized.',1;
 SET @lock=N'gp:visit:'+LOWER(CONVERT(char(36),@VisitRequestId));EXEC gp._TakeLock @lock;EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 SELECT @type=RequestType,@employee=EmployeeId,@status=Status,@start=ValidFromUtc,@end=ValidUntilUtc FROM gp.VisitRequests WHERE VisitRequestId=@VisitRequestId AND LocationId=@LocationId;
 IF @type IS NULL OR gp._GuardDutyVisitAllowed(@actor,'PROJECT',@DutyId,@LocationId,@VisitRequestId,@cutoff,@now)=0 THROW 52001,'Not authorized.',1;
 IF @EventType='ENTRY'
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM gp.AccessPasses WHERE AccessPassId=@AccessPassId AND VisitRequestId=@VisitRequestId AND IsCurrent=1 AND Status='ACTIVE' AND(@EntryMethod<>'SCAN' OR CredentialHash=@CredentialHash)) OR @status<>'APPROVED' OR @now<@start OR @now>=@end THROW 52005,'Current active entry credential required.',1;
  IF NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@LocationId AND IsActive=1) OR NOT EXISTS(SELECT 1 FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId WHERE pl.ProjectLocationId=@DutyId AND pl.IsActive=1 AND p.IsActive=1) THROW 52005,'Project office inactive.',1;
  IF @employee IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gp.Employees WHERE EmployeeId=@employee AND IsActive=1 AND LastSyncedAtUtc BETWEEN @cutoff AND @now) THROW 52004,'Current employee required.',1;
  IF NOT EXISTS(SELECT 1 FROM gp.VisitRequests v JOIN gp.PhotoAssets a ON a.PhotoAssetId=v.PhotoAssetId WHERE v.VisitRequestId=@VisitRequestId AND v.PersonalDataPurgedAtUtc IS NULL AND a.PurgedAtUtc IS NULL AND a.StorageKey IS NOT NULL AND a.ContentHash IS NOT NULL) THROW 52005,'Current photo required.',1;
 END;
 IF @type<>'TEMP_ID'
 BEGIN
  COMMIT;EXEC gp.RecordMovement @SessionHash=@SessionHash,@CsrfHash=@CsrfHash,@ClientKey=@ClientKey,@VisitRequestId=@VisitRequestId,@AccessPassId=@AccessPassId,@LocationId=@LocationId,
  @EventType=@EventType,@EntryMethod=@EntryMethod,@CredentialHash=@CredentialHash,@SelectedProjectLocationId=@DutyId,@ReconciliationReason=@Reason;RETURN;
 END;
 SELECT @passStatus=Status FROM gp.AccessPasses WHERE AccessPassId=@AccessPassId AND VisitRequestId=@VisitRequestId AND IsCurrent=1 AND(@EntryMethod<>'SCAN' OR CredentialHash=@CredentialHash);
 IF @passStatus IS NULL THROW 52001,'Not authorized.',1;
 IF @EventType='ENTRY' AND gp._EmployeeProjectLocationEligible(@employee,@DutyId,@cutoff,@now)=0 THROW 52004,'Current project office assignment required.',1;
 IF @EntryMethod='RECONCILE' AND gp._HasCapability(@actor,'RECONCILE_EXIT',@LocationId,@DutyId,1,@now)=0 THROW 52001,'Reconciliation not authorized.',1;
 DECLARE @payload nvarchar(max)=(SELECT @VisitRequestId visitRequestId,@AccessPassId accessPassId,@LocationId locationId,CONVERT(varchar(20),@DutyId) dutyId,@EventType eventType,@EntryMethod entryMethod,CONVERT(varchar(64),@CredentialHash,2) credentialHash,@Reason reason FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER);
 EXEC gp._BeginOperation @actor,'EMPLOYEE_PROJECT_MOVEMENT',@ClientKey,@payload,@op OUTPUT,@cached OUTPUT;
 IF @cached IS NOT NULL BEGIN COMMIT;SELECT @cached;RETURN;END;
 IF @EntryMethod<>'RECONCILE' AND(@status<>'APPROVED' OR @passStatus<>'ACTIVE') THROW 52005,'Active credential required; reconcile an existing occupant.',1;
 IF @EventType='ENTRY' AND(@now<@start OR @now>=@end OR NOT EXISTS(SELECT 1 FROM gp.VisitRequests v JOIN gp.PhotoAssets p ON p.PhotoAssetId=v.PhotoAssetId WHERE v.VisitRequestId=@VisitRequestId AND v.PersonalDataPurgedAtUtc IS NULL AND p.PurgedAtUtc IS NULL AND p.StorageKey IS NOT NULL AND p.ContentHash IS NOT NULL)) THROW 52005,'Visit is not enterable.',1;
 IF NOT EXISTS(SELECT 1 FROM gp.EmployeeProjectPresence WHERE VisitRequestId=@VisitRequestId AND ProjectLocationId=@DutyId) INSERT gp.EmployeeProjectPresence(VisitRequestId,ProjectLocationId) VALUES(@VisitRequestId,@DutyId);
 SELECT @inside=IsInside,@last=LastMovementAtUtc FROM gp.EmployeeProjectPresence WITH(UPDLOCK) WHERE VisitRequestId=@VisitRequestId AND ProjectLocationId=@DutyId;
 IF(@EventType='ENTRY' AND @inside=1) OR(@EventType='EXIT' AND @inside=0) THROW 52005,'Movement conflicts with project presence.',1;
 INSERT gp.EmployeeProjectAccessEvents(VisitRequestId,ProjectLocationId,AccessPassId,ActorUserId,OperationId,EventType,EntryMethod,OccurredAtUtc,Reason)
 VALUES(@VisitRequestId,@DutyId,@AccessPassId,@actor,@op,@EventType,@EntryMethod,@now,@Reason);SET @event=CONVERT(bigint,SCOPE_IDENTITY());
 UPDATE gp.EmployeeProjectPresence SET IsInside=CASE WHEN @EventType='ENTRY' THEN 1 ELSE 0 END,LastEventId=@event,LastMovementAtUtc=@now WHERE VisitRequestId=@VisitRequestId AND ProjectLocationId=@DutyId;
 SET @result=(SELECT @op operationId,@VisitRequestId visitRequestId,@event accessEventId,CONVERT(varchar(20),@DutyId) projectLocationId,@EventType eventType,CONVERT(bit,CASE WHEN @EventType='ENTRY' THEN 1 ELSE 0 END) isInside FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode,MetadataJson) VALUES(@actor,'PROJECT_MOVEMENT','VISIT',CONVERT(varchar(36),@VisitRequestId),@LocationId,@DutyId,'SUCCESS',@result);
 EXEC gp._CompleteOperation @op,@result;COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
ALTER PROCEDURE gp.GetCommonDutyAdministration @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@Search nvarchar(max)=N'',@Offset int=0 AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF @LocationId IS NULL OR @LocationId<=0 OR @Search IS NULL OR DATALENGTH(@Search)>160 OR(@Search<>N'' AND LEN(LTRIM(RTRIM(@Search)))<2) OR @Offset IS NULL OR @Offset<0 OR @Offset>100000 THROW 52002,'Invalid common duty query.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@result nvarchar(max);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 IF gp._HasCapability(@actor,'GUARDS_MANAGE',@LocationId,NULL,0,@now)=0 THROW 52001,'Not authorized.',1;
 SET @result=(SELECT JSON_QUERY(COALESCE((SELECT CONVERT(varchar(20),CommonAreaId) areaId,AreaName name FROM gp.CommonAreas WHERE LocationId=@LocationId AND IsActive=1 ORDER BY AreaName FOR JSON PATH),N'[]')) areas,
 JSON_QUERY(COALESCE((SELECT TOP(20) u.UserId userId,u.DisplayName displayName FROM gp.Users u WHERE @Search<>N'' AND u.IsActive=1 AND(CHARINDEX(@Search,u.DisplayName)>0 OR CHARINDEX(@Search,u.IdentitySubject)>0)
 AND EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId WHERE g.UserId=u.UserId AND g.RoleCode='GUARD' AND g.ScopeType='LOCATION' AND g.LocationId=@LocationId AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@now AND(g.ValidUntilUtc IS NULL OR @now<g.ValidUntilUtc) AND c.CapabilityCode='VISITS_READ') ORDER BY u.DisplayName,u.UserId FOR JSON PATH),N'[]')) guards,
 JSON_QUERY(COALESCE((SELECT CONVERT(varchar(20),a.AssignmentId) assignmentId,CONVERT(varchar(20),a.CommonAreaId) areaId,c.AreaName areaName,u.DisplayName guardName,a.GuardUserId guardUserId FROM gp.GuardCommonAreaAssignments a JOIN gp.CommonAreas c ON c.CommonAreaId=a.CommonAreaId JOIN gp.Users u ON u.UserId=a.GuardUserId
 WHERE c.LocationId=@LocationId AND a.DeallocatedAtUtc IS NULL ORDER BY a.AssignmentId OFFSET @Offset ROWS FETCH NEXT 50 ROWS ONLY FOR JSON PATH),N'[]')) assignments,
 CONVERT(bit,CASE WHEN(SELECT COUNT(*) FROM gp.GuardCommonAreaAssignments a JOIN gp.CommonAreas c ON c.CommonAreaId=a.CommonAreaId WHERE c.LocationId=@LocationId AND a.DeallocatedAtUtc IS NULL)>@Offset+50 THEN 1 ELSE 0 END) hasMore FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
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
  IF NOT EXISTS(SELECT 1 FROM gp.CommonAreas WHERE CommonAreaId=@AreaId AND LocationId=@LocationId AND IsActive=1) OR NOT EXISTS(SELECT 1 FROM gp.Users u JOIN gp.StaffRoleGrants g ON g.UserId=u.UserId JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId WHERE u.UserId=@GuardUserId AND u.IsActive=1 AND g.RoleCode='GUARD' AND g.ScopeType='LOCATION' AND g.LocationId=@LocationId AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@now AND(g.ValidUntilUtc IS NULL OR @now<g.ValidUntilUtc) AND c.CapabilityCode='VISITS_READ') THROW 52001,'Guard or area outside scope.',1;
  IF EXISTS(SELECT 1 FROM gp.GuardCommonAreaAssignments WHERE GuardUserId=@GuardUserId AND CommonAreaId=@AreaId AND DeallocatedAtUtc IS NULL) THROW 52003,'Duty already allocated.',1;
  INSERT gp.GuardCommonAreaAssignments(GuardUserId,CommonAreaId,AssignedByUserId,ValidFromUtc,Reason) VALUES(@GuardUserId,@AreaId,@actor,@now,@Reason);SET @AssignmentId=CONVERT(bigint,SCOPE_IDENTITY());
 END;
 IF @Action='REMOVE'
 BEGIN
  SELECT @AreaId=a.CommonAreaId FROM gp.GuardCommonAreaAssignments a JOIN gp.CommonAreas c ON c.CommonAreaId=a.CommonAreaId WHERE a.AssignmentId=@AssignmentId AND c.LocationId=@LocationId AND a.DeallocatedAtUtc IS NULL;
  IF @AreaId IS NULL THROW 52001,'Assignment outside scope.',1;
  UPDATE gp.GuardCommonAreaAssignments SET DeallocatedAtUtc=@now WHERE AssignmentId=@AssignmentId;
 END;
 SET @result=(SELECT @op operationId,@Action action,CONVERT(varchar(20),@AreaId) areaId,CONVERT(varchar(20),@AssignmentId) assignmentId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ResultCode,MetadataJson) VALUES(@actor,'COMMON_DUTY_MANAGED','COMMON_AREA',CONVERT(varchar(20),@AreaId),@LocationId,'SUCCESS',@payload);
 EXEC gp._CompleteOperation @op,@result;COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('058',N'Full-width duty inputs and current credential checks on entry retries');COMMIT;
