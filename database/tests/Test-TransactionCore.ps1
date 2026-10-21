#Requires -Version 7.0
[CmdletBinding()]
param([string]$Server='localhost\SQLEXPRESS',[switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskAdmin=Open-GatePassLocalSql -Server $Server -TrustLocalServerCertificate:$TrustLocalServerCertificate
$taskRun=[guid]::NewGuid()
$taskCases=[Collections.Generic.List[object]]::new()
$taskConnections=[Collections.Generic.List[object]]::new()
$taskCreatedUser=$false
$taskFixtureReady=$false
$taskCleanupPassed=$false
$taskHarnessComplete=$false
$taskActor=@{}
$taskVisit=@{}
$taskDecisionSql='EXEC gp.DecideVisit @SessionHash,@CsrfHash,@ClientKey,@VisitRequestId,@SnapshotVersion,@SnapshotHash,@Decision,@Comment;'
$taskMovementSql='EXEC gp.RecordMovement @SessionHash,@CsrfHash,@ClientKey,@VisitRequestId,@AccessPassId,@LocationId,@EventType,@EntryMethod,@CredentialHash,@OccurredAtUtc,@ReconciliationReason,@SelectedProjectLocationId;'
$taskDeallocateSql='EXEC gp.DeallocateGuard @SessionHash,@CsrfHash,@ClientKey,@GuardAssignmentId,@Reason;'

function Assert-Condition($Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
function Get-SqlNumber($Exception) {
    $taskBase=$Exception.GetBaseException()
    if ($taskBase -is [System.Data.SqlClient.SqlException]) { return $taskBase.Number }
    return 0
}
function Expect-SqlError([scriptblock]$Action,[int]$Number) {
    try { $null=& $Action }
    catch {
        $taskObserved=Get-SqlNumber $_.Exception
        if ($taskObserved -eq $Number) { return }
        throw "Expected SQL error $Number; got $taskObserved : $($_.Exception.Message)"
    }
    throw "Expected SQL error $Number; operation succeeded."
}
function Test-Case([string]$Name,[scriptblock]$Action) {
    $taskStarted=[datetime]::UtcNow
    try {
        $null=& $Action
        $taskCases.Add(@{Name=$Name;Passed=$true;DurationMs=[int]([datetime]::UtcNow-$taskStarted).TotalMilliseconds})
        Write-Output ('PASS: '+$Name)
    }
    catch {
        $taskCases.Add(@{Name=$Name;Passed=$false;Error=$_.Exception.Message;DurationMs=[int]([datetime]::UtcNow-$taskStarted).TotalMilliseconds})
        Write-Output ('FAIL: '+$Name+' -- '+$_.Exception.Message)
    }
}
function Open-TestApi {
    $taskConnection=Open-GatePassLocalSql -Server $Server -TrustLocalServerCertificate:$TrustLocalServerCertificate
    Invoke-GatePassNonQuery $taskConnection "EXECUTE AS USER='gp_phase02_fixture';"
    $taskConnections.Add($taskConnection)
    return $taskConnection
}
function Get-ActorParameters([string]$Actor='GUARD') {
    return @{SessionHash=[Convert]::FromHexString($taskActor[$Actor]['SessionHex']);CsrfHash=[Convert]::FromHexString($taskActor[$Actor]['CsrfHex']);ClientKey=[guid]::NewGuid()}
}
function Get-DecisionParameters([string]$Visit,[string]$Decision='APPROVED',[string]$Actor='HOST') {
    $taskParams=Get-ActorParameters $Actor
    $taskParams.VisitRequestId=[guid]$taskVisit[$Visit].VisitId
    $taskParams.SnapshotVersion=1
    $taskParams.SnapshotHash=[Convert]::FromHexString($taskVisit[$Visit].SnapshotHex)
    $taskParams.Decision=$Decision
    $taskParams.Comment=$null
    return $taskParams
}
function Get-MovementParameters([string]$Visit,[string]$Event='ENTRY',[string]$Actor='GUARD') {
    $taskParams=Get-ActorParameters $Actor
    $taskParams.VisitRequestId=[guid]$taskVisit[$Visit].VisitId
    $taskParams.AccessPassId=[guid]$taskVisit[$Visit].PassId
    $taskParams.LocationId=[int]$taskFixture.locationId
    $taskParams.SelectedProjectLocationId=if ($Visit -eq 'TEMP') {$null} else {[long]$taskFixture.projectLocationId}
    $taskParams.EventType=$Event
    $taskParams.EntryMethod='MANUAL'
    $taskParams.CredentialHash=$null
    $taskParams.OccurredAtUtc=$null
    $taskParams.ReconciliationReason=$null
    return $taskParams
}
function Get-EventCount([string]$Visit) {
    return Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.AccessEvents WHERE VisitRequestId=@id;' @{id=[guid]$taskVisit[$Visit].VisitId}
}
function Set-FixtureInside([string]$Visit) {
    Invoke-GatePassNonQuery $taskAdmin @'
DECLARE @op uniqueidentifier=NEWID(),@now datetime2(3)=SYSUTCDATETIME(),@occurred datetime2(3);
SELECT @occurred=DATEADD(second,1,ValidFromUtc) FROM gp.VisitRequests WHERE VisitRequestId=@visit;
INSERT gp.IdempotencyRequests(OperationId,ActorBindingHash,OperationCode,ClientKey,PayloadHash,Status,ResultJson,CompletedAtUtc,ExpiresAtUtc)
VALUES(@op,HASHBYTES('SHA2_256',CONVERT(binary(16),@actor)),'FIXTURE_MOVEMENT',NEWID(),HASHBYTES('SHA2_256','test-only'),'COMPLETED','{}',@now,DATEADD(day,1,@now));
INSERT gp.AccessEvents(VisitRequestId,AccessPassId,ActorUserId,LocationId,EventType,EntryMethod,OperationId,OccurredAtUtc,RecordedAtUtc)
VALUES(@visit,@pass,@actor,@location,'ENTRY','MANUAL',@op,@occurred,@now);
DECLARE @event bigint=CONVERT(bigint,SCOPE_IDENTITY());
UPDATE gp.VisitPresence SET IsInside=1,LastAccessEventId=@event,LastMovementAtUtc=@occurred WHERE VisitRequestId=@visit;
'@ @{visit=[guid]$taskVisit[$Visit].VisitId;pass=[guid]$taskVisit[$Visit].PassId;actor=[guid]$taskActor.GUARD.UserId;location=[int]$taskFixture.locationId}
}
function Invoke-Race($FirstConnection,$FirstCommand,$SecondConnection,$SecondCommand,[string]$Visit) {
    $taskFirstSid=Invoke-GatePassScalar $FirstConnection 'SELECT @@SPID;'
    $taskSecondSid=Invoke-GatePassScalar $SecondConnection 'SELECT @@SPID;'
    $taskLock='gp:visit:'+([string]$taskVisit[$Visit].VisitId).ToLowerInvariant()
    Invoke-GatePassNonQuery $taskAdmin 'BEGIN TRANSACTION;'
    Invoke-GatePassNonQuery $taskAdmin @'
DECLARE @r int;
EXEC @r=sys.sp_getapplock @Resource='gp:authorization',@LockMode='Shared',@LockOwner='Transaction',@LockTimeout=5000,@DbPrincipal='public';
IF @r<0 THROW 52901,'Fixture authorization gate failed.',1;
EXEC @r=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000,@DbPrincipal='public';
IF @r<0 THROW 52901,'Fixture visit gate failed.',1;
'@ @{resource=$taskLock}
    $taskFirst=$null
    $taskSecond=$null
    try {
        $taskFirst=$FirstCommand.ExecuteScalarAsync()
        $taskDeadline=[datetime]::UtcNow.AddSeconds(3)
        do {
            $taskWaiting=Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM sys.dm_exec_requests WHERE session_id=@id AND wait_type LIKE N''LCK_M%'';' @{id=$taskFirstSid}
            if ($taskWaiting -eq 1) { break }
            [Threading.Thread]::Sleep(25)
        } while ([datetime]::UtcNow -lt $taskDeadline)
        Assert-Condition ($taskWaiting -eq 1) 'First contender never reached the SQL lock gate.'
        $taskSecond=$SecondCommand.ExecuteScalarAsync()
        $taskDeadline=[datetime]::UtcNow.AddSeconds(3)
        do {
            $taskWaiting=Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM sys.dm_exec_requests WHERE session_id IN(@first,@second) AND wait_type LIKE N''LCK_M%'';' @{first=$taskFirstSid;second=$taskSecondSid}
            if ($taskWaiting -eq 2) { break }
            [Threading.Thread]::Sleep(25)
        } while ([datetime]::UtcNow -lt $taskDeadline)
        Assert-Condition ($taskWaiting -eq 2) 'Both independent SQL contenders were not observed waiting.'
    }
    finally { Invoke-GatePassNonQuery $taskAdmin 'IF @@TRANCOUNT>0 COMMIT;' }
    $taskOutcomes=[Collections.Generic.List[object]]::new()
    try {
        foreach ($taskPending in @($taskFirst,$taskSecond)) {
            try { $taskValue=$taskPending.GetAwaiter().GetResult(); $taskOutcomes.Add(@{Success=$true;Result=$taskValue;Error=0}) }
            catch { $taskOutcomes.Add(@{Success=$false;Result=$null;Error=(Get-SqlNumber $_.Exception)}) }
        }
    }
    finally { $FirstCommand.Dispose(); $SecondCommand.Dispose() }
    return @{First=$taskOutcomes[0];Second=$taskOutcomes[1];BothObservedWaiting=$true}
}

try {
    Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT DB_NAME();') -eq 'GatePass_DesignTest') 'Wrong test database.'
    $taskFixtureText=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '002_transaction_fixtures.sql'))
    $taskFixture=(Invoke-GatePassScalar $taskAdmin $taskFixtureText @{RunId=$taskRun}) | ConvertFrom-Json -AsHashtable
    $taskFixtureReady=$true
    foreach ($taskItem in $taskFixture.actors) { $taskActor[$taskItem.Label]=$taskItem }
    foreach ($taskItem in $taskFixture.visits) { $taskVisit[$taskItem.Label]=$taskItem }
    if ((Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM sys.database_principals WHERE name='gp_phase02_fixture';") -ne 0) {
        throw 'Test user already exists; refusing to reuse or drop an unrelated principal.'
    }
    Invoke-GatePassNonQuery $taskAdmin "CREATE USER gp_phase02_fixture WITHOUT LOGIN; ALTER ROLE gp_api_runtime ADD MEMBER gp_phase02_fixture;"
    $taskCreatedUser=$true
    $taskApi=Open-TestApi
    Test-Case 'Restricted API role cannot SELECT session hashes' { Expect-SqlError { Invoke-GatePassScalar $taskApi 'SELECT TOP(1) SessionHash FROM gp.Sessions;' } 229 }
    Test-Case 'Restricted API role cannot SELECT protected QR material' { Expect-SqlError { Invoke-GatePassScalar $taskApi 'SELECT TOP(1) Ciphertext FROM gp.PassSecrets;' } 229 }
    Test-Case 'Restricted API role cannot UPDATE users or authorization versions' { Expect-SqlError { Invoke-GatePassNonQuery $taskApi 'UPDATE gp.Users SET AuthorizationVersion=AuthorizationVersion;' } 229 }
    Test-Case 'Restricted API role cannot DELETE immutable movement history' { Expect-SqlError { Invoke-GatePassNonQuery $taskApi 'DELETE FROM gp.AccessEvents WHERE 1=0;' } 229 }
    Test-Case 'Restricted API role cannot fabricate an audit row' { Expect-SqlError { Invoke-GatePassNonQuery $taskApi "INSERT gp.SecurityAuditEvents(ActionCode,TargetType,ResultCode) VALUES('FAKE','TEST','SUCCESS');" } 229 }
    Test-Case 'Restricted API role cannot invoke private locking helpers' { Expect-SqlError { Invoke-GatePassNonQuery $taskApi "EXEC gp._TakeLock 'gp:authorization','Exclusive';" } 229 }
    Test-Case 'Assigned fresh host approves one individual and one outbox job' {
        $taskP=Get-DecisionParameters 'DECISION_AP'
        $taskResult=(Invoke-GatePassScalar $taskApi $taskDecisionSql $taskP) | ConvertFrom-Json
        Assert-Condition ($taskResult.decision -eq 'APPROVED') 'Approval outcome missing.'
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM gp.NotificationOutbox WHERE VisitRequestId=@id AND TemplateCode='VISIT_DECIDED';" @{id=$taskP.VisitRequestId}) -eq 1) 'Outbox not atomic.'
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT Status FROM gp.VisitRequests WHERE VisitRequestId=@id;' @{id=[guid]$taskVisit.GROUP_OTHER.VisitId}) -eq 'PENDING') 'Another person from the intake was changed.'
        $taskReplay=Invoke-GatePassScalar $taskApi $taskDecisionSql $taskP
        Assert-Condition (($taskReplay | ConvertFrom-Json).operationId -eq $taskResult.operationId) 'Decision retry changed operation.'
    }
    Test-Case 'Assigned host denies and its pass stays unusable' {
        $taskP=Get-DecisionParameters 'DECISION_DENY' 'DENIED'
        $null=Invoke-GatePassScalar $taskApi $taskDecisionSql $taskP
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT Status FROM gp.AccessPasses WHERE AccessPassId=@id;' @{id=[guid]$taskVisit.DECISION_DENY.PassId}) -eq 'DENIED') 'Denied pass was not denied.'
        Expect-SqlError { Invoke-GatePassScalar $taskApi $taskMovementSql (Get-MovementParameters 'DECISION_DENY') } 52005
    }
    Test-Case 'Another project member cannot approve a forwarded request' { Expect-SqlError { Invoke-GatePassScalar $taskApi $taskDecisionSql (Get-DecisionParameters 'HOST_CHECK' 'APPROVED' 'OTHERHOST') } 52001 }
    Test-Case 'Changed snapshot hash cannot be approved' {
        $taskP=Get-DecisionParameters 'SNAPSHOT'; $taskP.SnapshotHash=[byte[]]::new(32)
        Expect-SqlError { Invoke-GatePassScalar $taskApi $taskDecisionSql $taskP } 52003
    }
    Test-Case 'Past approval deadline cannot be revived' { Expect-SqlError { Invoke-GatePassScalar $taskApi $taskDecisionSql (Get-DecisionParameters 'DEADLINE') } 52005 }
    foreach ($taskLabel in @('WRONGLOCATION','WRONGPROJECT','NOCAP','RECEPTION','SPLIT','BLOCKED','STALE','EXPIRED')) {
        $taskCurrent=$taskLabel
        Test-Case ("Movement denied for $taskCurrent") { Expect-SqlError { Invoke-GatePassScalar $taskApi $taskMovementSql (Get-MovementParameters 'MOVEMENT' 'ENTRY' $taskCurrent) } 52001 }
    }
    Test-Case 'Wrong CSRF binding is rejected inside the DB' {
        $taskP=Get-MovementParameters 'MOVEMENT'; $taskP.CsrfHash=[byte[]]::new(32)
        Expect-SqlError { Invoke-GatePassScalar $taskApi $taskMovementSql $taskP } 52001
    }
    Test-Case 'Oversized session hash is rejected rather than truncated' {
        $taskP=Get-MovementParameters 'MOVEMENT'; $taskP.SessionHash=[byte[]]($taskP.SessionHash + [byte]1)
        Expect-SqlError { Invoke-GatePassScalar $taskApi $taskMovementSql $taskP } 52001
    }
    Test-Case 'Pending pass cannot enter' { Expect-SqlError { Invoke-GatePassScalar $taskApi $taskMovementSql (Get-MovementParameters 'PENDING') } 52005 }
    Test-Case 'Valid guard scan requires the matching credential digest' {
        $taskP=Get-MovementParameters 'MOVEMENT'; $taskP.EntryMethod='SCAN'; $taskP.CredentialHash=[byte[]]::new(32)
        Expect-SqlError { Invoke-GatePassScalar $taskApi $taskMovementSql $taskP } 52001
        $taskP.ClientKey=[guid]::NewGuid(); $taskP.CredentialHash=[Convert]::FromHexString($taskVisit.MOVEMENT.CredentialHex)
        $null=Invoke-GatePassScalar $taskApi $taskMovementSql $taskP
        Assert-Condition ((Get-EventCount 'MOVEMENT') -eq 1) 'Matching scan entry did not record one event.'
    }
    Test-Case 'ENTRY EXIT ENTRY preserves alternating visit presence' {
        $null=Invoke-GatePassScalar $taskApi $taskMovementSql (Get-MovementParameters 'MOVEMENT' 'EXIT')
        $null=Invoke-GatePassScalar $taskApi $taskMovementSql (Get-MovementParameters 'MOVEMENT' 'ENTRY')
        Assert-Condition ((Get-EventCount 'MOVEMENT') -eq 3) 'Expected three explicit events.'
    }
    Test-Case 'New key does not permit duplicate ENTRY' {
        $null=Invoke-GatePassScalar $taskApi $taskMovementSql (Get-MovementParameters 'DUPENTRY')
        Expect-SqlError { Invoke-GatePassScalar $taskApi $taskMovementSql (Get-MovementParameters 'DUPENTRY') } 52005
        Assert-Condition ((Get-EventCount 'DUPENTRY') -eq 1) 'Duplicate entry was recorded.'
    }
    Test-Case 'Same movement key replays one result and rejects changed payload' {
        $taskP=Get-MovementParameters 'SAMERETRY'
        $taskOne=Invoke-GatePassScalar $taskApi $taskMovementSql $taskP
        $taskTwo=Invoke-GatePassScalar $taskApi $taskMovementSql $taskP
        Assert-Condition ($taskOne -eq $taskTwo -and (Get-EventCount 'SAMERETRY') -eq 1) 'Retry created a second event.'
        $taskP.EventType='EXIT'
        Expect-SqlError { Invoke-GatePassScalar $taskApi $taskMovementSql $taskP } 52003
    }
    Test-Case 'Expired inside visit can EXIT but cannot reenter' {
        Set-FixtureInside 'EXIT_EXPIRED'
        $null=Invoke-GatePassScalar $taskApi $taskMovementSql (Get-MovementParameters 'EXIT_EXPIRED' 'EXIT')
        Expect-SqlError { Invoke-GatePassScalar $taskApi $taskMovementSql (Get-MovementParameters 'EXIT_EXPIRED') } 52005
    }
    Test-Case 'Revoked inside pass needs specifically authorized reconciliation' {
        Set-FixtureInside 'RECON_REVOKED'
        Invoke-GatePassNonQuery $taskAdmin "UPDATE gp.AccessPasses SET Status='REVOKED',RevokedAtUtc=SYSUTCDATETIME(),RevocationReason='Synthetic test' WHERE AccessPassId=@id;" @{id=[guid]$taskVisit.RECON_REVOKED.PassId}
        Expect-SqlError { Invoke-GatePassScalar $taskApi $taskMovementSql (Get-MovementParameters 'RECON_REVOKED' 'EXIT') } 52005
        $taskP=Get-MovementParameters 'RECON_REVOKED' 'EXIT'; $taskP.EntryMethod='RECONCILE'; $taskP.ReconciliationReason='Observed departure'
        Expect-SqlError { Invoke-GatePassScalar $taskApi $taskMovementSql $taskP } 52001
        $taskP=Get-MovementParameters 'RECON_REVOKED' 'EXIT' 'RECON'; $taskP.EntryMethod='RECONCILE'; $taskP.ReconciliationReason='Observed departure'
        $null=Invoke-GatePassScalar $taskApi $taskMovementSql $taskP
    }
    Test-Case 'Reconciliation rejects future or pre-entry times' {
        Set-FixtureInside 'RECON_BADTIME'
        $taskP=Get-MovementParameters 'RECON_BADTIME' 'EXIT' 'RECON'; $taskP.EntryMethod='RECONCILE'; $taskP.ReconciliationReason='Observed departure'
        $taskP.OccurredAtUtc=[datetime]::UtcNow.AddHours(1)
        Expect-SqlError { Invoke-GatePassScalar $taskApi $taskMovementSql $taskP } 52002
        $taskP.ClientKey=[guid]::NewGuid(); $taskP.OccurredAtUtc=[datetime]::UtcNow.AddDays(-3)
        Expect-SqlError { Invoke-GatePassScalar $taskApi $taskMovementSql $taskP } 52002
    }
    Test-Case 'Legacy Digital ID office entry is blocked even with the old capability' {
        Expect-SqlError { Invoke-GatePassScalar $taskApi $taskMovementSql (Get-MovementParameters 'TEMP' 'ENTRY' 'WRONGPROJECT') } 52001
        Expect-SqlError { Invoke-GatePassScalar $taskApi $taskMovementSql (Get-MovementParameters 'TEMP') } 52001
    }
    Test-Case 'Stale host membership fails closed' {
        Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.EmployeeProjectMemberships SET VerifiedAtUtc=DATEADD(hour,-1,SYSUTCDATETIME()) WHERE EmployeeId=@host;' @{host=$taskFixture.hostEmployeeId}
        try { Expect-SqlError { Invoke-GatePassScalar $taskApi $taskDecisionSql (Get-DecisionParameters 'HOST_CHECK') } 52004 }
        finally { Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.EmployeeProjectMemberships SET VerifiedAtUtc=SYSUTCDATETIME() WHERE EmployeeId=@host;' @{host=$taskFixture.hostEmployeeId} }
    }
    Test-Case 'Disabled or stale employee state blocks new ENTRY' {
        Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.Employees SET IsActive=0 WHERE EmployeeId=@host;' @{host=$taskFixture.hostEmployeeId}
        try { Expect-SqlError { Invoke-GatePassScalar $taskApi $taskMovementSql (Get-MovementParameters 'EMP_DISABLED') } 52004 }
        finally { Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.Employees SET IsActive=1,LastSyncedAtUtc=DATEADD(hour,-1,SYSUTCDATETIME()) WHERE EmployeeId=@host;' @{host=$taskFixture.hostEmployeeId} }
        try { Expect-SqlError { Invoke-GatePassScalar $taskApi $taskMovementSql (Get-MovementParameters 'EMP_STALE') } 52004 }
        finally { Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.Employees SET LastSyncedAtUtc=SYSUTCDATETIME() WHERE EmployeeId=@host;' @{host=$taskFixture.hostEmployeeId} }
    }
    Test-Case 'Purged photo cannot be used for new ENTRY' {
        Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.PhotoAssets SET StorageKey=NULL,PurgedAtUtc=SYSUTCDATETIME() WHERE PhotoAssetId=@id;' @{id=[guid]$taskVisit.PHOTO_PURGED.PhotoId}
        Expect-SqlError { Invoke-GatePassScalar $taskApi $taskMovementSql (Get-MovementParameters 'PHOTO_PURGED') } 52005
    }
    Test-Case 'Successful result cannot be replayed after current grant revocation' {
        $taskP=Get-MovementParameters 'REPLAY_REAUTH'; $null=Invoke-GatePassScalar $taskApi $taskMovementSql $taskP
        Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.StaffRoleGrants SET RevokedAtUtc=SYSUTCDATETIME(),RevokedByUserId=@actor WHERE RoleGrantId=@id;' @{actor=[guid]$taskActor.HOST.UserId;id=[long]$taskActor.GUARD.GrantId}
        try { Expect-SqlError { Invoke-GatePassScalar $taskApi $taskMovementSql $taskP } 52001 }
        finally { Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.StaffRoleGrants SET RevokedAtUtc=NULL,RevokedByUserId=NULL WHERE RoleGrantId=@id;' @{id=[long]$taskActor.GUARD.GrantId} }
    }
    Test-Case 'Audit failure rolls back decision pass outbox and idempotency together' {
        $taskFaultId=[string]$taskVisit.FAULT.VisitId
        $taskTrigger="CREATE TRIGGER gp.Phase02FixtureAuditFault ON gp.SecurityAuditEvents AFTER INSERT AS BEGIN IF EXISTS(SELECT 1 FROM inserted WHERE ActionCode='VISIT_DECIDED' AND TargetReference='$taskFaultId') THROW 52999,'Synthetic audit failure',1; END;"
        Invoke-GatePassNonQuery $taskAdmin $taskTrigger
        try { Expect-SqlError { Invoke-GatePassScalar $taskApi $taskDecisionSql (Get-DecisionParameters 'FAULT') } 52999 }
        finally { Invoke-GatePassNonQuery $taskAdmin 'DROP TRIGGER gp.Phase02FixtureAuditFault;' }
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM gp.ApprovalDecisions WHERE VisitRequestId=@id;" @{id=[guid]$taskFaultId}) -eq 0) 'Decision survived rollback.'
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT Status FROM gp.VisitRequests WHERE VisitRequestId=@id;' @{id=[guid]$taskFaultId}) -eq 'PENDING') 'Visit update survived rollback.'
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.NotificationOutbox WHERE VisitRequestId=@id;' @{id=[guid]$taskFaultId}) -eq 0) 'Outbox survived rollback.'
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM gp.IdempotencyRequests WHERE Status='PROCESSING';") -eq 0) 'Failed processing row survived rollback.'
    }
    Test-Case 'Two guards racing ENTRY commit exactly one event' {
        $taskOne=Open-TestApi; $taskTwo=Open-TestApi
        $taskRace=Invoke-Race $taskOne (New-GatePassSqlCommand $taskOne $taskMovementSql (Get-MovementParameters 'MOVEMENT_RACE')) $taskTwo (New-GatePassSqlCommand $taskTwo $taskMovementSql (Get-MovementParameters 'MOVEMENT_RACE' 'ENTRY' 'GUARD2')) 'MOVEMENT_RACE'
        Assert-Condition (@($taskRace.First,$taskRace.Second | Where-Object {$_.Success}).Count -eq 1) 'Expected exactly one racing ENTRY success.'
        Assert-Condition (@($taskRace.First,$taskRace.Second | Where-Object {$_.Error -eq 52005}).Count -eq 1) 'Losing guard did not receive a presence conflict.'
        Assert-Condition ((Get-EventCount 'MOVEMENT_RACE') -eq 1) 'Race created duplicate movement events.'
    }
    Test-Case 'Concurrent same-key retries return the same movement event' {
        $taskOne=Open-TestApi; $taskTwo=Open-TestApi; $taskP=Get-MovementParameters 'IDEM_RACE'
        $taskRace=Invoke-Race $taskOne (New-GatePassSqlCommand $taskOne $taskMovementSql $taskP) $taskTwo (New-GatePassSqlCommand $taskTwo $taskMovementSql $taskP.Clone()) 'IDEM_RACE'
        Assert-Condition ($taskRace.First.Success -and $taskRace.Second.Success -and $taskRace.First.Result -eq $taskRace.Second.Result) 'Concurrent retries did not share a durable result.'
        Assert-Condition ((Get-EventCount 'IDEM_RACE') -eq 1) 'Retry race created two events.'
    }
    Test-Case 'Concurrent APPROVE and DENY commit one independent decision' {
        $taskOne=Open-TestApi; $taskTwo=Open-TestApi
        $taskRace=Invoke-Race $taskOne (New-GatePassSqlCommand $taskOne $taskDecisionSql (Get-DecisionParameters 'DECISION_RACE')) $taskTwo (New-GatePassSqlCommand $taskTwo $taskDecisionSql (Get-DecisionParameters 'DECISION_RACE' 'DENIED')) 'DECISION_RACE'
        Assert-Condition (@($taskRace.First,$taskRace.Second | Where-Object {$_.Success}).Count -eq 1) 'Expected exactly one racing decision success.'
        Assert-Condition (@($taskRace.First,$taskRace.Second | Where-Object {$_.Error -eq 52005}).Count -eq 1) 'Losing decision did not conflict.'
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.ApprovalDecisions WHERE VisitRequestId=@id;' @{id=[guid]$taskVisit.DECISION_RACE.VisitId}) -eq 1) 'Two decisions were stored.'
    }
    Test-Case 'Scoped admin cannot deallocate a guard in another location' {
        $taskP=Get-ActorParameters 'ADMIN'; $taskP.GuardAssignmentId=[long]$taskActor.WRONGLOCATION.AssignmentId; $taskP.Reason='Synthetic scope test'
        Expect-SqlError { Invoke-GatePassScalar $taskApi $taskDeallocateSql $taskP } 52001
    }
    Test-Case 'Revocation waits for an authorized movement then blocks later operations and cached replay' {
        $taskOne=Open-TestApi; $taskTwo=Open-TestApi; $taskMove=Get-MovementParameters 'REVOKE_BLOCK' 'ENTRY' 'GUARD2'
        $taskRevoke=Get-ActorParameters 'ADMIN'; $taskRevoke.GuardAssignmentId=[long]$taskActor.GUARD2.AssignmentId; $taskRevoke.Reason='Synthetic deallocation'
        $taskRace=Invoke-Race $taskOne (New-GatePassSqlCommand $taskOne $taskMovementSql $taskMove) $taskTwo (New-GatePassSqlCommand $taskTwo $taskDeallocateSql $taskRevoke) 'REVOKE_BLOCK'
        Assert-Condition ($taskRace.First.Success -and $taskRace.Second.Success) 'Authorized movement/deallocation commit order failed.'
        Expect-SqlError { Invoke-GatePassScalar $taskApi $taskMovementSql $taskMove } 52001
        Invoke-GatePassNonQuery $taskAdmin 'UPDATE s SET AuthorizationVersionAtIssue=u.AuthorizationVersion FROM gp.Sessions s JOIN gp.Users u ON u.UserId=s.UserId WHERE u.UserId=@id;' @{id=[guid]$taskActor.GUARD2.UserId}
        Expect-SqlError { Invoke-GatePassScalar $taskApi $taskMovementSql (Get-MovementParameters 'REVOKE_BLOCK' 'EXIT' 'GUARD2') } 52001
        $taskCached=Invoke-GatePassScalar $taskApi $taskDeallocateSql $taskRevoke
        Assert-Condition (($taskCached | ConvertFrom-Json).deallocated -eq $true) 'Admin retry did not return the committed deallocation.'
    }
    $taskHarnessComplete=$true
}
finally {
    foreach ($taskConnection in $taskConnections) { $taskConnection.Dispose() }
    try {
        Invoke-GatePassNonQuery $taskAdmin "IF @@TRANCOUNT>0 ROLLBACK; IF OBJECT_ID('gp.Phase02FixtureAuditFault','TR') IS NOT NULL DROP TRIGGER gp.Phase02FixtureAuditFault;"
        if ($taskFixtureReady) { Invoke-GatePassNonQuery $taskAdmin ([IO.File]::ReadAllText((Join-Path $PSScriptRoot '003_transaction_cleanup.sql'))) @{RunId=$taskRun} }
        if ($taskCreatedUser) { Invoke-GatePassNonQuery $taskAdmin 'DROP USER gp_phase02_fixture;' }
        $taskRemaining=Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM gp.Users WHERE IdentityIssuer='gatepass-phase02-fixture' AND IdentitySubject LIKE @prefix+':%';" @{prefix=('GP02-'+$taskRun.ToString('N').Substring(0,20))}
        Assert-Condition ($taskRemaining -eq 0) 'Fixture cleanup incomplete.'
        $taskCleanupPassed=$true
    }
    finally {
        $taskAdmin.Dispose()
        $taskReport=[ordered]@{Status=if ($taskHarnessComplete -and $taskCases.Count -gt 0 -and @($taskCases | Where-Object {-not $_.Passed}).Count -eq 0 -and $taskCleanupPassed) {'PASS'} else {'FAIL'};
            CheckedAtUtc=[datetime]::UtcNow.ToString('o');Database='GatePass_DesignTest';ExecutionIdentity='EXECUTE AS USER: isolated member of gp_api_runtime; admin connection only for test fixtures/inspection';
            MigrationSha256=(Get-FileHash -LiteralPath (Join-Path $taskRoot 'database/migrations/003_transaction_security_core.sql') -Algorithm SHA256).Hash;
            HarnessSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash;
            FixtureSha256=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot '002_transaction_fixtures.sql') -Algorithm SHA256).Hash;
            CleanupSha256=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot '003_transaction_cleanup.sql') -Algorithm SHA256).Hash;
            CaseCount=$taskCases.Count;CleanupPassed=$taskCleanupPassed;Cases=@($taskCases)}
        $taskReport | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $taskRoot 'database/validation/transaction-core-report.json') -Encoding utf8
    }
}
if ($taskReport.Status -ne 'PASS') { throw 'Transaction core tests failed; inspect database/validation/transaction-core-report.json.' }
Write-Output ("All $($taskCases.Count) transaction/security cases passed; committed synthetic fixtures and temporary principal removed.")
