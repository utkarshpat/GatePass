#Requires -Version 7.0
[CmdletBinding()]
param([string]$Server='localhost\SQLEXPRESS',[switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskAdmin=Open-GatePassLocalSql -Server $Server -TrustLocalServerCertificate:$TrustLocalServerCertificate
$taskRun=[guid]::NewGuid();$taskActors=@{};$taskVisits=@{};$taskCases=[Collections.Generic.List[object]]::new();$taskConnections=[Collections.Generic.List[object]]::new();$taskPrincipals=[Collections.Generic.List[string]]::new()
$taskReady=$false;$taskDone=$false;$taskClean=$false
function Assert($Value,[string]$Message='Unexpected print lifecycle result.') {if (-not $Value) {throw $Message}}
function Expect([scriptblock]$Action,[int]$Number=53101) {try {$null=& $Action} catch {if ($_.Exception.GetBaseException() -is [Data.SqlClient.SqlException] -and $_.Exception.GetBaseException().Number -eq $Number) {return};throw};throw "Expected SQL error $Number."}
function Auth([string]$Actor='RECEPTION') {return @{SessionHash=[Convert]::FromHexString($taskActors[$Actor].SessionHex);CsrfHash=[Convert]::FromHexString($taskActors[$Actor].CsrfHex)}}
function Call($Connection,[string]$Procedure,[hashtable]$Parameters) {$taskArgs=($Parameters.Keys | ForEach-Object {'@'+$_+'=@'+$_}) -join ',';return (Invoke-GatePassScalar $Connection ('EXEC '+$Procedure+' '+$taskArgs) $Parameters) | ConvertFrom-Json}
function Cleanup {
    if ($taskReady) {
        foreach ($taskF in @('005_print_fixture_cleanup.sql','003_transaction_cleanup.sql')) {Invoke-GatePassNonQuery $taskAdmin ([IO.File]::ReadAllText((Join-Path $PSScriptRoot $taskF))) @{RunId=$taskRun}}

    };$script:taskReady=$false
}
function Reset {
    Cleanup
    $script:taskFixture=(Invoke-GatePassScalar $taskAdmin ([IO.File]::ReadAllText((Join-Path $PSScriptRoot '002_transaction_fixtures.sql'))) @{RunId=$taskRun}) | ConvertFrom-Json
    $script:taskReady=$true;foreach ($taskA in $taskFixture.actors) {$taskActors[$taskA.Label]=$taskA};foreach ($taskV in $taskFixture.visits) {$taskVisits[$taskV.Label]=$taskV}
    Invoke-GatePassNonQuery $taskAdmin @'
INSERT gp.PassSecrets(AccessPassId,Ciphertext,Nonce,AuthenticationTag,KeyVersion)
SELECT p.AccessPassId,CRYPT_GEN_RANDOM(32),CRYPT_GEN_RANDOM(12),CRYPT_GEN_RANDOM(16),'qr.v1.fixture' FROM gp.AccessPasses p JOIN gp.VisitRequests v ON v.VisitRequestId=p.VisitRequestId WHERE v.PublicReference LIKE @prefix+'-%';
UPDATE gp.StaffRoleGrants SET RoleCode='RECEPTION' WHERE UserId IN(@wrong,@nocap,@split);
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT g.RoleGrantId,c.Code FROM gp.StaffRoleGrants g CROSS JOIN (VALUES('PASS_PRINT'),('PASS_REISSUE')) c(Code)
WHERE g.UserId IN(@reception,@admin,@guard,@wrong);
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT RoleGrantId,CASE WHEN LocationId=@location THEN 'PASS_PRINT' ELSE 'PASS_REISSUE' END FROM gp.StaffRoleGrants WHERE UserId=@split;
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT g.RoleGrantId,'VISITS_READ' FROM gp.StaffRoleGrants g WHERE UserId IN(@guard,@recon) AND NOT EXISTS(SELECT 1 FROM gp.GrantCapabilities c WHERE c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='VISITS_READ');
INSERT gp.StaffRoleGrants(UserId,RoleCode,ScopeType,LocationId,GrantedByUserId,ValidFromUtc) VALUES(@other,'RECEPTION','LOCATION',@location,@other,DATEADD(hour,-1,SYSUTCDATETIME()));
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) VALUES(SCOPE_IDENTITY(),'PASS_PRINT');
'@ @{prefix=$taskFixture.prefix;wrong=[guid]$taskActors.WRONGLOCATION.UserId;nocap=[guid]$taskActors.NOCAP.UserId;split=[guid]$taskActors.SPLIT.UserId;
        reception=[guid]$taskActors.RECEPTION.UserId;admin=[guid]$taskActors.ADMIN.UserId;guard=[guid]$taskActors.GUARD.UserId;recon=[guid]$taskActors.RECON.UserId;other=[guid]$taskActors.OTHERHOST.UserId;location=[int]$taskFixture.locationId}
}
function Case([string]$Name,[scriptblock]$Action) {try {Reset;$null=& $Action;$taskCases.Add(@{Name=$Name;Passed=$true});Write-Output "PASS: $Name"} catch {$taskCases.Add(@{Name=$Name;Passed=$false;Error=$_.Exception.Message});Write-Output "FAIL: $Name -- $($_.Exception.Message)"}}
function Print-Parameters([string]$Label='MOVEMENT',[string]$Actor='RECEPTION') {$taskP=Auth $Actor;$taskP.ClientKey=[guid]::NewGuid();$taskP.VisitRequestId=[guid]$taskVisits[$Label].VisitId;$taskP.ExpectedPassId=[guid]$taskVisits[$Label].PassId;return $taskP}
function Reissue-Parameters([string]$Label='MOVEMENT',[string]$Actor='RECEPTION') {
    $taskP=Print-Parameters $Label $Actor;$taskP.Reason='Damaged card';$taskP.NewAccessPassId=[guid]::NewGuid();$taskP.CredentialHash=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    $taskP.Ciphertext=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);$taskP.Nonce=[Security.Cryptography.RandomNumberGenerator]::GetBytes(12);$taskP.AuthenticationTag=[Security.Cryptography.RandomNumberGenerator]::GetBytes(16);$taskP.KeyVersion='qr.v1.fixture';return $taskP
}
function Request([string]$Label='MOVEMENT') {return Call $taskApi 'gp.RequestPassPrint' (Print-Parameters $Label)}
function Start-Render($Job,[guid]$Token=[guid]::NewGuid(),[string]$Actor='RECEPTION') {$taskP=Auth $Actor;$taskP.PrintJobId=[guid]$Job.printJobId;$taskP.ClaimToken=$Token;return @{Parameters=$taskP;Result=(Call $taskRender 'gp.BeginPassRender' $taskP)}}
function Finish($Claim) {$taskP=$Claim.Parameters.Clone();$taskP.ArtifactDigest=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);$null=Call $taskRender 'gp.FinishPassRender' $taskP;return $taskP}
function Live($Job,[string]$Actor='RECEPTION') {$taskP=Auth $Actor;$taskP.PrintJobId=[guid]$Job.printJobId;return Call $taskApi 'gp.GetPassPrintJob' $taskP}
function Inside([string]$Label='MOVEMENT') {
    $taskP=Auth 'GUARD';$taskP.ClientKey=[guid]::NewGuid();$taskP.VisitRequestId=[guid]$taskVisits[$Label].VisitId;$taskP.AccessPassId=[guid]$taskVisits[$Label].PassId;$taskP.LocationId=[int]$taskFixture.locationId;$taskP.SelectedProjectLocationId=[long]$taskFixture.projectLocationId;$taskP.EventType='ENTRY';$taskP.EntryMethod='MANUAL'
    return Call $taskApi 'gp.RecordMovement' $taskP
}
function Counts {return Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.AccessPasses p JOIN gp.VisitRequests v ON v.VisitRequestId=p.VisitRequestId WHERE v.PublicReference LIKE @prefix+''-%'';' @{prefix=$taskFixture.prefix}}
function Command($Connection,[string]$Procedure,[hashtable]$Parameters) {$taskArgs=($Parameters.Keys | ForEach-Object {'@'+$_+'=@'+$_}) -join ',';return New-GatePassSqlCommand $Connection ('EXEC '+$Procedure+' '+$taskArgs) $Parameters}
function Race($First,$Second,$FirstConnection=$taskApi,$SecondConnection=$taskRaceApi) {
    $taskFirstSid=[int](Invoke-GatePassScalar $FirstConnection 'SELECT @@SPID;');$taskSecondSid=[int](Invoke-GatePassScalar $SecondConnection 'SELECT @@SPID;')
    Invoke-GatePassNonQuery $taskAdmin "BEGIN TRANSACTION;DECLARE @r int;EXEC @r=sys.sp_getapplock @Resource='gp:authorization',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000,@DbPrincipal='public';IF @r<0 THROW 52900,'Race gate failed.',1;"
    try {
        $taskOne=$First.ExecuteScalarAsync();$taskTwo=$Second.ExecuteScalarAsync();$taskDeadline=[datetime]::UtcNow.AddSeconds(3);$taskWaiting=0
        do {$taskWaiting=Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM sys.dm_exec_requests WHERE session_id IN(@one,@two) AND wait_type LIKE N'LCK_M%';" @{one=$taskFirstSid;two=$taskSecondSid};if($taskWaiting -eq 2){break};[Threading.Thread]::Sleep(25)} while([datetime]::UtcNow -lt $taskDeadline)
        Assert ($taskWaiting -eq 2) 'Both contenders were not observed waiting at the SQL authorization gate.'
        Invoke-GatePassNonQuery $taskAdmin 'COMMIT;'
        $taskResults=@();foreach($taskPending in @($taskOne,$taskTwo)) {try {$taskResults+=@{Success=$true;Result=($taskPending.GetAwaiter().GetResult() | ConvertFrom-Json)}} catch {$taskResults+=@{Success=$false;Error=$_.Exception.GetBaseException().Number}}};return $taskResults
    } finally {Invoke-GatePassNonQuery $taskAdmin 'IF @@TRANCOUNT>0 ROLLBACK;';$First.Dispose();$Second.Dispose()}
}

function Cancel-Parameters([string]$Label='PENDING',[string]$Actor='HOST') {$taskP=Auth $Actor;$taskP.ClientKey=[guid]::NewGuid();$taskP.VisitRequestId=[guid]$taskVisits[$Label].VisitId;$taskP.ExpectedPassId=[guid]$taskVisits[$Label].PassId;$taskP.Reason='Plans changed';return $taskP}
function Cancel([string]$Label='PENDING',[string]$Actor='HOST') {return Call $taskApi 'gp.CancelVisit' (Cancel-Parameters $Label $Actor)}
function Detail([string]$Label='PENDING',[string]$Actor='HOST',[string]$View='HOST') {$taskP=Auth $Actor;$taskP.VisitRequestId=[guid]$taskVisits[$Label].VisitId;$taskP.View=$View;return Call $taskApi 'gp.GetVisitDetail' $taskP}
try {
    foreach ($taskSpec in @(@('gp_cancel_api_fixture','gp_api_runtime'),@('gp_cancel_render_fixture','gp_render_runtime'),@('gp_cancel_media_fixture','gp_media_runtime'),@('gp_cancel_worker_fixture','gp_worker_runtime'),@('gp_cancel_auth_fixture','gp_guard_auth_runtime'))) {
        Invoke-GatePassNonQuery $taskAdmin ('CREATE USER '+$taskSpec[0]+' WITHOUT LOGIN;ALTER ROLE '+$taskSpec[1]+' ADD MEMBER '+$taskSpec[0]+';');$taskPrincipals.Add($taskSpec[0])
        $taskC=Open-GatePassLocalSql -Server $Server -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $taskC ("EXECUTE AS USER='"+$taskSpec[0]+"';");$taskConnections.Add($taskC)
    }
    $taskApi=$taskConnections[0];$taskRender=$taskConnections[1];$taskMedia=$taskConnections[2];$taskWorker=$taskConnections[3];$taskAuth=$taskConnections[4]
    $taskRaceApi=Open-GatePassLocalSql -Server $Server -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $taskRaceApi "EXECUTE AS USER='gp_cancel_api_fixture';";$taskConnections.Add($taskRaceApi)
    Case 'Only API runtime may invoke cancellation with no direct data access' {foreach($taskC in @($taskRender,$taskMedia,$taskWorker,$taskAuth)){Expect {Call $taskC 'gp.CancelVisit' (Cancel-Parameters)} 229};Expect {Invoke-GatePassScalar $taskApi 'SELECT TOP(1) Reason FROM gp.VisitRequests;'} 229}
    Case 'Assigned host cancels pending visit and revokes its pass' {$taskR=Cancel;Assert ($taskR.status -eq 'CANCELLED' -and -not $taskR.wasInsideAtCancellation);$taskD=Detail;Assert ($taskD.status -eq 'CANCELLED' -and $taskD.passStatus -eq 'REVOKED' -and -not $taskD.canCancel -and -not $taskD.canDecide)}
    Case 'Host may cancel approved visit' {Assert ((Cancel 'MOVEMENT').status -eq 'CANCELLED')}
    Case 'Employee cancels own Digital ID without host authority' {Assert ((Cancel 'TEMP').status -eq 'CANCELLED');Assert (-not (Detail 'TEMP' 'HOST' 'OWN').canCancel)}
    Case 'Employee cancels own project request independently of its host' {Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.VisitRequests SET HostEmployeeId=@other WHERE VisitRequestId=@id;' @{other=$taskFixture.prefix+'-OTHERHOST';id=[guid]$taskVisits.EMP_DISABLED.VisitId};Assert ((Cancel 'EMP_DISABLED').status -eq 'CANCELLED')}
    Case 'Unrelated employee guard reception and admin get no cancellation bypass' {foreach($taskA in @('OTHERHOST','GUARD','RECEPTION','ADMIN')){Expect {Cancel 'PENDING' $taskA} 52001}}
    Case 'Unknown target is not enumerable' {$taskP=Cancel-Parameters;$taskP.VisitRequestId=[guid]::NewGuid();Expect {Call $taskApi 'gp.CancelVisit' $taskP} 52001}
    Case 'Bad CSRF stale blocked expired and revoked sessions fail' {foreach($taskA in @('STALE','BLOCKED','EXPIRED')){Expect {Cancel 'PENDING' $taskA} 52001};$taskP=Cancel-Parameters;$taskP.CsrfHash=[byte[]]::new(32);Expect {Call $taskApi 'gp.CancelVisit' $taskP} 52001;Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.Sessions SET RevokedAtUtc=SYSUTCDATETIME() WHERE UserId=@id;' @{id=[guid]$taskActors.HOST.UserId};Expect {Cancel} 52001}
    Case 'Cached receipt requires fresh current host directory' {$taskP=Cancel-Parameters;$null=Call $taskApi 'gp.CancelVisit' $taskP;Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.Employees SET LastSyncedAtUtc=DATEADD(day,-1,SYSUTCDATETIME()) WHERE EmployeeId=@id;' @{id=$taskFixture.hostEmployeeId};Expect {Call $taskApi 'gp.CancelVisit' $taskP} 52001}
    Case 'Removed host membership denies cancellation' {Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.EmployeeProjectMemberships SET IsActive=0 WHERE EmployeeId=@id;' @{id=$taskFixture.hostEmployeeId};Expect {Cancel} 52001}
    Case 'Current pass fence rejects action from before reissue' {$taskR=Call $taskApi 'gp.ReissuePass' (Reissue-Parameters);Expect {Cancel 'MOVEMENT'} 52003;$taskP=Cancel-Parameters 'MOVEMENT';$taskP.ExpectedPassId=[guid]$taskR.accessPassId;Assert ((Call $taskApi 'gp.CancelVisit' $taskP).status -eq 'CANCELLED')}
    Case 'Null empty and overlong reasons never truncate silently' {foreach($taskReason in @($null,'','   ',('x'*301),(([char]0x0939).ToString()*301))){$taskP=Cancel-Parameters;$taskP.Reason=$taskReason;Expect {Call $taskApi 'gp.CancelVisit' $taskP} 52002}}
    Case 'Same key replay has one result and one success audit' {$taskP=Cancel-Parameters;$taskR=Call $taskApi 'gp.CancelVisit' $taskP;Assert ($taskR.operationId -eq (Call $taskApi 'gp.CancelVisit' $taskP).operationId);Assert ((Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM gp.SecurityAuditEvents WHERE TargetReference=@visit AND ActionCode='VISIT_CANCELLED';" @{visit=$taskP.VisitRequestId.ToString()}) -eq 1)}
    Case 'Changed reason conflicts with reused idempotency key' {$taskP=Cancel-Parameters;$null=Call $taskApi 'gp.CancelVisit' $taskP;$taskP.Reason='Different';Expect {Call $taskApi 'gp.CancelVisit' $taskP} 52003}
    Case 'Different key cannot recancel a cancelled visit' {$null=Cancel;Expect {Cancel} 52005}
    Case 'Denied visit is not rewritten as cancelled' {$taskP=Auth HOST;$taskP.ClientKey=[guid]::NewGuid();$taskP.VisitRequestId=[guid]$taskVisits.PENDING.VisitId;$taskP.SnapshotVersion=1;$taskP.SnapshotHash=[Convert]::FromHexString($taskVisits.PENDING.SnapshotHex);$taskP.Decision='DENIED';$null=Call $taskApi 'gp.DecideVisit' $taskP;Expect {Cancel} 52005}
    Case 'Other individual in same intake remains pending' {$null=Cancel;Assert ((Detail 'GROUP_OTHER').status -eq 'PENDING')}
    Case 'Cancellation invalidates pending render claim' {$taskJ=Request 'PENDING';$taskC=Start-Render $taskJ;$null=Cancel;Assert ((Live $taskJ).status -eq 'FAILED');Expect {Finish $taskC} 53105}
    Case 'Rendered artifact cannot dispatch after cancellation' {$taskJ=Request;$taskC=Start-Render $taskJ;$taskP=Finish $taskC;$null=Cancel 'MOVEMENT';Expect {Call $taskRender 'gp.DispatchPassPrint' $taskP} 53105}
    Case 'Dispatched history remains while reprint and reissue stop' {$taskJ=Request;$taskC=Start-Render $taskJ;$taskP=Finish $taskC;$null=Call $taskRender 'gp.DispatchPassPrint' $taskP;$null=Cancel 'MOVEMENT';Assert ((Live $taskJ).status -eq 'DISPATCHED');Expect {Request} 53105;Expect {Call $taskApi 'gp.ReissuePass' (Reissue-Parameters)} 53105}
    Case 'Revoked delivery links and cancelled claimed notifications fence old worker' {
        $taskClaim=[guid]::NewGuid()
        Invoke-GatePassNonQuery $taskAdmin @'
INSERT gp.PassDeliveryLinks(AccessPassId,VisitRequestId,TokenHash,TokenCiphertext,Nonce,AuthenticationTag,KeyVersion,RecipientEmail,ExpiresAtUtc)
VALUES(@pass,@visit,CRYPT_GEN_RANDOM(32),CRYPT_GEN_RANDOM(32),CRYPT_GEN_RANDOM(12),CRYPT_GEN_RANDOM(16),'fixture',N'test@example.invalid',DATEADD(hour,1,SYSUTCDATETIME()));
INSERT gp.NotificationOutbox(VisitRequestId,RecipientKind,RecipientEmail,TemplateCode,PayloadJson,DedupeHash,Status,LockedBy,LockedUntilUtc) VALUES(@visit,'EMAIL',N'test@example.invalid','VISIT_DECIDED',N'{}',CRYPT_GEN_RANDOM(32),'PROCESSING',@claim,DATEADD(minute,1,SYSUTCDATETIME()));
'@ @{pass=[guid]$taskVisits.PENDING.PassId;visit=[guid]$taskVisits.PENDING.VisitId;claim=$taskClaim}
        # A fixture-owned claim must never drain another presentation request from the global queue.
        $taskNotification=[long](Invoke-GatePassScalar $taskAdmin 'SELECT NotificationId FROM gp.NotificationOutbox WHERE VisitRequestId=@visit AND LockedBy=@claim;' @{visit=[guid]$taskVisits.PENDING.VisitId;claim=$taskClaim});$null=Cancel
        Assert ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.PassDeliveryLinks WHERE VisitRequestId=@visit AND RevokedAtUtc IS NULL;' @{visit=[guid]$taskVisits.PENDING.VisitId}) -eq 0)
        Expect {Call $taskWorker 'gp.GetNotificationDispatch' @{NotificationId=$taskNotification;ClaimToken=$taskClaim}} 52003
    }
    Case 'Inside presence persists until explicit authorized reconciled exit' {
        $taskEntry=Inside;Assert ((Cancel 'MOVEMENT').wasInsideAtCancellation)
        $taskD=Detail 'MOVEMENT' 'RECON' 'GUARD';Assert ($taskD.isInside -and $taskD.canReconcileExit -and -not $taskD.canEnter -and -not $taskD.canExit)
        $taskP=Auth RECON;$taskP.ClientKey=[guid]::NewGuid();$taskP.VisitRequestId=[guid]$taskVisits.MOVEMENT.VisitId;$taskP.AccessPassId=[guid]$taskVisits.MOVEMENT.PassId;$taskP.LocationId=[int]$taskFixture.locationId;$taskP.SelectedProjectLocationId=$null;$taskP.EventType='EXIT';$taskP.EntryMethod='RECONCILE';$taskP.ReconciliationReason='Actual departure confirmed';Assert (-not (Call $taskApi 'gp.RecordMovement' $taskP).isInside)
        Assert ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.AccessEvents WHERE VisitRequestId=@id;' @{id=[guid]$taskVisits.MOVEMENT.VisitId}) -eq 2)
    }
    Case 'Cancelled card cannot enter and scan shows revoked without enabling entry' {$null=Cancel 'MOVEMENT';Expect {Inside} 52005;$taskP=Auth GUARD;$taskP.LocationId=[int]$taskFixture.locationId;$taskP.CredentialHash=[Convert]::FromHexString($taskVisits.MOVEMENT.CredentialHex);$taskP.CorrelationId=[guid]::NewGuid();$taskR=Call $taskApi 'gp.VerifyGuardPass' $taskP;Assert ($taskR.outcome -eq 'REVOKED' -and -not $taskR.visit.canEnter)}
    Case 'Audit failure rolls back cancellation revocation and print invalidation' {
        $taskJ=Request 'PENDING';Invoke-GatePassNonQuery $taskAdmin "CREATE TRIGGER gp.CancellationFixtureFault ON gp.SecurityAuditEvents AFTER INSERT AS IF EXISTS(SELECT 1 FROM inserted WHERE ActionCode='VISIT_CANCELLED') THROW 52977,'Synthetic cancellation audit failure.',1;"
        try {Expect {Cancel} 52977;Assert ((Detail).status -eq 'PENDING' -and (Live $taskJ).status -eq 'REQUESTED')} finally {Invoke-GatePassNonQuery $taskAdmin 'DROP TRIGGER gp.CancellationFixtureFault;'}
    }
    Case 'Authorization version change blocks cached replay' {$taskP=Cancel-Parameters;$null=Call $taskApi 'gp.CancelVisit' $taskP;Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.Users SET AuthorizationVersion=AuthorizationVersion+1 WHERE UserId=@id;' @{id=[guid]$taskActors.HOST.UserId};Expect {Call $taskApi 'gp.CancelVisit' $taskP} 52001}
    Case 'Concurrent same-key cancellations commit once with same receipt' {$taskP=Cancel-Parameters;$taskR=Race (Command $taskApi 'gp.CancelVisit' $taskP) (Command $taskRaceApi 'gp.CancelVisit' $taskP);Assert (@($taskR | Where-Object Success).Count -eq 2 -and $taskR[0].Result.operationId -eq $taskR[1].Result.operationId)}
    Case 'Concurrent different keys cannot cancel twice' {$taskR=Race (Command $taskApi 'gp.CancelVisit' (Cancel-Parameters)) (Command $taskRaceApi 'gp.CancelVisit' (Cancel-Parameters));Assert (@($taskR | Where-Object Success).Count -eq 1 -and @($taskR | Where-Object {-not $_.Success -and $_.Error -eq 52005}).Count -eq 1)}
    Case 'Concurrent approval and cancellation never retain a live pass' {
        $taskP=Auth HOST;$taskP.ClientKey=[guid]::NewGuid();$taskP.VisitRequestId=[guid]$taskVisits.PENDING.VisitId;$taskP.SnapshotVersion=1;$taskP.SnapshotHash=[Convert]::FromHexString($taskVisits.PENDING.SnapshotHex);$taskP.Decision='APPROVED'
        $taskR=Race (Command $taskApi 'gp.CancelVisit' (Cancel-Parameters)) (Command $taskRaceApi 'gp.DecideVisit' $taskP);Assert ($taskR[0].Success -and (Detail).passStatus -eq 'REVOKED' -and (Detail).status -eq 'CANCELLED');if(-not $taskR[1].Success){Assert ($taskR[1].Error -eq 52005)}
    }
    Case 'Concurrent entry and cancellation preserve actual committed presence' {
        $taskP=Auth GUARD;$taskP.ClientKey=[guid]::NewGuid();$taskP.VisitRequestId=[guid]$taskVisits.MOVEMENT.VisitId;$taskP.AccessPassId=[guid]$taskVisits.MOVEMENT.PassId;$taskP.LocationId=[int]$taskFixture.locationId;$taskP.SelectedProjectLocationId=[long]$taskFixture.projectLocationId;$taskP.EventType='ENTRY';$taskP.EntryMethod='MANUAL'
        $taskR=Race (Command $taskApi 'gp.CancelVisit' (Cancel-Parameters 'MOVEMENT')) (Command $taskRaceApi 'gp.RecordMovement' $taskP);Assert ($taskR[0].Success);$taskInside=Invoke-GatePassScalar $taskAdmin 'SELECT IsInside FROM gp.VisitPresence WHERE VisitRequestId=@id;' @{id=[guid]$taskVisits.MOVEMENT.VisitId};Assert ($taskInside -eq [bool]$taskR[1].Success);if(-not $taskR[1].Success){Assert ($taskR[1].Error -eq 52005)}
    }
    Case 'Actual internal service typed SQL and protected read integration' {
        $taskRaw=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);$taskCsrf=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
        $taskOther=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);$taskOtherCsrf=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
        Invoke-GatePassNonQuery $taskAdmin @'
DECLARE @now datetime2(3)=SYSUTCDATETIME();
INSERT gp.Sessions(SessionHash,UserId,CsrfHash,AuthorizationVersionAtIssue,LastSeenAtUtc,IdleExpiresAtUtc,AbsoluteExpiresAtUtc,CreatedAtUtc)
SELECT @session,UserId,@csrf,AuthorizationVersion,@now,DATEADD(hour,1,@now),DATEADD(hour,2,@now),@now FROM gp.Users WHERE UserId=@actor;
INSERT gp.Sessions(SessionHash,UserId,CsrfHash,AuthorizationVersionAtIssue,LastSeenAtUtc,IdleExpiresAtUtc,AbsoluteExpiresAtUtc,CreatedAtUtc)
SELECT @otherSession,UserId,@otherCsrf,AuthorizationVersion,@now,DATEADD(hour,1,@now),DATEADD(hour,2,@now),@now FROM gp.Users WHERE UserId=@other;
'@ @{session=[Security.Cryptography.SHA256]::HashData($taskRaw);csrf=[Security.Cryptography.SHA256]::HashData($taskCsrf);actor=[guid]$taskActors.HOST.UserId;otherSession=[Security.Cryptography.SHA256]::HashData($taskOther);otherCsrf=[Security.Cryptography.SHA256]::HashData($taskOtherCsrf);other=[guid]$taskActors.OTHERHOST.UserId}
        function Token([byte[]]$Value){return [Convert]::ToBase64String($Value).TrimEnd('=').Replace('+','-').Replace('/','_')}
        $taskInfo=[Diagnostics.ProcessStartInfo]::new();$taskInfo.FileName=(Get-Command node -CommandType Application | Select-Object -First 1).Source;$taskInfo.ArgumentList.Add((Join-Path $taskRoot 'tests/visit-cancellation.sql-integration.ts'));$taskInfo.WorkingDirectory=$taskRoot;$taskInfo.UseShellExecute=$false;$taskInfo.CreateNoWindow=$true
        $taskInfo.RedirectStandardInput=$true;$taskInfo.RedirectStandardOutput=$true;$taskInfo.RedirectStandardError=$true;$taskNode=[Diagnostics.Process]::new();$taskNode.StartInfo=$taskInfo
        try {
            $null=$taskNode.Start();$taskOut=$taskNode.StandardOutput.ReadToEndAsync();$taskErr=$taskNode.StandardError.ReadToEndAsync()
            $taskNode.StandardInput.Write((@{server=$Server;trustLocalCertificate=[bool]$TrustLocalServerCertificate;powerShell=(Join-Path $PSHOME 'pwsh.exe');sessionToken=(Token $taskRaw);csrfToken=(Token $taskCsrf);otherSessionToken=(Token $taskOther);otherCsrfToken=(Token $taskOtherCsrf);visitRequestId=$taskVisits.PENDING.VisitId;accessPassId=$taskVisits.PENDING.PassId;digitalVisitRequestId=$taskVisits.TEMP.VisitId;digitalAccessPassId=$taskVisits.TEMP.PassId;otherVisitRequestId=$taskVisits.GROUP_OTHER.VisitId;otherAccessPassId=$taskVisits.GROUP_OTHER.PassId} | ConvertTo-Json -Compress));$taskNode.StandardInput.Close()
            if(-not $taskNode.WaitForExit(45000)){$taskNode.Kill($true);$taskNode.WaitForExit();throw 'Cancellation backend integration timed out.'}
            if($taskNode.ExitCode -ne 0){throw ('Cancellation backend integration failed: '+$taskErr.GetAwaiter().GetResult())}
            $taskIntegration=$taskOut.GetAwaiter().GetResult() | ConvertFrom-Json;Assert ($taskIntegration.Status -eq 'PASS' -and $taskIntegration.CaseCount -eq 5)
            $taskIntegration | Add-Member -NotePropertyName CheckedAtUtc -NotePropertyValue ([datetime]::UtcNow.ToString('o'))
            $taskIntegration | Add-Member -NotePropertyName SourceSha256 -NotePropertyValue @(@('database/migrations/015_individual_cancellation.sql','src/visits/VisitCancellationService.ts','src/visits/VisitReadService.ts','src/visits/SqlVisitReadRepository.ts','tests/visit-cancellation.sql-integration.ts','tests/helpers/VisitCancellation.SqlBridge.ps1') | ForEach-Object {@{File=$_;Sha256=(Get-FileHash -LiteralPath (Join-Path $taskRoot $_) -Algorithm SHA256).Hash}})
            $taskIntegration | ConvertTo-Json -Depth 7 | Set-Content (Join-Path $taskRoot 'database/validation/visit-cancellation-backend-integration.json') -Encoding utf8
        } finally {$taskNode.Dispose();foreach($taskBytes in @($taskRaw,$taskCsrf,$taskOther,$taskOtherCsrf)){[Array]::Clear($taskBytes,0,$taskBytes.Length)}}
    }
    $taskDone=$true
}
finally {
    foreach($taskC in $taskConnections){$taskC.Dispose()}
    try {Invoke-GatePassNonQuery $taskAdmin "IF OBJECT_ID('gp.CancellationFixtureFault','TR') IS NOT NULL DROP TRIGGER gp.CancellationFixtureFault;";Cleanup;foreach($taskU in $taskPrincipals){Invoke-GatePassNonQuery $taskAdmin ('DROP USER '+$taskU+';')};$taskClean=$true}
    finally {$taskAdmin.Dispose();[ordered]@{Status=if($taskDone -and $taskClean -and @($taskCases | Where-Object {-not $_.Passed}).Count -eq 0){'PASS'}else{'FAIL'};CheckedAtUtc=[datetime]::UtcNow.ToString('o');CaseCount=$taskCases.Count;CleanupPassed=$taskClean;ConcurrentCasesWithBothWaitersObserved=4;PhysicalPrinterTesting='Deferred to final acceptance';SourceSha256=@(@('database/migrations/015_individual_cancellation.sql','database/tests/Test-VisitCancellation.ps1','database/tests/002_transaction_fixtures.sql','database/tests/003_transaction_cleanup.sql','database/tests/005_print_fixture_cleanup.sql') | ForEach-Object {@{File=$_;Sha256=(Get-FileHash -LiteralPath (Join-Path $taskRoot $_) -Algorithm SHA256).Hash}});Cases=@($taskCases)} | ConvertTo-Json -Depth 7 | Set-Content (Join-Path $taskRoot 'database/validation/visit-cancellation-report.json') -Encoding utf8}
}
if(-not $taskDone -or @($taskCases | Where-Object {-not $_.Passed}).Count){throw 'Cancellation suite failed.'}
Write-Output "All $($taskCases.Count) cancellation cases passed; owned fixture cleaned."
