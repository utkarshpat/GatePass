#Requires -Version 7.0
[CmdletBinding()]
param([switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskAdmin=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate
$taskRun=[guid]::NewGuid();$taskCases=[Collections.Generic.List[object]]::new();$taskPrincipal='gp_duty_test_'+$taskRun.ToString('N');$taskApi=$null;$taskReady=$false;$taskCreated=$false;$taskClean=$false
function Assert($v,[string]$message){if(-not $v){throw $message}}
function SqlNumber($e){$b=$e.GetBaseException();if($b -is [Data.SqlClient.SqlException]){return $b.Number};return 0}
function Expect([scriptblock]$work,[int]$number){try{$null=&$work}catch{if((SqlNumber $_.Exception) -eq $number){return};throw};throw "Expected SQL $number"}
function Case([string]$name,[scriptblock]$work){try{$null=&$work;$taskCases.Add(@{name=$name;passed=$true});Write-Output "PASS: $name"}catch{$taskCases.Add(@{name=$name;passed=$false});Write-Output "FAIL: $name -- $($_.Exception.Message)"}}
function Auth([string]$name='GUARD'){return @{SessionHash=[Convert]::FromHexString($taskActors[$name].SessionHex);CsrfHash=[Convert]::FromHexString($taskActors[$name].CsrfHex)}}
function Call([string]$name,[hashtable]$p){$argsText=($p.Keys|ForEach-Object{'@'+$_+'=@'+$_})-join ',';return(Invoke-GatePassScalar $taskApi ('EXEC gp.'+$name+' '+$argsText) $p)|ConvertFrom-Json}
function Read-Duty([string]$kind='PROJECT',[long]$id=$taskPair,[string]$actor='GUARD',[guid]$visit=$taskTemp.VisitId){$p=Auth $actor;$p.LocationId=$taskLocation;$p.DutyKind=$kind;$p.DutyId=$id;$p.VisitRequestId=$visit;return Call 'ReadGuardDutyPass' $p}
function Move-Duty([string]$event='ENTRY',[long]$id=$taskPair,[guid]$key=[guid]::NewGuid(),[string]$method='MANUAL'){$p=Auth;$p.ClientKey=$key;$p.VisitRequestId=[guid]$taskTemp.VisitId;$p.AccessPassId=[guid]$taskTemp.PassId;$p.LocationId=$taskLocation;$p.DutyKind='PROJECT';$p.DutyId=$id;$p.EventType=$event;$p.EntryMethod=$method;if($method -eq 'RECONCILE'){$p.Reason='Observed project departure'};return Call 'RecordGuardDutyMovement' $p}
try{
 $taskFixture=(Invoke-GatePassScalar $taskAdmin (Get-Content (Join-Path $PSScriptRoot '002_transaction_fixtures.sql') -Raw) @{RunId=$taskRun})|ConvertFrom-Json
 $taskReady=$true;$taskActors=@{};foreach($a in $taskFixture.actors){$taskActors[$a.Label]=$a}
 $taskTemp=$taskFixture.visits.Where({$_.Label -eq 'TEMP'})[0];$taskPending=$taskFixture.visits.Where({$_.Label -eq 'PENDING'})[0]
 $taskLocation=[int]$taskFixture.locationId;$taskPair=[long]$taskFixture.projectLocationId
 $taskOtherPair=[long](Invoke-GatePassScalar $taskAdmin 'SELECT ProjectLocationId FROM gp.ProjectLocations WHERE LocationId=@l AND ProjectId<>@p AND ProjectId IN(SELECT ProjectId FROM gp.Projects WHERE ExternalProjectCode LIKE @prefix);' @{l=$taskLocation;p=[long]$taskFixture.projectId;prefix=$taskFixture.prefix+'%'})
 Invoke-GatePassNonQuery $taskAdmin "INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT RoleGrantId,'RECONCILE_EXIT' FROM gp.StaffRoleGrants WHERE UserId=@g;" @{g=[guid]$taskActors.GUARD.UserId}
 $taskCommon=[long](Invoke-GatePassScalar $taskAdmin 'SELECT CommonAreaId FROM gp.CommonAreas WHERE AreaName=@n;' @{n=$taskFixture.prefix+' Common A'})
 $taskCommonOnly=[long](Invoke-GatePassScalar $taskAdmin 'SELECT CommonAreaId FROM gp.CommonAreas WHERE AreaName=@n;' @{n=$taskFixture.prefix+' Common B'})
 Invoke-GatePassNonQuery $taskAdmin "CREATE USER [$taskPrincipal] WITHOUT LOGIN;ALTER ROLE gp_api_runtime ADD MEMBER [$taskPrincipal];";$taskCreated=$true
 $taskApi=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $taskApi "EXECUTE AS USER='$taskPrincipal';"
 Case 'Runtime cannot read or modify duty, presence or project event tables' {
  foreach($t in @('CommonAreas','GuardCommonAreaAssignments','EmployeeProjectPresence','EmployeeProjectAccessEvents')){Expect {Invoke-GatePassScalar $taskApi "SELECT COUNT(*) FROM gp.$t;"} 229;Expect {Invoke-GatePassNonQuery $taskApi "DELETE gp.$t WHERE 1=0;"} 229}
 }
 Case 'Common-only, project-only and mixed guard rosters are distinct' {
  $p=Auth 'NOCAP';$p.LocationId=$taskLocation;$r=Call 'ListGuardDuties' $p;Assert ($r.duties.Count -eq 1 -and $r.duties[0].kind -eq 'COMMON') 'Common-only guard inherited projects.'
  $p=Auth 'GUARD2';$p.LocationId=$taskLocation;$r=Call 'ListGuardDuties' $p;Assert ($r.duties.Count -gt 0 -and @($r.duties|Where-Object kind -eq COMMON).Count -eq 0) 'Project-only guard inherited common areas.'
  $p=Auth;$p.LocationId=$taskLocation;$r=Call 'ListGuardDuties' $p;Assert (@($r.duties|Where-Object kind -eq COMMON).Count -eq 1 -and @($r.duties|Where-Object kind -eq PROJECT).Count -eq 1) 'Mixed guard roster missing.'
 }
 Case 'Pending visitors can be verified in common areas without gaining project movement' {
  $r=Read-Duty 'COMMON' $taskCommon 'GUARD' $taskPending.VisitId;Assert ($r.outcome -eq 'VALID' -and $r.visit.commonAccessAllowed -and $r.visit.verificationOnly -and -not $r.visit.canEnter -and -not $r.visit.canExit -and -not $r.visit.isInside) 'Common verification changed approval/presence policy.'
  $r=Read-Duty 'PROJECT' $taskPair 'GUARD' $taskPending.VisitId;Assert ($r.outcome -eq 'PENDING' -and -not $r.visit.canEnter) 'Pending visitor could enter project.'
 }
 Case 'Cancelled visitor and employee project occupants retain reasoned reconciliation only' {
  foreach($label in @('MOVEMENT','EMP_DISABLED')){
   $visit=$taskFixture.visits.Where({$_.Label -eq $label})[0]
   $p=Auth;$p.ClientKey=[guid]::NewGuid();$p.VisitRequestId=[guid]$visit.VisitId;$p.AccessPassId=[guid]$visit.PassId;$p.LocationId=$taskLocation;$p.DutyKind='PROJECT';$p.DutyId=$taskPair;$p.EventType='ENTRY';$p.EntryMethod='MANUAL';$null=Call 'RecordGuardDutyMovement' $p
   $cancel=Auth 'HOST';$cancel.ClientKey=[guid]::NewGuid();$cancel.VisitRequestId=[guid]$visit.VisitId;$cancel.ExpectedPassId=[guid]$visit.PassId;$cancel.Reason='Owned cancelled occupant';$null=Call 'CancelVisit' $cancel
   $r=Read-Duty 'PROJECT' $taskPair 'GUARD' $visit.VisitId;Assert ($r.visit.isInside -and -not $r.visit.canExit -and $r.visit.canReconcileExit) 'Cancelled project occupant lost reconciliation.'
   $limited=Read-Duty 'PROJECT' $taskPair 'GUARD2' $visit.VisitId;Assert (-not $limited.visit.canReconcileExit) 'Guard without capability inherited reconciliation.'
   $common=Read-Duty 'COMMON' $taskCommon 'GUARD' $visit.VisitId;Assert (-not $common.visit.canReconcileExit -and -not $common.visit.canExit) 'Common duty inherited exit.'
   $p.ClientKey=[guid]::NewGuid();$p.EventType='EXIT';Expect {Call 'RecordGuardDutyMovement' $p} 52005
   $p.ClientKey=[guid]::NewGuid();$p.EntryMethod='RECONCILE';$p.Reason='Observed departure';$denied=$p.Clone();$otherAuth=Auth 'GUARD2';$denied.SessionHash=$otherAuth.SessionHash;$denied.CsrfHash=$otherAuth.CsrfHash;$denied.ClientKey=[guid]::NewGuid();Expect {Call 'RecordGuardDutyMovement' $denied} 52001;$exit=Call 'RecordGuardDutyMovement' $p;Assert (-not $exit.isInside) 'Authorized reconciliation did not close visitor presence.'
  }
 }
 Case 'Revoked visitor and employee project credentials retain reconciliation without normal exit' {
  foreach($label in @('RECON_REVOKED','EMP_STALE')){
   $visit=$taskFixture.visits.Where({$_.Label -eq $label})[0]
   $p=Auth;$p.ClientKey=[guid]::NewGuid();$p.VisitRequestId=[guid]$visit.VisitId;$p.AccessPassId=[guid]$visit.PassId;$p.LocationId=$taskLocation;$p.DutyKind='PROJECT';$p.DutyId=$taskPair;$p.EventType='ENTRY';$p.EntryMethod='MANUAL';$null=Call 'RecordGuardDutyMovement' $p
   Invoke-GatePassNonQuery $taskAdmin "UPDATE gp.AccessPasses SET Status='REVOKED',RevokedAtUtc=SYSUTCDATETIME(),RevocationReason=N'Owned audit' WHERE AccessPassId=@p;" @{p=[guid]$visit.PassId}
   $r=Read-Duty 'PROJECT' $taskPair 'GUARD' $visit.VisitId;Assert ($r.visit.isInside -and -not $r.visit.canExit -and $r.visit.canReconcileExit) 'Revoked project occupant lost reconciliation.'
   $p.ClientKey=[guid]::NewGuid();$p.EventType='EXIT';$p.EntryMethod='RECONCILE';$p.Reason='Observed departure';$null=Call 'RecordGuardDutyMovement' $p
  }
 }
 Case 'Common area duty cannot write an entry or exit event' {
  $p=Auth;$p.ClientKey=[guid]::NewGuid();$p.VisitRequestId=[guid]$taskTemp.VisitId;$p.AccessPassId=[guid]$taskTemp.PassId;$p.LocationId=$taskLocation;$p.DutyKind='COMMON';$p.DutyId=$taskCommon;$p.EventType='ENTRY';$p.EntryMethod='MANUAL';Expect {Call 'RecordGuardDutyMovement' $p} 52002
  Assert ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.EmployeeProjectAccessEvents WHERE VisitRequestId=@v;' @{v=[guid]$taskTemp.VisitId}) -eq 0) 'Common duty mutated presence.'
 }
 Case 'Unknown and out-of-duty QR reads return the same neutral result' {
  $p=Auth;$p.LocationId=$taskLocation;$p.DutyKind='COMMON';$p.DutyId=$taskCommon;$p.CredentialHash=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);$p.CorrelationId=[guid]::NewGuid();$r=Call 'ReadGuardDutyPass' $p;Assert ($r.outcome -eq 'NOT_AVAILABLE' -and -not $r.PSObject.Properties['visit']) 'Unknown QR leaked a visit.'
  $r=Read-Duty 'PROJECT' $taskOtherPair 'WRONGPROJECT';Assert ($r.outcome -eq 'NOT_AVAILABLE' -and -not $r.PSObject.Properties['visit']) 'Unassigned employee project leaked a visit.'
  Expect {Read-Duty 'COMMON' $taskCommonOnly} 52001
 }
 Case 'Digital ID office movement shortcut is closed' {
  $p=Auth;$p.ClientKey=[guid]::NewGuid();$p.VisitRequestId=[guid]$taskTemp.VisitId;$p.AccessPassId=[guid]$taskTemp.PassId;$p.LocationId=$taskLocation;$p.EventType='ENTRY';$p.EntryMethod='MANUAL';Expect {Call 'RecordMovement' $p} 52001
 }
 Case 'Same Digital ID has independent presence in two explicitly assigned projects' {
  Invoke-GatePassNonQuery $taskAdmin 'INSERT gp.EmployeeProjectMemberships(EmployeeId,ProjectId,IsActive,VerifiedAtUtc) SELECT @e,ProjectId,1,SYSUTCDATETIME() FROM gp.ProjectLocations WHERE ProjectLocationId=@pair;INSERT gp.EmployeeProjectLocationMemberships(EmployeeId,ProjectLocationId,IsActive,VerifiedAtUtc) VALUES(@e,@pair,1,SYSUTCDATETIME());INSERT gp.GuardAssignments(GuardUserId,ProjectLocationId,AssignedByUserId,ValidFromUtc) VALUES(@g,@pair,@g,SYSUTCDATETIME());' @{e=$taskFixture.hostEmployeeId;pair=$taskOtherPair;g=[guid]$taskActors.GUARD.UserId}
  $script:taskEntryKey=[guid]::NewGuid();$a=Move-Duty 'ENTRY' $taskPair $taskEntryKey;Assert $a.isInside 'Project entry failed.'
  Assert ((Move-Duty 'ENTRY' $taskPair $taskEntryKey).operationId -eq $a.operationId) 'Retry duplicated movement.'
  Expect {Move-Duty 'ENTRY' $taskPair} 52005
  Assert (-not (Read-Duty 'PROJECT' $taskOtherPair).visit.isInside) 'Project A entry leaked into project B.'
  $null=Move-Duty 'ENTRY' $taskOtherPair;Assert ((Read-Duty).visit.isInside -and (Read-Duty 'PROJECT' $taskOtherPair).visit.isInside) 'Independent project presence missing.'
  $r=Read-Duty 'COMMON' $taskCommon;Assert (-not $r.visit.isInside -and $r.visit.commonAccessAllowed) 'Cafeteria inherited project occupancy.'
  Assert (-not(Invoke-GatePassScalar $taskAdmin 'SELECT IsInside FROM gp.VisitPresence WHERE VisitRequestId=@v;' @{v=[guid]$taskTemp.VisitId})) 'Project movement became campus presence.'
  $null=Move-Duty 'EXIT' $taskOtherPair;Assert (Read-Duty).visit.isInside 'Project B exit removed project A presence.'
 }
 Case 'Inside queue belongs to the guard who recorded the current project entry' {
  foreach($actor in @('GUARD','GUARD2')){$p=Auth $actor;$p.LocationId=$taskLocation;$p.DutyKind='PROJECT';$p.DutyId=$taskPair;$p.Queue='INSIDE';$r=Call 'ListGuardDutyVisitors' $p;Assert (@($r.visitors|Where-Object visitRequestId -eq $taskTemp.VisitId).Count -eq $(if($actor -eq 'GUARD'){1}else{0})) 'Inside roster ownership changed.'}
 }
 Case 'Revoked employee project assignment blocks cached entry but permits departure' {
  try{Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.EmployeeProjectLocationMemberships SET IsActive=0 WHERE EmployeeId=@e AND ProjectLocationId=@p;' @{e=$taskFixture.hostEmployeeId;p=$taskPair};Expect {Move-Duty 'ENTRY' $taskPair $taskEntryKey} 52004;$r=Read-Duty;Assert ($r.visit.canExit -and -not $r.visit.canEnter) 'Revocation stranded an occupant.';$null=Move-Duty 'EXIT'}
  finally{Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.EmployeeProjectLocationMemberships SET IsActive=1,VerifiedAtUtc=SYSUTCDATETIME() WHERE EmployeeId=@e AND ProjectLocationId=@p;' @{e=$taskFixture.hostEmployeeId;p=$taskPair}}
 }
 Case 'Revoked credential requires explicit audited project exit reconciliation' {
  $null=Move-Duty
  try{Invoke-GatePassNonQuery $taskAdmin "UPDATE gp.AccessPasses SET Status='REVOKED',RevokedAtUtc=SYSUTCDATETIME(),RevocationReason=N'Owned test' WHERE AccessPassId=@p;" @{p=[guid]$taskTemp.PassId};$r=Read-Duty;Assert ($r.visit.canReconcileExit -and -not $r.visit.canExit) 'Reconciliation permission missing.';Expect {Move-Duty 'EXIT'} 52005;$null=Move-Duty 'EXIT' $taskPair ([guid]::NewGuid()) 'RECONCILE'}
  finally{Invoke-GatePassNonQuery $taskAdmin "UPDATE gp.AccessPasses SET Status='ACTIVE',RevokedAtUtc=NULL,RevocationReason=NULL WHERE AccessPassId=@p;" @{p=[guid]$taskTemp.PassId}}
 }
 Case 'Replacement Digital ID resolves the original employee project occupant without duplicate entry' {
  $original=$taskTemp;$newVisit=[guid]::NewGuid();$newPass=[guid]::NewGuid();$newPhoto=[guid]::NewGuid()
  $null=Move-Duty
  try {
   Invoke-GatePassNonQuery $taskAdmin @'
INSERT gp.PhotoAssets(PhotoAssetId,IntakeId,StorageKey,ContentHash,MimeType,ByteLength,PixelWidth,PixelHeight,CapturedAtUtc)
SELECT @photo,IntakeId,StorageKey+'-replacement',ContentHash,MimeType,ByteLength,PixelWidth,PixelHeight,CapturedAtUtc FROM gp.PhotoAssets WHERE PhotoAssetId=@oldPhoto;
INSERT gp.VisitRequests(VisitRequestId,PublicReference,IntakeId,ClientPersonKey,RequestType,EmployeeId,PersonName,PersonEmail,PhotoAssetId,LocationId,Reason,TemporaryIdReason,Status,LocalVisitDate,ValidFromUtc,ValidUntilUtc,SnapshotHash,DecisionAtUtc,SubmittedAtUtc)
SELECT @visit,@prefix+'-replacement',IntakeId,@visit,RequestType,EmployeeId,PersonName,PersonEmail,@photo,LocationId,Reason,TemporaryIdReason,Status,LocalVisitDate,ValidFromUtc,ValidUntilUtc,HASHBYTES('SHA2_256',CONVERT(binary(16),@visit)),DecisionAtUtc,SYSUTCDATETIME() FROM gp.VisitRequests WHERE VisitRequestId=@oldVisit;
INSERT gp.AccessPasses(AccessPassId,VisitRequestId,PassVersion,PublicPassNumber,CredentialHash,Status) VALUES(@pass,@visit,1,@prefix+'-replacement',HASHBYTES('SHA2_256',CONVERT(binary(16),@pass)),'ACTIVE');
INSERT gp.VisitPresence(VisitRequestId) VALUES(@visit);
'@ @{photo=$newPhoto;oldPhoto=[guid]$original.PhotoId;visit=$newVisit;oldVisit=[guid]$original.VisitId;pass=$newPass;prefix=$taskFixture.prefix}
   $taskTemp=[pscustomobject]@{VisitId=$newVisit;PassId=$newPass}
   $r=Read-Duty;Assert ($r.visit.isInside -and $r.visit.canExit -and -not $r.visit.canEnter) 'Replacement lost the existing occupant.'
   Expect {Move-Duty} 52005
   $p=Auth;$p.LocationId=$taskLocation;$p.DutyKind='PROJECT';$p.DutyId=$taskPair;$p.Queue='INSIDE';$r=Call 'ListGuardDutyVisitors' $p
   Assert (@($r.visitors|Where-Object {$_.visitRequestId -in @($original.VisitId,$newVisit)}).Count -eq 1) 'Replacement duplicated the Inside card.'
   $exitKey=[guid]::NewGuid();$exit=Move-Duty 'EXIT' $taskPair $exitKey;Assert (-not $exit.isInside) 'Replacement did not close the original entry.'
   Assert ((Move-Duty 'EXIT' $taskPair $exitKey).operationId -eq $exit.operationId) 'Replacement exit retry changed its receipt.'
   Assert ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.EmployeeProjectAccessEvents WHERE VisitRequestId=@old AND PresentedVisitRequestId=@new AND AccessPassId=@pass AND EventType=''EXIT'';' @{old=[guid]$original.VisitId;new=$newVisit;pass=$newPass}) -eq 1) 'Exit lost entry source or presented credential binding.'
   Expect {Move-Duty 'EXIT'} 52005
  } finally {$taskTemp=$original}
 }
 Case 'Scoped admin creates and assigns common areas with idempotency and revocation' {
  $p=Auth 'ADMIN';$p.ClientKey=[guid]::NewGuid();$p.LocationId=$taskLocation;$p.Action='CREATE_AREA';$p.AreaName=$taskFixture.prefix+' Managed';$p.Reason='Owned test';$r=Call 'ManageCommonDuty' $p;Assert ((Call 'ManageCommonDuty' $p).areaId -eq $r.areaId) 'Create retry duplicated area.';$p.Reason='Changed';Expect {Call 'ManageCommonDuty' $p} 52003
  $script:taskManagedArea=[long]$r.areaId;$p=Auth 'ADMIN';$p.ClientKey=[guid]::NewGuid();$p.LocationId=$taskLocation;$p.Action='ASSIGN';$p.AreaId=$taskManagedArea;$p.GuardUserId=[guid]$taskActors.NOCAP.UserId;$p.Reason='Owned shift';$r=Call 'ManageCommonDuty' $p
  Expect {Read-Duty 'COMMON' $taskManagedArea 'NOCAP'} 52001
  $version=Invoke-GatePassScalar $taskAdmin 'SELECT AuthorizationVersion FROM gp.Users WHERE UserId=@u;' @{u=[guid]$taskActors.NOCAP.UserId}
  Assert ($version -eq 2) 'Common assignment did not invalidate the old session exactly once.'
  $null=Call 'ManageCommonDuty' $p
  Assert ((Invoke-GatePassScalar $taskAdmin 'SELECT AuthorizationVersion FROM gp.Users WHERE UserId=@u;' @{u=[guid]$taskActors.NOCAP.UserId}) -eq $version) 'Assignment retry invalidated sessions twice.'
  # Simulate re-authentication only for this owned fixture session after proving the old binding is denied.
  Invoke-GatePassNonQuery $taskAdmin 'UPDATE s SET AuthorizationVersionAtIssue=u.AuthorizationVersion FROM gp.Sessions s JOIN gp.Users u ON u.UserId=s.UserId WHERE s.SessionHash=@s AND u.UserId=@u;' @{s=[Convert]::FromHexString($taskActors.NOCAP.SessionHex);u=[guid]$taskActors.NOCAP.UserId}
  Assert (Read-Duty 'COMMON' $taskManagedArea 'NOCAP').visit.commonAccessAllowed 'Common-only guard could not verify ID after re-authentication.'
  $p=Auth 'ADMIN';$p.ClientKey=[guid]::NewGuid();$p.LocationId=$taskLocation;$p.Action='REMOVE';$p.AssignmentId=[long]$r.assignmentId;$p.Reason='Shift ended';$null=Call 'ManageCommonDuty' $p;Expect {Read-Duty 'COMMON' $taskManagedArea 'NOCAP'} 52001
  Assert ((Invoke-GatePassScalar $taskAdmin 'SELECT AuthorizationVersion FROM gp.Users WHERE UserId=@u;' @{u=[guid]$taskActors.NOCAP.UserId}) -eq ($version+1)) 'Common removal did not invalidate the re-authenticated session.'
 }
 Case 'Location admin cannot manage another office or assign its guard across offices' {
  $p=Auth 'ADMIN';$p.ClientKey=[guid]::NewGuid();$p.LocationId=[int]$taskFixture.otherLocationId;$p.Action='CREATE_AREA';$p.AreaName=$taskFixture.prefix+' Forbidden';$p.Reason='Owned test';Expect {Call 'ManageCommonDuty' $p} 52001
  $p.LocationId=$taskLocation;$p.Action='ASSIGN';$p.Remove('AreaName');$p.AreaId=$taskCommon;$p.GuardUserId=[guid]$taskActors.WRONGLOCATION.UserId;Expect {Call 'ManageCommonDuty' $p} 52001
 }
 Case 'Padded duty values and oversized management inputs are rejected without truncation' {
  $p=Auth;$p.LocationId=$taskLocation;$p.DutyKind='PROJECT ';$p.DutyId=$taskPair;$p.VisitRequestId=[guid]$taskTemp.VisitId;Expect {Call 'ReadGuardDutyPass' $p} 52002
  $p=Auth 'ADMIN';$p.ClientKey=[guid]::NewGuid();$p.LocationId=$taskLocation;$p.Action='CREATE_AREA';$p.AreaName='x'*101;$p.Reason='Owned test';Expect {Call 'ManageCommonDuty' $p} 52002
 }
 Case 'Two independent guards racing a Digital ID project entry commit exactly once' {
  $connections=[Collections.Generic.List[object]]::new();$commands=[Collections.Generic.List[object]]::new();$tasks=[Collections.Generic.List[object]]::new();$results=[Collections.Generic.List[object]]::new();$gate=$false
  try {
   foreach($actor in @('GUARD','GUARD2')){$c=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $c "EXECUTE AS USER='$taskPrincipal';";$connections.Add($c);$p=Auth $actor;$p.ClientKey=[guid]::NewGuid();$p.VisitRequestId=[guid]$taskTemp.VisitId;$p.AccessPassId=[guid]$taskTemp.PassId;$p.LocationId=$taskLocation;$p.DutyKind='PROJECT';$p.DutyId=$taskPair;$p.EventType='ENTRY';$p.EntryMethod='MANUAL';$arguments=($p.Keys|ForEach-Object{'@'+$_+'=@'+$_})-join ',';$commands.Add((New-GatePassSqlCommand $c ('EXEC gp.RecordGuardDutyMovement '+$arguments) $p))}
   $sid1=Invoke-GatePassScalar $connections[0] 'SELECT @@SPID;';$sid2=Invoke-GatePassScalar $connections[1] 'SELECT @@SPID;'
   Invoke-GatePassNonQuery $taskAdmin 'BEGIN TRANSACTION;';$gate=$true;Invoke-GatePassNonQuery $taskAdmin 'EXEC gp._TakeLock @r;' @{r=('gp:visit:'+([string]$taskTemp.VisitId).ToLowerInvariant())}
   foreach($cmd in $commands){$tasks.Add($cmd.ExecuteScalarAsync())}
   $deadline=[datetime]::UtcNow.AddSeconds(5);do{$waiting=Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM sys.dm_exec_requests WHERE session_id IN(@a,@b) AND wait_type LIKE 'LCK_M%';" @{a=$sid1;b=$sid2};if($waiting -eq 2){break};[Threading.Thread]::Sleep(25)}while([datetime]::UtcNow -lt $deadline)
   Assert ($waiting -eq 2) 'Both project movement contenders did not reach the SQL lock gate.'
   Invoke-GatePassNonQuery $taskAdmin 'COMMIT;';$gate=$false
   foreach($t in $tasks){try{$null=$t.GetAwaiter().GetResult();$results.Add(@{success=$true;number=0})}catch{$results.Add(@{success=$false;number=(SqlNumber $_.Exception)})}}
   Assert (@($results|Where-Object success).Count -eq 1 -and @($results|Where-Object number -eq 52005).Count -eq 1) 'Racing project entries did not serialize.'
   $null=Move-Duty 'EXIT'
  }finally{if($gate){Invoke-GatePassNonQuery $taskAdmin 'IF @@TRANCOUNT>0 ROLLBACK;'};foreach($cmd in $commands){$cmd.Dispose()};foreach($c in $connections){$c.Dispose()}}
 }
 Case 'Audit failure rolls project presence, event and idempotency back together' {
  $trigger='DutyAudit_'+$taskRun.ToString('N');$created=$false;$before=Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.EmployeeProjectAccessEvents WHERE VisitRequestId=@v;' @{v=[guid]$taskTemp.VisitId}
  try{Invoke-GatePassNonQuery $taskAdmin ("CREATE TRIGGER gp."+$trigger+" ON gp.SecurityAuditEvents AFTER INSERT AS BEGIN IF EXISTS(SELECT 1 FROM inserted WHERE ActionCode='PROJECT_MOVEMENT' AND ActorUserId='"+$taskActors.GUARD.UserId+"') THROW 52996,'Owned audit failure',1; END;");$created=$true;Expect {Move-Duty} 52996;Assert (-not(Read-Duty).visit.isInside) 'Audit failure left an occupant.';Assert ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.EmployeeProjectAccessEvents WHERE VisitRequestId=@v;' @{v=[guid]$taskTemp.VisitId}) -eq $before) 'Audit failure left a committed event.'}
  finally{if($created){Invoke-GatePassNonQuery $taskAdmin ('DROP TRIGGER gp.'+$trigger+';')}}
 }
 Case 'Primary office is explicit, not the first office by database ID' {
  Assert ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.EmployeeOfficeMemberships WHERE EmployeeId=@e AND IsPrimary=1;' @{e=$taskFixture.hostEmployeeId}) -eq 0) 'Migration invented a primary office for legacy data.'
 }
}finally{
 if($taskApi){$taskApi.Dispose()}
 try{Invoke-GatePassNonQuery $taskAdmin 'IF @@TRANCOUNT>0 ROLLBACK;';if($taskReady){Invoke-GatePassNonQuery $taskAdmin (Get-Content (Join-Path $PSScriptRoot '003_transaction_cleanup.sql') -Raw) @{RunId=$taskRun}};if($taskCreated){Invoke-GatePassNonQuery $taskAdmin "DROP USER [$taskPrincipal];"};$taskClean=$true}finally{$taskAdmin.Dispose()}
 [ordered]@{status=if($taskClean -and $taskCases.Count -gt 0 -and @($taskCases|Where-Object {-not $_.passed}).Count -eq 0){'PASS'}else{'FAIL'};cases=@($taskCases);cleanedOwnedFixtures=$taskClean}|ConvertTo-Json -Depth 5|Set-Content (Join-Path $taskRoot 'database/validation/guard-duty-report.json')
}
if(@($taskCases|Where-Object {-not $_.passed}).Count){throw 'Guard duty integration failed.'}
Write-Output "PASS: $($taskCases.Count) actual SQL duty cases; exact owned fixtures removed."
