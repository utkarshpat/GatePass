/* Phase 02A: execute-only runtime boundary, host WEB decision, movement and
   scoped guard deallocation. No logins, real users, SSO sessions or bootstrap
   privileges are provisioned. Existing SQL schema is the implementation base.
   Apply the entire file on ONE connection; GO separators are client batches.
   The migration runner must roll back an open transaction on any batch error. */
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT <> 0 THROW 52000, 'Apply migration without an ambient transaction.', 1;
IF DB_NAME() IN (N'master',N'model',N'msdb',N'tempdb') THROW 52000, 'Select the GatePass application database.', 1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='002') THROW 52000, 'Migration 002 is required.', 1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='003') THROW 52000, 'Migration 003 is already applied.', 1;
BEGIN TRANSACTION;
-- Pilot freshness bound, not a claim about the eventual corporate directory SLA.
-- Only a governed migration/master-sync identity may change this database policy.
IF NOT EXISTS(SELECT 1 FROM sys.extended_properties WHERE class=0 AND name=N'GatePass.DirectoryMaxAgeSeconds')
    EXEC sys.sp_addextendedproperty @name=N'GatePass.DirectoryMaxAgeSeconds', @value=300;
GO
CREATE PROCEDURE gp._TakeLock @Resource nvarchar(255), @Mode varchar(32)='Exclusive'
AS
BEGIN
    SET NOCOUNT ON;
    IF @@TRANCOUNT=0 THROW 52000, 'Transaction-owned lock requires a transaction.', 1;
    DECLARE @r int;
    EXEC @r=sys.sp_getapplock @Resource=@Resource,@LockMode=@Mode,
        @LockOwner='Transaction',@LockTimeout=5000,@DbPrincipal='public';
    IF @r<0 THROW 52006, 'Operation lock unavailable; retry with the same key.', 1;
END;
GO
CREATE PROCEDURE gp._RequireActor
    @SessionHash varbinary(8000), @CsrfHash varbinary(8000),
    @Actor uniqueidentifier OUTPUT, @Now datetime2(3) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET @Actor=NULL;
    SET @Now=SYSUTCDATETIME();
    IF @SessionHash IS NULL OR DATALENGTH(@SessionHash)<>32
       OR @CsrfHash IS NULL OR DATALENGTH(@CsrfHash)<>32
        THROW 52001, 'Not authorized.', 1;
    SELECT @Actor=u.UserId
    FROM gp.Sessions s JOIN gp.Users u ON u.UserId=s.UserId
    WHERE s.SessionHash=@SessionHash AND s.CsrfHash=@CsrfHash
      AND s.RevokedAtUtc IS NULL AND u.IsActive=1
      AND s.CreatedAtUtc<=@Now AND s.LastSeenAtUtc<=@Now
      AND @Now<s.IdleExpiresAtUtc AND @Now<s.AbsoluteExpiresAtUtc
      AND s.AuthorizationVersionAtIssue=u.AuthorizationVersion;
    IF @Actor IS NULL THROW 52001, 'Not authorized.', 1;
END;
GO
CREATE PROCEDURE gp._DirectoryCutoff @Now datetime2(3), @Cutoff datetime2(3) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @age int=(SELECT TRY_CONVERT(int,value) FROM sys.extended_properties
        WHERE class=0 AND name=N'GatePass.DirectoryMaxAgeSeconds');
    IF @age IS NULL OR @age NOT BETWEEN 1 AND 86400
        THROW 52004, 'Directory freshness policy unavailable.', 1;
    SET @Cutoff=DATEADD(second,-@age,@Now);
