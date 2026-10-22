#Requires -Version 7.0
[CmdletBinding()]param([switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $root 'tools/GatePass.LocalSql.psm1') -Force
$c=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;$run=[guid]::NewGuid();$f=$null;$api=$null;$principal='gp_console_'+$run.ToString('N');$created=$false
function Assert($v,$message){if(-not $v){throw $message}}
function Expect([scriptblock]$work,[int]$number){try{$null=&$work}catch{if($_.Exception.GetBaseException().Number -eq $number){return};throw};throw "Expected SQL $number"}
try{
 $f=(Invoke-GatePassScalar $c (Get-Content (Join-Path $PSScriptRoot '002_transaction_fixtures.sql') -Raw) @{RunId=$run})|ConvertFrom-Json
 $admin=$f.actors.Where({$_.Label -eq 'ADMIN'})[0];$guard=$f.actors.Where({$_.Label -eq 'GUARD'})[0]
 Invoke-GatePassNonQuery $c "INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT @g,Code FROM (VALUES('VISITS_READ'),('REPORTS_READ'),('AUDIT_READ'),('ROLE_GRANTS_MANAGE')) x(Code);CREATE USER [$principal] WITHOUT LOGIN;ALTER ROLE gp_api_runtime ADD MEMBER [$principal];" @{g=[long]$admin.GrantId};$created=$true
 $api=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $api "EXECUTE AS USER='$principal';"
 $p=@{s=[Convert]::FromHexString($admin.SessionHex);c=[Convert]::FromHexString($admin.CsrfHex);l=[int]$f.locationId;pair=[long]$f.projectLocationId}
 $sql='EXEC gp.GetAdminConsoleScope @SessionHash=@s,@CsrfHash=@c,@LocationId=@l,@ProjectLocationId=@pair;'
 $r=(Invoke-GatePassScalar $api $sql $p)|ConvertFrom-Json
 Assert ($r.canReport -and $r.canAudit -and $r.canManageRoles -and $r.canAssignGuards) 'Expected scoped capabilities'
 Assert ($r.delegations.Where({$_.roleCode -in @('INDIA_ADMIN','PLATFORM_ADMIN','LOCATION_ADMIN')}).Count -eq 0) 'Location admin may delegate superior roles'
 Assert ($r.delegations.Where({$_.roleCode -eq 'PROJECT_ADMIN' -and $_.scopeType -eq 'PROJECT_LOCATION'}).Count -eq 1) 'Missing local project lead delegation'
 Write-Output 'PASS: office capability flags and bounded role delegation'
 $bad=$p.Clone();$bad.l=[int]$f.otherLocationId;Expect {Invoke-GatePassScalar $api $sql $bad} 52001
 $bad=$p.Clone();$bad.s=[Convert]::FromHexString($guard.SessionHex);$bad.c=[Convert]::FromHexString($guard.CsrfHex);Expect {Invoke-GatePassScalar $api $sql $bad} 52001
 Write-Output 'PASS: cross-office and guard admin-context denial'
 $asql='EXEC gp.ListAdminGuardAssignments @SessionHash=@s,@CsrfHash=@c,@ProjectLocationId=@pair;'
 $args=@{s=$p.s;c=$p.c;pair=$p.pair};$r=(Invoke-GatePassScalar $api $asql $args)|ConvertFrom-Json
 Assert ($r.assignments.Count -gt 0) 'No scoped assignments';Assert (($r|ConvertTo-Json -Depth 8) -notmatch 'SessionHash|CsrfHash|password|LoginId') 'Private auth data leaked'
 $bad=$args.Clone();$bad.s=[Convert]::FromHexString($guard.SessionHex);$bad.c=[Convert]::FromHexString($guard.CsrfHex);Expect {Invoke-GatePassScalar $api $asql $bad} 52001
 Expect {Invoke-GatePassScalar $api 'SELECT COUNT(*) FROM gp.Users;'} 229
 Write-Output 'PASS: exact assignment projection and execute-only runtime'
 # Demote the owned admin to a project admin and scope its current role to a single project office.
 Invoke-GatePassNonQuery $c "UPDATE gp.StaffRoleGrants SET RoleCode='PROJECT_ADMIN',ScopeType='PROJECT_LOCATION',LocationId=NULL,ProjectLocationId=@pair WHERE RoleGrantId=@g;" @{pair=$p.pair;g=[long]$admin.GrantId}
 $r=(Invoke-GatePassScalar $api $sql $p)|ConvertFrom-Json;Assert ($r.delegations.Count -eq 1 -and $r.delegations[0].roleCode -eq 'PROJECT_ADMIN' -and $r.delegations[0].scopeType -eq 'PROJECT_LOCATION') 'Project admin escaped scope'
 $bad=$p.Clone();$bad.pair=$null;Expect {Invoke-GatePassScalar $api $sql $bad} 52001
 Write-Output 'PASS: project admin cannot obtain whole-office scope or broader delegation'
}finally{if($api){$api.Dispose()};try{if($f){Invoke-GatePassNonQuery $c (Get-Content (Join-Path $PSScriptRoot '003_transaction_cleanup.sql') -Raw) @{RunId=$run}};if($created){Invoke-GatePassNonQuery $c "DROP USER [$principal];"}}finally{$c.Dispose()}}
