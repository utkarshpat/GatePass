/* Guard ID/password authentication. No passwords, accounts or service logins seeded.
   Auth verifier is a trusted server component, separate from the general API.
   Apply all parsed batches on one connection; rollback the transaction on error. */
SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52600,'Ambient transaction not accepted.',1;
IF DB_NAME() IN(N'master',N'model',N'msdb',N'tempdb') THROW 52600,'Select the application database.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='005') THROW 52600,'Migration 005 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='006') THROW 52600,'Migration 006 already applied.',1;
BEGIN TRANSACTION;
CREATE TABLE gp.GuardCredentials (
    UserId uniqueidentifier NOT NULL,
    LoginId varchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
    EncodedPasswordHash varchar(128) COLLATE Latin1_General_100_BIN2 NULL,
    CredentialVersion bigint NOT NULL CONSTRAINT DF_GuardCredentials_Version DEFAULT (1),
    IsEnabled bit NOT NULL CONSTRAINT DF_GuardCredentials_Enabled DEFAULT (1),
    MustChangePassword bit NOT NULL CONSTRAINT DF_GuardCredentials_MustChange DEFAULT (1),
    FailedCount int NOT NULL CONSTRAINT DF_GuardCredentials_Failed DEFAULT (0),
    FailureWindowStartUtc datetime2(3) NULL,
    LockedUntilUtc datetime2(3) NULL,
    PasswordChangedAtUtc datetime2(3) NULL,
    CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_GuardCredentials_Created DEFAULT (SYSUTCDATETIME()),
    RowVer rowversion NOT NULL,
    CONSTRAINT PK_GuardCredentials PRIMARY KEY (UserId),
    CONSTRAINT UQ_GuardCredentials_Login UNIQUE (LoginId),
    CONSTRAINT CK_GuardCredentials_Login CHECK (DATALENGTH(LoginId) BETWEEN 3 AND 64 AND DATALENGTH(LoginId)=LEN(LoginId) AND LoginId NOT LIKE '%[^a-z0-9._-]%' AND LoginId NOT LIKE '[^a-z0-9]%'),
    CONSTRAINT CK_GuardCredentials_Version CHECK (CredentialVersion>0),
    CONSTRAINT CK_GuardCredentials_Failed CHECK (FailedCount BETWEEN 0 AND 5),
    CONSTRAINT CK_GuardCredentials_PasswordState CHECK ((EncodedPasswordHash IS NULL AND MustChangePassword=1 AND PasswordChangedAtUtc IS NULL) OR (EncodedPasswordHash IS NOT NULL AND MustChangePassword=0 AND PasswordChangedAtUtc IS NOT NULL))
);
CREATE TABLE gp.GuardSetupTickets (
    TokenHash varbinary(32) NOT NULL,
    UserId uniqueidentifier NOT NULL,
    CredentialVersion bigint NOT NULL,
    CreatedByUserId uniqueidentifier NOT NULL,
    CreatedAtUtc datetime2(3) NOT NULL,
    ExpiresAtUtc datetime2(3) NOT NULL,
    UsedAtUtc datetime2(3) NULL,
    CONSTRAINT PK_GuardSetupTickets PRIMARY KEY (TokenHash),
    CONSTRAINT CK_GuardSetupTickets_Hash CHECK (DATALENGTH(TokenHash) = 32),
    CONSTRAINT CK_GuardSetupTickets_Version CHECK (CredentialVersion>0),
    CONSTRAINT CK_GuardSetupTickets_Time CHECK (ExpiresAtUtc>CreatedAtUtc AND (UsedAtUtc IS NULL OR UsedAtUtc>=CreatedAtUtc))
);
CREATE INDEX IX_GuardSetup_User ON gp.GuardSetupTickets(UserId,ExpiresAtUtc);
CREATE TABLE gp.GuardLoginAttempts (
    AttemptHash varbinary(32) NOT NULL,
    UserId uniqueidentifier NOT NULL,
    SourceHash varbinary(32) NOT NULL,
    CredentialVersion bigint NOT NULL,
    AuthorizationVersion bigint NOT NULL,
    CreatedAtUtc datetime2(3) NOT NULL,
    ExpiresAtUtc datetime2(3) NOT NULL,
    UsedAtUtc datetime2(3) NULL,
    CONSTRAINT PK_GuardLoginAttempts PRIMARY KEY (AttemptHash),
    CONSTRAINT CK_GuardLoginAttempts_Hash CHECK (DATALENGTH(AttemptHash) = 32 AND DATALENGTH(SourceHash) = 32),
    CONSTRAINT CK_GuardLoginAttempts_Version CHECK (CredentialVersion>0 AND AuthorizationVersion>0),
    CONSTRAINT CK_GuardLoginAttempts_Time CHECK (ExpiresAtUtc>CreatedAtUtc AND (UsedAtUtc IS NULL OR UsedAtUtc>=CreatedAtUtc))
);
CREATE INDEX IX_GuardLogin_User ON gp.GuardLoginAttempts(UserId,ExpiresAtUtc) INCLUDE (UsedAtUtc);
CREATE INDEX IX_GuardLogin_Expiry ON gp.GuardLoginAttempts(ExpiresAtUtc);
CREATE TABLE gp.GuardAuthSources (
    SourceHash varbinary(32) NOT NULL,
    WindowStartUtc datetime2(3) NOT NULL,
    RequestCount int NOT NULL,
    LastSeenAtUtc datetime2(3) NOT NULL,
    CONSTRAINT PK_GuardAuthSources PRIMARY KEY (SourceHash),
    CONSTRAINT CK_GuardAuthSources_Hash CHECK (DATALENGTH(SourceHash) = 32),
    CONSTRAINT CK_GuardAuthSources_Count CHECK (RequestCount BETWEEN 1 AND 20),
    CONSTRAINT CK_GuardAuthSources_Time CHECK (LastSeenAtUtc>=WindowStartUtc)
);
CREATE INDEX IX_GuardAuthSources_Seen ON gp.GuardAuthSources(LastSeenAtUtc);
ALTER TABLE gp.GuardCredentials WITH CHECK ADD CONSTRAINT FK_GuardCredentials_User FOREIGN KEY (UserId) REFERENCES gp.Users(UserId);
ALTER TABLE gp.GuardSetupTickets WITH CHECK ADD CONSTRAINT FK_GuardSetupTickets_Credential FOREIGN KEY (UserId) REFERENCES gp.GuardCredentials(UserId);
ALTER TABLE gp.GuardSetupTickets WITH CHECK ADD CONSTRAINT FK_GuardSetupTickets_Creator FOREIGN KEY (CreatedByUserId) REFERENCES gp.Users(UserId);
ALTER TABLE gp.GuardLoginAttempts WITH CHECK ADD CONSTRAINT FK_GuardLoginAttempts_Credential FOREIGN KEY (UserId) REFERENCES gp.GuardCredentials(UserId);
INSERT gp.Capabilities(CapabilityCode,Description) VALUES('GUARD_CREDENTIALS_MANAGE',N'Provision/reset/disable guard password identity within all affected guard locations');
GO
CREATE FUNCTION gp._GuardPasswordHashValid(@Encoded varchar(8000)) RETURNS bit
AS
BEGIN
    DECLARE @prefix varchar(80)='$argon2id$v=19$m=19456,t=2,p=1$';
    IF @Encoded IS NULL OR DATALENGTH(@Encoded)<>LEN(@prefix)+22+1+43 RETURN 0;
    IF LEFT(@Encoded,LEN(@prefix)) COLLATE Latin1_General_100_BIN2<>@prefix RETURN 0;
    IF SUBSTRING(@Encoded,LEN(@prefix)+23,1)<>'$' RETURN 0;
    IF SUBSTRING(@Encoded,LEN(@prefix)+1,22) COLLATE Latin1_General_100_BIN2 LIKE '%[^A-Za-z0-9+/]%' RETURN 0;
    IF RIGHT(@Encoded,43) COLLATE Latin1_General_100_BIN2 LIKE '%[^A-Za-z0-9+/]%' RETURN 0;
    RETURN 1;
