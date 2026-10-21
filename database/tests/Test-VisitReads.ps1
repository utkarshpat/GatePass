#Requires -Version 7.0
[CmdletBinding()]
param([string]$Server='localhost\SQLEXPRESS',[switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskAdmin=Open-GatePassLocalSql -Server $Server -TrustLocalServerCertificate:$TrustLocalServerCertificate
$taskRun=[guid]::NewGuid();$taskActors=@{};$taskVisits=@{};$taskCases=[Collections.Generic.List[object]]::new()
$taskConnections=[Collections.Generic.List[object]]::new();$taskUsers=[Collections.Generic.List[string]]::new();$taskReady=$false;$taskDone=$false;$taskClean=$false
function Assert($Value,[string]$Message='Unexpected read result.') {if (-not $Value) {throw $Message}}
function Expect([scriptblock]$Action,[int]$Number=52801) {try {$null=& $Action} catch {if ($_.Exception.GetBaseException() -is [Data.SqlClient.SqlException] -and $_.Exception.GetBaseException().Number -eq $Number) {return};throw};throw "Expected SQL error $Number."}
function Auth([string]$Actor='GUARD') {return @{SessionHash=[Convert]::FromHexString($taskActors[$Actor].SessionHex);CsrfHash=[Convert]::FromHexString($taskActors[$Actor].CsrfHex)}}
function Call($Connection,[string]$Procedure,[hashtable]$Parameters) {
    $taskArgs=($Parameters.Keys | ForEach-Object {'@'+$_+'=@'+$_}) -join ','
    return (Invoke-GatePassScalar $Connection ('EXEC '+$Procedure+' '+$taskArgs) $Parameters) | ConvertFrom-Json
}
function Detail([string]$Label='MOVEMENT',[string]$View='GUARD',[string]$Actor='GUARD',$Connection=$taskApi) {
    $taskP=Auth $Actor;$taskP.View=$View;$taskP.VisitRequestId=[guid]$taskVisits[$Label].VisitId;return Call $Connection 'gp.GetVisitDetail' $taskP
}
function List([string]$View='GUARD',[string]$Actor='GUARD',[string]$Queue='DAY',[hashtable]$Extra=@{}) {
    $taskP=Auth $Actor;$taskP.View=$View;$taskP.Queue=$Queue;$taskP.LocationId=[int]$taskFixture.locationId
    foreach ($taskKey in $Extra.Keys) {$taskP[$taskKey]=$Extra[$taskKey]};return Call $taskApi 'gp.ListVisits' $taskP
}
function Photo([string]$Label='MOVEMENT',[string]$View='GUARD',[string]$Actor='GUARD',$Connection=$taskMedia) {
    $taskP=Auth $Actor;$taskP.View=$View;$taskP.VisitRequestId=[guid]$taskVisits[$Label].VisitId;return Call $Connection 'gp.ResolveVisitPhoto' $taskP
}
function Scan([string]$Label='MOVEMENT',[string]$Actor='GUARD',[byte[]]$Hash=$null,[guid]$CorrelationId=[guid]::NewGuid()) {
    $taskP=Auth $Actor;$taskP.LocationId=[int]$taskFixture.locationId;$taskP.CorrelationId=$CorrelationId
    if ($null -eq $Hash) {$taskP.CredentialHash=[Convert]::FromHexString($taskVisits[$Label].CredentialHex)} else {$taskP.CredentialHash=$Hash}
    return Call $taskApi 'gp.VerifyGuardPass' $taskP
}
function Inside([string]$Label) {
    Invoke-GatePassNonQuery $taskAdmin @'
DECLARE @op uniqueidentifier=NEWID(),@when datetime2(3);SELECT @when=DATEADD(second,1,ValidFromUtc) FROM gp.VisitRequests WHERE VisitRequestId=@id;
INSERT gp.IdempotencyRequests(OperationId,ActorBindingHash,OperationCode,ClientKey,PayloadHash,Status,ResultJson,CompletedAtUtc,ExpiresAtUtc)
VALUES(@op,HASHBYTES('SHA2_256',CONVERT(binary(16),@actor)),'READ_FIXTURE',NEWID(),HASHBYTES('SHA2_256','fixture'),'COMPLETED',N'{}',SYSUTCDATETIME(),DATEADD(day,1,SYSUTCDATETIME()));
INSERT gp.AccessEvents(VisitRequestId,AccessPassId,ActorUserId,LocationId,EventType,EntryMethod,OperationId,OccurredAtUtc)
SELECT v.VisitRequestId,p.AccessPassId,@actor,v.LocationId,'ENTRY','MANUAL',@op,@when FROM gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 WHERE v.VisitRequestId=@id;
UPDATE gp.VisitPresence SET IsInside=1,LastAccessEventId=SCOPE_IDENTITY(),LastMovementAtUtc=@when WHERE VisitRequestId=@id;
'@ @{id=[guid]$taskVisits[$Label].VisitId;actor=[guid]$taskActors.GUARD.UserId}
}
function Reset {
    Invoke-GatePassNonQuery $taskAdmin @'
DECLARE @now datetime2(3)=SYSUTCDATETIME();
UPDATE gp.Users SET AuthorizationVersion=1,IsActive=CASE WHEN IdentitySubject LIKE '%:BLOCKED' THEN 0 ELSE 1 END WHERE IdentityIssuer='gatepass-phase02-fixture' AND IdentitySubject LIKE @prefix+':%';
UPDATE s SET IdleExpiresAtUtc=DATEADD(hour,1,@now) FROM gp.Sessions s JOIN gp.Users u ON u.UserId=s.UserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject LIKE @prefix+':GUARD';
UPDATE e SET IsActive=1,LastSyncedAtUtc=@now FROM gp.Employees e JOIN gp.Users u ON u.UserId=e.UserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject LIKE @prefix+':%';
UPDATE gp.Projects SET IsActive=1,LastSyncedAtUtc=@now WHERE ExternalProjectCode IN(@prefix+'-A',@prefix+'-B');
UPDATE m SET IsActive=1,VerifiedAtUtc=@now FROM gp.EmployeeProjectMemberships m JOIN gp.Projects p ON p.ProjectId=m.ProjectId WHERE p.ExternalProjectCode IN(@prefix+'-A',@prefix+'-B');
UPDATE pl SET IsActive=1 FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId WHERE p.ExternalProjectCode IN(@prefix+'-A',@prefix+'-B');
UPDATE g SET RevokedAtUtc=NULL,RevokedByUserId=NULL,ValidFromUtc=DATEADD(hour,-1,@now),ValidUntilUtc=NULL FROM gp.StaffRoleGrants g JOIN gp.Users u ON u.UserId=g.UserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject LIKE @prefix+':%';
UPDATE a SET DeallocatedAtUtc=NULL,DeallocatedByUserId=NULL,ValidFromUtc=DATEADD(hour,-1,@now),ValidUntilUtc=NULL FROM gp.GuardAssignments a JOIN gp.Users u ON u.UserId=a.GuardUserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject LIKE @prefix+':%';
UPDATE s SET IsInside=0,LastAccessEventId=NULL,LastMovementAtUtc=NULL FROM gp.VisitPresence s JOIN gp.VisitRequests v ON v.VisitRequestId=s.VisitRequestId WHERE v.PublicReference LIKE @prefix+'-%';
DELETE x FROM gp.AccessEvents x JOIN gp.VisitRequests v ON v.VisitRequestId=x.VisitRequestId WHERE v.PublicReference LIKE @prefix+'-%';
UPDATE v SET Status=b.Status,CancelledAtUtc=NULL,DecisionAtUtc=b.DecisionAtUtc,PersonalDataPurgedAtUtc=NULL FROM gp.VisitRequests v JOIN OPENJSON(@baseline) WITH(id uniqueidentifier,Status varchar(12),DecisionAtUtc datetime2(3)) b ON b.id=v.VisitRequestId;
UPDATE p SET Status=CASE WHEN v.Status='PENDING' THEN 'PENDING' ELSE 'ACTIVE' END,RevokedAtUtc=NULL,RevocationReason=NULL FROM gp.AccessPasses p JOIN gp.VisitRequests v ON v.VisitRequestId=p.VisitRequestId WHERE v.PublicReference LIKE @prefix+'-%';
UPDATE a SET PurgedAtUtc=NULL,StorageKey=N'test-only/'+@prefix+N'/'+CONVERT(nvarchar(36),a.PhotoAssetId) FROM gp.PhotoAssets a JOIN gp.VisitRequests v ON v.PhotoAssetId=a.PhotoAssetId WHERE v.PublicReference LIKE @prefix+'-%';
'@ @{prefix=$taskFixture.prefix;baseline=$taskBaseline}
}
function Case([string]$Name,[scriptblock]$Action) {
    try {Reset;$null=& $Action;$taskCases.Add(@{Name=$Name;Passed=$true});Write-Output "PASS: $Name"}
    catch {$taskCases.Add(@{Name=$Name;Passed=$false;Error=$_.Exception.Message});Write-Output "FAIL: $Name -- $($_.Exception.Message)"}
}
function Blocked-Read([string]$Gate,[string]$Change) {
    $taskSession=Invoke-GatePassScalar $taskApi 'SELECT @@SPID;'
    $taskP=Auth;$taskP.View='GUARD';$taskP.VisitRequestId=[guid]$taskVisits.MOVEMENT.VisitId
    $taskCommand=New-GatePassSqlCommand $taskApi 'EXEC gp.GetVisitDetail @SessionHash,@CsrfHash,@View,@VisitRequestId;' $taskP
    Invoke-GatePassNonQuery $taskAdmin 'BEGIN TRANSACTION;'
    try {
        Invoke-GatePassNonQuery $taskAdmin @'
DECLARE @r int;EXEC @r=sys.sp_getapplock @Resource=@gate,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000,@DbPrincipal='public';
IF @r<0 THROW 52900,'Read gate unavailable.',1;
'@ @{gate=$Gate}
        $taskPending=$taskCommand.ExecuteScalarAsync();$taskDeadline=[datetime]::UtcNow.AddSeconds(3);$taskWaiting=0
        do {$taskWaiting=Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM sys.dm_exec_requests WHERE session_id=@id AND wait_type LIKE N'LCK_M%';" @{id=[int]$taskSession};if ($taskWaiting -eq 1) {break};[Threading.Thread]::Sleep(25)} while ([datetime]::UtcNow -lt $taskDeadline)
        Assert ($taskWaiting -eq 1) 'Read never reached the observed SQL lock gate.'
        Invoke-GatePassNonQuery $taskAdmin $Change @{actor=[guid]$taskActors.GUARD.UserId}
        Invoke-GatePassNonQuery $taskAdmin 'COMMIT;'
        Expect {$null=$taskPending.GetAwaiter().GetResult()} 52001
    } finally {Invoke-GatePassNonQuery $taskAdmin 'IF @@TRANCOUNT>0 ROLLBACK;';$taskCommand.Dispose()}
}
try {
    $taskFixture=(Invoke-GatePassScalar $taskAdmin ([IO.File]::ReadAllText((Join-Path $PSScriptRoot '002_transaction_fixtures.sql'))) @{RunId=$taskRun}) | ConvertFrom-Json
    $taskReady=$true;foreach ($taskA in $taskFixture.actors) {$taskActors[$taskA.Label]=$taskA};foreach ($taskV in $taskFixture.visits) {$taskVisits[$taskV.Label]=$taskV}
    $taskBaseline=Invoke-GatePassScalar $taskAdmin 'SELECT (SELECT VisitRequestId id,Status,DecisionAtUtc FROM gp.VisitRequests WHERE PublicReference LIKE @prefix+''-%'' FOR JSON PATH);' @{prefix=$taskFixture.prefix}
    Invoke-GatePassNonQuery $taskAdmin @'
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT g.RoleGrantId,'VISITS_READ' FROM gp.StaffRoleGrants g JOIN gp.Users u ON u.UserId=g.UserId
WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject LIKE @prefix+':%' AND u.IdentitySubject NOT LIKE '%:NOCAP';
'@ @{prefix=$taskFixture.prefix}
    foreach ($taskSpec in @(@('gp_reads_api_fixture','gp_api_runtime'),@('gp_reads_media_fixture','gp_media_runtime'),@('gp_reads_worker_fixture','gp_worker_runtime'),@('gp_reads_auth_fixture','gp_guard_auth_runtime'))) {
        Invoke-GatePassNonQuery $taskAdmin ('CREATE USER '+$taskSpec[0]+' WITHOUT LOGIN; ALTER ROLE '+$taskSpec[1]+' ADD MEMBER '+$taskSpec[0]+';');$taskUsers.Add($taskSpec[0])
        $taskC=Open-GatePassLocalSql -Server $Server -TrustLocalServerCertificate:$TrustLocalServerCertificate
        Invoke-GatePassNonQuery $taskC ('EXECUTE AS USER='''+$taskSpec[0]+''';');$taskConnections.Add($taskC)
    }
    $taskApi=$taskConnections[0];$taskMedia=$taskConnections[1];$taskWorker=$taskConnections[2];$taskAuth=$taskConnections[3]
    Case 'General API cannot resolve private photo paths' {Expect {Photo -Connection $taskApi} 229}
    Case 'Media role cannot list visits read tables or retrieve QR secrets' {Expect {Detail -Connection $taskMedia} 229;Expect {Invoke-GatePassScalar $taskMedia 'SELECT TOP(1) StorageKey FROM gp.PhotoAssets;'} 229;Expect {Invoke-GatePassScalar $taskMedia 'SELECT TOP(1) Ciphertext FROM gp.PassSecrets;'} 229}
    Case 'Worker and auth roles cannot read visits or resolve photos' {foreach ($taskC in @($taskWorker,$taskAuth)) {Expect {Detail -Connection $taskC} 229;Expect {Photo -Connection $taskC} 229}}
    Case 'Private read helpers cannot be directly executed by API' {Expect {Invoke-GatePassScalar $taskApi "DECLARE @j nvarchar(max);EXEC gp._VisitReadJson NULL,'ADMIN',NULL,NULL,@j OUTPUT;"} 229}
    Case 'Employee sees only own individual requests' {$taskR=List 'OWN' 'HOST';Assert ($taskR.visits.Count -eq 3);Assert (@($taskR.visits | Where-Object requestType -eq DIGITAL_ID).Count -eq 1);Assert ((List 'OWN' 'OTHERHOST').visits.Count -eq 0)}
    Case 'Unrelated employee cannot open another employee visit' {Expect {Detail 'TEMP' 'OWN' 'OTHERHOST'}}
    Case 'Host sees assigned people and exact decision binding' {$taskR=Detail 'PENDING' 'HOST' 'HOST';Assert ($taskR.canDecide -and $taskR.snapshotHash -eq $taskVisits.PENDING.SnapshotHex);Expect {Detail 'PENDING' 'HOST' 'OTHERHOST'}}
    Case 'Host visibility requires fresh project membership' {Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.EmployeeProjectMemberships SET VerifiedAtUtc=DATEADD(hour,-1,SYSUTCDATETIME()) WHERE EmployeeId=@id;' @{id=$taskFixture.hostEmployeeId};Expect {Detail 'PENDING' 'HOST' 'HOST'}}
    Case 'Stale employee identity cannot list own requests' {Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.Employees SET LastSyncedAtUtc=DATEADD(hour,-1,SYSUTCDATETIME()) WHERE EmployeeId=@id;' @{id=$taskFixture.hostEmployeeId};Expect {List 'OWN' 'HOST'} 52701}
    Case 'Guard lists assigned project visits and designated Digital IDs' {$taskR=List;Assert (@($taskR.visits | Where-Object requestType -eq DIGITAL_ID).Count -eq 1);Assert (@($taskR.visits | Where-Object visitRequestId -eq $taskVisits.OTHER_PAIR.VisitId).Count -eq 0)}
    Case 'Wrong location and project guards cannot read details or photos' {foreach ($taskA in @('WRONGLOCATION','WRONGPROJECT')) {Expect {Detail -Actor $taskA};Expect {Photo -Actor $taskA}}}
    Case 'VISITS_READ absence blocks detail even with movement capability' {Expect {Detail -Actor 'NOCAP'}}
    Case 'Reception role cannot use guard read context' {Expect {Detail -Actor 'RECEPTION'};Assert ((Detail -View 'RECEPTION' -Actor 'RECEPTION').personName)}
    Case 'Location admin read does not imply guard actions' {$taskR=Detail -View 'ADMIN' -Actor 'ADMIN';Assert (-not $taskR.canEnter -and -not $taskR.canExit);Expect {Detail -Actor 'ADMIN'}}
    Case 'Project admin scope cannot include Digital ID' {
        Invoke-GatePassNonQuery $taskAdmin "UPDATE gp.StaffRoleGrants SET RoleCode='PROJECT_ADMIN',ScopeType='PROJECT',LocationId=NULL,ProjectId=@project WHERE UserId=@actor;" @{project=[long]$taskFixture.projectId;actor=[guid]$taskActors.ADMIN.UserId}
        try {Assert ((Detail -View 'ADMIN' -Actor 'ADMIN').personName);Expect {Detail 'TEMP' 'ADMIN' 'ADMIN'}} finally {Invoke-GatePassNonQuery $taskAdmin "UPDATE gp.StaffRoleGrants SET RoleCode='LOCATION_ADMIN',ScopeType='LOCATION',LocationId=@location,ProjectId=NULL WHERE UserId=@actor;" @{location=[int]$taskFixture.locationId;actor=[guid]$taskActors.ADMIN.UserId}}
    }
    Case 'Capabilities cannot be combined across unrelated location grants' {Expect {Detail 'TEMP' 'GUARD' 'SPLIT'}}
    Case 'Revoked allocation blocks subsequent detail and photo requests' {Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.GuardAssignments SET DeallocatedAtUtc=SYSUTCDATETIME(),DeallocatedByUserId=@actor WHERE GuardUserId=@actor;' @{actor=[guid]$taskActors.GUARD.UserId};Expect {Detail};Expect {Photo}}
    Case 'Revoked grant and stale authorization version fail closed' {Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.Users SET AuthorizationVersion=AuthorizationVersion+1 WHERE UserId=@actor;' @{actor=[guid]$taskActors.GUARD.UserId};Expect {Detail} 52001;Expect {Photo} 52001}
    Case 'Reads inspect current grant state even if an old session remains valid' {
        Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.StaffRoleGrants SET RevokedAtUtc=SYSUTCDATETIME(),RevokedByUserId=@actor WHERE UserId=@actor;' @{actor=[guid]$taskActors.GUARD.UserId}
        Expect {Detail};Expect {Photo};Assert ((List).visits.Count -eq 0);Expect {Scan}
    }
    Case 'Expired blocked and stale sessions cannot read data' {foreach ($taskA in @('EXPIRED','BLOCKED','STALE')) {Expect {Detail -Actor $taskA} 52001}}
    Case 'Wrong CSRF and unknown visit have generic denied results' {$taskP=Auth;$taskP.CsrfHash=[byte[]]::new(32);$taskP.View='GUARD';$taskP.VisitRequestId=[guid]::NewGuid();Expect {Call $taskApi 'gp.GetVisitDetail' $taskP} 52001;$taskP=Auth;$taskP.View='GUARD';$taskP.VisitRequestId=[guid]::NewGuid();Expect {Call $taskApi 'gp.GetVisitDetail' $taskP}}
    Case 'Lists omit contacts reasons snapshot hashes private keys and group records' {$taskR=List;$taskText=$taskR | ConvertTo-Json -Depth 6;Assert ($taskText -notmatch 'personEmail|personPhone|reason|snapshotHash|storageKey|credentialHash|intakeId|ciphertext')}
    Case 'Guard detail omits contact reason and host snapshot data' {$taskText=(Detail) | ConvertTo-Json;Assert ($taskText -notmatch 'personEmail|personPhone|reason|snapshotHash|storageKey|credentialHash|ciphertext')}
    Case 'Keyset pagination walks tied timestamps without duplicate or missing people' {
        $taskExpected=(List 'GUARD' 'GUARD' 'DAY' @{PageSize=50}).visits.Count;$taskSeen=[Collections.Generic.HashSet[string]]::new();$taskExtra=@{PageSize=3}
        do {$taskR=List 'GUARD' 'GUARD' 'DAY' $taskExtra;foreach ($taskV in $taskR.visits) {Assert ($taskSeen.Add($taskV.visitRequestId))};if ($taskR.hasMore) {$taskExtra.AfterSubmittedAtUtc=[datetime]$taskR.afterSubmittedAtUtc;$taskExtra.AfterVisitRequestId=[guid]$taskR.afterVisitRequestId}} while ($taskR.hasMore)
        Assert ($taskSeen.Count -eq $taskExpected)
    }
    Case 'Page limits partial cursors invalid queues and extra whitespace are rejected' {foreach ($taskExtra in @(@{PageSize=51},@{AfterVisitRequestId=[guid]::NewGuid()},@{View='GUARD '},@{Queue='ALL'})) {Expect {List -Extra $taskExtra} 52802}}
    Case 'Staff lists require a selected office and operational date bounds' {Expect {List -Extra @{LocationId=$null}} 52802;Expect {List -Extra @{LocalVisitDate=[datetime]::UtcNow.AddYears(-1)}} 52802}
    Case 'Empty scoped lists are literal arrays and expose no total count' {$taskR=List -Extra @{PublicReference='unavailable'};Assert ($taskR.visits.Count -eq 0 -and -not $taskR.hasMore);Assert (-not $taskR.PSObject.Properties['total'])}
    Case 'Pending queue excludes expired approval deadlines' {$taskR=List 'HOST' 'HOST' 'PENDING';Assert (@($taskR.visits | Where-Object visitRequestId -eq $taskVisits.DEADLINE.VisitId).Count -eq 0)}
    Case 'INSIDE ignores visit day so expired occupants remain actionable' {Inside 'EXIT_EXPIRED';$taskR=List 'GUARD' 'GUARD' 'INSIDE';Assert (@($taskR.visits | Where-Object visitRequestId -eq $taskVisits.EXIT_EXPIRED.VisitId).Count -eq 1);Assert ((Detail 'EXIT_EXPIRED').canExit);Expect {List -Queue INSIDE -Extra @{LocalVisitDate=[datetime]::UtcNow}} 52802}
    Case 'Designated reconciler sees inside people without project allocation' {Inside 'RECON_REVOKED';Invoke-GatePassNonQuery $taskAdmin "UPDATE gp.AccessPasses SET Status='REVOKED',RevokedAtUtc=SYSUTCDATETIME(),RevocationReason=N'test' WHERE AccessPassId=@id;" @{id=[guid]$taskVisits.RECON_REVOKED.PassId};$taskR=Detail 'RECON_REVOKED' 'GUARD' 'RECON';Assert ($taskR.canReconcileExit -and -not $taskR.canEnter);Assert ((Photo 'RECON_REVOKED' 'GUARD' 'RECON').storageKey)}
    Case 'Reconciliation capability does not expose outside unallocated people' {Expect {Detail 'MOVEMENT' 'GUARD' 'RECON'}}
    Case 'Inactive project still permits inside reconciliation visibility' {Inside 'MOVEMENT';Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.ProjectLocations SET IsActive=0 WHERE ProjectLocationId=@id;' @{id=[long]$taskFixture.projectLocationId};$taskR=Detail 'MOVEMENT' 'GUARD' 'RECON';Assert ($taskR.canReconcileExit -and -not $taskR.canEnter)}
    Case 'Purged personal data is unavailable through list detail and media' {Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.VisitRequests SET PersonalDataPurgedAtUtc=SYSUTCDATETIME() WHERE VisitRequestId=@id;' @{id=[guid]$taskVisits.MOVEMENT.VisitId};Expect {Detail};Expect {Photo};Assert (@((List).visits | Where-Object visitRequestId -eq $taskVisits.MOVEMENT.VisitId).Count -eq 0)}
    Case 'Purged photo removes photo and entry availability without hiding the visit' {Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.PhotoAssets SET PurgedAtUtc=SYSUTCDATETIME(),StorageKey=NULL WHERE PhotoAssetId=@id;' @{id=[guid]$taskVisits.MOVEMENT.PhotoId};$taskR=Detail;Assert (-not $taskR.photoAvailable -and -not $taskR.canEnter);Expect {Photo}}
    Case 'Disabled employee remains visible for operations without an entry hint' {
        Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.Employees SET IsActive=0 WHERE EmployeeId=@id;' @{id=$taskFixture.hostEmployeeId}
        $taskR=Detail 'EMP_DISABLED';Assert (-not $taskR.canEnter -and $taskR.personName)
    }
    Case 'Scan validates an individual pass and writes one redacted log without movement' {$taskR=Scan;Assert ($taskR.outcome -eq 'VALID' -and $taskR.visit.canEnter);Assert ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.AccessEvents WHERE VisitRequestId=@id;' @{id=[guid]$taskVisits.MOVEMENT.VisitId}) -eq 0)}
    Case 'Unknown and out-of-scope scans have the same response with no linked IDs' {$taskOne=Scan -Hash ([byte[]]::new(32));$taskTwo=Scan 'OTHER_PAIR';Assert (($taskOne | ConvertTo-Json -Compress) -eq ($taskTwo | ConvertTo-Json -Compress));Assert (-not $taskOne.PSObject.Properties['visit'])}
    Case 'Pending scan cannot suggest entry and host decision is independently bound' {$taskR=Scan 'PENDING';Assert ($taskR.outcome -eq 'PENDING' -and -not $taskR.visit.canEnter -and -not $taskR.visit.canDecide)}
    Case 'Expired inside scan remains visible with an explicit exit action' {Inside 'EXIT_EXPIRED';$taskR=Scan 'EXIT_EXPIRED';Assert ($taskR.outcome -eq 'EXPIRED' -and $taskR.visit.canExit -and -not $taskR.visit.canEnter)}
    Case 'Revoked inside scan can offer only authorized reconciliation' {Inside 'RECON_REVOKED';Invoke-GatePassNonQuery $taskAdmin "UPDATE gp.AccessPasses SET Status='REVOKED',RevokedAtUtc=SYSUTCDATETIME(),RevocationReason=N'test' WHERE AccessPassId=@id;" @{id=[guid]$taskVisits.RECON_REVOKED.PassId};$taskR=Scan 'RECON_REVOKED' 'RECON';Assert ($taskR.outcome -eq 'REVOKED' -and $taskR.visit.canReconcileExit -and -not $taskR.visit.canEnter)}
    Case 'Scans re-evaluate state on repeated correlation rather than replaying validity' {$taskCorrelation=[guid]::NewGuid();$taskR=Scan -CorrelationId $taskCorrelation;Invoke-GatePassNonQuery $taskAdmin "UPDATE gp.AccessPasses SET Status='REVOKED',RevokedAtUtc=SYSUTCDATETIME(),RevocationReason=N'test' WHERE AccessPassId=@id;" @{id=[guid]$taskVisits.MOVEMENT.PassId};Assert ((Scan -CorrelationId $taskCorrelation).outcome -eq 'REVOKED')}
    Case 'Malformed scan credential and non-guard roles are rejected' {Expect {Scan -Hash ([byte[]]::new(31))} 52802;Expect {Scan -Actor RECEPTION}}
    Case 'Photo audit failure rolls back disclosure authorization' {
        Invoke-GatePassNonQuery $taskAdmin "CREATE TRIGGER gp.ReadPhotoFixtureFault ON gp.SecurityAuditEvents AFTER INSERT AS IF EXISTS(SELECT 1 FROM inserted WHERE ActionCode='VISIT_PHOTO_AUTHORIZED') THROW 52977,'Synthetic photo audit failure.',1;"
        try {Expect {Photo} 52977} finally {Invoke-GatePassNonQuery $taskAdmin 'DROP TRIGGER gp.ReadPhotoFixtureFault;'}
    }
    Case 'Read waiting behind authorization revocation fails after the revocation commits' {
        Blocked-Read 'gp:authorization' 'UPDATE gp.Users SET AuthorizationVersion=AuthorizationVersion+1 WHERE UserId=@actor;'
    }
    Case 'Read rechecks session expiry after an observed visit-lock wait' {
        Blocked-Read ('gp:visit:'+([string]$taskVisits.MOVEMENT.VisitId).ToLowerInvariant()) 'UPDATE gp.Sessions SET IdleExpiresAtUtc=DATEADD(second,-1,SYSUTCDATETIME()) WHERE UserId=@actor;'
    }
    Case 'Denied and cancelled scans cannot offer normal movement' {
        Invoke-GatePassNonQuery $taskAdmin "UPDATE gp.VisitRequests SET Status='DENIED' WHERE VisitRequestId=@id;UPDATE gp.AccessPasses SET Status='DENIED' WHERE AccessPassId=@pass;" @{id=[guid]$taskVisits.MOVEMENT.VisitId;pass=[guid]$taskVisits.MOVEMENT.PassId}
        Assert ((Scan).outcome -eq 'DENIED')
        Invoke-GatePassNonQuery $taskAdmin "UPDATE gp.VisitRequests SET Status='CANCELLED',CancelledAtUtc=SYSUTCDATETIME() WHERE VisitRequestId=@id;" @{id=[guid]$taskVisits.MOVEMENT.VisitId}
        $taskR=Scan;Assert ($taskR.outcome -eq 'CANCELLED' -and -not $taskR.visit.canEnter)
    }
    Case 'Internal read and photo services interoperate with restricted actual SQL clients' {
        $taskRawSession=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);$taskRawCsrf=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
        $taskRawCredential=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);$taskPhotoBytes=[Security.Cryptography.RandomNumberGenerator]::GetBytes(100)
        $taskStorageKey=Invoke-GatePassScalar $taskAdmin @'
DECLARE @now datetime2(3)=SYSUTCDATETIME();
INSERT gp.Sessions(SessionHash,UserId,CsrfHash,AuthorizationVersionAtIssue,LastSeenAtUtc,IdleExpiresAtUtc,AbsoluteExpiresAtUtc,CreatedAtUtc)
SELECT @session,UserId,@csrf,AuthorizationVersion,@now,DATEADD(hour,1,@now),DATEADD(hour,2,@now),@now FROM gp.Users WHERE UserId=@actor;
UPDATE gp.AccessPasses SET CredentialHash=@credential WHERE AccessPassId=@pass;
UPDATE a SET ContentHash=@photo,StorageKey=N'intakes/'+LOWER(REPLACE(CONVERT(nvarchar(36),a.IntakeId),'-',''))+N'/'+LOWER(REPLACE(CONVERT(nvarchar(36),a.PhotoAssetId),'-',''))+N'.jpg'
FROM gp.PhotoAssets a WHERE a.PhotoAssetId=@photoId;
SELECT StorageKey FROM gp.PhotoAssets WHERE PhotoAssetId=@photoId;
'@ @{session=[Security.Cryptography.SHA256]::HashData($taskRawSession);csrf=[Security.Cryptography.SHA256]::HashData($taskRawCsrf);actor=[guid]$taskActors.GUARD.UserId;
            credential=[Security.Cryptography.SHA256]::HashData($taskRawCredential);photo=[Security.Cryptography.SHA256]::HashData($taskPhotoBytes);pass=[guid]$taskVisits.MOVEMENT.PassId;photoId=[guid]$taskVisits.MOVEMENT.PhotoId}
        $taskInfo=[Diagnostics.ProcessStartInfo]::new();$taskInfo.FileName=(Get-Command node -CommandType Application | Select-Object -First 1).Source
        $taskInfo.ArgumentList.Add((Join-Path $taskRoot 'tests/visit-reads.sql-integration.ts'));$taskInfo.WorkingDirectory=$taskRoot;$taskInfo.UseShellExecute=$false;$taskInfo.CreateNoWindow=$true
        $taskInfo.RedirectStandardInput=$true;$taskInfo.RedirectStandardOutput=$true;$taskInfo.RedirectStandardError=$true
        $taskNode=[Diagnostics.Process]::new();$taskNode.StartInfo=$taskInfo
        try {
            $null=$taskNode.Start();$taskOut=$taskNode.StandardOutput.ReadToEndAsync();$taskErr=$taskNode.StandardError.ReadToEndAsync()
            function To-Token([byte[]]$Value) {return [Convert]::ToBase64String($Value).TrimEnd('=').Replace('+','-').Replace('/','_')}
            $taskNode.StandardInput.Write((@{server=$Server;trustLocalCertificate=[bool]$TrustLocalServerCertificate;powerShell=(Join-Path $PSHOME 'pwsh.exe');sessionToken=(To-Token $taskRawSession);csrfToken=(To-Token $taskRawCsrf);
                credential=(To-Token $taskRawCredential);photoBytes=[Convert]::ToBase64String($taskPhotoBytes);storageKey=$taskStorageKey;visitRequestId=$taskVisits.MOVEMENT.VisitId;otherVisitRequestId=$taskVisits.OTHER_PAIR.VisitId;locationId=[int]$taskFixture.locationId} | ConvertTo-Json -Compress))
            $taskNode.StandardInput.Close();$taskExited=$taskNode.WaitForExit(60000);if (-not $taskExited) {$taskNode.Kill($true);$taskNode.WaitForExit();throw 'Read integration timed out.'}
            if ($taskNode.ExitCode -ne 0) {throw ('Read integration failed: '+$taskErr.GetAwaiter().GetResult())}
            $taskIntegration=$taskOut.GetAwaiter().GetResult() | ConvertFrom-Json;Assert ($taskIntegration.Status -eq 'PASS' -and $taskIntegration.CaseCount -eq 4)
            $taskIntegration | Add-Member -NotePropertyName CheckedAtUtc -NotePropertyValue ([datetime]::UtcNow.ToString('o'))
            $taskIntegration | Add-Member -NotePropertyName SourceSha256 -NotePropertyValue @(@('src/visits/VisitReadService.ts','src/visits/SqlVisitReadRepository.ts','tests/visit-reads.sql-integration.ts','tests/helpers/VisitReads.SqlBridge.ps1') | ForEach-Object {@{File=$_;Sha256=(Get-FileHash -LiteralPath (Join-Path $taskRoot $_) -Algorithm SHA256).Hash}})
            $taskIntegration | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $taskRoot 'database/validation/visit-reads-backend-integration.json') -Encoding utf8
            Assert ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.AccessEvents WHERE VisitRequestId=@id;' @{id=[guid]$taskVisits.MOVEMENT.VisitId}) -eq 0) 'Integration scan moved the visitor.'
        } finally {$taskNode.Dispose();foreach ($taskRaw in @($taskRawSession,$taskRawCsrf,$taskRawCredential,$taskPhotoBytes)) {[Array]::Clear($taskRaw,0,$taskRaw.Length)}}
    }
    $taskDone=$true
}
finally {
    foreach ($taskC in $taskConnections) {$taskC.Dispose()}
    try {
        Invoke-GatePassNonQuery $taskAdmin "IF OBJECT_ID('gp.ReadPhotoFixtureFault','TR') IS NOT NULL DROP TRIGGER gp.ReadPhotoFixtureFault;"
        if ($taskReady) {Invoke-GatePassNonQuery $taskAdmin ([IO.File]::ReadAllText((Join-Path $PSScriptRoot '003_transaction_cleanup.sql'))) @{RunId=$taskRun}}
        foreach ($taskU in $taskUsers) {Invoke-GatePassNonQuery $taskAdmin ('DROP USER '+$taskU+';')};$taskClean=$true
    } finally {
        $taskAdmin.Dispose()
        [ordered]@{Status=if ($taskDone -and $taskClean -and @($taskCases | Where-Object {-not $_.Passed}).Count -eq 0) {'PASS'} else {'FAIL'};CheckedAtUtc=[datetime]::UtcNow.ToString('o');CaseCount=$taskCases.Count;CleanupPassed=$taskClean;
            MigrationSha256=(Get-FileHash -LiteralPath (Join-Path $taskRoot 'database/migrations/010_scoped_visit_reads.sql') -Algorithm SHA256).Hash;HarnessSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash;
            ObservedIndependentConnectionWaits=2;Scope='Restricted SQL role/visibility/state checks. Photos are synthetic declarations. No public HTTP/browser/SSO or production filesystem/driver.';Cases=@($taskCases)} | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $taskRoot 'database/validation/visit-reads-report.json') -Encoding utf8
    }
}
if (-not $taskDone -or @($taskCases | Where-Object {-not $_.Passed}).Count) {throw 'Visit read suite failed.'}
Write-Output "All $($taskCases.Count) scoped read cases passed; owned synthetic data removed."
