#Requires -Version 7.0
param([switch]$TrustLocalServerCertificate)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot '../../tools/GatePass.LocalSql.psm1') -Force
$taskConnection = Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate
$taskProbe = Get-Content (Join-Path $PSScriptRoot '../../src/transport/runtime-identity.sql') -Raw
$taskUser = 'gp_transport_' + [guid]::NewGuid().ToString('N')
$taskCases = [Collections.Generic.List[object]]::new()
try {
    Invoke-GatePassNonQuery $taskConnection 'BEGIN TRANSACTION;'
    Invoke-GatePassNonQuery $taskConnection "CREATE USER [$taskUser] WITHOUT LOGIN;"
    function Test-Probe([string]$name, [string]$expectedRole, [int]$expected) {
        Invoke-GatePassNonQuery $taskConnection "EXECUTE AS USER = '$taskUser';"
        try { $actual = Invoke-GatePassScalar $taskConnection $taskProbe @{ ExpectedRole = $expectedRole } }
        finally { Invoke-GatePassNonQuery $taskConnection 'REVERT;' }
        if ($actual -ne $expected) { throw "$name failed: expected $expected, got $actual" }
        $taskCases.Add(@{ name = $name; passed = $true })
    }
    Test-Probe 'Unassigned identity rejected' 'gp_api_runtime' 0
    Invoke-GatePassNonQuery $taskConnection "ALTER ROLE gp_api_runtime ADD MEMBER [$taskUser];"
    Test-Probe 'API identity admitted' 'gp_api_runtime' 1
    Test-Probe 'API cannot claim auth identity' 'gp_guard_auth_runtime' 0
    Invoke-GatePassNonQuery $taskConnection "ALTER ROLE gp_guard_auth_runtime ADD MEMBER [$taskUser];"
    Test-Probe 'Combined identities rejected' 'gp_api_runtime' 0
    Invoke-GatePassNonQuery $taskConnection "ALTER ROLE gp_api_runtime DROP MEMBER [$taskUser];"
    Test-Probe 'Auth identity admitted' 'gp_guard_auth_runtime' 1
    Invoke-GatePassNonQuery $taskConnection "ALTER ROLE db_owner ADD MEMBER [$taskUser];"
    Test-Probe 'Elevated identity rejected' 'gp_guard_auth_runtime' 0
    Invoke-GatePassNonQuery $taskConnection 'ROLLBACK;'
    if ((Invoke-GatePassScalar $taskConnection 'SELECT COUNT(*) FROM sys.database_principals WHERE name=@Name' @{Name=$taskUser}) -ne 0) { throw 'Fixture cleanup failed.' }
    $taskReport = @{ status='PASS'; cases=$taskCases.Count; checks=$taskCases; probeSha256=(Get-FileHash (Join-Path $PSScriptRoot '../../src/transport/runtime-identity.sql') -Algorithm SHA256).Hash.ToLowerInvariant(); driverConnectionTested=$false; note='Admission SQL tested through local integrated .NET connection and disposable database users. Production TDS driver connection not configured.' }
    $taskReport | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $PSScriptRoot '../validation/transport-identity-report.json') -Encoding utf8
    Write-Output "PASS: $($taskCases.Count) identity admission cases; fixture rolled back."
} finally {
    try { Invoke-GatePassNonQuery $taskConnection 'IF @@TRANCOUNT>0 ROLLBACK;' } finally { $taskConnection.Dispose() }
}