END;
GO
CREATE FUNCTION gp._HasCapability(
    @Actor uniqueidentifier, @Capability varchar(40), @LocationId int,
    @ProjectLocationId bigint, @GuardOnly bit, @Now datetime2(3)
) RETURNS bit
AS
BEGIN
    DECLARE @allowed bit=0;
    IF EXISTS(
        SELECT 1 FROM gp.StaffRoleGrants g
        JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId
        LEFT JOIN gp.ProjectLocations target ON target.ProjectLocationId=@ProjectLocationId
        WHERE g.UserId=@Actor AND c.CapabilityCode=@Capability
          AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@Now
          AND (g.ValidUntilUtc IS NULL OR @Now<g.ValidUntilUtc)
          AND ((@GuardOnly=1 AND g.RoleCode='GUARD' AND g.ScopeType='LOCATION'
                AND @Capability IN ('PROJECT_MOVEMENT','TEMP_ID_MOVEMENT','RECONCILE_EXIT'))
            OR (@GuardOnly=0 AND g.RoleCode IN ('INDIA_ADMIN','LOCATION_ADMIN','PROJECT_ADMIN')
                AND @Capability='GUARDS_MANAGE'))
          AND ((g.ScopeType='INDIA' AND g.RoleCode='INDIA_ADMIN')
            OR (g.ScopeType='LOCATION' AND g.LocationId=@LocationId)
            OR (g.ScopeType='PROJECT' AND g.ProjectId=target.ProjectId)
            OR (g.ScopeType='PROJECT_LOCATION' AND g.ProjectLocationId=@ProjectLocationId))
    ) SET @allowed=1;
    RETURN @allowed;
END;
GO
CREATE PROCEDURE gp._BeginOperation
    @Actor uniqueidentifier, @Code varchar(40), @ClientKey uniqueidentifier,
    @Payload nvarchar(max), @OperationId uniqueidentifier OUTPUT,
    @CachedResult nvarchar(max) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    IF @ClientKey IS NULL THROW 52002, 'An idempotency key is required.', 1;
    DECLARE @binding varbinary(32)=HASHBYTES('SHA2_256',CONVERT(binary(16),@Actor));
    DECLARE @digest varbinary(32)=HASHBYTES('SHA2_256',@Payload);
    DECLARE @resource nvarchar(255)=N'gp:operation:'+CONVERT(varchar(64),HASHBYTES('SHA2_256',
        CONVERT(varchar(64),@binding,2)+':'+@Code+':'+LOWER(CONVERT(char(36),@ClientKey))),2);
    EXEC gp._TakeLock @resource;
    SET @OperationId=NULL;
    SET @CachedResult=NULL;
    DECLARE @previous varbinary(32), @status varchar(12);
    SELECT @OperationId=OperationId,@previous=PayloadHash,@status=Status,@CachedResult=ResultJson
    FROM gp.IdempotencyRequests
    WHERE ActorBindingHash=@binding AND OperationCode=@Code AND ClientKey=@ClientKey;
    IF @OperationId IS NOT NULL
    BEGIN
        IF @previous<>@digest OR @status<>'COMPLETED'
            THROW 52003, 'Idempotency key conflicts with this operation.', 1;
        RETURN;
    END;
    SET @OperationId=NEWID();
    INSERT gp.IdempotencyRequests(OperationId,ActorBindingHash,OperationCode,ClientKey,PayloadHash,Status,ExpiresAtUtc)
    VALUES(@OperationId,@binding,@Code,@ClientKey,@digest,'PROCESSING',DATEADD(day,7,SYSUTCDATETIME()));
END;
GO
CREATE PROCEDURE gp._CompleteOperation @OperationId uniqueidentifier,@Result nvarchar(max)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE gp.IdempotencyRequests SET Status='COMPLETED',ResultJson=@Result,CompletedAtUtc=SYSUTCDATETIME()
    WHERE OperationId=@OperationId AND Status='PROCESSING';
    IF @@ROWCOUNT<>1 THROW 52005, 'Operation completion state invalid.', 1;
END;
GO
CREATE PROCEDURE gp._AuditFailure
    @Actor uniqueidentifier,@Action varchar(80),@Target varchar(100),@ErrorNumber int
