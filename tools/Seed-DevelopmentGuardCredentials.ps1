#Requires -Version 7.0
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
if($env:NODE_ENV -notin @('development','test') -or $env:GATEPASS_DIRECTORY_MODE -ne 'mock'){throw 'Explicit mock development mode required.'}
$taskRoot=Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskFixtures=[Console]::In.ReadToEnd()
if($taskFixtures.Length -gt 32768){throw 'Fixture input too large.'}
$taskConnection=Open-GatePassLocalSql -TrustLocalServerCertificate
try{[Console]::Out.Write((Invoke-GatePassScalar $taskConnection ([IO.File]::ReadAllText((Join-Path $taskRoot 'database/development/003_seed_guard_credentials.sql'))) @{Fixtures=$taskFixtures}))}catch{$taskFailure=$_.Exception.GetBaseException();[Console]::Out.Write((@{status='FAIL';number=$taskFailure.Number;line=$taskFailure.LineNumber}|ConvertTo-Json -Compress));exit 1}finally{$taskConnection.Dispose()}
