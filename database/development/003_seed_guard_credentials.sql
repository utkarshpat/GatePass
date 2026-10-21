/* Explicit local test enrollment only. No role/capability/assignment is created or restored. */
SET NOCOUNT ON;SET XACT_ABORT ON;
IF DB_NAME()<>N'GatePass_DesignTest' OR @@TRANCOUNT<>0 OR NOT EXISTS(SELECT 1 FROM sys.extended_properties WHERE class=0 AND name=N'GatePass.DevelopmentDirectoryMarker' AND CONVERT(nvarchar(100),value)=N'SYNTHETIC-DIRECTORY-V1') THROW 53600,'Dedicated synthetic database required.',1;
DECLARE @rows table(GuardId varchar(6) NOT NULL,LoginId varchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL,EncodedHash varchar(128) COLLATE Latin1_General_100_BIN2 NOT NULL);
INSERT @rows SELECT GuardId,LoginId,EncodedHash FROM OPENJSON(@Fixtures) WITH(GuardId varchar(6),LoginId varchar(64),EncodedHash varchar(128));
IF (SELECT COUNT(*) FROM @rows)<>12 OR EXISTS(SELECT GuardId FROM @rows GROUP BY GuardId HAVING COUNT(*)<>1) OR EXISTS(SELECT 1 FROM @rows WHERE GuardId NOT LIKE 'GRD[0-9][0-9][0-9]' OR TRY_CONVERT(int,RIGHT(GuardId,3)) NOT BETWEEN 1 AND 12 OR LoginId<>CONCAT('gaurd',CONVERT(varchar(2),CONVERT(int,RIGHT(GuardId,3))),'@example.com') COLLATE Latin1_General_100_BIN2 OR gp._GuardPasswordHashValid(EncodedHash)=0) THROW 53600,'Invalid synthetic guard fixture.',1;
BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
 IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='029') THROW 53600,'Generic staff identity migration required before current fixture enrollment.',1;
 DECLARE @actor uniqueidentifier=(SELECT UserId FROM gp.Users WHERE IdentityIssuer=N'urn:gatepass:development-directory' AND IdentitySubject=N'local-seed'),@now datetime2(3)=SYSUTCDATETIME();
 IF @actor IS NULL OR EXISTS(SELECT 1 FROM @rows r LEFT JOIN gp.Users u ON u.IdentityIssuer=N'urn:gatepass:development-directory' AND u.IdentitySubject=(N'guard:'+r.GuardId) COLLATE Latin1_General_100_BIN2 WHERE u.UserId IS NULL OR gp._GuardIdentityEligible(u.UserId,@now)=0) THROW 53600,'Guard fixture identity unavailable.',1;
 INSERT gp.StaffProfiles(UserId,StaffCode) SELECT u.UserId,r.GuardId FROM @rows r JOIN gp.Users u ON u.IdentityIssuer=N'urn:gatepass:development-directory' AND u.IdentitySubject=(N'guard:'+r.GuardId) COLLATE Latin1_General_100_BIN2 WHERE NOT EXISTS(SELECT 1 FROM gp.StaffProfiles p WHERE p.UserId=u.UserId);
 IF EXISTS(SELECT 1 FROM @rows r JOIN gp.Users u ON u.IdentityIssuer=N'urn:gatepass:development-directory' AND u.IdentitySubject=(N'guard:'+r.GuardId) COLLATE Latin1_General_100_BIN2 JOIN gp.GuardCredentials c ON c.UserId=u.UserId WHERE c.LoginId<>r.LoginId OR c.EncodedPasswordHash<>r.EncodedHash) THROW 53600,'Existing credentials differ; explicit reset required.',1;
 DECLARE @created table(UserId uniqueidentifier);
 INSERT gp.GuardCredentials(UserId,LoginId,EncodedPasswordHash,MustChangePassword,PasswordChangedAtUtc)
 OUTPUT inserted.UserId INTO @created
 SELECT u.UserId,r.LoginId,r.EncodedHash,0,@now FROM @rows r JOIN gp.Users u ON u.IdentityIssuer=N'urn:gatepass:development-directory' AND u.IdentitySubject=(N'guard:'+r.GuardId) COLLATE Latin1_General_100_BIN2 WHERE NOT EXISTS(SELECT 1 FROM gp.GuardCredentials c WHERE c.UserId=u.UserId);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode) SELECT @actor,'DEV_GUARD_ENROLLED','USER',CONVERT(nvarchar(36),UserId),'SUCCESS' FROM @created;
 DECLARE @count int=(SELECT COUNT(*) FROM @created);
 COMMIT;SELECT (SELECT @count created,12 total FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
