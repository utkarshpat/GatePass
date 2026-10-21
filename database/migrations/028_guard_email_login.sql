/* Accept email-shaped guard login IDs; identity and authorization checks are unchanged. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='027') THROW 53600,'Migration 027 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='028') THROW 53600,'Migration 028 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
ALTER TABLE gp.GuardCredentials DROP CONSTRAINT CK_GuardCredentials_Login;
ALTER TABLE gp.GuardCredentials WITH CHECK ADD CONSTRAINT CK_GuardCredentials_Login CHECK
 (DATALENGTH(LoginId) BETWEEN 3 AND 64 AND DATALENGTH(LoginId)=LEN(LoginId) AND LoginId NOT LIKE '%[^a-z0-9@._-]%' AND LoginId NOT LIKE '[^a-z0-9]%');
GO
ALTER PROCEDURE gp.ManageGuardCredential
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@TargetUserId uniqueidentifier,
    @Action varchar(40),@LoginId varchar(8000)=NULL,@SetupTokenHash varbinary(8000)=NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON; SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
    IF @@TRANCOUNT<>0 THROW 52600,'Ambient transaction not accepted.',1;
    IF @TargetUserId IS NULL OR @Action IS NULL OR @Action COLLATE Latin1_General_100_BIN2 NOT IN('ISSUE_SETUP','DISABLE') THROW 52602,'Invalid authentication input.',1;
    IF @Action='ISSUE_SETUP' AND (@LoginId IS NULL OR DATALENGTH(@LoginId) NOT BETWEEN 3 AND 64
       OR DATALENGTH(@LoginId)<>LEN(@LoginId) OR @LoginId COLLATE Latin1_General_100_BIN2 LIKE '%[^a-z0-9@._-]%' OR @LoginId COLLATE Latin1_General_100_BIN2 LIKE '[^a-z0-9]%'
       OR @SetupTokenHash IS NULL OR DATALENGTH(@SetupTokenHash)<>32) THROW 52602,'Invalid authentication input.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@version bigint;
    BEGIN TRY
        BEGIN TRANSACTION;
        EXEC gp._TakeLock N'gp:authorization','Exclusive';
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        EXEC gp._RequireGuardCredentialAdmin @actor,@TargetUserId,@now;
        DECLARE @resource nvarchar(255)=N'gp:guard-account:'+CONVERT(nvarchar(36),@TargetUserId);
        EXEC gp._TakeLock @resource;
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        EXEC gp._RequireGuardCredentialAdmin @actor,@TargetUserId,@now;
        IF @Action='ISSUE_SETUP'
        BEGIN
            IF EXISTS(SELECT 1 FROM gp.GuardCredentials WHERE UserId=@TargetUserId AND LoginId<>@LoginId COLLATE Latin1_General_100_BIN2)
                THROW 52602,'Existing login ID cannot be renamed by reset.',1;
            IF NOT EXISTS(SELECT 1 FROM gp.GuardCredentials WHERE UserId=@TargetUserId)
                INSERT gp.GuardCredentials(UserId,LoginId) VALUES(@TargetUserId,@LoginId);
            ELSE UPDATE gp.GuardCredentials SET CredentialVersion=CredentialVersion+1,IsEnabled=1,EncodedPasswordHash=NULL,
                MustChangePassword=1,PasswordChangedAtUtc=NULL,FailedCount=0,FailureWindowStartUtc=NULL,LockedUntilUtc=NULL WHERE UserId=@TargetUserId;
        END
        ELSE
        BEGIN
            IF NOT EXISTS(SELECT 1 FROM gp.GuardCredentials WHERE UserId=@TargetUserId) THROW 52602,'Guard credential not provisioned.',1;
            UPDATE gp.GuardCredentials SET CredentialVersion=CredentialVersion+1,IsEnabled=0 WHERE UserId=@TargetUserId;
        END;
        UPDATE gp.Users SET AuthorizationVersion=AuthorizationVersion+1 WHERE UserId=@TargetUserId;
        UPDATE gp.Sessions SET RevokedAtUtc=@now WHERE UserId=@TargetUserId AND RevokedAtUtc IS NULL;
        UPDATE gp.GuardSetupTickets SET UsedAtUtc=@now WHERE UserId=@TargetUserId AND UsedAtUtc IS NULL;
        SELECT @version=CredentialVersion FROM gp.GuardCredentials WHERE UserId=@TargetUserId;
        IF @Action='ISSUE_SETUP'
            INSERT gp.GuardSetupTickets(TokenHash,UserId,CredentialVersion,CreatedByUserId,CreatedAtUtc,ExpiresAtUtc)
                VALUES(@SetupTokenHash,@TargetUserId,@version,@actor,@now,DATEADD(minute,15,@now));
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode)
            VALUES(@actor,CASE WHEN @Action='ISSUE_SETUP' THEN 'GUARD_SETUP_ISSUED' ELSE 'GUARD_CREDENTIAL_DISABLED' END,'USER',CONVERT(varchar(36),@TargetUserId),'SUCCESS');
        COMMIT;
        SELECT (SELECT 'OK' status,CASE WHEN @Action='ISSUE_SETUP' THEN DATEADD(minute,15,@now) END expiresAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT>0 ROLLBACK;
        THROW;
    END CATCH;
END;
GO
ALTER PROCEDURE gp.BeginGuardLogin @LoginId varchar(8000),@AttemptHash varbinary(8000),@SourceHash varbinary(8000)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON; SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
    IF @@TRANCOUNT<>0 THROW 52600,'Ambient transaction not accepted.',1;
    IF @LoginId IS NULL OR DATALENGTH(@LoginId) NOT BETWEEN 3 AND 64 OR @LoginId COLLATE Latin1_General_100_BIN2 LIKE '%[^a-z0-9@._-]%'
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
INSERT gp.SchemaMigrations(Version,Description) VALUES('028',N'Email-shaped guard login identifiers');
COMMIT;
