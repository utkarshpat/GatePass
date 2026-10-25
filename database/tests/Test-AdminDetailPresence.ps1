#Requires -Version 7.0
[CmdletBinding()]param([switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskAdmin=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate
$taskRun=[guid]::NewGuid();$taskPrincipal='gp_detail_presence_'+$taskRun.ToString('N');$taskApi=$null;$taskReady=$false;$taskCreated=$false;$taskCases=[Collections.Generic.List[object]]::new()
function Assert($value,[string]$message){if(-not $value){throw $message}}
function Auth([string]$actor){return @{SessionHash=[Convert]::FromHexString($taskActors[$actor].SessionHex);CsrfHash=[Convert]::FromHexString($taskActors[$actor].CsrfHex)}}
function Call([string]$procedure,[hashtable]$parameters){$argsText=($parameters.Keys|ForEach-Object{'@'+$_+'=@'+$_}) -join ',';return(Invoke-GatePassScalar $taskApi ('EXEC gp.'+$procedure+' '+$argsText) $parameters)|ConvertFrom-Json}
function Read-Detail([string]$actor,[string]$view,[guid]$visit){$p=Auth $actor;$p.View=$view;$p.VisitRequestId=$visit;return Call 'GetVisitDetail' $p}
function Invoke-FixtureMovement([object]$visit,[string]$event){$p=Auth 'GUARD';$p.ClientKey=[guid]::NewGuid();$p.VisitRequestId=[guid]$visit.VisitId;$p.AccessPassId=[guid]$visit.PassId;$p.LocationId=[int]$taskFixture.locationId;$p.DutyKind='PROJECT';$p.DutyId=[long]$taskFixture.projectLocationId;$p.EventType=$event;$p.EntryMethod='MANUAL';return Call 'RecordGuardDutyMovement' $p}
function Case([string]$name,[scriptblock]$work){try{$null=&$work;$taskCases.Add(@{name=$name;passed=$true});Write-Output "PASS: $name"}catch{$taskCases.Add(@{name=$name;passed=$false});Write-Output "FAIL: $name -- $($_.Exception.Message)"}}
try{
 $taskFixture=(Invoke-GatePassScalar $taskAdmin (Get-Content (Join-Path $PSScriptRoot '002_transaction_fixtures.sql') -Raw) @{RunId=$taskRun})|ConvertFrom-Json;$taskReady=$true
 if($taskFixture.prefix -eq 'GP02-F8C7F73D68364B00BCA4'){throw 'Retained presentation fixture cannot be used.'}
 $taskActors=@{};foreach($a in $taskFixture.actors){$taskActors[$a.Label]=$a}
 $taskTemp=$taskFixture.visits.Where({$_.Label -eq 'TEMP'})[0];$taskVisitor=$taskFixture.visits.Where({$_.Label -eq 'MOVEMENT'})[0]
 Invoke-GatePassNonQuery $taskAdmin "INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT RoleGrantId,'VISITS_READ' FROM gp.StaffRoleGrants WHERE UserId IN(@admin,@reception);" @{admin=[guid]$taskActors.ADMIN.UserId;reception=[guid]$taskActors.RECEPTION.UserId}
 Invoke-GatePassNonQuery $taskAdmin "CREATE USER [$taskPrincipal] WITHOUT LOGIN;ALTER ROLE gp_api_runtime ADD MEMBER [$taskPrincipal];";$taskCreated=$true
 $taskApi=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $taskApi "EXECUTE AS USER='$taskPrincipal';"
 Case 'Digital ID starts outside in current admin details' {Assert (-not (Read-Detail 'ADMIN' 'ADMIN' $taskTemp.VisitId).isInside) 'New Digital ID did not start outside.'}
 $null=Invoke-FixtureMovement $taskTemp 'ENTRY'
 Case 'Digital ID project entry appears inside in current admin details' {Assert ((Read-Detail 'ADMIN' 'ADMIN' $taskTemp.VisitId).isInside) 'Admin Digital ID detail ignored project presence.'}
 Case 'Reception Digital ID presence retains its office semantics' {Assert ((Read-Detail 'RECEPTION' 'RECEPTION' $taskTemp.VisitId).isInside) 'Reception presence changed.'}
 Case 'Project guard presence remains duty-specific' {$p=Auth 'GUARD';$p.LocationId=[int]$taskFixture.locationId;$p.DutyKind='PROJECT';$p.DutyId=[long]$taskFixture.projectLocationId;$p.VisitRequestId=[guid]$taskTemp.VisitId;Assert ((Call 'ReadGuardDutyPass' $p).visit.isInside) 'Guard project presence changed.'}
 $null=Invoke-FixtureMovement $taskTemp 'EXIT'
 Case 'Digital ID final project exit appears outside in current admin details' {Assert (-not (Read-Detail 'ADMIN' 'ADMIN' $taskTemp.VisitId).isInside) 'Admin Digital ID detail retained inside after exit.'}
 $null=Invoke-FixtureMovement $taskVisitor 'ENTRY'
 Case 'Visitor detail still follows ordinary visit presence on entry and exit' {Assert ((Read-Detail 'ADMIN' 'ADMIN' $taskVisitor.VisitId).isInside) 'Visitor entry changed.';$null=Invoke-FixtureMovement $taskVisitor 'EXIT';Assert (-not (Read-Detail 'ADMIN' 'ADMIN' $taskVisitor.VisitId).isInside) 'Visitor exit changed.'}
 Case 'An actor without admin read scope cannot use the detail projection' {try{$null=Read-Detail 'WRONGLOCATION' 'ADMIN' $taskTemp.VisitId;throw 'Expected authorization denial.'}catch{if($_.Exception.GetBaseException() -isnot [Data.SqlClient.SqlException] -or $_.Exception.GetBaseException().Number -ne 52801){throw}}}
 Case 'Execute-only runtime still cannot read presence tables directly' {try{$null=Invoke-GatePassScalar $taskApi 'SELECT COUNT(*) FROM gp.EmployeeProjectPresence;';throw 'Expected table denial.'}catch{if($_.Exception.GetBaseException() -isnot [Data.SqlClient.SqlException] -or $_.Exception.GetBaseException().Number -ne 229){throw}}}
}finally{
 if($taskApi){try{Invoke-GatePassNonQuery $taskApi 'REVERT;'}finally{$taskApi.Dispose()}}
 try{if($taskCreated){Invoke-GatePassNonQuery $taskAdmin "DROP USER [$taskPrincipal];"};if($taskReady){Invoke-GatePassNonQuery $taskAdmin (Get-Content (Join-Path $PSScriptRoot '003_transaction_cleanup.sql') -Raw) @{RunId=$taskRun}}}finally{$taskAdmin.Dispose()}
}
$failed=@($taskCases|Where-Object passed -eq $false).Count
@{Status=if($failed){'FAIL'}else{'PASS'};Cases=$taskCases.Count;Failed=$failed;RestrictedRuntime=$true;OwnedCleanup=$true}|ConvertTo-Json -Compress
if($failed){exit 1}
