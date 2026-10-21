#Requires -Version 7.0
# Local dummy authentication ONLY; never used by production composition/driver.
$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
if ($env:NODE_ENV -notin @('development','test') -or $env:GATEPASS_SSO_MODE -ne 'dummy' -or $env:GATEPASS_DIRECTORY_MODE -ne 'mock') { throw 'Explicit dummy development environment required.' }
$taskInput=[Console]::In.ReadToEnd() | ConvertFrom-Json
Import-Module (Join-Path $PSScriptRoot 'GatePass.LocalSql.psm1') -Force
$taskConnection=Open-GatePassLocalSql -TrustLocalServerCertificate
try {
    $taskSql=Get-Content (Join-Path $PSScriptRoot '../database/development/002_dummy_employee_sso.sql') -Raw
    $taskCommand=$taskConnection.CreateCommand();$taskCommand.CommandText=$taskSql;$taskCommand.CommandTimeout=15
    try {
        $null=$taskCommand.Parameters.Add('@Action',[Data.SqlDbType]::VarChar,20);$taskCommand.Parameters['@Action'].Value=$taskInput.action
        $null=$taskCommand.Parameters.Add('@EmployeeId',[Data.SqlDbType]::NVarChar,64);$taskCommand.Parameters['@EmployeeId'].Value=if($null -eq $taskInput.employeeId){[DBNull]::Value}else{$taskInput.employeeId}
        foreach($taskName in @('SessionHash','CsrfHash')) {
            $null=$taskCommand.Parameters.Add('@'+$taskName,[Data.SqlDbType]::VarBinary,8000)
            $taskValue=$taskInput.$taskName
            if($null -eq $taskValue){$taskCommand.Parameters['@'+$taskName].Value=[DBNull]::Value}
            else{$taskCommand.Parameters['@'+$taskName].Value=[Convert]::FromBase64String($taskValue)}
        }
        [Console]::Out.Write([string]$taskCommand.ExecuteScalar())
    } finally { $taskCommand.Dispose() }
} catch {
    [Console]::Out.Write('{"ok":false}')
} finally { $taskConnection.Dispose() }
