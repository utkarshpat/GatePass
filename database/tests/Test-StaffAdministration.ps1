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
        # Input/authentication failures can be audited before ActorUserId resolves.
        # Bind cleanup to this run's exact owned targets before deleting them.
        Invoke-GatePassNonQuery $taskAdmin @'
DELETE a FROM gp.SecurityAuditEvents a WHERE a.ActorUserId IS NULL AND (
 (a.ActionCode='STAFF_ROLE_GRANT_FAILED' AND a.TargetReference IN(SELECT CONVERT(varchar(36),UserId) FROM gp.Users WHERE IdentityIssuer='gatepass-phase02-fixture' AND IdentitySubject LIKE @prefix+':%'))
 OR (a.ActionCode='GUARD_ALLOCATION_FAILED' AND a.TargetReference IN(SELECT CONVERT(varchar(100),pl.ProjectLocationId) FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId WHERE p.ExternalProjectCode IN(@prefix+'-A',@prefix+'-B')))
 OR (a.ActionCode='STAFF_ROLE_REVOCATION_FAILED' AND a.TargetReference IN(SELECT CONVERT(varchar(100),g.RoleGrantId) FROM gp.StaffRoleGrants g JOIN gp.Users u ON u.UserId=g.UserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject LIKE @prefix+':%')));
'@ @{prefix=$taskFixture.prefix}
        foreach ($taskF in @('005_print_fixture_cleanup.sql','003_transaction_cleanup.sql')) {Invoke-GatePassNonQuery $taskAdmin ([IO.File]::ReadAllText((Join-Path $PSScriptRoot $taskF))) @{RunId=$taskRun}}

    };$script:taskReady=$false
}

