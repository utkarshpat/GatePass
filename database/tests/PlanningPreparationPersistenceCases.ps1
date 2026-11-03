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
$beta=[string](Sql "SELECT CONVERT(varchar(36),SubProjectId) FROM gp.SubProjects WHERE Name='Beta-private';")
$null=Sql "EXECUTE AS USER='gp_planning_api_probe';"
try {
 function Read([string]$mode,[hashtable]$query,[int]$who=1){return Rpc 'gp.ReadVisitCoordination' ($identities[$who]+@{Mode=$mode;QueryJson=($query|ConvertTo-Json -Compress -Depth 24)})}
 function Create($draft){return Rpc 'gp.CreatePlannedVisit' ($identities[1]+@{ClientKey=[guid]::NewGuid();DraftJson=($draft|ConvertTo-Json -Depth 24 -Compress)})}
 function Change($receipt,$command,[int]$who=1){return Rpc 'gp.ChangePlannedVisit' ($identities[$who]+@{PlanId=[guid]$receipt.id;ExpectedRevision=[int]$receipt.revision;ClientKey=[guid]::NewGuid();CommandJson=($command|ConvertTo-Json -Depth 24 -Compress)})}
 $routing=Read 'ROUTING' @{locationId=1;subProjectIds=@((Id 100),$beta)}
 Check (@($routing.routing).Count -eq 3) 'Selected same-office routing has only requested destinations and office policy'
 $alpha=@($routing.routing|Where-Object {$_.PSObject.Properties['subProjectId'] -and $_.subProjectId -eq (Id 100)})[0]
 Check ($alpha.approvalSteps[0].approvers[0].name -ne '') 'Required approver names are visible before saving'
 Check (($routing|ConvertTo-Json -Depth 24) -notmatch 'DefinitionJson|IdentitySubject|Password|SessionHash') 'Routing contains recipient projection without raw policy or credentials'
 $people=Read 'PEOPLE' @{locationId=1;search='Leadership'}
 Check (@($people.people).Count -eq 1 -and $people.people[0].userId -eq (Id 6)) 'Authorized host can find current internal employees by name'
 Reject 52001 {Read 'PEOPLE' @{locationId=1;search='Planning'} 6}
 Reject 52002 {Read 'PEOPLE' @{locationId=1;search='a'}}
 Reject 52002 {Read 'ROUTING' @{locationId=1;subProjectIds=@((Id 100),(Id 100))}}
 $start=[datetime]::UtcNow.AddHours(8)
 $draft=@{locationId=1;subProjectIds=@((Id 100),$beta);visitorName='Preparation synthetic guest';purpose='Planning rehearsal';startsAtUtc=$start.ToString('yyyy-MM-ddTHH:mm:ss.fffZ');untilUtc=$start.AddHours(6).ToString('yyyy-MM-ddTHH:mm:ss.fffZ');vip=$false;
 preparation=@{category='CLIENT';visitType='SITE_TOUR';services=@('MEETING_ROOM','TRANSPORT');devices=@('LAPTOP');specialAccess=@('NETWORK');coordinatorId=(Id 3);visitOwnerId=(Id 6);alternateReceiverId=(Id 6);agenda='PRIVATE_ITINERARY';meetingLocation='Conference room 2';requirements='Accessible entrance'};
 additionalPeople=@(@{userId=(Id 5);kind='APPROVAL';subProjectId=(Id 100)},@{userId=(Id 6);kind='NOTIFY'})}
 $receipt=Create $draft
 $detail=Read 'DETAIL' @{planId=$receipt.id}
 Check ($detail.preparation.agenda -eq 'PRIVATE_ITINERARY' -and $detail.draft.preparation.category -eq 'CLIENT') 'Preparation persists and owner edit round-trips'
 Check (@($detail.draft.additionalPeople).Count -eq 2) 'Automatic role contacts do not pollute editable manual recipients'
 Check (@($detail.approvals).Count -eq 4) 'Extra review adds a step alongside all mandatory policy steps'
 Check (@($detail.tasks|Where-Object kind -eq 'OTHER').Count -eq 2) 'Selected support creates independent preparation tasks'
 $receipt=Change $receipt @{kind='SUBMIT'}
 $review=Read 'DETAIL' @{planId=$receipt.id} 5
 Check (@($review.projects).Count -eq 1 -and $review.projects[0].subProjectId -eq (Id 100)) 'Added destination approver cannot see sibling destinations'
 $extra=@($review.approvals|Where-Object name -eq 'Additional approval')[0]
 Check ($extra.canDecide -and $extra.approvers[0].userId -eq (Id 5)) 'Selected additional approver receives current decision authority'
 $receipt=Change $receipt @{kind='DECIDE';stepId=$extra.id;decision='APPROVED';reason='Reviewed supplemental permission'} 5
 $detail=Read 'DETAIL' @{planId=$receipt.id}
 Check (@($detail.projects|Where-Object readiness -eq 'READY').Count -eq 0) 'Supplemental approval cannot clear mandatory approvals'
 Reject 52001 {Read 'DETAIL' @{planId=$receipt.id} 6}
 $operations=Read 'DETAIL' @{planId=$receipt.id} 3
 Check (@($operations.projects).Count -eq 0) 'Service coordinator has no destination access'
 Check ($operations.preparation.meetingLocation -eq 'Conference room 2' -and -not $operations.preparation.PSObject.Properties['agenda']) 'Coordinator sees only necessary operational preparation'
 foreach($task in @($operations.tasks|Where-Object kind -eq 'OTHER')){
  Reject 52001 {Change $receipt @{kind='ARRANGE';taskId=$task.id;status='CONFIRMED';remark='Not the owner'} 5}
  $receipt=Change $receipt @{kind='ARRANGE';taskId=$task.id;status='CONFIRMED';remark='Transport or room arranged'} 3
 }
 $detail=Read 'DETAIL' @{planId=$receipt.id}
 Check (@($detail.tasks|Where-Object {$_.kind -eq 'OTHER' -and $_.status -eq 'CONFIRMED'}).Count -eq 2) 'Named coordinator can complete assigned service tasks'
 $revision=Change $receipt @{kind='REVISE';reason='Reschedule preparation';draft=$draft}
 $detail=Read 'DETAIL' @{planId=$revision.id}
 Check ($detail.version -eq 2 -and @($detail.tasks|Where-Object status -eq 'REQUESTED').Count -eq 2) 'Revision resets preparation confirmations'
 Check (@($detail.approvals|Where-Object status -eq 'APPROVED').Count -eq 0) 'Revision resets all supplemental and mandatory decisions'
 foreach($mutation in @('self','duplicate','unselected','service-owner','device')){
  $bad=$draft|ConvertTo-Json -Depth 24|ConvertFrom-Json -AsHashtable
  switch($mutation){self{$bad.additionalPeople=@(@{userId=(Id 1);kind='APPROVAL'})}duplicate{$bad.additionalPeople=@(@{userId=(Id 5);kind='APPROVAL'},@{userId=(Id 5);kind='NOTIFY'})}unselected{$bad.additionalPeople=@(@{userId=(Id 5);kind='APPROVAL';subProjectId=(Id 101)})}service-owner{$bad.preparation.Remove('coordinatorId')}device{$bad.preparation.devices=@('MAKE_MODEL')}}
  Reject 52002 {Create $bad}
 }
 $null=Sql 'REVERT;'
 try{
  Check ((Sql "SELECT COUNT(*) FROM gp.VisitPlanNotices WHERE PlanId='$($receipt.id)' AND Kind='FYI' AND RecipientUserId='$(Id 6)' AND EventSequence=2;") -eq 1) 'Notify recipient receives persisted notice intent'
 }finally{$null=Sql "EXECUTE AS USER='gp_planning_api_probe';"}
 foreach($table in @('VisitPlanPreparation','VisitPlanExtraPeople','VisitPlanServiceTasks')){Reject 229 {Sql ('SELECT COUNT(*) FROM gp.'+$table+';')}}
 Write-Output "PASS: $checks isolated preparation, recipient routing, additive approval, task ownership, privacy and revision checks."
}finally{$null=Sql 'IF @@TRANCOUNT>0 ROLLBACK;REVERT;'}
