#Requires -Version 7.0
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
& (Join-Path $PSScriptRoot '../setup/Seed-LocalDirectory.ps1') -TrustLocalServerCertificate
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskConnection=Open-GatePassLocalSql -TrustLocalServerCertificate
$taskRun=[guid]::NewGuid();$taskReport=$null
$taskTemp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath());$taskStore=[IO.Path]::GetFullPath((Join-Path $taskTemp ('gatepass-digital-test-'+$taskRun.ToString('N'))))
try {
 if((Invoke-GatePassScalar $taskConnection "SELECT COUNT(*) FROM gp.TemporaryIdSlots WHERE EmployeeId='EMP014'") -ne 0){throw 'EMP014 has existing Digital IDs; preserve them and choose an unused fixture employee.'}
 $taskProcess=[Diagnostics.Process]::new();$taskProcess.StartInfo=[Diagnostics.ProcessStartInfo]::new('node');$taskProcess.StartInfo.ArgumentList.Add((Join-Path $taskRoot 'tests/employee-digital-id.sql-integration.ts'))
 $taskProcess.StartInfo.WorkingDirectory=$taskRoot;$taskProcess.StartInfo.UseShellExecute=$false;$taskProcess.StartInfo.CreateNoWindow=$true
 $taskProcess.StartInfo.RedirectStandardInput=$true;$taskProcess.StartInfo.RedirectStandardOutput=$true;$taskProcess.StartInfo.RedirectStandardError=$true
 $taskProcess.StartInfo.Environment['NODE_ENV']='test';$taskProcess.StartInfo.Environment['GATEPASS_SSO_MODE']='dummy';$taskProcess.StartInfo.Environment['GATEPASS_DIRECTORY_MODE']='mock'
 $null=$taskProcess.Start();$taskProcess.StandardInput.Write((@{storageRoot=$taskStore}|ConvertTo-Json -Compress));$taskProcess.StandardInput.Close()
 $taskOutput=$taskProcess.StandardOutput.ReadToEndAsync();$taskErrors=$taskProcess.StandardError.ReadToEndAsync()
 if(-not $taskProcess.WaitForExit(180000)){$taskProcess.Kill($true);throw 'Digital ID integration timed out.'}
 $taskRaw=$taskOutput.GetAwaiter().GetResult();$taskStderr=$taskErrors.GetAwaiter().GetResult()
 if(-not $taskRaw){throw ('No integration report: '+$taskStderr)}
 $taskReport=$taskRaw|ConvertFrom-Json
 $taskRaw|Set-Content (Join-Path $taskRoot 'tmp/employee-digital-id-owned-fixtures.json') -Encoding utf8
 if($taskReport.status -ne 'PASS'){throw ('Digital ID integration failed after '+$taskReport.cases+' cases: '+$taskReport.failure)}
 $taskVisit=[guid]$taskReport.visitId
 if((Invoke-GatePassScalar $taskConnection "SELECT COUNT(*) FROM gp.NotificationOutbox WHERE VisitRequestId=@VisitId AND RecipientKind='MANAGER' AND RecipientEmployeeId='EMP014' AND Status='PENDING'" @{VisitId=$taskVisit}) -ne 1){throw 'Expected exactly one pending manager notification.'}
 if((Invoke-GatePassScalar $taskConnection "SELECT COUNT(*) FROM gp.PhotoAssets p JOIN gp.VisitRequests v ON v.PhotoAssetId=p.PhotoAssetId WHERE v.VisitRequestId=@VisitId AND CONVERT(varchar(64),p.ContentHash,2)=@Hash" @{VisitId=$taskVisit;Hash=$taskReport.photoHash}) -ne 1){throw 'Private file content must match SQL metadata.'}
 if((Invoke-GatePassScalar $taskConnection "SELECT COUNT(*) FROM gp.AccessPasses p JOIN gp.PassSecrets s ON s.AccessPassId=p.AccessPassId WHERE p.VisitRequestId=@VisitId AND DATALENGTH(s.Ciphertext)=32 AND s.KeyVersion LIKE 'qr.v1.k_%'" @{VisitId=$taskVisit}) -ne 1){throw 'Expected encrypted opaque QR credential.'}
 $taskReport|Add-Member verifiedSqlArtifacts $true
}finally{
 try{
  if($null -ne $taskReport){
   if($taskReport.intakes.Count){Invoke-GatePassNonQuery $taskConnection (Get-Content (Join-Path $PSScriptRoot '004_registration_cleanup.sql') -Raw) @{IntakesJson=(ConvertTo-Json -InputObject @($taskReport.intakes) -Compress);RunId=$taskRun}}
   foreach($taskKey in $taskReport.clientKeys){Invoke-GatePassNonQuery $taskConnection "DELETE r FROM gp.IdempotencyRequests r JOIN gp.Users u ON r.ActorBindingHash=HASHBYTES('SHA2_256',CONVERT(binary(16),u.UserId)) WHERE u.IdentityIssuer=N'urn:gatepass:development-directory' AND u.IdentitySubject='employee:EMP014' AND r.OperationCode='SUBMIT_REGISTRATION' AND r.ClientKey=@ClientKey" @{ClientKey=[guid]$taskKey}}
   foreach($taskPhoto in $taskReport.photos){Invoke-GatePassNonQuery $taskConnection "DELETE gp.SecurityAuditEvents WHERE TargetType='PHOTO_ASSET' AND TargetReference=@Photo" @{Photo=$taskPhoto}}
   foreach($taskHash in $taskReport.ownedSessionHashes){
    if($taskHash -notmatch '^[A-F0-9]{64}$'){throw 'Invalid owned digest.'}
    Invoke-GatePassNonQuery $taskConnection @'
DELETE gp.SecurityAuditEvents WHERE TargetType='DEVELOPMENT_SESSION' AND TargetReference=@Hex AND ActionCode IN('DEV_SSO_LOGIN','DEV_SSO_LOGOUT');
DELETE s FROM gp.Sessions s JOIN gp.Users u ON u.UserId=s.UserId WHERE s.SessionHash=CONVERT(varbinary(32),@Hex,2) AND u.IdentityIssuer=N'urn:gatepass:development-directory';
'@ @{Hex=$taskHash}
   }
   foreach($taskIntake in $taskReport.intakes){if((Invoke-GatePassScalar $taskConnection 'SELECT COUNT(*) FROM gp.RegistrationIntakes WHERE IntakeId=@Id' @{Id=[guid]$taskIntake.intakeId}) -ne 0){throw 'Owned intake cleanup incomplete.'}}
   foreach($taskKey in $taskReport.clientKeys){if((Invoke-GatePassScalar $taskConnection "SELECT COUNT(*) FROM gp.IdempotencyRequests WHERE OperationCode='SUBMIT_REGISTRATION' AND ClientKey=@Id" @{Id=[guid]$taskKey}) -ne 0){throw 'Owned idempotency cleanup incomplete.'}}
  }
 }finally{
  $taskConnection.Dispose()
  if($taskStore.StartsWith($taskTemp,[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($taskStore) -eq ('gatepass-digital-test-'+$taskRun.ToString('N'))){if(Test-Path -LiteralPath $taskStore){Remove-Item -LiteralPath $taskStore -Recurse -Force}}
 }
}
foreach($taskField in @('intakes','ownedSessionHashes','clientKeys','photos','visitId','photoHash')){$taskReport.PSObject.Properties.Remove($taskField)}
$taskReport|Add-Member cleanedOwnedFixtures $true
$taskReport|ConvertTo-Json -Depth 8|Set-Content (Join-Path $taskRoot 'database/validation/employee-digital-id-integration-report.json') -Encoding utf8
Remove-Item -LiteralPath (Join-Path $taskRoot 'tmp/employee-digital-id-owned-fixtures.json') -Force
Write-Output "PASS: $($taskReport.cases) actual employee Digital ID HTTP/SQL cases; SQL artifacts verified; owned fixtures cleaned."

