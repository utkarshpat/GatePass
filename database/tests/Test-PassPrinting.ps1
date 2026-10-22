#Requires -Version 7.0
[CmdletBinding()]
param([string]$Server='localhost\SQLEXPRESS',[switch]$TrustLocalServerCertificate,[string]$TestPython=$env:GATEPASS_TEST_PYTHON)
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
        Invoke-GatePassNonQuery $taskAdmin 'DELETE pl FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId WHERE p.ExternalProjectCode IN(@prefix+''-C'',@prefix+''-D'') AND p.ProjectName IN(N''Synthetic Gamma'',N''Synthetic Delta'');DELETE FROM gp.Projects WHERE ExternalProjectCode IN(@prefix+''-C'',@prefix+''-D'') AND ProjectName IN(N''Synthetic Gamma'',N''Synthetic Delta'');' @{prefix=$taskFixture.prefix}
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
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT g.RoleGrantId,'VISITS_READ' FROM gp.StaffRoleGrants g WHERE UserId=@guard AND NOT EXISTS(SELECT 1 FROM gp.GrantCapabilities c WHERE c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='VISITS_READ');
INSERT gp.StaffRoleGrants(UserId,RoleCode,ScopeType,LocationId,GrantedByUserId,ValidFromUtc) VALUES(@other,'RECEPTION','LOCATION',@location,@other,DATEADD(hour,-1,SYSUTCDATETIME()));
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) VALUES(SCOPE_IDENTITY(),'PASS_PRINT');
'@ @{prefix=$taskFixture.prefix;wrong=[guid]$taskActors.WRONGLOCATION.UserId;nocap=[guid]$taskActors.NOCAP.UserId;split=[guid]$taskActors.SPLIT.UserId;
        reception=[guid]$taskActors.RECEPTION.UserId;admin=[guid]$taskActors.ADMIN.UserId;guard=[guid]$taskActors.GUARD.UserId;other=[guid]$taskActors.OTHERHOST.UserId;location=[int]$taskFixture.locationId}
}
function Case([string]$Name,[scriptblock]$Action) {try {Reset;$null=& $Action;$taskCases.Add(@{Name=$Name;Passed=$true});Write-Output "PASS: $Name"} catch {$taskCases.Add(@{Name=$Name;Passed=$false;Error=$_.Exception.Message});Write-Output "FAIL: $Name -- $($_.Exception.Message)"}}
function Print-Parameters([string]$Label='MOVEMENT',[string]$Actor='RECEPTION') {$taskP=Auth $Actor;$taskP.ClientKey=[guid]::NewGuid();$taskP.VisitRequestId=[guid]$taskVisits[$Label].VisitId;$taskP.ExpectedPassId=[guid]$taskVisits[$Label].PassId;return $taskP}
function Reissue-Parameters([string]$Label='MOVEMENT',[string]$Actor='RECEPTION') {
    $taskP=Print-Parameters $Label $Actor;$taskP.Reason='Damaged card';$taskP.NewAccessPassId=[guid]::NewGuid();$taskP.CredentialHash=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    $taskP.Ciphertext=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);$taskP.Nonce=[Security.Cryptography.RandomNumberGenerator]::GetBytes(12);$taskP.AuthenticationTag=[Security.Cryptography.RandomNumberGenerator]::GetBytes(16);$taskP.KeyVersion='qr.v1.k_fixture-key';return $taskP
}
function Request([string]$Label='MOVEMENT') {return Call $taskApi 'gp.RequestPassPrint' (Print-Parameters $Label)}
function Claim-OwnedReplacementNotification([guid]$Visit) {
    $taskClaim=[guid]::NewGuid()
    $taskId=Invoke-GatePassScalar $taskAdmin @'
DECLARE @id bigint=(SELECT NotificationId FROM gp.NotificationOutbox WHERE VisitRequestId=@visit AND TemplateCode='PASS_REISSUED' AND Status='PENDING');
IF @id IS NULL OR NOT EXISTS(SELECT 1 FROM gp.VisitRequests WHERE VisitRequestId=@visit AND PublicReference LIKE @prefix+'-%') THROW 52900,'Owned replacement notification required.',1;
UPDATE gp.NotificationOutbox SET Status='PROCESSING',AttemptCount=AttemptCount+1,LockedBy=@claim,LockedUntilUtc=DATEADD(minute,1,SYSUTCDATETIME()) WHERE NotificationId=@id;
SELECT @id;
'@ @{visit=$Visit;prefix=$taskFixture.prefix;claim=$taskClaim}
    return @{notificationId=[long]$taskId;claimToken=$taskClaim}
}
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
try {
    foreach ($taskSpec in @(@('gp_print_api_fixture','gp_api_runtime'),@('gp_print_render_fixture','gp_render_runtime'),@('gp_print_media_fixture','gp_media_runtime'),@('gp_print_worker_fixture','gp_worker_runtime'),@('gp_print_auth_fixture','gp_guard_auth_runtime'))) {
        Invoke-GatePassNonQuery $taskAdmin ('CREATE USER '+$taskSpec[0]+' WITHOUT LOGIN;ALTER ROLE '+$taskSpec[1]+' ADD MEMBER '+$taskSpec[0]+';');$taskPrincipals.Add($taskSpec[0])
        $taskC=Open-GatePassLocalSql -Server $Server -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $taskC ("EXECUTE AS USER='"+$taskSpec[0]+"';");$taskConnections.Add($taskC)
    }
    $taskApi=$taskConnections[0];$taskRender=$taskConnections[1];$taskMedia=$taskConnections[2];$taskWorker=$taskConnections[3];$taskAuth=$taskConnections[4]
    $taskRaceApi=Open-GatePassLocalSql -Server $Server -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $taskRaceApi "EXECUTE AS USER='gp_print_api_fixture';";$taskConnections.Add($taskRaceApi)
    Case 'API media worker and auth cannot recover render credential material' {$taskJ=Request;$taskP=Auth;$taskP.PrintJobId=[guid]$taskJ.printJobId;$taskP.ClaimToken=[guid]::NewGuid();foreach ($taskC in @($taskApi,$taskMedia,$taskWorker,$taskAuth)) {Expect {Call $taskC 'gp.BeginPassRender' $taskP} 229}}
    Case 'Renderer has no direct table or replacement authority' {Expect {Invoke-GatePassScalar $taskRender 'SELECT TOP(1) Ciphertext FROM gp.PassSecrets;'} 229;Expect {Call $taskRender 'gp.ReissuePass' (Reissue-Parameters)} 229}
    Case 'Non-reception roles and wrong offices cannot print or reissue' {foreach ($taskA in @('GUARD','ADMIN','WRONGLOCATION','NOCAP')) {Expect {Call $taskApi 'gp.RequestPassPrint' (Print-Parameters -Actor $taskA)};Expect {Call $taskApi 'gp.ReissuePass' (Reissue-Parameters -Actor $taskA)}}}
    Case 'Replacement cannot combine print and reissue grants across offices' {Expect {Call $taskApi 'gp.ReissuePass' (Reissue-Parameters -Actor SPLIT)}}
    Case 'Stale blocked expired and invalid-CSRF sessions cannot print' {foreach ($taskA in @('STALE','BLOCKED','EXPIRED')) {Expect {Call $taskApi 'gp.RequestPassPrint' (Print-Parameters -Actor $taskA)} 52001};$taskP=Print-Parameters;$taskP.CsrfHash=[byte[]]::new(32);Expect {Call $taskApi 'gp.RequestPassPrint' $taskP} 52001}
    Case 'Key-free reissue preflight makes no mutation or idempotency receipt' {$taskP=Reissue-Parameters;foreach ($taskK in @('NewAccessPassId','CredentialHash','Ciphertext','Nonce','AuthenticationTag','KeyVersion')) {$taskP.Remove($taskK)};$taskR=Call $taskApi 'gp.ReissuePass' $taskP;Assert ($taskR.status -eq 'NEEDS_CREDENTIALS' -and (Counts) -eq 25);Assert ((Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM gp.IdempotencyRequests WHERE OperationCode='REISSUE_PASS';") -eq 0)}
    Case 'Reissue creates one incremented pass and revokes its predecessor' {$taskP=Reissue-Parameters;$taskR=Call $taskApi 'gp.ReissuePass' $taskP;Assert ($taskR.passVersion -eq 2 -and (Counts) -eq 26);Assert ((Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM gp.AccessPasses WHERE AccessPassId=@id AND Status='REVOKED' AND IsCurrent=0;" @{id=$taskP.ExpectedPassId}) -eq 1)}
    Case 'Reissue preserves approval validity snapshot daily slot and existing inside presence' {$null=Inside;$taskP=Reissue-Parameters;$taskBefore=Invoke-GatePassScalar $taskAdmin 'SELECT (SELECT Status,ValidFromUtc,ValidUntilUtc,SnapshotVersion,CONVERT(varchar(64),SnapshotHash,2) hash FROM gp.VisitRequests WHERE VisitRequestId=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);' @{id=$taskP.VisitRequestId};$null=Call $taskApi 'gp.ReissuePass' $taskP;Assert ((Invoke-GatePassScalar $taskAdmin 'SELECT (SELECT Status,ValidFromUtc,ValidUntilUtc,SnapshotVersion,CONVERT(varchar(64),SnapshotHash,2) hash FROM gp.VisitRequests WHERE VisitRequestId=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);' @{id=$taskP.VisitRequestId}) -eq $taskBefore);Assert ((Invoke-GatePassScalar $taskAdmin 'SELECT IsInside FROM gp.VisitPresence WHERE VisitRequestId=@id;' @{id=$taskP.VisitRequestId}) -eq 1)}
    Case 'Pending reissue remains pending and cannot create approval' {$taskP=Reissue-Parameters 'PENDING';$null=Call $taskApi 'gp.ReissuePass' $taskP;Assert ((Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM gp.AccessPasses WHERE AccessPassId=@id AND Status='PENDING';" @{id=$taskP.NewAccessPassId}) -eq 1);Assert ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.ApprovalDecisions WHERE VisitRequestId=@id;' @{id=$taskP.VisitRequestId}) -eq 0)}
    Case 'A revoked current Digital ID can be explicitly replaced without a new daily visit' {$taskP=Reissue-Parameters 'TEMP';Invoke-GatePassNonQuery $taskAdmin "UPDATE gp.AccessPasses SET Status='REVOKED',RevokedAtUtc=SYSUTCDATETIME(),RevocationReason=N'test' WHERE AccessPassId=@id;" @{id=$taskP.ExpectedPassId};Assert ((Call $taskApi 'gp.ReissuePass' $taskP).passVersion -eq 2)}
    Case 'A changed expected pass cannot silently replace a newer credential' {$taskP=Reissue-Parameters;$null=Call $taskApi 'gp.ReissuePass' $taskP;$taskP.ClientKey=[guid]::NewGuid();$taskP.NewAccessPassId=[guid]::NewGuid();Expect {Call $taskApi 'gp.ReissuePass' $taskP} 53103}
    Case 'Committed reissue retry returns its receipt without fresh keys or envelopes' {$taskP=Reissue-Parameters;$taskR=Call $taskApi 'gp.ReissuePass' $taskP;foreach ($taskK in @('NewAccessPassId','CredentialHash','Ciphertext','Nonce','AuthenticationTag','KeyVersion')) {$taskP.Remove($taskK)};Assert ((Call $taskApi 'gp.ReissuePass' $taskP).accessPassId -eq $taskR.accessPassId -and (Counts) -eq 26)}
    Case 'Changed reissue reason on a reused operation key conflicts' {$taskP=Reissue-Parameters;$null=Call $taskApi 'gp.ReissuePass' $taskP;$taskP.Reason='Changed';Expect {Call $taskApi 'gp.ReissuePass' $taskP} 52003}
    Case 'Replacement receipt is reauthorized after current permission revocation' {$taskP=Reissue-Parameters;$null=Call $taskApi 'gp.ReissuePass' $taskP;Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.StaffRoleGrants SET RevokedAtUtc=SYSUTCDATETIME(),RevokedByUserId=@actor WHERE UserId=@actor;' @{actor=[guid]$taskActors.RECEPTION.UserId};Expect {Call $taskApi 'gp.ReissuePass' $taskP}}
    Case 'Expired visits purged photos inactive projects and stale employees cannot be reissued' {Expect {Call $taskApi 'gp.ReissuePass' (Reissue-Parameters 'EXIT_EXPIRED')} 53105;Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.PhotoAssets SET StorageKey=NULL,PurgedAtUtc=SYSUTCDATETIME() WHERE PhotoAssetId=@id;' @{id=[guid]$taskVisits.MOVEMENT.PhotoId};Expect {Call $taskApi 'gp.ReissuePass' (Reissue-Parameters)} 53105;Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.Employees SET IsActive=0 WHERE EmployeeId=@id;' @{id=$taskFixture.hostEmployeeId};Expect {Call $taskApi 'gp.ReissuePass' (Reissue-Parameters 'TEMP')} 53105}
    Case 'Malformed replacement envelopes and overlong reasons fail without partial revocation' {$taskP=Reissue-Parameters;$taskP.Nonce=[byte[]]::new(11);Expect {Call $taskApi 'gp.ReissuePass' $taskP} 53102;$taskP=Reissue-Parameters;$taskP.Reason='x'*301;Expect {Call $taskApi 'gp.ReissuePass' $taskP} 53102;Assert ((Counts) -eq 25)}
    Case 'First print derives its reason and retry returns one job without rotating QR' {$taskP=Print-Parameters;$taskJ=Call $taskApi 'gp.RequestPassPrint' $taskP;Assert ($taskJ.printReason -eq 'FIRST');Assert ((Call $taskApi 'gp.RequestPassPrint' $taskP).printJobId -eq $taskJ.printJobId -and (Counts) -eq 25)}
    Case 'Different request keys cannot create parallel active print jobs' {$taskJ=Request;Expect {Request} 53103}
    Case 'Pending render supplies the same protected identity QR without granting project entry' {$taskJ=Request 'PENDING';$taskC=Start-Render $taskJ;Assert ($taskC.Result.visitStatus -eq 'PENDING');foreach ($taskK in @('credentialHash','ciphertext','nonce','authenticationTag','keyVersion')) {Assert ($taskC.Result.PSObject.Properties[$taskK])}}
    Case 'Approved render material is available only for its owned current job' {$taskJ=Request;$taskC=Start-Render $taskJ;Assert ($taskC.Result.visitStatus -eq 'APPROVED' -and $taskC.Result.ciphertext.Length -eq 64);Expect {Start-Render $taskJ -Actor OTHERHOST}}
    Case 'Live API job status omits claim digest paths and encrypted material' {$taskJ=Request;$taskC=Start-Render $taskJ;$taskText=(Live $taskJ) | ConvertTo-Json;Assert ($taskText -notmatch 'claimToken|ciphertext|storageKey|artifactDigest|sourceSnapshot');Expect {Live $taskJ OTHERHOST}}
    Case 'Another renderer claim cannot steal an unexpired lease' {$taskJ=Request;$taskC=Start-Render $taskJ;Expect {Start-Render $taskJ} 53103}
    Case 'Same live render claim retries without consuming another attempt' {$taskJ=Request;$taskToken=[guid]::NewGuid();$taskC=Start-Render $taskJ $taskToken;$taskC=Start-Render $taskJ $taskToken;Assert ((Invoke-GatePassScalar $taskAdmin 'SELECT AttemptCount FROM gp.PassPrintRenderState WHERE PrintJobId=@id;' @{id=[guid]$taskJ.printJobId}) -eq 1)}
    Case 'Expired claim cannot revive itself and a new claim fences old completion' {$taskJ=Request;$taskC=Start-Render $taskJ;Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.PassPrintRenderState SET LeaseUntilUtc=DATEADD(second,-1,SYSUTCDATETIME()) WHERE PrintJobId=@id;' @{id=[guid]$taskJ.printJobId};Expect {Start-Render $taskJ $taskC.Parameters.ClaimToken} 53103;$taskNew=Start-Render $taskJ;Expect {Finish $taskC} 53103;$null=Finish $taskNew}
    Case 'Three abandoned render attempts exhaust without disclosing another envelope' {$taskJ=Request;foreach ($taskIndex in 1..3) {$taskC=Start-Render $taskJ;Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.PassPrintRenderState SET LeaseUntilUtc=DATEADD(second,-1,SYSUTCDATETIME()) WHERE PrintJobId=@id;' @{id=[guid]$taskJ.printJobId}};Assert ((Start-Render $taskJ).Result.status -eq 'FAILED');Assert ((Live $taskJ).failureCode -eq 'ATTEMPTS_EXHAUSTED')}
    Case 'Digest mismatch cannot dispatch and successful handoff is one-shot' {$taskJ=Request;$taskC=Start-Render $taskJ;$taskP=Finish $taskC;$taskWrong=$taskP.Clone();$taskWrong.ArtifactDigest=[byte[]]::new(32);Expect {Call $taskRender 'gp.DispatchPassPrint' $taskWrong} 53103;Assert ((Call $taskRender 'gp.DispatchPassPrint' $taskP).firstDispatch);Assert (-not (Call $taskRender 'gp.DispatchPassPrint' $taskP).firstDispatch);Assert ((Live $taskJ).status -eq 'DISPATCHED')}
    Case 'Explicit reprint after handoff keeps the same pass and credential' {$taskJ=Request;$taskC=Start-Render $taskJ;$taskP=Finish $taskC;$null=Call $taskRender 'gp.DispatchPassPrint' $taskP;$taskReprint=Request;Assert ($taskReprint.printReason -eq 'REPRINT' -and $taskReprint.accessPassId -eq $taskJ.accessPassId -and (Counts) -eq 25)}
    Case 'Print following a replacement is labelled REISSUE' {$taskP=Reissue-Parameters;$taskR=Call $taskApi 'gp.ReissuePass' $taskP;$taskRequest=Print-Parameters;$taskRequest.ExpectedPassId=[guid]$taskR.accessPassId;Assert ((Call $taskApi 'gp.RequestPassPrint' $taskRequest).printReason -eq 'REISSUE')}
    Case 'Host approval during pending render requires fresh content' {$taskJ=Request 'PENDING';$taskC=Start-Render $taskJ;$taskP=Auth HOST;$taskP.ClientKey=[guid]::NewGuid();$taskP.VisitRequestId=[guid]$taskVisits.PENDING.VisitId;$taskP.SnapshotVersion=1;$taskP.SnapshotHash=[Convert]::FromHexString($taskVisits.PENDING.SnapshotHex);$taskP.Decision='APPROVED';$null=Call $taskApi 'gp.DecideVisit' $taskP;Expect {Finish $taskC} 53103}
    Case 'Reissue invalidates requested and rendered jobs before old content handoff' {$taskJ=Request;$taskC=Start-Render $taskJ;$taskP=Finish $taskC;$null=Call $taskApi 'gp.ReissuePass' (Reissue-Parameters);Assert ((Live $taskJ).status -eq 'FAILED');Expect {Call $taskRender 'gp.DispatchPassPrint' $taskP} 53105}
    Case 'Permission loss during render prevents completion and handoff' {$taskJ=Request;$taskC=Start-Render $taskJ;Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.Users SET AuthorizationVersion=AuthorizationVersion+1 WHERE UserId=@id;' @{id=[guid]$taskActors.RECEPTION.UserId};Expect {Finish $taskC} 52001}
    Case 'Controlled render failure ends the claim and permits an explicit reprint' {$taskJ=Request;$taskC=Start-Render $taskJ;$taskP=$taskC.Parameters.Clone();$taskP.FailureCode='KEY_UNAVAILABLE';$null=Call $taskRender 'gp.FailPassPrint' $taskP;Assert ((Live $taskJ).status -eq 'FAILED');Assert ((Request).printReason -eq 'REPRINT')}
    Case 'Reissue and print-request audit failures roll back every business mutation' {
        Invoke-GatePassNonQuery $taskAdmin "CREATE TRIGGER gp.PrintFixtureFault ON gp.SecurityAuditEvents AFTER INSERT AS IF EXISTS(SELECT 1 FROM inserted WHERE ActionCode IN('PASS_REISSUED','PASS_PRINT_REQUESTED')) THROW 52977,'Synthetic print audit failure.',1;"
        try {Expect {Call $taskApi 'gp.ReissuePass' (Reissue-Parameters)} 52977;Expect {Request} 52977;Assert ((Counts) -eq 25);Assert ((Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM gp.PassPrintJobs j JOIN gp.VisitRequests v ON v.VisitRequestId=j.VisitRequestId WHERE v.PublicReference LIKE @prefix+'-%';" @{prefix=$taskFixture.prefix}) -eq 0)} finally {Invoke-GatePassNonQuery $taskAdmin 'DROP TRIGGER gp.PrintFixtureFault;'}
    }
    Case 'Replacement security notice contains only references and supported recipient mapping' {$taskP=Reissue-Parameters;$null=Call $taskApi 'gp.ReissuePass' $taskP;$taskR=(Invoke-GatePassScalar $taskAdmin "SELECT (SELECT TemplateCode,RecipientKind,PayloadJson FROM gp.NotificationOutbox WHERE VisitRequestId=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);" @{id=$taskP.VisitRequestId}) | ConvertFrom-Json;Assert ($taskR.TemplateCode -eq 'PASS_REISSUED' -and $taskR.RecipientKind -eq 'EMAIL' -and $taskR.PayloadJson -notmatch 'ciphertext|credentialHash|nonce|AuthenticationTag|storageKey')}
    Case 'Worker preflight supports historical replacement notices without granting entry' {
        $taskP=Reissue-Parameters;$null=Call $taskApi 'gp.ReissuePass' $taskP;$taskClaim=Claim-OwnedReplacementNotification $taskP.VisitRequestId
        $taskR=Call $taskWorker 'gp.GetNotificationDispatch' @{NotificationId=$taskClaim.notificationId;ClaimToken=$taskClaim.claimToken}
        Assert ($taskR.status -eq 'READY' -and $taskR.templateCode -eq 'PASS_REISSUED')
    }
    Case 'Replacement notice to a substituted recipient is cancelled before dispatch' {
        $taskP=Reissue-Parameters;$null=Call $taskApi 'gp.ReissuePass' $taskP;Invoke-GatePassNonQuery $taskAdmin "UPDATE gp.NotificationOutbox SET RecipientEmail=N'wrong@example.invalid' WHERE VisitRequestId=@id;" @{id=$taskP.VisitRequestId}
        $taskClaim=Claim-OwnedReplacementNotification $taskP.VisitRequestId;$taskR=Call $taskWorker 'gp.GetNotificationDispatch' @{NotificationId=$taskClaim.notificationId;ClaimToken=$taskClaim.claimToken}
        Assert ($taskR.status -eq 'CANCELLED' -and $taskR.reasonCode -eq 'RECIPIENT_MISMATCH')
    }
    Case 'Concurrent different-key replacements of one expected pass commit exactly once' {$taskP=Reissue-Parameters;$taskQ=Reissue-Parameters;$taskR=Race (Command $taskApi 'gp.ReissuePass' $taskP) (Command $taskRaceApi 'gp.ReissuePass' $taskQ);Assert (@($taskR | Where-Object Success).Count -eq 1 -and @($taskR | Where-Object {-not $_.Success -and $_.Error -eq 53103}).Count -eq 1 -and (Counts) -eq 26)}
    Case 'Concurrent same-key replacement retries return one credential receipt' {$taskP=Reissue-Parameters;$taskR=Race (Command $taskApi 'gp.ReissuePass' $taskP) (Command $taskRaceApi 'gp.ReissuePass' $taskP);Assert (@($taskR | Where-Object Success).Count -eq 2 -and $taskR[0].Result.accessPassId -eq $taskR[1].Result.accessPassId -and (Counts) -eq 26)}
    Case 'Concurrent new print keys cannot create two active render jobs' {$taskP=Print-Parameters;$taskQ=Print-Parameters;$taskR=Race (Command $taskApi 'gp.RequestPassPrint' $taskP) (Command $taskRaceApi 'gp.RequestPassPrint' $taskQ);Assert (@($taskR | Where-Object Success).Count -eq 1 -and @($taskR | Where-Object {-not $_.Success -and $_.Error -eq 53103}).Count -eq 1)}
    Case 'Concurrent entry and reissue serialize while preserving committed occupancy' {
        $taskP=Reissue-Parameters;$taskQ=Auth GUARD;$taskQ.ClientKey=[guid]::NewGuid();$taskQ.VisitRequestId=$taskP.VisitRequestId;$taskQ.AccessPassId=$taskP.ExpectedPassId;$taskQ.LocationId=[int]$taskFixture.locationId;$taskQ.SelectedProjectLocationId=[long]$taskFixture.projectLocationId;$taskQ.EventType='ENTRY';$taskQ.EntryMethod='MANUAL'
        $taskR=Race (Command $taskApi 'gp.ReissuePass' $taskP) (Command $taskRaceApi 'gp.RecordMovement' $taskQ);Assert ($taskR[0].Success)
        $taskInside=Invoke-GatePassScalar $taskAdmin 'SELECT IsInside FROM gp.VisitPresence WHERE VisitRequestId=@id;' @{id=$taskP.VisitRequestId};Assert ($taskInside -eq [bool]$taskR[1].Success)
        if (-not $taskR[1].Success) {Assert ($taskR[1].Error -eq 52005)}
    }
    Case 'Concurrent rendered handoff and reissue cannot release a revoked credential after replacement wins' {
        $taskJ=Request;$taskC=Start-Render $taskJ;$taskRenderP=Finish $taskC;$taskP=Reissue-Parameters
        $taskR=Race (Command $taskRender 'gp.DispatchPassPrint' $taskRenderP) (Command $taskRaceApi 'gp.ReissuePass' $taskP) $taskRender $taskRaceApi;Assert ($taskR[1].Success)
        if ($taskR[0].Success) {Assert ($taskR[0].Result.firstDispatch)} else {Assert ($taskR[0].Error -eq 53105)}
    }
    Case 'Card details helper has no direct runtime execute permission' {
        foreach ($taskC in @($taskApi,$taskRender,$taskMedia,$taskWorker,$taskAuth)) {Expect {Invoke-GatePassScalar $taskC 'DECLARE @d nvarchar(max),@h varbinary(32),@now datetime2(3)=SYSUTCDATETIME();EXEC gp._ReadPrintCardDetails @visit,@now,@d OUTPUT,@h OUTPUT;' @{visit=[guid]$taskVisits.TEMP.VisitId}} 229}
    }
    Case 'Visitor card fields come from submitted purpose and trusted host directory' {
        $taskC=Start-Render (Request);$taskD=$taskC.Result.cardDetails;Assert ($taskD.employeeId -eq $null -and $taskD.hostEmployeeId -eq $taskFixture.hostEmployeeId -and $taskD.hostName -and $taskD.purpose -eq 'Transaction test only' -and $taskD.assignedProjectCount -eq 0)
    }
    Case 'Employee card reads its own multiple assignments and canonical digital ID reason' {
        Invoke-GatePassNonQuery $taskAdmin 'INSERT gp.EmployeeProjectMemberships(EmployeeId,ProjectId,IsActive,VerifiedAtUtc) SELECT @employee,ProjectId,1,SYSUTCDATETIME() FROM gp.Projects WHERE ExternalProjectCode=@code;INSERT gp.EmployeeProjectLocationMemberships(EmployeeId,ProjectLocationId,IsActive,VerifiedAtUtc) SELECT @employee,pl.ProjectLocationId,1,SYSUTCDATETIME() FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId WHERE p.ExternalProjectCode=@code AND pl.LocationId=(SELECT LocationId FROM gp.VisitRequests WHERE VisitRequestId=@visit);' @{employee=$taskFixture.hostEmployeeId;code=$taskFixture.prefix+'-B';visit=[guid]$taskVisits.TEMP.VisitId}
        $taskD=(Start-Render (Request 'TEMP')).Result.cardDetails;Assert ($taskD.employeeId -eq $taskFixture.hostEmployeeId -and $taskD.hostEmployeeId -eq $null -and $taskD.purpose -eq 'Forgot physical ID' -and $taskD.assignedProjectCount -eq 2 -and @($taskD.assignedProjects).Count -eq 2)
    }
    Case 'No active employee memberships produces an honest empty assignment list' {
        Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.EmployeeProjectLocationMemberships SET IsActive=0 WHERE EmployeeId=@employee;UPDATE gp.EmployeeProjectMemberships SET IsActive=0 WHERE EmployeeId=@employee;' @{employee=$taskFixture.hostEmployeeId}
        $taskD=(Start-Render (Request 'TEMP')).Result.cardDetails;Assert ($taskD.assignedProjectCount -eq 0 -and @($taskD.assignedProjects).Count -eq 0)
    }
    Case 'Four assignments return a deterministic top three plus the complete count' {
        Invoke-GatePassNonQuery $taskAdmin @'
INSERT gp.Projects(ExternalProjectCode,ProjectName,LastSyncedAtUtc) VALUES(@prefix+'-C',N'Synthetic Gamma',SYSUTCDATETIME()),(@prefix+'-D',N'Synthetic Delta',SYSUTCDATETIME());
INSERT gp.EmployeeProjectMemberships(EmployeeId,ProjectId,IsActive,VerifiedAtUtc) SELECT @employee,ProjectId,1,SYSUTCDATETIME() FROM gp.Projects WHERE ExternalProjectCode IN(@prefix+'-B',@prefix+'-C',@prefix+'-D');
INSERT gp.ProjectLocations(ProjectId,LocationId) SELECT p.ProjectId,v.LocationId FROM gp.Projects p CROSS JOIN gp.VisitRequests v WHERE p.ExternalProjectCode IN(@prefix+'-C',@prefix+'-D') AND v.VisitRequestId=@visit;
INSERT gp.EmployeeProjectLocationMemberships(EmployeeId,ProjectLocationId,IsActive,VerifiedAtUtc) SELECT @employee,pl.ProjectLocationId,1,SYSUTCDATETIME() FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId WHERE p.ExternalProjectCode IN(@prefix+'-B',@prefix+'-C',@prefix+'-D') AND pl.LocationId=(SELECT LocationId FROM gp.VisitRequests WHERE VisitRequestId=@visit);
'@ @{prefix=$taskFixture.prefix;employee=$taskFixture.hostEmployeeId;visit=[guid]$taskVisits.TEMP.VisitId}
        $taskD=(Start-Render (Request 'TEMP')).Result.cardDetails;Assert ($taskD.assignedProjectCount -eq 4 -and @($taskD.assignedProjects).Count -eq 3 -and $taskD.assignedProjects[0].code -eq $taskFixture.prefix+'-A' -and $taskD.assignedProjects[2].code -eq $taskFixture.prefix+'-C')
    }
    Case 'Stale active memberships block printing rather than hide assignments' {
        Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.EmployeeProjectMemberships SET VerifiedAtUtc=DATEADD(day,-5,SYSUTCDATETIME()) WHERE EmployeeId=@employee;' @{employee=$taskFixture.hostEmployeeId};Expect {Start-Render (Request 'TEMP')} 53105
    }
    Case 'Stale visitor host directory prevents rendering' {
        $taskJ=Request;Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.Employees SET LastSyncedAtUtc=DATEADD(day,-5,SYSUTCDATETIME()) WHERE EmployeeId=@employee;' @{employee=$taskFixture.hostEmployeeId};Expect {Start-Render $taskJ} 53105
    }
    Case 'Changed host name fences render completion' {
        $taskC=Start-Render (Request);Invoke-GatePassNonQuery $taskAdmin "UPDATE gp.Employees SET FullName=N'Changed host' WHERE EmployeeId=@employee;" @{employee=$taskFixture.hostEmployeeId};Expect {Finish $taskC} 53103
    }
    Case 'Changed employee assignment fences rendered artifact dispatch' {
        $taskC=Start-Render (Request 'TEMP');$taskP=Finish $taskC;Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.EmployeeProjectLocationMemberships SET IsActive=0 WHERE EmployeeId=@employee;UPDATE gp.EmployeeProjectMemberships SET IsActive=0 WHERE EmployeeId=@employee;' @{employee=$taskFixture.hostEmployeeId};Expect {Call $taskRender 'gp.DispatchPassPrint' $taskP} 53103
    }
    Case 'Same claim cannot retry after printed directory details change' {
        $taskJ=Request;$taskToken=[guid]::NewGuid();$taskC=Start-Render $taskJ $taskToken;Invoke-GatePassNonQuery $taskAdmin "UPDATE gp.Employees SET FullName=N'Changed host' WHERE EmployeeId=@employee;" @{employee=$taskFixture.hostEmployeeId};Expect {Start-Render $taskJ $taskToken} 53103
    }
    Case 'Directory heartbeat with identical printed fields preserves an in-flight render' {
        $taskC=Start-Render (Request 'TEMP');Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.Employees SET LastSyncedAtUtc=SYSUTCDATETIME() WHERE EmployeeId=@employee;UPDATE gp.EmployeeProjectMemberships SET VerifiedAtUtc=SYSUTCDATETIME() WHERE EmployeeId=@employee;' @{employee=$taskFixture.hostEmployeeId};$taskP=Finish $taskC;Assert ((Call $taskRender 'gp.DispatchPassPrint' $taskP).firstDispatch)
    }
    Case 'Truncated source card digest violates its database constraint' {
        $taskJ=Request;Expect {Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.PassPrintRenderState SET SourceCardDataHash=0x01 WHERE PrintJobId=@id;' @{id=[guid]$taskJ.printJobId}} 547
    }
    Case 'Public print receipt never returns trusted card source or binding hashes' {
        $taskJ=Request;$null=Start-Render $taskJ;Assert (((Live $taskJ) | ConvertTo-Json) -notmatch 'cardDetails|SourceCardDataHash|hostEmployeeId|assignedProjects')
    }
    Case 'Actual backend SQL AES QR encoding and card renderer complete reissue reprint and pending journeys' {
        if (-not $TestPython) {$TestPython=Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'}
        if (-not (Test-Path -LiteralPath $TestPython)) {throw 'Provide an existing Python with Pillow; no software was installed.'}
        $taskPhotoBase64=& $TestPython -c "from PIL import Image,ImageDraw;from io import BytesIO;import base64;im=Image.new('RGB',(100,120),'#eef1f6');d=ImageDraw.Draw(im);d.ellipse((30,12,70,52),fill='#7e8c9e');d.ellipse((10,60,90,145),fill='#7e8c9e');b=BytesIO();im.save(b,format='JPEG');print(base64.b64encode(b.getvalue()).decode())"
        if ($LASTEXITCODE -ne 0) {throw 'Synthetic JPEG generation failed.'};$taskPhotoBytes=[Convert]::FromBase64String($taskPhotoBase64)
        $taskRawSession=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);$taskRawCsrf=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
        $taskHostSession=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);$taskHostCsrf=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
        $taskGuardSession=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);$taskGuardCsrf=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);$taskOldQr=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
        Invoke-GatePassNonQuery $taskAdmin @'
DECLARE @now datetime2(3)=SYSUTCDATETIME();
INSERT gp.Sessions(SessionHash,UserId,CsrfHash,AuthorizationVersionAtIssue,LastSeenAtUtc,IdleExpiresAtUtc,AbsoluteExpiresAtUtc,CreatedAtUtc)
SELECT @session,UserId,@csrf,AuthorizationVersion,@now,DATEADD(hour,1,@now),DATEADD(hour,2,@now),@now FROM gp.Users WHERE UserId=@actor;
INSERT gp.Sessions(SessionHash,UserId,CsrfHash,AuthorizationVersionAtIssue,LastSeenAtUtc,IdleExpiresAtUtc,AbsoluteExpiresAtUtc,CreatedAtUtc)
SELECT @guardSession,UserId,@guardCsrf,AuthorizationVersion,@now,DATEADD(hour,1,@now),DATEADD(hour,2,@now),@now FROM gp.Users WHERE UserId=@guard;
INSERT gp.Sessions(SessionHash,UserId,CsrfHash,AuthorizationVersionAtIssue,LastSeenAtUtc,IdleExpiresAtUtc,AbsoluteExpiresAtUtc,CreatedAtUtc)
SELECT @hostSession,UserId,@hostCsrf,AuthorizationVersion,@now,DATEADD(hour,1,@now),DATEADD(hour,2,@now),@now FROM gp.Users WHERE UserId=@host;
UPDATE gp.AccessPasses SET CredentialHash=@oldQr WHERE AccessPassId=@pass;
UPDATE a SET ContentHash=@photo,ByteLength=@length,StorageKey=N'intakes/'+LOWER(REPLACE(CONVERT(nvarchar(36),a.IntakeId),'-',''))+N'/'+LOWER(REPLACE(CONVERT(nvarchar(36),a.PhotoAssetId),'-',''))+N'.jpg'
FROM gp.PhotoAssets a JOIN gp.VisitRequests v ON v.PhotoAssetId=a.PhotoAssetId WHERE v.VisitRequestId IN(@visit,@pending,@digital);
'@ @{session=[Security.Cryptography.SHA256]::HashData($taskRawSession);csrf=[Security.Cryptography.SHA256]::HashData($taskRawCsrf);actor=[guid]$taskActors.RECEPTION.UserId;
            guardSession=[Security.Cryptography.SHA256]::HashData($taskGuardSession);guardCsrf=[Security.Cryptography.SHA256]::HashData($taskGuardCsrf);guard=[guid]$taskActors.GUARD.UserId;
            hostSession=[Security.Cryptography.SHA256]::HashData($taskHostSession);hostCsrf=[Security.Cryptography.SHA256]::HashData($taskHostCsrf);host=[guid]$taskActors.HOST.UserId;
            oldQr=[Security.Cryptography.SHA256]::HashData($taskOldQr);pass=[guid]$taskVisits.MOVEMENT.PassId;photo=[Security.Cryptography.SHA256]::HashData($taskPhotoBytes);length=$taskPhotoBytes.Length;
            visit=[guid]$taskVisits.MOVEMENT.VisitId;pending=[guid]$taskVisits.PENDING.VisitId;digital=[guid]$taskVisits.TEMP.VisitId}
        function To-Token([byte[]]$Value) {return [Convert]::ToBase64String($Value).TrimEnd('=').Replace('+','-').Replace('/','_')}
        $taskInfo=[Diagnostics.ProcessStartInfo]::new();$taskInfo.FileName=(Get-Command node -CommandType Application | Select-Object -First 1).Source
        $taskInfo.ArgumentList.Add((Join-Path $taskRoot 'tests/pass-printing.sql-integration.ts'));$taskInfo.WorkingDirectory=$taskRoot;$taskInfo.UseShellExecute=$false;$taskInfo.CreateNoWindow=$true
        $taskInfo.RedirectStandardInput=$true;$taskInfo.RedirectStandardOutput=$true;$taskInfo.RedirectStandardError=$true;$taskNode=[Diagnostics.Process]::new();$taskNode.StartInfo=$taskInfo
        try {
            $null=$taskNode.Start();$taskOut=$taskNode.StandardOutput.ReadToEndAsync();$taskErr=$taskNode.StandardError.ReadToEndAsync()
            $taskNode.StandardInput.Write((@{server=$Server;trustLocalCertificate=[bool]$TrustLocalServerCertificate;powerShell=(Join-Path $PSHOME 'pwsh.exe');python=$TestPython;
                sessionToken=(To-Token $taskRawSession);csrfToken=(To-Token $taskRawCsrf);guardSessionToken=(To-Token $taskGuardSession);guardCsrfToken=(To-Token $taskGuardCsrf);oldCredential=(To-Token $taskOldQr);
                hostSessionToken=(To-Token $taskHostSession);hostCsrfToken=(To-Token $taskHostCsrf);pendingSnapshotHex=$taskVisits.PENDING.SnapshotHex;projectLocationId=[string]$taskFixture.projectLocationId;
                photoBytes=$taskPhotoBase64;digitalVisitRequestId=$taskVisits.TEMP.VisitId;digitalAccessPassId=$taskVisits.TEMP.PassId;employeeId=$taskFixture.hostEmployeeId;visitRequestId=$taskVisits.MOVEMENT.VisitId;oldAccessPassId=$taskVisits.MOVEMENT.PassId;pendingVisitRequestId=$taskVisits.PENDING.VisitId;pendingAccessPassId=$taskVisits.PENDING.PassId;locationId=[int]$taskFixture.locationId} | ConvertTo-Json -Compress))
            $taskNode.StandardInput.Close();$taskExited=$taskNode.WaitForExit(60000);if (-not $taskExited) {$taskNode.Kill($true);$taskNode.WaitForExit();throw 'Print integration timed out.'}
            if ($taskNode.ExitCode -ne 0) {throw ('Print integration failed: '+$taskErr.GetAwaiter().GetResult())}
            $taskIntegration=$taskOut.GetAwaiter().GetResult() | ConvertFrom-Json;Assert ($taskIntegration.Status -eq 'PASS' -and $taskIntegration.CaseCount -eq 6)
            $taskIntegration | Add-Member -NotePropertyName CheckedAtUtc -NotePropertyValue ([datetime]::UtcNow.ToString('o'))
            $taskIntegration | Add-Member -NotePropertyName SourceSha256 -NotePropertyValue @(@('src/printing/PassPrintService.ts','src/printing/PassCardRenderer.ts','src/printing/SqlPassPrintRepository.ts','src/registration/QrCredentialEnvelope.ts','tests/pass-printing.sql-integration.ts','tests/helpers/PassPrint.SqlBridge.ps1','src/printing/NodeQrMatrixEncoder.ts','assets/brand/gatepass-logo.png','assets/brand/sopra-steria-logo.png','assets/brand/sopra-steria-icon.png','package-lock.json') | ForEach-Object {@{File=$_;Sha256=(Get-FileHash -LiteralPath (Join-Path $taskRoot $_) -Algorithm SHA256).Hash}})
            $taskIntegration | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $taskRoot 'database/validation/pass-print-backend-integration.json') -Encoding utf8
            Assert ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.AccessEvents WHERE VisitRequestId=@id;' @{id=[guid]$taskVisits.MOVEMENT.VisitId}) -eq 0)
        } finally {$taskNode.Dispose();foreach ($taskBytes in @($taskHostSession,$taskHostCsrf,$taskRawSession,$taskRawCsrf,$taskGuardSession,$taskGuardCsrf,$taskOldQr,$taskPhotoBytes)) {[Array]::Clear($taskBytes,0,$taskBytes.Length)}}
    }
    $taskDone=$true
}
finally {
    foreach ($taskC in $taskConnections) {$taskC.Dispose()}
    try {Invoke-GatePassNonQuery $taskAdmin "IF OBJECT_ID('gp.PrintFixtureFault','TR') IS NOT NULL DROP TRIGGER gp.PrintFixtureFault;";Cleanup;foreach ($taskU in $taskPrincipals) {Invoke-GatePassNonQuery $taskAdmin ('DROP USER '+$taskU+';')};$taskClean=$true}
    finally {$taskAdmin.Dispose();[ordered]@{Status=if ($taskDone -and $taskClean -and @($taskCases | Where-Object {-not $_.Passed}).Count -eq 0) {'PASS'} else {'FAIL'};CheckedAtUtc=[datetime]::UtcNow.ToString('o');CaseCount=$taskCases.Count;CleanupPassed=$taskClean;
        SourceSha256=@(@('database/migrations/011_reissue_and_print_lifecycle.sql','database/migrations/012_visitor_cards_and_guard_project_context.sql','database/migrations/013_multi_project_guard_scan.sql','database/migrations/014_trusted_card_details.sql','database/tests/Test-PassPrinting.ps1','database/tests/005_print_fixture_cleanup.sql') | ForEach-Object {@{File=$_;Sha256=(Get-FileHash -LiteralPath (Join-Path $taskRoot $_) -Algorithm SHA256).Hash}});
        ConcurrentCasesWithBothWaitersObserved=5;Scope='Restricted SQL lifecycle cases use synthetic encrypted/photo declarations. No physical printer, browser/HTTP or real messages.';Cases=@($taskCases)} | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $taskRoot 'database/validation/pass-print-report.json') -Encoding utf8}
}
if (-not $taskDone -or @($taskCases | Where-Object {-not $_.Passed}).Count) {throw 'Print lifecycle suite failed.'}
Write-Output "All $($taskCases.Count) pass replacement/print cases passed; owned data removed."
