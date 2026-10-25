/* Serialize employee occupancy across both credential types and require explicit register export authority.
   Existing presence/events remain intact; conflicting historical occupants require authorized exit reconciliation. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54900,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='098') THROW 54900,'Migration 098 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='099') THROW 54900,'Migration 099 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
CREATE FUNCTION gp._EmployeeProjectOccupied(@Employee nvarchar(64),@ProjectLocation bigint) RETURNS bit
AS BEGIN
 IF @Employee IS NULL OR @ProjectLocation IS NULL RETURN 0;
 IF EXISTS(SELECT 1 FROM gp.EmployeeProjectPresence WHERE EmployeeId=@Employee AND ProjectLocationId=@ProjectLocation AND IsInside=1) RETURN 1;
 IF EXISTS(SELECT 1 FROM gp.VisitRequests v JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId
  WHERE v.EmployeeId=@Employee AND v.ProjectLocationId=@ProjectLocation AND s.IsInside=1) RETURN 1;
 RETURN 0;
END;
GO
ALTER PROCEDURE gp.RecordMovement
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ClientKey uniqueidentifier,
    @VisitRequestId uniqueidentifier,@AccessPassId uniqueidentifier,@LocationId int,
    @EventType varchar(20),@EntryMethod varchar(20),@CredentialHash varbinary(8000)=NULL,
    @OccurredAtUtc datetime2(3)=NULL,@ReconciliationReason nvarchar(1000)=NULL,@SelectedProjectLocationId bigint=NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 52000, 'Ambient transactions are not accepted.', 1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@op uniqueidentifier,@cached nvarchar(max),@result nvarchar(max);
    BEGIN TRY
        IF @VisitRequestId IS NULL OR @AccessPassId IS NULL OR @LocationId IS NULL
           OR (@SelectedProjectLocationId IS NOT NULL AND @SelectedProjectLocationId<=0)
           OR @EventType IS NULL OR @EventType COLLATE Latin1_General_100_BIN2 NOT IN ('ENTRY','EXIT')
           OR @EntryMethod IS NULL OR @EntryMethod COLLATE Latin1_General_100_BIN2 NOT IN ('SCAN','MANUAL','RECONCILE')
           OR (@EntryMethod='SCAN' AND (@CredentialHash IS NULL OR DATALENGTH(@CredentialHash)<>32))
           OR (@EntryMethod<>'SCAN' AND @CredentialHash IS NOT NULL)
           OR (@EntryMethod<>'RECONCILE' AND (@OccurredAtUtc IS NOT NULL OR @ReconciliationReason IS NOT NULL))
           OR (@EntryMethod='RECONCILE' AND (@EventType<>'EXIT' OR @ReconciliationReason IS NULL
                OR LEN(LTRIM(RTRIM(@ReconciliationReason)))=0 OR DATALENGTH(@ReconciliationReason)>1000))
            THROW 52002, 'Invalid movement input.', 1;
        BEGIN TRANSACTION;
        EXEC gp._TakeLock N'gp:authorization','Shared';
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        -- Every employee project credential shares the same serialization gate,
        -- including the hosted-pass path reached through RecordGuardDutyMovement.
        DECLARE @movementEmployee nvarchar(64),@employeeLock nvarchar(255);
        SELECT @movementEmployee=EmployeeId FROM gp.VisitRequests WHERE VisitRequestId=@VisitRequestId AND RequestType='EMPLOYEE_PROJECT';
        IF @movementEmployee IS NOT NULL
        BEGIN
            SET @employeeLock=N'gp:employee-project:'+CONVERT(varchar(64),HASHBYTES('SHA2_256',@movementEmployee),2);
            EXEC gp._TakeLock @employeeLock;
        END;
        DECLARE @payload nvarchar(max)=(SELECT @VisitRequestId AS visitId,@AccessPassId AS passId,@LocationId AS locationId,
            @SelectedProjectLocationId AS selectedProjectLocationId,@EventType AS eventType,@EntryMethod AS method,CONVERT(varchar(64),@CredentialHash,2) AS credentialHash,
            @OccurredAtUtc AS occurredAtUtc,@ReconciliationReason AS reason FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER);
        EXEC gp._BeginOperation @actor,'RECORD_MOVEMENT',@ClientKey,@payload,@op OUTPUT,@cached OUTPUT;
        DECLARE @lock nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@VisitRequestId));
        EXEC gp._TakeLock @lock;
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        DECLARE @location int,@pair bigint,@type varchar(24),@state varchar(12),@start datetime2(3),@end datetime2(3),
            @employee nvarchar(64),@photo uniqueidentifier,@purged datetime2(3),@passState varchar(12),@current bit,@storedHash varbinary(32);
        SELECT @location=LocationId,@pair=ProjectLocationId,@type=RequestType,@state=Status,@start=ValidFromUtc,@end=ValidUntilUtc,
            @employee=EmployeeId,@photo=PhotoAssetId,@purged=PersonalDataPurgedAtUtc
        FROM gp.VisitRequests WITH(UPDLOCK) WHERE VisitRequestId=@VisitRequestId;
        IF @location IS NULL OR @location<>@LocationId THROW 52001, 'Not authorized.', 1;
        -- Project selection is explicit input and is never inferred from the QR.
        -- Office-only Digital ID and project movement are distinct contexts.
        IF (@EntryMethod<>'RECONCILE' AND ((@pair IS NOT NULL AND (@SelectedProjectLocationId IS NULL OR @SelectedProjectLocationId<>@pair))
            OR (@pair IS NULL AND @SelectedProjectLocationId IS NOT NULL)))
            OR (@EntryMethod='RECONCILE' AND @SelectedProjectLocationId IS NOT NULL AND (@pair IS NULL OR @SelectedProjectLocationId<>@pair))
            THROW 52001,'Not authorized for the selected work context.',1;
        DECLARE @capability varchar(40)=CASE WHEN @EntryMethod='RECONCILE' THEN 'RECONCILE_EXIT'
            WHEN @type='TEMP_ID' THEN 'TEMP_ID_MOVEMENT' ELSE 'PROJECT_MOVEMENT' END;
        IF gp._HasCapability(@actor,@capability,@location,@pair,1,@now)=0 THROW 52001, 'Not authorized.', 1;
        IF @EntryMethod<>'RECONCILE' AND @pair IS NOT NULL AND NOT EXISTS(
            SELECT 1 FROM gp.GuardAssignments WHERE GuardUserId=@actor AND ProjectLocationId=@pair
            AND DeallocatedAtUtc IS NULL AND ValidFromUtc<=@now AND (ValidUntilUtc IS NULL OR @now<ValidUntilUtc))
            THROW 52001, 'Not authorized.', 1;
        SELECT @passState=Status,@current=IsCurrent,@storedHash=CredentialHash FROM gp.AccessPasses WITH(UPDLOCK)
            WHERE AccessPassId=@AccessPassId AND VisitRequestId=@VisitRequestId;
        IF @passState IS NULL OR (@EntryMethod='SCAN' AND @storedHash<>@CredentialHash)
            THROW 52001, 'Not authorized.', 1;
        IF @EventType='ENTRY' AND @type='TEMP_ID'
        BEGIN
            DECLARE @entryCutoff datetime2(3);EXEC gp._DirectoryCutoff @now,@entryCutoff OUTPUT;
            IF gp._EmployeeOfficeEligible(@employee,@location,@entryCutoff,@now)=0 THROW 52004,'Current employee office entitlement required.',1;
        END;
        IF @type='TEMP_ID' AND @EventType='ENTRY' THROW 52001,'Select an assigned project duty for employee movement.',1;
        IF @EventType='ENTRY' AND EXISTS(SELECT 1 FROM gp.PassReturns WHERE VisitRequestId=@VisitRequestId) THROW 52005,'Returned pass is closed.',1;
        IF @cached IS NOT NULL
        BEGIN
            COMMIT;
            SELECT @cached AS ResultJson;
            RETURN;
        END;
        IF @EntryMethod<>'RECONCILE'
        BEGIN
            IF @current<>1 OR @passState<>'ACTIVE' OR @state<>'APPROVED'
                THROW 52005, 'Credential cannot perform this movement; use authorized exit reconciliation where required.', 1;
            IF NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@location AND IsActive=1)
               OR (@pair IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId
                   WHERE pl.ProjectLocationId=@pair AND pl.IsActive=1 AND p.IsActive=1))
                THROW 52005, 'Target inactive; authorized exit reconciliation may be required.', 1;
        END;
        IF @EventType='ENTRY'
        BEGIN
            IF @now<@start OR @now>=@end OR @purged IS NOT NULL
               OR NOT EXISTS(SELECT 1 FROM gp.PhotoAssets WHERE PhotoAssetId=@photo AND PurgedAtUtc IS NULL AND StorageKey IS NOT NULL)
                THROW 52005, 'Visit is not enterable.', 1;
            IF @employee IS NOT NULL
            BEGIN
                DECLARE @cutoff datetime2(3);
                EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
                IF (@type='TEMP_ID' AND gp._EmployeeOfficeEligible(@employee,@location,@cutoff,@now)=0) OR NOT EXISTS(SELECT 1 FROM gp.Employees WHERE EmployeeId=@employee AND IsActive=1 AND LastSyncedAtUtc BETWEEN @cutoff AND @now)
                    THROW 52004, 'Current employee state must be verified.', 1;
            END;
        END;
        IF @EventType='ENTRY' AND @type='EMPLOYEE_PROJECT' AND gp._EmployeeProjectOccupied(@employee,@pair)=1
            THROW 52005,'Employee already inside this project; close the original entry first.',1;
        DECLARE @inside bit,@last datetime2(3),@occurred datetime2(3);
        SELECT @inside=IsInside,@last=LastMovementAtUtc FROM gp.VisitPresence WITH(UPDLOCK) WHERE VisitRequestId=@VisitRequestId;
        IF @inside IS NULL OR (@EventType='ENTRY' AND @inside=1) OR (@EventType='EXIT' AND @inside=0)
            THROW 52005, 'Movement conflicts with current presence.', 1;
        SET @occurred=CASE WHEN @EntryMethod='RECONCILE' THEN COALESCE(@OccurredAtUtc,@now) ELSE @now END;
        IF @occurred>@now OR (@last IS NOT NULL AND @occurred<@last)
            THROW 52002, 'Movement chronology invalid.', 1;
        INSERT gp.AccessEvents(VisitRequestId,AccessPassId,ActorUserId,LocationId,EventType,EntryMethod,OperationId,OccurredAtUtc,RecordedAtUtc,ReconciliationReason)
        VALUES(@VisitRequestId,@AccessPassId,@actor,@location,@EventType,@EntryMethod,@op,@occurred,@now,@ReconciliationReason);
        DECLARE @event bigint=CONVERT(bigint,SCOPE_IDENTITY());
        UPDATE gp.VisitPresence SET IsInside=CASE WHEN @EventType='ENTRY' THEN 1 ELSE 0 END,
            LastAccessEventId=@event,LastMovementAtUtc=@occurred WHERE VisitRequestId=@VisitRequestId;
        SET @result=(SELECT @op AS operationId,@VisitRequestId AS visitRequestId,@event AS accessEventId,
            CONVERT(varchar(20),@pair) AS projectLocationId,@EventType AS eventType,CONVERT(bit,CASE WHEN @EventType='ENTRY' THEN 1 ELSE 0 END) AS isInside FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode,MetadataJson)
        VALUES(@actor,'MOVEMENT_RECORDED','VISIT',CONVERT(varchar(36),@VisitRequestId),@location,@pair,'SUCCESS',@result);
        EXEC gp._CompleteOperation @op,@result;
        COMMIT;
        SELECT @result AS ResultJson;
    END TRY
    BEGIN CATCH
        DECLARE @error int=ERROR_NUMBER(),@target varchar(100)=CONVERT(varchar(36),@VisitRequestId);
        IF @@TRANCOUNT>0 ROLLBACK;
        EXEC gp._AuditFailure @actor,'MOVEMENT_FAILED',@target,@error;
        THROW;
    END CATCH;
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
 IF @employee IS NOT NULL
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
 IF @EventType='ENTRY' AND gp._EmployeeProjectOccupied(@employee,@DutyId)=1 THROW 52005,'Employee already inside this project.',1;
 IF @EventType='ENTRY' AND(@now<@start OR @now>=@end OR NOT EXISTS(SELECT 1 FROM gp.VisitRequests v JOIN gp.PhotoAssets p ON p.PhotoAssetId=v.PhotoAssetId WHERE v.VisitRequestId=@VisitRequestId AND v.PersonalDataPurgedAtUtc IS NULL AND p.PurgedAtUtc IS NULL AND p.StorageKey IS NOT NULL AND p.ContentHash IS NOT NULL)) THROW 52005,'Visit is not enterable.',1;
 IF @EventType='ENTRY' AND NOT EXISTS(SELECT 1 FROM gp.EmployeeProjectPresence WHERE VisitRequestId=@VisitRequestId AND ProjectLocationId=@DutyId) INSERT gp.EmployeeProjectPresence(VisitRequestId,ProjectLocationId,EmployeeId) VALUES(@VisitRequestId,@DutyId,@employee);
 SELECT @inside=IsInside,@last=LastMovementAtUtc FROM gp.EmployeeProjectPresence WITH(UPDLOCK) WHERE VisitRequestId=@presenceVisit AND ProjectLocationId=@DutyId;
 IF(@EventType='ENTRY' AND @inside=1) OR(@EventType='EXIT' AND COALESCE(@inside,0)=0) THROW 52005,'Movement conflicts with project presence.',1;
 INSERT gp.EmployeeProjectAccessEvents(VisitRequestId,ProjectLocationId,AccessPassId,ActorUserId,OperationId,EventType,EntryMethod,OccurredAtUtc,Reason,PresentedVisitRequestId)
 VALUES(@presenceVisit,@DutyId,@AccessPassId,@actor,@op,@EventType,@EntryMethod,@now,@Reason,@VisitRequestId);SET @event=CONVERT(bigint,SCOPE_IDENTITY());
 UPDATE gp.EmployeeProjectPresence SET IsInside=CASE WHEN @EventType='ENTRY' THEN 1 ELSE 0 END,LastEventId=@event,LastMovementAtUtc=@now WHERE VisitRequestId=@presenceVisit AND ProjectLocationId=@DutyId;
 SET @result=(SELECT @op operationId,@VisitRequestId visitRequestId,@event accessEventId,CONVERT(varchar(20),@DutyId) projectLocationId,@EventType eventType,CONVERT(bit,CASE WHEN @EventType='ENTRY' THEN 1 ELSE 0 END) isInside FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode,MetadataJson) VALUES(@actor,'PROJECT_MOVEMENT','VISIT',CONVERT(varchar(36),@VisitRequestId),@LocationId,@DutyId,'SUCCESS',@result);
 EXEC gp._CompleteOperation @op,@result;COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
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
   ELSE IF @inside=0 AND gp._EmployeeProjectLocationEligible(@employee,@Duty,@cutoff,@Now)=1 AND JSON_VALUE(@Result,'$.photoAvailable')='true'
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
 -- Read advice follows the same person/project occupancy rule as both writers.
 IF @Kind='PROJECT' AND @employee IS NOT NULL AND @enter=1 AND gp._EmployeeProjectOccupied(@employee,@Duty)=1 SET @enter=0;
 SET @Result=JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(@Result,'$.canEnter',@enter),'$.canExit',@exit),'$.canReconcileExit',CONVERT(bit,CASE WHEN @Kind='PROJECT' AND ((@type='TEMP_ID' AND @inside=1 AND @exit=0 AND gp._HasCapability(@Actor,'RECONCILE_EXIT',@Location,@Duty,1,@Now)=1) OR (@type<>'TEMP_ID' AND JSON_VALUE(@Result,'$.canReconcileExit')='true')) THEN 1 ELSE 0 END));
 SET @Result=JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(@Result,'$.dutyKind',@Kind),'$.dutyId',CONVERT(varchar(20),@Duty)),'$.verificationOnly',CONVERT(bit,CASE WHEN @Kind='COMMON' THEN 1 ELSE 0 END)),'$.commonAccessAllowed',@common);
END;
GO
ALTER PROCEDURE gp.ReadAdminVisitRegister
 @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@FromDate date,@ToDate date,
 @ProjectLocationId bigint=NULL,@FiltersJson nvarchar(max)=N'{}',@Sort nvarchar(200)=N'submittedAtUtc',@Direction nvarchar(200)=N'DESC',@Page int=1,@ForExport bit=0
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 54600,'Ambient transaction not accepted.',1;
 DECLARE @fields table(name nvarchar(200) COLLATE Latin1_General_100_BIN2 PRIMARY KEY);
 INSERT @fields VALUES ('localVisitDate'),('submittedAtUtc'),('personName'),('employeeId'),('personEmail'),('personPhone'),('companyName'),('deviceTypes'),('locationName'),('projectName'),('hostName'),('hostEmail'),('requestType'),('reason'),('publicReference'),('publicPassNumber'),('status'),('passStatus'),('presence'),('printStatus'),('returnedAtUtc'),('validFromUtc'),('validUntilUtc'),('firstEntryAtUtc'),('lastEntryAtUtc'),('lastExitAtUtc');
 IF @LocationId IS NULL OR @LocationId<=0 OR @ProjectLocationId<=0 OR @FromDate IS NULL OR @ToDate IS NULL OR @FromDate>@ToDate OR DATEDIFF(day,@FromDate,@ToDate)>30
 OR @ForExport IS NULL OR @Page IS NULL OR @Page<1 OR @Page>100000 OR @Sort IS NULL OR NOT EXISTS(SELECT 1 FROM @fields WHERE name=@Sort COLLATE Latin1_General_100_BIN2 AND DATALENGTH(name)=DATALENGTH(@Sort))
 OR @Direction IS NULL OR @Direction COLLATE Latin1_General_100_BIN2 NOT IN(N'ASC',N'DESC') OR DATALENGTH(@Direction) NOT IN(6,8)
 OR @FiltersJson IS NULL OR DATALENGTH(@FiltersJson)>16000 OR ISJSON(@FiltersJson)<>1 OR LEFT(LTRIM(@FiltersJson),1)<>N'{' THROW 52002,'Invalid register query.',1;
 DECLARE @filters table(name nvarchar(200) COLLATE Latin1_General_100_BIN2 PRIMARY KEY,value nvarchar(200));
 IF EXISTS(SELECT 1 FROM OPENJSON(@FiltersJson) j WHERE j.type<>1 OR LEN(j.value)=0 OR DATALENGTH(j.value)>400 OR DATALENGTH(j.value)<>DATALENGTH(LTRIM(RTRIM(j.value))) OR NOT EXISTS(SELECT 1 FROM @fields f WHERE f.name=j.[key] COLLATE Latin1_General_100_BIN2 AND DATALENGTH(f.name)=DATALENGTH(j.[key])))
 OR EXISTS(SELECT 1 FROM OPENJSON(@FiltersJson) GROUP BY [key] COLLATE Latin1_General_100_BIN2 HAVING COUNT(*)>1) THROW 52002,'Invalid register filters.',1;
 INSERT @filters SELECT [key],value FROM OPENJSON(@FiltersJson);
 IF EXISTS(SELECT 1 FROM @filters WHERE (name='status' AND value COLLATE Latin1_General_100_BIN2 NOT IN('PENDING','APPROVED','DENIED','CANCELLED'))
 OR(name='requestType' AND value COLLATE Latin1_General_100_BIN2 NOT IN('DIGITAL_ID','EMPLOYEE_PROJECT','EXTERNAL'))
 OR(name='passStatus' AND value COLLATE Latin1_General_100_BIN2 NOT IN('PENDING','ACTIVE','DENIED','REVOKED'))
 OR(name='presence' AND value COLLATE Latin1_General_100_BIN2 NOT IN('INSIDE','OUTSIDE'))
 OR(name='printStatus' AND value COLLATE Latin1_General_100_BIN2 NOT IN('NOT_PRINTED','PRINTED','RETURNED'))
 OR(name='deviceTypes' AND value COLLATE Latin1_General_100_BIN2 NOT IN('LAPTOP','TABLET','PEN_DRIVE','CAMERA','OTHER'))) THROW 52002,'Invalid register filters.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@result nvarchar(max),@total int,@rows nvarchar(max);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 IF NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@LocationId AND IsActive=1)
 OR gp._AdminScopeAllowed(@actor,'VISITS_READ',@LocationId,@ProjectLocationId,@now)=0
 OR(@ForExport=1 AND gp._AdminScopeAllowed(@actor,'REPORTS_EXPORT',@LocationId,@ProjectLocationId,@now)=0)
 OR(@ProjectLocationId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gp.ProjectLocations WHERE ProjectLocationId=@ProjectLocationId AND LocationId=@LocationId AND IsActive=1)) THROW 52001,'Not authorized.',1;
 EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 SELECT v.VisitRequestId visitRequestId,CONVERT(char(10),v.LocalVisitDate,23) localVisitDate,
 REPLACE(CONVERT(char(23),v.SubmittedAtUtc,121),' ','T')+'Z' submittedAtUtc,
 v.PersonName personName,v.EmployeeId employeeId,v.PersonEmail personEmail,v.PersonPhone personPhone,v.CompanyName companyName,
 COALESCE((SELECT STRING_AGG(CONVERT(nvarchar(max),j.value),N', ') WITHIN GROUP(ORDER BY j.value) FROM OPENJSON(v.DeviceTypesJson) j),N'') deviceTypes,
 l.LocationName locationName,pj.ProjectName projectName,h.FullName hostName,h.OfficialEmail hostEmail,
 CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END requestType,v.Reason reason,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,
 v.Status status,p.Status passStatus,CASE WHEN (CASE WHEN v.RequestType='TEMP_ID' THEN gp._PersonInsideOffice(v.VisitRequestId) ELSE vp.IsInside END)=1 THEN 'INSIDE' ELSE 'OUTSIDE' END presence,
 CASE WHEN ret.VisitRequestId IS NOT NULL THEN 'RETURNED' WHEN EXISTS(SELECT 1 FROM gp.PassPrintJobs j WHERE j.VisitRequestId=v.VisitRequestId AND j.Status='DISPATCHED') THEN 'PRINTED' ELSE 'NOT_PRINTED' END printStatus,
 REPLACE(CONVERT(char(23),ret.ReturnedAtUtc,121),' ','T')+'Z' returnedAtUtc,
 REPLACE(CONVERT(char(23),v.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc
  ,REPLACE(CONVERT(char(23),mv.firstEntry,121),' ','T')+'Z' firstEntryAtUtc,REPLACE(CONVERT(char(23),mv.lastEntry,121),' ','T')+'Z' lastEntryAtUtc,REPLACE(CONVERT(char(23),mv.lastExit,121),' ','T')+'Z' lastExitAtUtc
 INTO #register FROM gp.VisitRequests v JOIN gp.VisitPresence vp ON vp.VisitRequestId=v.VisitRequestId JOIN gp.Locations l ON l.LocationId=v.LocationId
 JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1
 LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId LEFT JOIN gp.Projects pj ON pj.ProjectId=pl.ProjectId
 LEFT JOIN gp.Employees h ON h.EmployeeId=v.HostEmployeeId LEFT JOIN gp.PassReturns ret ON ret.VisitRequestId=v.VisitRequestId
 OUTER APPLY(SELECT MIN(CASE WHEN e.EventType='ENTRY' THEN e.OccurredAtUtc END) firstEntry,MAX(CASE WHEN e.EventType='ENTRY' THEN e.OccurredAtUtc END) lastEntry,MAX(CASE WHEN e.EventType='EXIT' THEN e.OccurredAtUtc END) lastExit FROM(
 SELECT a.EventType,a.OccurredAtUtc FROM gp.AccessEvents a WHERE a.VisitRequestId=v.VisitRequestId
 UNION ALL SELECT a.EventType,a.OccurredAtUtc FROM gp.EmployeeProjectAccessEvents a JOIN gp.ProjectLocations ep ON ep.ProjectLocationId=a.ProjectLocationId
 WHERE (a.VisitRequestId=v.VisitRequestId OR a.PresentedVisitRequestId=v.VisitRequestId) AND ep.LocationId=v.LocationId AND(v.RequestType='TEMP_ID' OR a.ProjectLocationId=v.ProjectLocationId)) e) mv
 WHERE v.LocationId=@LocationId AND v.LocalVisitDate BETWEEN @FromDate AND @ToDate AND(@ProjectLocationId IS NULL OR v.ProjectLocationId=@ProjectLocationId)
 AND v.PersonalDataPurgedAtUtc IS NULL AND gp._VisitReadAllowed(@actor,'ADMIN',v.VisitRequestId,@now,@cutoff)=1;
 DELETE r FROM #register r WHERE EXISTS(SELECT 1 FROM @filters f WHERE NOT EXISTS(
 SELECT 1 FROM (VALUES (N'localVisitDate',CONVERT(nvarchar(max),r.localVisitDate)),(N'submittedAtUtc',CONVERT(nvarchar(max),r.submittedAtUtc)),(N'personName',CONVERT(nvarchar(max),r.personName)),(N'employeeId',CONVERT(nvarchar(max),r.employeeId)),(N'personEmail',CONVERT(nvarchar(max),r.personEmail)),(N'personPhone',CONVERT(nvarchar(max),r.personPhone)),(N'companyName',CONVERT(nvarchar(max),r.companyName)),(N'deviceTypes',CONVERT(nvarchar(max),r.deviceTypes)),(N'locationName',CONVERT(nvarchar(max),r.locationName)),(N'projectName',CONVERT(nvarchar(max),r.projectName)),(N'hostName',CONVERT(nvarchar(max),r.hostName)),(N'hostEmail',CONVERT(nvarchar(max),r.hostEmail)),(N'requestType',CONVERT(nvarchar(max),r.requestType)),(N'reason',CONVERT(nvarchar(max),r.reason)),(N'publicReference',CONVERT(nvarchar(max),r.publicReference)),(N'publicPassNumber',CONVERT(nvarchar(max),r.publicPassNumber)),(N'status',CONVERT(nvarchar(max),r.status)),(N'passStatus',CONVERT(nvarchar(max),r.passStatus)),(N'presence',CONVERT(nvarchar(max),r.presence)),(N'printStatus',CONVERT(nvarchar(max),r.printStatus)),(N'returnedAtUtc',CONVERT(nvarchar(max),r.returnedAtUtc)),(N'validFromUtc',CONVERT(nvarchar(max),r.validFromUtc)),(N'validUntilUtc',CONVERT(nvarchar(max),r.validUntilUtc)),(N'firstEntryAtUtc',CONVERT(nvarchar(max),r.firstEntryAtUtc)),(N'lastEntryAtUtc',CONVERT(nvarchar(max),r.lastEntryAtUtc)),(N'lastExitAtUtc',CONVERT(nvarchar(max),r.lastExitAtUtc))) c(name,value)
 WHERE c.name COLLATE Latin1_General_100_BIN2=f.name AND ((f.name IN('status','passStatus','requestType','presence','printStatus') AND c.value COLLATE Latin1_General_100_BIN2=f.value COLLATE Latin1_General_100_BIN2) OR(f.name NOT IN('status','passStatus','requestType','presence','printStatus') AND CHARINDEX(f.value COLLATE Latin1_General_100_CI_AS,COALESCE(c.value,N'') COLLATE Latin1_General_100_CI_AS)>0))));
 SELECT @total=COUNT(*) FROM #register;
 DECLARE @datasetVersion varchar(64)=NULL;
 IF @ForExport=1
 BEGIN
  IF @total>10000 THROW 52002,'Narrow the export range.',1;
  -- Row digests include every exported value; the ordered aggregate is bounded to 10,000 hashes.
  SELECT @datasetVersion=LOWER(CONVERT(varchar(64),HASHBYTES('SHA2_256',COALESCE(
   STRING_AGG(CONVERT(varchar(max),CONVERT(varchar(64),HASHBYTES('SHA2_256',j.data),2)),',') WITHIN GROUP(ORDER BY r.visitRequestId),'')),2))
  FROM #register r CROSS APPLY(SELECT (SELECT r.* FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER) data) j;
 END;
 -- Only names from the fixed projection and a validated direction reach this statement. Filter values remain data.
 DECLARE @sql nvarchar(max)=N'SET @rows=COALESCE((SELECT * FROM #register ORDER BY '+QUOTENAME(@Sort)+N' '+@Direction+N',visitRequestId ASC OFFSET @offset ROWS FETCH NEXT 50 ROWS ONLY FOR JSON PATH,INCLUDE_NULL_VALUES),N''[]'');';
 DECLARE @offset int=(@Page-1)*50;
 EXEC sys.sp_executesql @sql,N'@offset int,@rows nvarchar(max) OUTPUT',@offset,@rows OUTPUT;
 SET @result=(SELECT JSON_QUERY(@rows) rows,@total total,@Page page,50 pageSize,@datasetVersion datasetVersion,REPLACE(CONVERT(char(23),@now,121),' ','T')+'Z' checkedAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,LocationId,ProjectLocationId,ResultCode) VALUES(@actor,CASE WHEN @ForExport=1 THEN 'ADMIN_REGISTER_EXPORTED' ELSE 'ADMIN_REGISTER_READ' END,'ADMIN_QUERY',@LocationId,@ProjectLocationId,'SUCCESS');
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
ALTER PROCEDURE gp.GetAdminConsoleScope @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@ProjectLocationId bigint=NULL
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 54600,'Ambient transaction not accepted.',1;
 IF @LocationId IS NULL OR @LocationId<=0 OR @ProjectLocationId<=0 THROW 52002,'Invalid scope.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@result nvarchar(max);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 IF @ProjectLocationId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gp.ProjectLocations WHERE ProjectLocationId=@ProjectLocationId AND LocationId=@LocationId AND IsActive=1) THROW 52001,'Not authorized.',1;
 IF NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@LocationId AND IsActive=1) OR gp._LeadWorkspaceScope(@actor,@LocationId,@ProjectLocationId,@now)=0 THROW 52001,'Not authorized.',1;
 SET @result=(SELECT @actor userId,CONVERT(date,DATEADD(minute,330,@now)) currentDate,
 gp._AdminScopeAllowed(@actor,'REPORTS_READ',@LocationId,@ProjectLocationId,@now) canReport,
 gp._AdminScopeAllowed(@actor,'VISITS_READ',@LocationId,@ProjectLocationId,@now) canReadVisits,
 gp._AdminScopeAllowed(@actor,'REPORTS_EXPORT',@LocationId,@ProjectLocationId,@now) canExport,
 gp._AdminScopeAllowed(@actor,'AUDIT_READ',@LocationId,@ProjectLocationId,@now) canAudit,
 gp._AdminScopeAllowed(@actor,'GUARDS_MANAGE',@LocationId,@ProjectLocationId,@now) canAssignGuards,
 gp._AdminScopeAllowed(@actor,'ROLE_GRANTS_MANAGE',@LocationId,@ProjectLocationId,@now) canManageRoles,
 JSON_QUERY(COALESCE((SELECT code roleCode FROM(VALUES('GUARD'),('RECEPTION'),('LOCATION_ADMIN'),('INDIA_ADMIN'),('PLATFORM_ADMIN')) available(code) WHERE gp._CanProvisionStaff(@actor,code,@LocationId,@now)=1 FOR JSON PATH),N'[]')) provisionableRoles,
 gp._AdminScopeAllowed(@actor,'STAFF_CREDENTIALS_MANAGE',@LocationId,NULL,@now) canResetLocalStaff,
 JSON_QUERY(COALESCE((SELECT r.RoleCode roleCode,r.ScopeType scopeType,CASE WHEN r.ScopeType='PROJECT' THEN 'PROJECT' WHEN r.ScopeType='PROJECT_LOCATION' THEN 'PROJECT_LOCATION' ELSE r.ScopeType END label
 FROM gp.StaffRoleGrants r WHERE r.UserId=@actor AND r.RevokedAtUtc IS NULL AND r.ValidFromUtc<=@now AND(r.ValidUntilUtc IS NULL OR @now<r.ValidUntilUtc) FOR JSON PATH),N'[]')) roles,
 JSON_QUERY(COALESCE((SELECT code roleCode,scope scopeType FROM (VALUES('GUARD','LOCATION'),('RECEPTION','LOCATION'),('LOCATION_ADMIN','LOCATION'),('PROJECT_ADMIN','PROJECT_LOCATION'),('PROJECT_ADMIN','PROJECT'),('INDIA_ADMIN','INDIA'),('PLATFORM_ADMIN','PLATFORM')) x(code,scope)
 WHERE gp._StaffRoleDelegationAllowed(@actor,code,scope,CASE WHEN scope='LOCATION' THEN @LocationId END,CASE WHEN scope='PROJECT' THEN (SELECT ProjectId FROM gp.ProjectLocations WHERE ProjectLocationId=@ProjectLocationId) END,CASE WHEN scope='PROJECT_LOCATION' THEN @ProjectLocationId END,@now)=1
 AND(scope NOT IN('PROJECT','PROJECT_LOCATION') OR @ProjectLocationId IS NOT NULL) FOR JSON PATH),N'[]')) delegations
 FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('099',N'Cross-credential employee project occupancy and explicit register export authority');COMMIT;
