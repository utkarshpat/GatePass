/* Final return also fences legacy entry retries; index the distinct printed-visit queue. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54500,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='071') THROW 54500,'Migration 071 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='072') THROW 54500,'Migration 072 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
CREATE INDEX IX_PassPrintJobs_DispatchedVisit ON gp.PassPrintJobs(VisitRequestId) WHERE Status='DISPATCHED';
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
INSERT gp.SchemaMigrations(Version,Description) VALUES('072',N'Final return entry replay fence and printed visit queue index');COMMIT;
