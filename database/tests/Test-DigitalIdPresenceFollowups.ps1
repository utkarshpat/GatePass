#Requires -Version 7.0
[CmdletBinding()]param([switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskAdmin=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate
$taskRun=[guid]::NewGuid();$taskPrincipal='gp_presence_followup_'+$taskRun.ToString('N');$taskApi=$null;$taskReady=$false;$taskCreated=$false;$taskCases=[Collections.Generic.List[object]]::new()
function Assert($value,[string]$message){if(-not $value){throw $message}}
function Expect([scriptblock]$work,[int]$number){try{$null=&$work}catch{if($_.Exception.GetBaseException() -is [Data.SqlClient.SqlException] -and $_.Exception.GetBaseException().Number -eq $number){return};throw};throw "Expected SQL $number"}
function Auth([string]$actor){return @{SessionHash=[Convert]::FromHexString($taskActors[$actor].SessionHex);CsrfHash=[Convert]::FromHexString($taskActors[$actor].CsrfHex)}}
function Call([string]$procedure,[hashtable]$parameters){$argsText=($parameters.Keys|ForEach-Object{'@'+$_+'=@'+$_}) -join ',';return(Invoke-GatePassScalar $taskApi ('EXEC gp.'+$procedure+' '+$argsText) $parameters)|ConvertFrom-Json}
function Detail([string]$actor='HOST',[string]$view='OWN'){$p=Auth $actor;$p.View=$view;$p.VisitRequestId=[guid]$taskTemp.VisitId;return Call 'GetVisitDetail' $p}
function Invoke-FixtureMovement($visit,[string]$event,[long]$pair=$taskFixture.projectLocationId){$p=Auth 'GUARD';$p.ClientKey=[guid]::NewGuid();$p.VisitRequestId=[guid]$visit.VisitId;$p.AccessPassId=[guid]$visit.PassId;$p.LocationId=[int]$taskFixture.locationId;$p.DutyKind='PROJECT';$p.DutyId=$pair;$p.EventType=$event;$p.EntryMethod='MANUAL';return Call 'RecordGuardDutyMovement' $p}
function Actions([string]$workspace='RECEPTION'){
 $p=Auth $workspace;$p.Workspace=$workspace;$p.LocationId=[int]$taskFixture.locationId;$p.DutyKind=if($workspace -eq 'GUARD'){'PROJECT'}else{'OFFICE'};$p.DutyId=if($workspace -eq 'GUARD'){[long]$taskFixture.projectLocationId}else{[long]0};$p.Category='EXPIRED_INSIDE'
 $rows=[Collections.Generic.List[object]]::new();$seen=[Collections.Generic.HashSet[string]]::new()
 do{$r=Call 'ReadActionCentre' $p;foreach($row in $r.items){$rows.Add($row)};if($r.hasMore){$key=[string]$r.afterVisitRequestId;Assert ($seen.Add($key) -and $seen.Count -lt 100) 'Unstable action cursor';$p.AfterVisitRequestId=[guid]$r.afterVisitRequestId;$p.AfterSubmittedAtUtc=[datetime]$r.afterSubmittedAtUtc}}while($r.hasMore)
 return @{items=$rows.ToArray();count=[int]$r.counts.expiredInside;unreturned=[int]$r.counts.unreturned}
}
function Case([string]$name,[scriptblock]$work){try{$null=&$work;$taskCases.Add(@{name=$name;passed=$true});Write-Output "PASS: $name"}catch{$taskCases.Add(@{name=$name;passed=$false});Write-Output "FAIL: $name -- $($_.Exception.Message)"}}
try{
 $taskFixture=(Invoke-GatePassScalar $taskAdmin (Get-Content (Join-Path $PSScriptRoot '002_transaction_fixtures.sql') -Raw) @{RunId=$taskRun})|ConvertFrom-Json;$taskReady=$true
 if($taskFixture.prefix -eq 'GP02-F8C7F73D68364B00BCA4'){throw 'Retained presentation fixture cannot be used.'}
 $taskActors=@{};foreach($a in $taskFixture.actors){$taskActors[$a.Label]=$a}
 $taskTemp=$taskFixture.visits.Where({$_.Label -eq 'TEMP'})[0];$taskVisitor=$taskFixture.visits.Where({$_.Label -eq 'MOVEMENT'})[0]
 Invoke-GatePassNonQuery $taskAdmin "INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT RoleGrantId,'VISITS_READ' FROM gp.StaffRoleGrants WHERE UserId IN(@admin,@reception);INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT RoleGrantId,'REPORTS_READ' FROM gp.StaffRoleGrants WHERE UserId=@admin;" @{admin=[guid]$taskActors.ADMIN.UserId;reception=[guid]$taskActors.RECEPTION.UserId}
 $taskOtherPair=[long](Invoke-GatePassScalar $taskAdmin 'SELECT ProjectLocationId FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId WHERE p.ExternalProjectCode=@code AND pl.LocationId=@office;' @{code=$taskFixture.prefix+'-B';office=[int]$taskFixture.locationId})
 Invoke-GatePassNonQuery $taskAdmin @'
INSERT gp.EmployeeProjectMemberships(EmployeeId,ProjectId,IsActive,VerifiedAtUtc) SELECT @employee,ProjectId,1,SYSUTCDATETIME() FROM gp.ProjectLocations WHERE ProjectLocationId=@pair;
INSERT gp.EmployeeProjectLocationMemberships(EmployeeId,ProjectLocationId,IsActive,VerifiedAtUtc) VALUES(@employee,@pair,1,SYSUTCDATETIME());
INSERT gp.GuardAssignments(GuardUserId,ProjectLocationId,AssignedByUserId,ValidFromUtc) VALUES(@guard,@pair,@host,DATEADD(minute,-1,SYSUTCDATETIME()));
'@ @{employee=$taskFixture.hostEmployeeId;pair=$taskOtherPair;guard=[guid]$taskActors.GUARD.UserId;host=[guid]$taskActors.HOST.UserId}
 $taskOld=[guid]::NewGuid();$taskOldPass=[guid]::NewGuid()
 Invoke-GatePassNonQuery $taskAdmin @'
DECLARE @day date=CONVERT(date,DATEADD(minute,330,SYSUTCDATETIME())),@photo uniqueidentifier=NEWID();
DECLARE @start datetime2(3)=DATEADD(minute,-330,CONVERT(datetime2(3),DATEADD(day,-1,@day))),@end datetime2(3)=DATEADD(minute,-330,CONVERT(datetime2(3),@day));
INSERT gp.PhotoAssets(PhotoAssetId,IntakeId,StorageKey,ContentHash,MimeType,ByteLength,PixelWidth,PixelHeight,CapturedAtUtc)
 SELECT @photo,a.IntakeId,N'test-only/'+@ref,a.ContentHash,a.MimeType,a.ByteLength,a.PixelWidth,a.PixelHeight,@start FROM gp.VisitRequests v JOIN gp.PhotoAssets a ON a.PhotoAssetId=v.PhotoAssetId WHERE v.VisitRequestId=@current;
INSERT gp.VisitRequests(VisitRequestId,PublicReference,IntakeId,ClientPersonKey,RequestType,EmployeeId,PersonName,PersonEmail,PhotoAssetId,LocationId,ProjectLocationId,HostEmployeeId,Reason,TemporaryIdReason,Status,LocalVisitDate,ValidFromUtc,ValidUntilUtc,ApprovalDeadlineUtc,SnapshotHash,DecisionAtUtc,SubmittedAtUtc)
 SELECT @old,@ref,IntakeId,@old,RequestType,EmployeeId,N'Synthetic Previous Day ID',PersonEmail,@photo,LocationId,NULL,NULL,Reason,TemporaryIdReason,'APPROVED',DATEADD(day,-1,@day),@start,@end,NULL,SnapshotHash,@start,@start FROM gp.VisitRequests WHERE VisitRequestId=@current;
INSERT gp.AccessPasses(AccessPassId,VisitRequestId,PassVersion,PublicPassNumber,CredentialHash,Status) VALUES(@pass,@old,1,@ref,CRYPT_GEN_RANDOM(32),'ACTIVE');
INSERT gp.VisitPresence(VisitRequestId) VALUES(@old);
'@ @{old=$taskOld;pass=$taskOldPass;current=[guid]$taskTemp.VisitId;ref=$taskFixture.prefix+'-OLD'}
 Invoke-GatePassNonQuery $taskAdmin "CREATE USER [$taskPrincipal] WITHOUT LOGIN;ALTER ROLE gp_api_runtime ADD MEMBER [$taskPrincipal];";$taskCreated=$true
 $taskApi=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $taskApi "EXECUTE AS USER='$taskPrincipal';"
 $baseline=@{};foreach($view in @('ADMIN','RECEPTION')){$baseline[$view]=(Actions $view).count}
 Case 'Owner and admin Digital ID details start outside' {Assert (-not (Detail).isInside -and -not (Detail 'ADMIN' 'ADMIN').isInside) 'Initial presence changed'}
 Case 'Another employee cannot read or cancel this Digital ID' {Expect {Detail 'OTHERHOST'} 52801;$p=Auth 'OTHERHOST';$p.ClientKey=[guid]::NewGuid();$p.VisitRequestId=[guid]$taskTemp.VisitId;$p.ExpectedPassId=[guid]$taskTemp.PassId;$p.Reason='Unauthorized attempt';Expect {Call 'CancelVisit' $p} 52001}
 $null=Invoke-FixtureMovement $taskTemp 'ENTRY'
 Case 'Owner Digital ID details report a real project entry' {Assert ((Detail).isInside) 'Owner detail lost project occupancy'}
 Case 'Admin and reception Digital ID details still report office presence' {Assert ((Detail 'ADMIN' 'ADMIN').isInside -and (Detail 'RECEPTION' 'RECEPTION').isInside) 'Office detail changed'}
 foreach($view in @('ADMIN','RECEPTION')){Case "$view excludes historical expired ID and its false count" {$r=Actions $view;Assert (@($r.items|Where-Object visitRequestId -eq $taskOld).Count -eq 0 -and $r.count -eq $baseline[$view]) 'Current entry created historical expired follow-up'}}
 $null=Invoke-FixtureMovement $taskTemp 'ENTRY' $taskOtherPair;$null=Invoke-FixtureMovement $taskTemp 'EXIT'
 Case 'Owner stays inside while a second project remains occupied' {Assert ((Detail).isInside) 'One project exit cleared office presence'}
 $null=Invoke-FixtureMovement $taskTemp 'EXIT' $taskOtherPair
 Case 'Final project exit reports owner outside' {Assert (-not (Detail).isInside) 'Owner remained inside after final exit'}
 $null=Invoke-FixtureMovement $taskTemp 'ENTRY'
 # Advance only this owned fixture's validity boundary after its real entry; no wall-clock wait or production update.
 Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.VisitRequests SET ValidUntilUtc=SYSUTCDATETIME() WHERE VisitRequestId=@id;' @{id=[guid]$taskTemp.VisitId}
 foreach($view in @('ADMIN','RECEPTION','GUARD')){Case "$view retains a genuinely expired current Digital ID occupant" {$r=Actions $view;Assert (@($r.items|Where-Object visitRequestId -eq $taskTemp.VisitId).Count -eq 1 -and @($r.items|Where-Object visitRequestId -eq $taskOld).Count -eq 0) 'Wrong expired occupant';if($view -ne 'GUARD'){Assert ($r.count -eq $baseline[$view]+1) 'Expired count mismatch'}else{Assert ($r.unreturned -eq 0) 'Guard received reception return follow-ups'}}}
 $p=Auth 'HOST';$p.ClientKey=[guid]::NewGuid();$p.VisitRequestId=[guid]$taskTemp.VisitId;$p.ExpectedPassId=[guid]$taskTemp.PassId;$p.Reason='Owned occupied Digital ID cancellation';$receipt=Call 'CancelVisit' $p
 Case 'Digital ID cancellation reports occupied and replays the same receipt' {Assert ($receipt.wasInsideAtCancellation -and $receipt.status -eq 'CANCELLED') 'Cancellation lost occupancy';$again=Call 'CancelVisit' $p;Assert ($again.operationId -eq $receipt.operationId -and $again.wasInsideAtCancellation) 'Retry receipt changed'}
 Case 'Cancellation audit retains true occupancy without removing actual presence' {Assert ((Invoke-GatePassScalar $taskAdmin "SELECT COUNT(*) FROM gp.SecurityAuditEvents WHERE ActionCode='VISIT_CANCELLED' AND TargetReference=@id AND JSON_VALUE(MetadataJson,'$.wasInsideAtCancellation')='true';" @{id=[string]$taskTemp.VisitId}) -eq 1) 'Audit lost occupancy';Assert ((Invoke-GatePassScalar $taskAdmin 'SELECT gp._PersonInsideOffice(@id);' @{id=[guid]$taskTemp.VisitId})) 'Cancellation erased presence'}
 Case 'Cancelled expired occupant remains a follow-up for reconciliation' {$r=Actions;Assert (@($r.items|Where-Object visitRequestId -eq $taskTemp.VisitId).Count -eq 1) 'Cancelled occupant disappeared'}
 $null=Invoke-FixtureMovement $taskVisitor 'ENTRY';Invoke-GatePassNonQuery $taskAdmin 'DECLARE @end datetime2(3)=SYSUTCDATETIME();UPDATE gp.VisitRequests SET ValidUntilUtc=@end,ApprovalDeadlineUtc=@end WHERE VisitRequestId=@id;' @{id=[guid]$taskVisitor.VisitId}
 Case 'Ordinary expired visitor presence and office count remain correct' {$r=Actions;Assert (@($r.items|Where-Object visitRequestId -eq $taskVisitor.VisitId).Count -eq 1 -and $r.count -eq $baseline.RECEPTION+2) 'Visitor presence or count changed'}
 $v=Auth 'HOST';$v.ClientKey=[guid]::NewGuid();$v.VisitRequestId=[guid]$taskVisitor.VisitId;$v.ExpectedPassId=[guid]$taskVisitor.PassId;$v.Reason='Occupied visitor control'
 Case 'Ordinary visitor cancellation retains its occupied flag' {Assert ((Call 'CancelVisit' $v).wasInsideAtCancellation) 'Visitor cancellation changed'}
 $outside=$taskFixture.visits.Where({$_.Label -eq 'PENDING'})[0];$v=Auth 'HOST';$v.ClientKey=[guid]::NewGuid();$v.VisitRequestId=[guid]$outside.VisitId;$v.ExpectedPassId=[guid]$outside.PassId;$v.Reason='Outside visitor control'
 Case 'Outside cancellation does not invent an occupant' {Assert (-not (Call 'CancelVisit' $v).wasInsideAtCancellation) 'Outside became inside'}
 Case 'Wrong-office follow-up scope is still denied' {$v=Auth 'RECEPTION';$v.Workspace='RECEPTION';$v.LocationId=[int]$taskFixture.otherLocationId;$v.DutyKind='OFFICE';$v.DutyId=[long]0;$v.Category='EXPIRED_INSIDE';Expect {Call 'ReadActionCentre' $v} 52001}
 Case 'Execute-only runtime still cannot read presence tables' {Expect {Invoke-GatePassScalar $taskApi 'SELECT COUNT(*) FROM gp.EmployeeProjectPresence;'} 229}
}finally{
 if($taskApi){try{Invoke-GatePassNonQuery $taskApi 'REVERT;'}finally{$taskApi.Dispose()}}
 try{if($taskCreated){Invoke-GatePassNonQuery $taskAdmin "DROP USER [$taskPrincipal];"};if($taskReady){Invoke-GatePassNonQuery $taskAdmin (Get-Content (Join-Path $PSScriptRoot '003_transaction_cleanup.sql') -Raw) @{RunId=$taskRun};Assert ((Invoke-GatePassScalar $taskAdmin 'SELECT COUNT(*) FROM gp.VisitRequests WHERE PublicReference LIKE @prefix;' @{prefix=$taskFixture.prefix+'-%'}) -eq 0) 'Owned cleanup failed'}}finally{$taskAdmin.Dispose()}
}
$failed=@($taskCases|Where-Object passed -eq $false).Count
@{Status=if($failed){'FAIL'}else{'PASS'};Cases=$taskCases.Count;Failed=$failed;RestrictedRuntime=$true;OwnedCleanup=$true}|ConvertTo-Json -Compress
if($failed){exit 1}
