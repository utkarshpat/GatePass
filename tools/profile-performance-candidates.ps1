#Requires -Version 7.0
[CmdletBinding()]
param([ValidateRange(3,15)][int]$Repetitions=5)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot 'GatePass.LocalSql.psm1') -Force
$taskRun=[guid]::NewGuid();$taskPrefix='GP02-'+$taskRun.ToString('N').Substring(0,20).ToUpperInvariant()
$taskDirectory=Join-Path $taskRoot ('output/performance-candidates/'+$taskRun)
$null=New-Item -ItemType Directory -Path $taskDirectory
$taskReport=@{runId=$taskRun.ToString();startedAt=[datetime]::UtcNow.ToString('o');status='RUNNING';repetitions=$Repetitions;apis=@();prototypes=@();limitations=@('Sequential local SQL samples, not HTTP load or production SLOs.','Authorization predicate prototypes execute as the diagnostic database owner; not deployable procedures or a replacement for session/revocation checks.','Function counters are cache-wide deltas; other activity can contribute and nested CPU costs overlap.');cleanup=@{}}
$taskDb=$null;$taskApi=$null;$taskAttempted=$false;$taskCreated=$false
$taskPrincipal='gp_perf_candidate_'+$taskRun.ToString('N')
function Enter-TaskGate($Connection,[string]$Mode){Invoke-GatePassNonQuery $Connection "DECLARE @r int;EXEC @r=sys.sp_getapplock @Resource=N'gp:development:principal-ddl',@LockMode=@mode,@LockOwner='Session',@LockTimeout=10000;IF @r<0 THROW 52900,'Diagnostic gate unavailable.',1;" @{mode=$Mode}}
function Exit-TaskGate($Connection){Invoke-GatePassNonQuery $Connection "EXEC sys.sp_releaseapplock @Resource=N'gp:development:principal-ddl',@LockOwner='Session';"}
function Read-TaskCounters {
 $taskJson=Invoke-GatePassScalar $taskDb @'
SELECT(SELECT OBJECT_SCHEMA_NAME(object_id,database_id)+'.'+OBJECT_NAME(object_id,database_id) name,
 SUM(execution_count) calls,SUM(total_worker_time) cpuUs,SUM(total_logical_reads) logicalReads
 FROM sys.dm_exec_function_stats WHERE database_id=DB_ID() AND OBJECT_SCHEMA_NAME(object_id,database_id)='gp'
 GROUP BY database_id,object_id FOR JSON PATH);
'@
 $taskMap=@{};foreach($taskRow in ($taskJson|ConvertFrom-Json)){$taskMap[$taskRow.name]=$taskRow};return $taskMap
}
function Get-TaskDelta($Before,$After){
 $taskDeltas=@();foreach($taskName in $After.Keys){if($Before.ContainsKey($taskName)){$taskNew=$After[$taskName];$taskOld=$Before[$taskName];if($taskNew.calls -gt $taskOld.calls){$taskDeltas+=@{name=$taskName;calls=$taskNew.calls-$taskOld.calls;cpuMs=($taskNew.cpuUs-$taskOld.cpuUs)/1000;logicalReads=$taskNew.logicalReads-$taskOld.logicalReads}}}};return ,$taskDeltas
}
function Invoke-TaskSample($Connection,[string]$Sql,[hashtable]$Parameters){
 Enter-TaskGate $Connection 'Shared'
 try{$taskWatch=[Diagnostics.Stopwatch]::StartNew();$taskJson=Invoke-GatePassScalar $Connection $Sql $Parameters;$taskElapsed=$taskWatch.Elapsed.TotalMilliseconds;return @{milliseconds=$taskElapsed;packet=($taskJson|ConvertFrom-Json)}}finally{Exit-TaskGate $Connection}
}
try{
 $taskAttempted=$true
 $taskFixture=(& (Join-Path $PSScriptRoot 'LoadStressFixture.ps1') -RunId $taskRun -Action Create)|ConvertFrom-Json
 $null=& (Join-Path $PSScriptRoot 'LoadStressFixture.ps1') -RunId $taskRun -Action Refresh
 $taskReport.fixture=$taskFixture.state;$taskReport.revision=(& git -C $taskRoot rev-parse HEAD).Trim()
 $taskReport.scriptSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
 $taskDb=Open-GatePassLocalSql -TrustLocalServerCertificate
 $taskActors=@{}
 foreach($taskLabel in @('GUARD','ADMIN','RECEPTION','WRONGPROJECT')){
  $taskActors[$taskLabel]=(Invoke-GatePassScalar $taskDb "SELECT(SELECT TOP(1) CONVERT(varchar(36),u.UserId) actor,CONVERT(varchar(64),s.SessionHash,2) sessionHex,CONVERT(varchar(64),s.CsrfHash,2) csrfHex FROM gp.Sessions s JOIN gp.Users u ON u.UserId=s.UserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject=@identity AND s.RevokedAtUtc IS NULL ORDER BY s.CreatedAtUtc DESC FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);" @{identity=$taskPrefix+':'+$taskLabel})|ConvertFrom-Json
 }
 # Export authority is added only to the invocation-owned synthetic administrator.
 Invoke-GatePassNonQuery $taskDb @'
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode)
 SELECT g.RoleGrantId,'REPORTS_EXPORT' FROM gp.StaffRoleGrants g WHERE g.UserId=@actor AND g.RoleCode='LOCATION_ADMIN'
 AND NOT EXISTS(SELECT 1 FROM gp.GrantCapabilities c WHERE c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='REPORTS_EXPORT');COMMIT;
