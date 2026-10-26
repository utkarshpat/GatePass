#Requires -Version 7.0
[CmdletBinding()]param([switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $root 'tools/GatePass.LocalSql.psm1') -Force
$c=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate
$run=[guid]::NewGuid();$principal='gp_groups_'+$run.ToString('N');$api=$null;$f=$null;$created=$false
function Assert($v,$m){if(-not $v){throw $m}}
function Expect([scriptblock]$work,[int]$n){try{$null=&$work}catch{if($_.Exception.GetBaseException().Number -eq $n){return};throw};throw "Expected SQL $n"}
function Call($sql,$p){(Invoke-GatePassScalar $api $sql $p)|ConvertFrom-Json}
try{
 $f=(Invoke-GatePassScalar $c (Get-Content (Join-Path $PSScriptRoot '002_transaction_fixtures.sql') -Raw) @{RunId=$run})|ConvertFrom-Json
 $admin=$f.actors.Where({$_.Label -eq 'ADMIN'})[0];$guard=$f.actors.Where({$_.Label -eq 'GUARD'})[0];$guard2=$f.actors.Where({$_.Label -eq 'GUARD2'})[0];$wrong=$f.actors.Where({$_.Label -eq 'WRONGLOCATION'})[0]
 Invoke-GatePassNonQuery $c "CREATE USER [$principal] WITHOUT LOGIN;ALTER ROLE gp_api_runtime ADD MEMBER [$principal];";$created=$true
 $api=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $api "EXECUTE AS USER='$principal';"
 $p=@{s=[Convert]::FromHexString($admin.SessionHex);c=[Convert]::FromHexString($admin.CsrfHex);l=[int]$f.locationId}
 $pair=[long]$f.projectLocationId
 $other=[long](Invoke-GatePassScalar $c 'SELECT pl.ProjectLocationId FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId WHERE p.ExternalProjectCode=@code AND pl.LocationId=@l;' @{code=$f.prefix+'-B';l=$p.l})
 $foreign=[long](Invoke-GatePassScalar $c 'SELECT ProjectLocationId FROM gp.ProjectLocations WHERE ProjectId=@project AND LocationId=@location;' @{project=[long]$f.projectId;location=[int]$f.otherLocationId})
 $read='EXEC gp.GetAdminProjectGroups @SessionHash=@s,@CsrfHash=@c,@LocationId=@l;'
 $save='EXEC gp.ManageProjectGroup @SessionHash=@s,@CsrfHash=@c,@ClientKey=@key,@LocationId=@l,@Action=@action,@ProjectGroupId=@id,@ExpectedRevision=@revision,@GroupName=@name,@ProjectLocationIdsJson=@members,@Reason=N''Owned group verification'';'
 $assign='EXEC gp.ManageProjectGroupGuard @SessionHash=@s,@CsrfHash=@c,@ClientKey=@key,@LocationId=@l,@ProjectGroupId=@id,@ExpectedRevision=@revision,@Action=@action,@GuardUserId=@guard,@GroupAssignmentId=@binding,@ValidUntilUtc=@until,@Reason=N''Owned group duty verification'';'
 $g=$p.Clone();$g.key=[guid]::NewGuid();$g.action='SAVE';$g.id=$null;$g.revision=$null;$g.name=$f.prefix+' Floor 11 Main';$g.members='["'+$pair+'","'+$other+'"]'
 $r=Call $save $g;$id=[long]$r.groupId;Assert ($r.revision -eq 1) 'Create revision missing'
 $cached=Call $save $g;Assert ($cached.operationId -eq $r.operationId) 'Create replay duplicated group'
 $g.key=[guid]::NewGuid();Expect {Call $save $g} 52003
 $bad=$g.Clone();$bad.key=[guid]::NewGuid();$bad.name=$f.prefix+' bad';$bad.members='["'+$foreign+'"]';Expect {Call $save $bad} 52004
 $bad.members='["'+$pair+'","'+$pair+'"]';Expect {Call $save $bad} 52002
 $list=Call $read $p;Assert ($list.groups.Where({$_.groupId -eq [string]$id}).Count -eq 1) 'Office group list missing'
 Write-Output 'PASS: scoped create/read, duplicate names, idempotent replay and cross-office/duplicate projects'
 $a=$p.Clone();$a.key=[guid]::NewGuid();$a.id=$id;$a.revision=1;$a.action='ASSIGN';$a.guard=[guid]$guard.UserId;$a.binding=$null;$a.until=$null
 $bad=$a.Clone();$bad.guard=[guid]$wrong.UserId;Expect {Call $assign $bad} 52004
 $r=Call $assign $a;$binding=[long]$r.groupAssignmentId;Assert ($r.revision -eq 2) 'Assignment revision missing'
 $same=Call $assign $a;Assert ($same.groupAssignmentId -eq $r.groupAssignmentId) 'Assign replay duplicated binding'
 $a.key=[guid]::NewGuid();$a.revision=2;Expect {Call $assign $a} 52003
 $guardArgs=@{s=[Convert]::FromHexString($guard.SessionHex);c=[Convert]::FromHexString($guard.CsrfHex);l=$p.l}
 $duties='EXEC gp.ListGuardDuties @SessionHash=@s,@CsrfHash=@c,@LocationId=@l;'
 $r=Call $duties $guardArgs;Assert ($r.duties.Where({$_.kind -eq 'PROJECT' -and $_.dutyId -eq [string]$pair}).Count -eq 1) 'Direct/group overlap duplicated project'
 Assert ($r.duties.Where({$_.kind -eq 'PROJECT' -and $_.dutyId -eq [string]$other}).Count -eq 1) 'Group project unavailable in current session'
 $child=[long](Invoke-GatePassScalar $c 'SELECT MIN(GuardAssignmentId) FROM gp.GuardAssignments WHERE GroupAssignmentId=@b;' @{b=$binding})
 $del=$p.Clone();$del.Remove('l');$del.key=[guid]::NewGuid();$del.assignment=$child
 Expect {Call 'EXEC gp.DeallocateGuard @SessionHash=@s,@CsrfHash=@c,@ClientKey=@key,@GuardAssignmentId=@assignment,@Reason=N''Must remove group source'';' $del} 52003
 Write-Output 'PASS: group assignment, wrong-office guard rejection, live session, deduplicated duties and source-aware removal'
 # A second independent group also grants Beta to the same guard.
 $second=$g.Clone();$second.key=[guid]::NewGuid();$second.name=$f.prefix+' North Entry';$second.members='["'+$other+'"]'
 $r=Call $save $second;$secondId=[long]$r.groupId
 $a2=$a.Clone();$a2.key=[guid]::NewGuid();$a2.id=$secondId;$a2.revision=1;$r=Call $assign $a2;$secondBinding=[long]$r.groupAssignmentId
 # Remove Beta from the first group; the second group must keep Beta effective.
 $g.id=$id;$g.revision=2;$g.key=[guid]::NewGuid();$g.members='["'+$pair+'"]';$r=Call $save $g;Assert ($r.revision -eq 3) 'Edit revision missing'
 $r=Call $duties $guardArgs;Assert ($r.duties.Where({$_.kind -eq 'PROJECT' -and $_.dutyId -eq [string]$other}).Count -eq 1) 'Removing one source revoked another group'
 # Archive the second group; Beta disappears on the next API read, without re-login.
 $second.id=$secondId;$second.revision=2;$second.key=[guid]::NewGuid();$second.action='ARCHIVE';$second.name=$null;$second.members=$null;$null=Call $save $second
 $r=Call $duties $guardArgs;Assert ($r.duties.Where({$_.kind -eq 'PROJECT' -and $_.dutyId -eq [string]$other}).Count -eq 0) 'Archived group left access active'
 # Replace Alpha with Beta: direct Alpha must survive, and Beta must be added live.
 $g.key=[guid]::NewGuid();$g.revision=3;$g.members='["'+$other+'"]';$r=Call $save $g
 $r=Call $duties $guardArgs;Assert ($r.duties.Where({$_.kind -eq 'PROJECT' -and $_.dutyId -in @([string]$pair,[string]$other)}).Count -eq 2) 'Live add/remove lost direct access'
 $stale=$g.Clone();$stale.key=[guid]::NewGuid();Expect {Call $save $stale} 52003
 Write-Output 'PASS: dynamic membership, overlapping groups, archive revocation, direct access preservation and stale edit fencing'
 # Individual assignment may coexist even when the project already comes from a group.
 $direct=$p.Clone();$direct.Remove('l');$direct.key=[guid]::NewGuid();$direct.guard=[guid]$guard.UserId;$direct.pair=$other
 $directResult=Call 'EXEC gp.AllocateGuard @SessionHash=@s,@CsrfHash=@c,@ClientKey=@key,@GuardUserId=@guard,@ProjectLocationId=@pair,@Reason=N''Independent direct source'';' $direct
 Assert ($directResult.status -eq 'ALLOCATED') 'Group blocked independent direct assignment'
 $remove=$a.Clone();$remove.key=[guid]::NewGuid();$remove.revision=4;$remove.action='REMOVE';$remove.guard=$null;$remove.binding=$binding;$r=Call $assign $remove
 Assert ((Invoke-GatePassScalar $c 'SELECT COUNT(*) FROM gp.GuardAssignments WHERE GuardAssignmentId=@id AND DeallocatedAtUtc IS NULL;' @{id=[long]$directResult.assignmentId}) -eq 1) 'Group removal revoked direct assignment'
 Assert ((Invoke-GatePassScalar $c 'SELECT COUNT(*) FROM gp.GuardAssignments WHERE GroupAssignmentId=@binding AND DeallocatedAtUtc IS NULL;' @{binding=$binding}) -eq 0) 'Group removal left child assignments'
 Write-Output 'PASS: direct assignment after group assignment and group removal preserve independent provenance'
 # Local projects retain migration 086's non-expiring policy in both assignment paths.
 $local=[long](Invoke-GatePassScalar $c @'
INSERT gp.Projects(ExternalProjectCode,ProjectName,IsLocallyManaged,LastSyncedAtUtc) VALUES(@code,N'Owned local group project',1,DATEADD(day,-365,SYSUTCDATETIME()));
DECLARE @project bigint=SCOPE_IDENTITY();INSERT gp.ProjectLocations(ProjectId,LocationId) VALUES(@project,@l);SELECT CONVERT(bigint,SCOPE_IDENTITY());
'@ @{code=$f.prefix+'-C';l=$p.l})
 $localGroup=$g.Clone();$localGroup.key=[guid]::NewGuid();$localGroup.id=$null;$localGroup.revision=$null;$localGroup.name=$f.prefix+' Local Projects';$localGroup.members='["'+$local+'"]';$r=Call $save $localGroup
 $localAssign=$a.Clone();$localAssign.key=[guid]::NewGuid();$localAssign.id=[long]$r.groupId;$localAssign.revision=1;$null=Call $assign $localAssign
 $direct.key=[guid]::NewGuid();$direct.pair=$local;$r=Call 'EXEC gp.AllocateGuard @SessionHash=@s,@CsrfHash=@c,@ClientKey=@key,@GuardUserId=@guard,@ProjectLocationId=@pair,@Reason=N''Local group and individual coverage'';' $direct
 Assert ($r.status -eq 'ALLOCATED') 'Persistent local project was rejected by individual allocation'
 Write-Output 'PASS: stale directory timestamp on locally managed project permits both group and individual allocation'
 # One edit fans out to multiple guards, preserving their existing sessions.
 $many=$g.Clone();$many.key=[guid]::NewGuid();$many.id=$null;$many.revision=$null;$many.name=$f.prefix+' Multiple Guards';$many.members='["'+$pair+'"]';$r=Call $save $many;$many.id=[long]$r.groupId
 $a3=$a.Clone();$a3.key=[guid]::NewGuid();$a3.id=$many.id;$a3.revision=1;$null=Call $assign $a3
 $a3.key=[guid]::NewGuid();$a3.guard=[guid]$guard2.UserId;$a3.revision=2;$null=Call $assign $a3
 $many.key=[guid]::NewGuid();$many.revision=3;$many.members='["'+$pair+'","'+$other+'"]';$null=Call $save $many
 Assert ((Invoke-GatePassScalar $c 'SELECT COUNT(*) FROM gp.GuardAssignments a JOIN gp.ProjectGroupGuardAssignments b ON b.GroupAssignmentId=a.GroupAssignmentId WHERE b.ProjectGroupId=@id AND a.DeallocatedAtUtc IS NULL;' @{id=$many.id}) -eq 4) 'Multiple guards did not receive all projects atomically'
 $guard2Args=@{s=[Convert]::FromHexString($guard2.SessionHex);c=[Convert]::FromHexString($guard2.CsrfHex);l=$p.l};$r=Call $duties $guard2Args
 Assert ($r.duties.Where({$_.kind -eq 'PROJECT' -and $_.dutyId -eq [string]$other}).Count -eq 1) 'Second guard did not see new access in existing session'
 # Expiring a role immediately denies existing group access, and cannot be revived by adding projects.
 Invoke-GatePassNonQuery $c 'UPDATE gp.StaffRoleGrants SET ValidUntilUtc=DATEADD(millisecond,-1,SYSUTCDATETIME()) WHERE RoleGrantId=@g;' @{g=[long]$guard2.GrantId}
 Expect {Call $duties $guard2Args} 52001
 $many.key=[guid]::NewGuid();$many.revision=4;$many.members='["'+$pair+'"]';$null=Call $save $many
 $many.key=[guid]::NewGuid();$many.revision=5;$many.members='["'+$pair+'","'+$other+'"]';Expect {Call $save $many} 52004
 Assert ((Invoke-GatePassScalar $c 'SELECT COUNT(*) FROM gp.ProjectGroupMembers WHERE ProjectGroupId=@id;' @{id=$many.id}) -eq 1) 'Failed eligibility check partially changed group'
 Write-Output 'PASS: atomic multi-guard fan-out, live second session, expired-role denial and failed-add rollback'
 # Guard/foreign-office/project-only administration must never acquire group-wide authority.
 $bad=$p.Clone();$bad.s=$guardArgs.s;$bad.c=$guardArgs.c;Expect {Call $read $bad} 52001
 $bad=$p.Clone();$bad.l=[int]$f.otherLocationId;Expect {Call $read $bad} 52001
 Invoke-GatePassNonQuery $c "UPDATE gp.StaffRoleGrants SET RoleCode='PROJECT_ADMIN',ScopeType='PROJECT_LOCATION',LocationId=NULL,ProjectLocationId=@pair WHERE RoleGrantId=@g;" @{pair=$pair;g=[long]$admin.GrantId}
 Expect {Call $read $p} 52001
 Expect {Invoke-GatePassScalar $api 'SELECT COUNT(*) FROM gp.ProjectGroups;'} 229
 Expect {Invoke-GatePassScalar $api 'EXEC gp._ProjectGroupGuardEligible NULL,NULL,NULL,NULL;'} 229
 Write-Output 'PASS: guard, cross-office and project-only administrator denial; runtime remains execute-only'
}finally{
 if($api){$api.Dispose()}
 try{if($f){Invoke-GatePassNonQuery $c (Get-Content (Join-Path $PSScriptRoot '003_transaction_cleanup.sql') -Raw) @{RunId=$run}};if($created){Invoke-GatePassNonQuery $c "DROP USER [$principal];"}}finally{$c.Dispose()}
}
