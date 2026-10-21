# Test-only RPC bridge, using the installed .NET SQL client and temporary users
# WITHOUT LOGIN. Production does not spawn PowerShell or use an admin connection.
# Input/output are process pipes; neither passwords nor tokens are command arguments.
#Requires -Version 7.0
$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$taskInput=[Console]::In.ReadToEnd() | ConvertFrom-Json
$taskRoles=@{auth='gp_guard_auth_fixture';api='gp_guard_api_fixture'}
if (-not $taskRoles.ContainsKey([string]$taskInput.role)) { throw 'Invalid test role.' }
$taskAllowed=@('gp.BeginGuardLogin','gp.CompleteGuardLogin','gp.InspectGuardSetup','gp.CompleteGuardSetup','gp.TouchGuardSession','gp.RevokeGuardSession','gp.ManageGuardCredential')
if ($taskInput.procedure -notin $taskAllowed) { throw 'Invalid test procedure.' }
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskConnection=Open-GatePassLocalSql -Server $taskInput.server -TrustLocalServerCertificate:$taskInput.trustLocalCertificate
try {
    Invoke-GatePassNonQuery $taskConnection ("EXECUTE AS USER='"+$taskRoles[[string]$taskInput.role]+"';")
    $taskCommand=$taskConnection.CreateCommand()
    try {
        $taskCommand.CommandType=[Data.CommandType]::StoredProcedure
        $taskCommand.CommandText=$taskInput.procedure
        foreach ($taskProperty in $taskInput.parameters.PSObject.Properties) {
            $taskValue=$taskProperty.Value
            $taskType=switch ($taskValue.type) {'binary' {[Data.SqlDbType]::VarBinary};'text' {[Data.SqlDbType]::VarChar};'bit' {[Data.SqlDbType]::Bit};'guid' {[Data.SqlDbType]::UniqueIdentifier};default {throw 'Invalid parameter type.'}}
            $taskParameter=$taskCommand.Parameters.Add('@'+$taskProperty.Name,$taskType)
            if ($taskValue.type -in @('binary','text')) { $taskParameter.Size=8000 }
            if ($null -eq $taskValue.value) { $taskParameter.Value=[DBNull]::Value }
            elseif ($taskValue.type -eq 'binary') { $taskParameter.Value=[Convert]::FromBase64String($taskValue.value) }
            elseif ($taskValue.type -eq 'guid') { $taskParameter.Value=[guid]$taskValue.value }
            else { $taskParameter.Value=$taskValue.value }
        }
        [Console]::Out.Write([string]$taskCommand.ExecuteScalar())
    } finally { $taskCommand.Dispose() }
} finally { $taskConnection.Dispose() }
