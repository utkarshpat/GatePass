#Requires -Version 7.0
[CmdletBinding()]param([switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$c=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;$run=[guid]::NewGuid();$f=$null;$api=$null;$race=$null;$created=$false;$principal='gp_returns_test_'+$run.ToString('N')
function Assert($value,$message){if(-not $value){throw $message}}
function Expect([scriptblock]$work,[int]$number){try{$null=&$work}catch{if($_.Exception.GetBaseException().Number -eq $number){return};throw};throw "Expected SQL $number"}
function Actor($label='RECEPTION'){$a=$f.actors.Where({$_.Label -eq $label})[0];return @{SessionHash=[Convert]::FromHexString($a.SessionHex);CsrfHash=[Convert]::FromHexString($a.CsrfHex)}}
function Visit($label){return $f.visits.Where({$_.Label -eq $label})[0]}
function Call($procedure,$p,$conn=$api){$argsSql=($p.Keys|ForEach-Object{'@'+$_+'=@'+$_}) -join ',';return Invoke-GatePassScalar $conn ('EXEC gp.'+$procedure+' '+$argsSql) $p}
function ReturnParams($label='MOVEMENT',$actor='RECEPTION'){$v=Visit $label;$p=Actor $actor;$p.ClientKey=[guid]::NewGuid();$p.VisitRequestId=[guid]$v.VisitId;$p.ExpectedPassId=[guid]$v.PassId;return $p}
function PrintOwned($label){$p=ReturnParams $label;$null=Call 'RequestPassPrint' $p;Invoke-GatePassNonQuery $c "UPDATE gp.PassPrintJobs SET Status='DISPATCHED',UpdatedAtUtc=SYSUTCDATETIME() WHERE VisitRequestId=@v;" @{v=$p.VisitRequestId}}
function MoveParams($label,$event){$v=Visit $label;$p=Actor 'GUARD';$p.ClientKey=[guid]::NewGuid();$p.VisitRequestId=[guid]$v.VisitId;$p.AccessPassId=[guid]$v.PassId;$p.LocationId=[int]$f.locationId;$p.SelectedProjectLocationId=[long]$f.projectLocationId;$p.EventType=$event;$p.EntryMethod='MANUAL';return $p}
try{
 $f=(Invoke-GatePassScalar $c (Get-Content (Join-Path $PSScriptRoot '002_transaction_fixtures.sql') -Raw) @{RunId=$run})|ConvertFrom-Json
 $rec=$f.actors.Where({$_.Label -eq 'RECEPTION'})[0]
 Invoke-GatePassNonQuery $c "INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) VALUES(@g,'VISITS_READ'),(@g,'PASS_PRINT'),(@g,'PASS_REISSUE');" @{g=[long]$rec.GrantId}
 Invoke-GatePassNonQuery $c "CREATE USER [$principal] WITHOUT LOGIN;ALTER ROLE gp_api_runtime ADD MEMBER [$principal];";$created=$true
 $api=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $api "EXECUTE AS USER='$principal';"
 Expect {Call 'ReturnReceptionPass' (ReturnParams)} 54503
 PrintOwned 'MOVEMENT'
 foreach($label in @('WRONGLOCATION','HOST','GUARD')){Expect {Call 'ReturnReceptionPass' (ReturnParams 'MOVEMENT' $label)} 53501}
 $p=ReturnParams;$p.ExpectedPassId=[guid]::NewGuid();Expect {Call 'ReturnReceptionPass' $p} 54503
 Expect {Invoke-GatePassScalar $api 'SELECT COUNT(*) FROM gp.PassReturns;'} 229
 Write-Output 'PASS: role, office, credential and unprinted boundaries; no runtime table access'
 $originalEntry=MoveParams 'MOVEMENT' 'ENTRY';$null=Call 'RecordMovement' $originalEntry;Expect {Call 'ReturnReceptionPass' (ReturnParams)} 54504
 $null=Call 'RecordMovement' (MoveParams 'MOVEMENT' 'EXIT')
 $p=ReturnParams;$first=Call 'ReturnReceptionPass' $p;Assert ((Call 'ReturnReceptionPass' $p) -eq $first) 'Idempotent replay changed receipt'
 Expect {Call 'ReturnReceptionPass' (ReturnParams)} 54503
 Expect {Call 'RecordMovement' (MoveParams 'MOVEMENT' 'ENTRY')} 52005
 Expect {Call 'RecordMovement' $originalEntry} 52005
 Expect {Call 'RequestPassPrint' (ReturnParams)} 53105
 $reissue=ReturnParams;$reissue.Reason='Test replacement';Expect {Call 'ReissuePass' $reissue} 53105
 $cancel=Actor 'HOST';$cancel.ClientKey=[guid]::NewGuid();$cancel.VisitRequestId=$p.VisitRequestId;$cancel.ExpectedPassId=$p.ExpectedPassId;$cancel.Reason='Post-return cancel attempt';Expect {Call 'CancelVisit' $cancel} 52005
 $hostDetail=Actor 'HOST';$hostDetail.View='HOST';$hostDetail.VisitRequestId=$p.VisitRequestId;Assert (-not ((Call 'GetVisitDetail' $hostDetail)|ConvertFrom-Json).canCancel) 'Returned visit remained cancellable'
 Assert ((Invoke-GatePassScalar $c 'SELECT COUNT(*) FROM gp.SecurityAuditEvents WHERE ActionCode=''PASS_RETURNED'' AND TargetReference=CONVERT(varchar(36),@v);' @{v=$p.VisitRequestId}) -eq 1) 'Duplicate return audit'
 Write-Output 'PASS: inside block, final return, replay, duplicate denial, blocked entry/print/reissue/cancel and one audit'
 PrintOwned 'DUPENTRY';$old=[guid](Visit 'DUPENTRY').VisitId
 Invoke-GatePassNonQuery $c 'UPDATE gp.VisitRequests SET LocalVisitDate=DATEADD(day,-1,LocalVisitDate),ValidFromUtc=DATEADD(day,-1,ValidFromUtc),ValidUntilUtc=DATEADD(day,-1,ValidUntilUtc),SubmittedAtUtc=DATEADD(day,-1,SubmittedAtUtc),ApprovalDeadlineUtc=DATEADD(day,-1,ApprovalDeadlineUtc) WHERE VisitRequestId=@v;' @{v=$old}
 $list=Actor;$list.LocationId=[int]$f.locationId;$list.PendingReturns=$true;$list.Search=$f.prefix
 $r=(Call 'ListReceptionVisits' $list)|ConvertFrom-Json;Assert ($r.pendingReturnCount -ge 1 -and $r.visits.Count -eq 1 -and [guid]$r.visits[0].visitRequestId -eq $old) 'Old pending return missing or duplicate count'
 $before=$r.pendingReturnCount;$null=Call 'ReturnReceptionPass' (ReturnParams 'DUPENTRY');$r=(Call 'ListReceptionVisits' $list)|ConvertFrom-Json;Assert ($r.pendingReturnCount -eq ($before-1) -and $r.visits.Count -eq 0) 'Returned expired pass still pending'
 Write-Output 'PASS: old expired printed passes remain pending until explicitly returned'
 # Presence on a separate employee request must block returning their temporary ID.
 $sibling=[guid](Visit 'EMP_DISABLED').VisitId
 Invoke-GatePassNonQuery $c "UPDATE gp.VisitRequests SET EmployeeId=@employee WHERE VisitRequestId=@sibling;UPDATE gp.AccessPasses SET Status='ACTIVE' WHERE VisitRequestId=@sibling;" @{employee=$f.hostEmployeeId;sibling=$sibling}
 Invoke-GatePassNonQuery $c @'
DECLARE @op uniqueidentifier=NEWID();
INSERT gp.IdempotencyRequests(OperationId,ActorBindingHash,OperationCode,ClientKey,PayloadHash,Status,ResultJson,CompletedAtUtc,ExpiresAtUtc) VALUES(@op,HASHBYTES('SHA2_256',CONVERT(binary(16),@actor)),'RETURN_TEST_SETUP',NEWID(),CRYPT_GEN_RANDOM(32),'COMPLETED',N'{}',SYSUTCDATETIME(),DATEADD(day,1,SYSUTCDATETIME()));
INSERT gp.AccessEvents(VisitRequestId,AccessPassId,ActorUserId,LocationId,EventType,EntryMethod,OperationId,OccurredAtUtc) VALUES(@sibling,@pass,@actor,@location,'ENTRY','MANUAL',@op,SYSUTCDATETIME());
UPDATE gp.VisitPresence SET IsInside=1,LastAccessEventId=SCOPE_IDENTITY(),LastMovementAtUtc=SYSUTCDATETIME() WHERE VisitRequestId=@sibling;
'@ @{sibling=$sibling;pass=[guid](Visit 'EMP_DISABLED').PassId;actor=[guid]$rec.UserId;location=[int]$f.locationId}
 PrintOwned 'TEMP';Expect {Call 'ReturnReceptionPass' (ReturnParams 'TEMP')} 54504
 Invoke-GatePassNonQuery $c 'UPDATE gp.VisitPresence SET IsInside=0 WHERE VisitRequestId=@v;' @{v=$sibling}
 Invoke-GatePassNonQuery $c 'INSERT gp.EmployeeProjectPresence(VisitRequestId,ProjectLocationId,EmployeeId,IsInside) VALUES(@v,@project,@employee,1);' @{v=[guid](Visit 'TEMP').VisitId;project=[long]$f.projectLocationId;employee=$f.hostEmployeeId}
 Expect {Call 'ReturnReceptionPass' (ReturnParams 'TEMP')} 54504
 Invoke-GatePassNonQuery $c 'UPDATE gp.EmployeeProjectPresence SET IsInside=0 WHERE VisitRequestId=@v;' @{v=[guid](Visit 'TEMP').VisitId}
 $null=Call 'ReturnReceptionPass' (ReturnParams 'TEMP')
 Write-Output 'PASS: person-level presence in a sibling employee request blocks final return'
 PrintOwned 'MOVEMENT_RACE';$ret=ReturnParams 'MOVEMENT_RACE';$move=MoveParams 'MOVEMENT_RACE' 'ENTRY'
 $race=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $race "EXECUTE AS USER='$principal';"
 $retArgs=($ret.Keys|ForEach-Object{'@'+$_+'=@'+$_}) -join ',';$moveArgs=($move.Keys|ForEach-Object{'@'+$_+'=@'+$_}) -join ','
 $rc=New-GatePassSqlCommand $api ('EXEC gp.ReturnReceptionPass '+$retArgs) $ret;$mc=New-GatePassSqlCommand $race ('EXEC gp.RecordMovement '+$moveArgs) $move
 try{$rt=$rc.ExecuteScalarAsync();$mt=$mc.ExecuteScalarAsync();$wins=0;foreach($t in @($rt,$mt)){try{$null=$t.GetAwaiter().GetResult();$wins++}catch{if($_.Exception.GetBaseException().Number -notin @(54504,52005)){throw}}};Assert ($wins -eq 1) 'Race must have exactly one successful action'}finally{$rc.Dispose();$mc.Dispose()}
 Assert ((Invoke-GatePassScalar $c 'SELECT COUNT(*) FROM gp.PassReturns r JOIN gp.VisitPresence s ON s.VisitRequestId=r.VisitRequestId WHERE r.VisitRequestId=@v AND s.IsInside=1;' @{v=$ret.VisitRequestId}) -eq 0) 'Returned pass has inside presence'
 Write-Output 'PASS: concurrent final return and project entry cannot both succeed'
}finally{
 if($api){$api.Dispose()};if($race){$race.Dispose()}
 try{if($f){Invoke-GatePassNonQuery $c 'DELETE r FROM gp.PassReturns r JOIN gp.VisitRequests v ON v.VisitRequestId=r.VisitRequestId WHERE v.PublicReference LIKE @prefix+''-%'';' @{prefix=$f.prefix};Invoke-GatePassNonQuery $c (Get-Content (Join-Path $PSScriptRoot '003_transaction_cleanup.sql') -Raw) @{RunId=$run}}
 if($created){Invoke-GatePassNonQuery $c "DROP USER [$principal];"}}finally{$c.Dispose()}
}
