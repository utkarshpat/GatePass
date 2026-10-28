#Requires -Version 7.0
[CmdletBinding()]param([Parameter(Mandatory)][guid]$RunId,[ValidateSet('Create','ProjectOnly','Expire','Inspect','AuthState','Cleanup')][string]$Action)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
if($Action -eq 'Cleanup'){& "$PSScriptRoot/AdminConsoleFixture.ps1" -RunId $RunId -Action Cleanup;exit}
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $root 'tools/GatePass.LocalSql.psm1') -Force
$prefix='GP02-'+$RunId.ToString('N').Substring(0,20).ToUpperInvariant()
if($Action -eq 'Create'){$f=(& "$PSScriptRoot/AdminConsoleFixture.ps1" -RunId $RunId -Action Create)|ConvertFrom-Json}
$db=Open-GatePassLocalSql -TrustLocalServerCertificate
try{
 # Match the SQL-owned identity subject exactly, including its GUID character case.
 # IdentitySubject is case-sensitive; a PowerShell-uppercase reconstruction can create no credentials.
 $prefix=if($Action -eq 'Create'){$f.prefix}else{Invoke-GatePassScalar $db "SELECT 'GP02-'+LEFT(REPLACE(CONVERT(varchar(36),@run),'-',''),20);" @{run=$RunId}}
 if($Action -eq 'Create'){
  $raw=[Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($RunId.ToString('N')+':group-boundary'))
  $extra=(Invoke-GatePassScalar $db @'
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
INSERT gp.StaffProfiles(UserId,StaffCode) SELECT UserId,@prefix+'-'+RIGHT(IdentitySubject,6) FROM gp.Users WHERE IdentityIssuer='gatepass-phase02-fixture' AND IdentitySubject IN(@prefix+':GUARD2',@prefix+':RECEPTION');
INSERT gp.GuardCredentials(UserId,LoginId,EncodedPasswordHash,MustChangePassword,PasswordChangedAtUtc)
SELECT u.UserId,LOWER(@prefix)+CASE WHEN u.IdentitySubject LIKE '%:GUARD2' THEN '-guard' ELSE '-reception' END+'@example.invalid',c.EncodedPasswordHash,0,SYSUTCDATETIME()
FROM gp.Users u CROSS JOIN gp.GuardCredentials c WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject IN(@prefix+':GUARD2',@prefix+':RECEPTION') AND c.LoginId='admin2@example.com';
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT g.RoleGrantId,'VISITS_READ' FROM gp.StaffRoleGrants g JOIN gp.Users u ON u.UserId=g.UserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject=@prefix+':RECEPTION';
DECLARE @admin uniqueidentifier=(SELECT UserId FROM gp.Users WHERE IdentityIssuer='gatepass-phase02-fixture' AND IdentitySubject=@prefix+':ADMIN');
INSERT gp.ProjectGroups(LocationId,GroupName,CreatedByUserId) VALUES(@foreign,@prefix+' Foreign Entry',@admin);DECLARE @group bigint=SCOPE_IDENTITY();
INSERT gp.ProjectGroupMembers SELECT @group,pl.ProjectLocationId FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId WHERE pl.LocationId=@foreign AND p.ExternalProjectCode=@prefix+'-A';
UPDATE p SET CredentialHash=HASHBYTES('SHA2_256',@raw) FROM gp.AccessPasses p JOIN gp.VisitRequests v ON v.VisitRequestId=p.VisitRequestId WHERE v.PublicReference LIKE @prefix+'-%' AND v.PersonName=N'Synthetic OTHER_PAIR';
COMMIT;
SELECT CONVERT(varchar(20),@group) foreignGroup,CONVERT(varchar(20),(SELECT pl.ProjectLocationId FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId WHERE pl.LocationId=@local AND p.ExternalProjectCode=@prefix+'-B')) beta,
(SELECT VisitRequestId FROM gp.VisitRequests WHERE PublicReference LIKE @prefix+'-%' AND PersonName=N'Synthetic OTHER_PAIR') visitId
FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;
'@ @{prefix=$prefix;raw=$raw;foreign=[int]$f.otherLocationId;local=[int](Invoke-GatePassScalar $db "SELECT LocationId FROM gp.Locations WHERE LocationCode='NOIDA';")})|ConvertFrom-Json
  $f|Add-Member -NotePropertyName foreignGroup -NotePropertyValue $extra.foreignGroup
  $f|Add-Member -NotePropertyName beta -NotePropertyValue $extra.beta
  $f|Add-Member -NotePropertyName visitId -NotePropertyValue $extra.visitId
  $f|Add-Member -NotePropertyName credential -NotePropertyValue ([Convert]::ToBase64String($raw).TrimEnd('=').Replace('+','-').Replace('/','_'))
  $f|Add-Member -NotePropertyName guardLogin -NotePropertyValue ($prefix.ToLowerInvariant()+'-guard@example.invalid')
  $f|Add-Member -NotePropertyName receptionLogin -NotePropertyValue ($prefix.ToLowerInvariant()+'-reception@example.invalid')
  $f|ConvertTo-Json -Compress
 }elseif($Action -eq 'AuthState'){
  # Owned test identities and numeric budget state only: no hashes, passwords, tokens or real users.
  Invoke-GatePassScalar $db @'
SELECT (SELECT COUNT(*) FROM gp.GuardCredentials c JOIN gp.Users u ON u.UserId=c.UserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject LIKE @prefix+':%') credentials,
(SELECT COUNT(*) FROM gp.GuardCredentials c JOIN gp.Users u ON u.UserId=c.UserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject LIKE @prefix+':%' AND gp._StaffLocalIdentityEligible(u.UserId,SYSUTCDATETIME())=1 AND c.IsEnabled=1 AND c.MustChangePassword=0 AND(c.LockedUntilUtc IS NULL OR c.LockedUntilUtc<=SYSUTCDATETIME())) eligibleCredentials,
(SELECT MAX(s.RequestCount) FROM gp.GuardAuthSources s JOIN gp.GuardLoginAttempts a ON a.SourceHash=s.SourceHash JOIN gp.Users u ON u.UserId=a.UserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject LIKE @prefix+':%') sourceRequests,
(SELECT MAX(DATEDIFF(second,SYSUTCDATETIME(),DATEADD(second,61,s.WindowStartUtc))) FROM gp.GuardAuthSources s JOIN gp.GuardLoginAttempts a ON a.SourceHash=s.SourceHash JOIN gp.Users u ON u.UserId=a.UserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject LIKE @prefix+':%') sourceResetInSeconds,
-- Before this fixture's first login there is no owned attempt to identify its source.
-- Read only the maximum remaining saturated window; never expose a source hash or reset limits.
(SELECT MAX(DATEDIFF(second,SYSUTCDATETIME(),DATEADD(second,61,WindowStartUtc))) FROM gp.GuardAuthSources WHERE RequestCount=20 AND WindowStartUtc>DATEADD(second,-60,SYSUTCDATETIME())) saturatedResetInSeconds
FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;
'@ @{prefix=$prefix}
 }elseif($Action -eq 'Inspect'){
  Invoke-GatePassScalar $db @'
SELECT (SELECT COUNT(*) FROM gp.AccessEvents e JOIN gp.VisitRequests v ON v.VisitRequestId=e.VisitRequestId WHERE v.PublicReference LIKE @prefix+'-%') accessEvents,
(SELECT COUNT(*) FROM gp.VisitPresence p JOIN gp.VisitRequests v ON v.VisitRequestId=p.VisitRequestId WHERE v.PublicReference LIKE @prefix+'-%' AND p.IsInside=1) visitsInside,
JSON_QUERY((SELECT g.* FROM gp.ProjectGroups g JOIN gp.Users u ON u.UserId=g.CreatedByUserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject=@prefix+':ADMIN' ORDER BY g.ProjectGroupId FOR JSON PATH)) groups,
JSON_QUERY((SELECT m.* FROM gp.ProjectGroupMembers m JOIN gp.ProjectGroups g ON g.ProjectGroupId=m.ProjectGroupId JOIN gp.Users u ON u.UserId=g.CreatedByUserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject=@prefix+':ADMIN' ORDER BY m.ProjectGroupId,m.ProjectLocationId FOR JSON PATH)) members,
JSON_QUERY((SELECT b.* FROM gp.ProjectGroupGuardAssignments b JOIN gp.ProjectGroups g ON g.ProjectGroupId=b.ProjectGroupId JOIN gp.Users u ON u.UserId=g.CreatedByUserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject=@prefix+':ADMIN' ORDER BY b.GroupAssignmentId FOR JSON PATH)) bindings,
JSON_QUERY((SELECT a.* FROM gp.GuardAssignments a JOIN gp.ProjectGroupGuardAssignments b ON b.GroupAssignmentId=a.GroupAssignmentId JOIN gp.ProjectGroups g ON g.ProjectGroupId=b.ProjectGroupId JOIN gp.Users u ON u.UserId=g.CreatedByUserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject=@prefix+':ADMIN' ORDER BY a.GuardAssignmentId FOR JSON PATH)) children
FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;
'@ @{prefix=$prefix}
 }elseif($Action -eq 'ProjectOnly'){
  Invoke-GatePassNonQuery $db @'
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
UPDATE g SET RoleCode='PROJECT_ADMIN',ScopeType='PROJECT_LOCATION',LocationId=NULL,ProjectLocationId=pl.ProjectLocationId FROM gp.StaffRoleGrants g JOIN gp.Users u ON u.UserId=g.UserId CROSS JOIN gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject=@prefix+':ADMIN' AND p.ExternalProjectCode=@prefix+'-A' AND pl.LocationId=1;
COMMIT;
'@ @{prefix=$prefix}
 }else{Invoke-GatePassNonQuery $db "UPDATE s SET CreatedAtUtc=DATEADD(hour,-2,SYSUTCDATETIME()),LastSeenAtUtc=DATEADD(minute,-2,SYSUTCDATETIME()),IdleExpiresAtUtc=DATEADD(second,-1,SYSUTCDATETIME()) FROM gp.Sessions s JOIN gp.Users u ON u.UserId=s.UserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject=@prefix+':ADMIN';" @{prefix=$prefix}}
}finally{$db.Dispose()}
