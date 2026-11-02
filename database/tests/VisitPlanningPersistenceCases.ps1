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
$null=Sql @'
INSERT gp.Users(UserId,IdentityIssuer,IdentitySubject,DisplayName) VALUES
 ('00000000-0000-0000-0000-000000000004','planning-rpc-test','admin','Planning admin'),
 ('00000000-0000-0000-0000-000000000005','planning-rpc-test','stranger','Unassigned employee'),
 ('00000000-0000-0000-0000-000000000006','planning-rpc-test','vip','Leadership FYI'),
 ('00000000-0000-0000-0000-000000000007','planning-rpc-test','security','Office authority'),
 ('00000000-0000-0000-0000-000000000008','planning-rpc-test','authority-b','Beta authority'),
 ('00000000-0000-0000-0000-000000000010','planning-rpc-test','account-admin','Alpha account admin');
INSERT gp.Employees(EmployeeId,UserId,FullName,OfficialEmail,IsActive,LastSyncedAtUtc)
 SELECT 'PLAN-'+RIGHT(CONVERT(varchar(36),UserId),2),UserId,DisplayName,'planning'+RIGHT(CONVERT(varchar(36),UserId),2)+'@example.invalid',1,SYSUTCDATETIME() FROM gp.Users WHERE IdentityIssuer IN('planning-test','planning-rpc-test');
UPDATE gp.Projects SET LastSyncedAtUtc=SYSUTCDATETIME();
INSERT gp.Projects(ExternalProjectCode,ProjectName,LastSyncedAtUtc) VALUES('PLAN_CLIENT_B','Other client',SYSUTCDATETIME());
INSERT gp.ProjectLocations(ProjectId,LocationId) VALUES(2,1);
INSERT gp.EmployeeOfficeMemberships(EmployeeId,LocationId,IsActive,VerifiedAtUtc) VALUES('PLAN-01',1,1,SYSUTCDATETIME());
INSERT gp.EmployeeProjectMemberships(EmployeeId,ProjectId,IsActive,VerifiedAtUtc) VALUES('PLAN-01',1,1,SYSUTCDATETIME());
INSERT gp.EmployeeProjectLocationMemberships(EmployeeId,ProjectLocationId,IsActive,VerifiedAtUtc) VALUES('PLAN-01',1,1,SYSUTCDATETIME());
INSERT gp.AccountHosts VALUES(1,'PLAN-01',1,1,'00000000-0000-0000-0000-000000000004',SYSUTCDATETIME(),'Synthetic approved host');
INSERT gp.StaffRoleGrants(UserId,RoleCode,ScopeType,GrantedByUserId,ValidFromUtc) VALUES('00000000-0000-0000-0000-000000000004','INDIA_ADMIN','INDIA','00000000-0000-0000-0000-000000000004',DATEADD(hour,-1,SYSUTCDATETIME()));
INSERT gp.GrantCapabilities SELECT RoleGrantId,'ROLE_GRANTS_MANAGE' FROM gp.StaffRoleGrants WHERE UserId='00000000-0000-0000-0000-000000000004';
INSERT gp.StaffRoleGrants(UserId,RoleCode,ScopeType,ProjectLocationId,GrantedByUserId,ValidFromUtc) VALUES('00000000-0000-0000-0000-000000000010','PROJECT_ADMIN','PROJECT_LOCATION',1,'00000000-0000-0000-0000-000000000004',DATEADD(hour,-1,SYSUTCDATETIME()));
INSERT gp.GrantCapabilities SELECT RoleGrantId,'ROLE_GRANTS_MANAGE' FROM gp.StaffRoleGrants WHERE UserId='00000000-0000-0000-0000-000000000010';
INSERT gp.Sessions(SessionHash,UserId,CsrfHash,AuthorizationVersionAtIssue,LastSeenAtUtc,IdleExpiresAtUtc,AbsoluteExpiresAtUtc,CreatedAtUtc)
 SELECT HASHBYTES('SHA2_256',CONVERT(varbinary(32),REPLICATE(RIGHT(CONVERT(varchar(36),UserId),2),32),2)),UserId,HASHBYTES('SHA2_256',CONVERT(varbinary(32),REPLICATE('FF',32),2)),AuthorizationVersion,DATEADD(second,-1,SYSUTCDATETIME()),DATEADD(hour,2,SYSUTCDATETIME()),DATEADD(hour,3,SYSUTCDATETIME()),DATEADD(hour,-1,SYSUTCDATETIME()) FROM gp.Users WHERE IdentityIssuer IN('planning-test','planning-rpc-test');
