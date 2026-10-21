#Requires -Version 7.0
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
if($env:NODE_ENV -notin @('development','test') -or $env:GATEPASS_DIRECTORY_MODE -ne 'mock'){throw 'Explicit synthetic development mode required.'}
Import-Module (Join-Path $PSScriptRoot 'GatePass.LocalSql.psm1') -Force
$taskInput=[Console]::In.ReadToEnd();if($taskInput.Length -gt 32768){throw 'Oversized fixture input.'}
$taskConnection=Open-GatePassLocalSql -TrustLocalServerCertificate
try{
 $taskSql=@'
SET NOCOUNT ON;SET XACT_ABORT ON;
IF DB_NAME()<>N'GatePass_DesignTest' OR NOT EXISTS(SELECT 1 FROM sys.extended_properties WHERE class=0 AND name=N'GatePass.DevelopmentDirectoryMarker' AND CONVERT(nvarchar(100),value)=N'SYNTHETIC-DIRECTORY-V1') THROW 53600,'Synthetic local database required.',1;
DECLARE @rows table(LoginId varchar(64) COLLATE Latin1_General_100_BIN2 PRIMARY KEY,OldHash varchar(128) COLLATE Latin1_General_100_BIN2,NewHash varchar(128) COLLATE Latin1_General_100_BIN2);
INSERT @rows SELECT loginId,oldHash,newHash FROM OPENJSON(@Input) WITH(loginId varchar(64),oldHash varchar(128),newHash varchar(128));
IF (SELECT COUNT(*) FROM @rows)<>22 OR EXISTS(SELECT 1 FROM @rows WHERE NewHash NOT LIKE '$argon2id$v=19$m=19456,t=2,p=1$%' OR LEN(NewHash)<>97) THROW 53600,'Exact fixture set required.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
IF EXISTS(SELECT 1 FROM @rows r LEFT JOIN gp.StaffLocalCredentials c ON c.LoginId=r.LoginId LEFT JOIN gp.Users u ON u.UserId=c.UserId LEFT JOIN gp.StaffProfiles p ON p.UserId=u.UserId WHERE c.UserId IS NULL OR c.EncodedPasswordHash<>r.OldHash OR c.IsEnabled<>1 OR u.IsActive<>1 OR p.IsActive<>1 OR p.UserId IS NULL OR u.IdentityIssuer NOT IN(N'urn:gatepass:development-directory',N'urn:gatepass:development-staff') OR EXISTS(SELECT 1 FROM gp.Employees e WHERE e.UserId=u.UserId)) THROW 53600,'Fixture identity or credential mismatch.',1;
DECLARE @now datetime2(3)=SYSUTCDATETIME(),@actor uniqueidentifier=(SELECT UserId FROM gp.Users WHERE IdentityIssuer=N'urn:gatepass:development-directory' AND IdentitySubject=N'local-seed');
IF @actor IS NULL THROW 53600,'Development seed identity required.',1;
UPDATE c SET EncodedPasswordHash=r.NewHash,CredentialVersion=CredentialVersion+1,MustChangePassword=0,PasswordChangedAtUtc=@now,FailedCount=0,FailureWindowStartUtc=NULL,LockedUntilUtc=NULL FROM gp.StaffLocalCredentials c JOIN @rows r ON r.LoginId=c.LoginId;
UPDATE u SET AuthorizationVersion=AuthorizationVersion+1 FROM gp.Users u JOIN gp.StaffLocalCredentials c ON c.UserId=u.UserId JOIN @rows r ON r.LoginId=c.LoginId;
UPDATE s SET RevokedAtUtc=@now FROM gp.Sessions s JOIN gp.StaffLocalCredentials c ON c.UserId=s.UserId JOIN @rows r ON r.LoginId=c.LoginId WHERE s.RevokedAtUtc IS NULL;
INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode) SELECT @actor,'DEV_TEST_PASSWORD_RESET','USER',CONVERT(varchar(36),c.UserId),'SUCCESS' FROM gp.StaffLocalCredentials c JOIN @rows r ON r.LoginId=c.LoginId;
COMMIT;SELECT N'{"updated":22}';
'@
 [Console]::Out.Write((Invoke-GatePassScalar $taskConnection $taskSql @{Input=$taskInput}))
}catch{[Console]::Out.Write((@{failed=$true;number=$_.Exception.GetBaseException().Number;line=$_.Exception.GetBaseException().LineNumber}|ConvertTo-Json -Compress));exit 1}finally{$taskConnection.Dispose()}
