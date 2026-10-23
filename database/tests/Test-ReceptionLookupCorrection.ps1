#Requires -Version 7.0
[CmdletBinding()]param([switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
Import-Module (Join-Path (Split-Path -Parent $PSScriptRoot) '../tools/GatePass.LocalSql.psm1') -Force
$db=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;$api=$null;$f=$null;$run=[guid]::NewGuid();$principal='gp_lookup_test_'+$run.ToString('N');$created=$false
function Assert($v,$message){if(-not $v){throw $message}}
function Expect([scriptblock]$work,[int]$number){try{$null=&$work}catch{if($_.Exception.GetBaseException().Number -eq $number){return};throw};throw "Expected SQL $number"}
function Actor($label='RECEPTION'){$a=$f.actors.Where({$_.Label -eq $label})[0];return @{SessionHash=[Convert]::FromHexString($a.SessionHex);CsrfHash=[Convert]::FromHexString($a.CsrfHex)}}
function Visit($label){return $f.visits.Where({$_.Label -eq $label})[0]}
function Call($name,$p){$argsSql=($p.Keys|ForEach-Object{'@'+$_+'=@'+$_}) -join ',';return (Invoke-GatePassScalar $api ('EXEC gp.'+$name+' '+$argsSql) $p)|ConvertFrom-Json}
function ReturnParams($label){$p=Actor;$v=Visit $label;$p.VisitRequestId=[guid]$v.VisitId;$p.ExpectedPassId=[guid]$v.PassId;$p.ClientKey=[guid]::NewGuid();return $p}
function Printed($label){$p=ReturnParams $label;$null=Call 'RequestPassPrint' $p;Invoke-GatePassNonQuery $db "UPDATE gp.PassPrintJobs SET Status='DISPATCHED',UpdatedAtUtc=SYSUTCDATETIME() WHERE VisitRequestId=@v;" @{v=$p.VisitRequestId}}
function Correction($label,$time){$p=ReturnParams $label;$p.ExpectedReturnedAtUtc=[datetime]$time;$p.Reason='Mistaken click; printed badge still held by visitor';return $p}
try{
 $f=(Invoke-GatePassScalar $db (Get-Content (Join-Path $PSScriptRoot '002_transaction_fixtures.sql') -Raw) @{RunId=$run})|ConvertFrom-Json
 $rec=$f.actors.Where({$_.Label -eq 'RECEPTION'})[0];Invoke-GatePassNonQuery $db "INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) VALUES(@g,'VISITS_READ'),(@g,'PASS_PRINT');CREATE USER [$principal] WITHOUT LOGIN;ALTER ROLE gp_api_runtime ADD MEMBER [$principal];" @{g=[long]$rec.GrantId};$created=$true
 $api=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $api "EXECUTE AS USER='$principal';"
 $p=Actor;$p.LocationId=[int]$f.locationId;$p.Search=$f.prefix;$first=Call 'LookupReceptionVisits' $p;Assert ($first.matches.Count -eq 20 -and $first.hasMore) 'Lookup must page all dates'
 $p.AfterSubmittedAtUtc=[datetime]$first.afterSubmittedAtUtc;$p.AfterVisitRequestId=[guid]$first.afterVisitRequestId;$second=Call 'LookupReceptionVisits' $p;Assert ($second.matches.Count -eq 5 -and -not $second.hasMore) 'Lookup lost older visits'
 Assert (@($first.matches.visitRequestId|Where-Object{$_ -in $second.matches.visitRequestId}).Count -eq 0) 'Lookup pages duplicated records'
 $v=Visit 'MOVEMENT';$p=Actor;$p.LocationId=[int]$f.locationId;$p.CredentialHash=[Convert]::FromHexString($v.CredentialHex);Assert ((Call 'LookupReceptionVisits' $p).matches.Count -eq 1) 'QR lookup failed'
 Printed 'MOVEMENT';$return=ReturnParams 'MOVEMENT';$receipt=Call 'ReturnReceptionPass' $return;Assert ((Call 'LookupReceptionVisits' $p).matches.Count -eq 1) 'Returned QR should still open read-only record'
 $wrong=Actor 'WRONGLOCATION';$wrong.LocationId=[int]$f.locationId;$wrong.Search=$f.prefix;Expect {Call 'LookupReceptionVisits' $wrong} 53501
 $p.CredentialHash=[byte[]]::new(31);Expect {Call 'LookupReceptionVisits' $p} 53502
 Write-Output 'PASS: scoped all-date search, 20-row pagination, current/returned QR lookup and malformed scan rejection'
 $correct=Correction 'MOVEMENT' $receipt.returnedAtUtc
 foreach($label in @('GUARD','HOST','WRONGLOCATION')){$wrong=Correction 'MOVEMENT' $receipt.returnedAtUtc;$actor=Actor $label;$wrong.SessionHash=$actor.SessionHash;$wrong.CsrfHash=$actor.CsrfHash;Expect {Call 'CorrectReceptionReturn' $wrong} 53501}
 $wrong=Correction 'MOVEMENT' $receipt.returnedAtUtc;$wrong.ExpectedPassId=[guid]::NewGuid();Expect {Call 'CorrectReceptionReturn' $wrong} 54503
 $wrong=Correction 'MOVEMENT' $receipt.returnedAtUtc;$wrong.Reason='';Expect {Call 'CorrectReceptionReturn' $wrong} 54502
 $sibling=Visit 'DUPENTRY';Invoke-GatePassNonQuery $db 'UPDATE gp.VisitRequests SET SubmittedAtUtc=SYSUTCDATETIME() WHERE VisitRequestId=@v;' @{v=[guid]$sibling.VisitId};Expect {Call 'CorrectReceptionReturn' $correct} 54503
 Invoke-GatePassNonQuery $db 'UPDATE gp.VisitRequests SET SubmittedAtUtc=DATEADD(day,-2,SYSUTCDATETIME()) WHERE VisitRequestId=@v;' @{v=[guid]$sibling.VisitId}
 $restored=Call 'CorrectReceptionReturn' $correct;$again=Call 'CorrectReceptionReturn' $correct;Assert ($restored.correctedAtUtc -eq $again.correctedAtUtc) 'Correction replay changed receipt'
 Assert ((Invoke-GatePassScalar $db 'SELECT COUNT(*) FROM gp.PassReturns WHERE VisitRequestId=@v;' @{v=$correct.VisitRequestId}) -eq 0) 'Return not cleared'
 Assert ((Invoke-GatePassScalar $db "SELECT Status FROM gp.AccessPasses WHERE AccessPassId=@v;" @{v=$correct.ExpectedPassId}) -eq 'ACTIVE') 'Approved pass not restored'
 Assert ((Invoke-GatePassScalar $db 'SELECT COUNT(*) FROM gp.PassReturnCorrections WHERE VisitRequestId=@v;' @{v=$correct.VisitRequestId}) -eq 1) 'Original return/correction audit missing or duplicated'
 Expect {Call 'ReturnReceptionPass' $return} 54503
 $newReturn=Call 'ReturnReceptionPass' (ReturnParams 'MOVEMENT');$stale=Correction 'MOVEMENT' $receipt.returnedAtUtc;Expect {Call 'CorrectReceptionReturn' $stale} 54503
 Write-Output 'PASS: scoped correction, replacement and stale-pass fences, restored pass, retained audit, idempotency and corrected-return replay rejection'
 Printed 'PENDING';Invoke-GatePassNonQuery $db "INSERT gp.NotificationOutbox(VisitRequestId,RecipientKind,RecipientEmployeeId,TemplateCode,PayloadJson,DedupeHash) VALUES(@v,'EMPLOYEE',@employee,'HOST_APPROVAL_REQUEST',N'{}',CRYPT_GEN_RANDOM(32));" @{v=[guid](Visit 'PENDING').VisitId;employee=$f.hostEmployeeId};$pending=Call 'ReturnReceptionPass' (ReturnParams 'PENDING');$null=Call 'CorrectReceptionReturn' (Correction 'PENDING' $pending.returnedAtUtc);Assert ((Invoke-GatePassScalar $db "SELECT Status FROM gp.AccessPasses WHERE AccessPassId=@v;" @{v=[guid](Visit 'PENDING').PassId}) -eq 'PENDING') 'Correction approved a pending pass';Assert ((Invoke-GatePassScalar $db "SELECT COUNT(*) FROM gp.NotificationOutbox WHERE VisitRequestId=@v AND TemplateCode='HOST_APPROVAL_REQUEST' AND Status='PENDING';" @{v=[guid](Visit 'PENDING').VisitId}) -eq 1) 'Fresh host approval notification not queued after correction'
 Expect {Invoke-GatePassScalar $api 'SELECT COUNT(*) FROM gp.PassReturnCorrections;'} 229
 Write-Output 'PASS: pending approval stays pending; correction does not grant runtime table access'
}finally{
 if($api){$api.Dispose()};try{if($f){Invoke-GatePassNonQuery $db 'DELETE c FROM gp.PassReturnCorrections c JOIN gp.VisitRequests v ON v.VisitRequestId=c.VisitRequestId WHERE v.PublicReference LIKE @prefix+''-%'';DELETE r FROM gp.PassReturns r JOIN gp.VisitRequests v ON v.VisitRequestId=r.VisitRequestId WHERE v.PublicReference LIKE @prefix+''-%'';' @{prefix=$f.prefix};Invoke-GatePassNonQuery $db (Get-Content (Join-Path $PSScriptRoot '003_transaction_cleanup.sql') -Raw) @{RunId=$run}};if($created){Invoke-GatePassNonQuery $db "DROP USER [$principal];"}}finally{$db.Dispose()}
}
