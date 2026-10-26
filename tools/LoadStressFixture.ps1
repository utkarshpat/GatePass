#Requires -Version 7.0
[CmdletBinding()]param([Parameter(Mandatory)][guid]$RunId,[ValidateSet('Create','Inspect','Refresh','Direct','Cleanup','ExportAccess')][string]$Action,[ValidateRange(1,200)][int]$Repetitions=40)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot 'GatePass.LocalSql.psm1') -Force
$taskPrefix='GP02-'+$RunId.ToString('N').Substring(0,20).ToUpperInvariant()
if($Action -eq 'Cleanup'){
 & (Join-Path $taskRoot 'tests/browser/WorkspaceQueueFixture.ps1') -RunId $RunId -Action Cleanup
 $taskDb=Open-GatePassLocalSql -TrustLocalServerCertificate
 try{$taskRemaining=Invoke-GatePassScalar $taskDb "SELECT COUNT(*) FROM gp.Users WHERE IdentityIssuer='gatepass-phase02-fixture' AND IdentitySubject LIKE @prefix+':%';" @{prefix=$taskPrefix};if($taskRemaining -ne 0){throw 'Owned load fixture cleanup incomplete'};@{usersRemaining=0;cleaned=$true}|ConvertTo-Json -Compress}finally{$taskDb.Dispose()};exit
}
$taskBase=$null
if($Action -eq 'Create'){$taskBase=(& (Join-Path $taskRoot 'tests/browser/WorkspaceQueueFixture.ps1') -RunId $RunId -Action Create)|ConvertFrom-Json}
$taskDb=Open-GatePassLocalSql -TrustLocalServerCertificate
function Read-TaskFunctionCounters {
 $taskJson=Invoke-GatePassScalar $taskDb @'
SELECT(SELECT OBJECT_SCHEMA_NAME(object_id,database_id)+'.'+OBJECT_NAME(object_id,database_id) name,
 SUM(execution_count) calls,SUM(total_worker_time) cpuUs,SUM(total_elapsed_time) elapsedUs,SUM(total_logical_reads) logicalReads
 FROM sys.dm_exec_function_stats WHERE database_id=DB_ID() AND OBJECT_SCHEMA_NAME(object_id,database_id)='gp'
 GROUP BY database_id,object_id FOR JSON PATH);
'@
 $taskCounters=@{};foreach($taskRow in ($taskJson|ConvertFrom-Json)){$taskCounters[$taskRow.name]=$taskRow};return $taskCounters
}
try{
 if($Action -eq 'ExportAccess'){
  Invoke-GatePassNonQuery $taskDb @'
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
DECLARE @actor uniqueidentifier=(SELECT UserId FROM gp.Users WHERE IdentityIssuer='gatepass-phase02-fixture' AND IdentitySubject=@prefix+':ADMIN');
IF @actor IS NULL THROW 52900,'Owned load administrator required.',1;
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT g.RoleGrantId,'REPORTS_EXPORT' FROM gp.StaffRoleGrants g WHERE g.UserId=@actor AND g.RoleCode='LOCATION_ADMIN' AND NOT EXISTS(SELECT 1 FROM gp.GrantCapabilities c WHERE c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='REPORTS_EXPORT');COMMIT;
'@ @{prefix=$taskPrefix}
  @{exportAccess=$true;scope='invocation-owned administrator only'}|ConvertTo-Json -Compress;exit
 }
 if($Action -eq 'Refresh'){
  Invoke-GatePassNonQuery $taskDb @'
SET XACT_ABORT ON;BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
DECLARE @now datetime2(3)=SYSUTCDATETIME();
DECLARE @owned table(EmployeeId nvarchar(64) PRIMARY KEY);
INSERT @owned SELECT e.EmployeeId FROM gp.Employees e JOIN gp.Users u ON u.UserId=e.UserId
WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject LIKE @prefix+':%';
IF(SELECT COUNT(*) FROM @owned)<>2 THROW 52900,'Owned load directory fixture required.',1;
UPDATE e SET LastSyncedAtUtc=@now FROM gp.Employees e JOIN @owned o ON o.EmployeeId=e.EmployeeId;
UPDATE m SET VerifiedAtUtc=@now FROM gp.EmployeeProjectMemberships m JOIN @owned o ON o.EmployeeId=m.EmployeeId;
UPDATE m SET VerifiedAtUtc=@now FROM gp.EmployeeOfficeMemberships m JOIN @owned o ON o.EmployeeId=m.EmployeeId;
UPDATE m SET VerifiedAtUtc=@now FROM gp.EmployeeProjectLocationMemberships m JOIN @owned o ON o.EmployeeId=m.EmployeeId;
UPDATE gp.Projects SET LastSyncedAtUtc=@now WHERE ExternalProjectCode IN(@prefix+'-A',@prefix+'-B');
COMMIT;
'@ @{prefix=$taskPrefix}
  @{refreshed=$true;scope='invocation-owned synthetic employees, memberships and projects only'}|ConvertTo-Json -Compress;exit
 }
 if($Action -eq 'Create'){
  Invoke-GatePassNonQuery $taskDb @'
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
UPDATE v SET Status='PENDING',DecisionAtUtc=NULL,SubmittedAtUtc=DATEADD(minute,-20,SYSUTCDATETIME())
FROM gp.VisitRequests v WHERE v.PublicReference LIKE @prefix+'-Q%' AND TRY_CONVERT(int,SUBSTRING(v.PublicReference,LEN(@prefix)+3,10))%5=0;
UPDATE p SET Status='PENDING' FROM gp.AccessPasses p JOIN gp.VisitRequests v ON v.VisitRequestId=p.VisitRequestId WHERE v.PublicReference LIKE @prefix+'-Q%' AND v.Status='PENDING';
COMMIT;
'@ @{prefix=$taskPrefix}
 }
 $taskState=(Invoke-GatePassScalar $taskDb @'
DECLARE @pair bigint=(SELECT pl.ProjectLocationId FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId WHERE p.ExternalProjectCode=@prefix+'-A' AND pl.LocationId=1);
SELECT CONVERT(varchar(20),@pair) pair,1 locationId,CONVERT(char(10),CONVERT(date,DATEADD(minute,330,SYSUTCDATETIME())),23) today,
 CONVERT(varchar(64),SERVERPROPERTY('ProductVersion')) sqlVersion,CONVERT(nvarchar(128),SERVERPROPERTY('Edition')) sqlEdition,
 (SELECT COUNT(*) FROM gp.SchemaMigrations) migrations,
 (SELECT COUNT(*) FROM gp.VisitRequests) databaseVisitRows,
 (SELECT COUNT(*) FROM gp.VisitRequests WHERE LocationId=1) officeVisitRows,
 (SELECT MAX(DATEDIFF(second,e.LastSyncedAtUtc,SYSUTCDATETIME())) FROM gp.Employees e JOIN gp.Users u ON u.UserId=e.UserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject LIKE @prefix+':%') directoryAgeSeconds,
 (SELECT COUNT(*) FROM gp.VisitRequests WHERE PublicReference LIKE @prefix+'-Q%') ownedRows,
 (SELECT COUNT(*) FROM gp.VisitRequests WHERE PublicReference LIKE @prefix+'-Q%' AND Status='PENDING') ownedPending,
 (SELECT COUNT(*) FROM gp.VisitRequests WHERE PublicReference LIKE @prefix+'-Q%' AND Status='APPROVED') ownedApproved,
 JSON_QUERY((SELECT v.VisitRequestId visitRequestId,p.AccessPassId accessPassId,v.RequestType requestType,s.IsInside isInside,
 (SELECT COUNT(*) FROM gp.AccessEvents a WHERE a.VisitRequestId=v.VisitRequestId AND a.EventType='ENTRY') entries,
 (SELECT COUNT(*) FROM gp.EmployeeProjectAccessEvents a WHERE a.VisitRequestId=v.VisitRequestId AND a.EventType='ENTRY') projectEntries,
 (SELECT COUNT(*) FROM gp.EmployeeProjectPresence ep WHERE ep.VisitRequestId=v.VisitRequestId AND ep.IsInside=1) projectInside
 FROM gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId
 WHERE v.PublicReference LIKE @prefix+'-%' AND v.PersonName IN(N'Synthetic MOVEMENT',N'Synthetic TEMP',N'Synthetic EMP_DISABLED') FOR JSON PATH)) movementVisits
FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;
'@ @{prefix=$taskPrefix})|ConvertFrom-Json
 if([string]::IsNullOrEmpty($taskState.pair)){throw 'Owned fixture missing'}
 if($Action -eq 'Create'){@{fixture=$taskBase;state=$taskState}|ConvertTo-Json -Depth 8 -Compress;exit}
 if($Action -eq 'Inspect'){$taskState|ConvertTo-Json -Depth 8 -Compress;exit}
 $taskPrincipal='gp_load_direct_'+$RunId.ToString('N');$taskCreated=$false;$taskApi=$null
 try{
  $taskAuth=@{}
  foreach($taskLabel in @('GUARD','ADMIN')){
   $taskAuth[$taskLabel]=(Invoke-GatePassScalar $taskDb "SELECT TOP(1) CONVERT(varchar(64),s.SessionHash,2) sessionHex,CONVERT(varchar(64),s.CsrfHash,2) csrfHex FROM gp.Sessions s JOIN gp.Users u ON u.UserId=s.UserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject=@identity AND s.RevokedAtUtc IS NULL ORDER BY s.CreatedAtUtc DESC FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;" @{identity=$taskPrefix+':'+$taskLabel})|ConvertFrom-Json
  }
  Invoke-GatePassNonQuery $taskDb "CREATE USER [$taskPrincipal] WITHOUT LOGIN;ALTER ROLE gp_api_runtime ADD MEMBER [$taskPrincipal];";$taskCreated=$true
  $taskApi=Open-GatePassLocalSql -TrustLocalServerCertificate;Invoke-GatePassNonQuery $taskApi "EXECUTE AS USER='$taskPrincipal';"
  $taskResults=[Collections.Generic.List[object]]::new()
  foreach($taskScenario in @('summary','queue','actions')){
   $taskActor=if($taskScenario -eq 'summary'){'ADMIN'}else{'GUARD'}
   $taskParams=@{SessionHash=[Convert]::FromHexString($taskAuth[$taskActor].sessionHex);CsrfHash=[Convert]::FromHexString($taskAuth[$taskActor].csrfHex);LocationId=[int]1;ProjectLocationId=[long]$taskState.pair}
   $taskSql=switch($taskScenario){
    'summary' {$taskParams.FromDate=([datetime]$taskState.today).AddDays(-30);$taskParams.ToDate=[datetime]$taskState.today;'EXEC gp.GetOperationalSummaryRange @SessionHash=@SessionHash,@CsrfHash=@CsrfHash,@LocationId=@LocationId,@ProjectLocationId=@ProjectLocationId,@FromDate=@FromDate,@ToDate=@ToDate;'}
    'queue' {'EXEC gp.ReadGuardQueue @SessionHash=@SessionHash,@CsrfHash=@CsrfHash,@LocationId=@LocationId,@DutyKind=''PROJECT'',@DutyId=@ProjectLocationId,@Queue=''EXPECTED'',@Search=N'''';'}
    'actions' {'EXEC gp.ReadActionCentre @SessionHash=@SessionHash,@CsrfHash=@CsrfHash,@LocationId=@LocationId,@Workspace=''GUARD'',@DutyKind=''PROJECT'',@DutyId=@ProjectLocationId,@Category=''PENDING'';'}
   }
   $taskCommand=New-GatePassSqlCommand $taskApi $taskSql $taskParams
   try{
    foreach($taskWarmup in 1..3){$null=$taskCommand.ExecuteScalar()}
    $taskBefore=Read-TaskFunctionCounters;$taskTimes=[Collections.Generic.List[double]]::new()
    foreach($taskIteration in 1..$Repetitions){$taskWatch=[Diagnostics.Stopwatch]::StartNew();$null=$taskCommand.ExecuteScalar();$taskTimes.Add($taskWatch.Elapsed.TotalMilliseconds)}
    $taskAfter=Read-TaskFunctionCounters;$taskDeltas=[Collections.Generic.List[object]]::new()
    foreach($taskName in $taskAfter.Keys){$taskOld=$taskBefore[$taskName];if($null -ne $taskOld){$taskNew=$taskAfter[$taskName];$taskCalls=$taskNew.calls-$taskOld.calls;if($taskCalls -gt 0){$taskDeltas.Add(@{name=$taskName;calls=$taskCalls;cpuMs=($taskNew.cpuUs-$taskOld.cpuUs)/1000;elapsedMs=($taskNew.elapsedUs-$taskOld.elapsedUs)/1000;logicalReads=$taskNew.logicalReads-$taskOld.logicalReads})}}}
    $taskResults.Add(@{name=$taskScenario;milliseconds=$taskTimes.ToArray();repetitions=$Repetitions;executeOnly=$true;connection='one reused local SQL connection; principal setup excluded';functionDeltas=$taskDeltas.ToArray();counterScope='plan-cache deltas during this sequential phase; other database activity may contribute; nested functions overlap'})
   }finally{$taskCommand.Dispose()}
  }
  @{direct=$taskResults.ToArray()}|ConvertTo-Json -Depth 6 -Compress
 }finally{if($taskApi){$taskApi.Dispose()};if($taskCreated){Invoke-GatePassNonQuery $taskDb "DROP USER [$taskPrincipal];"}}
}finally{$taskDb.Dispose()}