END;
GO
CREATE FUNCTION gp._GuardIdentityEligible(@UserId uniqueidentifier,@Now datetime2(3)) RETURNS bit
AS
BEGIN
    IF NOT EXISTS(SELECT 1 FROM gp.Users WHERE UserId=@UserId AND IsActive=1) RETURN 0;
    IF EXISTS(SELECT 1 FROM gp.Employees WHERE UserId=@UserId) RETURN 0;
    IF EXISTS(SELECT 1 FROM gp.StaffRoleGrants WHERE UserId=@UserId AND RevokedAtUtc IS NULL
        AND ValidFromUtc<=@Now AND (ValidUntilUtc IS NULL OR @Now<ValidUntilUtc) AND RoleCode<>'GUARD') RETURN 0;
    IF NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.Locations l ON l.LocationId=g.LocationId
        WHERE g.UserId=@UserId AND g.RoleCode='GUARD' AND g.ScopeType='LOCATION' AND l.IsActive=1
        AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@Now AND (g.ValidUntilUtc IS NULL OR @Now<g.ValidUntilUtc)) RETURN 0;
    RETURN 1;
END;
GO
CREATE PROCEDURE gp._GuardSourceBudget @SourceHash varbinary(8000),@Now datetime2(3),@Allowed bit OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    IF @SourceHash IS NULL OR DATALENGTH(@SourceHash)<>32 THROW 52602,'Invalid authentication input.',1;
    DECLARE @resource nvarchar(255)=N'gp:guard-source:'+CONVERT(varchar(64),@SourceHash,2);
    EXEC gp._TakeLock @resource;
    SET @Now=SYSUTCDATETIME();
    SET @Allowed=0;
    IF NOT EXISTS(SELECT 1 FROM gp.GuardAuthSources WHERE SourceHash=@SourceHash)
    BEGIN
        INSERT gp.GuardAuthSources(SourceHash,WindowStartUtc,RequestCount,LastSeenAtUtc) VALUES(@SourceHash,@Now,1,@Now);
        SET @Allowed=1; RETURN;
    END;
    UPDATE gp.GuardAuthSources SET WindowStartUtc=@Now,RequestCount=1,LastSeenAtUtc=@Now
        WHERE SourceHash=@SourceHash AND WindowStartUtc<=DATEADD(second,-60,@Now);
    IF @@ROWCOUNT=1 BEGIN SET @Allowed=1; RETURN; END;
    UPDATE gp.GuardAuthSources SET RequestCount=RequestCount+1,LastSeenAtUtc=@Now
        WHERE SourceHash=@SourceHash AND RequestCount<20;
    IF @@ROWCOUNT=1 SET @Allowed=1;
