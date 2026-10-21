/* Visitor identity cards at reception and explicit selected-project guard actions.
   Forward-only change to 003/010/011; no new floor/zone/checkpoint inventory. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53200,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='011') THROW 53200,'Migration 011 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='012') THROW 53200,'Migration 012 already applied.',1;
BEGIN TRANSACTION;
EXEC gp._TakeLock N'gp:authorization','Exclusive';
-- Outstanding artifacts from the previous card policy must be rendered afresh.
UPDATE r SET ClaimToken=NULL,LeaseUntilUtc=NULL,FailureCode='RENDER_FAILED'
FROM gp.PassPrintRenderState r JOIN gp.PassPrintJobs j ON j.PrintJobId=r.PrintJobId
WHERE j.Status IN('REQUESTED','RENDERED');
UPDATE gp.PassPrintJobs SET Status='FAILED',UpdatedAtUtc=SYSUTCDATETIME() WHERE Status IN('REQUESTED','RENDERED');
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
                IF NOT EXISTS(SELECT 1 FROM gp.Employees WHERE EmployeeId=@employee AND IsActive=1 AND LastSyncedAtUtc BETWEEN @cutoff AND @now)
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
ALTER PROCEDURE gp.VerifyGuardPass
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@CredentialHash varbinary(8000),@CorrelationId uniqueidentifier,@SelectedProjectLocationId bigint=NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 52800,'Ambient transaction not accepted.',1;
    IF (@SelectedProjectLocationId IS NOT NULL AND @SelectedProjectLocationId<=0) OR @LocationId IS NULL OR @LocationId<=0 OR @CredentialHash IS NULL OR DATALENGTH(@CredentialHash)<>32 OR @CorrelationId IS NULL THROW 52802,'Invalid scan input.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@visit uniqueidentifier,@pass uniqueidentifier,@location int,@passState varchar(12),@current bit,
        @state varchar(12),@from datetime2(3),@until datetime2(3),@outcome varchar(32),@detail nvarchar(max),@result nvarchar(max);
    BEGIN TRY
        BEGIN TRANSACTION; EXEC gp._TakeLock N'gp:authorization','Shared'; EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        IF NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='VISITS_READ'
            WHERE g.UserId=@actor AND g.RoleCode='GUARD' AND g.ScopeType='LOCATION' AND g.LocationId=@LocationId AND g.RevokedAtUtc IS NULL
            AND g.ValidFromUtc<=@now AND (g.ValidUntilUtc IS NULL OR @now<g.ValidUntilUtc)) THROW 52801,'Not authorized.',1;
        SELECT @visit=VisitRequestId,@pass=AccessPassId FROM gp.AccessPasses WHERE CredentialHash=@CredentialHash;
        IF @visit IS NOT NULL
        BEGIN
            DECLARE @lock nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@visit)); EXEC gp._TakeLock @lock,'Shared';
            EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT; EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
            SELECT @location=LocationId FROM gp.VisitRequests WHERE VisitRequestId=@visit
                AND ((ProjectLocationId=@SelectedProjectLocationId) OR (ProjectLocationId IS NULL AND @SelectedProjectLocationId IS NULL));
            IF @location IS NULL OR @location<>@LocationId OR gp._VisitReadAllowed(@actor,'GUARD',@visit,@now,@cutoff)=0 SET @visit=NULL;
        END;
        IF @visit IS NULL
        BEGIN
            -- Unknown and known-out-of-scope credentials have identical responses
            -- and unlinked logs. Correlation is tracing only, never a replay receipt.
            INSERT gp.PassScanAttempts(ActorUserId,LocationId,OutcomeCode,CorrelationId) VALUES(@actor,@LocationId,'NOT_AUTHORIZED',@CorrelationId);
            SET @result=N'{"outcome":"NOT_AVAILABLE"}';
        END
        ELSE
        BEGIN
            EXEC gp._VisitReadJson @actor,'GUARD',@visit,@now,@detail OUTPUT;
            SELECT @passState=p.Status,@current=p.IsCurrent,@state=v.Status,@from=v.ValidFromUtc,@until=v.ValidUntilUtc
                FROM gp.AccessPasses p JOIN gp.VisitRequests v ON v.VisitRequestId=p.VisitRequestId WHERE p.AccessPassId=@pass;
            SET @outcome=CASE WHEN @current=0 OR @passState='REVOKED' THEN 'REVOKED' WHEN @state='CANCELLED' THEN 'CANCELLED'
                WHEN @state='DENIED' OR @passState='DENIED' THEN 'DENIED' WHEN @state='PENDING' OR @passState='PENDING' THEN 'PENDING'
                WHEN @now>=@until THEN 'EXPIRED' WHEN @now<@from THEN 'NOT_YET_VALID'
                WHEN JSON_VALUE(@detail,'$.canEnter')='true' OR JSON_VALUE(@detail,'$.canExit')='true' THEN 'VALID' ELSE 'NOT_AUTHORIZED' END;
            -- A stale printed QR never suggests a normal action on its replacement.
            IF @current=0 OR @passState='REVOKED' SET @detail=JSON_MODIFY(JSON_MODIFY(@detail,'$.canEnter',CONVERT(bit,0)),'$.canExit',CONVERT(bit,0));
            INSERT gp.PassScanAttempts(AccessPassId,VisitRequestId,ActorUserId,LocationId,OutcomeCode,CorrelationId)
                VALUES(@pass,@visit,@actor,@LocationId,@outcome,@CorrelationId);
            SET @result=(SELECT @outcome outcome,JSON_QUERY(@detail) visit FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        END;
        COMMIT; SELECT @result;
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH;
END;
GO
ALTER PROCEDURE gp.BeginPassRender
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@PrintJobId uniqueidentifier,@ClaimToken uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON;SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 53100,'Ambient transaction not accepted.',1;
    IF @PrintJobId IS NULL OR @ClaimToken IS NULL THROW 53102,'Invalid render claim.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@visit uniqueidentifier,@pass uniqueidentifier,@result nvarchar(max),@claim uniqueidentifier,@lease datetime2(3),@attempt int;
    BEGIN TRY
        BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';
        EXEC gp._RequirePrintJob @SessionHash,@CsrfHash,@PrintJobId,@actor OUTPUT,@now OUTPUT,@visit OUTPUT,@pass OUTPUT;
        EXEC gp._RequirePrintablePass @visit,@pass,@now;
        IF NOT EXISTS(SELECT 1 FROM gp.PassPrintJobs WHERE PrintJobId=@PrintJobId AND Status='REQUESTED') THROW 53105,'Job cannot render.',1;
        SELECT @claim=ClaimToken,@lease=LeaseUntilUtc,@attempt=AttemptCount FROM gp.PassPrintRenderState WHERE PrintJobId=@PrintJobId;
        IF @lease>@now AND @claim<>@ClaimToken THROW 53103,'Render already in progress.',1;
        IF @lease<=@now AND @claim=@ClaimToken THROW 53103,'Expired claim requires a fresh fencing token.',1;
        IF @claim IS NULL OR @lease<=@now
        BEGIN
            IF @attempt>=3
            BEGIN
                UPDATE gp.PassPrintJobs SET Status='FAILED',UpdatedAtUtc=@now WHERE PrintJobId=@PrintJobId;
                UPDATE gp.PassPrintRenderState SET ClaimToken=NULL,LeaseUntilUtc=NULL,FailureCode='ATTEMPTS_EXHAUSTED' WHERE PrintJobId=@PrintJobId;
                INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode) VALUES(@actor,'PASS_RENDER_EXHAUSTED','VISIT',CONVERT(varchar(36),@visit),'SUCCESS');
                COMMIT;SELECT N'{"status":"FAILED","failureCode":"ATTEMPTS_EXHAUSTED"}';RETURN;
            END;
            UPDATE r SET ClaimToken=@ClaimToken,LeaseUntilUtc=DATEADD(second,60,@now),AttemptCount=AttemptCount+1,
                SourceVisitStatus=v.Status,SourceSnapshotHash=v.SnapshotHash,SourcePhotoHash=a.ContentHash,ArtifactDigest=NULL,FailureCode=NULL
                FROM gp.PassPrintRenderState r JOIN gp.PassPrintJobs j ON j.PrintJobId=r.PrintJobId JOIN gp.VisitRequests v ON v.VisitRequestId=j.VisitRequestId
                JOIN gp.PhotoAssets a ON a.PhotoAssetId=v.PhotoAssetId WHERE r.PrintJobId=@PrintJobId;
        END;
        -- Both pending and approved cards identify the individual; live project authorization remains separate.
        SET @result=(SELECT j.PrintJobId printJobId,v.VisitRequestId visitRequestId,p.AccessPassId accessPassId,v.PersonName personName,
            CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END requestType,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,
            v.Status visitStatus,l.LocationName locationName,pj.ProjectName projectName,
            REPLACE(CONVERT(char(23),v.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc,
            a.PhotoAssetId photoAssetId,a.StorageKey storageKey,CONVERT(varchar(64),a.ContentHash,2) photoContentHash,a.MimeType mimeType,a.ByteLength byteLength,
            CONVERT(varchar(64),p.CredentialHash,2) credentialHash,
            CONVERT(varchar(max),s.Ciphertext,2) ciphertext,
            CONVERT(varchar(24),s.Nonce,2) nonce,
            CONVERT(varchar(32),s.AuthenticationTag,2) authenticationTag,
            s.KeyVersion keyVersion
            FROM gp.PassPrintJobs j JOIN gp.VisitRequests v ON v.VisitRequestId=j.VisitRequestId JOIN gp.AccessPasses p ON p.AccessPassId=j.AccessPassId
            JOIN gp.PassPrintRenderState r ON r.PrintJobId=j.PrintJobId JOIN gp.PhotoAssets a ON a.PhotoAssetId=v.PhotoAssetId JOIN gp.Locations l ON l.LocationId=v.LocationId
            LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId LEFT JOIN gp.Projects pj ON pj.ProjectId=pl.ProjectId
            LEFT JOIN gp.PassSecrets s ON s.AccessPassId=p.AccessPassId WHERE j.PrintJobId=@PrintJobId
            AND r.SourceVisitStatus=v.Status AND r.SourceSnapshotHash=v.SnapshotHash AND r.SourcePhotoHash=a.ContentHash FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        IF @result IS NULL OR JSON_VALUE(@result,'$.ciphertext') IS NULL THROW 53105,'Render source unavailable or changed.',1;
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode) VALUES(@actor,'PASS_RENDER_AUTHORIZED','VISIT',CONVERT(varchar(36),@visit),'SUCCESS');
        COMMIT;SELECT @result;
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp.ListGuardWorkContexts
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int
AS
BEGIN
    SET NOCOUNT ON;SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 53200,'Ambient transaction not accepted.',1;
    IF @LocationId IS NULL OR @LocationId<=0 THROW 52802,'Invalid location.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@projects nvarchar(max),@digital bit=0,@result nvarchar(max);
    BEGIN TRY
        BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        IF NOT EXISTS(SELECT 1 FROM gp.Locations l JOIN gp.StaffRoleGrants g ON g.LocationId=l.LocationId
            JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='VISITS_READ'
            WHERE l.LocationId=@LocationId AND l.IsActive=1 AND g.UserId=@actor AND g.RoleCode='GUARD' AND g.ScopeType='LOCATION'
            AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@now AND (g.ValidUntilUtc IS NULL OR @now<g.ValidUntilUtc)) THROW 52801,'Not authorized.',1;
        SET @projects=(SELECT DISTINCT CONVERT(varchar(20),pl.ProjectLocationId) projectLocationId,p.ProjectName projectName
            FROM gp.GuardAssignments a JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=a.ProjectLocationId
            JOIN gp.Projects p ON p.ProjectId=pl.ProjectId
            WHERE a.GuardUserId=@actor AND pl.LocationId=@LocationId AND pl.IsActive=1 AND p.IsActive=1
            AND a.DeallocatedAtUtc IS NULL AND a.ValidFromUtc<=@now AND (a.ValidUntilUtc IS NULL OR @now<a.ValidUntilUtc)
            AND gp._HasCapability(@actor,'PROJECT_MOVEMENT',@LocationId,pl.ProjectLocationId,1,@now)=1
            ORDER BY projectName,projectLocationId FOR JSON PATH);
        IF EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='VISITS_READ'
            JOIN gp.GrantCapabilities d ON d.RoleGrantId=g.RoleGrantId AND d.CapabilityCode='TEMP_ID_MOVEMENT'
            WHERE g.UserId=@actor AND g.RoleCode='GUARD' AND g.ScopeType='LOCATION' AND g.LocationId=@LocationId
            AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@now AND (g.ValidUntilUtc IS NULL OR @now<g.ValidUntilUtc)) SET @digital=1;
        SET @result=(SELECT @LocationId locationId,JSON_QUERY(COALESCE(@projects,N'[]')) projects,@digital canHandleDigitalId,
            REPLACE(CONVERT(char(23),@now,121),' ','T')+'Z' checkedAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        COMMIT;SELECT @result;
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON gp.ListGuardWorkContexts TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('012',N'Visitor identity QR before approval and explicit selected project guard context');
COMMIT;
