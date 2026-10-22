#Requires -Version 7.0
[CmdletBinding()]param([switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskAdmin=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate
$taskRun=[guid]::NewGuid();$taskPrincipal='gp_presence_read_'+$taskRun.ToString('N');$taskApi=$null;$taskReady=$false;$taskCreated=$false;$taskCases=0
function Assert($v,[string]$message){if(-not $v){throw $message}}
function Auth([string]$name){return @{SessionHash=[Convert]::FromHexString($actors[$name].SessionHex);CsrfHash=[Convert]::FromHexString($actors[$name].CsrfHex)}}
function Call([string]$name,[hashtable]$p){return(Invoke-GatePassScalar $taskApi ('EXEC gp.'+$name+' '+(($p.Keys|ForEach-Object{'@'+$_+'=@'+$_})-join ',')) $p)|ConvertFrom-Json}
function ExpectDenied([scriptblock]$work,[int]$number=52001){try{$null=&$work}catch{if($_.Exception.GetBaseException().Number -eq $number){return};throw};throw 'Expected denied report scope.'}
function Summary($pair=$null){$p=Auth 'ADMIN';$p.LocationId=[int]$f.locationId;$p.LocalVisitDate=[datetime]::UtcNow.AddMinutes(330).Date;if($null -ne $pair){$p.ProjectLocationId=[long]$pair};return Call 'GetOperationalSummary' $p}
function Reception($day=[datetime]::UtcNow.AddMinutes(330).Date){$p=Auth 'RECEPTION';$p.LocationId=[int]$f.locationId;$p.LocalVisitDate=$day;$p.Search=$f.prefix;return Call 'ListReceptionVisits' $p}
function Move-Presence([string]$event,[long]$pair){$p=Auth 'GUARD';$p.ClientKey=[guid]::NewGuid();$p.VisitRequestId=[guid]$temp.VisitId;$p.AccessPassId=[guid]$temp.PassId;$p.LocationId=[int]$f.locationId;$p.DutyKind='PROJECT';$p.DutyId=$pair;$p.EventType=$event;$p.EntryMethod='MANUAL';return Call 'RecordGuardDutyMovement' $p}
function Timeline($visit=$temp.VisitId){$p=Auth 'RECEPTION';$p.VisitRequestId=[guid]$visit;return Call 'GetReceptionEmployeeTimeline' $p}
function Passed([string]$message){$script:taskCases++;Write-Output ('PASS: '+$message)}
try{
 $f=(Invoke-GatePassScalar $taskAdmin (Get-Content (Join-Path $PSScriptRoot '002_transaction_fixtures.sql') -Raw) @{RunId=$taskRun})|ConvertFrom-Json;$taskReady=$true
 $actors=@{};foreach($actor in $f.actors){$actors[$actor.Label]=$actor}
 $temp=$f.visits.Where({$_.Label -eq 'TEMP'})[0];$original=$temp;$pair=[long]$f.projectLocationId
 $other=[long](Invoke-GatePassScalar $taskAdmin 'SELECT ProjectLocationId FROM gp.ProjectLocations WHERE LocationId=@l AND ProjectId<>@p AND ProjectId IN(SELECT ProjectId FROM gp.Projects WHERE ExternalProjectCode LIKE @prefix);' @{l=[int]$f.locationId;p=[long]$f.projectId;prefix=$f.prefix+'%'})
 Invoke-GatePassNonQuery $taskAdmin "INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT RoleGrantId,'REPORTS_READ' FROM gp.StaffRoleGrants WHERE UserId=@a;INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT RoleGrantId,'VISITS_READ' FROM gp.StaffRoleGrants WHERE UserId=@r AND NOT EXISTS(SELECT 1 FROM gp.GrantCapabilities c WHERE c.RoleGrantId=gp.StaffRoleGrants.RoleGrantId AND c.CapabilityCode='VISITS_READ');CREATE USER [$taskPrincipal] WITHOUT LOGIN;ALTER ROLE gp_api_runtime ADD MEMBER [$taskPrincipal];" @{a=[guid]$actors.ADMIN.UserId;r=[guid]$actors.RECEPTION.UserId};$taskCreated=$true
 $taskApi=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $taskApi "EXECUTE AS USER='$taskPrincipal';"
 $baseline=[long](Summary).recordedPresence.digitalIdsInside
 $null=Move-Presence 'ENTRY' $pair
 Assert ((Summary).recordedPresence.digitalIdsInside -eq [string]($baseline+1)) 'Office missed current employee occupant.'
 Assert ((Summary $pair).recordedPresence.digitalIdsInside -eq '1') 'Project missed current employee occupant.'
 Assert (Reception).visits.Where({$_.visitRequestId -eq $temp.VisitId})[0].isInside 'Reception missed employee project entry.'
 $timeline=Timeline;Assert ($timeline.isInside -and $timeline.movements.Count -eq 1 -and $timeline.movements[0].eventType -eq 'ENTRY' -and $timeline.movements[0].projectName) 'Reception timeline missed scoped employee entry.'
 $deniedTimeline=Auth 'GUARD';$deniedTimeline.VisitRequestId=[guid]$temp.VisitId;ExpectDenied {Call 'GetReceptionEmployeeTimeline' $deniedTimeline} 53501
 Passed 'Real guard entry is visible to reception and office/project reports'
 Invoke-GatePassNonQuery $taskAdmin 'INSERT gp.EmployeeProjectMemberships(EmployeeId,ProjectId,IsActive,VerifiedAtUtc) SELECT @e,ProjectId,1,SYSUTCDATETIME() FROM gp.ProjectLocations WHERE ProjectLocationId=@pair;INSERT gp.EmployeeProjectLocationMemberships(EmployeeId,ProjectLocationId,IsActive,VerifiedAtUtc) VALUES(@e,@pair,1,SYSUTCDATETIME());INSERT gp.GuardAssignments(GuardUserId,ProjectLocationId,AssignedByUserId,ValidFromUtc) VALUES(@g,@pair,@g,SYSUTCDATETIME());' @{e=$f.hostEmployeeId;pair=$other;g=[guid]$actors.GUARD.UserId}
 $null=Move-Presence 'ENTRY' $other
 Assert ((Summary).recordedPresence.digitalIdsInside -eq [string]($baseline+1)) 'Office counted the same employee twice.'
 Assert ((Summary $other).recordedPresence.digitalIdsInside -eq '1') 'Second project occupant missing.'
 $null=Move-Presence 'EXIT' $pair
 Assert (Reception).visits.Where({$_.visitRequestId -eq $temp.VisitId})[0].isInside 'One project exit cleared another project occupant.'
 Passed 'Independent project entries count once per office and survive a partial exit'
 Invoke-GatePassNonQuery $taskAdmin "UPDATE gp.StaffRoleGrants SET RoleCode='PROJECT_ADMIN',ScopeType='PROJECT_LOCATION',LocationId=NULL,ProjectLocationId=@pair WHERE UserId=@a AND RoleCode='LOCATION_ADMIN';" @{a=[guid]$actors.ADMIN.UserId;pair=$pair}
 Assert ((Summary).recordedPresence.digitalIdsInside -eq '0') 'Project admin saw another project occupant.'
 ExpectDenied {Summary $other}
 $p=Auth 'RECEPTION';$p.LocationId=[int]$f.otherLocationId;ExpectDenied {Call 'ListReceptionVisits' $p} 53501
 Invoke-GatePassNonQuery $taskAdmin "UPDATE gp.StaffRoleGrants SET RoleCode='LOCATION_ADMIN',ScopeType='LOCATION',LocationId=@l,ProjectLocationId=NULL WHERE UserId=@a AND RoleCode='PROJECT_ADMIN';" @{a=[guid]$actors.ADMIN.UserId;l=[int]$f.locationId}
 Passed 'Project and reception office scopes still deny unauthorized presence reads'
 $newVisit=[guid]::NewGuid();$newPass=[guid]::NewGuid();$newPhoto=[guid]::NewGuid()
 Invoke-GatePassNonQuery $taskAdmin @'
INSERT gp.PhotoAssets(PhotoAssetId,IntakeId,StorageKey,ContentHash,MimeType,ByteLength,PixelWidth,PixelHeight,CapturedAtUtc)
SELECT @photo,IntakeId,StorageKey+'-replacement',ContentHash,MimeType,ByteLength,PixelWidth,PixelHeight,CapturedAtUtc FROM gp.PhotoAssets WHERE PhotoAssetId=@oldPhoto;
INSERT gp.VisitRequests(VisitRequestId,PublicReference,IntakeId,ClientPersonKey,RequestType,EmployeeId,PersonName,PersonEmail,PhotoAssetId,LocationId,Reason,TemporaryIdReason,Status,LocalVisitDate,ValidFromUtc,ValidUntilUtc,SnapshotHash,DecisionAtUtc,SubmittedAtUtc)
SELECT @visit,@prefix+'-replacement',IntakeId,@visit,RequestType,EmployeeId,PersonName,PersonEmail,@photo,LocationId,Reason,TemporaryIdReason,Status,LocalVisitDate,ValidFromUtc,ValidUntilUtc,HASHBYTES('SHA2_256',CONVERT(binary(16),@visit)),DecisionAtUtc,SYSUTCDATETIME() FROM gp.VisitRequests WHERE VisitRequestId=@oldVisit;
INSERT gp.AccessPasses(AccessPassId,VisitRequestId,PassVersion,PublicPassNumber,CredentialHash,Status) VALUES(@pass,@visit,1,@prefix+'-replacement',HASHBYTES('SHA2_256',CONVERT(binary(16),@pass)),'ACTIVE');
INSERT gp.VisitPresence(VisitRequestId) VALUES(@visit);
'@ @{photo=$newPhoto;oldPhoto=[guid]$original.PhotoId;visit=$newVisit;oldVisit=[guid]$original.VisitId;pass=$newPass;prefix=$f.prefix}
 Assert ((Summary).recordedPresence.digitalIdsInside -eq [string]($baseline+1)) 'Replacement counted one employee twice.'
 Assert (Reception).visits.Where({$_.visitRequestId -eq $newVisit})[0].isInside 'Replacement lost original employee presence.'
 $temp=[pscustomobject]@{VisitId=$newVisit;PassId=$newPass};$null=Move-Presence 'EXIT' $other
 Assert ((Summary).recordedPresence.digitalIdsInside -eq [string]$baseline) 'Replacement exit left report occupant.'
 Assert (-not(Reception).visits.Where({$_.visitRequestId -eq $newVisit})[0].isInside) 'Replacement exit left reception inside.'
 Assert ((Timeline $newVisit).movements.Count -ge 3) 'Replacement ID lost the original employee timeline.'
 Assert (-not(Timeline $newVisit).isInside) 'Timeline kept exited employee inside.'
 Passed 'Replacement ID sees and closes the original occupant without double counting'
 $temp=$original;$null=Move-Presence 'ENTRY' $pair
 Invoke-GatePassNonQuery $taskAdmin 'UPDATE gp.VisitRequests SET LocalVisitDate=DATEADD(day,-1,LocalVisitDate),ValidFromUtc=DATEADD(day,-1,ValidFromUtc),ValidUntilUtc=DATEADD(day,-1,ValidUntilUtc) WHERE VisitRequestId=@v;' @{v=[guid]$temp.VisitId}
 Assert ((Summary $pair).recordedPresence.digitalIdsInside -eq '1') 'Today report lost an unclosed overnight occupant.'
 Assert (Reception ([datetime]::UtcNow.AddMinutes(330).Date.AddDays(-1))).visits.Where({$_.visitRequestId -eq $temp.VisitId})[0].isInside 'Historical reception lost unclosed occupant.'
 $null=Move-Presence 'EXIT' $pair
 Assert ((Summary $pair).recordedPresence.digitalIdsInside -eq '0') 'Overnight exit left report occupant.'
 Passed 'Unclosed overnight occupants remain visible until actual project exit'
 $visitor=$f.visits.Where({$_.Label -eq 'MOVEMENT'})[0];$temp=$visitor;$null=Move-Presence 'ENTRY' $pair
 Assert ((Summary $pair).recordedPresence.projectVisitsInside -eq '1') 'Visitor project occupancy regressed.'
 Assert (Reception).visits.Where({$_.visitRequestId -eq $visitor.VisitId})[0].isInside 'Visitor reception occupancy regressed.'
 $null=Move-Presence 'EXIT' $pair
 Passed 'Existing external visitor presence remains unchanged'
}finally{
 if($taskApi){$taskApi.Dispose()}
 try{if($taskReady){Invoke-GatePassNonQuery $taskAdmin (Get-Content (Join-Path $PSScriptRoot '003_transaction_cleanup.sql') -Raw) @{RunId=$taskRun}};if($taskCreated){Invoke-GatePassNonQuery $taskAdmin "DROP USER [$taskPrincipal];"}}finally{$taskAdmin.Dispose()}
}
Write-Output "PASS: $taskCases actual SQL presence read-model cases; exact owned fixtures removed."
