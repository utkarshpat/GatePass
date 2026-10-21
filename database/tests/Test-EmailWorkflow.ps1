#Requires -Version 7.0
[CmdletBinding()]param([switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$c=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;$run=[guid]::NewGuid();$ready=$false;$created=$false;$worker=$null;$api=$null;$principal='gp_email_test_'+$run.ToString('N');$results=[Collections.Generic.List[object]]::new()
function Assert($v,$message){if(-not $v){throw $message}}
function Expect([scriptblock]$work,[int]$number){try{$null=&$work}catch{if($_.Exception.GetBaseException().Number -eq $number){return};throw};throw "Expected SQL $number"}
function Case($name,[scriptblock]$work){try{$null=&$work;$results.Add(@{name=$name;passed=$true});Write-Output "PASS: $name"}catch{$results.Add(@{name=$name;passed=$false});Write-Output "FAIL: $name -- $($_.Exception.Message)"}}
try{
 $f=(Invoke-GatePassScalar $c (Get-Content (Join-Path $PSScriptRoot '002_transaction_fixtures.sql') -Raw) @{RunId=$run})|ConvertFrom-Json;$ready=$true
 $hostActor=$f.actors.Where({$_.Label -eq 'HOST'})[0];$other=$f.actors.Where({$_.Label -eq 'OTHERHOST'})[0];$pending=$f.visits.Where({$_.Label -eq 'PENDING'})[0];$second=$f.visits.Where({$_.Label -eq 'DECISION_DENY'})[0];$claim=[guid]::NewGuid()
 $notification=[long](Invoke-GatePassScalar $c "INSERT gp.NotificationOutbox(VisitRequestId,RecipientKind,RecipientEmployeeId,TemplateCode,PayloadJson,DedupeHash,Status,AttemptCount,LockedBy,LockedUntilUtc) VALUES(@v,'EMPLOYEE',@host,'HOST_APPROVAL_REQUEST',(SELECT @v visitRequestId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),HASHBYTES('SHA2_256',CONVERT(binary(16),@v)),'PROCESSING',1,@claim,DATEADD(minute,5,SYSUTCDATETIME()));SELECT CONVERT(bigint,SCOPE_IDENTITY());" @{v=[guid]$pending.VisitId;host=$f.hostEmployeeId;claim=$claim})
 Invoke-GatePassNonQuery $c "CREATE USER [$principal] WITHOUT LOGIN;ALTER ROLE gp_worker_runtime ADD MEMBER [$principal];CREATE USER [$($principal)_api] WITHOUT LOGIN;ALTER ROLE gp_api_runtime ADD MEMBER [$($principal)_api];";$created=$true
 $worker=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $worker "EXECUTE AS USER='$principal';"
 $api=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $api "EXECUTE AS USER='$($principal)_api';"
 $p=@{n=$notification;claim=$claim}
 Case 'Mail worker has no table, approval, holder-status or credential-source authority' {
  Expect {Invoke-GatePassScalar $worker 'SELECT COUNT(*) FROM gp.NotificationOutbox;'} 229
  foreach($proc in @('DecideVisit','ReadEmailRequest','GetEmailRequestCard','GetEmployeeRequestCard')){Expect {Invoke-GatePassScalar $worker ('EXEC gp.'+$proc+';')} 229}
  Expect {Invoke-GatePassScalar $api 'EXEC gp.GetNotificationEmail;'} 229;Expect {Invoke-GatePassScalar $api 'EXEC gp.GetEmailRequestCard;'} 229
 }
 Case 'Fenced email content contains individual details without private photo, QR, session or recipient cache' {
  $r=(Invoke-GatePassScalar $worker 'EXEC gp.GetNotificationEmail @NotificationId=@n,@ClaimToken=@claim;' $p)|ConvertFrom-Json
  Assert ($r.status -eq 'READY' -and $r.details.visitRequestId -eq $pending.VisitId -and $r.recipientEmployeeId -eq $f.hostEmployeeId) 'Wrong email subject/recipient.'
  Assert (($r|ConvertTo-Json -Depth 8) -notmatch 'storageKey|credentialHash|ciphertext|SessionHash|recipientEmail"') 'Email content exposed private source.'
 }
 Case 'Wrong or expired claim cannot read email content' {
  Expect {Invoke-GatePassScalar $worker 'EXEC gp.GetNotificationEmail @NotificationId=@n,@ClaimToken=@claim;' @{n=$notification;claim=[guid]::NewGuid()}} 52003
  try{Invoke-GatePassNonQuery $c 'UPDATE gp.NotificationOutbox SET LockedUntilUtc=DATEADD(second,-1,SYSUTCDATETIME()) WHERE NotificationId=@n;' @{n=$notification};Expect {Invoke-GatePassScalar $worker 'EXEC gp.GetNotificationEmail @NotificationId=@n,@ClaimToken=@claim;' $p} 52003}finally{Invoke-GatePassNonQuery $c 'UPDATE gp.NotificationOutbox SET LockedUntilUtc=DATEADD(minute,5,SYSUTCDATETIME()) WHERE NotificationId=@n;' @{n=$notification}}
 }
 Case 'Actual TypeScript worker sends through a capture provider and acknowledges its fenced SQL job' {
  $process=[Diagnostics.Process]::new();$process.StartInfo=[Diagnostics.ProcessStartInfo]::new('node');$process.StartInfo.ArgumentList.Add((Join-Path $taskRoot 'tests/notification-email.sql-integration.ts'));$process.StartInfo.WorkingDirectory=$taskRoot;$process.StartInfo.UseShellExecute=$false;$process.StartInfo.CreateNoWindow=$true;$process.StartInfo.RedirectStandardInput=$true;$process.StartInfo.RedirectStandardOutput=$true;$process.StartInfo.RedirectStandardError=$true;$process.StartInfo.Environment['NODE_ENV']='test';$process.StartInfo.Environment['GATEPASS_SSO_MODE']='dummy';$process.StartInfo.Environment['GATEPASS_DIRECTORY_MODE']='mock';$null=$process.Start();$process.StandardInput.Write((@{notificationId=$notification;claimToken=$claim;employeeId=$f.hostEmployeeId;visitId=$pending.VisitId;personName='Synthetic PENDING'}|ConvertTo-Json -Compress));$process.StandardInput.Close();$output=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync();if(-not $process.WaitForExit(120000)){$process.Kill($true);throw 'Capture provider integration timed out.'};$report=$output.GetAwaiter().GetResult()|ConvertFrom-Json;$null=$stderr.GetAwaiter().GetResult();Assert ($report.status -eq 'PASS' -and -not $report.externalMailSent) 'Actual worker/capture provider failed.'
  Assert ((Invoke-GatePassScalar $c 'SELECT Status FROM gp.NotificationOutbox WHERE NotificationId=@n;' @{n=$notification}) -eq 'SENT') 'SQL lease was not acknowledged.'
 }
 # A separate owned resend exercises state cancellation; the sent record is never reopened.
 $notification=[long](Invoke-GatePassScalar $c "INSERT gp.NotificationOutbox(VisitRequestId,RecipientKind,RecipientEmployeeId,TemplateCode,PayloadJson,DedupeHash,Status,AttemptCount,LockedBy,LockedUntilUtc) VALUES(@v,'EMPLOYEE',@host,'HOST_APPROVAL_REQUEST',(SELECT @v visitRequestId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),HASHBYTES('SHA2_256',CONVERT(binary(16),@claim)),'PROCESSING',1,@claim,DATEADD(minute,5,SYSUTCDATETIME()));SELECT CONVERT(bigint,SCOPE_IDENTITY());" @{v=[guid]$pending.VisitId;host=$f.hostEmployeeId;claim=$claim});$p=@{n=$notification;claim=$claim}
 $decision=@{s=[Convert]::FromHexString($hostActor.SessionHex);csrf=[Convert]::FromHexString($hostActor.CsrfHex);key=[guid]::NewGuid();v=[guid]$pending.VisitId;hash=[Convert]::FromHexString($pending.SnapshotHex);decision='APPROVED'}
 $decisionSql='EXEC gp.DecideVisit @SessionHash=@s,@CsrfHash=@csrf,@ClientKey=@key,@VisitRequestId=@v,@SnapshotVersion=1,@SnapshotHash=@hash,@Decision=@decision;'
 Case 'Forwarded host link and changed snapshot cannot approve a request' {
  $wrong=$decision.Clone();$wrong.s=[Convert]::FromHexString($other.SessionHex);$wrong.csrf=[Convert]::FromHexString($other.CsrfHex);Expect {Invoke-GatePassScalar $api $decisionSql $wrong} 52001
  $wrong=$decision.Clone();$wrong.hash=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);Expect {Invoke-GatePassScalar $api $decisionSql $wrong} 52003
 }
 Case 'Approval retry is idempotent and leaves the other participant pending' {
  $first=Invoke-GatePassScalar $api $decisionSql $decision;$retry=Invoke-GatePassScalar $api $decisionSql $decision;Assert ($first -eq $retry) 'Retry changed receipt.'
  Assert ((Invoke-GatePassScalar $c 'SELECT Status FROM gp.VisitRequests WHERE VisitRequestId=@v;' @{v=[guid]$second.VisitId}) -eq 'PENDING') 'Other participant changed.'
  Assert ((Invoke-GatePassScalar $c "SELECT COUNT(*) FROM gp.NotificationOutbox WHERE VisitRequestId=@v AND TemplateCode='VISIT_DECIDED';" @{v=[guid]$pending.VisitId}) -eq 1) 'Decision email duplicated.'
 }
 Case 'Independent rejection does not revoke an approved participant' {
  $deny=$decision.Clone();$deny.key=[guid]::NewGuid();$deny.v=[guid]$second.VisitId;$deny.hash=[Convert]::FromHexString($second.SnapshotHex);$deny.decision='DENIED';$null=Invoke-GatePassScalar $api $decisionSql $deny
  Assert ((Invoke-GatePassScalar $c 'SELECT Status FROM gp.VisitRequests WHERE VisitRequestId=@v;' @{v=[guid]$pending.VisitId}) -eq 'APPROVED') 'Rejection changed another participant.'
  Assert ((Invoke-GatePassScalar $c 'SELECT Status FROM gp.AccessPasses WHERE AccessPassId=@p;' @{p=[guid]$second.PassId}) -eq 'DENIED') 'Rejected pass stayed active.'
 }
 Case 'Stale approval email is cancelled before dispatch after decision' {
  $r=(Invoke-GatePassScalar $worker 'EXEC gp.GetNotificationEmail @NotificationId=@n,@ClaimToken=@claim;' $p)|ConvertFrom-Json;Assert ($r.status -eq 'CANCELLED') 'Old approval remained sendable.'
 }
 Case 'External status binds the recipient digest and immutable snapshot' {
  $proof=@{v=[guid]$pending.VisitId;hash=[Convert]::FromHexString($pending.SnapshotHex);email=[Convert]::FromHexString((Invoke-GatePassScalar $c "SELECT CONVERT(varchar(64),HASHBYTES('SHA2_256',LOWER(PersonEmail)),2) FROM gp.VisitRequests WHERE VisitRequestId=@v;" @{v=[guid]$pending.VisitId}))}
  $sql='EXEC gp.ReadEmailRequest @VisitRequestId=@v,@RecipientEmailHash=@email,@SnapshotHash=@hash;';$r=(Invoke-GatePassScalar $api $sql $proof)|ConvertFrom-Json;Assert ($r.status -eq 'APPROVED' -and $r.personName) 'Holder status missing.'
  $wrong=$proof.Clone();$wrong.email=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);Expect {Invoke-GatePassScalar $api $sql $wrong} 54101
  $wrong=$proof.Clone();$wrong.hash=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);Expect {Invoke-GatePassScalar $api $sql $wrong} 54101
  $wrong=$proof.Clone();$wrong.v=[guid]$second.VisitId;Expect {Invoke-GatePassScalar $api $sql $wrong} 54101
 }
}finally{
 if($worker){$worker.Dispose()};if($api){$api.Dispose()};try{if($ready){Invoke-GatePassNonQuery $c (Get-Content (Join-Path $PSScriptRoot '003_transaction_cleanup.sql') -Raw) @{RunId=$run}};if($created){Invoke-GatePassNonQuery $c "DROP USER [$principal];DROP USER [$($principal)_api];"}}finally{$c.Dispose()}
 @{status=$(if(@($results|Where-Object {-not $_.passed}).Count){'FAIL'}else{'PASS'});cases=@($results);actualMailSent=$false;ownedFixturesRemoved=$true}|ConvertTo-Json -Depth 6|Set-Content (Join-Path $taskRoot 'database/validation/email-workflow-report.json')
}
if(@($results|Where-Object {-not $_.passed}).Count){throw 'Email workflow SQL tests failed.'};Write-Output "PASS: $($results.Count) actual SQL email workflow cases; no external email sent."