function Reset {
    Cleanup
    $script:taskFixture=(Invoke-GatePassScalar $taskAdmin ([IO.File]::ReadAllText((Join-Path $PSScriptRoot '002_transaction_fixtures.sql'))) @{RunId=$taskRun}) | ConvertFrom-Json
    $script:taskReady=$true;foreach($taskA in $taskFixture.actors){$taskActors[$taskA.Label]=$taskA};foreach($taskV in $taskFixture.visits){$taskVisits[$taskV.Label]=$taskV}
    $script:taskPairB=[long](Invoke-GatePassScalar $taskAdmin 'SELECT ProjectLocationId FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId WHERE p.ExternalProjectCode=@code AND pl.LocationId=@loc;' @{code=$taskFixture.prefix+'-B';loc=[int]$taskFixture.locationId})
    Invoke-GatePassNonQuery $taskAdmin @'
INSERT gp.StaffRoleGrants(UserId,RoleCode,ScopeType,GrantedByUserId,ValidFromUtc) VALUES(@host,'PLATFORM_ADMIN','PLATFORM',@host,DATEADD(hour,-1,SYSUTCDATETIME()));
DECLARE @id bigint=SCOPE_IDENTITY();
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) VALUES(@id,'ROLE_GRANTS_MANAGE'),(@id,'GUARDS_MANAGE');
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT g.RoleGrantId,'VISITS_READ' FROM gp.StaffRoleGrants g WHERE g.UserId IN(@guard,@guard2) AND NOT EXISTS(SELECT 1 FROM gp.GrantCapabilities c WHERE c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='VISITS_READ');
'@ @{host=[guid]$taskActors.HOST.UserId;guard=[guid]$taskActors.GUARD.UserId;guard2=[guid]$taskActors.GUARD2.UserId}
}
function Allocate-Parameters([string]$Actor='ADMIN',[string]$Guard='GUARD2') {$taskP=Auth $Actor;$taskP.ClientKey=[guid]::NewGuid();$taskP.GuardUserId=[guid]$taskActors[$Guard].UserId;$taskP.ProjectLocationId=$taskPairB;$taskP.ValidFromUtc=$null;$taskP.ValidUntilUtc=$null;$taskP.Reason='Scheduled project cover';return $taskP}
function Allocate {return Call $taskApi 'gp.AllocateGuard' (Allocate-Parameters)}
function Grant-Parameters([string]$Actor='HOST') {$taskP=Auth $Actor;$taskP.ClientKey=[guid]::NewGuid();$taskP.TargetUserId=[guid]$taskActors.OTHERHOST.UserId;$taskP.RoleCode='RECEPTION';$taskP.ScopeType='LOCATION';$taskP.LocationId=[int]$taskFixture.locationId;$taskP.ProjectId=$null;$taskP.ProjectLocationId=$null;$taskP.ValidFromUtc=$null;$taskP.ValidUntilUtc=$null;$taskP.CapabilitiesJson='["VISITS_READ","PASS_PRINT"]';$taskP.Reason='Assigned reception duties';return $taskP}
function Grant {return Call $taskApi 'gp.GrantStaffRole' (Grant-Parameters)}
function Revoke-Parameters([long]$Id,[string]$Actor='HOST') {$taskP=Auth $Actor;$taskP.ClientKey=[guid]::NewGuid();$taskP.RoleGrantId=$Id;$taskP.Reason='Duties ended';return $taskP}
function User-Version([string]$Actor) {return Invoke-GatePassScalar $taskAdmin 'SELECT AuthorizationVersion FROM gp.Users WHERE UserId=@id;' @{id=[guid]$taskActors[$Actor].UserId}}
function Case([string]$Name,[scriptblock]$Action) {try {Reset;$null=& $Action;$taskCases.Add(@{Name=$Name;Passed=$true});Write-Output "PASS: $Name"} catch {$taskCases.Add(@{Name=$Name;Passed=$false;Error=$_.Exception.Message});Write-Output "FAIL: $Name -- $($_.Exception.Message)"}}
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
    foreach($taskSpec in @(@('gp_staff_api_fixture','gp_api_runtime'),@('gp_staff_render_fixture','gp_render_runtime'),@('gp_staff_media_fixture','gp_media_runtime'),@('gp_staff_worker_fixture','gp_worker_runtime'),@('gp_staff_auth_fixture','gp_guard_auth_runtime'))) {
        Invoke-GatePassNonQuery $taskAdmin ('CREATE USER '+$taskSpec[0]+' WITHOUT LOGIN;ALTER ROLE '+$taskSpec[1]+' ADD MEMBER '+$taskSpec[0]+';');$taskPrincipals.Add($taskSpec[0]);$taskC=Open-GatePassLocalSql -Server $Server -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $taskC ("EXECUTE AS USER='"+$taskSpec[0]+"';");$taskConnections.Add($taskC)
    }
    $taskApi=$taskConnections[0];$taskRender=$taskConnections[1];$taskMedia=$taskConnections[2];$taskWorker=$taskConnections[3];$taskAuth=$taskConnections[4]
    $taskRaceApi=Open-GatePassLocalSql -Server $Server -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $taskRaceApi "EXECUTE AS USER='gp_staff_api_fixture';";$taskConnections.Add($taskRaceApi)
    Case 'Only API may invoke public allocation and role procedures' {foreach($taskC in @($taskRender,$taskMedia,$taskWorker,$taskAuth)){Expect {Call $taskC 'gp.AllocateGuard' (Allocate-Parameters)} 229;Expect {Call $taskC 'gp.GrantStaffRole' (Grant-Parameters)} 229;Expect {Call $taskC 'gp.RevokeStaffRole' (Revoke-Parameters ([long]$taskActors.GUARD.GrantId))} 229};Expect {Invoke-GatePassScalar $taskApi 'SELECT COUNT(*) FROM gp.StaffRoleGrants;'} 229;Expect {Invoke-GatePassScalar $taskApi 'DECLARE @now datetime2(3)=SYSUTCDATETIME();EXEC gp._RequireRoleAdministrator @a,@now;' @{a=[guid]$taskActors.HOST.UserId}} 229}
    Case 'Scoped admin allocates a guard and invalidates its prior session' {$taskBefore=User-Version GUARD2;$taskR=Allocate;Assert ($taskR.status -eq 'ALLOCATED' -and $taskR.projectLocationId -eq $taskPairB.ToString() -and (User-Version GUARD2) -eq $taskBefore+1);$taskP=Auth GUARD2;$taskP.LocationId=[int]$taskFixture.locationId;Expect {Call $taskApi 'gp.ListGuardWorkContexts' $taskP} 52001}
    Case 'One guard may cover two simultaneous different projects' {$taskR=Allocate;Assert ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.GuardAssignments WHERE GuardUserId=@guard AND DeallocatedAtUtc IS NULL;' @{guard=[guid]$taskActors.GUARD2.UserId}) -eq 2)}
    Case 'Duplicate overlapping assignment at the same pair is denied' {$null=Allocate;Expect {Allocate} 52003}
    Case 'Adjacent scheduled assignments do not overlap' {$taskP=Allocate-Parameters;$taskP.ValidFromUtc=[datetime]::UtcNow.AddHours(1);$taskP.ValidUntilUtc=$taskP.ValidFromUtc.AddHours(1);$null=Call $taskApi 'gp.AllocateGuard' $taskP;$taskP.ClientKey=[guid]::NewGuid();$taskP.ValidFromUtc=$taskP.ValidUntilUtc;$taskP.ValidUntilUtc=$taskP.ValidFromUtc.AddHours(1);$null=Call $taskApi 'gp.AllocateGuard' $taskP}
    Case 'Independent guards may cover the same project interval' {$null=Allocate;$taskP=Allocate-Parameters -Guard GUARD;$null=Call $taskApi 'gp.AllocateGuard' $taskP}
    Case 'Wrong office reception guard and unrelated employee cannot allocate' {foreach($taskA in @('RECEPTION','GUARD','OTHERHOST','WRONGLOCATION')){Expect {Call $taskApi 'gp.AllocateGuard' (Allocate-Parameters $taskA)} 52001};$taskP=Allocate-Parameters;$taskP.ProjectLocationId=Invoke-GatePassScalar $taskAdmin 'SELECT pl.ProjectLocationId FROM gp.ProjectLocations pl WHERE pl.ProjectId=@project AND pl.LocationId=@loc;' @{project=[long]$taskFixture.projectId;loc=[int]$taskFixture.otherLocationId};Expect {Call $taskApi 'gp.AllocateGuard' $taskP} 52001}
    Case 'Past or inverted assignment intervals are invalid' {$taskP=Allocate-Parameters;$taskP.ValidFromUtc=[datetime]::UtcNow.AddMinutes(-1);Expect {Call $taskApi 'gp.AllocateGuard' $taskP} 52002;$taskP=Allocate-Parameters;$taskP.ValidUntilUtc=[datetime]::UtcNow.AddMinutes(-1);Expect {Call $taskApi 'gp.AllocateGuard' $taskP} 52002}
    Case 'Inactive stale project or mismatched guard role rejects allocation' {$taskP=Allocate-Parameters -Guard NOCAP;Expect {Call $taskApi 'gp.AllocateGuard' $taskP} 52004;Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.Projects SET LastSyncedAtUtc=DATEADD(day,-1,SYSUTCDATETIME()) WHERE ProjectId=(SELECT ProjectId FROM gp.ProjectLocations WHERE ProjectLocationId=@pair);' @{pair=$taskPairB};Expect {Allocate} 52004}
    Case 'One whole-interval guard role is required rather than combining scopes or durations' {Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.StaffRoleGrants SET ValidUntilUtc=DATEADD(hour,2,SYSUTCDATETIME()) WHERE UserId=@guard;' @{guard=[guid]$taskActors.GUARD2.UserId};Expect {Allocate} 52004;$taskP=Allocate-Parameters;$taskP.ValidUntilUtc=[datetime]::UtcNow.AddHours(1);$null=Call $taskApi 'gp.AllocateGuard' $taskP}
    Case 'Allocation retry is historical and does not increment version twice' {$taskP=Allocate-Parameters;$taskR=Call $taskApi 'gp.AllocateGuard' $taskP;$taskVersion=User-Version GUARD2;Assert ((Call $taskApi 'gp.AllocateGuard' $taskP).assignmentId -eq $taskR.assignmentId -and (User-Version GUARD2) -eq $taskVersion);$taskP.Reason='Changed';Expect {Call $taskApi 'gp.AllocateGuard' $taskP} 52003}
    Case 'Invalid CSRF stale expired and blocked actors are denied before mutation' {foreach($taskA in @('STALE','EXPIRED','BLOCKED')){Expect {Call $taskApi 'gp.AllocateGuard' (Allocate-Parameters $taskA)} 52001};$taskP=Grant-Parameters;$taskP.CsrfHash=[byte[]]::new(32);Expect {Call $taskApi 'gp.GrantStaffRole' $taskP} 52001}
    Case 'Role grant creates only explicit capabilities and invalidates target session' {$taskR=Grant;Assert ($taskR.status -eq 'GRANTED' -and (User-Version OTHERHOST) -eq 2);Assert ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.GrantCapabilities WHERE RoleGrantId=@id;' @{id=[long]$taskR.roleGrantId}) -eq 2)}
    Case 'Role matrix blocks reception movement guard print and project admin credential management' {foreach($taskSpec in @(@('RECEPTION','PROJECT_MOVEMENT'),@('GUARD','PASS_PRINT'),@('PROJECT_ADMIN','GUARD_CREDENTIALS_MANAGE'))){$taskP=Grant-Parameters;$taskP.RoleCode=$taskSpec[0];$taskP.CapabilitiesJson='["'+$taskSpec[1]+'"]';Expect {Call $taskApi 'gp.GrantStaffRole' $taskP} 52002}}
    Case 'Empty duplicate unknown nonstring and case-shifted capabilities are rejected' {foreach($taskJson in @('[]','["VISITS_READ","VISITS_READ"]','["visits_read"]','["UNKNOWN"]','[{"x":"VISITS_READ"}]','[1]','{}','null','["VISITS_READ "]')){$taskP=Grant-Parameters;$taskP.CapabilitiesJson=$taskJson;Expect {Call $taskApi 'gp.GrantStaffRole' $taskP} 52002}}
    Case 'Role and scope shape rejects missing or extraneous scope IDs' {foreach($taskChange in @(@{LocationId=$null},@{ProjectId=[long]$taskFixture.projectId},@{ScopeType='INDIA'},@{RoleCode='GUARD ';ScopeType='LOCATION'})){$taskP=Grant-Parameters;foreach($taskK in $taskChange.Keys){$taskP[$taskK]=$taskChange[$taskK]};Expect {Call $taskApi 'gp.GrantStaffRole' $taskP} 52002}}
    Case 'Explicit location delegation remains bounded to subordinate office roles' {Invoke-GatePassNonQuery $taskAdmin "INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) VALUES(@id,'ROLE_GRANTS_MANAGE');" @{id=[long]$taskActors.ADMIN.GrantId};Assert ((Call $taskApi 'gp.GrantStaffRole' (Grant-Parameters ADMIN)).status -eq 'GRANTED');$taskP=Grant-Parameters ADMIN;$taskP.RoleCode='INDIA_ADMIN';$taskP.ScopeType='INDIA';$taskP.LocationId=$null;$taskP.CapabilitiesJson='["VISITS_READ"]';Expect {Call $taskApi 'gp.GrantStaffRole' $taskP} 52001}
    Case 'Global administrator cannot grant or revoke their own role' {$taskP=Grant-Parameters;$taskP.TargetUserId=[guid]$taskActors.HOST.UserId;Expect {Call $taskApi 'gp.GrantStaffRole' $taskP} 52001;$taskId=Invoke-GatePassScalar $taskAdmin "SELECT RoleGrantId FROM gp.StaffRoleGrants WHERE UserId=@id AND RoleCode='PLATFORM_ADMIN';" @{id=[guid]$taskActors.HOST.UserId};Expect {Call $taskApi 'gp.RevokeStaffRole' (Revoke-Parameters $taskId)} 52001}
    Case 'Canonical capability ordering preserves the same retry receipt' {$taskP=Grant-Parameters;$taskR=Call $taskApi 'gp.GrantStaffRole' $taskP;$taskP.CapabilitiesJson='["PASS_PRINT","VISITS_READ"]';Assert ((Call $taskApi 'gp.GrantStaffRole' $taskP).roleGrantId -eq $taskR.roleGrantId -and (User-Version OTHERHOST) -eq 2)}
    Case 'Overlapping identical role grants require explicit revocation instead of hidden edits' {$null=Grant;Expect {Grant} 52003}
    Case 'Guard may receive reception duties while overlapping admin roles remain forbidden' {$taskP=Grant-Parameters;$taskP.TargetUserId=[guid]$taskActors.GUARD2.UserId;Assert ((Call $taskApi 'gp.GrantStaffRole' $taskP).status -eq 'GRANTED');$taskP.ClientKey=[guid]::NewGuid();$taskP.RoleCode='LOCATION_ADMIN';$taskP.CapabilitiesJson='["VISITS_READ"]';Expect {Call $taskApi 'gp.GrantStaffRole' $taskP} 52003}
    Case 'Revocation preserves grant capability history and fences target session' {$taskR=Grant;$taskP=Revoke-Parameters ([long]$taskR.roleGrantId);$taskOut=Call $taskApi 'gp.RevokeStaffRole' $taskP;Assert ($taskOut.revoked -and (User-Version OTHERHOST) -eq 3);Assert ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.GrantCapabilities WHERE RoleGrantId=@id;' @{id=[long]$taskR.roleGrantId}) -eq 2);Assert ((Call $taskApi 'gp.RevokeStaffRole' $taskP).roleGrantId -eq $taskR.roleGrantId);Expect {Call $taskApi 'gp.RevokeStaffRole' (Revoke-Parameters ([long]$taskR.roleGrantId))} 52005}
    Case 'Revoked grant may be replaced with a new independent minimal grant' {$taskR=Grant;$null=Call $taskApi 'gp.RevokeStaffRole' (Revoke-Parameters ([long]$taskR.roleGrantId));$taskP=Grant-Parameters;$taskP.CapabilitiesJson='["VISITS_READ"]';$taskNew=Call $taskApi 'gp.GrantStaffRole' $taskP;Assert ($taskNew.roleGrantId -ne $taskR.roleGrantId)}
    Case 'Reason fields are required and never silently truncated' {foreach($taskReason in @($null,'',('x'*301))){$taskP=Allocate-Parameters;$taskP.Reason=$taskReason;Expect {Call $taskApi 'gp.AllocateGuard' $taskP} 52002;$taskP=Grant-Parameters;$taskP.Reason=$taskReason;Expect {Call $taskApi 'gp.GrantStaffRole' $taskP} 52002}}
    Case 'Allocation audit failure rolls back assignment and session generation' {Invoke-GatePassNonQuery $taskAdmin "CREATE TRIGGER gp.StaffFixtureFault ON gp.SecurityAuditEvents AFTER INSERT AS IF EXISTS(SELECT 1 FROM inserted WHERE ActionCode='GUARD_ALLOCATED') THROW 52977,'Synthetic allocation audit fault.',1;";try {Expect {Allocate} 52977;Assert ((User-Version GUARD2) -eq 1)}finally{Invoke-GatePassNonQuery $taskAdmin 'DROP TRIGGER gp.StaffFixtureFault;'}}
    Case 'Role grant audit failure rolls back grant capabilities and session generation' {Invoke-GatePassNonQuery $taskAdmin "CREATE TRIGGER gp.StaffFixtureFault ON gp.SecurityAuditEvents AFTER INSERT AS IF EXISTS(SELECT 1 FROM inserted WHERE ActionCode='STAFF_ROLE_GRANTED') THROW 52977,'Synthetic grant audit fault.',1;";try {Expect {Grant} 52977;Assert ((User-Version OTHERHOST) -eq 1 -and (Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.StaffRoleGrants WHERE UserId=@id;' @{id=[guid]$taskActors.OTHERHOST.UserId}) -eq 0)}finally{Invoke-GatePassNonQuery $taskAdmin 'DROP TRIGGER gp.StaffFixtureFault;'}}
    Case 'Role revocation audit failure keeps the original grant active' {$taskR=Grant;Invoke-GatePassNonQuery $taskAdmin "CREATE TRIGGER gp.StaffFixtureFault ON gp.SecurityAuditEvents AFTER INSERT AS IF EXISTS(SELECT 1 FROM inserted WHERE ActionCode='STAFF_ROLE_REVOKED') THROW 52977,'Synthetic revocation audit fault.',1;";try {Expect {Call $taskApi 'gp.RevokeStaffRole' (Revoke-Parameters ([long]$taskR.roleGrantId))} 52977;Assert ((User-Version OTHERHOST) -eq 2)}finally{Invoke-GatePassNonQuery $taskAdmin 'DROP TRIGGER gp.StaffFixtureFault;'}}
    Case 'Revoked administrator authority blocks cached retries' {$taskP=Grant-Parameters;$null=Call $taskApi 'gp.GrantStaffRole' $taskP;Invoke-GatePassNonQuery $taskAdmin "UPDATE gp.StaffRoleGrants SET RevokedAtUtc=SYSUTCDATETIME(),RevokedByUserId=@id WHERE UserId=@id AND RoleCode='PLATFORM_ADMIN';" @{id=[guid]$taskActors.HOST.UserId};Expect {Call $taskApi 'gp.GrantStaffRole' $taskP} 52001}
    Case 'Two concurrent allocation keys cannot create duplicate intervals' {$taskR=Race (Command $taskApi 'gp.AllocateGuard' (Allocate-Parameters)) (Command $taskRaceApi 'gp.AllocateGuard' (Allocate-Parameters));Assert (@($taskR | Where-Object Success).Count -eq 1 -and @($taskR | Where-Object {-not $_.Success -and $_.Error -eq 52003}).Count -eq 1)}
    Case 'Concurrent same-key role retries return one grant' {$taskP=Grant-Parameters;$taskR=Race (Command $taskApi 'gp.GrantStaffRole' $taskP) (Command $taskRaceApi 'gp.GrantStaffRole' $taskP);Assert (@($taskR | Where-Object Success).Count -eq 2 -and $taskR[0].Result.roleGrantId -eq $taskR[1].Result.roleGrantId)}
    Case 'Concurrent distinct role keys cannot duplicate a grant' {$taskR=Race (Command $taskApi 'gp.GrantStaffRole' (Grant-Parameters)) (Command $taskRaceApi 'gp.GrantStaffRole' (Grant-Parameters));Assert (@($taskR | Where-Object Success).Count -eq 1)}
    Case 'Role revocation serializes with allocation and prevents later cached replay' {$taskP=Allocate-Parameters;$taskQ=Revoke-Parameters ([long]$taskActors.ADMIN.GrantId);$taskR=Race (Command $taskApi 'gp.AllocateGuard' $taskP) (Command $taskRaceApi 'gp.RevokeStaffRole' $taskQ);Assert ($taskR[1].Success);if(-not $taskR[0].Success){Assert ($taskR[0].Error -eq 52001)};Expect {Call $taskApi 'gp.AllocateGuard' $taskP} 52001}
    Case 'All eligible role and scope forms grant explicit capabilities successfully' {
        foreach($taskSpec in @(@('GUARD','LOCATION','VISITS_READ'),@('RECEPTION','LOCATION','PASS_PRINT'),@('PROJECT_ADMIN','PROJECT','GUARDS_MANAGE'),@('PROJECT_ADMIN','PROJECT_LOCATION','REPORTS_READ'),@('LOCATION_ADMIN','LOCATION','GUARD_CREDENTIALS_MANAGE'),@('INDIA_ADMIN','INDIA','ROLE_GRANTS_MANAGE'))) {
            $taskP=Grant-Parameters;$taskP.RoleCode=$taskSpec[0];$taskP.ScopeType=$taskSpec[1];$taskP.CapabilitiesJson='["'+$taskSpec[2]+'"]';$taskP.LocationId=$null
            if($taskP.RoleCode -eq 'GUARD'){$taskP.TargetUserId=[guid]$taskActors.GUARD2.UserId;$taskP.LocationId=[int]$taskFixture.otherLocationId}
            elseif($taskP.ScopeType -eq 'LOCATION'){$taskP.LocationId=[int]$taskFixture.locationId}
            elseif($taskP.ScopeType -eq 'PROJECT'){$taskP.ProjectId=[long]$taskFixture.projectId}
            elseif($taskP.ScopeType -eq 'PROJECT_LOCATION'){$taskP.ProjectLocationId=$taskPairB}
            Assert ((Call $taskApi 'gp.GrantStaffRole' $taskP).status -eq 'GRANTED')
        }
    }
    Case 'Project location grant and revocation audit both carry trusted location scope' {
        $taskP=Grant-Parameters;$taskP.RoleCode='PROJECT_ADMIN';$taskP.ScopeType='PROJECT_LOCATION';$taskP.LocationId=$null;$taskP.ProjectLocationId=$taskPairB;$taskP.CapabilitiesJson='["VISITS_READ"]';$taskR=Call $taskApi 'gp.GrantStaffRole' $taskP;$null=Call $taskApi 'gp.RevokeStaffRole' (Revoke-Parameters ([long]$taskR.roleGrantId))
        Assert ((Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM gp.SecurityAuditEvents WHERE TargetType='ROLE_GRANT' AND TargetReference=@id AND ActionCode IN('STAFF_ROLE_GRANTED','STAFF_ROLE_REVOKED') AND LocationId=@loc AND ProjectLocationId=@pair;" @{id=$taskR.roleGrantId;loc=[int]$taskFixture.locationId;pair=$taskPairB}) -eq 2)
    }
    Case 'Project admin allocation respects the exact project location scope' {
        Invoke-GatePassNonQuery $taskAdmin @'
INSERT gp.StaffRoleGrants(UserId,RoleCode,ScopeType,ProjectLocationId,GrantedByUserId,ValidFromUtc) VALUES(@user,'PROJECT_ADMIN','PROJECT_LOCATION',@pair,@actor,DATEADD(minute,-1,SYSUTCDATETIME()));
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) VALUES(SCOPE_IDENTITY(),'GUARDS_MANAGE');
'@ @{user=[guid]$taskActors.OTHERHOST.UserId;pair=$taskPairB;actor=[guid]$taskActors.HOST.UserId}
        $taskP=Allocate-Parameters OTHERHOST;$null=Call $taskApi 'gp.AllocateGuard' $taskP;$taskP.ClientKey=[guid]::NewGuid();$taskP.ProjectLocationId=[long]$taskFixture.projectLocationId;Expect {Call $taskApi 'gp.AllocateGuard' $taskP} 52001
    }
    Case 'Disabled target and inactive scope cannot receive new role authority' {
        $taskP=Grant-Parameters;$taskP.TargetUserId=[guid]$taskActors.BLOCKED.UserId;Expect {Call $taskApi 'gp.GrantStaffRole' $taskP} 52004
        $taskP=Grant-Parameters;Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.Locations SET IsActive=0 WHERE LocationId=@id;' @{id=[int]$taskFixture.locationId}
        try {Expect {Call $taskApi 'gp.GrantStaffRole' $taskP} 52004} finally {Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.Locations SET IsActive=1 WHERE LocationId=@id;' @{id=[int]$taskFixture.locationId}}
    }
    Case 'Actual typed backend allocation grant revocation and retry interoperate with restricted SQL' {
        $taskAuthData=@{};$taskSecretBytes=[Collections.Generic.List[byte[]]]::new()
        foreach($taskSpec in @(@('admin','ADMIN'),@('host','HOST'),@('unprivileged','RECEPTION'))) {
            $taskRaw=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);$taskCsrf=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);$taskSecretBytes.Add($taskRaw);$taskSecretBytes.Add($taskCsrf)
            Invoke-GatePassNonQuery $taskAdmin @'
DECLARE @now datetime2(3)=SYSUTCDATETIME();
INSERT gp.Sessions(SessionHash,UserId,CsrfHash,AuthorizationVersionAtIssue,LastSeenAtUtc,IdleExpiresAtUtc,AbsoluteExpiresAtUtc,CreatedAtUtc)
SELECT @session,UserId,@csrf,AuthorizationVersion,@now,DATEADD(hour,1,@now),DATEADD(hour,2,@now),@now FROM gp.Users WHERE UserId=@actor;
'@ @{session=[Security.Cryptography.SHA256]::HashData($taskRaw);csrf=[Security.Cryptography.SHA256]::HashData($taskCsrf);actor=[guid]$taskActors[$taskSpec[1]].UserId}
            $taskAuthData[$taskSpec[0]]=@{sessionToken=[Convert]::ToBase64String($taskRaw).TrimEnd('=').Replace('+','-').Replace('/','_');csrfToken=[Convert]::ToBase64String($taskCsrf).TrimEnd('=').Replace('+','-').Replace('/','_')}
        }
        $taskInfo=[Diagnostics.ProcessStartInfo]::new();$taskInfo.FileName=(Get-Command node -CommandType Application | Select-Object -First 1).Source;$taskInfo.ArgumentList.Add((Join-Path $taskRoot 'tests/staff-administration.sql-integration.ts'));$taskInfo.WorkingDirectory=$taskRoot;$taskInfo.UseShellExecute=$false;$taskInfo.CreateNoWindow=$true;$taskInfo.RedirectStandardInput=$true;$taskInfo.RedirectStandardOutput=$true;$taskInfo.RedirectStandardError=$true;$taskNode=[Diagnostics.Process]::new();$taskNode.StartInfo=$taskInfo
        try {
            $null=$taskNode.Start();$taskOut=$taskNode.StandardOutput.ReadToEndAsync();$taskErr=$taskNode.StandardError.ReadToEndAsync();$taskNode.StandardInput.Write((@{server=$Server;trustLocalCertificate=[bool]$TrustLocalServerCertificate;powerShell=(Join-Path $PSHOME 'pwsh.exe');admin=$taskAuthData.admin;host=$taskAuthData.host;unprivileged=$taskAuthData.unprivileged;guardUserId=$taskActors.GUARD2.UserId;targetUserId=$taskActors.OTHERHOST.UserId;projectLocationId=$taskPairB.ToString();locationId=[int]$taskFixture.locationId} | ConvertTo-Json -Depth 5 -Compress));$taskNode.StandardInput.Close()
            if(-not $taskNode.WaitForExit(45000)){$taskNode.Kill($true);$taskNode.WaitForExit();throw 'Staff backend integration timed out.'};if($taskNode.ExitCode -ne 0){throw ('Staff backend integration failed: '+$taskErr.GetAwaiter().GetResult())}
            $taskResult=$taskOut.GetAwaiter().GetResult() | ConvertFrom-Json;Assert ($taskResult.Status -eq 'PASS' -and $taskResult.CaseCount -eq 7)
            $taskResult | Add-Member -NotePropertyName CheckedAtUtc -NotePropertyValue ([datetime]::UtcNow.ToString('o'))
            $taskResult | Add-Member -NotePropertyName SourceSha256 -NotePropertyValue @(@('database/migrations/017_scoped_staff_administration.sql','database/migrations/018_staff_role_audit_scope.sql','src/administration/StaffAdministrationService.ts','src/visits/SqlVisitReadRepository.ts','tests/staff-administration.sql-integration.ts','tests/helpers/StaffAdministration.SqlBridge.ps1','tools/GatePass.LocalSql.psm1') | ForEach-Object {@{File=$_;Sha256=(Get-FileHash -LiteralPath (Join-Path $taskRoot $_) -Algorithm SHA256).Hash}})
            $taskResult | ConvertTo-Json -Depth 7 | Set-Content (Join-Path $taskRoot 'database/validation/staff-administration-backend-integration.json') -Encoding utf8
        } finally {$taskNode.Dispose();foreach($taskBytes in $taskSecretBytes){[Array]::Clear($taskBytes,0,$taskBytes.Length)}}
    }
    $taskDone=$true
}
finally {
    foreach($taskC in $taskConnections){$taskC.Dispose()}
    try {Invoke-GatePassNonQuery $taskAdmin "IF OBJECT_ID('gp.StaffFixtureFault','TR') IS NOT NULL DROP TRIGGER gp.StaffFixtureFault;";Cleanup;foreach($taskU in $taskPrincipals){Invoke-GatePassNonQuery $taskAdmin ('DROP USER '+$taskU+';')};$taskClean=$true}
    finally {$taskAdmin.Dispose();[ordered]@{Status=if($taskDone -and $taskClean -and @($taskCases | Where-Object {-not $_.Passed}).Count -eq 0){'PASS'}else{'FAIL'};CheckedAtUtc=[datetime]::UtcNow.ToString('o');CaseCount=$taskCases.Count;CleanupPassed=$taskClean;ConcurrentCasesWithBothWaitersObserved=4;SourceSha256=@(@('database/migrations/017_scoped_staff_administration.sql','database/migrations/018_staff_role_audit_scope.sql','database/tests/Test-StaffAdministration.ps1','database/tests/002_transaction_fixtures.sql','database/tests/003_transaction_cleanup.sql','tools/GatePass.LocalSql.psm1') | ForEach-Object {@{File=$_;Sha256=(Get-FileHash -LiteralPath (Join-Path $taskRoot $_) -Algorithm SHA256).Hash}});Cases=@($taskCases)} | ConvertTo-Json -Depth 7 | Set-Content (Join-Path $taskRoot 'database/validation/staff-administration-report.json') -Encoding utf8}
}
if(-not $taskDone -or @($taskCases | Where-Object {-not $_.Passed}).Count){throw 'Staff administration suite failed.'}
Write-Output "All $($taskCases.Count) staff administration cases passed; owned fixture cleaned."
