#Requires -Version 7.0
[CmdletBinding()]param([switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$c=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;$run=[guid]::NewGuid();$f=$null;$api=$null;$created=$false;$principal='gp_reminder_test_'+$run.ToString('N')
function Assert($value,$message){if(-not $value){throw $message}}
function Expect([scriptblock]$work,[int]$number){try{$null=&$work}catch{if($_.Exception.GetBaseException().Number -eq $number){return};throw};throw "Expected SQL $number"}
try{
 $f=(Invoke-GatePassScalar $c (Get-Content (Join-Path $PSScriptRoot '002_transaction_fixtures.sql') -Raw) @{RunId=$run})|ConvertFrom-Json
 $v=[guid]$f.visits.Where({$_.Label -eq 'PENDING'})[0].VisitId
 $rec=$f.actors.Where({$_.Label -eq 'RECEPTION'})[0]
 Invoke-GatePassNonQuery $c "INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) VALUES(@g,'VISITS_READ');INSERT gp.NotificationOutbox(VisitRequestId,RecipientKind,RecipientEmployeeId,TemplateCode,PayloadJson,DedupeHash) VALUES(@v,'EMPLOYEE',@host,'HOST_APPROVAL_REQUEST',(SELECT @v visitRequestId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),HASHBYTES('SHA2_256',CONVERT(binary(16),@v)));" @{g=[long]$rec.GrantId;v=$v;host=$f.hostEmployeeId}
 Invoke-GatePassNonQuery $c "CREATE USER [$principal] WITHOUT LOGIN;ALTER ROLE gp_api_runtime ADD MEMBER [$principal];";$created=$true
 $api=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $api "EXECUTE AS USER='$principal';"
 Invoke-GatePassNonQuery $c "INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT @g,'REPORTS_READ';" @{g=[long]$f.actors.Where({$_.Label -eq 'ADMIN'})[0].GrantId}
 $sql='EXEC gp.RemindPendingApproval @SessionHash=@s,@CsrfHash=@c,@VisitRequestId=@v,@Workspace=@view,@DutyKind=@kind,@ClientKey=@key,@LocationId=@office,@DutyId=@duty;'
 function Params($label='RECEPTION'){$a=$f.actors.Where({$_.Label -eq $label})[0];return @{s=[Convert]::FromHexString($a.SessionHex);c=[Convert]::FromHexString($a.CsrfHex);v=$v;view='RECEPTION';kind='OFFICE';key=$null;office=[int]$f.locationId;duty=[long]0}}
 $p=Params;$r=(Invoke-GatePassScalar $api $sql $p)|ConvertFrom-Json;Assert ($r.mailStatus -eq 'QUEUED' -and $r.eligible) 'Status unavailable'
 $p.key=[guid]::NewGuid();$first=Invoke-GatePassScalar $api $sql $p;Assert (($first|ConvertFrom-Json).outcome -eq 'ALREADY_QUEUED') 'Queued mail duplicated';Assert ((Invoke-GatePassScalar $api $sql $p) -eq $first) 'Same key changed result'
 Write-Output 'PASS: scoped status, queue dedupe and same-key replay'
 foreach($label in @('WRONGLOCATION','HOST')){$bad=Params $label;Expect {Invoke-GatePassScalar $api $sql $bad} 52001}
 foreach($label in @('BLOCKED','STALE','EXPIRED')){$bad=Params $label;Expect {Invoke-GatePassScalar $api $sql $bad} 52001}
 $guard=Params 'GUARD';$guard.view='GUARD';$guard.kind='PROJECT';$guard.office=[int]$f.locationId;$guard.duty=[long]$f.projectLocationId
 Assert (((Invoke-GatePassScalar $api $sql $guard)|ConvertFrom-Json).eligible) 'Assigned guard denied'
 $bad=Params 'WRONGPROJECT';$bad.view='GUARD';$bad.kind='PROJECT';$bad.office=$guard.office;$bad.duty=$guard.duty;Expect {Invoke-GatePassScalar $api $sql $bad} 52001
 $bad=$guard.Clone();$bad.office=[int]$f.otherLocationId;Expect {Invoke-GatePassScalar $api $sql $bad} 52001
 Write-Output 'PASS: reception office and guard project boundaries'
 $common=[long](Invoke-GatePassScalar $c 'SELECT CommonAreaId FROM gp.CommonAreas WHERE AreaName=@name;' @{name=$f.prefix+' Common A'})
 $commonGuard=$guard.Clone();$commonGuard.kind='COMMON';$commonGuard.duty=$common
 Assert (((Invoke-GatePassScalar $api $sql $commonGuard)|ConvertFrom-Json).eligible) 'Assigned common-area guard denied'
 $commonGuard.key=[guid]::NewGuid();$commonReceipt=Invoke-GatePassScalar $api $sql $commonGuard
 $wrongCommon=$commonGuard.Clone();$wrongCommon.duty=[long](Invoke-GatePassScalar $c 'SELECT CommonAreaId FROM gp.CommonAreas WHERE AreaName=@name;' @{name=$f.prefix+' Common B'});Expect {Invoke-GatePassScalar $api $sql $wrongCommon} 52001
 $admin=Params 'ADMIN';$admin.view='ADMIN';Assert (((Invoke-GatePassScalar $api $sql $admin)|ConvertFrom-Json).eligible) 'Scoped admin denied'
 $admin.office=[int]$f.otherLocationId;Expect {Invoke-GatePassScalar $api $sql $admin} 52001
 Invoke-GatePassNonQuery $c 'UPDATE gp.GuardCommonAreaAssignments SET ValidUntilUtc=SYSUTCDATETIME() WHERE GuardUserId=@g AND CommonAreaId=@area;' @{g=[guid]$f.actors.Where({$_.Label -eq 'GUARD'})[0].UserId;area=$common}
 Expect {Invoke-GatePassScalar $api $sql $commonGuard} 52001
 Write-Output 'PASS: common-area/admin current scope, foreign area denial and replay denial after scope loss'

 Invoke-GatePassNonQuery $c "UPDATE gp.NotificationOutbox SET Status='SENT',SentAtUtc=SYSUTCDATETIME() WHERE VisitRequestId=@v;" @{v=$v}
 $p.key=[guid]::NewGuid();Assert (((Invoke-GatePassScalar $api $sql $p)|ConvertFrom-Json).outcome -eq 'COOLDOWN') 'Cooldown absent'
 Invoke-GatePassNonQuery $c "UPDATE gp.NotificationOutbox SET CreatedAtUtc=DATEADD(minute,-6,SYSUTCDATETIME()) WHERE VisitRequestId=@v;" @{v=$v}
 $p.key=[guid]::NewGuid();$r=(Invoke-GatePassScalar $api $sql $p)|ConvertFrom-Json;Assert ($r.outcome -eq 'QUEUED') 'Sent reminder not queued'
 Assert ((Invoke-GatePassScalar $c "SELECT COUNT(*) FROM gp.NotificationOutbox WHERE VisitRequestId=@v;" @{v=$v}) -eq 2) 'Unexpected duplicate'
 Invoke-GatePassNonQuery $c "UPDATE gp.NotificationOutbox SET Status='DEAD',SentAtUtc=NULL,CreatedAtUtc=DATEADD(minute,-6,SYSUTCDATETIME()) WHERE VisitRequestId=@v;" @{v=$v}
 $p.key=[guid]::NewGuid();Assert (((Invoke-GatePassScalar $api $sql $p)|ConvertFrom-Json).outcome -eq 'QUEUED') 'Failed email not retried'
 Assert ((Invoke-GatePassScalar $c "SELECT COUNT(*) FROM gp.VisitRequests WHERE VisitRequestId=@v AND Status='PENDING';" @{v=$v}) -eq 1) 'Reminder modified approval'
 Assert ((Invoke-GatePassScalar $c "SELECT COUNT(*) FROM gp.NotificationOutbox WHERE VisitRequestId=@v AND (RecipientEmployeeId<>@host OR TemplateCode<>'HOST_APPROVAL_REQUEST');" @{v=$v;host=$f.hostEmployeeId}) -eq 0) 'Original recipient or template changed'
 Write-Output 'PASS: sent reminder, failed retry, cooldown and immutable approval/recipient'
 Invoke-GatePassNonQuery $c "UPDATE gp.AccessPasses SET Status='REVOKED',RevokedAtUtc=SYSUTCDATETIME(),RevocationReason=N'Owned reminder test' WHERE VisitRequestId=@v;" @{v=$v}
 $p.key=[guid]::NewGuid();Expect {Invoke-GatePassScalar $api $sql $p} 52003
 Invoke-GatePassNonQuery $c "UPDATE gp.AccessPasses SET Status='PENDING',RevokedAtUtc=NULL,RevocationReason=NULL WHERE VisitRequestId=@v;" @{v=$v}
 Write-Output 'PASS: revoked pass cannot trigger host reminders'
 Invoke-GatePassNonQuery $c "UPDATE gp.VisitRequests SET ApprovalDeadlineUtc=DATEADD(second,-1,SYSUTCDATETIME()) WHERE VisitRequestId=@v;" @{v=$v}
 $p.key=[guid]::NewGuid();Expect {Invoke-GatePassScalar $api $sql $p} 52003
 Expect {Invoke-GatePassScalar $api 'SELECT COUNT(*) FROM gp.HostReminderOperations;'} 229
 Write-Output 'PASS: expired approval deadline rejected and runtime has no table authority'
}finally{
 if($api){$api.Dispose()}
 try{if($f){# Fixture visits are exact owned IDs; cleanup does not touch application registrations.
 foreach($visit in $f.visits){Invoke-GatePassNonQuery $c 'DELETE gp.HostReminderOperations WHERE VisitRequestId=@v;' @{v=[guid]$visit.VisitId}}
 Invoke-GatePassNonQuery $c (Get-Content (Join-Path $PSScriptRoot '003_transaction_cleanup.sql') -Raw) @{RunId=$run}}
 if($created){Invoke-GatePassNonQuery $c "DROP USER [$principal];"}
 }finally{$c.Dispose()}
}
