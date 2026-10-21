#Requires -Version 7.0
[CmdletBinding()]
param([string]$Server='localhost\SQLEXPRESS',[switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($env:NODE_ENV -eq 'production') { throw 'Development fixtures cannot run in production mode.' }
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskOldEnvironment=$env:NODE_ENV
$taskOldMode=$env:GATEPASS_DIRECTORY_MODE
try {
    $env:NODE_ENV='development'
    $env:GATEPASS_DIRECTORY_MODE='mock'
    $taskDirectory=& node (Join-Path $taskRoot 'tools/preview-directory.ts')
    if ($LASTEXITCODE -ne 0) { throw 'Directory contract validation failed; no SQL seed was applied.' }
}
finally {
    [Environment]::SetEnvironmentVariable('NODE_ENV',$taskOldEnvironment,'Process')
    [Environment]::SetEnvironmentVariable('GATEPASS_DIRECTORY_MODE',$taskOldMode,'Process')
}
$taskDirectoryText=($taskDirectory -join '')
$taskNormalized=$taskDirectoryText | ConvertFrom-Json
$taskStaff=[IO.File]::ReadAllText((Join-Path $taskRoot 'database/development/staff-fixtures.json'))
$taskConnection=Open-GatePassLocalSql -Server $Server -TrustLocalServerCertificate:$TrustLocalServerCertificate
try {
    $taskSessionsBefore=Invoke-GatePassScalar $taskConnection "SELECT COUNT(*) FROM gp.Sessions s JOIN gp.Users u ON u.UserId=s.UserId WHERE u.IdentityIssuer=N'urn:gatepass:development-directory';"
    $taskSeedFile=Join-Path $taskRoot 'database/development/001_seed_dummy_directory.sql'
    $taskResult=Invoke-GatePassScalar $taskConnection ([IO.File]::ReadAllText($taskSeedFile)) @{Directory=$taskDirectoryText;Staff=$taskStaff}
    Invoke-GatePassNonQuery $taskConnection ([IO.File]::ReadAllText((Join-Path $taskRoot 'database/development/002_seed_reception.sql')))
    $taskSummary=$taskResult | ConvertFrom-Json
    if ($taskSummary.employees -ne $taskNormalized.employees.Count -or $taskSummary.sessions -ne $taskSessionsBefore) {
        throw 'Unexpected seed summary; inspect the local fixture evidence.'
    }
    [ordered]@{Status='PASS';DevelopmentOnly=$true;CheckedAtUtc=[datetime]::UtcNow.ToString('o');Database='GatePass_DesignTest';
        Source='Explicit MockDirectorySource through DirectoryGateway';NodeVersion=(& node --version);
        DirectorySha256=(Get-FileHash -LiteralPath (Join-Path $taskRoot 'database/development/directory-fixtures.json') -Algorithm SHA256).Hash;
        StaffSha256=(Get-FileHash -LiteralPath (Join-Path $taskRoot 'database/development/staff-fixtures.json') -Algorithm SHA256).Hash;
        SeedSha256=(Get-FileHash -LiteralPath $taskSeedFile -Algorithm SHA256).Hash;Result=$taskSummary} |
        ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $taskRoot 'database/validation/development-directory-report.json') -Encoding utf8
    Write-Output ("Dummy directory ready: $($taskSummary.employees) employees, $($taskSummary.managers) mapped managers, $($taskSummary.guards) guards, $($taskSummary.projects) projects, $($taskSummary.guard_assignments) allocations. No login/session/password created.")
}
finally { $taskConnection.Dispose() }
