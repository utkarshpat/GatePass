/* Phase 02B: fenced outbox claims and execute-only worker permissions.
   No SMTP/provider calls, directory HTTP, key access, logins or real recipients.
   Apply ALL parsed batches on one connection; roll back on any batch failure. */
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52000,'Apply without an ambient transaction.',1;
IF DB_NAME() IN(N'master',N'model',N'msdb',N'tempdb') THROW 52000,'Select the GatePass application database.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='003') THROW 52000,'Migration 003 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='004') THROW 52000,'Migration 004 already applied.',1;
BEGIN TRANSACTION;
GO
CREATE PROCEDURE gp.ClaimNotifications @BatchSize int=10,@LeaseSeconds int=60
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
    IF @@TRANCOUNT<>0 THROW 52000,'Ambient transactions are not accepted.',1;
    IF @BatchSize IS NULL OR @BatchSize NOT BETWEEN 1 AND 20 OR @LeaseSeconds IS NULL OR @LeaseSeconds NOT BETWEEN 15 AND 300
        THROW 52002,'Invalid bounded claim request.',1;
    BEGIN TRY
        BEGIN TRANSACTION;
        EXEC gp._TakeLock N'gp:outbox:claim';
        DECLARE @now datetime2(3)=SYSUTCDATETIME();
        DECLARE @dead table(NotificationId bigint,AttemptCount int);
        DECLARE @claimed table(NotificationId bigint,ClaimToken uniqueidentifier,LeaseUntilUtc datetime2(3),AttemptCount int);
        ;WITH exhausted AS (
            SELECT TOP(@BatchSize) * FROM gp.NotificationOutbox WITH(UPDLOCK)
            WHERE AttemptCount>=MaxAttempts AND ((Status='PENDING' AND NextAttemptAtUtc<=@now)
                OR (Status='PROCESSING' AND LockedUntilUtc<=@now))
            ORDER BY NotificationId
        )
        UPDATE exhausted SET Status='DEAD',LockedBy=NULL,LockedUntilUtc=NULL,LastErrorCode='ATTEMPTS_EXHAUSTED'
        OUTPUT inserted.NotificationId,inserted.AttemptCount INTO @dead;
        ;WITH due AS (
            SELECT TOP(@BatchSize) * FROM gp.NotificationOutbox WITH(UPDLOCK)
            WHERE AttemptCount<MaxAttempts AND ((Status='PENDING' AND NextAttemptAtUtc<=@now)
                OR (Status='PROCESSING' AND LockedUntilUtc<=@now))
            ORDER BY NextAttemptAtUtc,NotificationId
        )
        UPDATE due SET Status='PROCESSING',AttemptCount=AttemptCount+1,LockedBy=NEWID(),
            LockedUntilUtc=DATEADD(second,@LeaseSeconds,@now)
        OUTPUT inserted.NotificationId,inserted.LockedBy,inserted.LockedUntilUtc,inserted.AttemptCount INTO @claimed;
        INSERT gp.SecurityAuditEvents(ActionCode,TargetType,TargetReference,ResultCode,MetadataJson)
        SELECT 'NOTIFICATION_DEAD','NOTIFICATION',CONVERT(varchar(100),d.NotificationId),'SUCCESS',
            (SELECT d.AttemptCount AS attemptCount,'ATTEMPTS_EXHAUSTED' AS errorCode FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) FROM @dead d;
        INSERT gp.SecurityAuditEvents(ActionCode,TargetType,TargetReference,ResultCode,MetadataJson)
        SELECT 'NOTIFICATION_CLAIMED','NOTIFICATION',CONVERT(varchar(100),c.NotificationId),'SUCCESS',
            (SELECT c.AttemptCount AS attemptCount FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) FROM @claimed c;
        DECLARE @result nvarchar(max)=(SELECT NotificationId AS notificationId,ClaimToken AS claimToken,
            LeaseUntilUtc AS leaseUntilUtc,AttemptCount AS attemptCount FROM @claimed ORDER BY NotificationId FOR JSON PATH);
        COMMIT;
        -- OUTPUT is buffered until commit; rolled-back claims never reach the caller.
        SELECT @result AS ResultJson;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT>0 ROLLBACK;
        THROW;
    END CATCH;
