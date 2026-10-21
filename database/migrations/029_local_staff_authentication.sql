/* Generic local staff identity. Reuses one credential/challenge store; legacy guard contracts remain restricted. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='028') THROW 53600,'Migration 028 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='029') THROW 53600,'Migration 029 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
CREATE TABLE gp.StaffProfiles(UserId uniqueidentifier NOT NULL CONSTRAINT PK_StaffProfiles PRIMARY KEY,StaffCode varchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT UQ_StaffProfiles_Code UNIQUE,IsActive bit NOT NULL CONSTRAINT DF_StaffProfiles_Active DEFAULT(1),CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_StaffProfiles_Created DEFAULT(SYSUTCDATETIME()),CONSTRAINT FK_StaffProfiles_User FOREIGN KEY(UserId) REFERENCES gp.Users(UserId));
INSERT gp.StaffProfiles(UserId,StaffCode) SELECT UserId,'STF-'+CONVERT(varchar(36),UserId) FROM gp.GuardCredentials;
INSERT gp.Capabilities(CapabilityCode,Description) VALUES('STAFF_CREDENTIALS_MANAGE',N'Manage local staff credentials within all target scopes');
GO
CREATE VIEW gp.StaffLocalCredentials AS SELECT UserId,LoginId,EncodedPasswordHash,CredentialVersion,IsEnabled,MustChangePassword,FailedCount,FailureWindowStartUtc,LockedUntilUtc,PasswordChangedAtUtc,CreatedAtUtc,RowVer FROM gp.GuardCredentials;
GO
CREATE FUNCTION gp._StaffLocalIdentityEligible(@UserId uniqueidentifier,@Now datetime2(3)) RETURNS bit
AS BEGIN
 IF NOT EXISTS(SELECT 1 FROM gp.Users u JOIN gp.StaffProfiles s ON s.UserId=u.UserId WHERE u.UserId=@UserId AND u.IsActive=1 AND s.IsActive=1) RETURN 0;
 IF EXISTS(SELECT 1 FROM gp.Employees WHERE UserId=@UserId) RETURN 0;
 IF NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants g LEFT JOIN gp.Locations l ON l.LocationId=g.LocationId LEFT JOIN gp.Projects p ON p.ProjectId=g.ProjectId LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=g.ProjectLocationId LEFT JOIN gp.Locations ll ON ll.LocationId=pl.LocationId LEFT JOIN gp.Projects pp ON pp.ProjectId=pl.ProjectId
 WHERE g.UserId=@UserId AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@Now AND (g.ValidUntilUtc IS NULL OR @Now<g.ValidUntilUtc)
 AND ((g.RoleCode='INDIA_ADMIN' AND g.ScopeType='INDIA') OR (g.RoleCode IN('GUARD','RECEPTION','LOCATION_ADMIN') AND g.ScopeType='LOCATION' AND l.IsActive=1) OR(g.RoleCode='PROJECT_ADMIN' AND ((g.ScopeType='PROJECT' AND p.IsActive=1) OR(g.ScopeType='PROJECT_LOCATION' AND pl.IsActive=1 AND ll.IsActive=1 AND pp.IsActive=1))))) RETURN 0;
 RETURN 1;
END;
GO
CREATE PROCEDURE gp._RequireStaffCredentialAdmin @Actor uniqueidentifier,@Target uniqueidentifier,@Now datetime2(3)
AS BEGIN
 SET NOCOUNT ON;
 IF @Actor=@Target OR gp._StaffLocalIdentityEligible(@Target,@Now)=0 THROW 52601,'Not authorized.',1;
 IF EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId WHERE g.UserId=@Actor AND g.RoleCode='INDIA_ADMIN' AND g.ScopeType='INDIA' AND c.CapabilityCode='STAFF_CREDENTIALS_MANAGE' AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@Now AND(g.ValidUntilUtc IS NULL OR @Now<g.ValidUntilUtc)) RETURN;
 IF EXISTS(SELECT 1 FROM gp.StaffRoleGrants t LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=t.ProjectLocationId WHERE t.UserId=@Target AND t.RevokedAtUtc IS NULL AND t.ValidFromUtc<=@Now AND(t.ValidUntilUtc IS NULL OR @Now<t.ValidUntilUtc)
 AND (t.ScopeType NOT IN('LOCATION','PROJECT_LOCATION') OR NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants a JOIN gp.GrantCapabilities c ON c.RoleGrantId=a.RoleGrantId JOIN gp.Locations l ON l.LocationId=a.LocationId WHERE a.UserId=@Actor AND a.RoleCode='LOCATION_ADMIN' AND a.ScopeType='LOCATION' AND l.IsActive=1 AND c.CapabilityCode='STAFF_CREDENTIALS_MANAGE' AND a.LocationId=COALESCE(t.LocationId,pl.LocationId) AND a.RevokedAtUtc IS NULL AND a.ValidFromUtc<=@Now AND(a.ValidUntilUtc IS NULL OR @Now<a.ValidUntilUtc)))) THROW 52601,'Not authorized.',1;
END;
GO
CREATE PROCEDURE gp.ManageStaffCredential
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
        EXEC gp._RequireStaffCredentialAdmin @actor,@TargetUserId,@now;
        DECLARE @resource nvarchar(255)=N'gp:guard-account:'+CONVERT(nvarchar(36),@TargetUserId);
        EXEC gp._TakeLock @resource;
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        EXEC gp._RequireStaffCredentialAdmin @actor,@TargetUserId,@now;
        IF @Action='ISSUE_SETUP'
        BEGIN
            IF EXISTS(SELECT 1 FROM gp.StaffLocalCredentials WHERE UserId=@TargetUserId AND LoginId<>@LoginId COLLATE Latin1_General_100_BIN2)
                THROW 52602,'Existing login ID cannot be renamed by reset.',1;
            IF NOT EXISTS(SELECT 1 FROM gp.StaffLocalCredentials WHERE UserId=@TargetUserId)
                INSERT gp.StaffLocalCredentials(UserId,LoginId) VALUES(@TargetUserId,@LoginId);
            ELSE UPDATE gp.StaffLocalCredentials SET CredentialVersion=CredentialVersion+1,IsEnabled=1,EncodedPasswordHash=NULL,
                MustChangePassword=1,PasswordChangedAtUtc=NULL,FailedCount=0,FailureWindowStartUtc=NULL,LockedUntilUtc=NULL WHERE UserId=@TargetUserId;
        END
        ELSE
        BEGIN
            IF NOT EXISTS(SELECT 1 FROM gp.StaffLocalCredentials WHERE UserId=@TargetUserId) THROW 52602,'Staff credential not provisioned.',1;
            UPDATE gp.StaffLocalCredentials SET CredentialVersion=CredentialVersion+1,IsEnabled=0 WHERE UserId=@TargetUserId;
        END;
        UPDATE gp.Users SET AuthorizationVersion=AuthorizationVersion+1 WHERE UserId=@TargetUserId;
        UPDATE gp.Sessions SET RevokedAtUtc=@now WHERE UserId=@TargetUserId AND RevokedAtUtc IS NULL;
        UPDATE gp.GuardSetupTickets SET UsedAtUtc=@now WHERE UserId=@TargetUserId AND UsedAtUtc IS NULL;
        SELECT @version=CredentialVersion FROM gp.StaffLocalCredentials WHERE UserId=@TargetUserId;
        IF @Action='ISSUE_SETUP'
            INSERT gp.GuardSetupTickets(TokenHash,UserId,CredentialVersion,CreatedByUserId,CreatedAtUtc,ExpiresAtUtc)
                VALUES(@SetupTokenHash,@TargetUserId,@version,@actor,@now,DATEADD(minute,15,@now));
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode)
            VALUES(@actor,CASE WHEN @Action='ISSUE_SETUP' THEN 'STAFF_SETUP_ISSUED' ELSE 'STAFF_CREDENTIAL_DISABLED' END,'USER',CONVERT(varchar(36),@TargetUserId),'SUCCESS');
        COMMIT;
        SELECT (SELECT 'OK' status,CASE WHEN @Action='ISSUE_SETUP' THEN DATEADD(minute,15,@now) END expiresAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT>0 ROLLBACK;
        THROW;
    END CATCH;
END;
GO
CREATE PROCEDURE gp.BeginStaffLogin @LoginId varchar(8000),@AttemptHash varbinary(8000),@SourceHash varbinary(8000)
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
        SELECT @user=UserId FROM gp.StaffLocalCredentials WHERE LoginId=@LoginId COLLATE Latin1_General_100_BIN2;
        IF @user IS NOT NULL
        BEGIN
            DECLARE @resource nvarchar(255)=N'gp:guard-account:'+CONVERT(nvarchar(36),@user);
            EXEC gp._TakeLock @resource;
            SET @now=SYSUTCDATETIME();
            SELECT @hash=c.EncodedPasswordHash,@version=c.CredentialVersion,@authorization=u.AuthorizationVersion
                FROM gp.StaffLocalCredentials c JOIN gp.Users u ON u.UserId=c.UserId
                WHERE c.UserId=@user AND c.IsEnabled=1 AND c.MustChangePassword=0 AND (c.LockedUntilUtc IS NULL OR c.LockedUntilUtc<=@now)
                AND gp._StaffLocalIdentityEligible(@user,@now)=1;
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
CREATE PROCEDURE gp.CompleteStaffLogin
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
        IF @now<@expires AND gp._StaffLocalIdentityEligible(@user,@now)=1 AND EXISTS(
            SELECT 1 FROM gp.StaffLocalCredentials c JOIN gp.Users u ON u.UserId=c.UserId WHERE c.UserId=@user
            AND c.IsEnabled=1 AND c.MustChangePassword=0 AND c.CredentialVersion=@version AND u.AuthorizationVersion=@authorization
            AND (c.LockedUntilUtc IS NULL OR c.LockedUntilUtc<=@now)) SET @valid=1;
        IF @valid=0 OR @PasswordVerified=0
        BEGIN
            IF @valid=1 AND @PasswordVerified=0
            BEGIN
                UPDATE gp.StaffLocalCredentials SET FailedCount=CASE WHEN FailureWindowStartUtc IS NULL OR FailureWindowStartUtc<=DATEADD(minute,-15,@now) THEN 1 ELSE FailedCount+1 END,
                    FailureWindowStartUtc=CASE WHEN FailureWindowStartUtc IS NULL OR FailureWindowStartUtc<=DATEADD(minute,-15,@now) THEN @now ELSE FailureWindowStartUtc END
                    WHERE UserId=@user;
                UPDATE gp.StaffLocalCredentials SET LockedUntilUtc=DATEADD(minute,5,@now),FailedCount=0,FailureWindowStartUtc=NULL WHERE UserId=@user AND FailedCount>=5;
            END;
            INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode)
                VALUES(@user,'STAFF_LOGIN_DENIED','USER',CONVERT(varchar(36),@user),'DENIED');
            COMMIT; SELECT N'{"status":"DENIED"}'; RETURN;
        END;
        IF @NewEncodedPasswordHash IS NOT NULL
        BEGIN
            UPDATE gp.StaffLocalCredentials SET EncodedPasswordHash=@NewEncodedPasswordHash,CredentialVersion=CredentialVersion+1,PasswordChangedAtUtc=@now WHERE UserId=@user;
            UPDATE gp.Users SET AuthorizationVersion=AuthorizationVersion+1 WHERE UserId=@user;
            SELECT @authorization=AuthorizationVersion FROM gp.Users WHERE UserId=@user;
            UPDATE gp.Sessions SET RevokedAtUtc=@now WHERE UserId=@user AND RevokedAtUtc IS NULL;
            UPDATE gp.GuardSetupTickets SET UsedAtUtc=@now WHERE UserId=@user AND UsedAtUtc IS NULL;
        END;
        UPDATE gp.StaffLocalCredentials SET FailedCount=0,FailureWindowStartUtc=NULL,LockedUntilUtc=NULL WHERE UserId=@user;
        UPDATE gp.Users SET LastLoginAtUtc=@now WHERE UserId=@user;
        INSERT gp.Sessions(SessionHash,UserId,CsrfHash,AuthorizationVersionAtIssue,LastSeenAtUtc,IdleExpiresAtUtc,AbsoluteExpiresAtUtc,CreatedAtUtc)
            VALUES(@SessionHash,@user,@CsrfHash,@authorization,@now,DATEADD(minute,15,@now),DATEADD(hour,8,@now),@now);
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode)
            VALUES(@user,CASE WHEN @NewEncodedPasswordHash IS NULL THEN 'STAFF_LOGIN_SUCCEEDED' ELSE 'STAFF_PASSWORD_CHANGED' END,'USER',CONVERT(varchar(36),@user),'SUCCESS');
        COMMIT;
        SELECT (SELECT 'OK' status,DATEADD(minute,15,@now) idleExpiresAtUtc,DATEADD(hour,8,@now) absoluteExpiresAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH;
END;
GO
CREATE PROCEDURE gp.InspectStaffSetup @TokenHash varbinary(8000),@SourceHash varbinary(8000)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON; SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
    IF @@TRANCOUNT<>0 THROW 52600,'Ambient transaction not accepted.',1;
    IF @TokenHash IS NULL OR DATALENGTH(@TokenHash)<>32 THROW 52602,'Invalid authentication input.',1;
    DECLARE @now datetime2(3),@allowed bit,@ready bit=0;
    BEGIN TRY
        BEGIN TRANSACTION; EXEC gp._TakeLock N'gp:authorization','Shared'; SET @now=SYSUTCDATETIME();
        EXEC gp._GuardSourceBudget @SourceHash,@now,@allowed OUTPUT;
        IF @allowed=1 AND EXISTS(SELECT 1 FROM gp.GuardSetupTickets t JOIN gp.StaffLocalCredentials c ON c.UserId=t.UserId
            WHERE t.TokenHash=@TokenHash AND t.UsedAtUtc IS NULL AND t.CreatedAtUtc<=@now AND @now<t.ExpiresAtUtc
            AND c.CredentialVersion=t.CredentialVersion AND c.IsEnabled=1 AND gp._StaffLocalIdentityEligible(c.UserId,@now)=1) SET @ready=1;
        COMMIT; SELECT (SELECT CASE WHEN @ready=1 THEN 'READY' ELSE 'DENIED' END status FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH;
END;
GO
CREATE PROCEDURE gp.CompleteStaffSetup @TokenHash varbinary(8000),@SourceHash varbinary(8000),@NewEncodedPasswordHash varchar(8000)
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
        IF NOT EXISTS(SELECT 1 FROM gp.GuardSetupTickets t JOIN gp.StaffLocalCredentials c ON c.UserId=t.UserId
            WHERE t.TokenHash=@TokenHash AND t.UsedAtUtc IS NULL AND t.CreatedAtUtc<=@now AND @now<t.ExpiresAtUtc
            AND c.CredentialVersion=t.CredentialVersion AND c.IsEnabled=1 AND gp._StaffLocalIdentityEligible(c.UserId,@now)=1)
            BEGIN COMMIT; SELECT N'{"status":"DENIED"}'; RETURN; END;
        UPDATE gp.StaffLocalCredentials SET EncodedPasswordHash=@NewEncodedPasswordHash,MustChangePassword=0,PasswordChangedAtUtc=@now,
            CredentialVersion=CredentialVersion+1,FailedCount=0,FailureWindowStartUtc=NULL,LockedUntilUtc=NULL WHERE UserId=@user;
        UPDATE gp.Users SET AuthorizationVersion=AuthorizationVersion+1 WHERE UserId=@user;
        UPDATE gp.GuardSetupTickets SET UsedAtUtc=@now WHERE UserId=@user AND UsedAtUtc IS NULL;
        UPDATE gp.Sessions SET RevokedAtUtc=@now WHERE UserId=@user AND RevokedAtUtc IS NULL;
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode)
            VALUES(@user,'STAFF_PASSWORD_SETUP','USER',CONVERT(varchar(36),@user),'SUCCESS');
        COMMIT; SELECT N'{"status":"OK"}';
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH;
END;
GO
CREATE PROCEDURE gp.TouchStaffSession @SessionHash varbinary(8000),@CsrfHash varbinary(8000)
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
        IF gp._StaffLocalIdentityEligible(@user,@now)=0 OR NOT EXISTS(SELECT 1 FROM gp.StaffLocalCredentials WHERE UserId=@user AND IsEnabled=1 AND MustChangePassword=0)
            THROW 52601,'Not authorized.',1;
        UPDATE gp.Sessions SET LastSeenAtUtc=@now,IdleExpiresAtUtc=CASE WHEN DATEADD(minute,15,@now)<AbsoluteExpiresAtUtc THEN DATEADD(minute,15,@now) ELSE AbsoluteExpiresAtUtc END
            WHERE SessionHash=@SessionHash;
        COMMIT; SELECT N'{"status":"OK"}';
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH;
END;
GO
CREATE PROCEDURE gp.RevokeStaffSession @SessionHash varbinary(8000),@CsrfHash varbinary(8000)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON; SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
    IF @@TRANCOUNT<>0 THROW 52600,'Ambient transaction not accepted.',1;
    IF @SessionHash IS NULL OR DATALENGTH(@SessionHash)<>32 OR @CsrfHash IS NULL OR DATALENGTH(@CsrfHash)<>32 THROW 52602,'Invalid authentication input.',1;
    BEGIN TRY
        BEGIN TRANSACTION; EXEC gp._TakeLock N'gp:authorization','Shared';
        DECLARE @user uniqueidentifier=(SELECT s.UserId FROM gp.Sessions s JOIN gp.StaffLocalCredentials c ON c.UserId=s.UserId WHERE s.SessionHash=@SessionHash AND s.CsrfHash=@CsrfHash);
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
ALTER FUNCTION gp._RoleCapabilityAllowed(@Role varchar(24),@Capability varchar(40)) RETURNS bit
AS
BEGIN
    RETURN CASE
      WHEN @Role COLLATE Latin1_General_100_BIN2='GUARD' AND @Capability COLLATE Latin1_General_100_BIN2 IN('VISITS_READ','PROJECT_MOVEMENT','TEMP_ID_MOVEMENT','RECONCILE_EXIT') THEN 1
      WHEN @Role COLLATE Latin1_General_100_BIN2='RECEPTION' AND @Capability COLLATE Latin1_General_100_BIN2 IN('VISITS_READ','PASS_PRINT','PASS_REISSUE') THEN 1
      WHEN @Role COLLATE Latin1_General_100_BIN2='PROJECT_ADMIN' AND @Capability COLLATE Latin1_General_100_BIN2 IN('VISITS_READ','GUARDS_MANAGE','REPORTS_READ','REPORTS_EXPORT','AUDIT_READ') THEN 1
      WHEN @Role COLLATE Latin1_General_100_BIN2='LOCATION_ADMIN' AND @Capability COLLATE Latin1_General_100_BIN2 IN('VISITS_READ','GUARDS_MANAGE','REPORTS_READ','REPORTS_EXPORT','AUDIT_READ','GUARD_CREDENTIALS_MANAGE','STAFF_CREDENTIALS_MANAGE') THEN 1
      WHEN @Role COLLATE Latin1_General_100_BIN2='INDIA_ADMIN' AND @Capability COLLATE Latin1_General_100_BIN2 IN('VISITS_READ','GUARDS_MANAGE','REPORTS_READ','REPORTS_EXPORT','AUDIT_READ','GUARD_CREDENTIALS_MANAGE','STAFF_CREDENTIALS_MANAGE','ROLE_GRANTS_MANAGE') THEN 1
      ELSE 0 END;
END;
GO
ALTER PROCEDURE gp._RequireActor
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
      AND s.AuthorizationVersionAtIssue=u.AuthorizationVersion
      AND NOT EXISTS(SELECT 1 FROM gp.StaffProfiles sp LEFT JOIN gp.StaffLocalCredentials c ON c.UserId=sp.UserId WHERE sp.UserId=u.UserId AND(sp.IsActive=0 OR c.UserId IS NULL OR c.IsEnabled=0 OR c.MustChangePassword=1));
    IF @Actor IS NULL THROW 52001, 'Not authorized.', 1;
END;
GO
CREATE ROLE gp_staff_auth_runtime;
DENY SELECT,INSERT,UPDATE,DELETE,ALTER ON SCHEMA::gp TO gp_staff_auth_runtime;
GRANT EXECUTE ON gp.BeginStaffLogin TO gp_staff_auth_runtime;
GRANT EXECUTE ON gp.CompleteStaffLogin TO gp_staff_auth_runtime;
GRANT EXECUTE ON gp.InspectStaffSetup TO gp_staff_auth_runtime;
GRANT EXECUTE ON gp.CompleteStaffSetup TO gp_staff_auth_runtime;
GRANT EXECUTE ON gp.TouchStaffSession TO gp_staff_auth_runtime;
GRANT EXECUTE ON gp.RevokeStaffSession TO gp_staff_auth_runtime;
GRANT EXECUTE ON gp.ManageStaffCredential TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('029',N'Independent local staff identities and scoped credential management');
COMMIT;
