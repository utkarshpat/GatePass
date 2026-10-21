#Requires -Version 7.0
[CmdletBinding()]param([switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskDb=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate
$taskRun=[guid]::NewGuid().ToString('N');$taskIssuer='urn:gatepass:staff-auth-test:'+$taskRun
$taskAuth='gp_staff_test_'+$taskRun;$taskApi='gp_staff_api_'+$taskRun
$taskSources=[Collections.Generic.List[string]]::new();$taskChecks=[Collections.Generic.List[string]]::new();$taskUsers=@{};$taskSessions=@{}
# SQL contract tests attest verification only. Live HTTP tests use real Argon2 passwords separately.
$taskHash='$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
function New-Hash {return ,([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))}
function Source-Hash {$taskSource=New-Hash;$taskSources.Add([Convert]::ToHexString($taskSource));return ,$taskSource}
function Check([string]$Name,[scriptblock]$Action){& $Action;$taskChecks.Add($Name);Write-Output ('PASS: '+$Name)}
function Assert($Condition,[string]$Message='Assertion failed'){if(-not $Condition){throw $Message}}
function Denied([scriptblock]$Action,[int]$Code=52601){try{$null=& $Action}catch{if($_.Exception.GetBaseException().Number -eq $Code){return};throw};throw "Expected SQL denial $Code"}
function Rpc([string]$Role,[string]$Name,[hashtable]$Parameters){
 $taskArgs=($Parameters.Keys|ForEach-Object{'@'+$_+'=@'+$_}) -join ','
 Invoke-GatePassNonQuery $taskDb "EXECUTE AS USER='$Role';"
 try{return (Invoke-GatePassScalar $taskDb ('EXEC '+$Name+' '+$taskArgs) $Parameters)|ConvertFrom-Json}finally{Invoke-GatePassNonQuery $taskDb 'REVERT;'}
}
function Sign-In([string]$Name){
 $taskAttempt=New-Hash;$taskSource=Source-Hash;$taskSession=New-Hash;$taskCsrf=New-Hash
 $taskChallenge=Rpc $taskAuth 'gp.BeginStaffLogin' @{LoginId=$taskUsers[$Name].login;AttemptHash=$taskAttempt;SourceHash=$taskSource}
 Assert ($taskChallenge.status -eq 'READY') ('Challenge denied for '+$Name)
 $taskLogin=Rpc $taskAuth 'gp.CompleteStaffLogin' @{AttemptHash=$taskAttempt;SourceHash=$taskSource;PasswordVerified=$true;SessionHash=$taskSession;CsrfHash=$taskCsrf;NewEncodedPasswordHash=$null}
 Assert ($taskLogin.status -eq 'OK');return @{SessionHash=$taskSession;CsrfHash=$taskCsrf}
}
function Manage([string]$Actor,[string]$Target,[string]$Action='ISSUE_SETUP'){
 $taskParameters=@{SessionHash=$taskSessions[$Actor].SessionHash;CsrfHash=$taskSessions[$Actor].CsrfHash;TargetUserId=[guid]$taskUsers[$Target].id;Action=$Action;LoginId=$taskUsers[$Target].login;SetupTokenHash=(New-Hash)}
 $taskResult=Rpc $taskApi 'gp.ManageStaffCredential' $taskParameters
 Assert ($taskResult.status -eq 'OK');return ,$taskParameters.SetupTokenHash
}
try{
 $taskLocations=(Invoke-GatePassScalar $taskDb 'SELECT LocationId,LocationCode FROM gp.Locations WHERE IsActive=1 FOR JSON PATH')|ConvertFrom-Json
 $taskNoida=($taskLocations|Where-Object LocationCode -eq 'NOIDA').LocationId;$taskPune=($taskLocations|Where-Object LocationCode -eq 'PUNE').LocationId
 $taskProject=Invoke-GatePassScalar $taskDb "SELECT ProjectId FROM gp.Projects WHERE ExternalProjectCode='DEMO-PRJ-001'"
 Assert ($taskNoida -and $taskPune -and $taskProject)
 Invoke-GatePassNonQuery $taskDb "CREATE USER [$taskAuth] WITHOUT LOGIN;ALTER ROLE gp_staff_auth_runtime ADD MEMBER [$taskAuth];CREATE USER [$taskApi] WITHOUT LOGIN;ALTER ROLE gp_api_runtime ADD MEMBER [$taskApi];"
 foreach($taskName in @('PLATFORM','INDIA','NOIDA','NO_CAP','PUNE','PROJECT','RECEPTION','MIXED','MULTI','EMPLOYEE')){
  $taskId=[guid]::NewGuid();$taskCode=('T-'+$taskRun+'-'+$taskName);$taskLogin=('t-'+$taskRun.Substring(0,12)+'-'+$taskName.ToLower())
  $taskUsers[$taskName]=@{id=$taskId;login=$taskLogin}
  Invoke-GatePassNonQuery $taskDb 'INSERT gp.Users(UserId,IdentityIssuer,IdentitySubject,DisplayName) VALUES(@Id,@Issuer,@Code,@Code);INSERT gp.StaffProfiles(UserId,StaffCode) VALUES(@Id,@Code);INSERT gp.StaffLocalCredentials(UserId,LoginId,EncodedPasswordHash,MustChangePassword,PasswordChangedAtUtc) VALUES(@Id,@Login,@Hash,0,SYSUTCDATETIME());' @{Id=$taskId;Issuer=$taskIssuer;Code=$taskCode;Login=$taskLogin;Hash=$taskHash}
  $taskRoles=@(switch($taskName){'PLATFORM'{@(@{role='PLATFORM_ADMIN';scope='PLATFORM';location=$null;project=$null;cap='STAFF_CREDENTIALS_MANAGE'})};'INDIA'{@(@{role='INDIA_ADMIN';scope='INDIA';location=$null;project=$null;cap='STAFF_CREDENTIALS_MANAGE'})};'PROJECT'{@(@{role='PROJECT_ADMIN';scope='PROJECT';location=$null;project=$taskProject;cap='VISITS_READ'})};default{@(@{role=if($taskName -in @('NOIDA','NO_CAP','PUNE')){'LOCATION_ADMIN'}else{'RECEPTION'};scope='LOCATION';location=if($taskName -eq 'PUNE'){$taskPune}else{$taskNoida};project=$null;cap=if($taskName -in @('NOIDA','PUNE')){'STAFF_CREDENTIALS_MANAGE'}else{'VISITS_READ'}})}})
  if($taskName -eq 'MIXED'){$taskRoles+=@{role='GUARD';scope='LOCATION';location=$taskNoida;project=$null;cap='PROJECT_MOVEMENT'}}
  if($taskName -eq 'MULTI'){$taskRoles+=@{role='RECEPTION';scope='LOCATION';location=$taskPune;project=$null;cap='VISITS_READ'}}
  foreach($taskRole in $taskRoles){Invoke-GatePassNonQuery $taskDb 'DECLARE @Grant bigint;INSERT gp.StaffRoleGrants(UserId,RoleCode,ScopeType,LocationId,ProjectId,GrantedByUserId,ValidFromUtc) VALUES(@Id,@Role,@Scope,@Location,@Project,@Id,SYSUTCDATETIME());SET @Grant=SCOPE_IDENTITY();INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) VALUES(@Grant,@Cap);' @{Id=$taskId;Role=$taskRole.role;Scope=$taskRole.scope;Location=$taskRole.location;Project=$taskRole.project;Cap=$taskRole.cap}}
 }
 Invoke-GatePassNonQuery $taskDb 'INSERT gp.Employees(EmployeeId,UserId,FullName,OfficialEmail,IsActive,LastSyncedAtUtc) VALUES(@Code,@Id,@Code,@Email,1,SYSUTCDATETIME());' @{Code=('STAFFTEST'+$taskRun);Id=[guid]$taskUsers.EMPLOYEE.id;Email=('stafftest'+$taskRun+'@example.invalid')}
 Invoke-GatePassNonQuery $taskDb 'DELETE gp.StaffLocalCredentials WHERE UserId=@Id;DELETE gp.StaffProfiles WHERE UserId=@Id;INSERT gp.Employees(EmployeeId,UserId,FullName,OfficialEmail,IsActive,LastSyncedAtUtc) VALUES(@Code,@Id,@Code,@Email,1,SYSUTCDATETIME());' @{Code=('STAFFPROJ'+$taskRun);Id=[guid]$taskUsers.PROJECT.id;Email=('staffproj'+$taskRun+'@example.invalid')}
 Invoke-GatePassNonQuery $taskDb "INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT g.RoleGrantId,c.Code FROM gp.StaffRoleGrants g JOIN gp.Users u ON u.UserId=g.UserId CROSS JOIN(VALUES('ROLE_GRANTS_MANAGE'),('GUARDS_MANAGE'))c(Code) WHERE u.IdentityIssuer=@Issuer AND g.RoleCode IN('PLATFORM_ADMIN','INDIA_ADMIN','LOCATION_ADMIN','PROJECT_ADMIN') AND u.DisplayName NOT LIKE '%NO_CAP' AND NOT EXISTS(SELECT 1 FROM gp.GrantCapabilities e WHERE e.RoleGrantId=g.RoleGrantId AND e.CapabilityCode=c.Code);INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT g.RoleGrantId,'VISITS_READ' FROM gp.StaffRoleGrants g WHERE g.UserId=@Mixed AND g.RoleCode='GUARD';" @{Issuer=$taskIssuer;Mixed=[guid]$taskUsers.MIXED.id}
 $taskSessions.PROJECT=@{SessionHash=(New-Hash);CsrfHash=(New-Hash)}
 Invoke-GatePassNonQuery $taskDb 'INSERT gp.Sessions(SessionHash,UserId,CsrfHash,AuthorizationVersionAtIssue,LastSeenAtUtc,IdleExpiresAtUtc,AbsoluteExpiresAtUtc,CreatedAtUtc) SELECT @SessionHash,UserId,@CsrfHash,AuthorizationVersion,SYSUTCDATETIME(),DATEADD(hour,1,SYSUTCDATETIME()),DATEADD(hour,2,SYSUTCDATETIME()),SYSUTCDATETIME() FROM gp.Users WHERE UserId=@Id;' @{Id=[guid]$taskUsers.PROJECT.id;SessionHash=$taskSessions.PROJECT.SessionHash;CsrfHash=$taskSessions.PROJECT.CsrfHash}

 foreach($taskName in @('PLATFORM','INDIA','NOIDA','NO_CAP','PUNE','RECEPTION','MIXED','MULTI')){$taskSessions[$taskName]=Sign-In $taskName}
 Check 'External reception, local admins and mixed guard/reception authenticate; project admin uses an employee session' {Assert ($taskSessions.Count -eq 9);Assert ((Invoke-GatePassScalar $taskDb 'SELECT COUNT(*) FROM gp.Employees e JOIN gp.Users u ON u.UserId=e.UserId WHERE u.IdentityIssuer=@Issuer' @{Issuer=$taskIssuer}) -eq 2)}
 Check 'Employee identities cannot obtain local staff password sessions' {$taskResult=Rpc $taskAuth 'gp.BeginStaffLogin' @{LoginId=$taskUsers.EMPLOYEE.login;AttemptHash=(New-Hash);SourceHash=(Source-Hash)};Assert ($taskResult.status -eq 'DENIED')}
 Check 'Auth principal cannot read password storage or manage credentials' {Denied {Invoke-GatePassNonQuery $taskDb "EXECUTE AS USER='$taskAuth';SELECT * FROM gp.StaffLocalCredentials;"} 229;Invoke-GatePassNonQuery $taskDb 'REVERT;';Denied {Rpc $taskAuth 'gp.ManageStaffCredential' @{SessionHash=$taskSessions.INDIA.SessionHash;CsrfHash=$taskSessions.INDIA.CsrfHash;TargetUserId=[guid]$taskUsers.RECEPTION.id;Action='DISABLE'}} 229}
 Check 'API principal cannot call the password verifier' {Denied {Rpc $taskApi 'gp.BeginStaffLogin' @{LoginId=$taskUsers.RECEPTION.login;AttemptHash=(New-Hash);SourceHash=(Source-Hash)}} 229}
 Check 'Reception scope stays in its assigned office' {$taskContext=Rpc $taskApi 'gp.GetReceptionContext' $taskSessions.RECEPTION;Assert ($taskContext.locations.Count -eq 1);Assert ($taskContext.locations[0].locationId -eq $taskNoida)}
 Check 'Project lead has an employee identity and cannot acquire a local-password session' {$taskChallenge=Rpc $taskAuth 'gp.BeginStaffLogin' @{LoginId=$taskUsers.PROJECT.login;AttemptHash=(New-Hash);SourceHash=(Source-Hash)};Assert ($taskChallenge.status -eq 'DENIED')}
 $taskPair=Invoke-GatePassScalar $taskDb 'SELECT ProjectLocationId FROM gp.ProjectLocations WHERE ProjectId=@Project AND LocationId=@Location' @{Project=$taskProject;Location=$taskNoida}
 $taskPunePair=Invoke-GatePassScalar $taskDb 'SELECT ProjectLocationId FROM gp.ProjectLocations WHERE ProjectId=@Project AND LocationId=@Location' @{Project=$taskProject;Location=$taskPune}
 function Grant-Role([string]$Actor,[string]$Role='PROJECT_ADMIN',[string]$Scope='PROJECT_LOCATION',$Location=$null,$Project=$null,$Pair=$taskPair,[string]$Target='EMPLOYEE'){
  return Rpc $taskApi 'gp.GrantStaffRole' @{SessionHash=$taskSessions[$Actor].SessionHash;CsrfHash=$taskSessions[$Actor].CsrfHash;ClientKey=[guid]::NewGuid();TargetUserId=[guid]$taskUsers[$Target].id;RoleCode=$Role;ScopeType=$Scope;LocationId=$Location;ProjectId=$Project;ProjectLocationId=$Pair;CapabilitiesJson='["VISITS_READ"]';Reason='Owned delegated-role test'}
 }
 Check 'Noida admin cannot grant project-wide, another office, India or Platform authority' {Denied {Grant-Role 'NOIDA' -Scope 'PROJECT' -Project $taskProject -Pair $null} 52001;Denied {Grant-Role 'NOIDA' -Pair $taskPunePair} 52001;Denied {Grant-Role 'NOIDA' -Role 'INDIA_ADMIN' -Scope 'INDIA' -Pair $null} 52001;Denied {Grant-Role 'NOIDA' -Role 'PLATFORM_ADMIN' -Scope 'PLATFORM' -Pair $null} 52001}
 Check 'Noida admin can appoint an internal project lead only for the Noida project location' {$script:taskLeadGrant=Grant-Role 'NOIDA';Assert ($taskLeadGrant.status -eq 'GRANTED')}
 Check 'Role reads disclose only the delegatable location scope' {$taskPage=Rpc $taskApi 'gp.ListStaffRoles' @{SessionHash=$taskSessions.NOIDA.SessionHash;CsrfHash=$taskSessions.NOIDA.CsrfHash;TargetUserId=[guid]$taskUsers.MULTI.id};Assert ($taskPage.grants.Count -eq 1);Assert ($taskPage.grants[0].locationId -eq $taskNoida)}
 Check 'Scoped administrator cannot revoke a project lead in another office' {Denied {Rpc $taskApi 'gp.RevokeStaffRole' @{SessionHash=$taskSessions.PUNE.SessionHash;CsrfHash=$taskSessions.PUNE.CsrfHash;ClientKey=[guid]::NewGuid();RoleGrantId=[long]$taskLeadGrant.roleGrantId;Reason='Cross-location denial'}} 52001}
 Check 'Project admin can appoint a co-lead inside their project scope' {$taskResult=Grant-Role 'PROJECT' -Scope 'PROJECT' -Project $taskProject -Pair $null;Assert ($taskResult.status -eq 'GRANTED')}
 Check 'A project lead target must be an employee, not external staff' {Denied {Grant-Role 'INDIA' -Scope 'PROJECT' -Project $taskProject -Pair $null -Target 'RECEPTION'} 52004}
 Check 'India admin cannot promote anybody to Platform or peer India admin' {Denied {Grant-Role 'INDIA' -Role 'PLATFORM_ADMIN' -Scope 'PLATFORM' -Pair $null} 52001;Denied {Grant-Role 'INDIA' -Role 'INDIA_ADMIN' -Scope 'INDIA' -Pair $null} 52001}
 Check 'Platform admin can appoint an India admin using an existing internal identity' {$taskResult=Grant-Role 'PLATFORM' -Role 'INDIA_ADMIN' -Scope 'INDIA' -Pair $null;Assert ($taskResult.status -eq 'GRANTED')}
 Check 'Location delegation can be revoked without restoring access through retry' {$taskRevoke=@{SessionHash=$taskSessions.NOIDA.SessionHash;CsrfHash=$taskSessions.NOIDA.CsrfHash;ClientKey=[guid]::NewGuid();RoleGrantId=[long]$taskLeadGrant.roleGrantId;Reason='Owned lead assignment ended'};Assert ((Rpc $taskApi 'gp.RevokeStaffRole' $taskRevoke).revoked)}
 Check 'Dual guard/reception staff can be allocated a project without gaining admin scope' {$taskResult=Rpc $taskApi 'gp.AllocateGuard' @{SessionHash=$taskSessions.INDIA.SessionHash;CsrfHash=$taskSessions.INDIA.CsrfHash;ClientKey=[guid]::NewGuid();GuardUserId=[guid]$taskUsers.MIXED.id;ProjectLocationId=$taskPair;Reason='Dual reception/guard cover'};Assert ($taskResult.status -eq 'ALLOCATED')}
 Check 'Missing credential-management capability denies reset' {Denied {Manage 'NO_CAP' 'RECEPTION'}}
 Check 'A location admin cannot reset staff from another office' {Denied {Manage 'PUNE' 'RECEPTION'}}
 Check 'A location admin cannot reset a staff account spanning additional offices' {Denied {Manage 'NOIDA' 'MULTI'}}
 Check 'A project admin cannot reset a location-wide staff identity' {Denied {Manage 'PROJECT' 'RECEPTION'}}
 Check 'A location admin cannot reset an India or project-wide administrator' {Denied {Manage 'NOIDA' 'INDIA'};Denied {Manage 'NOIDA' 'PROJECT'}}
 Check 'Credential administrators cannot use admin reset on their own account' {Denied {Manage 'INDIA' 'INDIA'}}
 Check 'A location admin can reset eligible reception in that same office' {$script:taskTicket=Manage 'NOIDA' 'RECEPTION';Denied {Rpc $taskApi 'gp.GetStaffAccessContext' $taskSessions.RECEPTION} 52001}
 Check 'Setup accepts one valid ticket once and does not issue a session' {$taskResult=Rpc $taskAuth 'gp.CompleteStaffSetup' @{TokenHash=$taskTicket;SourceHash=(Source-Hash);NewEncodedPasswordHash=$taskHash};Assert ($taskResult.status -eq 'OK');$taskReplay=Rpc $taskAuth 'gp.CompleteStaffSetup' @{TokenHash=$taskTicket;SourceHash=(Source-Hash);NewEncodedPasswordHash=$taskHash};Assert ($taskReplay.status -eq 'DENIED');$taskSessions.RECEPTION=Sign-In 'RECEPTION'}
 Check 'India admin can reset multi-office staff without changing roles' {$taskBefore=Invoke-GatePassScalar $taskDb 'SELECT COUNT(*) FROM gp.StaffRoleGrants WHERE UserId=@Id AND RevokedAtUtc IS NULL' @{Id=[guid]$taskUsers.MULTI.id};$null=Manage 'INDIA' 'MULTI';Assert ((Invoke-GatePassScalar $taskDb 'SELECT COUNT(*) FROM gp.StaffRoleGrants WHERE UserId=@Id AND RevokedAtUtc IS NULL' @{Id=[guid]$taskUsers.MULTI.id}) -eq $taskBefore)}
 Check 'Deactivating a staff profile immediately blocks an existing authorized session' {Invoke-GatePassNonQuery $taskDb 'UPDATE gp.StaffProfiles SET IsActive=0 WHERE UserId=@Id' @{Id=[guid]$taskUsers.RECEPTION.id};Denied {Rpc $taskApi 'gp.GetStaffAccessContext' $taskSessions.RECEPTION} 52001;Invoke-GatePassNonQuery $taskDb 'UPDATE gp.StaffProfiles SET IsActive=1 WHERE UserId=@Id' @{Id=[guid]$taskUsers.RECEPTION.id}}
 Check 'Credential disable revokes all prior reception sessions and prevents login' {$null=Manage 'INDIA' 'RECEPTION' 'DISABLE';Denied {Rpc $taskApi 'gp.GetStaffAccessContext' $taskSessions.RECEPTION} 52001;$taskChallenge=Rpc $taskAuth 'gp.BeginStaffLogin' @{LoginId=$taskUsers.RECEPTION.login;AttemptHash=(New-Hash);SourceHash=(Source-Hash)};Assert ($taskChallenge.status -eq 'DENIED')}
 Check 'Revoked staff role blocks an in-flight login challenge' {$taskAttempt=New-Hash;$taskSource=Source-Hash;$taskBegin=Rpc $taskAuth 'gp.BeginStaffLogin' @{LoginId=$taskUsers.MIXED.login;AttemptHash=$taskAttempt;SourceHash=$taskSource};Assert ($taskBegin.status -eq 'READY');Invoke-GatePassNonQuery $taskDb 'UPDATE gp.StaffRoleGrants SET RevokedAtUtc=SYSUTCDATETIME(),RevokedByUserId=UserId WHERE UserId=@Id' @{Id=[guid]$taskUsers.MIXED.id};$taskComplete=Rpc $taskAuth 'gp.CompleteStaffLogin' @{AttemptHash=$taskAttempt;SourceHash=$taskSource;PasswordVerified=$true;SessionHash=(New-Hash);CsrfHash=(New-Hash);NewEncodedPasswordHash=$null};Assert ($taskComplete.status -eq 'DENIED')}
 Check 'Corporate and local provider selection comes from SQL identity data' {$taskLocal=Rpc $taskAuth 'gp.ResolveStaffLoginIdentity' @{LoginId=$taskUsers.PUNE.login};Assert ($taskLocal.provider -eq 'LOCAL');$taskCorporate=Rpc $taskAuth 'gp.ResolveStaffLoginIdentity' @{LoginId=('stafftest'+$taskRun+'@example.invalid')};Assert ($taskCorporate.provider -eq 'SSO')}
 [ordered]@{status='PASS';cases=$taskChecks.Count;checks=$taskChecks;sqlContracts=$true;passwordAlgorithmTestedHere=$false}|ConvertTo-Json -Depth 4|Set-Content (Join-Path $taskRoot 'database/validation/staff-auth-report.json')
}finally{
 try{
  if($taskDb.State -eq 'Open'){
   Invoke-GatePassNonQuery $taskDb @'
DECLARE @ids table(UserId uniqueidentifier PRIMARY KEY);INSERT @ids SELECT UserId FROM gp.Users WHERE IdentityIssuer=@Issuer;
DELETE gp.SecurityAuditEvents WHERE ActorUserId IN(SELECT UserId FROM @ids) OR TargetReference IN(SELECT CONVERT(nvarchar(36),UserId) FROM @ids);
DELETE gp.IdempotencyRequests WHERE ActorBindingHash IN(SELECT HASHBYTES('SHA2_256',CONVERT(binary(16),UserId)) FROM @ids);
DELETE gp.GuardAssignments WHERE GuardUserId IN(SELECT UserId FROM @ids) OR AssignedByUserId IN(SELECT UserId FROM @ids);
DELETE gp.GuardLoginAttempts WHERE UserId IN(SELECT UserId FROM @ids);
DELETE gp.GuardSetupTickets WHERE UserId IN(SELECT UserId FROM @ids) OR CreatedByUserId IN(SELECT UserId FROM @ids);
DELETE gp.Sessions WHERE UserId IN(SELECT UserId FROM @ids);
DELETE gp.GuardCredentials WHERE UserId IN(SELECT UserId FROM @ids);
DELETE c FROM gp.GrantCapabilities c JOIN gp.StaffRoleGrants g ON g.RoleGrantId=c.RoleGrantId WHERE g.UserId IN(SELECT UserId FROM @ids);
DELETE gp.StaffRoleGrants WHERE UserId IN(SELECT UserId FROM @ids);
DELETE gp.StaffProfiles WHERE UserId IN(SELECT UserId FROM @ids);
DELETE gp.Employees WHERE UserId IN(SELECT UserId FROM @ids);
DELETE gp.Users WHERE UserId IN(SELECT UserId FROM @ids);
'@ @{Issuer=$taskIssuer}
   foreach($taskSource in $taskSources){Invoke-GatePassNonQuery $taskDb 'DELETE gp.GuardAuthSources WHERE SourceHash=CONVERT(varbinary(32),@Hex,2)' @{Hex=$taskSource}}
   foreach($taskPrincipal in @($taskAuth,$taskApi)){Invoke-GatePassNonQuery $taskDb "IF DATABASE_PRINCIPAL_ID('$taskPrincipal') IS NOT NULL DROP USER [$taskPrincipal];"}
  }
 }finally{$taskDb.Dispose()}
}
Write-Output ('All '+$taskChecks.Count+' generic staff SQL authentication cases passed; owned fixtures removed.')
