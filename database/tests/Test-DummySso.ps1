#Requires -Version 7.0
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
if($env:NODE_ENV -eq 'production'){throw 'Development test cannot run in production mode.'}
& (Join-Path $PSScriptRoot '../setup/Seed-LocalDirectory.ps1') -TrustLocalServerCertificate
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskConnection=Open-GatePassLocalSql -TrustLocalServerCertificate
$taskReport=$null;$taskCreated=$false;$taskRun=[guid]::NewGuid()
try {
 if((Invoke-GatePassScalar $taskConnection "SELECT COUNT(*) FROM sys.database_principals WHERE name='gp_registration_api_fixture'") -ne 0){throw 'Registration fixture principal already exists; do not overlap suites.'}
 Invoke-GatePassNonQuery $taskConnection 'CREATE USER gp_registration_api_fixture WITHOUT LOGIN; ALTER ROLE gp_api_runtime ADD MEMBER gp_registration_api_fixture;';$taskCreated=$true
 $taskProcess=[Diagnostics.Process]::new();$taskProcess.StartInfo=[Diagnostics.ProcessStartInfo]::new('node');$taskProcess.StartInfo.ArgumentList.Add((Join-Path $taskRoot 'tests/dummy-sso.sql-integration.ts'))
 $taskProcess.StartInfo.WorkingDirectory=$taskRoot;$taskProcess.StartInfo.UseShellExecute=$false;$taskProcess.StartInfo.CreateNoWindow=$true
 $taskProcess.StartInfo.RedirectStandardInput=$true;$taskProcess.StartInfo.RedirectStandardOutput=$true;$taskProcess.StartInfo.RedirectStandardError=$true
 $taskProcess.StartInfo.Environment['NODE_ENV']='test';$taskProcess.StartInfo.Environment['GATEPASS_SSO_MODE']='dummy';$taskProcess.StartInfo.Environment['GATEPASS_DIRECTORY_MODE']='mock'
 $null=$taskProcess.Start();$taskProcess.StandardInput.Write('{"port":18443}');$taskProcess.StandardInput.Close()
 $taskOutput=$taskProcess.StandardOutput.ReadToEndAsync();$taskErrors=$taskProcess.StandardError.ReadToEndAsync()
 if(-not $taskProcess.WaitForExit(90000)){$taskProcess.Kill($true);throw 'Dummy SSO integration timed out.'}
 $taskRaw=$taskOutput.GetAwaiter().GetResult();$null=$taskErrors.GetAwaiter().GetResult();$taskReport=$taskRaw|ConvertFrom-Json
 if($taskReport.status -ne 'PASS'){throw ('Dummy SSO integration failed: '+$taskReport.failure)}
} finally {
 try {
  if($null -ne $taskReport){
   if($taskReport.intakes.Count){Invoke-GatePassNonQuery $taskConnection (Get-Content (Join-Path $PSScriptRoot '004_registration_cleanup.sql') -Raw) @{IntakesJson=(ConvertTo-Json -InputObject @($taskReport.intakes) -Compress);RunId=$taskRun}}
   foreach($taskHash in $taskReport.ownedSessionHashes){
    if($taskHash -notmatch '^[A-F0-9]{64}$'){throw 'Invalid owned session digest.'}
    Invoke-GatePassNonQuery $taskConnection @'
DELETE a FROM gp.SecurityAuditEvents a WHERE a.TargetType='DEVELOPMENT_SESSION' AND a.TargetReference=@Hex AND a.ActionCode IN('DEV_SSO_LOGIN','DEV_SSO_LOGOUT');
DELETE s FROM gp.Sessions s JOIN gp.Users u ON u.UserId=s.UserId WHERE s.SessionHash=CONVERT(varbinary(32),@Hex,2) AND u.IdentityIssuer=N'urn:gatepass:development-directory';
'@ @{Hex=$taskHash}
   }
  }
  if($taskCreated){Invoke-GatePassNonQuery $taskConnection 'DROP USER gp_registration_api_fixture;'}
 }finally{$taskConnection.Dispose()}
}
if($null -ne $taskReport -and $taskReport.status -eq 'PASS'){
 $taskReport.PSObject.Properties.Remove('ownedSessionHashes');$taskReport.PSObject.Properties.Remove('intakes');$taskReport|Add-Member cleanedOwnedFixtures $true
 $taskReport|ConvertTo-Json -Depth 8|Set-Content (Join-Path $taskRoot 'database/validation/dummy-sso-integration-report.json') -Encoding utf8
 Write-Output "PASS: $($taskReport.cases) actual HTTP/SQL dummy SSO cases; owned sessions/intake/principal cleaned."
}
