/* Forward-only correction discovered by live empty-queue testing: always return
   [] instead of SQL NULL. Lease renewal must never shorten an existing lease.
   Prior applied migrations 003/004 remain unchanged. */
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52000,'Apply without an ambient transaction.',1;
IF DB_NAME() IN(N'master',N'model',N'msdb',N'tempdb') THROW 52000,'Select the GatePass application database.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='004') THROW 52000,'Migration 004 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='005') THROW 52000,'Migration 005 already applied.',1;
BEGIN TRANSACTION;
GO
ALTER PROCEDURE gp.ClaimNotifications @BatchSize int=10,@LeaseSeconds int=60
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
        UPDATE due SET Status='PROCESSING',AttemptCount=AttemptCount+1,LockedBy=NEWID(),LockedUntilUtc=DATEADD(second,@LeaseSeconds,@now)
        OUTPUT inserted.NotificationId,inserted.LockedBy,inserted.LockedUntilUtc,inserted.AttemptCount INTO @claimed;
        INSERT gp.SecurityAuditEvents(ActionCode,TargetType,TargetReference,ResultCode,MetadataJson)
        SELECT 'NOTIFICATION_DEAD','NOTIFICATION',CONVERT(varchar(100),d.NotificationId),'SUCCESS',
            (SELECT d.AttemptCount AS attemptCount,'ATTEMPTS_EXHAUSTED' AS errorCode FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) FROM @dead d;
        INSERT gp.SecurityAuditEvents(ActionCode,TargetType,TargetReference,ResultCode,MetadataJson)
        SELECT 'NOTIFICATION_CLAIMED','NOTIFICATION',CONVERT(varchar(100),c.NotificationId),'SUCCESS',
            (SELECT c.AttemptCount AS attemptCount FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) FROM @claimed c;
        DECLARE @result nvarchar(max)=(SELECT NotificationId AS notificationId,ClaimToken AS claimToken,
            LeaseUntilUtc AS leaseUntilUtc,AttemptCount AS attemptCount FROM @claimed ORDER BY NotificationId FOR JSON PATH);
        SET @result=COALESCE(@result,N'[]');
        COMMIT;
        SELECT @result AS ResultJson;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT>0 ROLLBACK;
        THROW;
    END CATCH;
END;
GO
ALTER PROCEDURE gp.RenewNotificationLease @NotificationId bigint,@ClaimToken uniqueidentifier,@LeaseSeconds int=60
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
        UPDATE gp.NotificationOutbox SET LockedUntilUtc=CASE WHEN LockedUntilUtc>DATEADD(second,@LeaseSeconds,@now)
            THEN LockedUntilUtc ELSE DATEADD(second,@LeaseSeconds,@now) END
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
INSERT gp.SchemaMigrations(Version,Description) VALUES('005','Stable empty claim JSON and non-shortening lease renewal');
COMMIT TRANSACTION;
