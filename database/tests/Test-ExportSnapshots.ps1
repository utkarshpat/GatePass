#Requires -Version 7.0
[CmdletBinding()]param([switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskRun=[guid]::NewGuid();$taskPrefix='GP02-'+$taskRun.ToString('N').Substring(0,20).ToUpperInvariant();$taskName='gp_snapshot_test_'+$taskRun.ToString('N')
$taskDb=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;$taskApi=$null;$taskCreated=$false;$taskSnapshots=[Collections.Generic.List[guid]]::new()
function Assert($condition,[string]$message){if(-not $condition){throw $message}}
function Read-Snapshot([hashtable]$patch=@{}){
 $taskP=$taskBase.Clone();foreach($taskKey in $patch.Keys){$taskP[$taskKey]=$patch[$taskKey]}
 $taskArguments=($taskP.Keys|ForEach-Object{'@'+$_+'=@'+$_})-join ','
 return (Invoke-GatePassScalar $taskApi ('EXEC gp.ReadAdminVisitRegister '+$taskArguments) $taskP)|ConvertFrom-Json
}
function Denied([hashtable]$patch,[int]$number){$taskRejected=$false;try{$null=Read-Snapshot $patch}catch{$taskException=$_.Exception.GetBaseException();if($taskException -isnot [Data.SqlClient.SqlException]){throw};$taskRejected=$taskException.Number -eq $number};Assert $taskRejected ('Expected SQL '+$number)}
try{
 $taskFixture=(& (Join-Path $taskRoot 'tools/LoadStressFixture.ps1') -RunId $taskRun -Action Create)|ConvertFrom-Json
 $null=& (Join-Path $taskRoot 'tools/LoadStressFixture.ps1') -RunId $taskRun -Action Refresh
 $taskAuth=(Invoke-GatePassScalar $taskDb "SELECT(SELECT TOP(1) u.UserId actor,CONVERT(varchar(64),s.SessionHash,2) sessionHex,CONVERT(varchar(64),s.CsrfHash,2) csrfHex FROM gp.Sessions s JOIN gp.Users u ON u.UserId=s.UserId WHERE u.IdentitySubject=@subject AND u.IdentityIssuer='gatepass-phase02-fixture' ORDER BY s.CreatedAtUtc DESC FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);" @{subject=$taskPrefix+':ADMIN'})|ConvertFrom-Json
 Invoke-GatePassNonQuery $taskDb "BEGIN TRANSACTION;INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT RoleGrantId,'REPORTS_EXPORT' FROM gp.StaffRoleGrants WHERE UserId=@actor AND RoleCode='LOCATION_ADMIN';CREATE USER [$taskName] WITHOUT LOGIN;ALTER ROLE gp_api_runtime ADD MEMBER [$taskName];COMMIT;" @{actor=[guid]$taskAuth.actor};$taskCreated=$true
 $taskApi=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate;Invoke-GatePassNonQuery $taskApi "EXECUTE AS USER='$taskName';"
 $taskBase=@{SessionHash=[Convert]::FromHexString($taskAuth.sessionHex);CsrfHash=[Convert]::FromHexString($taskAuth.csrfHex);LocationId=1;ProjectLocationId=[long]$taskFixture.state.pair;FromDate=[datetime]$taskFixture.state.today;ToDate=[datetime]$taskFixture.state.today;ForExport=$true;PageSize=200}
 $taskFirst=Read-Snapshot @{CreateExportSnapshot=$true};$taskId=[guid]$taskFirst.exportSnapshotId;$taskSnapshots.Add($taskId)
 Assert ($taskFirst.rows.Count -eq 200 -and $taskFirst.total -gt 1000) 'Snapshot first page invalid'
 $taskNext=Read-Snapshot @{ExportSnapshotId=$taskId;Page=2};$taskLegacy=Read-Snapshot @{Page=2}
 Assert (($taskNext.rows|ConvertTo-Json -Depth 8 -Compress) -eq ($taskLegacy.rows|ConvertTo-Json -Depth 8 -Compress)) 'Snapshot page differs from live stable export'
 Denied @{ExportSnapshotId=$taskId;Sort='personName'} 52003
 Denied @{ExportSnapshotId=$taskId;SessionHash=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32)} 52001
 $taskOtherSession=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
 Invoke-GatePassNonQuery $taskDb 'INSERT gp.Sessions(SessionHash,UserId,CsrfHash,AuthorizationVersionAtIssue,LastSeenAtUtc,IdleExpiresAtUtc,AbsoluteExpiresAtUtc,CreatedAtUtc) SELECT @new,UserId,CsrfHash,AuthorizationVersionAtIssue,LastSeenAtUtc,IdleExpiresAtUtc,AbsoluteExpiresAtUtc,CreatedAtUtc FROM gp.Sessions WHERE SessionHash=@old;' @{new=$taskOtherSession;old=$taskBase.SessionHash}
 Denied @{ExportSnapshotId=$taskId;SessionHash=$taskOtherSession} 52003
 Assert ((Read-Snapshot @{ExportSnapshotId=$taskId;SessionHash=$taskOtherSession;CancelExport=$true}).cancelled -eq $false) 'Other valid session deleted snapshot'
 $taskFinal=Read-Snapshot @{ExportSnapshotId=$taskId;FinishExport=$true}
 Assert ($taskFinal.exportValidated -eq $true -and $taskFinal.datasetVersion -eq $taskFirst.datasetVersion) 'Stable snapshot not finalized'
 Assert ((Invoke-GatePassScalar $taskDb 'SELECT COUNT(*) FROM gp.AdminExportSnapshots WHERE SnapshotId=@id;' @{id=$taskId}) -eq 0) 'Completed snapshot retained'
 $taskChanged=Read-Snapshot @{CreateExportSnapshot=$true};$taskId=[guid]$taskChanged.exportSnapshotId;$taskSnapshots.Add($taskId)
 Invoke-GatePassNonQuery $taskDb 'UPDATE gp.VisitRequests SET Reason=Reason+N'' changed'' WHERE VisitRequestId=@id;' @{id=[guid]$taskChanged.rows[0].visitRequestId}
 Denied @{ExportSnapshotId=$taskId;FinishExport=$true} 52003
 $taskExpired=Read-Snapshot @{CreateExportSnapshot=$true};$taskId=[guid]$taskExpired.exportSnapshotId;$taskSnapshots.Add($taskId)
 Invoke-GatePassNonQuery $taskDb 'UPDATE gp.AdminExportSnapshots SET ExpiresAtUtc=DATEADD(second,-1,SYSUTCDATETIME()) WHERE SnapshotId=@id;' @{id=$taskId};Denied @{ExportSnapshotId=$taskId;Page=2} 52003
 $taskPurged=Read-Snapshot @{CreateExportSnapshot=$true};$taskId=[guid]$taskPurged.exportSnapshotId;$taskSnapshots.Add($taskId)
 Invoke-GatePassNonQuery $taskDb 'UPDATE gp.VisitRequests SET PersonalDataPurgedAtUtc=SYSUTCDATETIME() WHERE VisitRequestId=@id;' @{id=[guid]$taskPurged.rows[0].visitRequestId}
 Assert ((Invoke-GatePassScalar $taskDb 'SELECT COUNT(*) FROM gp.AdminExportSnapshots WHERE SnapshotId=@id;' @{id=$taskId}) -eq 0) 'Purge retained snapshot data'
 Denied @{ExportSnapshotId=$taskId;Page=2} 52003
 $taskEmpty=Read-Snapshot @{CreateExportSnapshot=$true;FiltersJson='{"personName":"NO-SYNTHETIC-MATCH-EMPTY"}'}
 Assert ($taskEmpty.total -eq 0 -and $null -eq $taskEmpty.PSObject.Properties['exportSnapshotId']) 'Empty export allocated a slot'
 $taskActive=[Collections.Generic.List[guid]]::new()
 foreach($taskIndex in 1..4){$taskPacket=Read-Snapshot @{CreateExportSnapshot=$true};$taskNewId=[guid]$taskPacket.exportSnapshotId;$taskActive.Add($taskNewId);$taskSnapshots.Add($taskNewId)}
 Denied @{CreateExportSnapshot=$true} 52003
 foreach($taskNewId in $taskActive){Assert ((Read-Snapshot @{ExportSnapshotId=$taskNewId;CancelExport=$true}).cancelled -eq $true) 'Owner cancellation failed'}
 $taskRevoked=Read-Snapshot @{CreateExportSnapshot=$true};$taskId=[guid]$taskRevoked.exportSnapshotId;$taskSnapshots.Add($taskId)
 Invoke-GatePassNonQuery $taskDb "DELETE c FROM gp.GrantCapabilities c JOIN gp.StaffRoleGrants g ON g.RoleGrantId=c.RoleGrantId WHERE g.UserId=@actor AND c.CapabilityCode='REPORTS_EXPORT';" @{actor=[guid]$taskAuth.actor}
 Denied @{ExportSnapshotId=$taskId;Page=2} 52001
 Assert ((Read-Snapshot @{ExportSnapshotId=$taskId;CancelExport=$true}).cancelled -eq $true) 'Revoked scope prevented owner cleanup'
 Assert ((Invoke-GatePassScalar $taskApi "SELECT HAS_PERMS_BY_NAME('gp.AdminExportSnapshots','OBJECT','SELECT');") -eq 0) 'Snapshot storage exposed to runtime'
 Write-Host 'PASS: snapshot parity, finalization, valid-session ownership, query binding, same-count mutation, expiry, purge, empty/capacity bounds, revocation, cancellation and storage isolation'
}catch{ $taskSqlError=$_.Exception.GetBaseException();if($taskSqlError -is [Data.SqlClient.SqlException]){Write-Host ('SQL '+$taskSqlError.Number+' '+$taskSqlError.Procedure+' line '+$taskSqlError.LineNumber)};throw }finally{
 if($taskApi){$taskApi.Dispose()};foreach($taskId in $taskSnapshots){Invoke-GatePassNonQuery $taskDb 'DELETE gp.AdminExportSnapshots WHERE SnapshotId=@id;' @{id=$taskId}}
 if($taskCreated){Invoke-GatePassNonQuery $taskDb "DROP USER [$taskName];"};$taskDb.Dispose();$null=& (Join-Path $taskRoot 'tools/LoadStressFixture.ps1') -RunId $taskRun -Action Cleanup
}
