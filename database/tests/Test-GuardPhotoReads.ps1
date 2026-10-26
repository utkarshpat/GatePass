#Requires -Version 7.0
[CmdletBinding()]param([switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskRun=[guid]::NewGuid();$taskPrefix='GP02-'+$taskRun.ToString('N').Substring(0,20).ToUpperInvariant();$taskName='gp_photo_test_'+$taskRun.ToString('N')
$taskDb=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;$taskMedia=$null;$taskCreated=$false
function Assert($condition,[string]$message){if(-not $condition){throw $message}}
try{
 $taskFixture=(& (Join-Path $taskRoot 'tools/LoadStressFixture.ps1') -RunId $taskRun -Action Create)|ConvertFrom-Json
 $null=& (Join-Path $taskRoot 'tools/LoadStressFixture.ps1') -RunId $taskRun -Action Refresh
 $taskVisit=[guid](Invoke-GatePassScalar $taskDb 'SELECT TOP(1) VisitRequestId FROM gp.VisitRequests WHERE PublicReference LIKE @prefix+''-Q%'' ORDER BY PublicReference;' @{prefix=$taskPrefix})
 Invoke-GatePassNonQuery $taskDb "UPDATE a SET StorageKey='intakes/'+LOWER(REPLACE(CONVERT(varchar(36),a.IntakeId),'-',''))+'/'+LOWER(REPLACE(CONVERT(varchar(36),a.PhotoAssetId),'-',''))+'.jpg',PurgedAtUtc=NULL FROM gp.PhotoAssets a JOIN gp.VisitRequests v ON v.PhotoAssetId=a.PhotoAssetId WHERE v.VisitRequestId=@visit;CREATE USER [$taskName] WITHOUT LOGIN;ALTER ROLE gp_media_runtime ADD MEMBER [$taskName];" @{visit=$taskVisit};$taskCreated=$true
 $taskMedia=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $taskMedia "EXECUTE AS USER='$taskName';"
 foreach($taskActor in @('GUARD','WRONGPROJECT','WRONGLOCATION','NOCAP','EXPIRED','BLOCKED')){
  $taskAuth=(Invoke-GatePassScalar $taskDb "SELECT(SELECT TOP(1) CONVERT(varchar(64),s.SessionHash,2) sessionHex,CONVERT(varchar(64),s.CsrfHash,2) csrfHex FROM gp.Sessions s JOIN gp.Users u ON u.UserId=s.UserId WHERE u.IdentitySubject=@subject AND u.IdentityIssuer='gatepass-phase02-fixture' ORDER BY s.CreatedAtUtc DESC FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);" @{subject=$taskPrefix+':'+$taskActor})|ConvertFrom-Json
  $taskParameters=@{SessionHash=[Convert]::FromHexString($taskAuth.sessionHex);CsrfHash=[Convert]::FromHexString($taskAuth.csrfHex);LocationId=1;DutyKind='PROJECT';DutyId=[long]$taskFixture.state.pair;VisitRequestId=$taskVisit}
  $taskNumber=0;$taskResult=$null
  try{$taskResult=(Invoke-GatePassScalar $taskMedia 'EXEC gp.ReadGuardPhotoSource @SessionHash,@CsrfHash,@LocationId,@DutyKind,@DutyId,@VisitRequestId;' $taskParameters)|ConvertFrom-Json}catch{$taskException=$_.Exception.GetBaseException();if($taskException -isnot [Data.SqlClient.SqlException]){throw};$taskNumber=$taskException.Number}
  if($taskActor -eq 'GUARD'){
   Assert ($taskNumber -eq 0 -and $taskResult.visitRequestId -eq $taskVisit -and $taskResult.contentHash -match '^[a-f0-9]{64}$') 'Authorized metadata unavailable'
   $taskGood=$taskParameters.Clone()
  }else{Assert ($taskNumber -in @(52001,52801)) ('Denial mismatch '+$taskActor)}
 }
 Invoke-GatePassNonQuery $taskDb 'UPDATE a SET PurgedAtUtc=SYSUTCDATETIME(),StorageKey=NULL FROM gp.PhotoAssets a JOIN gp.VisitRequests v ON v.PhotoAssetId=a.PhotoAssetId WHERE v.VisitRequestId=@visit;' @{visit=$taskVisit}
 $taskDenied=$false;try{$null=Invoke-GatePassScalar $taskMedia 'EXEC gp.ReadGuardPhotoSource @SessionHash,@CsrfHash,@LocationId,@DutyKind,@DutyId,@VisitRequestId;' $taskGood}catch{$taskDenied=$_.Exception.GetBaseException().Number -eq 52801};Assert $taskDenied 'Purged pixels remained authorized'
 Assert ((Invoke-GatePassScalar $taskMedia "SELECT HAS_PERMS_BY_NAME('gp.Users','OBJECT','SELECT');") -eq 0) 'Media identity gained table reads'
 Write-Host 'PASS: scoped media-only photo metadata, wrong scope/capability/actor denials, purge and table isolation'
}finally{
 if($taskMedia){$taskMedia.Dispose()};if($taskCreated){Invoke-GatePassNonQuery $taskDb "DROP USER [$taskName];"};$taskDb.Dispose()
 $null=& (Join-Path $taskRoot 'tools/LoadStressFixture.ps1') -RunId $taskRun -Action Cleanup
}
