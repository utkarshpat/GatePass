#Requires -Version 7.0
[CmdletBinding()]
param([string]$Server='localhost\SQLEXPRESS',[switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskAdmin=Open-GatePassLocalSql -Server $Server -TrustLocalServerCertificate:$TrustLocalServerCertificate
$taskRun=[guid]::NewGuid()
$taskFixtureReady=$false
$taskCreatedWorker=$false
$taskCreatedApi=$false
$taskHarnessComplete=$false
$taskCleanupPassed=$false
$taskCases=[Collections.Generic.List[object]]::new()
$taskConnections=[Collections.Generic.List[object]]::new()
$taskJobs=[Collections.Generic.List[long]]::new()
$taskActors=@{}
$taskVisits=@{}
$taskClaimSql='EXEC gp.ClaimNotifications @BatchSize,@LeaseSeconds;'
$taskReadSql='EXEC gp.GetNotificationDispatch @NotificationId,@ClaimToken;'
$taskAckSql='EXEC gp.CompleteNotification @NotificationId,@ClaimToken,@Outcome,@ErrorCode,@ProviderMessageId;'

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
function Open-TestConnection([string]$Principal='gp_worker_fixture') {
    $taskConnection=Open-GatePassLocalSql -Server $Server -TrustLocalServerCertificate:$TrustLocalServerCertificate
    if ($Principal -eq 'gp_worker_fixture') { Invoke-GatePassNonQuery $taskConnection "EXECUTE AS USER='gp_worker_fixture';" }
    elseif ($Principal -eq 'gp_worker_api_fixture') { Invoke-GatePassNonQuery $taskConnection "EXECUTE AS USER='gp_worker_api_fixture';" }
    else { $taskConnection.Dispose(); throw 'Unexpected fixture principal.' }
    $taskConnections.Add($taskConnection)
    return $taskConnection
}
function Quiet-FixtureJobs {
    Invoke-GatePassNonQuery $taskAdmin @'
UPDATE n SET Status='CANCELLED',LockedBy=NULL,LockedUntilUtc=NULL
FROM gp.NotificationOutbox n JOIN gp.VisitRequests v ON v.VisitRequestId=n.VisitRequestId
WHERE v.PublicReference LIKE @prefix+'-%' AND n.Status IN('PENDING','PROCESSING');
'@ @{prefix=$taskFixture.prefix}
}
function Test-Case([string]$Name,[scriptblock]$Action) {
    $taskStarted=[datetime]::UtcNow
    try {
        Quiet-FixtureJobs
        $null=& $Action
        $taskCases.Add(@{Name=$Name;Passed=$true;DurationMs=[int]([datetime]::UtcNow-$taskStarted).TotalMilliseconds})
        Write-Output ('PASS: '+$Name)
    }
    catch {
        $taskCases.Add(@{Name=$Name;Passed=$false;Error=$_.Exception.Message;DurationMs=[int]([datetime]::UtcNow-$taskStarted).TotalMilliseconds})
        Write-Output ('FAIL: '+$Name+' -- '+$_.Exception.Message)
    }
}
function New-FixtureJob([string]$Template='TEMP_ID_MANAGER_NOTICE',[string]$Visit='TEMP',[int]$MaxAttempts=3) {
    $taskKind=if ($Template -eq 'TEMP_ID_MANAGER_NOTICE') {'MANAGER'} elseif ($Template -eq 'HOST_APPROVAL_REQUEST') {'EMPLOYEE'} else {'EMAIL'}
    $taskRecipient=if ($taskKind -eq 'EMAIL') {$null} else {$taskFixture.hostEmployeeId}
    $taskEmail=if ($taskKind -eq 'EMAIL') {$taskFixture.prefix.ToLowerInvariant()+'@example.invalid'} else {$null}
    $taskPayload=@{visitRequestId=$taskVisits[$Visit].VisitId;decision='APPROVED'} | ConvertTo-Json -Compress
    $taskId=Invoke-GatePassScalar $taskAdmin @'
INSERT gp.NotificationOutbox(VisitRequestId,RecipientKind,RecipientEmployeeId,RecipientEmail,TemplateCode,PayloadJson,DedupeHash,MaxAttempts,NextAttemptAtUtc)
VALUES(@visit,@kind,@employee,@email,@template,@payload,HASHBYTES('SHA2_256',CONVERT(binary(16),@dedupe)),@max,DATEADD(second,-1,SYSUTCDATETIME()));
SELECT CONVERT(bigint,SCOPE_IDENTITY());
'@ @{visit=[guid]$taskVisits[$Visit].VisitId;kind=$taskKind;employee=$taskRecipient;email=$taskEmail;template=$Template;payload=$taskPayload;dedupe=[guid]::NewGuid();max=$MaxAttempts}
    $taskJobs.Add([long]$taskId)
    return [long]$taskId
}
function Claim-Notifications([int]$BatchSize=1) {
    $taskText=Invoke-GatePassScalar $taskWorker $taskClaimSql @{BatchSize=$BatchSize;LeaseSeconds=60}
    return ,(ConvertFrom-Json -InputObject $taskText -AsHashtable -NoEnumerate)
}
function Claim-One {
    $taskItems=Claim-Notifications
    Assert-Condition ($taskItems.Count -eq 1) 'Exactly one fixture notification should be claimable.'
    return $taskItems[0]
}
function Claim-Parameters($Claim) { return @{NotificationId=[long]$Claim.notificationId;ClaimToken=[guid]$Claim.claimToken} }
function Read-Claim($Claim) { return (Invoke-GatePassScalar $taskWorker $taskReadSql (Claim-Parameters $Claim)) | ConvertFrom-Json -AsHashtable }
function Ack-Parameters($Claim,[string]$Outcome='SENT',[string]$ErrorCode) {
    $taskParams=Claim-Parameters $Claim
    $taskParams.Outcome=$Outcome
    $taskParams.ErrorCode=if ([string]::IsNullOrEmpty($ErrorCode)) {$null} else {$ErrorCode}
    $taskParams.ProviderMessageId=$null
    return $taskParams
}
function Ack-Claim($Claim,[string]$Outcome='SENT',[string]$ErrorCode) {
    return (Invoke-GatePassScalar $taskWorker $taskAckSql (Ack-Parameters $Claim $Outcome $ErrorCode)) | ConvertFrom-Json -AsHashtable
}
function Get-Job([long]$Id) {
    return (Invoke-GatePassScalar $taskAdmin @'
DECLARE @j nvarchar(max)=(SELECT NotificationId,Status,AttemptCount,LockedBy,LockedUntilUtc,LastErrorCode,SentAtUtc,ProviderMessageId,
DATEDIFF(second,SYSUTCDATETIME(),NextAttemptAtUtc) AS retry_in_seconds FROM gp.NotificationOutbox WHERE NotificationId=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER); SELECT @j;
'@ @{id=$Id}) | ConvertFrom-Json -AsHashtable
}
function Expire-FixtureLease([long]$Id) {
    Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.NotificationOutbox SET LockedUntilUtc=DATEADD(second,-1,SYSUTCDATETIME()) WHERE NotificationId=@id;' @{id=$Id}
}
function Add-FixtureDelivery([long]$Job,[string]$Visit='MOVEMENT') {
    Invoke-GatePassNonQuery $taskAdmin @'
DECLARE @link uniqueidentifier=NEWID();
INSERT gp.PassDeliveryLinks(DeliveryLinkId,AccessPassId,VisitRequestId,TokenHash,TokenCiphertext,Nonce,AuthenticationTag,KeyVersion,RecipientEmail,ExpiresAtUtc)
VALUES(@link,@pass,@visit,HASHBYTES('SHA2_256',CONVERT(binary(16),@link)),0x0102,CRYPT_GEN_RANDOM(12),CRYPT_GEN_RANDOM(16),
'synthetic-not-real-encryption',@email,DATEADD(minute,30,SYSUTCDATETIME()));
UPDATE gp.NotificationOutbox SET DeliveryLinkId=@link WHERE NotificationId=@job;
'@ @{pass=[guid]$taskVisits[$Visit].PassId;visit=[guid]$taskVisits[$Visit].VisitId;email=($taskFixture.prefix.ToLowerInvariant()+'@example.invalid');job=$Job}
}
function Invoke-QueueRace($FirstConnection,$FirstCommand,$SecondConnection,$SecondCommand) {
    $taskFirstSid=Invoke-GatePassScalar $FirstConnection 'SELECT @@SPID;'
    $taskSecondSid=Invoke-GatePassScalar $SecondConnection 'SELECT @@SPID;'
    Invoke-GatePassNonQuery $taskAdmin 'BEGIN TRANSACTION;'
    try {
        Invoke-GatePassNonQuery $taskAdmin "EXEC gp._TakeLock N'gp:outbox:claim';"
        $taskFirst=$FirstCommand.ExecuteScalarAsync()
        $taskSecond=$SecondCommand.ExecuteScalarAsync()
        $taskDeadline=[datetime]::UtcNow.AddSeconds(3)
        do {
            $taskWaiting=Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM sys.dm_exec_requests WHERE session_id IN(@first,@second) AND wait_type LIKE N''LCK_M%'';' @{first=$taskFirstSid;second=$taskSecondSid}
            if ($taskWaiting -eq 2) { break }
            [Threading.Thread]::Sleep(25)
        } while ([datetime]::UtcNow -lt $taskDeadline)
        Assert-Condition ($taskWaiting -eq 2) 'Both independent workers were not observed waiting at the SQL queue gate.'
    }
    finally { Invoke-GatePassNonQuery $taskAdmin 'IF @@TRANCOUNT>0 COMMIT;'; }
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
    Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.NotificationOutbox;') -eq 0) 'Worker tests require an empty dedicated outbox; unrelated jobs will not be claimed.'
    Assert-Condition ((Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM gp.SchemaMigrations WHERE Version='004';") -eq 1) 'Migration 004 required.'
    Assert-Condition ((Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM gp.SchemaMigrations WHERE Version='005';") -eq 1) 'Migration 005 required.'
    Assert-Condition ((Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM sys.database_principals WHERE name IN('gp_worker_fixture','gp_worker_api_fixture');") -eq 0) 'A fixture principal already exists; refusing to reuse it.'
    $taskFixture=(Invoke-GatePassScalar $taskAdmin ([IO.File]::ReadAllText((Join-Path $PSScriptRoot '002_transaction_fixtures.sql'))) @{RunId=$taskRun}) | ConvertFrom-Json -AsHashtable
    $taskFixtureReady=$true
    foreach ($taskItem in $taskFixture.actors) { $taskActors[$taskItem.Label]=$taskItem }
    foreach ($taskItem in $taskFixture.visits) { $taskVisits[$taskItem.Label]=$taskItem }
    Invoke-GatePassNonQuery $taskAdmin 'CREATE USER gp_worker_fixture WITHOUT LOGIN; ALTER ROLE gp_worker_runtime ADD MEMBER gp_worker_fixture;'
    $taskCreatedWorker=$true
    Invoke-GatePassNonQuery $taskAdmin 'CREATE USER gp_worker_api_fixture WITHOUT LOGIN; ALTER ROLE gp_api_runtime ADD MEMBER gp_worker_api_fixture;'
    $taskCreatedApi=$true
    $taskWorker=Open-TestConnection
    $taskApi=Open-TestConnection 'gp_worker_api_fixture'
    # Obtain a real core decision/outbox job through its restricted API procedure.
    $taskDecision=@{SessionHash=[Convert]::FromHexString($taskActors.HOST.SessionHex);CsrfHash=[Convert]::FromHexString($taskActors.HOST.CsrfHex);
        ClientKey=[guid]::NewGuid();Visit=[guid]$taskVisits.DECISION_AP.VisitId;Hash=[Convert]::FromHexString($taskVisits.DECISION_AP.SnapshotHex)}
    $null=Invoke-GatePassScalar $taskApi "EXEC gp.DecideVisit @SessionHash,@CsrfHash,@ClientKey,@Visit,1,@Hash,'APPROVED',NULL;" $taskDecision
    $taskJobs.Add([long](Invoke-GatePassScalar $taskAdmin 'SELECT NotificationId FROM gp.NotificationOutbox WHERE VisitRequestId=@id;' @{id=[guid]$taskVisits.DECISION_AP.VisitId}))

    Test-Case 'API role cannot claim notification jobs' { Expect-SqlError { Invoke-GatePassScalar $taskApi $taskClaimSql @{BatchSize=1;LeaseSeconds=60} } 229 }
    Test-Case 'Worker role cannot directly read outbox recipients or payloads' { Expect-SqlError { Invoke-GatePassScalar $taskWorker 'SELECT TOP(1) PayloadJson FROM gp.NotificationOutbox;' } 229 }
    Test-Case 'Worker role cannot read session hashes or protected QR material' {
        Expect-SqlError { Invoke-GatePassScalar $taskWorker 'SELECT TOP(1) SessionHash FROM gp.Sessions;' } 229
        Expect-SqlError { Invoke-GatePassScalar $taskWorker 'SELECT TOP(1) Ciphertext FROM gp.PassSecrets;' } 229
    }
    Test-Case 'Worker role cannot rewrite audit or movement history' {
        Expect-SqlError { Invoke-GatePassNonQuery $taskWorker 'DELETE FROM gp.SecurityAuditEvents WHERE 1=0;' } 229
        Expect-SqlError { Invoke-GatePassNonQuery $taskWorker 'UPDATE gp.AccessEvents SET EventType=EventType;' } 229
    }
    Test-Case 'Worker role cannot approve visitors or invoke private helpers' {
        Expect-SqlError { Invoke-GatePassScalar $taskWorker "EXEC gp.DecideVisit 0x00,0x00,NULL,NULL,1,0x00,'APPROVED',NULL;" } 229
        Expect-SqlError { Invoke-GatePassNonQuery $taskWorker "EXEC gp._TakeLock N'gp:authorization';" } 229
    }
    Test-Case 'Empty queue returns the literal JSON array instead of SQL NULL' {
        $taskRaw=Invoke-GatePassScalar $taskWorker $taskClaimSql @{BatchSize=1;LeaseSeconds=60}
        Assert-Condition ($taskRaw -is [string] -and $taskRaw -eq '[]') 'Empty queue contract must be a JSON array.'
        Assert-Condition ((Claim-Notifications).Count -eq 0) 'Empty queue returned jobs.'
    }
    Test-Case 'Claim and lease limits reject unbounded inputs' {
        foreach ($taskBatch in @(0,21)) { Expect-SqlError { Invoke-GatePassScalar $taskWorker $taskClaimSql @{BatchSize=$taskBatch;LeaseSeconds=60} } 52002 }
        foreach ($taskSeconds in @(0,301)) { Expect-SqlError { Invoke-GatePassScalar $taskWorker $taskClaimSql @{BatchSize=1;LeaseSeconds=$taskSeconds} } 52002 }
    }
    Test-Case 'Future pending jobs are not claimable' {
        $taskId=New-FixtureJob
        Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.NotificationOutbox SET NextAttemptAtUtc=DATEADD(hour,1,SYSUTCDATETIME()) WHERE NotificationId=@id;' @{id=$taskId}
        Assert-Condition ((Claim-Notifications).Count -eq 0) 'Future retry was claimed early.'
    }
    Test-Case 'Claim creates a fresh lease and increments attempt once' {
        $taskId=New-FixtureJob; $taskClaim=Claim-One; $taskRow=Get-Job $taskId
        Assert-Condition ($taskClaim.notificationId -eq $taskId -and $taskClaim.attemptCount -eq 1 -and $taskRow.Status -eq 'PROCESSING') 'Claim state invalid.'
        Assert-Condition (-not $taskClaim.ContainsKey('recipientEmail') -and -not $taskClaim.ContainsKey('payload')) 'Claim leaked message contents before dispatch preflight.'
        Assert-Condition ((Claim-Notifications).Count -eq 0) 'Live lease was claimed again.'
    }
    Test-Case 'Claim batch is bounded and tokens are unique per job' {
        for ($taskI=0;$taskI -lt 23;$taskI++) { $null=New-FixtureJob }
        $taskClaims=Claim-Notifications 20
        Assert-Condition ($taskClaims.Count -eq 20 -and @($taskClaims.claimToken | Select-Object -Unique).Count -eq 20) 'Batch limit or per-claim fencing failed.'
    }
    Test-Case 'Unresolved manager recipient remains dispatchable without blocking pass' {
        $taskId=New-FixtureJob; $taskClaim=Claim-One; $taskDispatch=Read-Claim $taskClaim
        Assert-Condition ($taskDispatch.status -eq 'READY' -and $taskDispatch.recipientKind -eq 'MANAGER' -and -not $taskDispatch.ContainsKey('recipientEmail')) 'Manager resolution reference lost or an untrusted email fallback was returned.'
        $taskResult=Ack-Claim $taskClaim 'FAILED' 'DIRECTORY_UNAVAILABLE'
        Assert-Condition ($taskResult.status -eq 'PENDING') 'Transient manager lookup did not retry.'
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin 'SELECT Status FROM gp.AccessPasses WHERE AccessPassId=@id;' @{id=[guid]$taskVisits.TEMP.PassId}) -eq 'ACTIVE') 'Manager lookup failure altered the pass.'
    }
    Test-Case 'SENT completion clears lease and records provider acceptance once' {
        $taskId=New-FixtureJob; $taskClaim=Claim-One; $null=Read-Claim $taskClaim
        $taskAck=Ack-Parameters $taskClaim; $taskAck.ProviderMessageId='synthetic-provider-id'
        $null=Invoke-GatePassScalar $taskWorker $taskAckSql $taskAck
        $taskRow=Get-Job $taskId
        Assert-Condition ($taskRow.Status -eq 'SENT' -and $taskRow.ContainsKey('SentAtUtc') -and -not $taskRow.ContainsKey('LockedBy')) 'SENT lease/timestamp invalid.'
        Expect-SqlError { Invoke-GatePassScalar $taskWorker $taskAckSql $taskAck } 52003
        Assert-Condition ((Claim-Notifications).Count -eq 0) 'SENT work was claimed again.'
    }
    Test-Case 'Transient failure schedules bounded backoff and clears ownership' {
        $taskId=New-FixtureJob; $taskClaim=Claim-One; $null=Ack-Claim $taskClaim 'FAILED' 'PROVIDER_TIMEOUT'; $taskRow=Get-Job $taskId
        Assert-Condition ($taskRow.Status -eq 'PENDING' -and $taskRow.retry_in_seconds -ge 29 -and $taskRow.retry_in_seconds -le 46 -and -not $taskRow.ContainsKey('LockedBy')) 'First retry backoff invalid.'
        Assert-Condition ((Claim-Notifications).Count -eq 0) 'Scheduled retry was claimed early.'
    }
    Test-Case 'High attempt retry caps backoff without arithmetic overflow' {
        $taskId=New-FixtureJob -MaxAttempts 100
        Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.NotificationOutbox SET AttemptCount=98 WHERE NotificationId=@id;' @{id=$taskId}
        $taskClaim=Claim-One; $null=Ack-Claim $taskClaim 'FAILED' 'PROVIDER_UNAVAILABLE'; $taskRow=Get-Job $taskId
        Assert-Condition ($taskRow.retry_in_seconds -ge 3599 -and $taskRow.retry_in_seconds -le 3601) 'High-attempt backoff not capped at an hour.'
    }
    Test-Case 'Permanent rejection ends work without repeated retries' {
        $taskId=New-FixtureJob; $taskClaim=Claim-One; $taskResult=Ack-Claim $taskClaim 'FAILED' 'INVALID_RECIPIENT'
        Assert-Condition ($taskResult.status -eq 'DEAD' -and (Get-Job $taskId).LastErrorCode -eq 'INVALID_RECIPIENT') 'Permanent failure did not become DEAD.'
    }
    Test-Case 'Final permitted failed attempt becomes DEAD' {
        $taskId=New-FixtureJob -MaxAttempts 1; $taskClaim=Claim-One; $taskResult=Ack-Claim $taskClaim 'FAILED' 'RENDER_FAILED'
        Assert-Condition ($taskResult.status -eq 'DEAD' -and $taskResult.attemptCount -eq 1) 'Attempt budget exceeded.'
    }
    Test-Case 'Expired final lease is finalized DEAD rather than stuck PROCESSING' {
        $taskId=New-FixtureJob -MaxAttempts 1; $taskClaim=Claim-One; Expire-FixtureLease $taskId
        Assert-Condition ((Claim-Notifications).Count -eq 0 -and (Get-Job $taskId).Status -eq 'DEAD') 'Expired exhausted lease remained stuck.'
    }
    Test-Case 'A live final lease may still acknowledge success' {
        $taskId=New-FixtureJob -MaxAttempts 1; $taskClaim=Claim-One
        Assert-Condition ((Claim-Notifications).Count -eq 0 -and (Get-Job $taskId).Status -eq 'PROCESSING') 'Live final attempt was killed prematurely.'
        Assert-Condition ((Ack-Claim $taskClaim).status -eq 'SENT') 'Final live provider acceptance rejected.'
    }
    Test-Case 'Crash recovery returns a new fencing token and rejects the old owner' {
        $taskId=New-FixtureJob; $taskOld=Claim-One; Expire-FixtureLease $taskId; $taskNew=Claim-One
        Assert-Condition ($taskNew.notificationId -eq $taskOld.notificationId -and $taskNew.claimToken -ne $taskOld.claimToken -and $taskNew.attemptCount -eq 2) 'Recovery reused an old lease handle.'
        Expect-SqlError { Read-Claim $taskOld } 52003
        Expect-SqlError { Ack-Claim $taskOld } 52003
        Assert-Condition ((Ack-Claim $taskNew).status -eq 'SENT') 'Current claim could not acknowledge.'
    }
    Test-Case 'Lease expiration alone blocks stale acknowledgement before reclaim' {
        $taskId=New-FixtureJob; $taskClaim=Claim-One; Expire-FixtureLease $taskId
        Expect-SqlError { Ack-Claim $taskClaim } 52003
        Assert-Condition ((Get-Job $taskId).Status -eq 'PROCESSING') 'Stale acknowledgement mutated work.'
    }
    Test-Case 'Lease renewal works only for the current unexpired claim' {
        $taskId=New-FixtureJob; $taskClaim=Claim-One; $taskParams=Claim-Parameters $taskClaim; $taskParams.LeaseSeconds=120
        $null=Invoke-GatePassScalar $taskWorker 'EXEC gp.RenewNotificationLease @NotificationId,@ClaimToken,@LeaseSeconds;' $taskParams
        Assert-Condition (([datetime](Get-Job $taskId).LockedUntilUtc) -gt ([datetime]$taskClaim.leaseUntilUtc)) 'Lease was not extended.'
        Expire-FixtureLease $taskId
        Expect-SqlError { Invoke-GatePassScalar $taskWorker 'EXEC gp.RenewNotificationLease @NotificationId,@ClaimToken,@LeaseSeconds;' $taskParams } 52003
    }
    Test-Case 'A shorter renewal request never shortens the existing lease' {
        $taskId=New-FixtureJob; $taskClaim=Claim-One; $taskParams=Claim-Parameters $taskClaim; $taskParams.LeaseSeconds=15
        $null=Invoke-GatePassScalar $taskWorker 'EXEC gp.RenewNotificationLease @NotificationId,@ClaimToken,@LeaseSeconds;' $taskParams
        Assert-Condition (([datetime](Get-Job $taskId).LockedUntilUtc) -ge ([datetime]$taskClaim.leaseUntilUtc)) 'Renewal shortened the active lease.'
    }
    Test-Case 'Wrong token cannot read acknowledge or renew another claim' {
        $taskId=New-FixtureJob; $taskClaim=Claim-One; $taskClaim.claimToken=[guid]::NewGuid()
        Expect-SqlError { Read-Claim $taskClaim } 52003
        Expect-SqlError { Ack-Claim $taskClaim } 52003
        $taskParams=Claim-Parameters $taskClaim; $taskParams.LeaseSeconds=60
        Expect-SqlError { Invoke-GatePassScalar $taskWorker 'EXEC gp.RenewNotificationLease @NotificationId,@ClaimToken,@LeaseSeconds;' $taskParams } 52003
    }
    Test-Case 'Unlisted provider error text is rejected and never persisted' {
        $taskId=New-FixtureJob; $taskClaim=Claim-One
        Expect-SqlError { Ack-Claim $taskClaim 'FAILED' 'raw-provider-response-with-sensitive-data' } 52002
        Assert-Condition (-not (Get-Job $taskId).ContainsKey('LastErrorCode')) 'Raw provider error text was persisted.'
    }
    Test-Case 'Unsupported templates are canceled before message data is returned' {
        $taskId=New-FixtureJob 'UNSUPPORTED'; $taskClaim=Claim-One; $taskResult=Read-Claim $taskClaim
        Assert-Condition ($taskResult.status -eq 'CANCELLED' -and $taskResult.reasonCode -eq 'UNSUPPORTED_TEMPLATE' -and -not $taskResult.ContainsKey('payload')) 'Unknown template was dispatchable.'
    }
    Test-Case 'Fresh assigned host approval notice passes relevance checks' {
        $taskId=New-FixtureJob 'HOST_APPROVAL_REQUEST' 'HOST_CHECK'; $taskClaim=Claim-One
        Assert-Condition ((Read-Claim $taskClaim).status -eq 'READY') 'Fresh host notice was blocked.'
    }
    Test-Case 'Expired host approval notice is canceled before dispatch' {
        $taskId=New-FixtureJob 'HOST_APPROVAL_REQUEST' 'DEADLINE'; $taskClaim=Claim-One
        Assert-Condition ((Read-Claim $taskClaim).status -eq 'CANCELLED') 'Expired approval notice was exposed.'
    }
    Test-Case 'Stale host directory data stays retryable and fails closed' {
        $taskId=New-FixtureJob 'HOST_APPROVAL_REQUEST' 'HOST_CHECK'; $taskClaim=Claim-One
        Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.EmployeeProjectMemberships SET VerifiedAtUtc=DATEADD(hour,-1,SYSUTCDATETIME()) WHERE EmployeeId=@id;' @{id=$taskFixture.hostEmployeeId}
        try { Expect-SqlError { Read-Claim $taskClaim } 52004; Assert-Condition ((Get-Job $taskId).Status -eq 'PROCESSING') 'Transient directory failure canceled the job.' }
        finally { Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.EmployeeProjectMemberships SET VerifiedAtUtc=SYSUTCDATETIME() WHERE EmployeeId=@id;' @{id=$taskFixture.hostEmployeeId} }
    }
    Test-Case 'A committed individual decision notice is dispatchable' {
        $taskId=New-FixtureJob 'VISIT_DECIDED' 'DECISION_AP'; $taskClaim=Claim-One
        Assert-Condition ((Read-Claim $taskClaim).status -eq 'READY') 'Committed decision notice was not recognized.'
    }
    Test-Case 'Mismatched recipient never receives another visitor decision' {
        $taskId=New-FixtureJob 'VISIT_DECIDED' 'DECISION_AP'
        Invoke-GatePassNonQuery $taskAdmin "UPDATE gp.NotificationOutbox SET RecipientEmail='other@example.invalid' WHERE NotificationId=@id;" @{id=$taskId}
        $taskClaim=Claim-One; $taskResult=Read-Claim $taskClaim
        Assert-Condition ($taskResult.status -eq 'CANCELLED' -and $taskResult.reasonCode -eq 'RECIPIENT_MISMATCH') 'Mismatched recipient was dispatchable.'
    }
    Test-Case 'Current delivery link is referenced without exposing encrypted token material' {
        $taskId=New-FixtureJob 'PASS_DELIVERY' 'MOVEMENT'; Add-FixtureDelivery $taskId; $taskClaim=Claim-One; $taskDispatch=Read-Claim $taskClaim
        Assert-Condition ($taskDispatch.status -eq 'READY' -and $taskDispatch.ContainsKey('deliveryLinkId') -and -not $taskDispatch.ContainsKey('tokenCiphertext')) 'Delivery preflight leaked or lost its reference.'
    }
    Test-Case 'Revoked delivery link is canceled before dispatch' {
        $taskId=New-FixtureJob 'PASS_DELIVERY' 'MOVEMENT'; Add-FixtureDelivery $taskId
        Invoke-GatePassNonQuery $taskAdmin 'UPDATE l SET RevokedAtUtc=SYSUTCDATETIME() FROM gp.PassDeliveryLinks l JOIN gp.NotificationOutbox n ON n.DeliveryLinkId=l.DeliveryLinkId WHERE n.NotificationId=@id;' @{id=$taskId}
        $taskClaim=Claim-One; Assert-Condition ((Read-Claim $taskClaim).status -eq 'CANCELLED') 'Revoked link was dispatchable.'
    }
    Test-Case 'Expired delivery link is canceled before dispatch' {
        $taskId=New-FixtureJob 'PASS_DELIVERY' 'MOVEMENT'; Add-FixtureDelivery $taskId
        Invoke-GatePassNonQuery $taskAdmin 'UPDATE l SET CreatedAtUtc=DATEADD(hour,-2,SYSUTCDATETIME()),ExpiresAtUtc=DATEADD(hour,-1,SYSUTCDATETIME()) FROM gp.PassDeliveryLinks l JOIN gp.NotificationOutbox n ON n.DeliveryLinkId=l.DeliveryLinkId WHERE n.NotificationId=@id;' @{id=$taskId}
        $taskClaim=Claim-One; Assert-Condition ((Read-Claim $taskClaim).status -eq 'CANCELLED') 'Expired link was dispatchable.'
    }
    Test-Case 'Claim audit failure rolls lease and attempt back before returning rows' {
        $taskId=New-FixtureJob
        Invoke-GatePassNonQuery $taskAdmin "CREATE TRIGGER gp.Phase02WorkerFixtureFault ON gp.SecurityAuditEvents AFTER INSERT AS BEGIN IF EXISTS(SELECT 1 FROM inserted WHERE ActionCode='NOTIFICATION_CLAIMED' AND TargetReference='$taskId') THROW 52999,'Synthetic claim audit failure',1; END;"
        try { Expect-SqlError { Claim-Notifications } 52999 }
        finally { Invoke-GatePassNonQuery $taskAdmin 'DROP TRIGGER gp.Phase02WorkerFixtureFault;' }
        $taskRow=Get-Job $taskId
        Assert-Condition ($taskRow.Status -eq 'PENDING' -and $taskRow.AttemptCount -eq 0 -and -not $taskRow.ContainsKey('LockedBy')) 'Failed claim escaped rollback.'
    }
    Test-Case 'Acknowledgement audit failure rolls SENT state back' {
        $taskId=New-FixtureJob; $taskClaim=Claim-One
        Invoke-GatePassNonQuery $taskAdmin "CREATE TRIGGER gp.Phase02WorkerFixtureFault ON gp.SecurityAuditEvents AFTER INSERT AS BEGIN IF EXISTS(SELECT 1 FROM inserted WHERE ActionCode='NOTIFICATION_COMPLETED' AND TargetReference='$taskId') THROW 52999,'Synthetic acknowledgement audit failure',1; END;"
        try { Expect-SqlError { Ack-Claim $taskClaim } 52999 }
        finally { Invoke-GatePassNonQuery $taskAdmin 'DROP TRIGGER gp.Phase02WorkerFixtureFault;' }
        Assert-Condition ((Get-Job $taskId).Status -eq 'PROCESSING') 'SENT update survived failed audit.'
        Assert-Condition ((Ack-Claim $taskClaim).status -eq 'SENT') 'Current claim could not finish after rollback.'
    }
    Test-Case 'Two workers racing one notification produce one active claim' {
        $taskId=New-FixtureJob; $taskOne=Open-TestConnection; $taskTwo=Open-TestConnection
        $taskP=@{BatchSize=1;LeaseSeconds=60}
        $taskRace=Invoke-QueueRace $taskOne (New-GatePassSqlCommand $taskOne $taskClaimSql $taskP) $taskTwo (New-GatePassSqlCommand $taskTwo $taskClaimSql $taskP)
        Assert-Condition ($taskRace.First.Success -and $taskRace.Second.Success) 'Concurrent claims errored.'
        $taskFirstClaims=ConvertFrom-Json -InputObject $taskRace.First.Result -AsHashtable -NoEnumerate
        $taskSecondClaims=ConvertFrom-Json -InputObject $taskRace.Second.Result -AsHashtable -NoEnumerate
        $taskAll=@($taskFirstClaims)+@($taskSecondClaims)
        Assert-Condition ($taskAll.Count -eq 1 -and $taskAll[0].notificationId -eq $taskId -and (Get-Job $taskId).AttemptCount -eq 1) 'Concurrent claim duplicated ownership.'
    }
    Test-Case 'Concurrent workers claim disjoint notifications with distinct fencing tokens' {
        $taskFirstId=New-FixtureJob; $taskSecondId=New-FixtureJob; $taskOne=Open-TestConnection; $taskTwo=Open-TestConnection
        $taskP=@{BatchSize=1;LeaseSeconds=60}
        $taskRace=Invoke-QueueRace $taskOne (New-GatePassSqlCommand $taskOne $taskClaimSql $taskP) $taskTwo (New-GatePassSqlCommand $taskTwo $taskClaimSql $taskP)
        $taskFirstClaims=ConvertFrom-Json -InputObject $taskRace.First.Result -AsHashtable -NoEnumerate
        $taskSecondClaims=ConvertFrom-Json -InputObject $taskRace.Second.Result -AsHashtable -NoEnumerate
        $taskAll=@($taskFirstClaims)+@($taskSecondClaims)
        Assert-Condition ($taskRace.First.Success -and $taskRace.Second.Success -and $taskAll.Count -eq 2 -and $taskAll[0].notificationId -ne $taskAll[1].notificationId -and $taskAll[0].claimToken -ne $taskAll[1].claimToken) 'Two notifications were not claimed independently.'
    }
    Test-Case 'Expired old acknowledgement loses against a reclaim in either commit order' {
        $taskId=New-FixtureJob; $taskOld=Claim-One; Expire-FixtureLease $taskId
        $taskOne=Open-TestConnection; $taskTwo=Open-TestConnection
        $taskRace=Invoke-QueueRace $taskOne (New-GatePassSqlCommand $taskOne $taskClaimSql @{BatchSize=1;LeaseSeconds=60}) $taskTwo (New-GatePassSqlCommand $taskTwo $taskAckSql (Ack-Parameters $taskOld))
        Assert-Condition ($taskRace.First.Success -and -not $taskRace.Second.Success -and $taskRace.Second.Error -eq 52003) 'Old worker acknowledged reclaimed/expired work.'
        Assert-Condition ((Get-Job $taskId).Status -eq 'PROCESSING' -and (Get-Job $taskId).AttemptCount -eq 2) 'Recovery state was overwritten.'
    }
    Test-Case 'Conflicting concurrent acknowledgements commit exactly one outcome' {
        $taskId=New-FixtureJob; $taskClaim=Claim-One; $taskOne=Open-TestConnection; $taskTwo=Open-TestConnection
        $taskRace=Invoke-QueueRace $taskOne (New-GatePassSqlCommand $taskOne $taskAckSql (Ack-Parameters $taskClaim)) $taskTwo (New-GatePassSqlCommand $taskTwo $taskAckSql (Ack-Parameters $taskClaim 'FAILED' 'PROVIDER_TIMEOUT'))
        Assert-Condition (@($taskRace.First,$taskRace.Second | Where-Object {$_.Success}).Count -eq 1 -and @($taskRace.First,$taskRace.Second | Where-Object {$_.Error -eq 52003}).Count -eq 1) 'Two conflicting outcomes committed.'
        Assert-Condition ((Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM gp.SecurityAuditEvents WHERE ActionCode='NOTIFICATION_COMPLETED' AND TargetReference=CONVERT(varchar(100),@id);" @{id=$taskId}) -eq 1) 'Conflicting acknowledgements produced two completion audits.'
    }
    $taskHarnessComplete=$true
}
finally {
    foreach ($taskConnection in $taskConnections) { $taskConnection.Dispose() }
    try {
        Invoke-GatePassNonQuery $taskAdmin 'IF @@TRANCOUNT>0 ROLLBACK;'
        foreach ($taskId in $taskJobs) {
            Invoke-GatePassNonQuery $taskAdmin "DELETE FROM gp.SecurityAuditEvents WHERE TargetType='NOTIFICATION' AND TargetReference=CONVERT(varchar(100),@id) AND ActionCode LIKE 'NOTIFICATION[_]%';" @{id=$taskId}
        }
        if ($taskFixtureReady) { Invoke-GatePassNonQuery $taskAdmin ([IO.File]::ReadAllText((Join-Path $PSScriptRoot '003_transaction_cleanup.sql'))) @{RunId=$taskRun} }
        if ($taskCreatedApi) { Invoke-GatePassNonQuery $taskAdmin 'DROP USER gp_worker_api_fixture;' }
        if ($taskCreatedWorker) { Invoke-GatePassNonQuery $taskAdmin 'DROP USER gp_worker_fixture;' }
        foreach ($taskId in $taskJobs) {
            Assert-Condition ((Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM gp.SecurityAuditEvents WHERE TargetType='NOTIFICATION' AND TargetReference=CONVERT(varchar(100),@id);" @{id=$taskId}) -eq 0) 'Owned notification audit rows remain.'
        }
        $taskCleanupPassed=$true
    }
    finally {
        $taskAdmin.Dispose()
        $taskReport=[ordered]@{Status=if ($taskHarnessComplete -and @($taskCases | Where-Object {-not $_.Passed}).Count -eq 0 -and $taskCleanupPassed) {'PASS'} else {'FAIL'};
            CheckedAtUtc=[datetime]::UtcNow.ToString('o');Database='GatePass_DesignTest';ExecutionIdentity='Isolated users WITHOUT LOGIN in gp_worker_runtime and gp_api_runtime; admin only for synthetic fixture setup, gates and inspection';
            MigrationSha256=(Get-FileHash -LiteralPath (Join-Path $taskRoot 'database/migrations/004_notification_worker_leases.sql') -Algorithm SHA256).Hash;
            HardeningMigrationSha256=(Get-FileHash -LiteralPath (Join-Path $taskRoot 'database/migrations/005_worker_contract_hardening.sql') -Algorithm SHA256).Hash;
            HarnessSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash;
            CaseCount=$taskCases.Count;CleanupPassed=$taskCleanupPassed;ProviderCallsMade=0;Cases=@($taskCases)}
        $taskReport | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $taskRoot 'database/validation/notification-worker-report.json') -Encoding utf8
    }
}
if ($taskReport.Status -ne 'PASS') { throw 'Notification worker tests failed; inspect database/validation/notification-worker-report.json.' }
Write-Output ("All $($taskCases.Count) worker cases passed; synthetic fixtures and temporary principals removed; no messages sent.")
