#Requires -Version 7.0
[CmdletBinding()]param([switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $root 'tools/GatePass.LocalSql.psm1') -Force
$db=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate
$run=[guid]::NewGuid();$f=$null;$api=$null;$principal='gp_project_'+$run.ToString('N');$created=$false
function Assert($v,$message){if(-not $v){throw $message}}
function Expect([scriptblock]$work,[int]$number){try{$null=&$work}catch{if($_.Exception.GetBaseException().Number -eq $number){return};throw};throw "Expected SQL $number"}
function Call($name,$p){$argsSql=($p.Keys|ForEach-Object{'@'+$_+'=@'+$_}) -join ',';return (Invoke-GatePassScalar $api ('EXEC '+$name+' '+$argsSql) $p)|ConvertFrom-Json}
try{
 $f=(Invoke-GatePassScalar $db (Get-Content (Join-Path $PSScriptRoot '002_transaction_fixtures.sql') -Raw) @{RunId=$run})|ConvertFrom-Json
 $admin=$f.actors.Where({$_.Label -eq 'ADMIN'})[0];$guard=$f.actors.Where({$_.Label -eq 'GUARD'})[0]
 Invoke-GatePassNonQuery $db "INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) VALUES(@g,'ROLE_GRANTS_MANAGE');CREATE USER [$principal] WITHOUT LOGIN;ALTER ROLE gp_api_runtime ADD MEMBER [$principal];" @{g=[long]$admin.GrantId};$created=$true
 $api=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $api "EXECUTE AS USER='$principal';"
 $identity=@{SessionHash=[Convert]::FromHexString($admin.SessionHex);CsrfHash=[Convert]::FromHexString($admin.CsrfHex)}
 $context=Call 'gp.GetAdminWorkspaceContext' $identity
 Assert (@($context.locations|Where-Object{$_.locationId -eq $f.locationId -and $_.canCreateProject}).Count -eq 1) 'Office creation capability missing'
 Assert (@($context.locations|Where-Object{$_.locationId -eq $f.otherLocationId}).Count -eq 0) 'Foreign office exposed'
 $p=$identity+@{ClientKey=[guid]::NewGuid();LocationId=[int]$f.locationId;ProjectName='Owned Workplace Transformation';ProjectCode=($f.prefix+'-C').ToUpperInvariant();Reason='Scoped project workflow test'}
 $r=Call 'gp.CreateScopedProject' $p;$again=Call 'gp.CreateScopedProject' $p
 Assert ($r.projectId -eq $again.projectId -and $r.projectLocationId -eq $again.projectLocationId -and $r.locationId -eq $f.locationId) 'Creation/replay scope mismatch'
 Assert ((Invoke-GatePassScalar $db 'SELECT COUNT(*) FROM gp.ProjectLocations WHERE ProjectId=@p AND LocationId=@l;' @{p=[long]$r.projectId;l=[int]$f.locationId}) -eq 1) 'Project linked outside selected office'
 Assert ((Invoke-GatePassScalar $db "SELECT COUNT(*) FROM gp.SecurityAuditEvents WHERE ActionCode='PROJECT_CREATED' AND ActorUserId=@u AND ProjectLocationId=@p AND JSON_VALUE(MetadataJson,'$.reason')=@reason;" @{u=[guid]$admin.UserId;p=[long]$r.projectLocationId;reason=$p.Reason}) -eq 1) 'Creation audit missing or duplicated'
 $projects=Call 'gp.ListLeadProjects' ($identity+@{LocationId=[int]$f.locationId})
 Assert (@($projects.projects|Where-Object{$_.projectLocationId -eq $r.projectLocationId -and $_.directoryCurrent -and $_.canAssignLocation}).Count -eq 1) 'Created project not usable in admin list'
 Assert ((Invoke-GatePassScalar $db 'DECLARE @n datetime2(3)=DATEADD(day,30,SYSUTCDATETIME());SELECT gp._ProjectCurrent(@p,DATEADD(hour,-24,@n),@n);' @{p=[long]$r.projectId}) -eq 1) 'Local project expires with directory cache'
 Assert ((Invoke-GatePassScalar $db 'DECLARE @n datetime2(3)=DATEADD(day,30,SYSUTCDATETIME());SELECT gp._ProjectCurrent(@p,DATEADD(hour,-24,@n),@n);' @{p=[long]$f.projectId}) -eq 0) 'Stale directory project gained local authority'
 Assert ((Invoke-GatePassScalar $db 'DECLARE @n datetime2(3)=SYSUTCDATETIME();SELECT gp._EmployeeProjectLocationEligible(@e,@p,DATEADD(hour,-24,@n),@n);' @{e=$f.prefix+'-HOST';p=[long]$r.projectLocationId}) -eq 0) 'Creation implicitly granted employee host eligibility'
 Invoke-GatePassNonQuery $db 'UPDATE gp.Projects SET IsActive=0 WHERE ProjectId=@p;' @{p=[long]$r.projectId}
 Assert ((Invoke-GatePassScalar $db 'DECLARE @n datetime2(3)=SYSUTCDATETIME();SELECT gp._ProjectCurrent(@p,DATEADD(hour,-24,@n),@n);' @{p=[long]$r.projectId}) -eq 0) 'Inactive local project remained available'
 Invoke-GatePassNonQuery $db 'UPDATE gp.Projects SET IsActive=1 WHERE ProjectId=@p;' @{p=[long]$r.projectId}
 Write-Output 'PASS: execute-only scoped creation, single office link, idempotency, audit and persistent local catalogue'
 $bad=$p.Clone();$bad.ClientKey=[guid]::NewGuid();Expect {Call 'gp.CreateScopedProject' $bad} 52003
 $bad=$p.Clone();$bad.ProjectName='Changed payload';Expect {Call 'gp.CreateScopedProject' $bad} 52003
 $bad=$p.Clone();$bad.LocationId=[int]$f.otherLocationId;Expect {Call 'gp.CreateScopedProject' $bad} 52001
 $bad=$p.Clone();$bad.SessionHash=[Convert]::FromHexString($guard.SessionHex);$bad.CsrfHash=[Convert]::FromHexString($guard.CsrfHex);Expect {Call 'gp.CreateScopedProject' $bad} 52001
 $bad=$p.Clone();$bad.ClientKey=[guid]::NewGuid();$bad.ProjectCode='lowercase';Expect {Call 'gp.CreateScopedProject' $bad} 52002
 Invoke-GatePassNonQuery $db "DELETE gp.GrantCapabilities WHERE RoleGrantId=@g AND CapabilityCode='ROLE_GRANTS_MANAGE';" @{g=[long]$admin.GrantId}
 $context=Call 'gp.GetAdminWorkspaceContext' $identity;Assert (-not $context.locations[0].canCreateProject) 'Role label implied creation capability'
 Expect {Call 'gp.CreateScopedProject' $p} 52001
 Invoke-GatePassNonQuery $db "INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) VALUES(@g,'ROLE_GRANTS_MANAGE');" @{g=[long]$admin.GrantId}
 # Turning the same privileged actor into a project admin must deny both new writes and cached replays.
 Invoke-GatePassNonQuery $db "UPDATE gp.StaffRoleGrants SET RoleCode='PROJECT_ADMIN',ScopeType='PROJECT_LOCATION',LocationId=NULL,ProjectLocationId=@p WHERE RoleGrantId=@g;" @{g=[long]$admin.GrantId;p=[long]$f.projectLocationId}
 $context=Call 'gp.GetAdminWorkspaceContext' $identity;Assert (-not $context.locations[0].canCreateProject) 'Project admin can create sibling project'
 Expect {Call 'gp.CreateScopedProject' $p} 52001
 $bad=$p.Clone();$bad.ClientKey=[guid]::NewGuid();$bad.ProjectCode=($f.prefix+'-DENIED').ToUpperInvariant();Expect {Call 'gp.CreateScopedProject' $bad} 52001
 Expect {Invoke-GatePassScalar $api 'SELECT COUNT(*) FROM gp.Projects;'} 229
 Write-Output 'PASS: forged office, guard, project admin, revoked scope, duplicate code and changed-key payload denied'
}finally{
 if($api){$api.Dispose()}
 try{if($f){Invoke-GatePassNonQuery $db (Get-Content (Join-Path $PSScriptRoot '003_transaction_cleanup.sql') -Raw) @{RunId=$run}};if($created){Invoke-GatePassNonQuery $db "DROP USER [$principal];"}}finally{$db.Dispose()}
}