END;
GO
CREATE PROCEDURE gp._RequireGuardCredentialAdmin @Actor uniqueidentifier,@Target uniqueidentifier,@Now datetime2(3)
AS
BEGIN
    SET NOCOUNT ON;
    -- Credential changes affect all guard locations, so require authority over every
    -- current location. A project admin cannot reset a location-wide identity.
    IF EXISTS(SELECT 1 FROM gp.Employees WHERE UserId=@Target)
       OR EXISTS(SELECT 1 FROM gp.StaffRoleGrants WHERE UserId=@Target AND RevokedAtUtc IS NULL AND ValidFromUtc<=@Now
          AND (ValidUntilUtc IS NULL OR @Now<ValidUntilUtc) AND RoleCode<>'GUARD')
       OR NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants WHERE UserId=@Target AND RoleCode='GUARD' AND ScopeType='LOCATION'
          AND RevokedAtUtc IS NULL AND ValidFromUtc<=@Now AND (ValidUntilUtc IS NULL OR @Now<ValidUntilUtc))
        THROW 52601,'Not authorized.',1;
    IF EXISTS(SELECT 1 FROM gp.StaffRoleGrants target WHERE target.UserId=@Target AND target.RoleCode='GUARD'
       AND target.ScopeType='LOCATION' AND target.RevokedAtUtc IS NULL AND target.ValidFromUtc<=@Now
       AND (target.ValidUntilUtc IS NULL OR @Now<target.ValidUntilUtc) AND NOT EXISTS(
          SELECT 1 FROM gp.StaffRoleGrants a JOIN gp.GrantCapabilities c ON c.RoleGrantId=a.RoleGrantId
          WHERE a.UserId=@Actor AND c.CapabilityCode='GUARD_CREDENTIALS_MANAGE' AND a.RevokedAtUtc IS NULL
          AND a.ValidFromUtc<=@Now AND (a.ValidUntilUtc IS NULL OR @Now<a.ValidUntilUtc)
          AND ((a.RoleCode='INDIA_ADMIN' AND a.ScopeType='INDIA') OR
               (a.RoleCode='LOCATION_ADMIN' AND a.ScopeType='LOCATION' AND a.LocationId=target.LocationId))))
        THROW 52601,'Not authorized.',1;
