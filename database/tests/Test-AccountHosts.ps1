#Requires -Version 7.0
[CmdletBinding()]param([switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $root 'tools/GatePass.LocalSql.psm1') -Force
$db=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate
$run=[guid]::NewGuid();$f=$null;$api=$null;$principal='gp_hosts_'+$run.ToString('N');$created=$false
function Assert($v,$message){if(-not $v){throw $message}}
function Expect([scriptblock]$work,[int]$number){try{$null=&$work}catch{if($_.Exception.GetBaseException().Number -eq $number){return};throw};throw "Expected SQL $number"}
function Call($name,$p){$argsSql=($p.Keys|ForEach-Object{'@'+$_+'=@'+$_}) -join ',';return (Invoke-GatePassScalar $api ('EXEC '+$name+' '+$argsSql) $p)|ConvertFrom-Json}
try{
 $f=(Invoke-GatePassScalar $db (Get-Content (Join-Path $PSScriptRoot '002_transaction_fixtures.sql') -Raw) @{RunId=$run})|ConvertFrom-Json
 $admin=$f.actors.Where({$_.Label -eq 'ADMIN'})[0];$guard=$f.actors.Where({$_.Label -eq 'GUARD'})[0];$hostActor=$f.actors.Where({$_.Label -eq 'HOST'})[0]
 Invoke-GatePassNonQuery $db "INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) VALUES(@g,'ROLE_GRANTS_MANAGE'),(@g,'AUDIT_READ');CREATE USER [$principal] WITHOUT LOGIN;ALTER ROLE gp_api_runtime ADD MEMBER [$principal];" @{g=[long]$admin.GrantId};$created=$true
 $api=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $api "EXECUTE AS USER='$principal';"
 $identity=@{SessionHash=[Convert]::FromHexString($admin.SessionHex);CsrfHash=[Convert]::FromHexString($admin.CsrfHex)}
 $query=$identity+@{ProjectLocationId=[long]$f.projectLocationId}
 $list=Call 'gp.ReadAccountHosts' $query;Assert ($list.hosts.Count -eq 2) 'Owned explicitly approved hosts missing'
 $catalogue=Call 'gp.ListLeadProjects' ($identity+@{LocationId=[int]$f.locationId});Assert (@($catalogue.projects|Where-Object{$_.projectLocationId -eq [string]$f.projectLocationId -and $_.canManageHosts}).Count -eq 1) 'Scoped host control missing'
 $p=$query+@{EmployeeId=$f.hostEmployeeId;Action='REMOVE';ExpectedRevision=1;Reason='Owned host removal';ClientKey=[guid]::NewGuid()}
 $r=Call 'gp.ManageAccountHost' $p;$again=Call 'gp.ManageAccountHost' $p;Assert ($r.operationId -eq $again.operationId -and $r.revision -eq 2) 'Removal replay was not idempotent'
 Assert ((Invoke-GatePassScalar $db 'DECLARE @n datetime2(3)=SYSUTCDATETIME();SELECT gp._EmployeeProjectLocationEligible(@e,@p,DATEADD(hour,-24,@n),@n);' @{e=$f.hostEmployeeId;p=[long]$f.projectLocationId}) -eq 1) 'Host removal changed employee entry entitlement'
 Assert ((Invoke-GatePassScalar $db 'DECLARE @n datetime2(3)=SYSUTCDATETIME();SELECT gp._AccountHostEligible(@e,@p,DATEADD(hour,-24,@n),@n);' @{e=$f.hostEmployeeId;p=[long]$f.projectLocationId}) -eq 0) 'Removed host remained eligible'
 $visit=$f.visits.Where({$_.Label -eq 'PENDING'})[0]
 $decision=@{SessionHash=[Convert]::FromHexString($hostActor.SessionHex);CsrfHash=[Convert]::FromHexString($hostActor.CsrfHex);ClientKey=[guid]::NewGuid();VisitRequestId=[guid]$visit.VisitId;SnapshotVersion=1;SnapshotHash=[Convert]::FromHexString($visit.SnapshotHex);Decision='APPROVED'}
 Expect {Call 'gp.DecideVisit' $decision} 52004
 $readHost=@{SessionHash=[Convert]::FromHexString($hostActor.SessionHex);CsrfHash=[Convert]::FromHexString($hostActor.CsrfHex);ProjectLocationId=[long]$f.projectLocationId};Expect {Call 'gp.ReadAccountHosts' $readHost} 52001
 $candidates=Call 'gp.ReadAccountHosts' ($query+@{Search='Synthetic HOST'});Assert (@($candidates.candidates|Where-Object{$_.employeeId -eq $f.hostEmployeeId -and $_.revision -eq 2}).Count -eq 1) 'Eligible removed host cannot be reselected'
 $add=$p.Clone();$add.Action='ADD';$add.ExpectedRevision=2;$add.ClientKey=[guid]::NewGuid();$add.Reason='Owned host restore';$null=Call 'gp.ManageAccountHost' $add
 Assert ((Call 'gp.ReadAccountHosts' $query).hosts.Count -eq 2) 'Host restoration missing'
 $stale=$add.Clone();$stale.ClientKey=[guid]::NewGuid();Expect {Call 'gp.ManageAccountHost' $stale} 52003
 $bad=$p.Clone();$bad.SessionHash=[Convert]::FromHexString($guard.SessionHex);$bad.CsrfHash=[Convert]::FromHexString($guard.CsrfHex);Expect {Call 'gp.ManageAccountHost' $bad} 52001
 Invoke-GatePassNonQuery $db "UPDATE gp.StaffRoleGrants SET RoleCode='PROJECT_ADMIN',ScopeType='PROJECT_LOCATION',LocationId=NULL,ProjectLocationId=@p WHERE RoleGrantId=@g;" @{g=[long]$admin.GrantId;p=[long]$f.projectLocationId}
 Assert ((Call 'gp.ReadAccountHosts' $query).hosts.Count -eq 2) 'Account admin cannot manage own host list'
 $foreign=[long](Invoke-GatePassScalar $db 'SELECT ProjectLocationId FROM gp.ProjectLocations WHERE ProjectId=@p AND LocationId=@l;' @{p=[long]$f.projectId;l=[int]$f.otherLocationId})
 Expect {Call 'gp.ReadAccountHosts' ($identity+@{ProjectLocationId=$foreign})} 52001
 $bad=$add.Clone();$bad.ProjectLocationId=$foreign;$bad.ExpectedRevision=0;$bad.ClientKey=[guid]::NewGuid();Expect {Call 'gp.ManageAccountHost' $bad} 52001
 Invoke-GatePassNonQuery $db "DELETE gp.GrantCapabilities WHERE RoleGrantId=@g AND CapabilityCode='ROLE_GRANTS_MANAGE';" @{g=[long]$admin.GrantId}
 Expect {Call 'gp.ManageAccountHost' $add} 52001
 Assert ((Invoke-GatePassScalar $db "SELECT COUNT(*) FROM gp.SecurityAuditEvents WHERE ActorUserId=@u AND ActionCode IN('ACCOUNT_HOST_ADDED','ACCOUNT_HOST_REMOVED') AND TargetReference=@e AND ProjectLocationId=@p AND JSON_VALUE(MetadataJson,'$.reason') LIKE 'Owned host%';" @{u=[guid]$admin.UserId;e=$f.hostEmployeeId;p=[long]$f.projectLocationId}) -eq 2) 'Actor-target-scope-reason audit missing or duplicate replay audit'
 $audit=Call 'gp.ListScopedAuditEvents' ($identity+@{LocationId=[int]$f.locationId;ProjectLocationId=[long]$f.projectLocationId;FromUtc=[datetime]::UtcNow.AddHours(-1);UntilUtc=[datetime]::UtcNow.AddHours(1);PageSize=50})
 Assert (@($audit.events|Where-Object{$_.actionCode -eq 'ACCOUNT_HOST_ADDED' -and $_.targetDisplayName -eq 'Synthetic HOST' -and $_.staffCode -eq $f.hostEmployeeId -and $_.reason -eq 'Owned host restore' -and $_.scopeName -like 'Synthetic Alpha*'}).Count -eq 1) 'Scoped audit UI metadata missing'
 Expect {Invoke-GatePassScalar $api 'SELECT COUNT(*) FROM gp.AccountHosts;'} 229
 Write-Output 'PASS: execute-only host list, account/location scopes, forged actor denial, removal, existing decision denial, unchanged employee entitlement, re-add, stale revision, replay, revocation and audit'
}finally{
 if($api){$api.Dispose()}
 try{if($f){Invoke-GatePassNonQuery $db (Get-Content (Join-Path $PSScriptRoot '003_transaction_cleanup.sql') -Raw) @{RunId=$run}};if($created){Invoke-GatePassNonQuery $db "DROP USER [$principal];"}}finally{$db.Dispose()}
}
