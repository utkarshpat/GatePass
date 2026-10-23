#Requires -Version 7.0
[CmdletBinding()]param([Parameter(Mandatory)][guid]$RunId,[ValidateSet('Create','Cleanup')][string]$Action)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $root 'tools/GatePass.LocalSql.psm1') -Force
$db=Open-GatePassLocalSql -TrustLocalServerCertificate
try {
 if($Action -eq 'Create'){
  $f=(Invoke-GatePassScalar $db (Get-Content (Join-Path $root 'database/tests/002_transaction_fixtures.sql') -Raw) @{RunId=$RunId})|ConvertFrom-Json
  $admin=$f.actors.Where({$_.Label -eq 'ADMIN'})[0];$login='audit-'+$RunId.ToString('N')+'@example.invalid'
  Invoke-GatePassNonQuery $db @'
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT @grant,Code FROM(VALUES('ROLE_GRANTS_MANAGE'),('VISITS_READ'),('REPORTS_READ'),('AUDIT_READ'),('STAFF_CREDENTIALS_MANAGE')) x(Code);
INSERT gp.StaffProfiles(UserId,StaffCode) VALUES(@id,@code);
INSERT gp.GuardCredentials(UserId,LoginId,EncodedPasswordHash,MustChangePassword,PasswordChangedAtUtc)
SELECT @id,@login,EncodedPasswordHash,0,SYSUTCDATETIME() FROM gp.GuardCredentials WHERE LoginId='admin2@example.com';
COMMIT;
'@ @{id=[guid]$admin.UserId;grant=[long]$admin.GrantId;code=$f.prefix;login=$login}
  @{login=$login;otherLocationId=$f.otherLocationId;pair=[string]$f.projectLocationId;project=[string]$f.projectId;prefix=$f.prefix;host=$f.actors.Where({$_.Label -eq 'OTHERHOST'})[0].UserId;guard=$f.actors.Where({$_.Label -eq 'GUARD2'})[0].UserId}|ConvertTo-Json -Compress
 }else{
  Invoke-GatePassNonQuery $db @'
DECLARE @prefix varchar(30)='GP02-'+LEFT(REPLACE(CONVERT(varchar(36),@run),'-',''),20);
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
DELETE c FROM gp.GuardLoginAttempts c JOIN gp.Users u ON u.UserId=c.UserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject LIKE @prefix+':%';
DELETE c FROM gp.GuardSetupTickets c JOIN gp.Users u ON u.UserId=c.UserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject LIKE @prefix+':%';
DELETE c FROM gp.GuardCredentials c JOIN gp.Users u ON u.UserId=c.UserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject LIKE @prefix+':%';
DELETE s FROM gp.StaffProfiles s JOIN gp.Users u ON u.UserId=s.UserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject LIKE @prefix+':%';
COMMIT;
'@ @{run=$RunId}
  Invoke-GatePassNonQuery $db (Get-Content (Join-Path $root 'database/tests/003_transaction_cleanup.sql') -Raw) @{RunId=$RunId}
 }
}finally{$db.Dispose()}
