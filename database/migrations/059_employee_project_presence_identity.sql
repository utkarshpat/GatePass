/* A replacement daily Digital ID does not create a second employee/project occupant. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53900,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='058') THROW 53900,'Migration 058 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='059') THROW 53900,'Migration 059 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
ALTER TABLE gp.EmployeeProjectPresence ADD EmployeeId nvarchar(64) NULL;
ALTER TABLE gp.EmployeeProjectAccessEvents ADD PresentedVisitRequestId uniqueidentifier NULL;
GO
UPDATE s SET EmployeeId=v.EmployeeId FROM gp.EmployeeProjectPresence s JOIN gp.VisitRequests v ON v.VisitRequestId=s.VisitRequestId;
UPDATE e SET PresentedVisitRequestId=p.VisitRequestId FROM gp.EmployeeProjectAccessEvents e JOIN gp.AccessPasses p ON p.AccessPassId=e.AccessPassId;
IF EXISTS(SELECT 1 FROM gp.EmployeeProjectPresence WHERE IsInside=1 GROUP BY EmployeeId,ProjectLocationId HAVING COUNT(*)>1) THROW 53905,'Reconcile duplicate employee project occupants before applying.',1;
ALTER TABLE gp.EmployeeProjectPresence ALTER COLUMN EmployeeId nvarchar(64) NOT NULL;
ALTER TABLE gp.EmployeeProjectAccessEvents ALTER COLUMN PresentedVisitRequestId uniqueidentifier NOT NULL;
ALTER TABLE gp.EmployeeProjectPresence ADD CONSTRAINT FK_EmployeePresence_Employee FOREIGN KEY(EmployeeId) REFERENCES gp.Employees(EmployeeId);
ALTER TABLE gp.EmployeeProjectAccessEvents ADD CONSTRAINT FK_ProjectEvent_PresentedPass FOREIGN KEY(AccessPassId,PresentedVisitRequestId) REFERENCES gp.AccessPasses(AccessPassId,VisitRequestId);
CREATE UNIQUE INDEX UX_EmployeeProject_Inside ON gp.EmployeeProjectPresence(EmployeeId,ProjectLocationId) WHERE IsInside=1;
GO
ALTER FUNCTION gp._GuardDutyVisitAllowed(@Actor uniqueidentifier,@Kind varchar(10),@Duty bigint,@Location int,@Visit uniqueidentifier,@Cutoff datetime2(3),@Now datetime2(3))
RETURNS bit WITH INLINE=OFF AS BEGIN
 IF gp._GuardDutyAssigned(@Actor,@Kind,@Duty,@Location,@Now)=0 RETURN 0;
 IF EXISTS(SELECT 1 FROM gp.VisitRequests v WHERE v.VisitRequestId=@Visit AND v.LocationId=@Location AND v.PersonalDataPurgedAtUtc IS NULL AND
 (@Kind='COMMON' OR v.ProjectLocationId=@Duty OR v.RequestType='TEMP_ID' AND (
 gp._EmployeeProjectLocationEligible(v.EmployeeId,@Duty,@Cutoff,@Now)=1 OR EXISTS(SELECT 1 FROM gp.EmployeeProjectPresence s
 WHERE s.EmployeeId=v.EmployeeId AND s.ProjectLocationId=@Duty AND s.IsInside=1)))) RETURN 1;
 RETURN 0;
END;
GO
ALTER PROCEDURE gp._GuardDutyJson @Actor uniqueidentifier,@Kind varchar(10),@Duty bigint,@Location int,@Visit uniqueidentifier,@Now datetime2(3),@Result nvarchar(max) OUTPUT AS
BEGIN
 DECLARE @cutoff datetime2(3),@type varchar(24),@employee nvarchar(64),@presenceVisit uniqueidentifier=@Visit,@inside bit=0,@enter bit=0,@exit bit=0,@common bit=0;
 EXEC gp._DirectoryCutoff @Now,@cutoff OUTPUT;
 IF gp._GuardDutyVisitAllowed(@Actor,@Kind,@Duty,@Location,@Visit,@cutoff,@Now)=0 THROW 52001,'Not authorized.',1;
 EXEC gp._VisitReadJson @Actor,'GUARD',@Visit,@Now,@Result OUTPUT;
 SELECT @type=RequestType,@employee=EmployeeId FROM gp.VisitRequests WHERE VisitRequestId=@Visit;
 IF @Kind='COMMON'
 BEGIN
  IF JSON_VALUE(@Result,'$.status') IN('PENDING','APPROVED') AND JSON_VALUE(@Result,'$.passStatus') IN('PENDING','ACTIVE')
  AND @Now>=TRY_CONVERT(datetime2(3),JSON_VALUE(@Result,'$.validFromUtc')) AND @Now<TRY_CONVERT(datetime2(3),JSON_VALUE(@Result,'$.validUntilUtc'))
  AND JSON_VALUE(@Result,'$.photoAvailable')='true' AND EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@Location AND IsActive=1)
  AND(@employee IS NULL OR EXISTS(SELECT 1 FROM gp.Employees WHERE EmployeeId=@employee AND IsActive=1 AND LastSyncedAtUtc BETWEEN @cutoff AND @Now))
  AND(@type<>'TEMP_ID' OR gp._EmployeeOfficeEligible(@employee,@Location,@cutoff,@Now)=1) SET @common=1;
  SET @Result=JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(@Result,'$.isInside',CONVERT(bit,0)),'$.movements',JSON_QUERY(N'[]')),'$.movementsHasMore',CONVERT(bit,0));
 END
 ELSE IF @type='TEMP_ID'
 BEGIN
  SELECT TOP(1) @inside=IsInside,@presenceVisit=VisitRequestId FROM gp.EmployeeProjectPresence WHERE EmployeeId=@employee AND ProjectLocationId=@Duty AND IsInside=1;
  IF JSON_VALUE(@Result,'$.status')='APPROVED' AND JSON_VALUE(@Result,'$.passStatus')='ACTIVE'
  BEGIN
   IF @inside=1 AND EXISTS(SELECT 1 FROM gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 WHERE v.VisitRequestId=@presenceVisit AND v.Status='APPROVED' AND p.Status='ACTIVE') SET @exit=1;
   ELSE IF gp._EmployeeProjectLocationEligible(@employee,@Duty,@cutoff,@Now)=1 AND JSON_VALUE(@Result,'$.photoAvailable')='true'
    AND @Now>=TRY_CONVERT(datetime2(3),JSON_VALUE(@Result,'$.validFromUtc')) AND @Now<TRY_CONVERT(datetime2(3),JSON_VALUE(@Result,'$.validUntilUtc')) SET @enter=1;
  END;
  SET @Result=JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(@Result,'$.isInside',@inside),'$.projectLocationId',CONVERT(varchar(20),@Duty)),
   '$.projectName',(SELECT p.ProjectName FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId WHERE pl.ProjectLocationId=@Duty)),
   '$.movements',JSON_QUERY(COALESCE((SELECT TOP(100) CONVERT(varchar(20),e.AccessEventId) accessEventId,e.EventType eventType,e.EntryMethod entryMethod,u.DisplayName guardName,
   REPLACE(CONVERT(char(23),e.OccurredAtUtc,121),' ','T')+'Z' occurredAtUtc FROM gp.EmployeeProjectAccessEvents e JOIN gp.Users u ON u.UserId=e.ActorUserId
   WHERE e.ProjectLocationId=@Duty AND EXISTS(SELECT 1 FROM gp.VisitRequests ev WHERE ev.VisitRequestId=e.VisitRequestId AND ev.EmployeeId=@employee) ORDER BY e.OccurredAtUtc DESC,e.AccessEventId DESC FOR JSON PATH),N'[]')));
  SET @Result=JSON_MODIFY(@Result,'$.movementsHasMore',CONVERT(bit,CASE WHEN(SELECT COUNT(*) FROM(SELECT TOP(101) AccessEventId FROM gp.EmployeeProjectAccessEvents WHERE ProjectLocationId=@Duty AND EXISTS(SELECT 1 FROM gp.VisitRequests ev WHERE ev.VisitRequestId=gp.EmployeeProjectAccessEvents.VisitRequestId AND ev.EmployeeId=@employee)) b)>100 THEN 1 ELSE 0 END));
 END
 ELSE BEGIN SET @enter=CASE WHEN JSON_VALUE(@Result,'$.canEnter')='true' THEN 1 ELSE 0 END;SET @exit=CASE WHEN JSON_VALUE(@Result,'$.canExit')='true' THEN 1 ELSE 0 END;END;
 SET @Result=JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(@Result,'$.canEnter',@enter),'$.canExit',@exit),'$.canReconcileExit',CONVERT(bit,CASE WHEN @Kind='PROJECT' AND @type='TEMP_ID' AND @inside=1 AND @exit=0 AND gp._HasCapability(@Actor,'RECONCILE_EXIT',@Location,@Duty,1,@Now)=1 THEN 1 ELSE 0 END));
 SET @Result=JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(@Result,'$.dutyKind',@Kind),'$.dutyId',CONVERT(varchar(20),@Duty)),'$.verificationOnly',CONVERT(bit,CASE WHEN @Kind='COMMON' THEN 1 ELSE 0 END)),'$.commonAccessAllowed',@common);
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
 LEFT JOIN gp.EmployeeProjectPresence ep ON ep.EmployeeId=v.EmployeeId AND ep.ProjectLocationId=@DutyId AND ep.IsInside=1
 WHERE v.LocationId=@LocationId AND gp._GuardDutyVisitAllowed(@actor,@DutyKind,@DutyId,@LocationId,v.VisitRequestId,@cutoff,@now)=1
 AND(@Search=N'' OR CHARINDEX(@Search,v.PersonName COLLATE Latin1_General_100_CI_AI)>0 OR CHARINDEX(@Search,v.PublicReference)>0 OR CHARINDEX(@Search,p.PublicPassNumber)>0)
 AND((@Queue='EXPECTED' AND v.LocalVisitDate=CONVERT(date,DATEADD(minute,330,@now)) AND v.Status IN('PENDING','APPROVED') AND p.Status IN('PENDING','ACTIVE') AND v.ValidUntilUtc>@now
 AND(@DutyKind='COMMON' OR CASE WHEN v.RequestType='TEMP_ID' THEN COALESCE(ep.IsInside,0) ELSE s.IsInside END=0))
 OR(@Queue='INSIDE' AND(v.RequestType<>'TEMP_ID' OR ep.VisitRequestId=v.VisitRequestId) AND CASE WHEN v.RequestType='TEMP_ID' THEN COALESCE(ep.IsInside,0) ELSE s.IsInside END=1
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
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@type varchar(24),@employee nvarchar(64),@status varchar(12),@passStatus varchar(12),@start datetime2(3),@end datetime2(3),@inside bit,@last datetime2(3),@op uniqueidentifier,@cached nvarchar(max),@result nvarchar(max),@event bigint,@presenceVisit uniqueidentifier=@VisitRequestId,@lock nvarchar(255);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF gp._GuardDutyAssigned(@actor,'PROJECT',@DutyId,@LocationId,@now)=0 THROW 52001,'Not authorized.',1;
 SELECT @type=RequestType,@employee=EmployeeId FROM gp.VisitRequests WHERE VisitRequestId=@VisitRequestId AND LocationId=@LocationId;
 IF @type='TEMP_ID'
 BEGIN SET @lock=N'gp:employee-project:'+CONVERT(varchar(64),HASHBYTES('SHA2_256',@employee),2);EXEC gp._TakeLock @lock;END;
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
 IF @EventType='EXIT'
 BEGIN
  SELECT TOP(1) @presenceVisit=VisitRequestId FROM gp.EmployeeProjectPresence WHERE EmployeeId=@employee AND ProjectLocationId=@DutyId AND IsInside=1;
  IF @presenceVisit<>@VisitRequestId BEGIN SET @lock=N'gp:visit:'+LOWER(CONVERT(char(36),@presenceVisit));EXEC gp._TakeLock @lock;END;
  IF @EntryMethod<>'RECONCILE' AND NOT EXISTS(SELECT 1 FROM gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 WHERE v.VisitRequestId=@presenceVisit AND v.Status='APPROVED' AND p.Status='ACTIVE') THROW 52005,'Existing occupant requires reconciliation.',1;
 END;
 SELECT @passStatus=Status FROM gp.AccessPasses WHERE AccessPassId=@AccessPassId AND VisitRequestId=@VisitRequestId AND IsCurrent=1 AND(@EntryMethod<>'SCAN' OR CredentialHash=@CredentialHash);
 IF @passStatus IS NULL THROW 52001,'Not authorized.',1;
 IF @EventType='ENTRY' AND gp._EmployeeProjectLocationEligible(@employee,@DutyId,@cutoff,@now)=0 THROW 52004,'Current project office assignment required.',1;
 IF @EntryMethod='RECONCILE' AND gp._HasCapability(@actor,'RECONCILE_EXIT',@LocationId,@DutyId,1,@now)=0 THROW 52001,'Reconciliation not authorized.',1;
 DECLARE @payload nvarchar(max)=(SELECT @VisitRequestId visitRequestId,@AccessPassId accessPassId,@LocationId locationId,CONVERT(varchar(20),@DutyId) dutyId,@EventType eventType,@EntryMethod entryMethod,CONVERT(varchar(64),@CredentialHash,2) credentialHash,@Reason reason FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER);
 EXEC gp._BeginOperation @actor,'EMPLOYEE_PROJECT_MOVEMENT',@ClientKey,@payload,@op OUTPUT,@cached OUTPUT;
 IF @cached IS NOT NULL BEGIN COMMIT;SELECT @cached;RETURN;END;
 IF @EntryMethod<>'RECONCILE' AND(@status<>'APPROVED' OR @passStatus<>'ACTIVE') THROW 52005,'Active credential required; reconcile an existing occupant.',1;
 IF @EventType='ENTRY' AND EXISTS(SELECT 1 FROM gp.EmployeeProjectPresence WHERE EmployeeId=@employee AND ProjectLocationId=@DutyId AND IsInside=1) THROW 52005,'Employee already inside this project.',1;
 IF @EventType='ENTRY' AND(@now<@start OR @now>=@end OR NOT EXISTS(SELECT 1 FROM gp.VisitRequests v JOIN gp.PhotoAssets p ON p.PhotoAssetId=v.PhotoAssetId WHERE v.VisitRequestId=@VisitRequestId AND v.PersonalDataPurgedAtUtc IS NULL AND p.PurgedAtUtc IS NULL AND p.StorageKey IS NOT NULL AND p.ContentHash IS NOT NULL)) THROW 52005,'Visit is not enterable.',1;
 IF NOT EXISTS(SELECT 1 FROM gp.EmployeeProjectPresence WHERE VisitRequestId=@VisitRequestId AND ProjectLocationId=@DutyId) INSERT gp.EmployeeProjectPresence(VisitRequestId,ProjectLocationId,EmployeeId) VALUES(@VisitRequestId,@DutyId,@employee);
 SELECT @inside=IsInside,@last=LastMovementAtUtc FROM gp.EmployeeProjectPresence WITH(UPDLOCK) WHERE VisitRequestId=@presenceVisit AND ProjectLocationId=@DutyId;
 IF(@EventType='ENTRY' AND @inside=1) OR(@EventType='EXIT' AND @inside=0) THROW 52005,'Movement conflicts with project presence.',1;
 INSERT gp.EmployeeProjectAccessEvents(VisitRequestId,ProjectLocationId,AccessPassId,ActorUserId,OperationId,EventType,EntryMethod,OccurredAtUtc,Reason,PresentedVisitRequestId)
 VALUES(@presenceVisit,@DutyId,@AccessPassId,@actor,@op,@EventType,@EntryMethod,@now,@Reason,@VisitRequestId);SET @event=CONVERT(bigint,SCOPE_IDENTITY());
 UPDATE gp.EmployeeProjectPresence SET IsInside=CASE WHEN @EventType='ENTRY' THEN 1 ELSE 0 END,LastEventId=@event,LastMovementAtUtc=@now WHERE VisitRequestId=@presenceVisit AND ProjectLocationId=@DutyId;
 SET @result=(SELECT @op operationId,@VisitRequestId visitRequestId,@event accessEventId,CONVERT(varchar(20),@DutyId) projectLocationId,@EventType eventType,CONVERT(bit,CASE WHEN @EventType='ENTRY' THEN 1 ELSE 0 END) isInside FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode,MetadataJson) VALUES(@actor,'PROJECT_MOVEMENT','VISIT',CONVERT(varchar(36),@VisitRequestId),@LocationId,@DutyId,'SUCCESS',@result);
 EXEC gp._CompleteOperation @op,@result;COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('059',N'Employee project presence persists across daily Digital ID replacement');COMMIT;