AS
BEGIN
    SET NOCOUNT ON;
    -- Failure is appended after rollback; never log tokens, SQL text or error text.
    -- Preserve the original failure if even the diagnostic write is unavailable.
    BEGIN TRY
        DECLARE @metadata nvarchar(max)=(SELECT @ErrorNumber AS errorNumber FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode,MetadataJson)
        VALUES(@Actor,@Action,'OPERATION',@Target,CASE WHEN @ErrorNumber=52001 THEN 'DENIED' ELSE 'ERROR' END,@metadata);
    END TRY
    BEGIN CATCH
        DECLARE @ignored int=ERROR_NUMBER();
    END CATCH;
END;
GO
CREATE PROCEDURE gp.DecideVisit
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ClientKey uniqueidentifier,
    @VisitRequestId uniqueidentifier,@SnapshotVersion int,@SnapshotHash varbinary(8000),
    @Decision varchar(20),@Comment nvarchar(1000)=NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 52000, 'Ambient transactions are not accepted.', 1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@op uniqueidentifier,@cached nvarchar(max),@result nvarchar(max);
    BEGIN TRY
        IF @VisitRequestId IS NULL OR @Decision IS NULL OR @Decision COLLATE Latin1_General_100_BIN2 NOT IN ('APPROVED','DENIED')
           OR @SnapshotHash IS NULL OR DATALENGTH(@SnapshotHash)<>32 OR @SnapshotVersion IS NULL OR @SnapshotVersion<>1
           OR DATALENGTH(@Comment)>1000
            THROW 52002, 'Invalid decision input.', 1;
        BEGIN TRANSACTION;
        EXEC gp._TakeLock N'gp:authorization','Shared';
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        DECLARE @payload nvarchar(max)=(SELECT @VisitRequestId AS visitId,@SnapshotVersion AS snapshotVersion,
            CONVERT(varchar(64),@SnapshotHash,2) AS snapshotHash,@Decision AS decision,@Comment AS comment
            FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER);
        EXEC gp._BeginOperation @actor,'DECIDE_VISIT',@ClientKey,@payload,@op OUTPUT,@cached OUTPUT;
        DECLARE @lock nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@VisitRequestId));
        EXEC gp._TakeLock @lock;
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        DECLARE @location int,@pair bigint,@host nvarchar(64),@employee nvarchar(64),@email nvarchar(320),
            @state varchar(12),@version int,@hash varbinary(32),@deadline datetime2(3),@project bigint,@cutoff datetime2(3);
        SELECT @location=LocationId,@pair=ProjectLocationId,@host=HostEmployeeId,@employee=EmployeeId,
            @email=PersonEmail,@state=Status,@version=SnapshotVersion,@hash=SnapshotHash,@deadline=ApprovalDeadlineUtc
        FROM gp.VisitRequests WITH(UPDLOCK) WHERE VisitRequestId=@VisitRequestId;
        EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
        SELECT @project=pl.ProjectId FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId
            JOIN gp.Locations l ON l.LocationId=pl.LocationId
            WHERE pl.ProjectLocationId=@pair AND pl.IsActive=1 AND p.IsActive=1 AND l.IsActive=1;
        IF @project IS NULL OR NOT EXISTS(SELECT 1 FROM gp.Employees WHERE EmployeeId=@host AND UserId=@actor AND IsActive=1)
            THROW 52001, 'Not authorized.', 1;
        IF NOT EXISTS(SELECT 1 FROM gp.Employees WHERE EmployeeId=@host AND LastSyncedAtUtc BETWEEN @cutoff AND @now)
           OR NOT EXISTS(SELECT 1 FROM gp.EmployeeProjectMemberships WHERE EmployeeId=@host AND ProjectId=@project
                AND IsActive=1 AND VerifiedAtUtc BETWEEN @cutoff AND @now)
            THROW 52004, 'Current host membership must be verified.', 1;
        IF @version<>@SnapshotVersion OR @hash<>@SnapshotHash THROW 52003, 'Submitted snapshot differs.', 1;
        -- Reauthorize before returning a stored result; replay never reopens a decision.
        IF @cached IS NOT NULL
        BEGIN
            COMMIT;
            SELECT @cached AS ResultJson;
            RETURN;
        END;
        IF @state<>'PENDING' OR @deadline IS NULL OR @now>=@deadline
            THROW 52005, 'Visit cannot accept a decision.', 1;
        DECLARE @pass uniqueidentifier;
        SELECT @pass=AccessPassId FROM gp.AccessPasses WITH(UPDLOCK)
            WHERE VisitRequestId=@VisitRequestId AND IsCurrent=1 AND Status='PENDING';
        IF @pass IS NULL THROW 52005, 'Pending credential unavailable.', 1;
        INSERT gp.ApprovalDecisions(VisitRequestId,ApproverEmployeeId,SnapshotVersion,SnapshotHash,Decision,DecisionSource,OperationId,Comment,DecidedAtUtc)
        VALUES(@VisitRequestId,@host,@version,@hash,@Decision,'WEB',@op,@Comment,@now);
        UPDATE gp.VisitRequests SET Status=@Decision,DecisionAtUtc=@now WHERE VisitRequestId=@VisitRequestId;
        UPDATE gp.AccessPasses SET Status=CASE WHEN @Decision='APPROVED' THEN 'ACTIVE' ELSE 'DENIED' END WHERE AccessPassId=@pass;
        SET @result=(SELECT @op AS operationId,@VisitRequestId AS visitRequestId,@Decision AS decision FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        IF @employee IS NOT NULL OR @email IS NOT NULL
            INSERT gp.NotificationOutbox(VisitRequestId,RecipientKind,RecipientEmployeeId,RecipientEmail,TemplateCode,PayloadJson,DedupeHash)
            VALUES(@VisitRequestId,CASE WHEN @employee IS NULL THEN 'EMAIL' ELSE 'EMPLOYEE' END,@employee,@email,
                'VISIT_DECIDED',@result,HASHBYTES('SHA2_256',CONVERT(char(36),@op)+':VISIT_DECIDED'));
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode,MetadataJson)
        VALUES(@actor,'VISIT_DECIDED','VISIT',CONVERT(varchar(36),@VisitRequestId),@location,@pair,'SUCCESS',@result);
        EXEC gp._CompleteOperation @op,@result;
        COMMIT;
        SELECT @result AS ResultJson;
    END TRY
    BEGIN CATCH
        DECLARE @error int=ERROR_NUMBER(),@target varchar(100)=CONVERT(varchar(36),@VisitRequestId);
        IF @@TRANCOUNT>0 ROLLBACK;
        EXEC gp._AuditFailure @actor,'VISIT_DECISION_FAILED',@target,@error;
        THROW;
    END CATCH;
