# Invoked only by the owned disposable-database harness. Never accepts a database name.
param($Connection)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
if(-not $Connection -or $Connection.Database -notmatch '^GatePass_Verification_[a-f0-9]{32}$'){throw 'Owned isolated planning connection required.'}
$checks=0
function Sql([string]$text){$c=$Connection.CreateCommand();$c.CommandText=$text;try{return $c.ExecuteScalar()}finally{$c.Dispose()}}
if((Sql "SELECT COUNT(*) FROM sys.extended_properties WHERE class=0 AND name=N'GatePass.DisposableVerification' AND CONVERT(nvarchar(100),value)=DB_NAME();") -ne 1){throw 'Owned disposable marker required.'}
function Id([int]$n){return '00000000-0000-0000-0000-'+$n.ToString('D12')}
function Check([bool]$v,[string]$name){if(-not $v){throw $name};$script:checks++}
function Rpc([string]$name,[hashtable]$p){
 $c=$Connection.CreateCommand();$c.CommandType=[Data.CommandType]::StoredProcedure;$c.CommandText=$name
 foreach($key in $p.Keys){$v=$p[$key];$parameter=$c.Parameters.Add('@'+$key,$(if($v -is [byte[]]){[Data.SqlDbType]::VarBinary}elseif($v -is [int]){[Data.SqlDbType]::Int}elseif($v -is [guid]){[Data.SqlDbType]::UniqueIdentifier}else{[Data.SqlDbType]::NVarChar}));if($v -is [byte[]]){$parameter.Size=8000}elseif($v -is [string]){$parameter.Size=-1};$parameter.Value=$v}
 try{return ([string]$c.ExecuteScalar()|ConvertFrom-Json -Depth 64)}finally{$c.Dispose()}
}
function Reject([int]$number,[scriptblock]$work){try{$null=&$work}catch{if($_.Exception.GetBaseException().Number -eq $number){$script:checks++;return};throw};throw "Expected SQL $number"}


