#Requires -Version 7.0
[CmdletBinding()]param([switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$db=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;$run=[guid]::NewGuid();$api=$null;$worker=$null;$ready=$false;$created=$false;$principal='gp_email_revoke_'+$run.ToString('N');$cases=0
function Assert($ok,$message){if(-not $ok){throw $message}}
function Expect([scriptblock]$work,[int]$number){try{$null=&$work}catch{if($_.Exception.GetBaseException().Number -eq $number){return};throw};throw "Expected SQL $number"}
function Params($label){$v=$f.visits.Where({$_.Label -eq $label})[0];return @{VisitRequestId=[guid]$v.VisitId;RecipientEmailHash=[Convert]::FromHexString((Invoke-GatePassScalar $db "SELECT CONVERT(varchar(64),HASHBYTES('SHA2_256',LOWER(PersonEmail)),2) FROM gp.VisitRequests WHERE VisitRequestId=@id;" @{id=[guid]$v.VisitId}));SnapshotHash=[Convert]::FromHexString($v.SnapshotHex);ClientKey=[guid]::NewGuid();ExpectedPassId=[guid]$v.PassId}}
function Revoke($p){return (Invoke-GatePassScalar $api 'EXEC gp.RevokeEmailRequest @VisitRequestId=@VisitRequestId,@RecipientEmailHash=@RecipientEmailHash,@SnapshotHash=@SnapshotHash,@ClientKey=@ClientKey,@ExpectedPassId=@ExpectedPassId;' $p)|ConvertFrom-Json}
try{
 $f=(Invoke-GatePassScalar $db (Get-Content (Join-Path $PSScriptRoot '002_transaction_fixtures.sql') -Raw) @{RunId=$run})|ConvertFrom-Json;$ready=$true
 Invoke-GatePassNonQuery $db "CREATE USER [$principal] WITHOUT LOGIN;ALTER ROLE gp_api_runtime ADD MEMBER [$principal];CREATE USER [$($principal)_worker] WITHOUT LOGIN;ALTER ROLE gp_worker_runtime ADD MEMBER [$($principal)_worker];";$created=$true
 $api=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $api "EXECUTE AS USER='$principal';"
 $worker=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $worker "EXECUTE AS USER='$($principal)_worker';"
 Expect {Invoke-GatePassScalar $worker 'EXEC gp.RevokeEmailRequest;'} 229;Expect {Invoke-GatePassScalar $api 'SELECT COUNT(*) FROM gp.VisitRequests;'} 229;$cases++;Write-Output 'PASS: worker cannot revoke and API remains execute-only'
 foreach($field in @('RecipientEmailHash','SnapshotHash')){$p=Params 'PENDING';$p[$field]=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);Expect {Revoke $p} 54101};$p=Params 'PENDING';$p.ExpectedPassId=[guid]::NewGuid();Expect {Revoke $p} 52003
 $p=Params 'TEMP';Expect {Revoke $p} 54101;$cases++;Write-Output 'PASS: wrong recipient/snapshot/pass and employee requests are rejected'
 $p=Params 'PENDING';$p.RecipientEmailHash=[byte[]]::new(2);Expect {Revoke $p} 54102;$cases++;Write-Output 'PASS: malformed proof rejected before writes'
 $p=Params 'PHOTO_PURGED';try{Invoke-GatePassNonQuery $db 'UPDATE gp.VisitRequests SET PersonalDataPurgedAtUtc=SYSUTCDATETIME() WHERE VisitRequestId=@id;' @{id=$p.VisitRequestId};Expect {Revoke $p} 54101}finally{Invoke-GatePassNonQuery $db 'UPDATE gp.VisitRequests SET PersonalDataPurgedAtUtc=NULL WHERE VisitRequestId=@id;' @{id=$p.VisitRequestId}};$cases++;Write-Output 'PASS: purged request cannot be revoked through old email'
 $p=Params 'EXIT_EXPIRED';Expect {Revoke $p} 52005;$cases++;Write-Output 'PASS: expired pass cannot be revived or newly revoked'
 $p=Params 'PENDING';$sibling=$f.visits.Where({$_.Label -eq 'GROUP_OTHER'})[0]
 Invoke-GatePassNonQuery $db "INSERT gp.NotificationOutbox(VisitRequestId,RecipientKind,RecipientEmail,TemplateCode,PayloadJson,DedupeHash) VALUES(@v,'EMAIL','fixture@example.invalid','REQUEST_RECEIVED','{}',HASHBYTES('SHA2_256',CONVERT(binary(16),NEWID())));" @{v=$p.VisitRequestId}
 $first=Revoke $p;Assert ($first.status -eq 'CANCELLED' -and -not $first.wasInsideAtCancellation) 'Pending holder revoke failed'
 Assert ((Invoke-GatePassScalar $db 'SELECT Status FROM gp.AccessPasses WHERE AccessPassId=@id;' @{id=$p.ExpectedPassId}) -eq 'REVOKED') 'Pass remains usable'
 Assert ((Invoke-GatePassScalar $db 'SELECT Status FROM gp.VisitRequests WHERE VisitRequestId=@id;' @{id=[guid]$sibling.VisitId}) -eq 'PENDING') 'Sibling request changed'
 Assert ((Invoke-GatePassScalar $db "SELECT COUNT(*) FROM gp.NotificationOutbox WHERE VisitRequestId=@id AND Status IN('PENDING','PROCESSING');" @{id=$p.VisitRequestId}) -eq 0) 'Pending email was not cancelled'
 $cases++;Write-Output 'PASS: pending pass revoked with queued mail cancelled and sibling preserved'
 $replay=Revoke $p;Assert ($replay.operationId -eq $first.operationId) 'Retry created another operation'
 Assert ((Invoke-GatePassScalar $db "SELECT COUNT(*) FROM gp.SecurityAuditEvents WHERE ActionCode='EMAIL_PASS_REVOKED' AND TargetReference=CONVERT(varchar(36),@id);" @{id=$p.VisitRequestId}) -eq 1) 'Retry duplicated audit'
 $p.ExpectedPassId=[guid]::NewGuid();Expect {Revoke $p} 52003;$cases++;Write-Output 'PASS: same-key retry stable and changed pass conflicts'
 $p=Params 'MOVEMENT';$guard=$f.actors.Where({$_.Label -eq 'GUARD'})[0];$movement=@{SessionHash=[Convert]::FromHexString($guard.SessionHex);CsrfHash=[Convert]::FromHexString($guard.CsrfHex);ClientKey=[guid]::NewGuid();VisitRequestId=$p.VisitRequestId;AccessPassId=$p.ExpectedPassId;LocationId=[int]$f.locationId;SelectedProjectLocationId=[long]$f.projectLocationId;EventType='ENTRY';EntryMethod='MANUAL'};$argsSql=($movement.Keys|ForEach-Object{'@'+$_+'=@'+$_}) -join ',';$null=Invoke-GatePassScalar $api ('EXEC gp.RecordMovement '+$argsSql) $movement;$inside=Revoke $p;Assert ($inside.wasInsideAtCancellation) 'Inside flag lost';Assert ((Invoke-GatePassScalar $db 'SELECT IsInside FROM gp.VisitPresence WHERE VisitRequestId=@id;' @{id=$p.VisitRequestId})) 'Revocation erased presence';$cases++;Write-Output 'PASS: approved occupied pass revoked without removing presence'
 # Test the actual TypeScript service and local bridge for an employee owner; session data stays on stdin.
 $temp=$f.visits.Where({$_.Label -eq 'TEMP'})[0];$owner=$f.actors.Where({$_.Label -eq 'HOST'})[0]
 $ownerSession=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32);$ownerCsrf=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
 Invoke-GatePassNonQuery $db 'UPDATE gp.Sessions SET SessionHash=HASHBYTES(''SHA2_256'',@session),CsrfHash=HASHBYTES(''SHA2_256'',@csrf) WHERE UserId=@user;' @{session=$ownerSession;csrf=$ownerCsrf;user=[guid]$owner.UserId}
 $owner.SessionHex=[Convert]::ToHexString($ownerSession);$owner.CsrfHex=[Convert]::ToHexString($ownerCsrf)
 $process=[Diagnostics.Process]::new();$process.StartInfo=[Diagnostics.ProcessStartInfo]::new('node');$process.StartInfo.ArgumentList.Add((Join-Path $taskRoot 'tests/email-revocation.sql-integration.ts'));$process.StartInfo.WorkingDirectory=$taskRoot;$process.StartInfo.UseShellExecute=$false;$process.StartInfo.CreateNoWindow=$true;$process.StartInfo.RedirectStandardInput=$true;$process.StartInfo.RedirectStandardOutput=$true;$process.StartInfo.RedirectStandardError=$true
 foreach($entry in @{NODE_ENV='test';GATEPASS_SSO_MODE='dummy';GATEPASS_DIRECTORY_MODE='mock'}.GetEnumerator()){$process.StartInfo.Environment[$entry.Key]=$entry.Value}
 $null=$process.Start();$process.StandardInput.Write((@{visit=$temp.VisitId;pass=$temp.PassId;sessionHex=$owner.SessionHex;csrfHex=$owner.CsrfHex}|ConvertTo-Json -Compress));$process.StandardInput.Close();$out=$process.StandardOutput.ReadToEndAsync();$err=$process.StandardError.ReadToEndAsync();if(-not $process.WaitForExit(60000)){$process.Kill($true);throw 'Owner service timed out'};$report=$out.GetAwaiter().GetResult()|ConvertFrom-Json;$null=$err.GetAwaiter().GetResult();Assert ($process.ExitCode -eq 0 -and $report.status -eq 'PASS') 'Owner service failed';$cases++;Write-Output 'PASS: actual employee service requires OWN detail and revokes through restricted local bridge'
 Write-Output "PASS: $cases actual SQL revocation cases; no retained records or real emails used."
}finally{
 if($api){$api.Dispose()};if($worker){$worker.Dispose()};try{if($ready){Invoke-GatePassNonQuery $db "DELETE gp.IdempotencyRequests WHERE OperationCode='EMAIL_REVOKE_PASS' AND ActorBindingHash IN(SELECT HASHBYTES('SHA2_256',CONVERT(binary(16),VisitRequestId)) FROM gp.VisitRequests WHERE PublicReference LIKE @prefix+'-%');" @{prefix=$f.prefix};Invoke-GatePassNonQuery $db (Get-Content (Join-Path $PSScriptRoot '003_transaction_cleanup.sql') -Raw) @{RunId=$run}};if($created){Invoke-GatePassNonQuery $db "DROP USER [$principal];DROP USER [$($principal)_worker];"}}finally{$db.Dispose()}
}