END;
GO
CREATE PROCEDURE gp._NotificationRelevance
    @NotificationId bigint,@Now datetime2(3),@Reason varchar(40) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET @Reason=NULL;
    DECLARE @visit uniqueidentifier,@link uniqueidentifier,@template varchar(40),@kind varchar(12),
        @recipient nvarchar(64),@email nvarchar(320),@payload nvarchar(max);
    SELECT @visit=VisitRequestId,@link=DeliveryLinkId,@template=TemplateCode,@kind=RecipientKind,
        @recipient=RecipientEmployeeId,@email=RecipientEmail,@payload=PayloadJson
    FROM gp.NotificationOutbox WHERE NotificationId=@NotificationId;
    IF @template NOT IN('HOST_APPROVAL_REQUEST','TEMP_ID_MANAGER_NOTICE','VISIT_DECIDED','PASS_DELIVERY')
    BEGIN SET @Reason='UNSUPPORTED_TEMPLATE'; RETURN; END;
    IF @visit IS NULL BEGIN SET @Reason='MISSING_VISIT'; RETURN; END;
    DECLARE @state varchar(12),@type varchar(24),@employee nvarchar(64),@personEmail nvarchar(320),@host nvarchar(64),
        @pair bigint,@location int,@deadline datetime2(3),@end datetime2(3),@project bigint,@cutoff datetime2(3);
    SELECT @state=Status,@type=RequestType,@employee=EmployeeId,@personEmail=PersonEmail,@host=HostEmployeeId,
        @pair=ProjectLocationId,@location=LocationId,@deadline=ApprovalDeadlineUtc,@end=ValidUntilUtc
    FROM gp.VisitRequests WHERE VisitRequestId=@visit;
    IF @state IS NULL BEGIN SET @Reason='MISSING_VISIT'; RETURN; END;
    -- Issuance notice is a historical fact, not a new access entitlement.
    IF @template='TEMP_ID_MANAGER_NOTICE'
    BEGIN
        IF @type<>'TEMP_ID' OR @kind<>'MANAGER' OR @recipient IS NULL OR @recipient<>@employee
            SET @Reason='RECIPIENT_MISMATCH';
        RETURN;
    END;
    IF @template='VISIT_DECIDED'
    BEGIN
        IF @state NOT IN('APPROVED','DENIED') OR NOT EXISTS(
            SELECT 1 FROM gp.ApprovalDecisions WHERE VisitRequestId=@visit AND Decision=@state)
            OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.visitRequestId')) IS NULL
            OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.visitRequestId'))<>@visit
            OR JSON_VALUE(@payload,'$.decision') IS NULL OR JSON_VALUE(@payload,'$.decision')<>@state
        BEGIN SET @Reason='STATE_CHANGED'; RETURN; END;
        IF (@employee IS NULL AND (@kind<>'EMAIL' OR @email IS NULL OR @personEmail IS NULL OR @email<>@personEmail))
            OR (@employee IS NOT NULL AND (@kind<>'EMPLOYEE' OR @recipient IS NULL OR @recipient<>@employee))
            SET @Reason='RECIPIENT_MISMATCH';
        RETURN;
    END;
    IF NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@location AND IsActive=1)
    BEGIN SET @Reason='TARGET_INACTIVE'; RETURN; END;
    IF @pair IS NOT NULL
    BEGIN
        SELECT @project=pl.ProjectId FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId
        WHERE pl.ProjectLocationId=@pair AND pl.IsActive=1 AND p.IsActive=1;
        IF @project IS NULL BEGIN SET @Reason='TARGET_INACTIVE'; RETURN; END;
    END;
    IF @template='HOST_APPROVAL_REQUEST'
    BEGIN
        IF @state<>'PENDING' OR @deadline IS NULL OR @Now>=@deadline OR @Now>=@end
        BEGIN SET @Reason='STATE_CHANGED'; RETURN; END;
        IF @kind<>'EMPLOYEE' OR @recipient IS NULL OR @recipient<>@host
        BEGIN SET @Reason='RECIPIENT_MISMATCH'; RETURN; END;
        EXEC gp._DirectoryCutoff @Now,@cutoff OUTPUT;
        IF NOT EXISTS(SELECT 1 FROM gp.Employees WHERE EmployeeId=@host AND IsActive=1 AND LastSyncedAtUtc BETWEEN @cutoff AND @Now)
            OR NOT EXISTS(SELECT 1 FROM gp.EmployeeProjectMemberships WHERE EmployeeId=@host AND ProjectId=@project
                AND IsActive=1 AND VerifiedAtUtc BETWEEN @cutoff AND @Now)
            THROW 52004,'Current host directory data must be verified.',1;
        RETURN;
    END;
    IF @state<>'APPROVED' OR @Now>=@end OR @link IS NULL
    BEGIN SET @Reason='STATE_CHANGED'; RETURN; END;
    DECLARE @linkEmail nvarchar(320);
    SELECT @linkEmail=l.RecipientEmail FROM gp.PassDeliveryLinks l JOIN gp.AccessPasses p ON p.AccessPassId=l.AccessPassId
        AND p.VisitRequestId=l.VisitRequestId
    WHERE l.DeliveryLinkId=@link AND l.VisitRequestId=@visit AND l.RevokedAtUtc IS NULL AND @Now<l.ExpiresAtUtc
        AND p.IsCurrent=1 AND p.Status='ACTIVE';
    IF @linkEmail IS NULL BEGIN SET @Reason='LINK_UNAVAILABLE'; RETURN; END;
    IF @employee IS NULL
    BEGIN
        IF @kind<>'EMAIL' OR @email IS NULL OR @personEmail IS NULL OR @email<>@linkEmail OR @email<>@personEmail
            SET @Reason='RECIPIENT_MISMATCH';
        RETURN;
    END;
    EXEC gp._DirectoryCutoff @Now,@cutoff OUTPUT;
    DECLARE @official nvarchar(320);
    SELECT @official=OfficialEmail FROM gp.Employees WHERE EmployeeId=@employee AND IsActive=1 AND LastSyncedAtUtc BETWEEN @cutoff AND @Now;
    IF @official IS NULL THROW 52004,'Current employee directory data must be verified.',1;
    IF @kind<>'EMPLOYEE' OR @recipient IS NULL OR @recipient<>@employee OR @linkEmail<>@official
        SET @Reason='RECIPIENT_MISMATCH';
