#Requires -Version 7.0
[CmdletBinding()]
param([string]$Server='localhost\SQLEXPRESS',[switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskAdmin=Open-GatePassLocalSql -Server $Server -TrustLocalServerCertificate:$TrustLocalServerCertificate
$taskRun=[guid]::NewGuid();$taskActors=@{};$taskVisits=@{};$taskCases=[Collections.Generic.List[object]]::new();$taskConnections=[Collections.Generic.List[object]]::new();$taskPrincipals=[Collections.Generic.List[string]]::new()
$taskReady=$false;$taskDone=$false;$taskClean=$false
function Assert($Value,[string]$Message='Unexpected administration read result.') {if (-not $Value) {throw $Message}}
function Expect([scriptblock]$Action,[int]$Number=53101) {try {$null=& $Action} catch {if ($_.Exception.GetBaseException() -is [Data.SqlClient.SqlException] -and $_.Exception.GetBaseException().Number -eq $Number) {return};throw};throw "Expected SQL error $Number."}
function Auth([string]$Actor='RECEPTION') {return @{SessionHash=[Convert]::FromHexString($taskActors[$Actor].SessionHex);CsrfHash=[Convert]::FromHexString($taskActors[$Actor].CsrfHex)}}
function Call($Connection,[string]$Procedure,[hashtable]$Parameters) {$taskArgs=($Parameters.Keys | ForEach-Object {'@'+$_+'=@'+$_}) -join ',';return (Invoke-GatePassScalar $Connection ('EXEC '+$Procedure+' '+$taskArgs) $Parameters) | ConvertFrom-Json}
function Cleanup {
    if ($taskReady) {
        Invoke-GatePassNonQuery $taskAdmin 'IF @@TRANCOUNT>0 ROLLBACK;'
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

function Reset-Base {
    Cleanup
    # Preserve unrelated development data; assert exact fixture deltas against its baseline.
    $script:taskBaseline=(Invoke-GatePassScalar $taskAdmin @'
DECLARE @l int=(SELECT LocationId FROM gp.Locations WHERE LocationCode='NOIDA'),@day date=CONVERT(date,DATEADD(minute,330,SYSUTCDATETIME()));
SELECT (SELECT COUNT_BIG(*) FROM gp.VisitRequests WHERE LocationId=@l AND LocalVisitDate=@day) total,
 (SELECT COUNT_BIG(*) FROM gp.VisitRequests WHERE LocationId=@l AND LocalVisitDate=@day AND Status='PENDING') pending,
 (SELECT COUNT_BIG(*) FROM gp.VisitRequests WHERE LocationId=@l AND LocalVisitDate=@day AND Status='APPROVED') approved,
 (SELECT COUNT_BIG(*) FROM gp.VisitRequests v JOIN gp.VisitPresence p ON p.VisitRequestId=v.VisitRequestId WHERE v.LocationId=@l AND v.RequestType<>'TEMP_ID' AND p.IsInside=1) projectInside,
 (SELECT COUNT_BIG(*) FROM(SELECT DISTINCT ep.EmployeeId FROM gp.EmployeeProjectPresence ep JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=ep.ProjectLocationId WHERE pl.LocationId=@l AND ep.IsInside=1) e) digitalInside
FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;
'@)|ConvertFrom-Json
    $script:taskFixture=(Invoke-GatePassScalar $taskAdmin ([IO.File]::ReadAllText((Join-Path $PSScriptRoot '002_transaction_fixtures.sql'))) @{RunId=$taskRun}) | ConvertFrom-Json
    $script:taskReady=$true;foreach($taskA in $taskFixture.actors){$taskActors[$taskA.Label]=$taskA};foreach($taskV in $taskFixture.visits){$taskVisits[$taskV.Label]=$taskV}
    $script:taskPairB=[long](Invoke-GatePassScalar $taskAdmin 'SELECT ProjectLocationId FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId WHERE p.ExternalProjectCode=@code AND pl.LocationId=@loc;' @{code=$taskFixture.prefix+'-B';loc=[int]$taskFixture.locationId})
    Invoke-GatePassNonQuery $taskAdmin @'
INSERT gp.StaffRoleGrants(UserId,RoleCode,ScopeType,GrantedByUserId,ValidFromUtc) VALUES(@host,'INDIA_ADMIN','INDIA',@host,DATEADD(hour,-1,SYSUTCDATETIME()));
DECLARE @id bigint=SCOPE_IDENTITY();
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) VALUES(@id,'ROLE_GRANTS_MANAGE'),(@id,'GUARDS_MANAGE');
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT RoleGrantId,'VISITS_READ' FROM gp.StaffRoleGrants WHERE UserId IN(@guard,@guard2) AND NOT EXISTS(SELECT 1 FROM gp.GrantCapabilities c WHERE c.RoleGrantId=gp.StaffRoleGrants.RoleGrantId AND c.CapabilityCode='VISITS_READ');
'@ @{host=[guid]$taskActors.HOST.UserId;guard=[guid]$taskActors.GUARD.UserId;guard2=[guid]$taskActors.GUARD2.UserId}
}

function Reset {
    Reset-Base
    Invoke-GatePassNonQuery $taskAdmin @'
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT g.RoleGrantId,c.Code FROM gp.StaffRoleGrants g CROSS JOIN(VALUES('REPORTS_READ'),('AUDIT_READ'))c(Code) WHERE g.UserId=@admin OR g.UserId=@host AND g.RoleCode='INDIA_ADMIN';
INSERT gp.StaffRoleGrants(UserId,RoleCode,ScopeType,ProjectId,GrantedByUserId,ValidFromUtc) VALUES(@projectAdmin,'PROJECT_ADMIN','PROJECT',@project,@host,DATEADD(hour,-1,SYSUTCDATETIME()));
DECLARE @id bigint=SCOPE_IDENTITY();INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) VALUES(@id,'GUARDS_MANAGE'),(@id,'REPORTS_READ'),(@id,'AUDIT_READ');
'@ @{admin=[guid]$taskActors.ADMIN.UserId;host=[guid]$taskActors.HOST.UserId;projectAdmin=[guid]$taskActors.OTHERHOST.UserId;project=[long]$taskFixture.projectId}
    $script:taskDay=Invoke-GatePassScalar $taskAdmin "SELECT CONVERT(char(10),DATEADD(minute,330,SYSUTCDATETIME()),23);"
}
function Projects-Parameters([string]$Actor='ADMIN') {$taskP=Auth $Actor;$taskP.LocationId=[int]$taskFixture.locationId;$taskP.PageSize=50;return $taskP}
function Guards-Parameters([string]$Actor='ADMIN') {$taskP=Auth $Actor;$taskP.ProjectLocationId=$taskPairB;$taskP.NamePrefix='Synthetic';$taskP.PageSize=50;return $taskP}
function Summary-Parameters([string]$Actor='ADMIN') {$taskP=Auth $Actor;$taskP.LocationId=[int]$taskFixture.locationId;$taskP.LocalVisitDate=$taskDay;return $taskP}
function Summary([string]$Actor='ADMIN') {return Call $taskApi 'gp.GetOperationalSummary' (Summary-Parameters $Actor)}
function Audit-Parameters([string]$Actor='ADMIN') {$taskP=Auth $Actor;$taskP.FromUtc=[datetime]::UtcNow.AddMinutes(-10);$taskP.UntilUtc=[datetime]::UtcNow.AddSeconds(1);$taskP.PageSize=50;return $taskP}
function Search-Parameters([string]$Actor='HOST') {$taskP=Auth $Actor;$taskP.NamePrefix='Synthetic';$taskP.PageSize=50;return $taskP}
function Roles-Parameters([string]$Actor='HOST') {$taskP=Auth $Actor;$taskP.TargetUserId=[guid]$taskActors.GUARD2.UserId;$taskP.PageSize=50;return $taskP}
function Seed-Audit {
    Invoke-GatePassNonQuery $taskAdmin @'
DECLARE @grant bigint=(SELECT RoleGrantId FROM gp.StaffRoleGrants WHERE UserId=@projectAdmin AND RoleCode='PROJECT_ADMIN');
INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode,MetadataJson) VALUES
(@actor,'FIXTURE_PAIR_A','VISIT',CONVERT(varchar(36),@visit),@loc,@pairA,'SUCCESS',N'{"PRIVATE":"credential and contact text"}'),
(@actor,'FIXTURE_PAIR_B','VISIT',CONVERT(varchar(36),@visit),@loc,@pairB,'SUCCESS',NULL),
(@actor,'FIXTURE_OFFICE','ADMIN_QUERY',NULL,@loc,NULL,'SUCCESS',NULL),
(@actor,'FIXTURE_SYSTEM','OPERATION',NULL,NULL,NULL,'ERROR',N'{"projectId":1,"PRIVATE":"never infer scope"}'),
(@actor,'FIXTURE_PROJECT_ROLE','ROLE_GRANT',CONVERT(varchar(100),@grant),NULL,NULL,'SUCCESS',NULL);
'@ @{actor=[guid]$taskActors.HOST.UserId;projectAdmin=[guid]$taskActors.OTHERHOST.UserId;visit=[guid]$taskVisits.MOVEMENT.VisitId;loc=[int]$taskFixture.locationId;pairA=[long]$taskFixture.projectLocationId;pairB=$taskPairB}
}
function Seed-Inside([string]$Label) {
    if($Label -eq 'TEMP'){
        $p=Auth 'GUARD';$p.ClientKey=[guid]::NewGuid();$p.VisitRequestId=[guid]$taskVisits.TEMP.VisitId;$p.AccessPassId=[guid]$taskVisits.TEMP.PassId;$p.LocationId=[int]$taskFixture.locationId;$p.DutyKind='PROJECT';$p.DutyId=[long]$taskFixture.projectLocationId;$p.EventType='ENTRY';$p.EntryMethod='MANUAL'
        $null=Call $taskApi 'gp.RecordGuardDutyMovement' $p;return
    }
    Invoke-GatePassNonQuery $taskAdmin @'
DECLARE @now datetime2(3)=SYSUTCDATETIME(),@op uniqueidentifier=NEWID(),@occurred datetime2(3)=(SELECT ValidFromUtc FROM gp.VisitRequests WHERE VisitRequestId=@visit);
INSERT gp.IdempotencyRequests(OperationId,ActorBindingHash,OperationCode,ClientKey,PayloadHash,Status,ResultJson,CompletedAtUtc,ExpiresAtUtc)
VALUES(@op,HASHBYTES('SHA2_256',CONVERT(binary(16),@actor)),'FIXTURE_MOVEMENT',NEWID(),HASHBYTES('SHA2_256','synthetic'),'COMPLETED','{}',@now,DATEADD(day,1,@now));
INSERT gp.AccessEvents(VisitRequestId,AccessPassId,ActorUserId,LocationId,EventType,EntryMethod,OperationId,OccurredAtUtc,RecordedAtUtc)
VALUES(@visit,@pass,@actor,@loc,'ENTRY','MANUAL',@op,@occurred,@now);
UPDATE gp.VisitPresence SET IsInside=1,LastAccessEventId=SCOPE_IDENTITY(),LastMovementAtUtc=@occurred WHERE VisitRequestId=@visit;
'@ @{visit=[guid]$taskVisits[$Label].VisitId;pass=[guid]$taskVisits[$Label].PassId;actor=[guid]$taskActors.GUARD.UserId;loc=[int]$taskFixture.locationId}
}
function Observe-Wait([scriptblock]$Mutation) {
    $taskP=Summary-Parameters;$taskCommand=New-GatePassSqlCommand $taskApi 'EXEC gp.GetOperationalSummary @SessionHash,@CsrfHash,@LocationId,@LocalVisitDate;' $taskP
    $taskSid=Invoke-GatePassScalar $taskApi 'SELECT @@SPID;'
    Invoke-GatePassNonQuery $taskAdmin "BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';"
    try {$taskPending=$taskCommand.ExecuteScalarAsync();$taskDeadline=[datetime]::UtcNow.AddSeconds(3);$taskWaiting=0
        do {$taskWaiting=Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM sys.dm_exec_requests WHERE session_id=@sid AND wait_type LIKE N'LCK_M%';" @{sid=$taskSid};if($taskWaiting){break};[Threading.Thread]::Sleep(20)}while([datetime]::UtcNow -lt $taskDeadline)
        Assert ($taskWaiting -eq 1) 'Read was not observed waiting at the authorization gate.';$null=& $Mutation;Invoke-GatePassNonQuery $taskAdmin 'COMMIT;'
        Expect {$taskPending.GetAwaiter().GetResult()} 52001
    }finally{Invoke-GatePassNonQuery $taskAdmin 'IF @@TRANCOUNT>0 ROLLBACK;';$taskCommand.Dispose()}
}
function Case([string]$Name,[scriptblock]$Action) {try {Reset;$null=& $Action;$taskCases.Add(@{Name=$Name;Passed=$true});Write-Output "PASS: $Name"} catch {$taskCases.Add(@{Name=$Name;Passed=$false;Error=$_.Exception.Message});Write-Output "FAIL: $Name -- $($_.Exception.Message)"}}
try {
    foreach($taskSpec in @(@('gp_aread_api_fixture','gp_api_runtime'),@('gp_aread_media_fixture','gp_media_runtime'),@('gp_aread_worker_fixture','gp_worker_runtime'),@('gp_aread_auth_fixture','gp_guard_auth_runtime'),@('gp_aread_render_fixture','gp_render_runtime'))) {
        Invoke-GatePassNonQuery $taskAdmin ('CREATE USER '+$taskSpec[0]+' WITHOUT LOGIN;ALTER ROLE '+$taskSpec[1]+' ADD MEMBER '+$taskSpec[0]+';');$taskPrincipals.Add($taskSpec[0]);$taskC=Open-GatePassLocalSql -Server $Server -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $taskC ("EXECUTE AS USER='"+$taskSpec[0]+"';");$taskConnections.Add($taskC)
    }
    $taskApi=$taskConnections[0]
    Case 'Other runtime identities cannot invoke any administration read contract' {
        $taskSpecs=@(@('gp.ListAdminProjectLocations',(Projects-Parameters)),@('gp.ListAdminGuards',(Guards-Parameters)),@('gp.SearchStaffSubjects',(Search-Parameters)),@('gp.ListStaffRoles',(Roles-Parameters)),@('gp.GetOperationalSummary',(Summary-Parameters)),@('gp.ListScopedAuditEvents',(Audit-Parameters)))
        foreach($taskC in @($taskConnections[1],$taskConnections[2],$taskConnections[3],$taskConnections[4])){foreach($taskSpec in $taskSpecs){Expect {Call $taskC $taskSpec[0] $taskSpec[1]} 229}}
    }
    Case 'API has no direct reads of users grants audit or private functions' {foreach($taskTable in @('Users','StaffRoleGrants','SecurityAuditEvents')){Expect {Invoke-GatePassScalar $taskApi ('SELECT COUNT(*) FROM gp.'+$taskTable+';')} 229};Expect {Invoke-GatePassScalar $taskApi 'SELECT gp._AdminScopeAllowed(NEWID(),''AUDIT_READ'',NULL,NULL,SYSUTCDATETIME());'} 229}
    Case 'Location admin project selector stays inside the chosen office' {$taskR=Call $taskApi 'gp.ListAdminProjectLocations' (Projects-Parameters);Assert (@($taskR.projects | Where-Object {$_.locationId -ne $taskFixture.locationId}).Count -eq 0);Assert (@($taskR.projects | Where-Object {$_.projectLocationId -eq $taskPairB.ToString()}).Count -eq 1)}
    Case 'Project admin selector includes only their project within that office' {$taskR=Call $taskApi 'gp.ListAdminProjectLocations' (Projects-Parameters OTHERHOST);Assert ($taskR.projects.Count -eq 1 -and $taskR.projects[0].projectLocationId -eq $taskFixture.projectLocationId.ToString())}
    Case 'Project paging is authorized before hasMore and stable keyset continuation' {$taskP=Projects-Parameters OTHERHOST;$taskP.PageSize=1;$taskR=Call $taskApi 'gp.ListAdminProjectLocations' $taskP;Assert (-not $taskR.hasMore);$taskP=Projects-Parameters;$taskP.PageSize=1;$taskR=Call $taskApi 'gp.ListAdminProjectLocations' $taskP;Assert $taskR.hasMore;$taskP.AfterProjectLocationId=[long]$taskR.afterProjectLocationId;$taskNext=Call $taskApi 'gp.ListAdminProjectLocations' $taskP;Assert ($taskNext.projects[0].projectLocationId -ne $taskR.projects[0].projectLocationId)}
    Case 'Role administrator may select scopes without inheriting allocation permission' {Invoke-GatePassNonQuery $taskAdmin "DELETE c FROM gp.GrantCapabilities c JOIN gp.StaffRoleGrants g ON g.RoleGrantId=c.RoleGrantId WHERE g.UserId=@id AND c.CapabilityCode='GUARDS_MANAGE';" @{id=[guid]$taskActors.HOST.UserId};$taskR=Call $taskApi 'gp.ListAdminProjectLocations' (Projects-Parameters HOST);Assert ($taskR.projects.Count -gt 0 -and @($taskR.projects | Where-Object canAllocate).Count -eq 0)}
    Case 'Stale project remains visible but cannot suggest allocation' {Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.Projects SET LastSyncedAtUtc=DATEADD(day,-1,SYSUTCDATETIME()) WHERE ProjectId=@id;' @{id=[long]$taskFixture.projectId};$taskR=Call $taskApi 'gp.ListAdminProjectLocations' (Projects-Parameters OTHERHOST);Assert (-not $taskR.projects[0].canAllocate)}
    Case 'Guard selector shows only whole-interval eligible same-office guards' {$taskR=Call $taskApi 'gp.ListAdminGuards' (Guards-Parameters);Assert ($taskR.guards.Count -eq 3 -and @($taskR.guards | Where-Object canAllocate).Count -eq 2);Assert ($taskR.guards.Where({$_.userId -eq $taskActors.WRONGPROJECT.UserId})[0].overlappingAssignment)}
    Case 'Existing same-pair overlap is explicit while other-project assignments do not block' {$taskP=Guards-Parameters;$taskP.ProjectLocationId=[long]$taskFixture.projectLocationId;$taskR=Call $taskApi 'gp.ListAdminGuards' $taskP;Assert ($taskR.guards.Count -eq 3 -and @($taskR.guards | Where-Object overlappingAssignment).Count -eq 2);Assert ($taskR.guards.Where({$_.userId -eq $taskActors.WRONGPROJECT.UserId})[0].canAllocate)}
    Case 'Project admin cannot browse guard candidates at another project' {Expect {Call $taskApi 'gp.ListAdminGuards' (Guards-Parameters OTHERHOST)} 52001}
    Case 'Finite guard role cannot be combined into unlimited coverage' {Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.StaffRoleGrants SET ValidUntilUtc=DATEADD(hour,2,SYSUTCDATETIME()) WHERE UserId=@id;' @{id=[guid]$taskActors.GUARD2.UserId};$taskR=Call $taskApi 'gp.ListAdminGuards' (Guards-Parameters);Assert ($taskR.guards.Count -eq 2 -and @($taskR.guards|Where-Object userId -eq $taskActors.GUARD2.UserId).Count -eq 0);$taskP=Guards-Parameters;$taskP.ValidUntilUtc=[datetime]::UtcNow.AddHours(1);Assert ((Call $taskApi 'gp.ListAdminGuards' $taskP).guards.Count -eq 3)}
    Case 'Guard prefix percent and underscore are literals rather than wildcards' {Invoke-GatePassNonQuery $taskAdmin "UPDATE gp.Users SET DisplayName=N'Sy%literal' WHERE UserId=@id;" @{id=[guid]$taskActors.GUARD2.UserId};$taskP=Guards-Parameters;$taskP.NamePrefix='Sy%';Assert ((Call $taskApi 'gp.ListAdminGuards' $taskP).guards.Count -eq 1);$taskP.NamePrefix='Sy_';Assert ((Call $taskApi 'gp.ListAdminGuards' $taskP).guards.Count -eq 0)}
    Case 'Global role subject search excludes identity issuers contacts tokens and passwords' {$taskR=Call $taskApi 'gp.SearchStaffSubjects' (Search-Parameters);Assert ($taskR.users.Count -eq 14 -and (($taskR | ConvertTo-Json -Depth 6) -notmatch 'OfficialEmail|IdentityIssuer|SessionHash|Password|Phone'))}
    Case 'Subject search literal prefix and cursor support inactive accounts without escalation' {$taskP=Search-Parameters;$taskP.PageSize=1;$taskR=Call $taskApi 'gp.SearchStaffSubjects' $taskP;Assert $taskR.hasMore;$taskP.AfterUserId=[guid]$taskR.afterUserId;$taskNext=Call $taskApi 'gp.SearchStaffSubjects' $taskP;Assert ($taskNext.users[0].userId -ne $taskR.users[0].userId);$taskP=Search-Parameters;$taskP.NamePrefix='Synthetic BLOCKED';Assert (-not (Call $taskApi 'gp.SearchStaffSubjects' $taskP).users[0].active)}
    Case 'Scoped administrator cannot enumerate global staff subjects or role history' {Expect {Call $taskApi 'gp.SearchStaffSubjects' (Search-Parameters ADMIN)} 52001;Expect {Call $taskApi 'gp.ListStaffRoles' (Roles-Parameters OTHERHOST)} 52001}
    Case 'Role page returns explicit capabilities and omits authentication and audit payloads' {$taskR=Call $taskApi 'gp.ListStaffRoles' (Roles-Parameters);Assert ($taskR.grants.Count -eq 1 -and $taskR.grants[0].capabilities.Count -eq 3 -and $taskR.grants[0].roleCode -eq 'GUARD');Assert (($taskR | ConvertTo-Json -Depth 7) -notmatch 'Metadata|Session|Credential|OfficialEmail')}
    Case 'CURRENT role mode excludes revoked rows while ALL retains history' {Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.StaffRoleGrants SET RevokedAtUtc=SYSUTCDATETIME(),RevokedByUserId=@actor WHERE UserId=@id;' @{actor=[guid]$taskActors.HOST.UserId;id=[guid]$taskActors.GUARD2.UserId};$taskP=Roles-Parameters;Assert ((Call $taskApi 'gp.ListStaffRoles' $taskP).grants.Count -eq 0);$taskP.State='ALL';Assert ((Call $taskApi 'gp.ListStaffRoles' $taskP).grants[0].revoked)}
    Case 'Location report has consistent status counts without visitor details' {$taskR=Summary;Assert ($taskR.visits.total -eq [string]([long]$taskBaseline.total+24) -and $taskR.visits.pending -eq [string]([long]$taskBaseline.pending+9) -and $taskR.visits.approved -eq [string]([long]$taskBaseline.approved+15) -and $taskR.recordedPresence.projectVisitsInside -eq [string]$taskBaseline.projectInside);Assert (($taskR | ConvertTo-Json) -notmatch 'PersonName|Email|Host|Photo|credential')}
    Case 'Project report excludes office Digital IDs and other projects' {$taskR=Summary OTHERHOST;Assert ($taskR.visits.total -eq '22' -and $taskR.recordedPresence.digitalIdsInside -eq '0')}
    Case 'Report scope cannot be broadened with a different project target' {$taskP=Summary-Parameters OTHERHOST;$taskP.ProjectLocationId=$taskPairB;Expect {Call $taskApi 'gp.GetOperationalSummary' $taskP} 52001}
    Case 'Expired cancelled visitors and current Digital ID project occupants remain counted separately' {Seed-Inside EXIT_EXPIRED;Seed-Inside TEMP;$taskP=Auth HOST;$taskP.ClientKey=[guid]::NewGuid();$taskP.VisitRequestId=[guid]$taskVisits.EXIT_EXPIRED.VisitId;$taskP.ExpectedPassId=[guid]$taskVisits.EXIT_EXPIRED.PassId;$taskP.Reason='Historical occupant remains inside';$null=Call $taskApi 'gp.CancelVisit' $taskP;$taskR=Summary;Assert ($taskR.recordedPresence.projectVisitsInside -eq [string]([long]$taskBaseline.projectInside+1) -and $taskR.recordedPresence.digitalIdsInside -eq [string]([long]$taskBaseline.digitalInside+1) -and $taskR.visits.total -eq [string]([long]$taskBaseline.total+24));Assert ((Summary OTHERHOST).recordedPresence.digitalIdsInside -eq '1')}
    Case 'Export capability alone does not imply report-read authority' {Invoke-GatePassNonQuery $taskAdmin "DELETE FROM gp.GrantCapabilities WHERE RoleGrantId=@id AND CapabilityCode='REPORTS_READ';INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) VALUES(@id,'REPORTS_EXPORT');" @{id=[long]$taskActors.ADMIN.GrantId};Expect {Summary} 52001}
    Case 'Guard with forged report capability is not an administrative reader' {Invoke-GatePassNonQuery $taskAdmin "INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) VALUES(@id,'REPORTS_READ');" @{id=[long]$taskActors.GUARD.GrantId};Expect {Summary GUARD} 52001}
    Case 'Project audit sees exact project events and typed project-wide role events only' {Seed-Audit;$taskR=Call $taskApi 'gp.ListScopedAuditEvents' (Audit-Parameters OTHERHOST);Assert ($taskR.events.Count -eq 2 -and @($taskR.events | Where-Object {$_.actionCode -notin @('FIXTURE_PAIR_A','FIXTURE_PROJECT_ROLE')}).Count -eq 0)}
    Case 'Location audit excludes unscoped and project-wide authority events' {Seed-Audit;$taskR=Call $taskApi 'gp.ListScopedAuditEvents' (Audit-Parameters);Assert (@($taskR.events|Where-Object {$_.actionCode -like 'FIXTURE_*'}).Count -eq 3)}
    Case 'India audit sees governed system events without raw metadata or references' {Seed-Audit;$taskR=Call $taskApi 'gp.ListScopedAuditEvents' (Audit-Parameters HOST);Assert (@($taskR.events|Where-Object {$_.actionCode -like 'FIXTURE_*'}).Count -eq 5);Assert (($taskR | ConvertTo-Json -Depth 6) -notmatch 'MetadataJson|TargetReference|PRIVATE|credential|ActorUserId')}
    Case 'Pair-only auditor cannot inherit project-wide role audit visibility' {
        Invoke-GatePassNonQuery $taskAdmin @'
INSERT gp.StaffRoleGrants(UserId,RoleCode,ScopeType,ProjectLocationId,GrantedByUserId,ValidFromUtc) VALUES(@user,'PROJECT_ADMIN','PROJECT_LOCATION',@pair,@actor,DATEADD(hour,-1,SYSUTCDATETIME()));
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) VALUES(SCOPE_IDENTITY(),'AUDIT_READ');
'@ @{user=[guid]$taskActors.RECEPTION.UserId;pair=[long]$taskFixture.projectLocationId;actor=[guid]$taskActors.HOST.UserId}
        Seed-Audit;$taskR=Call $taskApi 'gp.ListScopedAuditEvents' (Audit-Parameters RECEPTION);Assert ($taskR.events.Count -eq 1 -and $taskR.events[0].actionCode -eq 'FIXTURE_PAIR_A')
    }
    Case 'Audit hasMore is scoped and continuation cannot duplicate or reveal hidden rows' {Seed-Audit;$taskP=Audit-Parameters OTHERHOST;$taskP.PageSize=1;$taskR=Call $taskApi 'gp.ListScopedAuditEvents' $taskP;Assert $taskR.hasMore;$taskP.AfterAuditEventId=[long]$taskR.afterAuditEventId;$taskNext=Call $taskApi 'gp.ListScopedAuditEvents' $taskP;Assert ($taskNext.events.Count -eq 1 -and -not $taskNext.hasMore -and $taskNext.events[0].auditEventId -ne $taskR.events[0].auditEventId)}
    Case 'Malformed prefix pages IDs state and date windows fail bounded validation' {$taskP=Projects-Parameters;$taskP.PageSize=51;Expect {Call $taskApi 'gp.ListAdminProjectLocations' $taskP} 52002;$taskP=Search-Parameters;$taskP.NamePrefix='x';Expect {Call $taskApi 'gp.SearchStaffSubjects' $taskP} 52002;$taskP=Roles-Parameters;$taskP.State='ALL ';Expect {Call $taskApi 'gp.ListStaffRoles' $taskP} 52002;$taskP=Audit-Parameters;$taskP.FromUtc=$taskP.UntilUtc.AddDays(-32);Expect {Call $taskApi 'gp.ListScopedAuditEvents' $taskP} 52002}
    Case 'Audit pair requires the matching requested location and cannot forge context' {$taskP=Audit-Parameters;$taskP.ProjectLocationId=[long]$taskFixture.projectLocationId;Expect {Call $taskApi 'gp.ListScopedAuditEvents' $taskP} 52002;$taskP.LocationId=[int]$taskFixture.otherLocationId;Expect {Call $taskApi 'gp.ListScopedAuditEvents' $taskP} 52002}
    Case 'Report date bounds and wrong office are rejected without cross-scope totals' {$taskP=Summary-Parameters;$taskP.LocalVisitDate=[datetime]::UtcNow.AddDays(-100).ToString('yyyy-MM-dd');Expect {Call $taskApi 'gp.GetOperationalSummary' $taskP} 52002;$taskP=Summary-Parameters;$taskP.LocationId=[int]$taskFixture.otherLocationId;Expect {Call $taskApi 'gp.GetOperationalSummary' $taskP} 52001}
    Case 'Expired blocked stale sessions and invalid CSRF deny reads' {foreach($taskA in @('EXPIRED','BLOCKED','STALE')){Expect {Summary $taskA} 52001};$taskP=Summary-Parameters;$taskP.CsrfHash=[byte[]]::new(32);Expect {Call $taskApi 'gp.GetOperationalSummary' $taskP} 52001}
    Case 'Read success audit failure prevents releasing summary data' {Invoke-GatePassNonQuery $taskAdmin "CREATE TRIGGER gp.AdminReadFixtureFault ON gp.SecurityAuditEvents AFTER INSERT AS IF EXISTS(SELECT 1 FROM inserted WHERE ActionCode='OPERATIONAL_SUMMARY_READ') THROW 52977,'Synthetic read audit fault.',1;";try{Expect {Summary} 52977}finally{Invoke-GatePassNonQuery $taskAdmin 'DROP TRIGGER gp.AdminReadFixtureFault;'}}
    Case 'Read rechecks expiry after an observed authorization wait' {Observe-Wait {Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.Sessions SET IdleExpiresAtUtc=DATEADD(second,-1,SYSUTCDATETIME()) WHERE UserId=@id;' @{id=[guid]$taskActors.ADMIN.UserId}}}
    Case 'Read rechecks revoked capability after an observed authorization wait' {Observe-Wait {Invoke-GatePassNonQuery $taskAdmin "DELETE FROM gp.GrantCapabilities WHERE RoleGrantId=@id AND CapabilityCode='REPORTS_READ';" @{id=[long]$taskActors.ADMIN.GrantId}}}
    Case 'Expired allocation window after observed guard-row wait releases no stale eligibility' {
        $taskP=Guards-Parameters;$taskP.ValidUntilUtc=[datetime]::UtcNow.AddSeconds(2);$taskCommand=New-GatePassSqlCommand $taskApi 'EXEC gp.ListAdminGuards @SessionHash,@CsrfHash,@ProjectLocationId,@ValidUntilUtc=@ValidUntilUtc,@NamePrefix=@NamePrefix,@PageSize=@PageSize;' $taskP;$taskSid=Invoke-GatePassScalar $taskApi 'SELECT @@SPID;'
        Invoke-GatePassNonQuery $taskAdmin 'BEGIN TRANSACTION;'
        try {Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.Users SET DisplayName=DisplayName WHERE UserId=@id;' @{id=[guid]$taskActors.GUARD2.UserId};$taskPending=$taskCommand.ExecuteScalarAsync();$taskDeadline=[datetime]::UtcNow.AddSeconds(1);$taskWaiting=0
            do {$taskWaiting=Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM sys.dm_exec_requests WHERE session_id=@sid AND wait_type LIKE N'LCK_M%';" @{sid=$taskSid};if($taskWaiting){break};[Threading.Thread]::Sleep(20)}while([datetime]::UtcNow -lt $taskDeadline)
            Assert ($taskWaiting -eq 1) 'Guard query was not observed waiting on its row.'
            while([datetime]::UtcNow -le $taskP.ValidUntilUtc){[Threading.Thread]::Sleep(20)}
            Invoke-GatePassNonQuery $taskAdmin 'COMMIT;';Expect {$taskPending.GetAwaiter().GetResult()} 52002
        }finally{Invoke-GatePassNonQuery $taskAdmin 'IF @@TRANCOUNT>0 ROLLBACK;';$taskCommand.Dispose()}
    }
    Case 'Far future bounded audit dates reject as input instead of overflowing datetime arithmetic' {
        $taskP=Audit-Parameters;$taskP.FromUtc=[datetime]'9999-12-30T00:00:00';$taskP.UntilUtc=[datetime]'9999-12-31T00:00:00';Expect {Call $taskApi 'gp.ListScopedAuditEvents' $taskP} 52002
    }
    Case 'Actual typed service interops with all six restricted administration read contracts' {
        Seed-Audit;$taskAuthData=@{};$taskSecretBytes=[Collections.Generic.List[byte[]]]::new()
        foreach($taskSpec in @(@('admin','ADMIN'),@('host','HOST'),@('projectAdmin','OTHERHOST'))) {
            $taskRaw=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);$taskCsrf=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);$taskSecretBytes.Add($taskRaw);$taskSecretBytes.Add($taskCsrf)
            Invoke-GatePassNonQuery $taskAdmin @'
DECLARE @now datetime2(3)=SYSUTCDATETIME();
INSERT gp.Sessions(SessionHash,UserId,CsrfHash,AuthorizationVersionAtIssue,LastSeenAtUtc,IdleExpiresAtUtc,AbsoluteExpiresAtUtc,CreatedAtUtc)
SELECT @session,UserId,@csrf,AuthorizationVersion,@now,DATEADD(hour,1,@now),DATEADD(hour,2,@now),@now FROM gp.Users WHERE UserId=@actor;
'@ @{session=[Security.Cryptography.SHA256]::HashData($taskRaw);csrf=[Security.Cryptography.SHA256]::HashData($taskCsrf);actor=[guid]$taskActors[$taskSpec[1]].UserId}
            $taskAuthData[$taskSpec[0]]=@{sessionToken=[Convert]::ToBase64String($taskRaw).TrimEnd('=').Replace('+','-').Replace('/','_');csrfToken=[Convert]::ToBase64String($taskCsrf).TrimEnd('=').Replace('+','-').Replace('/','_')}
        }
        $taskInfo=[Diagnostics.ProcessStartInfo]::new();$taskInfo.FileName=(Get-Command node -CommandType Application | Select-Object -First 1).Source;$taskInfo.ArgumentList.Add((Join-Path $taskRoot 'tests/administration-reads.sql-integration.ts'));$taskInfo.WorkingDirectory=$taskRoot;$taskInfo.UseShellExecute=$false;$taskInfo.CreateNoWindow=$true;$taskInfo.RedirectStandardInput=$true;$taskInfo.RedirectStandardOutput=$true;$taskInfo.RedirectStandardError=$true;$taskNode=[Diagnostics.Process]::new();$taskNode.StartInfo=$taskInfo
        try {
            $null=$taskNode.Start();$taskOut=$taskNode.StandardOutput.ReadToEndAsync();$taskErr=$taskNode.StandardError.ReadToEndAsync();$taskNode.StandardInput.Write((@{server=$Server;trustLocalCertificate=[bool]$TrustLocalServerCertificate;powerShell=(Join-Path $PSHOME 'pwsh.exe');admin=$taskAuthData.admin;host=$taskAuthData.host;projectAdmin=$taskAuthData.projectAdmin;guardUserId=$taskActors.GUARD2.UserId;projectLocationId=$taskPairB.ToString();locationId=[int]$taskFixture.locationId;day=$taskDay;fromUtc=[datetime]::UtcNow.AddMinutes(-10).ToString('yyyy-MM-ddTHH:mm:ss.fffZ');untilUtc=[datetime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')} | ConvertTo-Json -Depth 5 -Compress));$taskNode.StandardInput.Close()
            if(-not $taskNode.WaitForExit(45000)){$taskNode.Kill($true);$taskNode.WaitForExit();throw 'Admin read backend integration timed out.'};if($taskNode.ExitCode -ne 0){throw ('Admin read backend integration failed: '+$taskErr.GetAwaiter().GetResult())}
            $taskResult=$taskOut.GetAwaiter().GetResult() | ConvertFrom-Json;Assert ($taskResult.Status -eq 'PASS' -and $taskResult.CaseCount -eq 7)
            $taskResult | Add-Member -NotePropertyName CheckedAtUtc -NotePropertyValue ([datetime]::UtcNow.ToString('o'))
            $taskResult | Add-Member -NotePropertyName SourceSha256 -NotePropertyValue @(@('database/migrations/019_scoped_administration_reads.sql','database/migrations/020_admin_read_boundaries.sql','src/administration/AdministrationReadService.ts','src/visits/SqlVisitReadRepository.ts','tests/administration-reads.sql-integration.ts','tests/helpers/AdministrationReads.SqlBridge.ps1','tools/GatePass.LocalSql.psm1') | ForEach-Object {@{File=$_;Sha256=(Get-FileHash -LiteralPath (Join-Path $taskRoot $_) -Algorithm SHA256).Hash}})
            $taskResult | ConvertTo-Json -Depth 7 | Set-Content (Join-Path $taskRoot 'database/validation/administration-reads-backend-integration.json') -Encoding utf8
        } finally {$taskNode.Dispose();foreach($taskBytes in $taskSecretBytes){[Array]::Clear($taskBytes,0,$taskBytes.Length)}}
    }
    $taskDone=$true
}
finally {
    foreach($taskC in $taskConnections){$taskC.Dispose()}
    try{Invoke-GatePassNonQuery $taskAdmin "IF OBJECT_ID('gp.AdminReadFixtureFault','TR') IS NOT NULL DROP TRIGGER gp.AdminReadFixtureFault;";Cleanup;foreach($taskU in $taskPrincipals){Invoke-GatePassNonQuery $taskAdmin ('DROP USER '+$taskU+';')};$taskClean=$true}
    finally{$taskAdmin.Dispose();[ordered]@{Status=if($taskDone -and $taskClean -and @($taskCases | Where-Object {-not $_.Passed}).Count -eq 0){'PASS'}else{'FAIL'};CheckedAtUtc=[datetime]::UtcNow.ToString('o');CaseCount=$taskCases.Count;CleanupPassed=$taskClean;ObservedAuthorizationWaits=2;ObservedGuardRowWaits=1;SourceSha256=@(@('database/migrations/019_scoped_administration_reads.sql','database/migrations/020_admin_read_boundaries.sql','database/tests/Test-AdministrationReads.ps1','database/tests/002_transaction_fixtures.sql','database/tests/003_transaction_cleanup.sql','tools/GatePass.LocalSql.psm1') | ForEach-Object {@{File=$_;Sha256=(Get-FileHash -LiteralPath (Join-Path $taskRoot $_) -Algorithm SHA256).Hash}});Cases=@($taskCases)} | ConvertTo-Json -Depth 7 | Set-Content (Join-Path $taskRoot 'database/validation/administration-reads-report.json') -Encoding utf8}
}
if(-not $taskDone -or @($taskCases | Where-Object {-not $_.Passed}).Count){throw 'Administration reads suite failed.'}
Write-Output "All $($taskCases.Count) administration read cases passed; owned fixture cleaned."
