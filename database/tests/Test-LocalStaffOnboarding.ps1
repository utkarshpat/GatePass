#Requires -Version 7.0
[CmdletBinding()]param([switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $root 'tools/GatePass.LocalSql.psm1') -Force
$db=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;$run=[guid]::NewGuid();$f=$null;$api=$null;$principal='gp_onboard_'+$run.ToString('N');$created=$false
function Assert($v,$message){if(-not $v){throw $message}}
function Expect([scriptblock]$work,[int]$number){try{$null=&$work}catch{if($_.Exception.GetBaseException().Number -eq $number){return};throw};throw "Expected SQL $number"}
function Call($name,$p){$argsSql=($p.Keys|ForEach-Object{'@'+$_+'=@'+$_}) -join ',';return (Invoke-GatePassScalar $api ('EXEC '+$name+' '+$argsSql) $p)|ConvertFrom-Json}
try{
 $f=(Invoke-GatePassScalar $db (Get-Content (Join-Path $PSScriptRoot '002_transaction_fixtures.sql') -Raw) @{RunId=$run})|ConvertFrom-Json
 $admin=$f.actors.Where({$_.Label -eq 'ADMIN'})[0];$guard=$f.actors.Where({$_.Label -eq 'GUARD'})[0]
 Invoke-GatePassNonQuery $db "INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT @g,Code FROM(VALUES('VISITS_READ'),('ROLE_GRANTS_MANAGE'),('STAFF_CREDENTIALS_MANAGE'),('AUDIT_READ')) x(Code);CREATE USER [$principal] WITHOUT LOGIN;ALTER ROLE gp_api_runtime ADD MEMBER [$principal];" @{g=[long]$admin.GrantId};$created=$true
 $api=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $api "EXECUTE AS USER='$principal';"
 $identity=@{SessionHash=[Convert]::FromHexString($admin.SessionHex);CsrfHash=[Convert]::FromHexString($admin.CsrfHex)}
 $scope=Call 'gp.GetAdminConsoleScope' ($identity+@{LocationId=[int]$f.locationId});Assert (($scope.provisionableRoles.roleCode -join ',') -eq 'GUARD,RECEPTION' -and $scope.canResetLocalStaff) 'Incorrect provisionable roles'
 $hash=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);$prefix='new-'+$run.ToString('N')
 $p=$identity+@{ClientKey=[guid]::NewGuid();DisplayName='Owned New Guard';LoginId=$prefix+'-guard';RoleCode='GUARD';LocationId=[int]$f.locationId;ProjectLocationId=[long]$f.projectLocationId;CapabilitiesJson='["VISITS_READ","PROJECT_MOVEMENT"]';SetupTokenHash=$hash;Reason='New guard onboarding test'}
 $r=Call 'gp.CreateLocalStaffAccount' $p;$again=Call 'gp.CreateLocalStaffAccount' $p;Assert ($r.userId -eq $again.userId) 'Retry created duplicate user'
 Assert ((Invoke-GatePassScalar $db 'SELECT COUNT(*) FROM gp.GuardAssignments WHERE GuardUserId=@u;' @{u=[guid]$r.userId}) -eq 1) 'Initial assignment missing or duplicated'
 $audit=(Invoke-GatePassScalar $db "SELECT ActorUserId,ActionCode,OccurredAtUtc,MetadataJson FROM gp.SecurityAuditEvents WHERE ActorUserId=@a AND TargetReference=@u ORDER BY AuditEventId FOR JSON PATH;" @{a=[guid]$admin.UserId;u=[string]$r.userId})|ConvertFrom-Json
 Assert ($audit.Count -eq 2 -and $audit[0].ActionCode -eq 'STAFF_ACCOUNT_CREATED' -and $audit[1].ActionCode -eq 'STAFF_SETUP_ISSUED') 'Creation/setup audit missing or duplicated'
 $metadata=$audit[0].MetadataJson|ConvertFrom-Json;Assert ($metadata.targetDisplayName -eq 'Owned New Guard' -and $metadata.staffCode -eq $p.LoginId -and $metadata.roleCode -eq 'GUARD' -and $metadata.reason -eq $p.Reason -and $null -ne $audit[0].OccurredAtUtc) 'Who/whom/time/scope/reason audit missing'
 Assert (($audit|ConvertTo-Json -Depth 8) -notmatch 'password|token|setupHash') 'Secret in audit'
 Write-Output 'PASS: scoped execute-only creation, one-use setup issuance, optional guard allocation and idempotent actor/target/time audit'
 $bad=$p.Clone();$bad.ClientKey=[guid]::NewGuid();Expect {Call 'gp.CreateLocalStaffAccount' $bad} 52003
 foreach($role in @('PROJECT_ADMIN','INDIA_ADMIN','PLATFORM_ADMIN','LOCATION_ADMIN')){$bad=$p.Clone();$bad.ClientKey=[guid]::NewGuid();$bad.LoginId=$prefix+'-denied';$bad.RoleCode=$role;$bad.CapabilitiesJson='["VISITS_READ"]';$bad.ProjectLocationId=$null;Expect {Call 'gp.CreateLocalStaffAccount' $bad} $(if($role -eq 'PROJECT_ADMIN'){52002}else{52001})}
 $bad=$p.Clone();$bad.ClientKey=[guid]::NewGuid();$bad.LocationId=[int]$f.otherLocationId;Expect {Call 'gp.CreateLocalStaffAccount' $bad} 52001
 $bad=$p.Clone();$bad.SessionHash=[Convert]::FromHexString($guard.SessionHex);$bad.CsrfHash=[Convert]::FromHexString($guard.CsrfHex);Expect {Call 'gp.CreateLocalStaffAccount' $bad} 52001
 $bad=$p.Clone();$bad.ClientKey=[guid]::NewGuid();$bad.LoginId=$prefix+'-staff';$bad.RoleCode='RECEPTION';$bad.CapabilitiesJson='["VISITS_READ","PASS_PRINT"]';Expect {Call 'gp.CreateLocalStaffAccount' $bad} 52001
 $bad.ProjectLocationId=$null;$bad.SetupTokenHash=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);$reception=Call 'gp.CreateLocalStaffAccount' $bad;Assert ($reception.roleCode -eq 'RECEPTION') 'Reception local account failed'
 Write-Output 'PASS: no superior role/project lead/foreign office escalation; reception cannot acquire guard assignment'
 # A platform administrator can provision the two global roles; office admins cannot read their global audit records.
 Invoke-GatePassNonQuery $db "UPDATE gp.StaffRoleGrants SET RoleCode='PLATFORM_ADMIN',ScopeType='PLATFORM',LocationId=NULL WHERE RoleGrantId=@g;" @{g=[long]$admin.GrantId}
 foreach($role in @('INDIA_ADMIN','PLATFORM_ADMIN')){$global=$p.Clone();$global.ClientKey=[guid]::NewGuid();$global.LoginId=$prefix+'-'+$(if($role -eq 'INDIA_ADMIN'){'ia'}else{'pa'});$global.RoleCode=$role;$global.ProjectLocationId=$null;$global.CapabilitiesJson='["VISITS_READ"]';$global.SetupTokenHash=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);$gr=Call 'gp.CreateLocalStaffAccount' $global;Assert ($gr.roleCode -eq $role) 'Platform global account creation failed'}
 $window=(Invoke-GatePassScalar $db "SELECT DATEADD(minute,-10,SYSUTCDATETIME()) f,DATEADD(minute,1,SYSUTCDATETIME()) t FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;")|ConvertFrom-Json
 $auditParams=$identity+@{FromUtc=[datetime]$window.f;UntilUtc=[datetime]$window.t;PageSize=50};$globalAudit=Call 'gp.ListScopedAuditEvents' $auditParams
 Assert (@($globalAudit.events|Where-Object{$_.staffCode -eq $prefix+'-ia' -and $_.actionCode -eq 'STAFF_ACCOUNT_CREATED'}).Count -eq 1) 'Global creation audit missing'
 Invoke-GatePassNonQuery $db "UPDATE gp.StaffRoleGrants SET RoleCode='LOCATION_ADMIN',ScopeType='LOCATION',LocationId=@l WHERE RoleGrantId=@g;" @{g=[long]$admin.GrantId;l=[int]$f.locationId}
 $localAudit=Call 'gp.ListScopedAuditEvents' $auditParams;Assert (@($localAudit.events|Where-Object{$_.staffCode -in @($prefix+'-ia',$prefix+'-pa')}).Count -eq 0) 'Office audit leaked global account metadata'
 Write-Output 'PASS: platform-only global account creation and scoped audit metadata visibility'
 # Existing auth setup procedures must accept the account and enforce one-use completion.
 $auth=@{TokenHash=$hash;SourceHash=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32)}
 $ticket=(Invoke-GatePassScalar $db 'EXEC gp.InspectStaffSetup @TokenHash=@TokenHash,@SourceHash=@SourceHash;' $auth)|ConvertFrom-Json;Assert ($ticket.status -eq 'READY') 'Fresh account not eligible for setup'
 $encoded=Invoke-GatePassScalar $db "SELECT EncodedPasswordHash FROM gp.GuardCredentials WHERE LoginId='admin2@example.com';"
 $auth.NewEncodedPasswordHash=$encoded;$done=(Invoke-GatePassScalar $db 'EXEC gp.CompleteStaffSetup @TokenHash=@TokenHash,@SourceHash=@SourceHash,@NewEncodedPasswordHash=@NewEncodedPasswordHash;' $auth)|ConvertFrom-Json;Assert ($done.status -eq 'OK') 'New staff setup completion failed'
 $done=(Invoke-GatePassScalar $db 'EXEC gp.CompleteStaffSetup @TokenHash=@TokenHash,@SourceHash=@SourceHash,@NewEncodedPasswordHash=@NewEncodedPasswordHash;' $auth)|ConvertFrom-Json;Assert ($done.status -ne 'OK') 'Setup ticket reusable'
 $reset=$identity+@{TargetUserId=[guid]$r.userId;SetupTokenHash=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);ClientKey=[guid]::NewGuid();Reason='Lost password reset test'}
 $rs=Call 'gp.ReissueLocalStaffSetup' $reset;$retry=Call 'gp.ReissueLocalStaffSetup' $reset;Assert ($rs.userId -eq $retry.userId) 'Setup reset retry failed'
 Assert ((Invoke-GatePassScalar $db 'SELECT COUNT(*) FROM gp.GuardSetupTickets WHERE UserId=@u AND UsedAtUtc IS NULL;' @{u=[guid]$r.userId}) -eq 1) 'Reset issued duplicate unused tickets'
 Assert ((Invoke-GatePassScalar $db 'SELECT COUNT(*) FROM gp.GuardCredentials WHERE UserId=@u AND MustChangePassword=1 AND EncodedPasswordHash IS NULL;' @{u=[guid]$r.userId}) -eq 1) 'Reset retained old password'
 $badReset=$reset.Clone();$badReset.TargetUserId=[guid]$admin.UserId;Expect {Call 'gp.ReissueLocalStaffSetup' $badReset} 52601
 $foreign=$f.actors.Where({$_.Label -eq 'WRONGLOCATION'})[0];$badReset=$reset.Clone();$badReset.SessionHash=[Convert]::FromHexString($foreign.SessionHex);$badReset.CsrfHash=[Convert]::FromHexString($foreign.CsrfHex);Expect {Call 'gp.ReissueLocalStaffSetup' $badReset} 52601
 Expect {Invoke-GatePassScalar $api 'SELECT COUNT(*) FROM gp.Users;'} 229
 Write-Output 'PASS: password setup single-use, reset revokes old credentials, reset idempotency and authority checks'
}catch{Write-Output $_.ScriptStackTrace;Write-Output $_.Exception.Message;throw}finally{if($api){$api.Dispose()};try{if($f){Invoke-GatePassNonQuery $db (Get-Content (Join-Path $PSScriptRoot 'LocalStaffOwnedCleanup.sql') -Raw) @{RunId=$run};Invoke-GatePassNonQuery $db (Get-Content (Join-Path $PSScriptRoot '003_transaction_cleanup.sql') -Raw) @{RunId=$run}};if($created){Invoke-GatePassNonQuery $db "DROP USER [$principal];"}}finally{$db.Dispose()}}