'@
$identities=@{}
foreach($n in @(1,2,3,4,5,6,7,8,10)){$uid=Id $n;$row=(Sql "SELECT CONVERT(varchar(64),SessionHash,2) sessionHex,CONVERT(varchar(64),CsrfHash,2) csrfHex FROM gp.Sessions WHERE UserId='$uid' FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;")|ConvertFrom-Json;$identities[$n]=@{SessionHash=[Convert]::FromHexString($row.sessionHex);CsrfHash=[Convert]::FromHexString($row.csrfHex)}}
$null=Sql "EXECUTE AS USER='gp_planning_api_probe';"
try{
 function Manage([string]$action,[hashtable]$payload,[int]$who=4){return Rpc 'gp.ManageVisitPlanning' ($identities[$who]+@{Action=$action;ClientKey=[guid]::NewGuid();PayloadJson=($payload|ConvertTo-Json -Depth 20 -Compress)})}
 function Read([string]$mode,[hashtable]$query,[int]$who){return Rpc 'gp.ReadVisitCoordination' ($identities[$who]+@{Mode=$mode;QueryJson=($query|ConvertTo-Json -Compress)})}
 $office=@{approvalRules=@(@{id=(Id 202);name='Office security';kind='SECURITY';mode='ALL';approverIds=@((Id 7))});arrangements=@(@{id=(Id 300);name='Stay';kind='STAY';mandatoryForEntry=$false;ownerIds=@((Id 3))});receptionIds=@();securityIds=@((Id 7));notifyIds=@((Id 6));vipNotifyIds=@((Id 6));maximumAdvanceDays=90;maximumVisitDays=30}
 $alpha=@{approvalRules=@(@{id=(Id 210);name='Alpha permission';kind='PROJECT';mode='ALL';approverIds=@((Id 2))})}
 $beta=@{approvalRules=@(@{id=(Id 211);name='Beta permission';kind='PROJECT';mode='ALL';approverIds=@((Id 8))})}
 $null=Manage 'POLICY' @{locationId=1;revision=0;reason='Configure office';definition=$office}
 $null=Manage 'POLICY' @{subProjectId=(Id 100);revision=0;reason='Configure Alpha';definition=$alpha}
 $b=Manage 'PROJECT' @{locationId=1;accountOfficeId='3';name='Beta-private';active=$true;revision=0;reason='Create Beta'}
 $null=Manage 'POLICY' @{subProjectId=$b.id;revision=0;reason='Configure Beta';definition=$beta}
 $context=Rpc 'gp.GetStaffAccessContext' $identities[1];Check ($context.coordinationAvailable -eq $true) 'Source account host discovers workspace without child host assignments'
 $null=Sql 'REVERT;'
 try {
  Check ((Sql "SELECT COUNT(*) FROM gp.EmployeeProjectLocationMemberships WHERE EmployeeId='PLAN-01' AND ProjectLocationId=3;") -eq 0 -and (Sql "SELECT COUNT(*) FROM gp.SubProjectHosts WHERE EmployeeId='PLAN-01';") -eq 0) 'Cross-account invitation requires no destination membership or child host roster'
  $query="DECLARE @now datetime2(3)=SYSUTCDATETIME();SELECT gp._PlanningHost('$(Id 1)',1,'$($b.id)',@now,DATEADD(hour,-1,@now));"
  Check ((Sql $query) -eq 1) 'Source hosting sponsors active cross-account destination'
  $null=Sql 'UPDATE gp.Projects SET LastSyncedAtUtc=DATEADD(day,-2,SYSUTCDATETIME()) WHERE ProjectId=2;'
  Check ((Sql $query) -eq 0) 'Stale destination parent blocks request despite valid source'
  $null=Sql 'UPDATE gp.Projects SET LastSyncedAtUtc=SYSUTCDATETIME(),IsActive=0 WHERE ProjectId=2;'
  Check ((Sql $query) -eq 0) 'Inactive destination parent blocks request despite valid source'
  $null=Sql 'UPDATE gp.Projects SET IsActive=1 WHERE ProjectId=2;UPDATE gp.ProjectLocations SET IsActive=0 WHERE ProjectLocationId=3;'
  Check ((Sql $query) -eq 0) 'Inactive destination office binding blocks request'
  $null=Sql 'UPDATE gp.ProjectLocations SET IsActive=1 WHERE ProjectLocationId=3;UPDATE gp.EmployeeProjectLocationMemberships SET VerifiedAtUtc=DATEADD(day,-2,SYSUTCDATETIME()) WHERE EmployeeId=''PLAN-01'';'
  Check ((Sql $query) -eq 0) 'Stale source membership cannot sponsor a destination'
 } finally { $null=Sql 'UPDATE gp.Projects SET LastSyncedAtUtc=SYSUTCDATETIME(),IsActive=1 WHERE ProjectId=2;UPDATE gp.ProjectLocations SET IsActive=1 WHERE ProjectLocationId=3;UPDATE gp.EmployeeProjectLocationMemberships SET VerifiedAtUtc=SYSUTCDATETIME() WHERE EmployeeId=''PLAN-01'';EXECUTE AS USER=''gp_planning_api_probe'';' }
 $null=Manage 'HOST' @{subProjectId=(Id 100);userId=(Id 1);active=$true;revision=0;reason='Assign approved host'}
 Check ((Read 'OPTIONS' @{} 1).projects.Count -eq 2) 'Source-only host sees all active same-office destinations'
 $options=Read 'OPTIONS' @{} 1;Check ($options.policies.Count -eq 0 -and $options.people.Count -eq 0 -and $options.hosts.Count -eq 0) 'Destination discovery grants no management rosters or authority configuration'
 $context=Rpc 'gp.GetStaffAccessContext' $identities[1];Check ($context.coordinationAvailable -eq $true) 'Current approved host receives Coordination workspace capability'
 foreach($bad in @(@{locationId='bad'},@{locationId=$null},@{offset='bad'},@{offset=1.5},@{fromUtc='invalid'},@{untilUtc='2026-02-30T00:00:00.000Z'},@{folder=@('MY')})){Reject 52002 {Read 'LIST' $bad 1}}

 Reject 52001 {Manage 'POLICY' @{locationId=1;revision=1;reason='Cannot change office baseline';definition=$office} 10}
 Reject 52001 {Manage 'HOST' @{subProjectId=$b.id;userId=(Id 1);active=$false;revision=1;reason='Cross-account attempt'} 10}
 Reject 52001 {Read 'OPTIONS' @{} 5}
 $start=[datetime]::UtcNow.AddHours(3);$until=$start.AddDays(1)
 $draft=@{locationId=1;subProjectIds=@((Id 100),$b.id);visitorName='RPC synthetic guest';visitorEmail='guest@example.invalid';purpose='Restricted client meeting';startsAtUtc=$start.ToString('yyyy-MM-ddTHH:mm:ss.fffZ');untilUtc=$until.ToString('yyyy-MM-ddTHH:mm:ss.fffZ');vip=$true;stay=@{checkInDate=$start.AddMinutes(330).ToString('yyyy-MM-dd');checkOutDate=$until.AddDays(1).AddMinutes(330).ToString('yyyy-MM-dd');notes='Planning stay test'}}
 $createParams=$identities[1]+@{ClientKey=[guid]::NewGuid();DraftJson=($draft|ConvertTo-Json -Depth 15 -Compress)}
 $plan=Rpc 'gp.CreatePlannedVisit' $createParams;$again=Rpc 'gp.CreatePlannedVisit' $createParams
 Check ($plan.id -eq $again.id -and $plan.revision -eq 1) 'Create replay is idempotent'
 Reject 52001 {Read 'DETAIL' @{planId=$plan.id} 2}
 function Change([hashtable]$command,[int]$who=1,[int]$revision=$script:currentRevision,[guid]$key=[guid]::NewGuid()){
  $r=Rpc 'gp.ChangePlannedVisit' ($identities[$who]+@{PlanId=[guid]$plan.id;ClientKey=$key;ExpectedRevision=$revision;CommandJson=($command|ConvertTo-Json -Depth 20 -Compress)});$script:currentRevision=[int]$r.revision;return $r
 }
 $script:currentRevision=1;$submitKey=[guid]::NewGuid();$null=Change @{kind='SUBMIT'} 1 1 $submitKey;$null=Change @{kind='SUBMIT'} 1 1 $submitKey
 Check ($script:currentRevision -eq 2) 'Submit replay does not duplicate revision'
 $d=Read 'DETAIL' @{planId=$plan.id} 1;Check ($d.approvals.Count -eq 3 -and $d.tasks.Count -eq 1) 'Office plus project steps and stay task persist'
 Reject 52001 {Read 'DETAIL' @{planId=$plan.id} 6}
 Reject 52001 {Change @{kind='DECIDE';stepId=(Id 210);decision='APPROVED';reason='Cannot self approve'} 1}
 Reject 52001 {Change @{kind='DECIDE';stepId=(Id 210);decision='APPROVED';reason='Facilities cannot approve'} 3}
 $null=Change @{kind='DECIDE';stepId=(Id 210);decision='APPROVED';reason='Alpha cleared'} 2
 $null=Change @{kind='DECIDE';stepId=(Id 202);decision='APPROVED';reason='Office cleared'} 7
 $d=Read 'DETAIL' @{planId=$plan.id} 1
 Check (($d.projects|Where-Object subProjectId -eq (Id 100)).readiness -eq 'READY' -and ($d.projects|Where-Object subProjectId -eq $b.id).readiness -eq 'PENDING') 'Project approvals remain independent'
 $d=Read 'DETAIL' @{planId=$plan.id} 2;Check ($d.projects.Count -eq 1 -and ($d|ConvertTo-Json -Depth 20) -notmatch 'Beta-private') 'Project authority cannot read sibling account details'
 $d=Read 'DETAIL' @{planId=$plan.id} 10;Check ($d.projects.Count -eq 1) 'Account admin is scoped inside a multi-account plan'
 $d=Read 'DETAIL' @{planId=$plan.id} 3;Check ($d.tasks.Count -eq 1 -and $d.projects.Count -eq 0 -and -not($d.PSObject.Properties.Name -contains 'visitorEmail') -and -not($d.PSObject.Properties.Name -contains 'purpose')) 'Facilities projection omits unrelated details'
 Reject 52001 {Change @{kind='ARRANGE';taskId=(Id 300);status='CONFIRMED';remark='Host cannot claim booking'} 1}
 $null=Change @{kind='ARRANGE';taskId=(Id 300);status='CONFIRMED';remark='Booked by facilities'} 3
 $private=[guid]::NewGuid().ToString();$ops=[guid]::NewGuid().ToString()
 $null=Change @{kind='THREAD';threadId=$private;title='Private Alpha';audience='APPROVAL';subProjectId=(Id 100);targetId=(Id 210)} 2
 $null=Change @{kind='THREAD';threadId=$ops;title='Stay discussion';audience='OPERATIONS';subProjectId=$null;targetId=(Id 300)} 3
 $d=Read 'DETAIL' @{planId=$plan.id} 1;Check ($d.threads.Count -eq 1 -and $d.threads[0].id -eq $ops) 'Host does not inherit private authority thread'
 Reject 52001 {Change @{kind='COMMENT';threadId=$private;messageId=[guid]::NewGuid().ToString();body='Attempt to read/write private thread';replyToId=$null;mentionIds=@()} 8}
 Reject 52002 {Change @{kind='COMMENT';threadId=$ops;messageId=[guid]::NewGuid().ToString();body='FYI is not thread membership';replyToId=$null;mentionIds=@((Id 6))} 1}
 $message=[guid]::NewGuid().ToString();$null=Change @{kind='COMMENT';threadId=$ops;messageId=$message;body='Please confirm arrival details';replyToId=$null;mentionIds=@((Id 3))} 1
 $null=Change @{kind='COMMENT';threadId=$ops;messageId=[guid]::NewGuid().ToString();body='Confirmed';replyToId=$message;mentionIds=@((Id 1))} 3
 $d=Read 'DETAIL' @{planId=$plan.id} 3;$messages=Read 'THREAD' @{planId=$plan.id;threadId=$ops} 3;Check ($messages.messages.Count -eq 2 -and $d.tasks[0].status -eq 'CONFIRMED') 'Thread replies and arrangement status are independent'
 $null=Change @{kind='THREAD_STATE';threadId=$ops;resolved=$true} 3
 Reject 52003 {Change @{kind='COMMENT';threadId=$ops;messageId=[guid]::NewGuid().ToString();body='Closed';replyToId=$null;mentionIds=@()} 1}
 $null=Change @{kind='THREAD_STATE';threadId=$ops;resolved=$false} 3
 Reject 52003 {Change @{kind='CANCEL';reason='Stale write'} 1 1}
 $alpha.approvalRules[0].approverIds=@((Id 5));$null=Manage 'POLICY' @{subProjectId=(Id 100);revision=1;reason='Replace authority';definition=$alpha}
 Reject 52001 {Read 'DETAIL' @{planId=$plan.id} 2}
 $d=Read 'DETAIL' @{planId=$plan.id} 1;Check ($d.projects[0].readiness -eq 'POLICY_CHANGED') 'Policy change blocks stale planning readiness'
 $null=Change @{kind='REVISE';draft=$draft;reason='Re-evaluate updated authorities'} 1
 $d=Read 'DETAIL' @{planId=$plan.id} 1;Check ($d.state -eq 'DRAFT' -and $d.version -eq 2 -and $d.threads.Count -eq 0 -and @($d.approvals|Where-Object status -eq 'APPROVED').Count -eq 0) 'Revision resets current decisions and retains old history'
 $null=Change @{kind='SUBMIT'} 1
 $null=Sql 'REVERT;UPDATE gp.AccountHosts SET IsActive=0 WHERE EmployeeId=''PLAN-01'' AND ProjectLocationId=1;EXECUTE AS USER=''gp_planning_api_probe'';'
 $d=Read 'DETAIL' @{planId=$plan.id} 1;Check (@($d.projects|Where-Object readiness -ne 'BLOCKED').Count -eq 0) 'Revoking sole source sponsorship blocks every destination'
 Reject 52001 {Rpc 'gp.CreatePlannedVisit' $createParams}
 Reject 52001 {Change @{kind='DECIDE';stepId=(Id 211);decision='APPROVED';reason='Source host revoked'} 8}
 $options=Read 'OPTIONS' @{} 1;Check (@($options.projects|Where-Object canHost).Count -eq 0 -and @($options.locations|Where-Object canHostLocation).Count -eq 0) 'Historical ownership does not retain request sponsorship'
 $null=Sql 'REVERT;UPDATE gp.AccountHosts SET IsActive=1 WHERE EmployeeId=''PLAN-01'' AND ProjectLocationId=1;EXECUTE AS USER=''gp_planning_api_probe'';'
 $null=Change @{kind='CANCEL';reason='Visit no longer required'} 1
 Reject 52003 {Change @{kind='SUBMIT'} 1}
 Check (@((Read 'LIST' @{folder='MY'} 1).visits|Where-Object id -eq $plan.id).Count -eq 1) 'Owned inbox lists persisted visit'
 Write-Output "PASS: $checks isolated execute-only planning management, persistence, replay, scope, privacy and workflow cases."
}finally{$null=Sql 'REVERT;'}
