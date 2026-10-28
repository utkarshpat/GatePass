#Requires -Version 7.0
param([switch]$TrustLocalServerCertificate)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot '../../tools/GatePass.LocalSql.psm1') -Force
$taskConnection = Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate
$taskProbe = Get-Content (Join-Path $PSScriptRoot '../../src/transport/runtime-identity.sql') -Raw
Push-Location -LiteralPath (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
try { $taskAllowedJson = & node --input-type=module -e "import{runtimeAdmissionProcedures,runtimeRoleNames}from'./src/transport/SqlProcedureClient.ts';console.log(JSON.stringify(Object.fromEntries(Object.entries(runtimeRoleNames).map(([k,v])=>[v,runtimeAdmissionProcedures(k)]))));" } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw 'Unable to read reviewed runtime procedure allowlists.' }
$taskAllowed = $taskAllowedJson | ConvertFrom-Json -AsHashtable
$taskUser = 'gp_transport_' + [guid]::NewGuid().ToString('N')
$taskCases = [Collections.Generic.List[object]]::new()
$taskTable = $taskUser + '_data'
$taskProcedure = $taskUser + '_helper'
try {
    Invoke-GatePassNonQuery $taskConnection 'BEGIN TRANSACTION;'
    Invoke-GatePassNonQuery $taskConnection "CREATE USER [$taskUser] WITHOUT LOGIN;"
    function Test-Probe([string]$name, [string]$expectedRole, [int]$expected) {
        Invoke-GatePassNonQuery $taskConnection "EXECUTE AS USER = '$taskUser';"
        try { $actual = Invoke-GatePassScalar $taskConnection $taskProbe @{ ExpectedRole = $expectedRole; AllowedProceduresJson = (ConvertTo-Json -InputObject @($taskAllowed[$expectedRole]) -Compress) } }
        finally { Invoke-GatePassNonQuery $taskConnection 'REVERT;' }
        if ($actual -ne $expected) { throw "$name failed: expected $expected, got $actual" }
        $taskCases.Add(@{ name = $name; passed = $true })
    }
    Test-Probe 'Unassigned identity rejected' 'gp_api_runtime' 0
    Invoke-GatePassNonQuery $taskConnection "ALTER ROLE gp_api_runtime ADD MEMBER [$taskUser];"
    Test-Probe 'API identity admitted' 'gp_api_runtime' 1
    # Disposable objects and grants are rolled back; no runtime account is modified.
    Invoke-GatePassNonQuery $taskConnection "CREATE TABLE dbo.[$taskTable](Id int NOT NULL);"
    Invoke-GatePassNonQuery $taskConnection "GRANT SELECT ON dbo.[$taskTable] TO [$taskUser];"
    Test-Probe 'Direct table read permission rejected' 'gp_api_runtime' 0
    Invoke-GatePassNonQuery $taskConnection "REVOKE SELECT ON dbo.[$taskTable] FROM [$taskUser];"
    Invoke-GatePassNonQuery $taskConnection "GRANT SELECT ON dbo.[$taskTable](Id) TO [$taskUser];"
    Test-Probe 'Direct column read permission rejected' 'gp_api_runtime' 0
    Invoke-GatePassNonQuery $taskConnection "REVOKE SELECT ON dbo.[$taskTable](Id) FROM [$taskUser];"
    Invoke-GatePassNonQuery $taskConnection "CREATE PROCEDURE dbo.[$taskProcedure] AS SELECT 1;"
    Invoke-GatePassNonQuery $taskConnection "GRANT EXECUTE ON dbo.[$taskProcedure] TO [$taskUser];"
    Test-Probe 'Extra direct procedure permission rejected' 'gp_api_runtime' 0
    Invoke-GatePassNonQuery $taskConnection "REVOKE EXECUTE ON dbo.[$taskProcedure] FROM [$taskUser];"
    Invoke-GatePassNonQuery $taskConnection "GRANT EXECUTE ON dbo.[$taskProcedure] TO gp_api_runtime;"
    Test-Probe 'Approved role widened with helper EXECUTE rejected' 'gp_api_runtime' 0
    Invoke-GatePassNonQuery $taskConnection "REVOKE EXECUTE ON dbo.[$taskProcedure] FROM gp_api_runtime;"
    Invoke-GatePassNonQuery $taskConnection "GRANT SELECT ON SCHEMA::gp TO [$taskUser];"
    Test-Probe 'Direct schema permission rejected' 'gp_api_runtime' 0
    Invoke-GatePassNonQuery $taskConnection "REVOKE SELECT ON SCHEMA::gp FROM [$taskUser];"
    Test-Probe 'API admitted again after excess permissions removed' 'gp_api_runtime' 1
    Invoke-GatePassNonQuery $taskConnection "GRANT IMPERSONATE ON USER::dbo TO [$taskUser];"
    Test-Probe 'Direct database-user impersonation rejected' 'gp_api_runtime' 0
    Invoke-GatePassNonQuery $taskConnection "REVOKE IMPERSONATE ON USER::dbo FROM [$taskUser];"
    Invoke-GatePassNonQuery $taskConnection "GRANT IMPERSONATE ON USER::dbo TO gp_api_runtime;"
    Test-Probe 'Approved role widened with database-user impersonation rejected' 'gp_api_runtime' 0
    Invoke-GatePassNonQuery $taskConnection "REVOKE IMPERSONATE ON USER::dbo FROM gp_api_runtime;"
    Invoke-GatePassNonQuery $taskConnection "GRANT SELECT ON dbo.[$taskTable] TO public;"
    Test-Probe 'Unexpected public table permission rejected' 'gp_api_runtime' 0
    Invoke-GatePassNonQuery $taskConnection "REVOKE SELECT ON dbo.[$taskTable] FROM public;"
    Invoke-GatePassNonQuery $taskConnection "GRANT SELECT ON dbo.[$taskTable] TO gp_api_runtime;"
    Test-Probe 'Approved role widened with table access rejected' 'gp_api_runtime' 0
    Invoke-GatePassNonQuery $taskConnection "REVOKE SELECT ON dbo.[$taskTable] FROM gp_api_runtime;"
    Invoke-GatePassNonQuery $taskConnection "ALTER ROLE gp_api_runtime DROP MEMBER [$taskUser];"
    foreach ($taskRole in @('gp_staff_auth_runtime','gp_worker_runtime','gp_render_runtime','gp_media_runtime','gp_outlook_runtime')) {
        Invoke-GatePassNonQuery $taskConnection "ALTER ROLE [$taskRole] ADD MEMBER [$taskUser];"
        Test-Probe "$taskRole identity admitted" $taskRole 1
        Invoke-GatePassNonQuery $taskConnection "ALTER ROLE [$taskRole] DROP MEMBER [$taskUser];"
    }
    Invoke-GatePassNonQuery $taskConnection "ALTER ROLE gp_api_runtime ADD MEMBER [$taskUser];"
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
