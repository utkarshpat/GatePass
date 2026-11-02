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
$null=Sql "CREATE USER [gp_planning_worker_probe] WITHOUT LOGIN;ALTER ROLE gp_worker_runtime ADD MEMBER [gp_planning_worker_probe];"
$identities=@{}
foreach($n in @(1,2,3,4,5,6,7,8,10)){$uid=Id $n;$row=(Sql "SELECT CONVERT(varchar(64),SessionHash,2) sessionHex,CONVERT(varchar(64),CsrfHash,2) csrfHex FROM gp.Sessions WHERE UserId='$uid' FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;")|ConvertFrom-Json;$identities[$n]=@{SessionHash=[Convert]::FromHexString($row.sessionHex);CsrfHash=[Convert]::FromHexString($row.csrfHex)}}
$null=Sql "EXECUTE AS USER='gp_planning_api_probe';"
try{
 function Owner([scriptblock]$work){$null=Sql 'REVERT;';try{return &$work}finally{$null=Sql "EXECUTE AS USER='gp_planning_api_probe';"}}
 function Worker([string]$name,[hashtable]$p){$null=Sql "REVERT;EXECUTE AS USER='gp_planning_worker_probe';";try{return Rpc $name $p}finally{$null=Sql "IF @@TRANCOUNT>0 ROLLBACK;REVERT;EXECUTE AS USER='gp_planning_api_probe';"}}
 function Claim([string]$plan){return @(Worker 'gp.ClaimPlanningNotifications' @{PlanId=[guid]$plan;BatchSize=5;LeaseSeconds=120})}
 function ReadMail($claim){return Worker 'gp.GetPlanningNotification' @{NoticeId=[guid]$claim.noticeId;ClaimToken=[guid]$claim.claimToken}}
 function Finish($claim,[string]$outcome='FAILED'){return Worker 'gp.CompletePlanningNotification' @{NoticeId=[guid]$claim.noticeId;ClaimToken=[guid]$claim.claimToken;Outcome=$outcome;$(if($outcome -eq 'SENT'){'ProviderMessageId'}else{'ErrorCode'})=$(if($outcome -eq 'SENT'){'ISOLATED_SQL_ACCEPTANCE'}else{'PROVIDER_TIMEOUT'})}}
 function Manage([string]$action,[hashtable]$payload){return Rpc 'gp.ManageVisitPlanning' ($identities[4]+@{Action=$action;ClientKey=[guid]::NewGuid();PayloadJson=($payload|ConvertTo-Json -Depth 24 -Compress)})}
 $options=Rpc 'gp.ReadVisitCoordination' ($identities[4]+@{Mode='OPTIONS';QueryJson='{}'})
 $office=@($options.policies|Where-Object {$_.scopeKind -eq 'LOCATION' -and $_.locationId -eq 1})[0]
 $office.definition.vipNotifyIds=@((Id 2))
 $null=Manage 'POLICY' @{locationId=1;revision=[int]$office.revision;reason='Synthetic VIP-only planning recipient';definition=$office.definition}
 $beta=[string](Owner {Sql "SELECT CONVERT(varchar(36),SubProjectId) FROM gp.SubProjects WHERE Name='Beta-private';"})
 $start=[datetime]::UtcNow.AddHours(3);$until=$start.AddHours(6)
 $draft=@{locationId=1;subProjectIds=@((Id 100),$beta);visitorName='Planning mail synthetic guest';visitorEmail='private-guest@example.invalid';company='Synthetic company';purpose='PRIVATE_PURPOSE_MUST_NOT_MAIL';startsAtUtc=$start.ToString('yyyy-MM-ddTHH:mm:ss.fffZ');untilUtc=$until.ToString('yyyy-MM-ddTHH:mm:ss.fffZ');vip=$true;stay=@{checkInDate=$start.AddMinutes(330).ToString('yyyy-MM-dd');checkOutDate=$start.AddDays(1).AddMinutes(330).ToString('yyyy-MM-dd');notes='STAY_OWNER_ONLY'}}
 $plan=Rpc 'gp.CreatePlannedVisit' ($identities[1]+@{ClientKey=[guid]::NewGuid();DraftJson=($draft|ConvertTo-Json -Depth 20 -Compress)})
 $script:mailRevision=1
 function Change([hashtable]$command,[int]$who=1){$r=Rpc 'gp.ChangePlannedVisit' ($identities[$who]+@{PlanId=[guid]$plan.id;ClientKey=[guid]::NewGuid();ExpectedRevision=[int]$script:mailRevision;CommandJson=($command|ConvertTo-Json -Depth 20 -Compress)});$script:mailRevision=[int]$r.revision;return $r}
 Check ((Owner {Sql "SELECT COUNT(*) FROM gp.PlanningMailDispatch WHERE PlanId='$($plan.id)';"}) -eq 0) 'Saving a draft queues no email'
 Reject 229 {Rpc 'gp.ClaimPlanningNotifications' @{BatchSize=5;LeaseSeconds=120}}
 Reject 229 {Rpc 'gp.PreviewPlanningNotifications' @{PlanId=[guid]$plan.id}}
 $null=Change @{kind='SUBMIT'}
 $preview=Worker 'gp.PreviewPlanningNotifications' @{PlanId=[guid]$plan.id}
 Check ($preview.messages.Count -eq 6) 'Submit queues three independent approvals, one facilities task and two configured FYI recipients'
 Check ((Owner {Sql "SELECT COUNT(*) FROM gp.PlanningMailDispatch WHERE PlanId='$($plan.id)' AND Attempts<>0;"}) -eq 0) 'Preview never claims, acknowledges or consumes delivery attempts'
 $jobs=@($preview.messages|ForEach-Object {$_.job})
 $null=Owner {Sql "UPDATE gp.Employees SET LastSyncedAtUtc=DATEADD(day,-2,SYSUTCDATETIME()) WHERE UserId='$(Id 1)';"}
 Reject 52004 {Worker 'gp.PreviewPlanningNotifications' @{PlanId=[guid]$plan.id}}
 $null=Owner {Sql "UPDATE gp.Employees SET LastSyncedAtUtc=SYSUTCDATETIME() WHERE UserId='$(Id 1)';"}
 $alpha=@($jobs|Where-Object {$_.audience -eq 'APPROVAL' -and $_.details.targetName -eq 'Alpha permission'})[0]
 Check ($alpha.details.destinations.Count -eq 1 -and $alpha.details.destinations[0].name -eq 'Alpha' -and ($alpha|ConvertTo-Json -Depth 20) -notmatch 'Beta-private|PRIVATE_PURPOSE|private-guest@|STAY_OWNER_ONLY') 'Account authority receives only its assigned destination, without contacts, purpose or facilities notes'
 $facility=@($jobs|Where-Object audience -eq 'ARRANGEMENT')[0]
 Check ($facility.details.destinations.Count -eq 0 -and $facility.details.stayNotes -eq 'STAY_OWNER_ONLY' -and ($facility|ConvertTo-Json -Depth 20) -notmatch 'PRIVATE_PURPOSE|private-guest@|Beta-private') 'Facilities receive their stay request without sibling project or visitor-contact details'
 $fyi=@($jobs|Where-Object audience -eq 'FYI')
 Check ($fyi.Count -eq 2 -and @($fyi|Where-Object canReview).Count -eq 0 -and ($fyi|ConvertTo-Json -Depth 20) -notmatch 'Beta-private|PRIVATE_PURPOSE|STAY_OWNER_ONLY') 'VIP and ordinary FYI carry no authority, private destinations or stay notes'
 Reject 52001 {Rpc 'gp.ReadVisitCoordination' ($identities[2]+@{Mode='DETAIL';QueryJson=(@{planId=$plan.id}|ConvertTo-Json -Compress)})}
 $claims=Claim $plan.id;Check ($claims.Count -eq 5) 'Planning worker claims a bounded selected-plan batch'
 $c=$claims[0];$before=ReadMail $c
 $recipient=[string](Owner {Sql "SELECT CONVERT(varchar(36),RecipientUserId) FROM gp.VisitPlanNotices WHERE NoticeId='$($c.noticeId)';"})
 $oldEmail=$before.recipientEmail
 $null=Owner {Sql "UPDATE gp.Employees SET OfficialEmail='changed-current@example.invalid' WHERE UserId='$recipient';"}
 Check ((ReadMail $c).recipientEmail -eq 'changed-current@example.invalid') 'Every content read resolves the current directory email'
 $null=Owner {Sql "UPDATE gp.Employees SET OfficialEmail='$oldEmail',LastSyncedAtUtc=DATEADD(day,-2,SYSUTCDATETIME()) WHERE UserId='$recipient';"}
 Reject 52004 {ReadMail $c}
 $null=Owner {Sql "UPDATE gp.Employees SET LastSyncedAtUtc=SYSUTCDATETIME() WHERE UserId='$recipient';"}
 Reject 52003 {Worker 'gp.RenewPlanningNotificationLease' @{NoticeId=[guid]$c.noticeId;ClaimToken=[guid]::NewGuid();LeaseSeconds=120}}
 $failed=Finish $c;Check ($failed.status -eq 'PENDING') 'Provider timeout returns a fenced job to bounded retry'
 Check ((Owner {Sql "SELECT COUNT(*) FROM gp.PlanningMailDispatch WHERE NoticeId='$($c.noticeId)' AND NextAttemptAtUtc>SYSUTCDATETIME() AND Attempts=1 AND LastErrorCode='PROVIDER_TIMEOUT';"}) -eq 1) 'Retry records a redacted code and future exponential backoff'
 foreach($other in @($claims|Select-Object -Skip 1)){$null=Finish $other 'SENT'}
 $null=Owner {Sql "UPDATE gp.PlanningMailDispatch SET NextAttemptAtUtc=DATEADD(second,-1,SYSUTCDATETIME()) WHERE NoticeId='$($c.noticeId)';"}
 $claims=Claim $plan.id;$again=@($claims|Where-Object noticeId -eq $c.noticeId)[0]
 $null=Owner {Sql "UPDATE gp.PlanningMailDispatch SET LeaseUntilUtc=DATEADD(second,-1,SYSUTCDATETIME()) WHERE NoticeId='$($again.noticeId)';"}
 $recovered=@(Claim $plan.id|Where-Object noticeId -eq $again.noticeId)[0]
 Check ($recovered.claimToken -ne $again.claimToken) 'Expired leases recover under a new token'
 Reject 52003 {Finish $again 'SENT'}
 $null=Finish $recovered 'SENT'
 foreach($other in @($claims|Where-Object noticeId -ne $again.noticeId)){$null=Finish $other 'SENT'}
 $thread=[guid]::NewGuid().ToString()
 $null=Change @{kind='THREAD';threadId=$thread;title='Private Alpha review';audience='APPROVAL';subProjectId=(Id 100);targetId=(Id 210)} 5
 Reject 52002 {Change @{kind='COMMENT';threadId=$thread;messageId=[guid]::NewGuid().ToString();body='PRIVATE_DISCUSSION_BODY';replyToId=$null;mentionIds=@((Id 1))} 5}
 $null=Change @{kind='COMMENT';threadId=$thread;messageId=[guid]::NewGuid().ToString();body='PRIVATE_DISCUSSION_BODY';replyToId=$null;mentionIds=@((Id 10))} 5
 $preview=Worker 'gp.PreviewPlanningNotifications' @{PlanId=[guid]$plan.id};$discussion=@($preview.messages|Where-Object {$_.job.kind -eq 'DISCUSSION'})[0].job
 Check ($discussion.details.targetName -eq 'Private Alpha review' -and ($discussion|ConvertTo-Json -Depth 20) -notmatch 'PRIVATE_DISCUSSION_BODY|Beta-private') 'Mention mail exposes authorized thread title, never private message text or siblings'
 $pending=Claim $plan.id;$private=@($pending|Where-Object noticeId -eq $discussion.noticeId)[0]
 $null=Owner {Sql "UPDATE gp.StaffRoleGrants SET RevokedAtUtc=SYSUTCDATETIME(),RevokedByUserId='$(Id 4)' WHERE UserId='$(Id 10)';"}
 Check ((ReadMail $private).status -eq 'CANCELLED') 'Removing current private-thread authority suppresses a queued mention'
 $null=Owner {Sql "UPDATE gp.StaffRoleGrants SET RevokedAtUtc=NULL,RevokedByUserId=NULL WHERE UserId='$(Id 10)';"}
 $general=[guid]::NewGuid().ToString()
 $null=Change @{kind='THREAD';threadId=$general;title='Arrival logistics';audience='GENERAL';subProjectId=$null;targetId=$null}
 $null=Change @{kind='COMMENT';threadId=$general;messageId=[guid]::NewGuid().ToString();body='Confirm the arrival';replyToId=$null;mentionIds=@((Id 3))}
 $late=[string](Owner {Sql "SELECT CONVERT(varchar(36),NoticeId) FROM gp.VisitPlanNotices WHERE PlanId='$($plan.id)' AND Kind='DISCUSSION' AND TargetId='$general';"})
 $null=Owner {Sql "UPDATE gp.PlanningMailDispatch SET Attempts=5,NextAttemptAtUtc=DATEADD(second,-1,SYSUTCDATETIME()) WHERE NoticeId='$late';"}
 $last=@(Claim $plan.id|Where-Object noticeId -eq $late)[0]
 Check ((Finish $last).status -eq 'DEAD') 'Six failed attempts stop provider retry permanently'
 Check (@(Claim $plan.id).Count -eq 0) 'Dead and sent notices are not reclaimed'
 $draft.visitorName='PRIVATE_REVISED_DRAFT_NAME'
 $null=Change @{kind='REVISE';draft=$draft;reason='Earlier assignments changed'}
 $preview=Worker 'gp.PreviewPlanningNotifications' @{PlanId=[guid]$plan.id}
 Check ($preview.messages.Count -gt 0 -and ($preview|ConvertTo-Json -Depth 30) -notmatch 'PRIVATE_REVISED_DRAFT_NAME') 'Revision updates old participants without exposing a new draft visitor'
 Check (@($preview.messages|Where-Object {$_.job.kind -in @('APPROVAL','ARRANGEMENT')}).Count -eq 0) 'Old-version action messages cannot survive revision'
 $draft.visitorName='ANOTHER_PRIVATE_DRAFT_NAME'
 $null=Change @{kind='REVISE';draft=$draft;reason='Second draft change before publishing'}
 $preview=Worker 'gp.PreviewPlanningNotifications' @{PlanId=[guid]$plan.id}
 Check ($preview.messages.Count -gt 0 -and ($preview|ConvertTo-Json -Depth 30) -notmatch 'PRIVATE_REVISED_DRAFT_NAME|ANOTHER_PRIVATE_DRAFT_NAME') 'Repeated draft revisions still notify the last published participants without draft details'
 $null=Change @{kind='SUBMIT'}
 $null=Change @{kind='CANCEL';reason='Synthetic mail rehearsal cancelled'}
 $preview=Worker 'gp.PreviewPlanningNotifications' @{PlanId=[guid]$plan.id}
 Check (@($preview.messages|Where-Object {$_.job.kind -in @('APPROVAL','ARRANGEMENT')}).Count -eq 0 -and @($preview.messages|Where-Object {$_.job.kind -eq 'CANCELLED'}).Count -gt 0) 'Cancellation suppresses old actions and notifies current entitled recipients'
 # Leave a separate active plan only for the owned real-SQL/mock-Graph integration.
 $draft.visitorName='Graph adapter synthetic guest'
 $active=Rpc 'gp.CreatePlannedVisit' ($identities[1]+@{ClientKey=[guid]::NewGuid();DraftJson=($draft|ConvertTo-Json -Depth 20 -Compress)})
 $null=Rpc 'gp.ChangePlannedVisit' ($identities[1]+@{PlanId=[guid]$active.id;ClientKey=[guid]::NewGuid();ExpectedRevision=1;CommandJson='{"kind":"SUBMIT"}'})
 $fixture=@{database=$Connection.Database;planId=$active.id;createdBy='PlanningMailPersistenceCases'}
 [IO.File]::WriteAllText((Join-Path (Get-Location).Path 'tmp/planning-mail-fixture.json'),($fixture|ConvertTo-Json))
 Write-Output "PASS: $checks isolated planning mail queue, privacy, directory, lease, retry, FYI, revision and cancellation checks."
}finally{$null=Sql 'IF @@TRANCOUNT>0 ROLLBACK;REVERT;'}