'@ @{actor=[guid]$taskActors.ADMIN.actor}
 Enter-TaskGate $taskDb 'Exclusive'
 try{Invoke-GatePassNonQuery $taskDb "BEGIN TRY BEGIN TRANSACTION;CREATE USER [$taskPrincipal] WITHOUT LOGIN;ALTER ROLE gp_api_runtime ADD MEMBER [$taskPrincipal];COMMIT;END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;";$taskCreated=$true}finally{Exit-TaskGate $taskDb}
 $taskApi=Open-GatePassLocalSql -TrustLocalServerCertificate;Invoke-GatePassNonQuery $taskApi "EXECUTE AS USER='$taskPrincipal';"
 $taskDay=[datetime]$taskFixture.state.today;$taskPair=[long]$taskFixture.state.pair
 $taskCases=@(
  @{name='guard-first';actor='GUARD';sql="EXEC gp.ReadGuardQueue @SessionHash,@CsrfHash,1,'PROJECT',@pair,'EXPECTED',N'';"},
  @{name='guard-page2';actor='GUARD';sql="EXEC gp.ReadGuardQueue @SessionHash,@CsrfHash,1,'PROJECT',@pair,'EXPECTED',N'',@cursorTime,@cursorId;";cursor='guard-first'},
  @{name='guard-specific-search';actor='GUARD';sql="EXEC gp.ReadGuardQueue @SessionHash,@CsrfHash,1,'PROJECT',@pair,'EXPECTED',@search;";search=$taskPrefix+'-Q1000'},
  @{name='actions-pending';actor='GUARD';sql="EXEC gp.ReadActionCentre @SessionHash,@CsrfHash,'GUARD',1,'PROJECT',@pair,'PENDING';"},
  @{name='actions-empty-category';actor='GUARD';sql="EXEC gp.ReadActionCentre @SessionHash,@CsrfHash,'GUARD',1,'PROJECT',@pair,'EXPIRED_INSIDE';"},
  @{name='reception-first';actor='RECEPTION';sql='EXEC gp.ReadReceptionQueue @SessionHash,@CsrfHash,1,@day;'},
  @{name='reception-page2';actor='RECEPTION';sql='EXEC gp.ReadReceptionQueue @SessionHash,@CsrfHash,1,@day,NULL,''ALL'',@cursorTime,@cursorId;';cursor='reception-first'},
  @{name='summary-project';actor='ADMIN';sql='EXEC gp.GetOperationalSummaryRange @SessionHash,@CsrfHash,1,@day,@day,@pair;'},
  @{name='summary-office';actor='ADMIN';sql='EXEC gp.GetOperationalSummaryRange @SessionHash,@CsrfHash,1,@day,@day,NULL;'},
  @{name='register-page1';actor='ADMIN';sql='EXEC gp.ReadAdminVisitRegister @SessionHash,@CsrfHash,1,@day,@day,@pair;'},
  @{name='export-page1';actor='ADMIN';sql="EXEC gp.ReadAdminVisitRegister @SessionHash,@CsrfHash,1,@day,@day,@pair,N'{}',N'submittedAtUtc',N'DESC',1,1;"},
  @{name='export-page2';actor='ADMIN';sql="EXEC gp.ReadAdminVisitRegister @SessionHash,@CsrfHash,1,@day,@day,@pair,N'{}',N'submittedAtUtc',N'DESC',2,1;"}
 )
 $taskPackets=@{}
 foreach($taskCase in $taskCases){
  Write-Host ('PROFILE '+$taskCase.name)
  $null=& (Join-Path $PSScriptRoot 'LoadStressFixture.ps1') -RunId $taskRun -Action Refresh
  $taskAuth=$taskActors[$taskCase.actor];$taskParams=@{SessionHash=[Convert]::FromHexString($taskAuth.sessionHex);CsrfHash=[Convert]::FromHexString($taskAuth.csrfHex);pair=$taskPair;day=$taskDay}
  if($taskCase.ContainsKey('search')){$taskParams.search=$taskCase.search}
  if($taskCase.ContainsKey('cursor')){$taskPrevious=$taskPackets[$taskCase.cursor];$taskParams.cursorTime=[datetime]$taskPrevious.afterSubmittedAtUtc;$taskParams.cursorId=[guid]$taskPrevious.afterVisitRequestId}
  $taskWarmup=Invoke-TaskSample $taskApi $taskCase.sql $taskParams;$taskPackets[$taskCase.name]=$taskWarmup.packet
  $taskBefore=Read-TaskCounters;$taskTimes=@();foreach($taskIteration in 1..$Repetitions){$taskSample=Invoke-TaskSample $taskApi $taskCase.sql $taskParams;$taskTimes+=$taskSample.milliseconds}
  $taskAfter=Read-TaskCounters;$taskPacket=$taskWarmup.packet
  $taskShape=@{pageRows=0};foreach($taskField in @('visitors','visits','items','rows')){if($null -ne $taskPacket.PSObject.Properties[$taskField]){$taskShape.pageRows=@($taskPacket.$taskField).Count}}
  foreach($taskField in @('total','page','pageSize','pendingReturnCount','counts','hasMore')){if($null -ne $taskPacket.PSObject.Properties[$taskField]){$taskShape[$taskField]=$taskPacket.$taskField}}
  $taskReport.apis+=@{name=$taskCase.name;milliseconds=$taskTimes;shape=$taskShape;functionDeltas=(Get-TaskDelta $taskBefore $taskAfter)}
 }
 # Read-only policy-filter microbenchmarks. They intentionally omit transport,
 # JSON row rendering and complete procedure/session/final revocation fencing.
 $taskBase="DECLARE @ids table(Id uniqueidentifier PRIMARY KEY);"
 $taskResult="SELECT(SELECT COUNT(*) matches,CONVERT(varchar(64),HASHBYTES('SHA2_256',COALESCE(STRING_AGG(CONVERT(varchar(max),Id),',') WITHIN GROUP(ORDER BY Id),'')),2) setHash FROM @ids FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);"
 $taskGuardOriginal=$taskBase+"INSERT @ids SELECT v.VisitRequestId FROM gp.VisitRequests v WHERE v.LocationId=1 AND gp._GuardDutyVisitAllowed(@actor,'PROJECT',@pair,1,v.VisitRequestId,@cutoff,@now)=1;"+$taskResult
 $taskGuardPrefilter=$taskBase+"DECLARE @candidates table(Id uniqueidentifier PRIMARY KEY);INSERT @candidates SELECT VisitRequestId FROM gp.VisitRequests WHERE LocationId=1 AND(ProjectLocationId=@pair OR RequestType='TEMP_ID');INSERT @ids SELECT Id FROM @candidates WHERE gp._GuardDutyVisitAllowed(@actor,'PROJECT',@pair,1,Id,@cutoff,@now)=1;"+$taskResult
 $taskGuardOnce=$taskBase+"IF gp._GuardDutyAssigned(@actor,'PROJECT',@pair,1,@now)=1 INSERT @ids SELECT v.VisitRequestId FROM gp.VisitRequests v WHERE v.LocationId=1 AND v.PersonalDataPurgedAtUtc IS NULL AND(v.ProjectLocationId=@pair OR v.RequestType='TEMP_ID' AND(gp._EmployeeProjectLocationEligible(v.EmployeeId,@pair,@cutoff,@now)=1 OR EXISTS(SELECT 1 FROM gp.EmployeeProjectPresence ep WHERE ep.EmployeeId=v.EmployeeId AND ep.ProjectLocationId=@pair AND ep.IsInside=1)));"+$taskResult
 $taskAdminOriginal=$taskBase+"INSERT @ids SELECT VisitRequestId FROM gp.VisitRequests WHERE LocationId=1 AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',LocationId,ProjectLocationId,@now)=1;IF EXISTS(SELECT 1 FROM @ids i JOIN gp.VisitRequests v ON v.VisitRequestId=i.Id WHERE gp._AdminScopeAllowed(@actor,'REPORTS_READ',v.LocationId,v.ProjectLocationId,@now)=0) THROW 52900,'Scope changed.',1;"+$taskResult
 $taskAdminOnce=$taskBase+"DECLARE @scopes table(LocationId int,Pair bigint NULL,Allowed bit);INSERT @scopes SELECT DISTINCT LocationId,ProjectLocationId,0 FROM gp.VisitRequests WHERE LocationId=1;UPDATE @scopes SET Allowed=gp._AdminScopeAllowed(@actor,'REPORTS_READ',LocationId,Pair,@now);INSERT @ids SELECT v.VisitRequestId FROM gp.VisitRequests v JOIN @scopes s ON s.LocationId=v.LocationId AND(s.Pair=v.ProjectLocationId OR s.Pair IS NULL AND v.ProjectLocationId IS NULL) WHERE s.Allowed=1;IF EXISTS(SELECT 1 FROM @scopes WHERE Allowed=1 AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',LocationId,Pair,@now)=0) THROW 52900,'Scope changed.',1;"+$taskResult
 $taskVariants=@(
  @{name='guard-relational-prefilter';original=$taskGuardOriginal;candidate=$taskGuardPrefilter;actors=@('GUARD','WRONGPROJECT')},
  @{name='guard-duty-once';original=$taskGuardOriginal;candidate=$taskGuardOnce;actors=@('GUARD','WRONGPROJECT')},
  @{name='admin-distinct-scopes';original=$taskAdminOriginal;candidate=$taskAdminOnce;actors=@('ADMIN','GUARD')}
 )
 foreach($taskVariant in $taskVariants){foreach($taskLabel in $taskVariant.actors){foreach($taskFresh in @($true,$false)){
  Write-Host ('PROTOTYPE '+$taskVariant.name+' '+$taskLabel+' fresh='+$taskFresh)
  $taskNow=[datetime]::UtcNow;$taskParams=@{actor=[guid]$taskActors[$taskLabel].actor;pair=$taskPair;now=$taskNow;cutoff=if($taskFresh){$taskNow.AddSeconds(-300)}else{$taskNow.AddSeconds(1)}}
  $taskTimes=@{original=@();candidate=@()};$taskComparisons=@();$taskDeltas=@{original=@();candidate=@()}
  foreach($taskIteration in 0..$Repetitions){
   $taskSamples=@{};$taskOrder=if($taskIteration%2 -eq 0){@('original','candidate')}else{@('candidate','original')}
   foreach($taskWhich in $taskOrder){$taskBefore=Read-TaskCounters;$taskSamples[$taskWhich]=Invoke-TaskSample $taskDb $taskVariant[$taskWhich] $taskParams;$taskAfter=Read-TaskCounters;if($taskIteration -gt 0){$taskTimes[$taskWhich]+=$taskSamples[$taskWhich].milliseconds;$taskDeltas[$taskWhich]+=@{iteration=$taskIteration;functions=(Get-TaskDelta $taskBefore $taskAfter)}}}
   $taskSame=$taskSamples.original.packet.matches -eq $taskSamples.candidate.packet.matches -and $taskSamples.original.packet.setHash -eq $taskSamples.candidate.packet.setHash
   if(-not $taskSame){throw 'Prototype returned a different visit set'}
   if($taskIteration -gt 0){$taskComparisons+=@{sameVisitSet=$taskSame;matches=$taskSamples.original.packet.matches}}
  }
  $taskReport.prototypes+=@{name=$taskVariant.name;actor=$taskLabel;freshDirectory=$taskFresh;milliseconds=$taskTimes;comparisons=$taskComparisons;functionDeltas=$taskDeltas}
 }}}
 $taskReport.indexes=(Invoke-GatePassScalar $taskDb @'
SELECT(SELECT OBJECT_NAME(i.object_id) tableName,i.name,i.type_desc,i.filter_definition,
 JSON_QUERY((SELECT c.name,ic.key_ordinal,ic.is_included_column FROM sys.index_columns ic JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id ORDER BY ic.key_ordinal,c.name FOR JSON PATH)) columns
 FROM sys.indexes i WHERE i.object_id IN(OBJECT_ID('gp.VisitRequests'),OBJECT_ID('gp.AccessPasses'),OBJECT_ID('gp.VisitPresence'),OBJECT_ID('gp.SecurityAuditEvents')) AND i.index_id>0 FOR JSON PATH);
'@)|ConvertFrom-Json
 $taskReport.status='PASS'
}catch{$taskReport.status='FAIL';$taskReport.failure=$_.Exception.Message;Write-Host ('FAIL '+$_.Exception.Message)}finally{
 $taskErrors=@()
 if($taskApi){$taskApi.Dispose()}
 if($taskCreated){try{Enter-TaskGate $taskDb 'Exclusive';try{Invoke-GatePassNonQuery $taskDb "DROP USER [$taskPrincipal];"}finally{Exit-TaskGate $taskDb}}catch{$taskErrors+='PRINCIPAL_CLEANUP_FAILED'}}
 if($taskDb){$taskDb.Dispose()}
 if($taskAttempted){try{$taskReport.cleanup.fixture=(& (Join-Path $PSScriptRoot 'LoadStressFixture.ps1') -RunId $taskRun -Action Cleanup)|ConvertFrom-Json}catch{$taskErrors+='FIXTURE_CLEANUP_FAILED'}}
 $taskReport.cleanup.errors=$taskErrors;if($taskErrors.Count){$taskReport.status='FAIL'};$taskReport.finishedAt=[datetime]::UtcNow.ToString('o')
 $taskReport|ConvertTo-Json -Depth 18|Set-Content -LiteralPath (Join-Path $taskDirectory 'report.json') -Encoding utf8
 Write-Host ('CANDIDATE_REPORT '+(Join-Path $taskDirectory 'report.json')+' '+$taskReport.status)
}
if($taskReport.status -ne 'PASS'){exit 1}
