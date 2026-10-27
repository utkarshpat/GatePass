#Requires -Version 7.0
[CmdletBinding()]param([switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$db=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate
$run=[guid]::NewGuid();$principal='gp_group_boundary_'+$run.ToString('N');$trigger='GroupBoundaryFault_'+$run.ToString('N')
$connections=[Collections.Generic.List[object]]::new();$cases=[Collections.Generic.List[object]]::new();$fixtureReady=$false;$principalReady=$false;$f=$null
$save='EXEC gp.ManageProjectGroup @SessionHash=@s,@CsrfHash=@c,@ClientKey=@key,@LocationId=@l,@Action=@action,@ProjectGroupId=@id,@ExpectedRevision=@revision,@GroupName=@name,@ProjectLocationIdsJson=@members,@Reason=N''Owned boundary verification'';'
$assign='EXEC gp.ManageProjectGroupGuard @SessionHash=@s,@CsrfHash=@c,@ClientKey=@key,@LocationId=@l,@ProjectGroupId=@id,@ExpectedRevision=@revision,@Action=@action,@GuardUserId=@guard,@GroupAssignmentId=@binding,@Reason=N''Owned boundary verification'';'
$read='EXEC gp.GetAdminProjectGroups @SessionHash=@s,@CsrfHash=@c,@LocationId=@l;'
$move='EXEC gp.RecordMovement @SessionHash=@s,@CsrfHash=@c,@ClientKey=@key,@VisitRequestId=@visit,@AccessPassId=@pass,@LocationId=@l,@EventType=''ENTRY'',@EntryMethod=''MANUAL'',@SelectedProjectLocationId=@pair;'
function Assert($value,[string]$message){if(-not $value){throw $message}}
function ErrorNumber($errorValue){$base=$errorValue.GetBaseException();if($base -is [Data.SqlClient.SqlException]){return $base.Number};return 0}
function Expect([scriptblock]$work,[int]$number=52001){try{$null=&$work}catch{if((ErrorNumber $_.Exception) -eq $number){return};throw};throw "Expected SQL $number"}
function Call($connection,$sql,$parameters){(Invoke-GatePassScalar $connection $sql $parameters)|ConvertFrom-Json}
function Auth([string]$label='ADMIN'){$a=$f.actors.Where({$_.Label -eq $label})[0];return @{s=[Convert]::FromHexString($a.SessionHex);c=[Convert]::FromHexString($a.CsrfHex);l=[int]$f.locationId}}
function NewGroup {
 $p=Auth;$p.key=[guid]::NewGuid();$p.action='SAVE';$p.id=$null;$p.revision=$null;$p.name=$f.prefix+' Entry';$p.members='["'+$beta+'"]';$r=Call $api $save $p
 $script:group=[long]$r.groupId;$script:edit=$p.Clone();$script:edit.id=$group;$script:edit.revision=1
}
function Bind {
 $p=Auth;$p.key=[guid]::NewGuid();$p.id=$group;$p.revision=1;$p.action='ASSIGN';$p.guard=[guid]$f.actors.Where({$_.Label -eq 'GUARD2'})[0].UserId;$p.binding=$null;$r=Call $api $assign $p
 $script:binding=[long]$r.groupAssignmentId;$script:bindingArgs=$p.Clone();$script:bindingArgs.revision=2;$script:bindingArgs.binding=$binding;$script:edit.revision=2
}
function EntryArgs {$p=Auth GUARD2;$p.key=[guid]::NewGuid();$p.visit=[guid]$visit.VisitId;$p.pass=[guid]$visit.PassId;$p.pair=$beta;return $p}
function Scan {$p=Auth GUARD2;$p.credential=[Convert]::FromHexString($visit.CredentialHex);$p.correlation=[guid]::NewGuid();return Call $api 'EXEC gp.VerifyGuardPass @SessionHash=@s,@CsrfHash=@c,@LocationId=@l,@CredentialHash=@credential,@CorrelationId=@correlation;' $p}
function EventCount {Invoke-GatePassScalar $db 'SELECT COUNT(*) FROM gp.AccessEvents WHERE VisitRequestId=@id;' @{id=[guid]$visit.VisitId}}
function GroupState {Invoke-GatePassScalar $db @'
SELECT JSON_QUERY((SELECT * FROM gp.ProjectGroups WHERE ProjectGroupId=@id FOR JSON PATH)) groups,
JSON_QUERY((SELECT * FROM gp.ProjectGroupMembers WHERE ProjectGroupId=@id ORDER BY ProjectLocationId FOR JSON PATH)) members,
JSON_QUERY((SELECT * FROM gp.ProjectGroupGuardAssignments WHERE ProjectGroupId=@id ORDER BY GroupAssignmentId FOR JSON PATH)) bindings,
JSON_QUERY((SELECT a.* FROM gp.GuardAssignments a JOIN gp.ProjectGroupGuardAssignments b ON b.GroupAssignmentId=a.GroupAssignmentId WHERE b.ProjectGroupId=@id ORDER BY a.GuardAssignmentId FOR JSON PATH)) children
FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;
'@ @{id=$group}}
function Fault([string]$action){Invoke-GatePassNonQuery $db "CREATE TRIGGER gp.[$trigger] ON gp.SecurityAuditEvents AFTER INSERT AS BEGIN IF EXISTS(SELECT 1 FROM inserted WHERE ActionCode='$action' AND TargetReference='$group') THROW 52999,'Owned group fault',1;END;"}
function DropFault {Invoke-GatePassNonQuery $db "IF OBJECT_ID('gp.$trigger','TR') IS NOT NULL DROP TRIGGER gp.[$trigger];"}
function Reset {
 DropFault
 if($script:fixtureReady){Invoke-GatePassNonQuery $db (Get-Content (Join-Path $PSScriptRoot '003_transaction_cleanup.sql') -Raw) @{RunId=$run};$script:fixtureReady=$false}
 $script:f=Call $db (Get-Content (Join-Path $PSScriptRoot '002_transaction_fixtures.sql') -Raw) @{RunId=$run};$script:fixtureReady=$true
 $script:alpha=[long]$f.projectLocationId;$script:visit=$f.visits.Where({$_.Label -eq 'OTHER_PAIR'})[0]
 $script:beta=[long](Invoke-GatePassScalar $db 'SELECT ProjectLocationId FROM gp.VisitRequests WHERE VisitRequestId=@id;' @{id=[guid]$visit.VisitId})
 NewGroup
}
function Case([string]$name,[scriptblock]$work){try{Reset;$null=&$work;$cases.Add(@{name=$name;passed=$true});Write-Output "PASS: $name"}catch{$cases.Add(@{name=$name;passed=$false;error=$_.Exception.Message});Write-Output "FAIL: $name -- $($_.Exception.Message)"}finally{DropFault}}
function Race($firstSql,$firstParameters,$secondSql,$secondParameters){
 $cmd1=New-GatePassSqlCommand $api $firstSql $firstParameters;$cmd2=New-GatePassSqlCommand $api2 $secondSql $secondParameters
 $sid1=Invoke-GatePassScalar $api 'SELECT @@SPID;';$sid2=Invoke-GatePassScalar $api2 'SELECT @@SPID;'
 $pending=[Collections.Generic.List[object]]::new();$result=[Collections.Generic.List[object]]::new()
 try{
  Invoke-GatePassNonQuery $db "BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';"
  foreach($item in @(@($cmd1,$sid1),@($cmd2,$sid2))){
   $pending.Add($item[0].ExecuteScalarAsync());$deadline=[datetime]::UtcNow.AddSeconds(5)
   do{$waiting=Invoke-GatePassScalar $db "SELECT COUNT(*) FROM sys.dm_exec_requests WHERE session_id=@id AND wait_type LIKE 'LCK_M%';" @{id=$item[1]};if($waiting -eq 1){break};Start-Sleep -Milliseconds 20}while([datetime]::UtcNow -lt $deadline)
   Assert ($waiting -eq 1) 'Independent contender was not observed waiting at the SQL gate'
  }
 }finally{Invoke-GatePassNonQuery $db 'IF @@TRANCOUNT>0 COMMIT;'}
 try{foreach($task in $pending){try{$result.Add(@{success=$true;data=($task.GetAwaiter().GetResult()|ConvertFrom-Json);error=0})}catch{$result.Add(@{success=$false;data=$null;error=(ErrorNumber $_.Exception)})}}}finally{$cmd1.Dispose();$cmd2.Dispose()}
 return ,$result.ToArray()
}
try{
 Invoke-GatePassNonQuery $db "CREATE USER [$principal] WITHOUT LOGIN;ALTER ROLE gp_api_runtime ADD MEMBER [$principal];";$principalReady=$true
 foreach($i in 1..2){$connection=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $connection "EXECUTE AS USER='$principal';";$connections.Add($connection)}
 $api=$connections[0];$api2=$connections[1]
 foreach($action in @('membership','binding','archive')){Case "GP-0612: scanned credential loses ENTRY after $action revocation in the same session" {
  Bind;Assert ((Scan).outcome -eq 'VALID') 'Initial group scan was not valid'
  if($action -eq 'binding'){$p=$bindingArgs.Clone();$p.key=[guid]::NewGuid();$p.action='REMOVE';$p.guard=$null;$null=Call $api $assign $p}else{$p=$edit.Clone();$p.key=[guid]::NewGuid();if($action -eq 'archive'){$p.action='ARCHIVE';$p.name=$null;$p.members=$null}else{$p.members='["'+$alpha+'"]'};$null=Call $api $save $p}
  Expect {Call $api $move (EntryArgs)};Assert ((EventCount) -eq 0) 'Denied ENTRY produced an access event';Assert ((Scan).outcome -eq 'NOT_AVAILABLE') 'Revoked group continued disclosing scan details'
 }}
 Case 'GP-0639: revoke queued before ENTRY denies the waiting mutation' {
  Bind;$p=$bindingArgs.Clone();$p.key=[guid]::NewGuid();$p.action='REMOVE';$p.guard=$null;$r=Race $assign $p $move (EntryArgs)
  Assert ($r[0].success -and -not $r[1].success -and $r[1].error -eq 52001 -and (EventCount) -eq 0) 'Revoke-first race admitted a visitor'
 }
 Case 'GP-0639: ENTRY queued before revoke commits once and revoke removes future authority' {
  Bind;$p=$bindingArgs.Clone();$p.key=[guid]::NewGuid();$p.action='REMOVE';$p.guard=$null;$r=Race $move (EntryArgs) $assign $p
  Assert ($r[0].success -and $r[1].success -and (EventCount) -eq 1) 'Entry-first race was not serialized';Expect {Call $api $move (EntryArgs)}
 }
 Case 'Two independently blocked editors cannot commit the same revision' {
  Bind;$a=$edit.Clone();$a.key=[guid]::NewGuid();$a.name=$f.prefix+' Winner A';$a.members='["'+$alpha+'"]';$b=$edit.Clone();$b.key=[guid]::NewGuid();$b.name=$f.prefix+' Winner B';$b.members='["'+$alpha+'","'+$beta+'"]'
  $r=Race $save $a $save $b;Assert (@($r|Where-Object success).Count -eq 1 -and @($r|Where-Object{$_.error -eq 52003}).Count -eq 1) 'Stale concurrent editor was not rejected'
  $winner=if($r[0].success){$a}else{$b};$expected=@($winner.members|ConvertFrom-Json);$actual=Call $api $read (Auth);$g=$actual.groups.Where({$_.groupId -eq [string]$group})[0]
  Assert ($g.name -eq $winner.name -and $g.revision -eq 3 -and $g.projects.Count -eq $expected.Count) 'Committed group is a partial mix of editors'
  Assert ((Invoke-GatePassScalar $db 'SELECT COUNT(*) FROM gp.GuardAssignments WHERE GroupAssignmentId=@id AND DeallocatedAtUtc IS NULL;' @{id=$binding}) -eq $expected.Count) 'Children differ from winning membership'
 }
 foreach($first in @('edit','remove')){Case "GP-0640: membership edit races with group deallocation, $first queued first" {
  Bind;$e=$edit.Clone();$e.key=[guid]::NewGuid();$e.members='["'+$alpha+'","'+$beta+'"]'
  $r=$bindingArgs.Clone();$r.key=[guid]::NewGuid();$r.action='REMOVE';$r.guard=$null
  if($first -eq 'edit'){$outcome=Race $save $e $assign $r;$retry=$r;$retry.revision=3;$retrySql=$assign}else{$outcome=Race $assign $r $save $e;$retry=$e;$retry.revision=3;$retrySql=$save}
  Assert ($outcome[0].success -and -not $outcome[1].success -and $outcome[1].error -eq 52003) 'Concurrent stale mutation bypassed revision fencing'
  $null=Call $api $retrySql $retry
  Assert ((Invoke-GatePassScalar $db 'SELECT COUNT(*) FROM gp.GuardAssignments WHERE GroupAssignmentId=@id AND DeallocatedAtUtc IS NULL;' @{id=$binding}) -eq 0) 'Edit revived deallocated group access'
  Assert ((Scan).outcome -eq 'NOT_AVAILABLE') 'Deallocated guard retained group scan access';Expect {Call $api $move (EntryArgs)}
 }}
 Case 'Concurrent group reader observes the complete committed membership' {
  Bind;$p=$edit.Clone();$p.key=[guid]::NewGuid();$p.members='["'+$alpha+'","'+$beta+'"]';$r=Race $save $p $read (Auth)
  Assert ($r[0].success -and $r[1].success) 'Read/edit race failed';$g=$r[1].data.groups.Where({$_.groupId -eq [string]$group})[0];Assert ($g.revision -eq 3 -and $g.projects.Count -eq 2 -and $g.assignments.Count -eq 1) 'Reader observed a partial group'
 }
 foreach($faultAction in @('PROJECT_GROUP_CHANGED','PROJECT_GROUP_GUARD_CHANGED')){Case "GP-0634: injected $faultAction audit failure rolls back all writes and the idempotency receipt" {
  if($faultAction -eq 'PROJECT_GROUP_CHANGED'){Bind;$p=$edit.Clone();$p.key=[guid]::NewGuid();$p.members='["'+$alpha+'","'+$beta+'"]';$sql=$save}else{$p=Auth;$p.key=[guid]::NewGuid();$p.id=$group;$p.revision=1;$p.action='ASSIGN';$p.guard=[guid]$f.actors.Where({$_.Label -eq 'GUARD2'})[0].UserId;$p.binding=$null;$sql=$assign}
  $before=GroupState;Fault $faultAction;Expect {Call $api $sql $p} 52999;DropFault;Assert ((GroupState) -ceq $before) 'Group, children or binding survived the failed transaction'
  Assert ((Invoke-GatePassScalar $db 'SELECT COUNT(*) FROM gp.IdempotencyRequests WHERE ClientKey=@key;' @{key=$p.key}) -eq 0) 'Failed operation retained an idempotency receipt'
  $null=Call $api $sql $p
 }}
 foreach($label in @('GUARD','RECEPTION','WRONGLOCATION','BLOCKED','STALE','EXPIRED')){Case "Role/session deny matrix: $label cannot read, edit or assign a group" {
  $auth=Auth $label;Expect {Call $api $read $auth};$p=$edit.Clone();$p.s=$auth.s;$p.c=$auth.c;$p.key=[guid]::NewGuid();Expect {Call $api $save $p}
  $p=$auth.Clone();$p.key=[guid]::NewGuid();$p.id=$group;$p.revision=1;$p.action='ASSIGN';$p.guard=[guid]$f.actors.Where({$_.Label -eq 'GUARD2'})[0].UserId;$p.binding=$null;Expect {Call $api $assign $p}
 }}
 Case 'GP-0624: office and group/binding ID substitution cannot mutate another group' {
  Bind;$p=Auth;$p.l=[int]$f.otherLocationId;Expect {Call $api $read $p};$p=$edit.Clone();$p.l=[int]$f.otherLocationId;$p.key=[guid]::NewGuid();Expect {Call $api $save $p}
  $before=GroupState;$p=$bindingArgs.Clone();$p.key=[guid]::NewGuid();$p.action='REMOVE';$p.guard=$null;$p.binding=[long]::MaxValue;Expect {Call $api $assign $p} 52003;Assert ((GroupState) -ceq $before) 'Foreign binding removal changed a group'
 }
 Case 'A project-only GUARDS_MANAGE grant cannot manage office groups' {
  $admin=$f.actors.Where({$_.Label -eq 'ADMIN'})[0];Invoke-GatePassNonQuery $db "UPDATE gp.StaffRoleGrants SET RoleCode='PROJECT_ADMIN',ScopeType='PROJECT_LOCATION',LocationId=NULL,ProjectLocationId=@pair WHERE RoleGrantId=@id;" @{pair=$alpha;id=[long]$admin.GrantId}
  Expect {Call $api $read (Auth)};$p=$edit.Clone();$p.key=[guid]::NewGuid();Expect {Call $api $save $p}
 }
 Case 'Revoked guard role cannot retain group entry or be revived by adding projects' {
  Bind;$g=$f.actors.Where({$_.Label -eq 'GUARD2'})[0];Invoke-GatePassNonQuery $db 'UPDATE gp.StaffRoleGrants SET RevokedAtUtc=SYSUTCDATETIME(),RevokedByUserId=@actor WHERE RoleGrantId=@id;' @{id=[long]$g.GrantId;actor=[guid]$f.actors.Where({$_.Label -eq 'ADMIN'})[0].UserId}
  Expect {Call $api $move (EntryArgs)};$p=$edit.Clone();$p.key=[guid]::NewGuid();$p.members='["'+$alpha+'","'+$beta+'"]';$before=GroupState;Expect {Call $api $save $p} 52004;Assert ((GroupState) -ceq $before) 'Adding projects revived revoked authority'
 }
}finally{
 try{DropFault;foreach($connection in $connections){$connection.Dispose()};if($fixtureReady){Invoke-GatePassNonQuery $db (Get-Content (Join-Path $PSScriptRoot '003_transaction_cleanup.sql') -Raw) @{RunId=$run}};if($principalReady){Invoke-GatePassNonQuery $db "DROP USER [$principal];"}}finally{$db.Dispose()}
 $folder=Join-Path $taskRoot 'database/validation';New-Item -ItemType Directory -Path $folder -Force|Out-Null
 @{runId=$run.ToString();sourceSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant();cases=@($cases.ToArray());passed=@($cases|Where-Object passed).Count;failed=@($cases|Where-Object{-not $_.passed}).Count}|ConvertTo-Json -Depth 6|Set-Content (Join-Path $folder 'project-group-boundaries.json')
}
if(@($cases|Where-Object{-not $_.passed}).Count){throw 'Project group boundary verification failed'}