$identities=@{}
foreach($n in @(1,2,3,4,5,6,7,8,10)){$uid=Id $n;$row=(Sql "SELECT CONVERT(varchar(64),SessionHash,2) sessionHex,CONVERT(varchar(64),CsrfHash,2) csrfHex FROM gp.Sessions WHERE UserId='$uid' FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;")|ConvertFrom-Json;$identities[$n]=@{SessionHash=[Convert]::FromHexString($row.sessionHex);CsrfHash=[Convert]::FromHexString($row.csrfHex)}}
$null=Sql "EXECUTE AS USER='gp_planning_api_probe';"
try{
 function Read([string]$mode,[hashtable]$query,[int]$who=1){return Rpc 'gp.ReadVisitCoordination' ($identities[$who]+@{Mode=$mode;QueryJson=($query|ConvertTo-Json -Compress -Depth 24)})}
 function Manage($payload,[int]$who=4,[guid]$key=[guid]::NewGuid()){return Rpc 'gp.ManageVisitPlanning' ($identities[$who]+@{Action='GROUP';ClientKey=$key;PayloadJson=($payload|ConvertTo-Json -Compress -Depth 24)})}
 function Create($draft){return Rpc 'gp.CreatePlannedVisit' ($identities[1]+@{ClientKey=[guid]::NewGuid();DraftJson=($draft|ConvertTo-Json -Compress -Depth 24)})}
 function Change($receipt,$command,[int]$who=1){return Rpc 'gp.ChangePlannedVisit' ($identities[$who]+@{PlanId=[guid]$receipt.id;ExpectedRevision=[int]$receipt.revision;ClientKey=[guid]::NewGuid();CommandJson=($command|ConvertTo-Json -Compress -Depth 24)})}
 function Worker($name,$payload){$null=Sql "REVERT;EXECUTE AS USER='gp_planning_worker_probe';";try{return Rpc $name $payload}finally{$null=Sql "IF @@TRANCOUNT>0 ROLLBACK;REVERT;EXECUTE AS USER='gp_planning_api_probe';"}}
 $definition=@{locationId=1;name='Noida VIP approval and notification';description='Leadership visit coordination';vipOnly=$true;active=$true;revision=0;reason='Create synthetic group';members=@(@{userId=(Id 2);kind='APPROVAL'},@{userId=(Id 6);kind='NOTIFY'},@{email='leadership-list@example.invalid';name='Leadership mailing list';kind='NOTIFY'})}
 Reject 52001 {Manage $definition 1}
 Reject 52001 {Manage $definition 10}
 $operation=[guid]::NewGuid();$group=Manage $definition 4 $operation;$again=Manage $definition 4 $operation
 Check ($group.id -eq $again.id -and $group.revision -eq 1) 'Group management retries replay one operation'
 $catalogue=Read 'GROUPS' @{locationId=1}
 $row=@($catalogue.groups|Where-Object id -eq $group.id)[0]
 Check ($row.members.Count -eq 3 -and -not $row.canManage) 'Host sees each person and notification email but cannot manage the group'
 Check (@($row.members|Where-Object kind -eq 'APPROVAL')[0].name -ne '') 'Group approval shows an internal display name'
 Reject 52001 {Read 'GROUPS' @{locationId=1} 6}
 $start=[datetime]::UtcNow.AddHours(12)
 $draft=@{locationId=1;subProjectIds=@((Id 100));visitorName='Group synthetic visitor';purpose='Private planning purpose';startsAtUtc=$start.ToString('yyyy-MM-ddTHH:mm:ss.fffZ');untilUtc=$start.AddHours(3).ToString('yyyy-MM-ddTHH:mm:ss.fffZ');vip=$false;groups=@(@{id=$group.id;revision=1})}
 Reject 52001 {Create $draft}
 $draft.vip=$true;$plan=Create $draft;$detail=Read 'DETAIL' @{planId=$plan.id}
 Check ($detail.selectedGroups[0].name -eq $definition.name -and $detail.draft.groups[0].id -eq $group.id) 'Owner details and edit restore selected group snapshot'
 Check (@($detail.approvals|Where-Object name -eq 'Group approval').Count -eq 1) 'Group adds an independent mandatory review'
 $plan=Change $plan @{kind='SUBMIT'}
 $review=Read 'DETAIL' @{planId=$plan.id} 2
 $step=@($review.approvals|Where-Object name -eq 'Group approval')[0]
 Check ($step.canDecide -and $review.projects.Count -eq 1) 'Group approver has only its legitimate decision scope'
 $plan=Change $plan @{kind='DECIDE';stepId=$step.id;decision='APPROVED';reason='Group review complete'} 2
 $detail=Read 'DETAIL' @{planId=$plan.id}
 Check ($detail.projects[0].readiness -eq 'PENDING') 'Group approval cannot satisfy baseline office or project reviews'
 Reject 52001 {Read 'DETAIL' @{planId=$plan.id} 6}
 $preview=Worker 'gp.PreviewPlanningNotifications' @{PlanId=[guid]$plan.id}
 $external=@($preview.messages|Where-Object {$_.job.PSObject.Properties['recipientEmail'] -and $_.job.recipientEmail -eq 'leadership-list@example.invalid'})
 Check ($external.Count -eq 1 -and $external[0].job.audience -eq 'FYI' -and -not $external[0].job.canReview) 'Raw email receives one FYI-only job with no review authority'
 Check (($external[0].job|ConvertTo-Json -Depth 24) -notmatch 'Private planning purpose|agenda|visitorEmail|Beta-private') 'Explicit notification email receives only minimum FYI details'
 $changed=$definition.Clone();$changed.id=$group.id;$changed.revision=1;$changed.reason='Remove mailing list and revoke group approval';$changed.members=@(@{userId=(Id 6);kind='NOTIFY'});$group=Manage $changed
 $detail=Read 'DETAIL' @{planId=$plan.id}
 Check ($detail.projects[0].readiness -eq 'POLICY_CHANGED') 'Changing group membership invalidates existing planning readiness'
 Reject 52001 {Read 'DETAIL' @{planId=$plan.id} 2}
 $preview=Worker 'gp.PreviewPlanningNotifications' @{PlanId=[guid]$plan.id}
 $external=@($preview.messages|Where-Object {$_.job.PSObject.Properties['recipientEmail'] -and $_.job.recipientEmail -eq 'leadership-list@example.invalid'})
 Check ($external.Count -eq 0) 'Removed notification email is suppressed before dispatch'
 $draft.groups=@(@{id=$group.id;revision=1});Reject 52003 {Create $draft}
 $draft.groups=@(@{id=$group.id;revision=2});$plan=Change $plan @{kind='REVISE';reason='Review updated group';draft=$draft};$detail=Read 'DETAIL' @{planId=$plan.id}
 Check ($detail.version -eq 2 -and @($detail.approvals|Where-Object name -eq 'Group approval').Count -eq 0) 'Revised draft uses current group membership and resets old group decisions'
 $plan=Change $plan @{kind='SUBMIT'};$plan=Change $plan @{kind='CANCEL';reason='Cancel synthetic visit'}
 Check ((Read 'DETAIL' @{planId=$plan.id}).state -eq 'CANCELLED') 'Cancellation works with internal and email recipients in notice history'
 $local=$definition.Clone();$local.Remove('locationId');$local.subProjectId=(Id 100);$local.name='Alpha custom visit group';$local.vipOnly=$false;$local.members=@(@{userId=(Id 8);kind='APPROVAL'});$scoped=Manage $local 10
 Check ($scoped.revision -eq 1) 'Account administrator can manage a group only under its own sub-project'
 $forged=$local.Clone();$forged.subProjectId=(Id 101);Reject 52001 {Manage $forged 10}
 foreach($members in @(@(@{email='outside@example.invalid';kind='APPROVAL'}),@(@{email="header`r`ninjection@example.invalid";kind='NOTIFY'}),@(@{userId=(Id 2);kind='NOTIFY'},@{userId=(Id 2);kind='APPROVAL'}))){$bad=$definition.Clone();$bad.name='Bad group';$bad.members=$members;Reject 52002 {Manage $bad}}
 foreach($table in @('VisitRoutingGroups','VisitPlanGroups','VisitPlanGroupReviewers')){Reject 229 {Sql ('SELECT COUNT(*) FROM gp.'+$table+';')}}
 $null=Sql 'REVERT;';try{Check ((Sql "SELECT COUNT(*) FROM gp.SecurityAuditEvents WHERE ActionCode='VISIT_GROUP_MANAGED' AND TargetReference='$($group.id)';") -eq 2) 'Group creation and changes record actor, time and membership in audit'}finally{$null=Sql "EXECUTE AS USER='gp_planning_api_probe';"}

 $mailDefinition=$definition.Clone();$mailDefinition.name='Group mail worker fixture';$mailDefinition.vipOnly=$false;$mailDefinition.members=@(@{email='group-mail@example.invalid';kind='NOTIFY'},@{userId=(Id 6);kind='NOTIFY'});$mailGroup=Manage $mailDefinition
 $draft.groups=@(@{id=$mailGroup.id;revision=1});$draft.visitorName='Group mail worker rehearsal';$mailPlan=Create $draft;$mailPlan=Change $mailPlan @{kind='SUBMIT'}
 @{database=$Connection.Database;createdBy='VisitGroupPersistenceCases';planId=$mailPlan.id}|ConvertTo-Json -Compress|Set-Content -LiteralPath (Join-Path $PSScriptRoot '../../tmp/planning-group-mail-fixture.json') -Encoding utf8
 Write-Output "PASS: $checks isolated visit group management, scope, revisions, approvals, notifications, privacy and audit checks."
}finally{$null=Sql 'IF @@TRANCOUNT>0 ROLLBACK;REVERT;'}
