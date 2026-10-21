/* Forward fix: abandoned challenges from old credential/authorization versions
   must not consume the current account's two verification slots after reset. */
SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52600,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='006') THROW 52600,'Migration 006 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='007') THROW 52600,'Migration 007 already applied.',1;
BEGIN TRANSACTION;
GO
ALTER PROCEDURE gp.BeginGuardLogin @LoginId varchar(8000),@AttemptHash varbinary(8000),@SourceHash varbinary(8000)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON; SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
    IF @@TRANCOUNT<>0 THROW 52600,'Ambient transaction not accepted.',1;
    IF @LoginId IS NULL OR DATALENGTH(@LoginId) NOT BETWEEN 3 AND 64 OR @LoginId COLLATE Latin1_General_100_BIN2 LIKE '%[^a-z0-9._-]%'
       OR DATALENGTH(@LoginId)<>LEN(@LoginId) OR @LoginId COLLATE Latin1_General_100_BIN2 LIKE '[^a-z0-9]%' OR @AttemptHash IS NULL OR DATALENGTH(@AttemptHash)<>32
       OR @SourceHash IS NULL OR DATALENGTH(@SourceHash)<>32 THROW 52602,'Invalid authentication input.',1;
    DECLARE @now datetime2(3),@allowed bit,@user uniqueidentifier,@hash varchar(128),@version bigint,@authorization bigint;
    BEGIN TRY
        BEGIN TRANSACTION; EXEC gp._TakeLock N'gp:authorization','Shared'; SET @now=SYSUTCDATETIME();
        EXEC gp._GuardSourceBudget @SourceHash,@now,@allowed OUTPUT;
        IF @allowed=0 BEGIN COMMIT; SELECT N'{"status":"THROTTLED"}'; RETURN; END;
        SELECT @user=UserId FROM gp.GuardCredentials WHERE LoginId=@LoginId COLLATE Latin1_General_100_BIN2;
        IF @user IS NOT NULL
        BEGIN
            DECLARE @resource nvarchar(255)=N'gp:guard-account:'+CONVERT(nvarchar(36),@user);
            EXEC gp._TakeLock @resource;
            SET @now=SYSUTCDATETIME();
            SELECT @hash=c.EncodedPasswordHash,@version=c.CredentialVersion,@authorization=u.AuthorizationVersion
                FROM gp.GuardCredentials c JOIN gp.Users u ON u.UserId=c.UserId
                WHERE c.UserId=@user AND c.IsEnabled=1 AND c.MustChangePassword=0 AND (c.LockedUntilUtc IS NULL OR c.LockedUntilUtc<=@now)
                AND gp._GuardIdentityEligible(@user,@now)=1;
            IF @hash IS NOT NULL AND (SELECT COUNT(*) FROM gp.GuardLoginAttempts WHERE UserId=@user AND UsedAtUtc IS NULL
                AND @now<ExpiresAtUtc AND CredentialVersion=@version AND AuthorizationVersion=@authorization)<2
                INSERT gp.GuardLoginAttempts(AttemptHash,UserId,SourceHash,CredentialVersion,AuthorizationVersion,CreatedAtUtc,ExpiresAtUtc)
                    VALUES(@AttemptHash,@user,@SourceHash,@version,@authorization,@now,DATEADD(second,60,@now));
            ELSE SET @hash=NULL;
        END;
        COMMIT;
        SELECT (SELECT CASE WHEN @hash IS NULL THEN 'DENIED' ELSE 'READY' END status,@hash encodedPasswordHash FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH;
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('007',N'Ignore obsolete guard verification generations when reserving current login slots');
COMMIT;
