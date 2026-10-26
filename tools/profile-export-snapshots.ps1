#Requires -Version 7.0
[CmdletBinding()]param([ValidateRange(1000,10000)][int]$Rows=10000)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent $PSScriptRoot;Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskRun=[guid]::NewGuid();$taskPrefix='GP02-'+$taskRun.ToString('N').Substring(0,20).ToUpperInvariant();$taskName='gp_export_perf_'+$taskRun.ToString('N')
$taskDb=Open-GatePassLocalSql -TrustLocalServerCertificate;$taskApi=$null;$taskCreated=$false;$taskSnapshot=$null
$taskDirectory=Join-Path $taskRoot ('output/export-performance/'+$taskRun);$null=New-Item -ItemType Directory -Path $taskDirectory
$taskReport=@{runId=$taskRun.ToString();startedAt=[datetime]::UtcNow.ToString('o');scriptSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant();status='RUNNING';rows=$Rows;measurements=@();cleanup=@{};limitations=@('One sequential synthetic local SQL export per mode, legacy first; not HTTP p95 or production throughput.','Reused execute-only connection; principal setup excluded.','Snapshot protocol preserves current full-content validation before download.')}
function Read-Page([int]$Page,[hashtable]$Extra=@{}){
 $taskP=$taskBase.Clone();$taskP.Page=$Page;foreach($taskKey in $Extra.Keys){$taskP[$taskKey]=$Extra[$taskKey]};$taskArgs=($taskP.Keys|ForEach-Object{'@'+$_+'=@'+$_})-join ','
 $taskWatch=[Diagnostics.Stopwatch]::StartNew();$taskPacket=(Invoke-GatePassScalar $taskApi ('EXEC gp.ReadAdminVisitRegister '+$taskArgs) $taskP)|ConvertFrom-Json
 $taskReport.measurements+=@{page=$Page;milliseconds=$taskWatch.Elapsed.TotalMilliseconds;mode=$script:taskMode;returnedRows=$taskPacket.rows.Count}
 return $taskPacket
}
try{
 $taskFixture=(& (Join-Path $taskRoot 'tests/browser/WorkspaceQueueFixture.ps1') -RunId $taskRun -Action Create -Rows $Rows)|ConvertFrom-Json
 $taskAuth=(Invoke-GatePassScalar $taskDb "SELECT(SELECT TOP(1) u.UserId actor,CONVERT(varchar(64),s.SessionHash,2) sessionHex,CONVERT(varchar(64),s.CsrfHash,2) csrfHex FROM gp.Sessions s JOIN gp.Users u ON u.UserId=s.UserId WHERE u.IdentitySubject=@subject AND u.IdentityIssuer='gatepass-phase02-fixture' ORDER BY s.CreatedAtUtc DESC FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);" @{subject=$taskPrefix+':ADMIN'})|ConvertFrom-Json
 Invoke-GatePassNonQuery $taskDb "BEGIN TRANSACTION;INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT RoleGrantId,'REPORTS_EXPORT' FROM gp.StaffRoleGrants WHERE UserId=@actor AND RoleCode='LOCATION_ADMIN';CREATE USER [$taskName] WITHOUT LOGIN;ALTER ROLE gp_api_runtime ADD MEMBER [$taskName];COMMIT;" @{actor=[guid]$taskAuth.actor};$taskCreated=$true
 $taskApi=Open-GatePassLocalSql -TrustLocalServerCertificate;Invoke-GatePassNonQuery $taskApi "EXECUTE AS USER='$taskName';"
 $taskDay=[datetime](Invoke-GatePassScalar $taskDb 'SELECT CONVERT(date,DATEADD(minute,330,SYSUTCDATETIME()));')
 $taskBase=@{SessionHash=[Convert]::FromHexString($taskAuth.sessionHex);CsrfHash=[Convert]::FromHexString($taskAuth.csrfHex);LocationId=1;ProjectLocationId=[long]$taskFixture.pair;FromDate=$taskDay;ToDate=$taskDay;ForExport=$true;PageSize=200;FiltersJson=(@{publicReference=$taskPrefix+'-Q'}|ConvertTo-Json -Compress)}
 $taskResults=@{}
 foreach($script:taskMode in @('legacy','snapshot')){
  $taskTotalWatch=[Diagnostics.Stopwatch]::StartNew();$taskSeen=[Collections.Generic.HashSet[string]]::new();$taskFingerprint=$null
  $taskPages=[int][math]::Ceiling($Rows/200)
  foreach($taskPage in 1..$taskPages){
   $taskExtra=if($script:taskMode -eq 'legacy'){@{}}elseif($taskPage -eq 1){@{CreateExportSnapshot=$true}}else{@{ExportSnapshotId=$taskSnapshot}}
   $taskPacket=Read-Page $taskPage $taskExtra
   if($taskPacket.total -ne $Rows){throw 'Dataset row count mismatch'}
   if($taskPage -eq 1){$taskFingerprint=$taskPacket.datasetVersion;if($script:taskMode -eq 'snapshot'){$taskSnapshot=[guid]$taskPacket.exportSnapshotId;$taskReport.snapshotBytes=Invoke-GatePassScalar $taskDb 'SELECT DATALENGTH(RowsJson) FROM gp.AdminExportSnapshots WHERE SnapshotId=@id;' @{id=$taskSnapshot}}}
   if($taskPacket.datasetVersion -cne $taskFingerprint){throw 'Unstable export fingerprint'}
   foreach($taskRow in $taskPacket.rows){if(-not $taskSeen.Add($taskRow.visitRequestId)){throw 'Duplicate exported row'}}
  }
  if($script:taskMode -eq 'snapshot'){$taskFinal=Read-Page 1 @{ExportSnapshotId=$taskSnapshot;FinishExport=$true};if($taskFinal.exportValidated -ne $true -or $taskFinal.datasetVersion -cne $taskFingerprint){throw 'Final content validation failed'}}
  if($taskSeen.Count -ne $Rows){throw 'Incomplete export'}
  $taskResults[$script:taskMode]=@{durationMs=$taskTotalWatch.Elapsed.TotalMilliseconds;rows=$taskSeen.Count;datasetVersion=$taskFingerprint;requests=$taskPages+$(if($script:taskMode -eq 'snapshot'){1}else{0})}
 }
 if($taskResults.legacy.datasetVersion -cne $taskResults.snapshot.datasetVersion){throw 'Export modes differ'}
 $taskReport.results=$taskResults;$taskReport.status='PASS'
}catch{$taskReport.status='FAIL';$taskReport.failure=$_.Exception.Message;Write-Host ('EXPORT_PROFILE_FAIL '+$_.Exception.GetBaseException().Message)}finally{
 if($taskApi){$taskApi.Dispose()};if($taskSnapshot){Invoke-GatePassNonQuery $taskDb 'DELETE gp.AdminExportSnapshots WHERE SnapshotId=@id;' @{id=$taskSnapshot}}
 if($taskCreated){Invoke-GatePassNonQuery $taskDb "DROP USER [$taskName];"};$taskDb.Dispose()
 $taskCleanupWatch=[Diagnostics.Stopwatch]::StartNew()
 try{$null=& (Join-Path $taskRoot 'tests/browser/WorkspaceQueueFixture.ps1') -RunId $taskRun -Action Cleanup;$taskReport.cleanup=@{completed=$true;durationMs=$taskCleanupWatch.Elapsed.TotalMilliseconds}}catch{$taskReport.status='FAIL';$taskReport.cleanup=@{completed=$false;error=$_.Exception.GetBaseException().Message}}
 $taskReport.finishedAt=[datetime]::UtcNow.ToString('o')
 $taskReport|ConvertTo-Json -Depth 9|Set-Content -LiteralPath (Join-Path $taskDirectory 'report.json') -Encoding utf8
 Write-Host ('EXPORT_PERFORMANCE_REPORT '+(Join-Path $taskDirectory 'report.json')+' '+$taskReport.status)
}
if($taskReport.status -ne 'PASS'){exit 1}
