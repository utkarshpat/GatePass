#Requires -Version 7.0
[CmdletBinding()]param([switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $root 'tools/GatePass.LocalSql.psm1') -Force
$db=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate
$run=[guid]::NewGuid();$prefix='GP02-'+$run.ToString('N').Substring(0,20).ToUpperInvariant();$name='RegisterBaseline_'+$run.ToString('N');$principal='gp_register_parity_'+$run.ToString('N')
$api=$null;$ready=$false;$created=$false;$baselineCreated=$false;$checks=[Collections.Generic.List[object]]::new()
function Assert($value,[string]$message){if(-not $value){throw $message}}
function ReadRegister([string]$procedure,[hashtable]$patch=@{}){
 $p=$base.Clone();foreach($key in $patch.Keys){$p[$key]=$patch[$key]};$args=($p.Keys|ForEach-Object{'@'+$_+'=@'+$_}) -join ','
 return(Invoke-GatePassScalar $api ('EXEC gp.'+$procedure+' '+$args) $p)|ConvertFrom-Json
}
function Rows($packet){ConvertTo-Json -InputObject @($packet.rows) -Depth 8 -Compress}
try{
 Write-Output ('OWNED_RUN '+$run.ToString())
 $f=(& (Join-Path $root 'tests/browser/WorkspaceQueueFixture.ps1') -RunId $run -Action Create -Rows 100)|ConvertFrom-Json;$ready=$true
 $auth=(Invoke-GatePassScalar $db "SELECT TOP(1) u.UserId actor,CONVERT(varchar(64),s.SessionHash,2) sessionHex,CONVERT(varchar(64),s.CsrfHash,2) csrfHex FROM gp.Sessions s JOIN gp.Users u ON u.UserId=s.UserId WHERE u.IdentitySubject=@subject AND u.IdentityIssuer='gatepass-phase02-fixture' ORDER BY s.CreatedAtUtc DESC FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;" @{subject=$prefix+':ADMIN'})|ConvertFrom-Json
 Invoke-GatePassNonQuery $db "INSERT gp.GrantCapabilities SELECT RoleGrantId,'REPORTS_EXPORT' FROM gp.StaffRoleGrants WHERE UserId=@actor AND RoleCode='LOCATION_ADMIN';CREATE USER [$principal] WITHOUT LOGIN;ALTER ROLE gp_api_runtime ADD MEMBER [$principal];" @{actor=[guid]$auth.actor};$created=$true
 # Immutable migration 107 supplies an independent before-change result oracle.
 $source=Get-Content (Join-Path $root 'database/migrations/107_export_snapshot_storage_budget.sql') -Raw
 $start=$source.IndexOf('ALTER PROCEDURE gp.ReadAdminVisitRegister');$end=$source.IndexOf("`nGO",$start)
 $definition=$source.Substring($start,$end-$start).Replace('ALTER PROCEDURE gp.ReadAdminVisitRegister',"CREATE PROCEDURE gp.[$name]")
 Invoke-GatePassNonQuery $db $definition;$baselineCreated=$true;Invoke-GatePassNonQuery $db "GRANT EXECUTE ON gp.[$name] TO [$principal];"
 $api=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $api "EXECUTE AS USER='$principal';"
 $day=[datetime](Invoke-GatePassScalar $db 'SELECT CONVERT(date,DATEADD(minute,330,SYSUTCDATETIME()));')
 $base=@{SessionHash=[Convert]::FromHexString($auth.sessionHex);CsrfHash=[Convert]::FromHexString($auth.csrfHex);LocationId=1;ProjectLocationId=[long]$f.pair;FromDate=$day;ToDate=$day;Page=1}
 $fields=@('localVisitDate','submittedAtUtc','personName','employeeId','personEmail','personPhone','companyName','deviceTypes','locationName','projectName','hostName','hostEmail','requestType','reason','publicReference','publicPassNumber','status','passStatus','presence','printStatus','returnedAtUtc','validFromUtc','validUntilUtc','firstEntryAtUtc','lastEntryAtUtc','lastExitAtUtc')
 foreach($field in $fields){foreach($direction in @('ASC','DESC')){
  $patch=@{Sort=$field;Direction=$direction};$old=ReadRegister $name $patch;$new=ReadRegister ReadAdminVisitRegister $patch
  Assert ($old.total -eq $new.total -and (Rows $old) -ceq (Rows $new)) "Register rows/order differ for $field $direction"
  $checks.Add(@{name="Exact legacy row parity: $field $direction";passed=$true});Write-Output "PASS: $field $direction"
 }}
 foreach($field in @('personName','submittedAtUtc','deviceTypes')){
  $patch=@{Sort=$field;Page=2;FiltersJson=(@{publicReference=$prefix+'-Q'}|ConvertTo-Json -Compress)}
  $old=ReadRegister $name $patch;$new=ReadRegister ReadAdminVisitRegister $patch
  Assert ($old.total -eq 100 -and $new.total -eq 100 -and (Rows $old) -ceq (Rows $new)) "Filtered second page differs for $field"
  $checks.Add(@{name="Filtered second-page parity: $field";passed=$true})
 }
 $legacy=ReadRegister $name @{ForExport=$true;PageSize=50}
 $snapshot=ReadRegister ReadAdminVisitRegister @{ForExport=$true;PageSize=50;CreateExportSnapshot=$true}
 Assert ($legacy.datasetVersion -ceq $snapshot.datasetVersion -and $legacy.total -eq $snapshot.total -and (Rows $legacy) -ceq (Rows $snapshot)) 'Export fingerprint or first snapshot page changed'
 $seen=[Collections.Generic.HashSet[string]]::new();foreach($row in $snapshot.rows){Assert ($seen.Add($row.visitRequestId)) 'Duplicate first-page row'}
 $total=$snapshot.total
 foreach($page in 2..([int][math]::Ceiling($total/50))){$next=ReadRegister ReadAdminVisitRegister @{ForExport=$true;PageSize=50;ExportSnapshotId=[guid]$snapshot.exportSnapshotId;Page=$page};foreach($row in $next.rows){Assert ($seen.Add($row.visitRequestId)) 'Duplicate snapshot row'}}
 Assert ($seen.Count -eq $total) 'Snapshot export omitted visits'
 $final=ReadRegister ReadAdminVisitRegister @{ForExport=$true;PageSize=50;ExportSnapshotId=[guid]$snapshot.exportSnapshotId;FinishExport=$true}
 Assert ($final.exportValidated -and $final.datasetVersion -ceq $legacy.datasetVersion) 'Final validation differs from legacy full-content digest'
 $checks.Add(@{name='Exact legacy fingerprint and full snapshot completeness/final validation';passed=$true})
 Write-Output "PASS: $($checks.Count) register ordering, content and export parity checks"
}catch{Write-Output ("PARITY_FAILURE "+$_.Exception.Message);throw}finally{
 if($api){$api.Dispose()}
 try{
  if($baselineCreated){Invoke-GatePassNonQuery $db "DROP PROCEDURE gp.[$name];"}
  if($ready){Invoke-GatePassNonQuery $db "DELETE x FROM gp.AdminExportSnapshots x JOIN gp.Sessions s ON s.SessionHash=x.OwnerSessionHash JOIN gp.Users u ON u.UserId=s.UserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject LIKE @prefix+':%';" @{prefix=$prefix};$null=& (Join-Path $root 'tests/browser/WorkspaceQueueFixture.ps1') -RunId $run -Action Cleanup}
  if($created){Invoke-GatePassNonQuery $db "DROP USER [$principal];"}
 }finally{$db.Dispose()}
 New-Item -ItemType Directory (Join-Path $root 'database/validation') -Force|Out-Null
 @{runId=$run.ToString();sourceSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant();checks=$checks.ToArray();count=$checks.Count}|ConvertTo-Json -Depth 5|Set-Content (Join-Path $root 'database/validation/register-ordering-parity.json')
}
