#Requires -Version 7.0
[CmdletBinding()]
param([string]$Server='localhost\SQLEXPRESS',[switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskAdmin=Open-GatePassLocalSql -Server $Server -TrustLocalServerCertificate:$TrustLocalServerCertificate
$taskRun=[guid]::NewGuid();$taskActors=@{};$taskVisits=@{};$taskCases=[Collections.Generic.List[object]]::new();$taskConnections=[Collections.Generic.List[object]]::new();$taskPrincipals=[Collections.Generic.List[string]]::new();$taskReady=$false;$taskDone=$false;$taskClean=$false
function Assert($Value,[string]$Message='Unexpected project-context result.') {if (-not $Value) {throw $Message}}
function Expect([scriptblock]$Action,[int]$Number=52001) {try {$null=& $Action} catch {if ($_.Exception.GetBaseException() -is [Data.SqlClient.SqlException] -and $_.Exception.GetBaseException().Number -eq $Number) {return};throw};throw "Expected SQL error $Number."}
function Auth([string]$Actor='GUARD') {return @{SessionHash=[Convert]::FromHexString($taskActors[$Actor].SessionHex);CsrfHash=[Convert]::FromHexString($taskActors[$Actor].CsrfHex)}}
function Call($Connection,[string]$Procedure,[hashtable]$Parameters) {$taskArgs=($Parameters.Keys | ForEach-Object {'@'+$_+'=@'+$_}) -join ',';return (Invoke-GatePassScalar $Connection ('EXEC '+$Procedure+' '+$taskArgs) $Parameters) | ConvertFrom-Json}
function Cleanup {
    if ($taskReady) {
        Invoke-GatePassNonQuery $taskAdmin ([IO.File]::ReadAllText((Join-Path $PSScriptRoot '003_transaction_cleanup.sql'))) @{RunId=$taskRun}
        Invoke-GatePassNonQuery $taskAdmin @'
DELETE pl FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId WHERE p.ExternalProjectCode IN(@prefix+'-C',@prefix+'-D');
DELETE gp.Projects WHERE ExternalProjectCode IN(@prefix+'-C',@prefix+'-D');
'@ @{prefix=$taskFixture.prefix}
    };$script:taskReady=$false
}
function Reset {
    Cleanup
    $script:taskFixture=(Invoke-GatePassScalar $taskAdmin ([IO.File]::ReadAllText((Join-Path $PSScriptRoot '002_transaction_fixtures.sql'))) @{RunId=$taskRun}) | ConvertFrom-Json
    $script:taskReady=$true;foreach($taskA in $taskFixture.actors){$taskActors[$taskA.Label]=$taskA};foreach($taskV in $taskFixture.visits){$taskVisits[$taskV.Label]=$taskV}
    Invoke-GatePassNonQuery $taskAdmin @'
DECLARE @now datetime2(3)=SYSUTCDATETIME();
INSERT gp.Projects(ExternalProjectCode,ProjectName,LastSyncedAtUtc) VALUES(@prefix+'-C',N'Context project C',@now),(@prefix+'-D',N'Context project D',@now);
INSERT gp.ProjectLocations(ProjectId,LocationId) SELECT ProjectId,@location FROM gp.Projects WHERE ExternalProjectCode IN(@prefix+'-C',@prefix+'-D');
INSERT gp.GuardAssignments(GuardUserId,ProjectLocationId,AssignedByUserId,ValidFromUtc)
SELECT @guard,pl.ProjectLocationId,@host,DATEADD(hour,-1,@now) FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId
WHERE pl.LocationId=@location AND p.ExternalProjectCode IN(@prefix+'-B',@prefix+'-C',@prefix+'-D');
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT RoleGrantId,'VISITS_READ' FROM gp.StaffRoleGrants WHERE UserId=@guard;
'@ @{prefix=$taskFixture.prefix;location=[int]$taskFixture.locationId;guard=[guid]$taskActors.GUARD.UserId;host=[guid]$taskActors.HOST.UserId}
    $script:taskPairA=[long]$taskFixture.projectLocationId
    $script:taskPairB=[long](Invoke-GatePassScalar $taskAdmin 'SELECT ProjectLocationId FROM gp.VisitRequests WHERE VisitRequestId=@id;' @{id=[guid]$taskVisits.OTHER_PAIR.VisitId})
}
function Case([string]$Name,[scriptblock]$Action) {try{Reset;$null=& $Action;$taskCases.Add(@{Name=$Name;Passed=$true});Write-Output "PASS: $Name"}catch{$taskCases.Add(@{Name=$Name;Passed=$false;Error=$_.Exception.Message});Write-Output "FAIL: $Name -- $($_.Exception.Message)"}}
function Contexts([string]$Actor='GUARD',$Connection=$taskApi) {$taskP=Auth $Actor;$taskP.LocationId=[int]$taskFixture.locationId;return Call $Connection 'gp.ListGuardWorkContexts' $taskP}
function Scan([string]$Label='MOVEMENT',$Selected=$null) {$taskP=Auth;$taskP.LocationId=[int]$taskFixture.locationId;$taskP.CredentialHash=[Convert]::FromHexString($taskVisits[$Label].CredentialHex);$taskP.CorrelationId=[guid]::NewGuid();$taskP.SelectedProjectLocationId=$Selected;return Call $taskApi 'gp.VerifyGuardPass' $taskP}
function Movement([string]$Label='MOVEMENT',[string]$Event='ENTRY') {$taskP=Auth;$taskP.ClientKey=[guid]::NewGuid();$taskP.VisitRequestId=[guid]$taskVisits[$Label].VisitId;$taskP.AccessPassId=[guid]$taskVisits[$Label].PassId;$taskP.LocationId=[int]$taskFixture.locationId;$taskP.SelectedProjectLocationId=if($Label -eq 'TEMP'){$null}elseif($Label -eq 'OTHER_PAIR'){$taskPairB}else{$taskPairA};$taskP.EventType=$Event;$taskP.EntryMethod='MANUAL';return $taskP}
function Invoke-Movement($Parameters) {return Call $taskApi 'gp.RecordMovement' $Parameters}
function EventCount {return Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.AccessEvents e JOIN gp.VisitRequests v ON v.VisitRequestId=e.VisitRequestId WHERE v.PublicReference LIKE @prefix+''-%'';' @{prefix=$taskFixture.prefix}}
try {
    foreach($taskSpec in @(@('gp_context_api_fixture','gp_api_runtime'),@('gp_context_worker_fixture','gp_worker_runtime'),@('gp_context_media_fixture','gp_media_runtime'),@('gp_context_auth_fixture','gp_guard_auth_runtime'))) {
        Invoke-GatePassNonQuery $taskAdmin ('CREATE USER '+$taskSpec[0]+' WITHOUT LOGIN;ALTER ROLE '+$taskSpec[1]+' ADD MEMBER '+$taskSpec[0]+';');$taskPrincipals.Add($taskSpec[0]);$taskC=Open-GatePassLocalSql -Server $Server -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $taskC ("EXECUTE AS USER='"+$taskSpec[0]+"';");$taskConnections.Add($taskC)
    };$taskApi=$taskConnections[0]
    Case 'One guard receives all four assigned projects without selecting a fixed duty project' {$taskR=Contexts;Assert ($taskR.projects.Count -eq 4 -and @($taskR.projects.projectLocationId | Select-Object -Unique).Count -eq 4)}
    Case 'The same shared-area guard scans project A and B visitors without mode switching' {Assert ((Scan).outcome -eq 'VALID' -and (Scan 'OTHER_PAIR').outcome -eq 'VALID' -and (EventCount) -eq 0)}
    Case 'An explicit optional scan filter cannot disclose a different project' {$taskR=Scan 'MOVEMENT' $taskPairB;Assert ($taskR.outcome -eq 'NOT_AVAILABLE' -and -not $taskR.PSObject.Properties['visit'])}
    Case 'Pending identity QR is visible but never grants project entry' {$taskR=Scan 'PENDING';Assert ($taskR.outcome -eq 'PENDING' -and -not $taskR.visit.canEnter);Expect {Invoke-Movement (Movement 'PENDING')} 52005;Assert ((EventCount) -eq 0)}
    Case 'Host approval enables the same pending credential without any replacement' {$taskBefore=Scan 'PENDING';$taskP=Auth HOST;$taskP.ClientKey=[guid]::NewGuid();$taskP.VisitRequestId=[guid]$taskVisits.PENDING.VisitId;$taskP.SnapshotVersion=1;$taskP.SnapshotHash=[Convert]::FromHexString($taskVisits.PENDING.SnapshotHex);$taskP.Decision='APPROVED';$null=Call $taskApi 'gp.DecideVisit' $taskP;$taskAfter=Scan 'PENDING';Assert ($taskAfter.outcome -eq 'VALID' -and $taskAfter.visit.canEnter -and $taskBefore.visit.accessPassId -eq $taskAfter.visit.accessPassId -and (EventCount) -eq 0)}
    Case 'An explicitly named approved project is returned in the committed movement receipt' {$taskR=Invoke-Movement (Movement);Assert ($taskR.projectLocationId -eq [string]$taskPairA -and $taskR.isInside)}
    Case 'Even a four-project guard cannot substitute project B for an A visitor' {$taskP=Movement;$taskP.SelectedProjectLocationId=$taskPairB;Expect {Invoke-Movement $taskP};Assert ((EventCount) -eq 0)}
    Case 'Missing selected project cannot use the legacy mutation route to bypass the target check' {$taskP=Movement;$taskP.Remove('SelectedProjectLocationId');Expect {Invoke-Movement $taskP};Assert ((EventCount) -eq 0)}
    Case 'Separate A and B admissions succeed for their own individual approved visits' {$taskA=Invoke-Movement (Movement);$taskB=Invoke-Movement (Movement 'OTHER_PAIR');Assert ($taskA.projectLocationId -eq [string]$taskPairA -and $taskB.projectLocationId -eq [string]$taskPairB -and (EventCount) -eq 2)}
    Case 'An identical movement retry returns one event and a changed target conflicts' {$taskP=Movement;$taskOne=Invoke-Movement $taskP;$taskTwo=Invoke-Movement $taskP;Assert ($taskOne.accessEventId -eq $taskTwo.accessEventId -and (EventCount) -eq 1);$taskP.SelectedProjectLocationId=$taskPairB;Expect {Invoke-Movement $taskP} 52003}
    Case 'Exit cannot silently change the project represented by inside presence' {$null=Invoke-Movement (Movement);$taskP=Movement 'MOVEMENT' 'EXIT';$taskP.SelectedProjectLocationId=$taskPairB;Expect {Invoke-Movement $taskP};$taskP.SelectedProjectLocationId=$taskPairA;Assert (-not (Invoke-Movement $taskP).isInside)}
    Case 'Digital ID remains location-only and cannot be used as a project entitlement' {$taskP=Movement 'TEMP';$taskP.SelectedProjectLocationId=$taskPairA;Expect {Invoke-Movement $taskP};$taskP.SelectedProjectLocationId=$null;Assert ((Invoke-Movement $taskP).isInside)}
    Case 'Current deallocation removes a project from both scan and movement authority' {Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.GuardAssignments SET DeallocatedAtUtc=SYSUTCDATETIME(),DeallocatedByUserId=@host WHERE GuardUserId=@guard AND ProjectLocationId=@pair;' @{guard=[guid]$taskActors.GUARD.UserId;pair=$taskPairB;host=[guid]$taskActors.HOST.UserId};Assert ((Contexts).projects.Count -eq 3 -and (Scan 'OTHER_PAIR').outcome -eq 'NOT_AVAILABLE');Expect {Invoke-Movement (Movement 'OTHER_PAIR')}}
    Case 'Inactive projects are excluded from current work choices' {Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.ProjectLocations SET IsActive=0 WHERE ProjectLocationId=@id;' @{id=$taskPairB};Assert ((Contexts).projects.Count -eq 3);Expect {Invoke-Movement (Movement 'OTHER_PAIR')} 52005}
    Case 'Expired assignments are excluded and cannot authorize movement' {Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.GuardAssignments SET ValidUntilUtc=DATEADD(second,-1,SYSUTCDATETIME()) WHERE GuardUserId=@guard AND ProjectLocationId=@pair;' @{guard=[guid]$taskActors.GUARD.UserId;pair=$taskPairB};Assert ((Contexts).projects.Count -eq 3);Expect {Invoke-Movement (Movement 'OTHER_PAIR')}}
    Case 'A capability-only missing role and reception identity cannot obtain guard work choices' {Expect {Contexts RECEPTION} 52801;Expect {Contexts ADMIN} 52801}
    Case 'Stale and expired sessions cannot obtain current project choices' {Expect {Contexts STALE} 52001;Expect {Contexts EXPIRED} 52001}
    Case 'Other runtime roles cannot enumerate guard work choices' {foreach($taskC in $taskConnections | Select-Object -Skip 1){Expect {Contexts -Connection $taskC} 229}}
    Case 'No project choices are fabricated when movement capability is removed' {Invoke-GatePassNonQuery $taskAdmin 'DELETE c FROM gp.GrantCapabilities c JOIN gp.StaffRoleGrants g ON g.RoleGrantId=c.RoleGrantId WHERE g.UserId=@guard AND c.CapabilityCode=''PROJECT_MOVEMENT'';' @{guard=[guid]$taskActors.GUARD.UserId};Assert ((Contexts).projects.Count -eq 0)}
    Case 'Selected project is rechecked after an observed authorization-lock wait' {
        $taskP=Movement;$taskArgs=($taskP.Keys | ForEach-Object{'@'+$_+'=@'+$_}) -join ',';$taskCommand=New-GatePassSqlCommand $taskApi ('EXEC gp.RecordMovement '+$taskArgs) $taskP;$taskSid=[int](Invoke-GatePassScalar $taskApi 'SELECT @@SPID;')
        Invoke-GatePassNonQuery $taskAdmin "BEGIN TRANSACTION;DECLARE @r int;EXEC @r=sys.sp_getapplock @Resource=N'gp:authorization',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000,@DbPrincipal='public';IF @r<0 THROW 52900,'Gate failed.',1;"
        try {$taskPending=$taskCommand.ExecuteScalarAsync();$taskDeadline=[datetime]::UtcNow.AddSeconds(3);$taskWaiting=0;do{$taskWaiting=Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM sys.dm_exec_requests WHERE session_id=@id AND wait_type LIKE N'LCK_M%';" @{id=$taskSid};if($taskWaiting -eq 1){break};[Threading.Thread]::Sleep(25)}while([datetime]::UtcNow -lt $taskDeadline);Assert ($taskWaiting -eq 1)
            Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.GuardAssignments SET DeallocatedAtUtc=SYSUTCDATETIME(),DeallocatedByUserId=@host WHERE GuardUserId=@guard AND ProjectLocationId=@pair;' @{guard=[guid]$taskActors.GUARD.UserId;pair=$taskPairA;host=[guid]$taskActors.HOST.UserId}
            Invoke-GatePassNonQuery $taskAdmin 'COMMIT;'
            Expect {$null=$taskPending.GetAwaiter().GetResult()};Assert ((EventCount) -eq 0)
        }finally{Invoke-GatePassNonQuery $taskAdmin 'IF @@TRANCOUNT>0 ROLLBACK;';$taskCommand.Dispose()}
    }
    $taskDone=$true
} finally {
    foreach($taskC in $taskConnections){$taskC.Dispose()}
    try {Cleanup;foreach($taskU in $taskPrincipals){Invoke-GatePassNonQuery $taskAdmin ('DROP USER '+$taskU+';')};$taskClean=$true}
    finally {$taskAdmin.Dispose();[ordered]@{Status=if($taskDone -and $taskClean -and @($taskCases | Where-Object {-not $_.Passed}).Count -eq 0){'PASS'}else{'FAIL'};CheckedAtUtc=[datetime]::UtcNow.ToString('o');CaseCount=$taskCases.Count;CleanupPassed=$taskClean;ObservedIndependentConnectionWaits=1;
        SourceSha256=@(@('database/migrations/012_visitor_cards_and_guard_project_context.sql','database/migrations/013_multi_project_guard_scan.sql','database/tests/Test-GuardProjectContext.ps1') | ForEach-Object {@{File=$_;Sha256=(Get-FileHash -LiteralPath (Join-Path $taskRoot $_) -Algorithm SHA256).Hash}});Cases=@($taskCases)} | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $taskRoot 'database/validation/guard-project-context-report.json') -Encoding utf8}
}
if(-not $taskDone -or @($taskCases | Where-Object {-not $_.Passed}).Count){throw 'Guard project context suite failed.'}
Write-Output "All $($taskCases.Count) multi-project guard cases passed; owned data removed."


