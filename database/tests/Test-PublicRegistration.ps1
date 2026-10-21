#Requires -Version 7.0
[CmdletBinding()]param([switch]$UiReview)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
& (Join-Path $PSScriptRoot '../setup/Seed-LocalDirectory.ps1') -TrustLocalServerCertificate
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskConnection=Open-GatePassLocalSql -TrustLocalServerCertificate
$taskRun=[guid]::NewGuid();$taskReport=$null
$taskTemp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath());$taskStore=[IO.Path]::GetFullPath((Join-Path $taskTemp ('gatepass-public-test-'+$taskRun.ToString('N'))))
try {
 if((Invoke-GatePassScalar $taskConnection "SELECT COUNT(*) FROM gp.TemporaryIdSlots WHERE EmployeeId='EMP014'") -ne 0){throw 'EMP014 has existing Digital IDs; preserve them and choose an unused fixture employee.'}
 if($UiReview){foreach($taskReviewFile in @('tmp/guard-ui-review-ready.json','tmp/guard-ui-review-ready.json.done')){ $taskReviewPath=Join-Path $taskRoot $taskReviewFile;if(Test-Path -LiteralPath $taskReviewPath){Remove-Item -LiteralPath $taskReviewPath -Force}}}
 $taskProcess=[Diagnostics.Process]::new();$taskProcess.StartInfo=[Diagnostics.ProcessStartInfo]::new('node');$taskProcess.StartInfo.ArgumentList.Add((Join-Path $taskRoot 'tests/public-registration.sql-integration.ts'))
 $taskProcess.StartInfo.WorkingDirectory=$taskRoot;$taskProcess.StartInfo.UseShellExecute=$false;$taskProcess.StartInfo.CreateNoWindow=$true
 $taskProcess.StartInfo.RedirectStandardInput=$true;$taskProcess.StartInfo.RedirectStandardOutput=$true;$taskProcess.StartInfo.RedirectStandardError=$true
 $taskProcess.StartInfo.Environment['NODE_ENV']='test';$taskProcess.StartInfo.Environment['GATEPASS_SSO_MODE']='dummy';$taskProcess.StartInfo.Environment['GATEPASS_DIRECTORY_MODE']='mock'
 $null=$taskProcess.Start();$taskProcess.StandardInput.Write((@{storageRoot=$taskStore;uiReviewReady=$(if($UiReview){Join-Path $taskRoot 'tmp/guard-ui-review-ready.json'}else{$null})}|ConvertTo-Json -Compress));$taskProcess.StandardInput.Close()
 $taskOutput=$taskProcess.StandardOutput.ReadToEndAsync();$taskErrors=$taskProcess.StandardError.ReadToEndAsync()
 if(-not $taskProcess.WaitForExit($(if($UiReview){1500000}else{420000}))){$taskProcess.Kill($true);throw 'Public registration integration timed out.'}
 $taskRaw=$taskOutput.GetAwaiter().GetResult();$taskStderr=$taskErrors.GetAwaiter().GetResult()
 if(-not $taskRaw){throw ('No integration report: '+$taskStderr)}
 $taskReport=$taskRaw|ConvertFrom-Json
 $taskRaw|Set-Content (Join-Path $taskRoot 'tmp/public-registration-owned-fixtures.json') -Encoding utf8
 if($taskReport.status -ne 'PASS'){throw ('Public registration integration failed after '+$taskReport.cases+' cases: '+$taskReport.failure)}
 $taskVisitJson=ConvertTo-Json -InputObject @($taskReport.visits) -Compress
 if($taskReport.visits.Count -ne 4){throw 'Expected two visitor, one Digital ID and one extra project visit.'}
 if((Invoke-GatePassScalar $taskConnection "SELECT COUNT(*) FROM gp.VisitRequests v JOIN OPENJSON(@VisitJson) j ON v.VisitRequestId=TRY_CONVERT(uniqueidentifier,j.value)" @{VisitJson=$taskVisitJson}) -ne 4){throw 'Expected exactly four owned visit records.'}
 if((Invoke-GatePassScalar $taskConnection "SELECT COUNT(*) FROM gp.NotificationOutbox n JOIN OPENJSON(@VisitJson) j ON n.VisitRequestId=TRY_CONVERT(uniqueidentifier,j.value) WHERE n.TemplateCode IN('HOST_APPROVAL_REQUEST','TEMP_ID_MANAGER_NOTICE') AND n.Status='PENDING'" @{VisitJson=$taskVisitJson}) -ne 4){throw 'Expected one notification per independent visit.'}
 if((Invoke-GatePassScalar $taskConnection "SELECT COUNT(*) FROM gp.VisitRequests v JOIN OPENJSON(@VisitJson) j ON v.VisitRequestId=TRY_CONVERT(uniqueidentifier,j.value) WHERE v.Status='PENDING'" @{VisitJson=$taskVisitJson}) -ne 1){throw 'Only the independent additional project request should remain pending after email decisions.'}
 if($taskReport.cardCredentialHash -notmatch '^[A-F0-9]{64}$'){throw 'Missing decoded card QR digest.'}
 if((Invoke-GatePassScalar $taskConnection "SELECT COUNT(*) FROM gp.AccessPasses p JOIN gp.VisitRequests v ON v.VisitRequestId=p.VisitRequestId WHERE v.EmployeeId='EMP014' AND v.RequestType='TEMP_ID' AND p.IsCurrent=1 AND p.CredentialHash=CONVERT(varbinary(32),@Hash,2)" @{Hash=$taskReport.cardCredentialHash}) -ne 1){throw 'Downloaded QR does not match issued SQL credential.'}
 if((Invoke-GatePassScalar $taskConnection "SELECT COUNT(*) FROM gp.NotificationOutbox n JOIN OPENJSON(@VisitJson) j ON n.VisitRequestId=TRY_CONVERT(uniqueidentifier,j.value) WHERE n.TemplateCode='REQUEST_RECEIVED'" @{VisitJson=$taskVisitJson}) -ne 4){throw 'Expected exactly one receipt per individual visit, including retries.'}
 if((Invoke-GatePassScalar $taskConnection "SELECT COUNT(*) FROM gp.NotificationOutbox n JOIN OPENJSON(@VisitJson) j ON n.VisitRequestId=TRY_CONVERT(uniqueidentifier,j.value) WHERE n.TemplateCode='VISIT_DECIDED'" @{VisitJson=$taskVisitJson}) -ne 2){throw 'Expected independent approval/rejection result emails.'}
 $taskProbe='gp_card_probe_'+[guid]::NewGuid().ToString('N');$taskProbeCreated=$false;$taskProbeActing=$false
 try{
  Invoke-GatePassNonQuery $taskConnection "CREATE USER [$taskProbe] WITHOUT LOGIN;";$taskProbeCreated=$true
  Invoke-GatePassNonQuery $taskConnection "ALTER ROLE gp_api_runtime ADD MEMBER [$taskProbe]; EXECUTE AS USER='$taskProbe';";$taskProbeActing=$true
  if((Invoke-GatePassScalar $taskConnection "SELECT HAS_PERMS_BY_NAME('gp.GetOwnDigitalIdCard','OBJECT','EXECUTE');") -ne 0){throw 'API role unexpectedly has card-source permission.'}
 }finally{
  if($taskProbeActing){Invoke-GatePassNonQuery $taskConnection 'REVERT;'}
  if($taskProbeCreated){Invoke-GatePassNonQuery $taskConnection "DROP USER [$taskProbe];"}
 }
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
DELETE s FROM gp.Sessions s JOIN gp.Users u ON u.UserId=s.UserId WHERE s.SessionHash=CONVERT(varbinary(32),@Hex,2) AND u.IdentityIssuer IN(N'urn:gatepass:development-directory',N'urn:gatepass:development-staff');
'@ @{Hex=$taskHash}
   }
   foreach($taskIntake in $taskReport.intakes){if((Invoke-GatePassScalar $taskConnection 'SELECT COUNT(*) FROM gp.RegistrationIntakes WHERE IntakeId=@Id' @{Id=[guid]$taskIntake.intakeId}) -ne 0){throw 'Owned intake cleanup incomplete.'}}
   foreach($taskKey in $taskReport.clientKeys){if((Invoke-GatePassScalar $taskConnection "SELECT COUNT(*) FROM gp.IdempotencyRequests WHERE OperationCode='SUBMIT_REGISTRATION' AND ClientKey=@Id" @{Id=[guid]$taskKey}) -ne 0){throw 'Owned idempotency cleanup incomplete.'}}
  }
 }finally{
  $taskConnection.Dispose()
  if($UiReview){foreach($taskReviewFile in @('tmp/guard-ui-review-ready.json','tmp/guard-ui-review-ready.json.done')){$taskReviewPath=Join-Path $taskRoot $taskReviewFile;if(Test-Path -LiteralPath $taskReviewPath){Remove-Item -LiteralPath $taskReviewPath -Force}}}
  if($taskStore.StartsWith($taskTemp,[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($taskStore) -eq ('gatepass-public-test-'+$taskRun.ToString('N'))){if(Test-Path -LiteralPath $taskStore){Remove-Item -LiteralPath $taskStore -Recurse -Force}}
 }
}
foreach($taskField in @('intakes','ownedSessionHashes','clientKeys','photos','visits')){$taskReport.PSObject.Properties.Remove($taskField)}
$taskReport|Add-Member cleanedOwnedFixtures $true
$taskReport|ConvertTo-Json -Depth 8|Set-Content (Join-Path $taskRoot 'database/validation/public-registration-integration-report.json') -Encoding utf8
Remove-Item -LiteralPath (Join-Path $taskRoot 'tmp/public-registration-owned-fixtures.json') -Force
Write-Output "PASS: $($taskReport.cases) actual public/employee registration HTTP/SQL cases; SQL artifacts verified; owned fixtures cleaned."

