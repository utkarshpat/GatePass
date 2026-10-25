#Requires -Version 7.0
[CmdletBinding()]param([switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskAdmin=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate
$taskRun=[guid]::NewGuid();$taskPrincipal='gp_presence_export_'+$taskRun.ToString('N');$taskApi=$null;$taskReady=$false;$taskCreated=$false;$taskCases=[Collections.Generic.List[object]]::new()
function Assert($value,[string]$message){if(-not $value){throw $message}}
function Number($errorObject){$base=$errorObject.GetBaseException();if($base -is [Data.SqlClient.SqlException]){return $base.Number};return 0}
function Expect([scriptblock]$work,[int]$number){try{$null=&$work}catch{if((Number $_.Exception) -eq $number){return};throw};throw "Expected SQL $number"}
function Auth([string]$actor='GUARD'){return @{SessionHash=[Convert]::FromHexString($taskActors[$actor].SessionHex);CsrfHash=[Convert]::FromHexString($taskActors[$actor].CsrfHex)}}
function Call([string]$procedure,[hashtable]$parameters){$arguments=($parameters.Keys|ForEach-Object{'@'+$_+'=@'+$_})-join ',';return(Invoke-GatePassScalar $taskApi ('EXEC gp.'+$procedure+' '+$arguments) $parameters)|ConvertFrom-Json}
function MovementParameters($visit,[string]$event,[long]$pair=$taskPair,[guid]$key=[guid]::NewGuid(),[string]$actor='GUARD',[switch]$Legacy){
 $p=Auth $actor;$p.ClientKey=$key;$p.VisitRequestId=[guid]$visit.VisitId;$p.AccessPassId=[guid]$visit.PassId;$p.LocationId=$taskLocation;$p.EventType=$event;$p.EntryMethod='MANUAL'
 if($Legacy){$p.SelectedProjectLocationId=$pair}else{$p.DutyKind='PROJECT';$p.DutyId=$pair};return $p
}
function Invoke-Movement($visit,[string]$event,[long]$pair=$taskPair,[guid]$key=[guid]::NewGuid(),[switch]$Legacy){$p=MovementParameters $visit $event $pair $key -Legacy:$Legacy;return Call $(if($Legacy){'RecordMovement'}else{'RecordGuardDutyMovement'}) $p}
function Read-Duty($visit){$p=Auth;$p.LocationId=$taskLocation;$p.DutyKind='PROJECT';$p.DutyId=$taskPair;$p.VisitRequestId=[guid]$visit.VisitId;return(Call 'ReadGuardDutyPass' $p).visit}
function Register([bool]$export=$false,[string]$actor='ADMIN'){$p=Auth $actor;$p.LocationId=$taskLocation;$p.ProjectLocationId=$taskPair;$p.FromDate=$taskDay;$p.ToDate=$taskDay;$p.ForExport=$export;return Call 'ReadAdminVisitRegister' $p}
function ExportGrant([bool]$enabled){if($enabled){Invoke-GatePassNonQuery $taskAdmin "INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT RoleGrantId,'REPORTS_EXPORT' FROM gp.StaffRoleGrants g WHERE UserId=@actor AND NOT EXISTS(SELECT 1 FROM gp.GrantCapabilities c WHERE c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='REPORTS_EXPORT');" @{actor=[guid]$taskActors.ADMIN.UserId}}else{Invoke-GatePassNonQuery $taskAdmin "DELETE c FROM gp.GrantCapabilities c JOIN gp.StaffRoleGrants g ON g.RoleGrantId=c.RoleGrantId WHERE g.UserId=@actor AND c.CapabilityCode='REPORTS_EXPORT';" @{actor=[guid]$taskActors.ADMIN.UserId}}}
function Reset-Occupancy {
 foreach($visit in @($taskHosted,$taskTemp)){
  $p=@{visit=[guid]$visit.VisitId}
  if((Invoke-GatePassScalar $taskAdmin 'SELECT CONVERT(int,IsInside) FROM gp.VisitPresence WHERE VisitRequestId=@visit;' $p) -eq 1){$null=Invoke-Movement $visit 'EXIT'}
  $pairs=Invoke-GatePassScalar $taskAdmin 'SELECT COALESCE((SELECT ProjectLocationId id FROM gp.EmployeeProjectPresence WHERE VisitRequestId=@visit AND IsInside=1 FOR JSON PATH),N''[]'');' $p
  foreach($pair in @($pairs|ConvertFrom-Json)){$null=Invoke-Movement $visit 'EXIT' ([long]$pair.id)}
 }
}
function Case([string]$name,[scriptblock]$work){try{$null=&$work;$taskCases.Add(@{name=$name;passed=$true});Write-Output "PASS: $name"}catch{$taskCases.Add(@{name=$name;passed=$false});Write-Output "FAIL: $name -- $($_.Exception.Message)"}finally{Reset-Occupancy}}
function Race([switch]$LegacyHosted){
 $connections=[Collections.Generic.List[object]]::new();$commands=[Collections.Generic.List[object]]::new();$tasks=[Collections.Generic.List[object]]::new();$results=[Collections.Generic.List[object]]::new();$gate=$false
 try{
  foreach($entry in @(@{visit=$taskTemp;actor='GUARD';legacy=$false},@{visit=$taskHosted;actor='GUARD2';legacy=[bool]$LegacyHosted})){
   $connection=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $connection "EXECUTE AS USER='$taskPrincipal';";$connections.Add($connection)
   $p=MovementParameters $entry.visit 'ENTRY' $taskPair ([guid]::NewGuid()) $entry.actor -Legacy:$entry.legacy;$arguments=($p.Keys|ForEach-Object{'@'+$_+'=@'+$_})-join ',';$procedure=if($entry.legacy){'RecordMovement'}else{'RecordGuardDutyMovement'}
   $commands.Add((New-GatePassSqlCommand $connection ('EXEC gp.'+$procedure+' '+$arguments) $p))
  }
  $sid1=Invoke-GatePassScalar $connections[0] 'SELECT @@SPID;';$sid2=Invoke-GatePassScalar $connections[1] 'SELECT @@SPID;'
  Invoke-GatePassNonQuery $taskAdmin 'BEGIN TRANSACTION;';$gate=$true
  Invoke-GatePassNonQuery $taskAdmin "DECLARE @resource nvarchar(255)=N'gp:employee-project:'+CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(nvarchar(64),@employee)),2);EXEC gp._TakeLock @resource;" @{employee=$taskFixture.hostEmployeeId}
  foreach($command in $commands){$tasks.Add($command.ExecuteScalarAsync())}
  $deadline=[datetime]::UtcNow.AddSeconds(5);do{$waiting=Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM sys.dm_exec_requests WHERE session_id IN(@a,@b) AND wait_type LIKE 'LCK_M%';" @{a=$sid1;b=$sid2};if($waiting -eq 2){break};[Threading.Thread]::Sleep(25)}while([datetime]::UtcNow -lt $deadline)
  Invoke-GatePassNonQuery $taskAdmin 'COMMIT;';$gate=$false
  foreach($task in $tasks){try{$null=$task.GetAwaiter().GetResult();$results.Add(@{success=$true;number=0})}catch{$results.Add(@{success=$false;number=(Number $_.Exception)})}}
  Assert ($waiting -eq 2) 'Both credential paths did not take the employee lock'
  Assert (@($results|Where-Object success).Count -eq 1 -and @($results|Where-Object number -eq 52005).Count -eq 1) 'Mixed credential entries did not commit exactly once'
 }finally{if($gate){Invoke-GatePassNonQuery $taskAdmin 'IF @@TRANCOUNT>0 ROLLBACK;'};foreach($command in $commands){$command.Dispose()};foreach($connection in $connections){$connection.Dispose()}}
}
try{
 $taskFixture=(Invoke-GatePassScalar $taskAdmin (Get-Content (Join-Path $PSScriptRoot '002_transaction_fixtures.sql') -Raw) @{RunId=$taskRun})|ConvertFrom-Json;$taskReady=$true
 $taskActors=@{};foreach($actor in $taskFixture.actors){$taskActors[$actor.Label]=$actor};$taskTemp=$taskFixture.visits.Where({$_.Label -eq 'TEMP'})[0];$taskHosted=$taskFixture.visits.Where({$_.Label -eq 'EMP_DISABLED'})[0]
 $taskLocation=[int]$taskFixture.locationId;$taskPair=[long]$taskFixture.projectLocationId;$taskDay=Invoke-GatePassScalar $taskAdmin 'SELECT CONVERT(date,DATEADD(minute,330,SYSUTCDATETIME()));'
 Invoke-GatePassNonQuery $taskAdmin "INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT RoleGrantId,'VISITS_READ' FROM gp.StaffRoleGrants WHERE UserId=@actor;" @{actor=[guid]$taskActors.ADMIN.UserId}
 Invoke-GatePassNonQuery $taskAdmin "CREATE USER [$taskPrincipal] WITHOUT LOGIN;ALTER ROLE gp_api_runtime ADD MEMBER [$taskPrincipal];";$taskCreated=$true
 $taskApi=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $taskApi "EXECUTE AS USER='$taskPrincipal';"
 Case 'Visit reading remains available without export authority' {Assert ((Register).rows.Count -gt 0) 'Read permission changed'}
 Case 'Export requires its explicit capability' {Expect {Register $true} 52001}
 Case 'Console exposes denied export permission' {$p=Auth 'ADMIN';$p.LocationId=$taskLocation;$p.ProjectLocationId=$taskPair;$r=Call 'GetAdminConsoleScope' $p;Assert ($r.canExport -eq $false) 'Console did not project denial'}
 Case 'Allowed export returns a fingerprint and a distinct audit event' {ExportGrant $true;$r=Register $true;Assert ($r.datasetVersion -match '^[a-f0-9]{64}$') 'Fingerprint missing';Assert ((Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM gp.SecurityAuditEvents WHERE ActorUserId=@actor AND ActionCode='ADMIN_REGISTER_EXPORTED';" @{actor=[guid]$taskActors.ADMIN.UserId}) -eq 1) 'Export audit missing'}
 Case 'Revoked export permission is checked again while ordinary reading remains' {ExportGrant $false;Expect {Register $true} 52001;Assert ((Register).total -gt 0) 'Ordinary read was lost'}
 Case 'Export permission cannot widen office scope' {ExportGrant $true;$p=Auth 'ADMIN';$p.LocationId=[int]$taskFixture.otherLocationId;$p.FromDate=$taskDay;$p.ToDate=$taskDay;$p.ForExport=$true;Expect {Call 'ReadAdminVisitRegister' $p} 52001}
 Case 'Hosted entry blocks Digital ID entry after project assignment changes' {
  Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.EmployeeProjectLocationMemberships SET IsActive=0 WHERE EmployeeId=@employee AND ProjectLocationId=@pair;' @{employee=$taskFixture.hostEmployeeId;pair=$taskPair}
  try{$null=Invoke-Movement $taskHosted 'ENTRY'}finally{Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.EmployeeProjectLocationMemberships SET IsActive=1,VerifiedAtUtc=SYSUTCDATETIME() WHERE EmployeeId=@employee AND ProjectLocationId=@pair;' @{employee=$taskFixture.hostEmployeeId;pair=$taskPair}}
  Expect {Invoke-Movement $taskTemp 'ENTRY'} 52005
 }
 Case 'Digital ID detail does not offer entry over a hosted occupant' {$null=Invoke-Movement $taskHosted 'ENTRY';Assert (-not(Read-Duty $taskTemp).canEnter) 'Duplicate entry advice remained enabled'}
 Case 'Digital ID entry blocks hosted entry through the duty endpoint' {$null=Invoke-Movement $taskTemp 'ENTRY';Expect {Invoke-Movement $taskHosted 'ENTRY'} 52005}
 Case 'Hosted detail does not offer entry over a Digital ID occupant' {$null=Invoke-Movement $taskTemp 'ENTRY';Assert (-not(Read-Duty $taskHosted).canEnter) 'Hosted duplicate entry advice remained enabled'}
 Case 'Legacy hosted movement enforces the same cross-credential conflict' {$null=Invoke-Movement $taskTemp 'ENTRY';Expect {Invoke-Movement $taskHosted 'ENTRY' -Legacy} 52005}
 Case 'Original hosted exit permits a later Digital ID entry without phantom presence' {$null=Invoke-Movement $taskHosted 'ENTRY';$null=Invoke-Movement $taskHosted 'EXIT';$null=Invoke-Movement $taskTemp 'ENTRY';$null=Invoke-Movement $taskTemp 'EXIT';Assert ((Invoke-GatePassScalar $taskAdmin 'SELECT CONVERT(int,gp._PersonInsideOffice(@visit));' @{visit=[guid]$taskTemp.VisitId}) -eq 0) 'A completed exit left phantom occupancy'}
 Case 'Original Digital ID exit permits a later hosted entry' {$null=Invoke-Movement $taskTemp 'ENTRY';$null=Invoke-Movement $taskTemp 'EXIT';Assert (Invoke-Movement $taskHosted 'ENTRY').isInside 'Hosted entry remained blocked'}
 Case 'Both credential types retain same-key entry and exit replay' {foreach($visit in @($taskTemp,$taskHosted)){$key=[guid]::NewGuid();$first=Invoke-Movement $visit 'ENTRY' $taskPair $key;Assert ((Invoke-Movement $visit 'ENTRY' $taskPair $key).operationId -eq $first.operationId) 'Entry retry changed receipt';$key=[guid]::NewGuid();$exit=Invoke-Movement $visit 'EXIT' $taskPair $key;Assert ((Invoke-Movement $visit 'EXIT' $taskPair $key).operationId -eq $exit.operationId) 'Exit retry changed receipt'}}
 Case 'Two guards racing different credentials commit one entry' {Race}
 Case 'A legacy and duty entry race also commits one entry' {Race -LegacyHosted}
 Case 'Runtime cannot bypass presence writes or call the private occupancy helper' {Expect {Invoke-GatePassScalar $taskApi 'SELECT COUNT(*) FROM gp.EmployeeProjectPresence;'} 229;Expect {Invoke-GatePassScalar $taskApi 'SELECT gp._EmployeeProjectOccupied(@employee,@pair);' @{employee=$taskFixture.hostEmployeeId;pair=$taskPair}} 229}
}finally{
 if($taskApi){try{Invoke-GatePassNonQuery $taskApi 'REVERT;'}finally{$taskApi.Dispose()}}
 try{if($taskCreated){Invoke-GatePassNonQuery $taskAdmin "DROP USER [$taskPrincipal];"};if($taskReady){Invoke-GatePassNonQuery $taskAdmin (Get-Content (Join-Path $PSScriptRoot '003_transaction_cleanup.sql') -Raw) @{RunId=$taskRun}}}finally{$taskAdmin.Dispose()}
}
$failed=@($taskCases|Where-Object passed -eq $false).Count
@{Status=if($failed){'FAIL'}else{'PASS'};Cases=$taskCases.Count;Failed=$failed;RestrictedRuntime=$true;OwnedCleanup=$true}|ConvertTo-Json -Compress
if($failed){throw 'Employee presence/export regressions failed'}
