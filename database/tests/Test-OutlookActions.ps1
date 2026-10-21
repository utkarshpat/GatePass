#Requires -Version 7.0
[CmdletBinding()]param([switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$c=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;$run=[guid]::NewGuid();$tenant=[guid]::NewGuid();$oid=[guid]::NewGuid();$otherOid=[guid]::NewGuid();$ready=$false;$created=$false;$outlook=$null;$api=$null;$principal='gp_outlook_test_'+$run.ToString('N');$results=[Collections.Generic.List[object]]::new()
function Assert($v,$message){if(-not $v){throw $message}}
function Expect([scriptblock]$work,[int]$number){try{$null=&$work}catch{if($_.Exception.GetBaseException().Number -eq $number){return};throw};throw "Expected SQL $number"}
function Case($name,[scriptblock]$work){try{$null=&$work;$results.Add(@{name=$name;passed=$true});Write-Output "PASS: $name"}catch{$results.Add(@{name=$name;passed=$false});Write-Output "FAIL: $name -- $($_.Exception.Message)"}}
try{
 $f=(Invoke-GatePassScalar $c (Get-Content (Join-Path $PSScriptRoot '002_transaction_fixtures.sql') -Raw) @{RunId=$run})|ConvertFrom-Json;$ready=$true
 $pending=$f.visits.Where({$_.Label -eq 'PENDING'})[0];$second=$f.visits.Where({$_.Label -eq 'DECISION_DENY'})[0]
 Invoke-GatePassNonQuery $c 'INSERT gp.EmployeeEntraIdentities(TenantId,ObjectId,EmployeeId,IsActive,VerifiedAtUtc) VALUES(@tenant,@oid,@host,1,SYSUTCDATETIME()),(@tenant,@other,@otherhost,1,SYSUTCDATETIME());' @{tenant=$tenant;oid=$oid;host=$f.hostEmployeeId;other=$otherOid;otherhost=($f.hostEmployeeId -replace '-HOST$','-OTHERHOST')}
 Invoke-GatePassNonQuery $c "CREATE USER [$principal] WITHOUT LOGIN;ALTER ROLE gp_outlook_runtime ADD MEMBER [$principal];CREATE USER [$($principal)_api] WITHOUT LOGIN;ALTER ROLE gp_api_runtime ADD MEMBER [$($principal)_api];";$created=$true
 $outlook=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $outlook "EXECUTE AS USER='$principal';"
 $api=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $api "EXECUTE AS USER='$($principal)_api';"
 $p=@{tenant=$tenant;oid=$oid;host=$f.hostEmployeeId;key=[guid]::NewGuid();v=[guid]$pending.VisitId;hash=[Convert]::FromHexString($pending.SnapshotHex);decision='APPROVED'}
 $sql='EXEC gp.DecideOutlookVisit @TenantId=@tenant,@ObjectId=@oid,@ExpectedHostEmployeeId=@host,@ClientKey=@key,@VisitRequestId=@v,@SnapshotVersion=1,@SnapshotHash=@hash,@Decision=@decision;'
 Case 'Outlook runtime cannot read mappings, browser sessions, photos or worker queue, API cannot call Outlook decision' {
  Expect {Invoke-GatePassScalar $outlook 'SELECT COUNT(*) FROM gp.EmployeeEntraIdentities;'} 229
  foreach($proc in @('DecideVisit','ReadEmailRequest','ResolveVisitPhoto','ClaimNotifications','_RequireOutlookActor')){Expect {Invoke-GatePassScalar $outlook ('EXEC gp.'+$proc+';')} 229}
  Expect {Invoke-GatePassScalar $api $sql $p} 229
 }
 Case 'Wrong tenant object ID and assigned host fail before decision' {
  foreach($field in @('tenant','oid')){$wrong=$p.Clone();$wrong[$field]=[guid]::NewGuid();Expect {Invoke-GatePassScalar $outlook $sql $wrong} 52001}
  $wrong=$p.Clone();$wrong.oid=$otherOid;Expect {Invoke-GatePassScalar $outlook $sql $wrong} 52001
 }
 Case 'Stale disabled and mismatched identity mappings fail closed' {
  try{Invoke-GatePassNonQuery $c 'UPDATE gp.EmployeeEntraIdentities SET IsActive=0 WHERE TenantId=@tenant AND ObjectId=@oid;' @{tenant=$tenant;oid=$oid};Expect {Invoke-GatePassScalar $outlook $sql $p} 52001}finally{Invoke-GatePassNonQuery $c 'UPDATE gp.EmployeeEntraIdentities SET IsActive=1 WHERE TenantId=@tenant AND ObjectId=@oid;' @{tenant=$tenant;oid=$oid}}
  try{Invoke-GatePassNonQuery $c 'UPDATE gp.EmployeeEntraIdentities SET VerifiedAtUtc=DATEADD(day,-1,SYSUTCDATETIME()) WHERE TenantId=@tenant AND ObjectId=@oid;' @{tenant=$tenant;oid=$oid};Expect {Invoke-GatePassScalar $outlook $sql $p} 52001}finally{Invoke-GatePassNonQuery $c 'UPDATE gp.EmployeeEntraIdentities SET VerifiedAtUtc=SYSUTCDATETIME() WHERE TenantId=@tenant AND ObjectId=@oid;' @{tenant=$tenant;oid=$oid}}
 }
 Case 'Host project-office eligibility is rechecked for direct Outlook action' {
  try{Invoke-GatePassNonQuery $c 'UPDATE gp.EmployeeProjectLocationMemberships SET IsActive=0 WHERE EmployeeId=@host;' @{host=$f.hostEmployeeId};Expect {Invoke-GatePassScalar $outlook $sql $p} 52004}finally{Invoke-GatePassNonQuery $c 'UPDATE gp.EmployeeProjectLocationMemberships SET IsActive=1,VerifiedAtUtc=SYSUTCDATETIME() WHERE EmployeeId=@host;' @{host=$f.hostEmployeeId}}
 }
 Case 'Changed snapshot is rejected' {$wrong=$p.Clone();$wrong.hash=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);Expect {Invoke-GatePassScalar $outlook $sql $wrong} 52003}
 Case 'Expired approval deadline is rejected without changing the pass' {
  $expired=$f.visits.Where({$_.Label -eq 'DEADLINE'})[0];$wrong=$p.Clone();$wrong.key=[guid]::NewGuid();$wrong.v=[guid]$expired.VisitId;$wrong.hash=[Convert]::FromHexString($expired.SnapshotHex);Expect {Invoke-GatePassScalar $outlook $sql $wrong} 52005
  Assert ((Invoke-GatePassScalar $c 'SELECT Status FROM gp.AccessPasses WHERE AccessPassId=@p;' @{p=[guid]$expired.PassId}) -eq 'PENDING') 'Expired action changed the pass.'
 }
 Case 'Outlook approval needs no browser session, is idempotent and queues one decision message' {
  $first=Invoke-GatePassScalar $outlook $sql $p;$retry=Invoke-GatePassScalar $outlook $sql $p;Assert ($first -eq $retry) 'Replay changed receipt.'
  Assert ((Invoke-GatePassScalar $c "SELECT DecisionSource FROM gp.ApprovalDecisions WHERE VisitRequestId=@v;" @{v=[guid]$pending.VisitId}) -eq 'OUTLOOK') 'Incorrect decision source.'
  Assert ((Invoke-GatePassScalar $c "SELECT COUNT(*) FROM gp.NotificationOutbox WHERE VisitRequestId=@v AND TemplateCode='VISIT_DECIDED';" @{v=[guid]$pending.VisitId}) -eq 1) 'Duplicate result message.'
  Assert ((Invoke-GatePassScalar $c 'SELECT Status FROM gp.VisitRequests WHERE VisitRequestId=@v;' @{v=[guid]$second.VisitId}) -eq 'PENDING') 'Another participant changed.'
 }
 Case 'Opposite decision cannot overwrite committed approval' {$wrong=$p.Clone();$wrong.key=[guid]::NewGuid();$wrong.decision='DENIED';Expect {Invoke-GatePassScalar $outlook $sql $wrong} 52005}
 Case 'Replay also revalidates current identity mapping' {
  try{Invoke-GatePassNonQuery $c 'UPDATE gp.EmployeeEntraIdentities SET IsActive=0 WHERE TenantId=@tenant AND ObjectId=@oid;' @{tenant=$tenant;oid=$oid};Expect {Invoke-GatePassScalar $outlook $sql $p} 52001}finally{Invoke-GatePassNonQuery $c 'UPDATE gp.EmployeeEntraIdentities SET IsActive=1 WHERE TenantId=@tenant AND ObjectId=@oid;' @{tenant=$tenant;oid=$oid}}
 }
 Case 'Independent rejection denies only its own pass' {
  $deny=$p.Clone();$deny.key=[guid]::NewGuid();$deny.v=[guid]$second.VisitId;$deny.hash=[Convert]::FromHexString($second.SnapshotHex);$deny.decision='DENIED';$null=Invoke-GatePassScalar $outlook $sql $deny
  Assert ((Invoke-GatePassScalar $c 'SELECT Status FROM gp.AccessPasses WHERE AccessPassId=@p;' @{p=[guid]$second.PassId}) -eq 'DENIED') 'Pass stayed active.'
 }
}finally{
 if($outlook){$outlook.Dispose()};if($api){$api.Dispose()};try{Invoke-GatePassNonQuery $c 'DELETE gp.EmployeeEntraIdentities WHERE TenantId=@tenant;' @{tenant=$tenant};if($ready){Invoke-GatePassNonQuery $c (Get-Content (Join-Path $PSScriptRoot '003_transaction_cleanup.sql') -Raw) @{RunId=$run}};if($created){Invoke-GatePassNonQuery $c "DROP USER [$principal];DROP USER [$($principal)_api];"}}finally{$c.Dispose()}
 @{status=$(if(@($results|Where-Object {-not $_.passed}).Count){'FAIL'}else{'PASS'});cases=@($results);actualOutlookToken=$false;externalMailSent=$false}|ConvertTo-Json -Depth 6|Set-Content (Join-Path $taskRoot 'database/validation/outlook-actions-report.json')
}
if(@($results|Where-Object {-not $_.passed}).Count){throw 'Outlook action SQL tests failed.'};Write-Output "PASS: $($results.Count) actual SQL Outlook action cases."
