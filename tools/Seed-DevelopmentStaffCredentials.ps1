#Requires -Version 7.0
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
if($env:NODE_ENV -notin @('development','test') -or $env:GATEPASS_DIRECTORY_MODE -ne 'mock'){throw 'Explicit mock development mode required.'}
$taskRoot=Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskFixtures=[Console]::In.ReadToEnd()
if($taskFixtures.Length -gt 32768){throw 'Fixture input too large.'}
$taskConnection=Open-GatePassLocalSql -TrustLocalServerCertificate
try{
 $taskResult=Invoke-GatePassScalar $taskConnection ([IO.File]::ReadAllText((Join-Path $taskRoot 'database/development/004_seed_external_staff.sql'))) @{Fixtures=$taskFixtures}
 $taskLeads=([IO.File]::ReadAllText((Join-Path $taskRoot 'database/development/project-lead-fixtures.json'))|ConvertFrom-Json).projectLeads|ConvertTo-Json -Depth 4
 $null=Invoke-GatePassScalar $taskConnection ([IO.File]::ReadAllText((Join-Path $taskRoot 'database/development/005_seed_project_leads.sql'))) @{Fixtures=$taskLeads}
 Invoke-GatePassNonQuery $taskConnection ([IO.File]::ReadAllText((Join-Path $taskRoot 'database/development/006_enable_scoped_delegation.sql')))
 [Console]::Out.Write($taskResult)
}catch{$taskFailure=$_.Exception.GetBaseException();[Console]::Out.Write((@{status='FAIL';number=$taskFailure.Number;line=$taskFailure.LineNumber}|ConvertTo-Json -Compress));exit 1}finally{$taskConnection.Dispose()}