END;
GO
CREATE PROCEDURE gp.RecordMovement
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ClientKey uniqueidentifier,
    @VisitRequestId uniqueidentifier,@AccessPassId uniqueidentifier,@LocationId int,
    @EventType varchar(20),@EntryMethod varchar(20),@CredentialHash varbinary(8000)=NULL,
    @OccurredAtUtc datetime2(3)=NULL,@ReconciliationReason nvarchar(1000)=NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 52000, 'Ambient transactions are not accepted.', 1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@op uniqueidentifier,@cached nvarchar(max),@result nvarchar(max);
    BEGIN TRY
        IF @VisitRequestId IS NULL OR @AccessPassId IS NULL OR @LocationId IS NULL
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
            @EventType AS eventType,@EntryMethod AS method,CONVERT(varchar(64),@CredentialHash,2) AS credentialHash,
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
            @EventType AS eventType,CONVERT(bit,CASE WHEN @EventType='ENTRY' THEN 1 ELSE 0 END) AS isInside FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
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
CREATE PROCEDURE gp.DeallocateGuard
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ClientKey uniqueidentifier,
    @GuardAssignmentId bigint,@Reason nvarchar(600)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 52000, 'Ambient transactions are not accepted.', 1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@op uniqueidentifier,@cached nvarchar(max),@result nvarchar(max);
    BEGIN TRY
        IF @GuardAssignmentId IS NULL OR @Reason IS NULL OR LEN(LTRIM(RTRIM(@Reason)))=0 OR DATALENGTH(@Reason)>600
            THROW 52002, 'Invalid deallocation input.', 1;
        BEGIN TRANSACTION;
        EXEC gp._TakeLock N'gp:authorization','Exclusive';
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        DECLARE @payload nvarchar(max)=(SELECT @GuardAssignmentId AS assignmentId,@Reason AS reason FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        EXEC gp._BeginOperation @actor,'DEALLOCATE_GUARD',@ClientKey,@payload,@op OUTPUT,@cached OUTPUT;
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        DECLARE @guard uniqueidentifier,@pair bigint,@location int,@revoked datetime2(3);
        SELECT @guard=a.GuardUserId,@pair=a.ProjectLocationId,@location=pl.LocationId,@revoked=a.DeallocatedAtUtc
        FROM gp.GuardAssignments a JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=a.ProjectLocationId
        WHERE a.GuardAssignmentId=@GuardAssignmentId;
        IF @guard IS NULL OR gp._HasCapability(@actor,'GUARDS_MANAGE',@location,@pair,0,@now)=0
            THROW 52001, 'Not authorized.', 1;
        IF @cached IS NOT NULL
        BEGIN
            COMMIT;
            SELECT @cached AS ResultJson;
            RETURN;
        END;
        IF @revoked IS NOT NULL THROW 52005, 'Allocation already deallocated.', 1;
        UPDATE gp.GuardAssignments SET DeallocatedAtUtc=@now,DeallocatedByUserId=@actor,Reason=@Reason WHERE GuardAssignmentId=@GuardAssignmentId;
        UPDATE gp.Users SET AuthorizationVersion=AuthorizationVersion+1 WHERE UserId=@guard;
        SET @result=(SELECT @op AS operationId,@GuardAssignmentId AS assignmentId,CONVERT(bit,1) AS deallocated FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode,MetadataJson)
        VALUES(@actor,'GUARD_DEALLOCATED','GUARD_ASSIGNMENT',CONVERT(varchar(100),@GuardAssignmentId),@location,@pair,'SUCCESS',@result);
        EXEC gp._CompleteOperation @op,@result;
        COMMIT;
        SELECT @result AS ResultJson;
    END TRY
    BEGIN CATCH
        DECLARE @error int=ERROR_NUMBER(),@target varchar(100)=CONVERT(varchar(100),@GuardAssignmentId);
        IF @@TRANCOUNT>0 ROLLBACK;
        EXEC gp._AuditFailure @actor,'GUARD_DEALLOCATION_FAILED',@target,@error;
        THROW;
    END CATCH;
END;
GO
-- No schema-wide EXECUTE grant: private helpers cannot be called directly.
CREATE ROLE gp_api_runtime AUTHORIZATION dbo;
DENY SELECT,INSERT,UPDATE,DELETE ON SCHEMA::gp TO gp_api_runtime;
DENY ALTER ON SCHEMA::gp TO gp_api_runtime;
GRANT EXECUTE ON OBJECT::gp.DecideVisit TO gp_api_runtime;
GRANT EXECUTE ON OBJECT::gp.RecordMovement TO gp_api_runtime;
GRANT EXECUTE ON OBJECT::gp.DeallocateGuard TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('003','Execute-only transaction security core: host decisions, movements and scoped deallocation');
COMMIT TRANSACTION;