END;
GO
CREATE PROCEDURE gp.ManageGuardCredential
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@TargetUserId uniqueidentifier,
    @Action varchar(40),@LoginId varchar(8000)=NULL,@SetupTokenHash varbinary(8000)=NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON; SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
    IF @@TRANCOUNT<>0 THROW 52600,'Ambient transaction not accepted.',1;
    IF @TargetUserId IS NULL OR @Action IS NULL OR @Action COLLATE Latin1_General_100_BIN2 NOT IN('ISSUE_SETUP','DISABLE') THROW 52602,'Invalid authentication input.',1;
    IF @Action='ISSUE_SETUP' AND (@LoginId IS NULL OR DATALENGTH(@LoginId) NOT BETWEEN 3 AND 64
       OR DATALENGTH(@LoginId)<>LEN(@LoginId) OR @LoginId COLLATE Latin1_General_100_BIN2 LIKE '%[^a-z0-9._-]%' OR @LoginId COLLATE Latin1_General_100_BIN2 LIKE '[^a-z0-9]%'
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
CREATE PROCEDURE gp.BeginGuardLogin @LoginId varchar(8000),@AttemptHash varbinary(8000),@SourceHash varbinary(8000)
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
            IF @hash IS NOT NULL AND (SELECT COUNT(*) FROM gp.GuardLoginAttempts WHERE UserId=@user AND UsedAtUtc IS NULL AND @now<ExpiresAtUtc)<2
                INSERT gp.GuardLoginAttempts(AttemptHash,UserId,SourceHash,CredentialVersion,AuthorizationVersion,CreatedAtUtc,ExpiresAtUtc)
                    VALUES(@AttemptHash,@user,@SourceHash,@version,@authorization,@now,DATEADD(second,60,@now));
            ELSE SET @hash=NULL;
        END;
        COMMIT;
        -- Server-only response. Never forward encoded hashes or attempt handles to browser.
        SELECT (SELECT CASE WHEN @hash IS NULL THEN 'DENIED' ELSE 'READY' END status,@hash encodedPasswordHash FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH;
END;
GO
CREATE PROCEDURE gp.CompleteGuardLogin
    @AttemptHash varbinary(8000),@SourceHash varbinary(8000),@PasswordVerified bit,
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@NewEncodedPasswordHash varchar(8000)=NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON; SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
    IF @@TRANCOUNT<>0 THROW 52600,'Ambient transaction not accepted.',1;
    IF @AttemptHash IS NULL OR DATALENGTH(@AttemptHash)<>32 OR @SourceHash IS NULL OR DATALENGTH(@SourceHash)<>32
       OR @SessionHash IS NULL OR DATALENGTH(@SessionHash)<>32 OR @CsrfHash IS NULL OR DATALENGTH(@CsrfHash)<>32 OR @PasswordVerified IS NULL
       OR (@NewEncodedPasswordHash IS NOT NULL AND gp._GuardPasswordHashValid(@NewEncodedPasswordHash)=0) THROW 52602,'Invalid authentication input.',1;
    DECLARE @now datetime2(3),@user uniqueidentifier,@version bigint,@authorization bigint,@expires datetime2(3),@used datetime2(3),@valid bit=0;
    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @mode varchar(32)=CASE WHEN @NewEncodedPasswordHash IS NULL THEN 'Shared' ELSE 'Exclusive' END;
        EXEC gp._TakeLock N'gp:authorization',@mode; SET @now=SYSUTCDATETIME();
        -- Initial lookup ends before waiting on the account lock (no row-lock inversion).
        SELECT @user=UserId FROM gp.GuardLoginAttempts WHERE AttemptHash=@AttemptHash AND SourceHash=@SourceHash;
        IF @user IS NULL BEGIN COMMIT; SELECT N'{"status":"DENIED"}'; RETURN; END;
        DECLARE @resource nvarchar(255)=N'gp:guard-account:'+CONVERT(nvarchar(36),@user);
        EXEC gp._TakeLock @resource;
        SET @now=SYSUTCDATETIME();
        SELECT @version=CredentialVersion,@authorization=AuthorizationVersion,@expires=ExpiresAtUtc,@used=UsedAtUtc
            FROM gp.GuardLoginAttempts WHERE AttemptHash=@AttemptHash AND SourceHash=@SourceHash;
        IF @used IS NOT NULL BEGIN COMMIT; SELECT N'{"status":"DENIED"}'; RETURN; END;
        UPDATE gp.GuardLoginAttempts SET UsedAtUtc=@now WHERE AttemptHash=@AttemptHash;
        IF @now<@expires AND gp._GuardIdentityEligible(@user,@now)=1 AND EXISTS(
            SELECT 1 FROM gp.GuardCredentials c JOIN gp.Users u ON u.UserId=c.UserId WHERE c.UserId=@user
            AND c.IsEnabled=1 AND c.MustChangePassword=0 AND c.CredentialVersion=@version AND u.AuthorizationVersion=@authorization
            AND (c.LockedUntilUtc IS NULL OR c.LockedUntilUtc<=@now)) SET @valid=1;
        IF @valid=0 OR @PasswordVerified=0
        BEGIN
            IF @valid=1 AND @PasswordVerified=0
            BEGIN
                UPDATE gp.GuardCredentials SET FailedCount=CASE WHEN FailureWindowStartUtc IS NULL OR FailureWindowStartUtc<=DATEADD(minute,-15,@now) THEN 1 ELSE FailedCount+1 END,
                    FailureWindowStartUtc=CASE WHEN FailureWindowStartUtc IS NULL OR FailureWindowStartUtc<=DATEADD(minute,-15,@now) THEN @now ELSE FailureWindowStartUtc END
                    WHERE UserId=@user;
                UPDATE gp.GuardCredentials SET LockedUntilUtc=DATEADD(minute,5,@now),FailedCount=0,FailureWindowStartUtc=NULL WHERE UserId=@user AND FailedCount>=5;
            END;
            INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode)
                VALUES(@user,'GUARD_LOGIN_DENIED','USER',CONVERT(varchar(36),@user),'DENIED');
            COMMIT; SELECT N'{"status":"DENIED"}'; RETURN;
        END;
        IF @NewEncodedPasswordHash IS NOT NULL
        BEGIN
            UPDATE gp.GuardCredentials SET EncodedPasswordHash=@NewEncodedPasswordHash,CredentialVersion=CredentialVersion+1,PasswordChangedAtUtc=@now WHERE UserId=@user;
            UPDATE gp.Users SET AuthorizationVersion=AuthorizationVersion+1 WHERE UserId=@user;
            SELECT @authorization=AuthorizationVersion FROM gp.Users WHERE UserId=@user;
            UPDATE gp.Sessions SET RevokedAtUtc=@now WHERE UserId=@user AND RevokedAtUtc IS NULL;
            UPDATE gp.GuardSetupTickets SET UsedAtUtc=@now WHERE UserId=@user AND UsedAtUtc IS NULL;
        END;
        UPDATE gp.GuardCredentials SET FailedCount=0,FailureWindowStartUtc=NULL,LockedUntilUtc=NULL WHERE UserId=@user;
        UPDATE gp.Users SET LastLoginAtUtc=@now WHERE UserId=@user;
        INSERT gp.Sessions(SessionHash,UserId,CsrfHash,AuthorizationVersionAtIssue,LastSeenAtUtc,IdleExpiresAtUtc,AbsoluteExpiresAtUtc,CreatedAtUtc)
            VALUES(@SessionHash,@user,@CsrfHash,@authorization,@now,DATEADD(minute,15,@now),DATEADD(hour,8,@now),@now);
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode)
            VALUES(@user,CASE WHEN @NewEncodedPasswordHash IS NULL THEN 'GUARD_LOGIN_SUCCEEDED' ELSE 'GUARD_PASSWORD_CHANGED' END,'USER',CONVERT(varchar(36),@user),'SUCCESS');
        COMMIT;
        SELECT (SELECT 'OK' status,DATEADD(minute,15,@now) idleExpiresAtUtc,DATEADD(hour,8,@now) absoluteExpiresAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH;
END;
GO
CREATE PROCEDURE gp.InspectGuardSetup @TokenHash varbinary(8000),@SourceHash varbinary(8000)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON; SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
    IF @@TRANCOUNT<>0 THROW 52600,'Ambient transaction not accepted.',1;
    IF @TokenHash IS NULL OR DATALENGTH(@TokenHash)<>32 THROW 52602,'Invalid authentication input.',1;
    DECLARE @now datetime2(3),@allowed bit,@ready bit=0;
    BEGIN TRY
        BEGIN TRANSACTION; EXEC gp._TakeLock N'gp:authorization','Shared'; SET @now=SYSUTCDATETIME();
        EXEC gp._GuardSourceBudget @SourceHash,@now,@allowed OUTPUT;
        IF @allowed=1 AND EXISTS(SELECT 1 FROM gp.GuardSetupTickets t JOIN gp.GuardCredentials c ON c.UserId=t.UserId
            WHERE t.TokenHash=@TokenHash AND t.UsedAtUtc IS NULL AND t.CreatedAtUtc<=@now AND @now<t.ExpiresAtUtc
            AND c.CredentialVersion=t.CredentialVersion AND c.IsEnabled=1 AND gp._GuardIdentityEligible(c.UserId,@now)=1) SET @ready=1;
        COMMIT; SELECT (SELECT CASE WHEN @ready=1 THEN 'READY' ELSE 'DENIED' END status FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH;
END;
GO
CREATE PROCEDURE gp.CompleteGuardSetup @TokenHash varbinary(8000),@SourceHash varbinary(8000),@NewEncodedPasswordHash varchar(8000)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON; SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
    IF @@TRANCOUNT<>0 THROW 52600,'Ambient transaction not accepted.',1;
    IF @TokenHash IS NULL OR DATALENGTH(@TokenHash)<>32 OR gp._GuardPasswordHashValid(@NewEncodedPasswordHash)=0 THROW 52602,'Invalid authentication input.',1;
    DECLARE @now datetime2(3),@allowed bit,@user uniqueidentifier;
    BEGIN TRY
        BEGIN TRANSACTION; EXEC gp._TakeLock N'gp:authorization','Exclusive'; SET @now=SYSUTCDATETIME();
        EXEC gp._GuardSourceBudget @SourceHash,@now,@allowed OUTPUT;
        IF @allowed=0 BEGIN COMMIT; SELECT N'{"status":"THROTTLED"}'; RETURN; END;
        SELECT @user=UserId FROM gp.GuardSetupTickets WHERE TokenHash=@TokenHash;
        IF @user IS NULL BEGIN COMMIT; SELECT N'{"status":"DENIED"}'; RETURN; END;
        DECLARE @resource nvarchar(255)=N'gp:guard-account:'+CONVERT(nvarchar(36),@user);
        EXEC gp._TakeLock @resource;
        SET @now=SYSUTCDATETIME();
        IF NOT EXISTS(SELECT 1 FROM gp.GuardSetupTickets t JOIN gp.GuardCredentials c ON c.UserId=t.UserId
            WHERE t.TokenHash=@TokenHash AND t.UsedAtUtc IS NULL AND t.CreatedAtUtc<=@now AND @now<t.ExpiresAtUtc
            AND c.CredentialVersion=t.CredentialVersion AND c.IsEnabled=1 AND gp._GuardIdentityEligible(c.UserId,@now)=1)
            BEGIN COMMIT; SELECT N'{"status":"DENIED"}'; RETURN; END;
        UPDATE gp.GuardCredentials SET EncodedPasswordHash=@NewEncodedPasswordHash,MustChangePassword=0,PasswordChangedAtUtc=@now,
            CredentialVersion=CredentialVersion+1,FailedCount=0,FailureWindowStartUtc=NULL,LockedUntilUtc=NULL WHERE UserId=@user;
        UPDATE gp.Users SET AuthorizationVersion=AuthorizationVersion+1 WHERE UserId=@user;
        UPDATE gp.GuardSetupTickets SET UsedAtUtc=@now WHERE UserId=@user AND UsedAtUtc IS NULL;
        UPDATE gp.Sessions SET RevokedAtUtc=@now WHERE UserId=@user AND RevokedAtUtc IS NULL;
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode)
            VALUES(@user,'GUARD_PASSWORD_SETUP','USER',CONVERT(varchar(36),@user),'SUCCESS');
        COMMIT; SELECT N'{"status":"OK"}';
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH;
END;
GO
CREATE PROCEDURE gp.TouchGuardSession @SessionHash varbinary(8000),@CsrfHash varbinary(8000)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON; SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
    IF @@TRANCOUNT<>0 THROW 52600,'Ambient transaction not accepted.',1;
    DECLARE @user uniqueidentifier,@now datetime2(3);
    BEGIN TRY
        BEGIN TRANSACTION; EXEC gp._TakeLock N'gp:authorization','Shared';
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@user OUTPUT,@now OUTPUT;
        DECLARE @resource nvarchar(255)=N'gp:guard-account:'+CONVERT(nvarchar(36),@user);
        EXEC gp._TakeLock @resource;
        -- Recheck after lock wait; password change also takes Shared authorization.
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@user OUTPUT,@now OUTPUT;
        IF gp._GuardIdentityEligible(@user,@now)=0 OR NOT EXISTS(SELECT 1 FROM gp.GuardCredentials WHERE UserId=@user AND IsEnabled=1 AND MustChangePassword=0)
            THROW 52601,'Not authorized.',1;
        UPDATE gp.Sessions SET LastSeenAtUtc=@now,IdleExpiresAtUtc=CASE WHEN DATEADD(minute,15,@now)<AbsoluteExpiresAtUtc THEN DATEADD(minute,15,@now) ELSE AbsoluteExpiresAtUtc END
            WHERE SessionHash=@SessionHash;
        COMMIT; SELECT N'{"status":"OK"}';
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH;
END;
GO
CREATE PROCEDURE gp.RevokeGuardSession @SessionHash varbinary(8000),@CsrfHash varbinary(8000)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON; SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
    IF @@TRANCOUNT<>0 THROW 52600,'Ambient transaction not accepted.',1;
    IF @SessionHash IS NULL OR DATALENGTH(@SessionHash)<>32 OR @CsrfHash IS NULL OR DATALENGTH(@CsrfHash)<>32 THROW 52602,'Invalid authentication input.',1;
    BEGIN TRY
        BEGIN TRANSACTION; EXEC gp._TakeLock N'gp:authorization','Shared';
        DECLARE @user uniqueidentifier=(SELECT s.UserId FROM gp.Sessions s JOIN gp.GuardCredentials c ON c.UserId=s.UserId WHERE s.SessionHash=@SessionHash AND s.CsrfHash=@CsrfHash);
        IF @user IS NOT NULL
        BEGIN
            DECLARE @resource nvarchar(255)=N'gp:guard-account:'+CONVERT(nvarchar(36),@user);
            EXEC gp._TakeLock @resource;
            UPDATE gp.Sessions SET RevokedAtUtc=SYSUTCDATETIME() WHERE SessionHash=@SessionHash AND CsrfHash=@CsrfHash AND RevokedAtUtc IS NULL;
        END;
        COMMIT; SELECT N'{"status":"OK"}';
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH;
END;
GO
CREATE PROCEDURE gp.PurgeGuardAuthTransient @BatchSize int=500
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON; SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
    IF @@TRANCOUNT<>0 THROW 52600,'Ambient transaction not accepted.',1;
    IF @BatchSize IS NULL OR @BatchSize NOT BETWEEN 1 AND 1000 THROW 52602,'Invalid authentication input.',1;
    BEGIN TRY
        BEGIN TRANSACTION; EXEC gp._TakeLock N'gp:authorization','Exclusive';
        DECLARE @cutoff datetime2(3)=DATEADD(hour,-24,SYSUTCDATETIME()),@attempts int,@tickets int,@sources int;
        DELETE TOP(@BatchSize) FROM gp.GuardLoginAttempts WHERE ExpiresAtUtc<@cutoff; SET @attempts=@@ROWCOUNT;
        DELETE TOP(@BatchSize) FROM gp.GuardSetupTickets WHERE ExpiresAtUtc<@cutoff; SET @tickets=@@ROWCOUNT;
        DELETE TOP(@BatchSize) FROM gp.GuardAuthSources WHERE LastSeenAtUtc<@cutoff; SET @sources=@@ROWCOUNT;
        COMMIT;
        SELECT (SELECT @attempts attemptsDeleted,@tickets ticketsDeleted,@sources sourcesDeleted FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH;
END;
GO
-- A compromised auth verifier can falsely attest a password. Keep its SQL role,
-- code/configuration and connection pool separate; no browser may call these.
CREATE ROLE gp_guard_auth_runtime AUTHORIZATION dbo;
DENY SELECT,INSERT,UPDATE,DELETE,ALTER ON SCHEMA::gp TO gp_guard_auth_runtime;
GRANT EXECUTE ON gp.BeginGuardLogin TO gp_guard_auth_runtime;
GRANT EXECUTE ON gp.CompleteGuardLogin TO gp_guard_auth_runtime;
GRANT EXECUTE ON gp.InspectGuardSetup TO gp_guard_auth_runtime;
GRANT EXECUTE ON gp.CompleteGuardSetup TO gp_guard_auth_runtime;
GRANT EXECUTE ON gp.TouchGuardSession TO gp_guard_auth_runtime;
GRANT EXECUTE ON gp.RevokeGuardSession TO gp_guard_auth_runtime;
GRANT EXECUTE ON gp.ManageGuardCredential TO gp_api_runtime;
GRANT EXECUTE ON gp.PurgeGuardAuthTransient TO gp_worker_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('006',N'Individual guard password credentials, fenced login/setup, rate limits and scoped administration');
COMMIT;