END;
GO
CREATE PROCEDURE gp.GetNotificationDispatch @NotificationId bigint,@ClaimToken uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
    IF @@TRANCOUNT<>0 THROW 52000,'Ambient transactions are not accepted.',1;
    IF @NotificationId IS NULL OR @ClaimToken IS NULL THROW 52002,'Claim reference required.',1;
    -- Statement-scoped initial lookup releases row read locks before visit locks.
    DECLARE @visit uniqueidentifier,@found bit=0;
    SELECT @visit=VisitRequestId,@found=1 FROM gp.NotificationOutbox
        WHERE NotificationId=@NotificationId AND Status='PROCESSING' AND LockedBy=@ClaimToken;
    IF @found=0 THROW 52003,'Notification lease unavailable.',1;
    BEGIN TRY
        BEGIN TRANSACTION;
        EXEC gp._TakeLock N'gp:authorization','Shared';
        IF @visit IS NOT NULL
        BEGIN
            DECLARE @visitLock nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@visit));
            EXEC gp._TakeLock @visitLock,'Shared';
        END;
        EXEC gp._TakeLock N'gp:outbox:claim';
        DECLARE @now datetime2(3)=SYSUTCDATETIME();
        IF NOT EXISTS(SELECT 1 FROM gp.NotificationOutbox WITH(UPDLOCK) WHERE NotificationId=@NotificationId
            AND Status='PROCESSING' AND LockedBy=@ClaimToken AND @now<LockedUntilUtc)
            THROW 52003,'Notification lease unavailable.',1;
        DECLARE @reason varchar(40),@result nvarchar(max);
        EXEC gp._NotificationRelevance @NotificationId,@now,@reason OUTPUT;
        IF @reason IS NOT NULL
        BEGIN
            UPDATE gp.NotificationOutbox SET Status='CANCELLED',LockedBy=NULL,LockedUntilUtc=NULL,LastErrorCode=@reason
                WHERE NotificationId=@NotificationId;
            SET @result=(SELECT @NotificationId AS notificationId,'CANCELLED' AS status,@reason AS reasonCode FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
            INSERT gp.SecurityAuditEvents(ActionCode,TargetType,TargetReference,ResultCode,MetadataJson)
            VALUES('NOTIFICATION_CANCELLED','NOTIFICATION',CONVERT(varchar(100),@NotificationId),'SUCCESS',@result);
        END
        ELSE
            SELECT @result=(SELECT NotificationId AS notificationId,'READY' AS status,VisitRequestId AS visitRequestId,
                DeliveryLinkId AS deliveryLinkId,RecipientKind AS recipientKind,RecipientEmployeeId AS recipientEmployeeId,
                CASE WHEN RecipientKind='EMAIL' THEN RecipientEmail END AS recipientEmail,TemplateCode AS templateCode,
                JSON_QUERY(PayloadJson) AS payload,AttemptCount AS attemptCount,LockedUntilUtc AS leaseUntilUtc
                FROM gp.NotificationOutbox WHERE NotificationId=@NotificationId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        COMMIT;
        SELECT @result AS ResultJson;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT>0 ROLLBACK;
        THROW;
    END CATCH;
END;
GO
CREATE PROCEDURE gp.RenewNotificationLease @NotificationId bigint,@ClaimToken uniqueidentifier,@LeaseSeconds int=60
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
    IF @@TRANCOUNT<>0 THROW 52000,'Ambient transactions are not accepted.',1;
    IF @NotificationId IS NULL OR @ClaimToken IS NULL OR @LeaseSeconds IS NULL OR @LeaseSeconds NOT BETWEEN 15 AND 300
        THROW 52002,'Invalid lease renewal.',1;
    BEGIN TRY
        BEGIN TRANSACTION;
        EXEC gp._TakeLock N'gp:outbox:claim';
        DECLARE @now datetime2(3)=SYSUTCDATETIME();
        UPDATE gp.NotificationOutbox SET LockedUntilUtc=DATEADD(second,@LeaseSeconds,@now)
        WHERE NotificationId=@NotificationId AND Status='PROCESSING' AND LockedBy=@ClaimToken AND @now<LockedUntilUtc;
        IF @@ROWCOUNT<>1 THROW 52003,'Notification lease unavailable.',1;
        DECLARE @result nvarchar(max)=(SELECT NotificationId AS notificationId,LockedUntilUtc AS leaseUntilUtc
            FROM gp.NotificationOutbox WHERE NotificationId=@NotificationId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        COMMIT;
        SELECT @result AS ResultJson;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT>0 ROLLBACK;
        THROW;
    END CATCH;
END;
GO
CREATE PROCEDURE gp.CompleteNotification
    @NotificationId bigint,@ClaimToken uniqueidentifier,@Outcome varchar(20),
    @ErrorCode varchar(200)=NULL,@ProviderMessageId nvarchar(400)=NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
    IF @@TRANCOUNT<>0 THROW 52000,'Ambient transactions are not accepted.',1;
    IF @NotificationId IS NULL OR @ClaimToken IS NULL OR @Outcome IS NULL
        OR @Outcome COLLATE Latin1_General_100_BIN2 NOT IN('SENT','FAILED')
        OR DATALENGTH(@ProviderMessageId)>400
        OR (@Outcome='SENT' AND @ErrorCode IS NOT NULL)
        OR (@Outcome='FAILED' AND (@ProviderMessageId IS NOT NULL OR @ErrorCode IS NULL OR DATALENGTH(@ErrorCode)>100
            OR @ErrorCode COLLATE Latin1_General_100_BIN2 NOT IN('DIRECTORY_UNAVAILABLE','PROVIDER_TIMEOUT',
                'PROVIDER_UNAVAILABLE','PROVIDER_REJECTED','RENDER_FAILED','INVALID_RECIPIENT','INTERNAL_ERROR')))
        THROW 52002,'Invalid notification completion.',1;
    BEGIN TRY
        BEGIN TRANSACTION;
        EXEC gp._TakeLock N'gp:outbox:claim';
        DECLARE @now datetime2(3)=SYSUTCDATETIME(),@attempt int,@max int,@status varchar(12),@next datetime2(3)=NULL;
        SELECT @attempt=AttemptCount,@max=MaxAttempts FROM gp.NotificationOutbox WITH(UPDLOCK)
        WHERE NotificationId=@NotificationId AND Status='PROCESSING' AND LockedBy=@ClaimToken AND @now<LockedUntilUtc;
        IF @attempt IS NULL THROW 52003,'Notification lease unavailable.',1;
        SET @status=CASE WHEN @Outcome='SENT' THEN 'SENT' WHEN @attempt>=@max
            OR @ErrorCode IN('INVALID_RECIPIENT','PROVIDER_REJECTED') THEN 'DEAD' ELSE 'PENDING' END;
        IF @status='PENDING'
        BEGIN
            DECLARE @power int=CASE WHEN @attempt>8 THEN 7 ELSE @attempt-1 END;
            DECLARE @delay int=30*CONVERT(int,POWER(2,@power))+CONVERT(int,CRYPT_GEN_RANDOM(1))%16;
            IF @delay>3600 SET @delay=3600;
            SET @next=DATEADD(second,@delay,@now);
        END;
        UPDATE gp.NotificationOutbox SET Status=@status,LockedBy=NULL,LockedUntilUtc=NULL,
            LastErrorCode=CASE WHEN @Outcome='SENT' THEN NULL ELSE @ErrorCode END,
            SentAtUtc=CASE WHEN @Outcome='SENT' THEN @now ELSE NULL END,
            ProviderMessageId=CASE WHEN @Outcome='SENT' THEN @ProviderMessageId ELSE NULL END,
            NextAttemptAtUtc=COALESCE(@next,@now)
        WHERE NotificationId=@NotificationId;
        DECLARE @result nvarchar(max)=(SELECT @NotificationId AS notificationId,@status AS status,@attempt AS attemptCount,
            @next AS nextAttemptAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        DECLARE @audit nvarchar(max)=(SELECT @NotificationId AS notificationId,@status AS status,@attempt AS attemptCount,
            @ErrorCode AS errorCode FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        INSERT gp.SecurityAuditEvents(ActionCode,TargetType,TargetReference,ResultCode,MetadataJson)
        VALUES('NOTIFICATION_COMPLETED','NOTIFICATION',CONVERT(varchar(100),@NotificationId),'SUCCESS',@audit);
        COMMIT;
        SELECT @result AS ResultJson;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT>0 ROLLBACK;
        THROW;
    END CATCH;
END;
GO
CREATE ROLE gp_worker_runtime AUTHORIZATION dbo;
DENY SELECT,INSERT,UPDATE,DELETE ON SCHEMA::gp TO gp_worker_runtime;
DENY ALTER ON SCHEMA::gp TO gp_worker_runtime;
GRANT EXECUTE ON OBJECT::gp.ClaimNotifications TO gp_worker_runtime;
GRANT EXECUTE ON OBJECT::gp.GetNotificationDispatch TO gp_worker_runtime;
GRANT EXECUTE ON OBJECT::gp.RenewNotificationLease TO gp_worker_runtime;
GRANT EXECUTE ON OBJECT::gp.CompleteNotification TO gp_worker_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('004','Fenced notification leases, safe dispatch preflight and isolated worker role');
COMMIT TRANSACTION;
