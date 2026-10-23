#Requires -Version 7.0
# Local dummy authentication ONLY; never used by production composition/driver.
param([switch]$Persistent)
$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
if ($env:NODE_ENV -notin @('development','test') -or $env:GATEPASS_SSO_MODE -ne 'dummy' -or $env:GATEPASS_DIRECTORY_MODE -ne 'mock') { throw 'Explicit dummy development environment required.' }
Import-Module (Join-Path $PSScriptRoot 'GatePass.LocalSql.psm1') -Force
$taskSql=Get-Content (Join-Path $PSScriptRoot '../database/development/002_dummy_employee_sso.sql') -Raw
function Invoke-DevelopmentSsoCall($taskInput) {
$taskConnection=$null
try {
    if ($null -eq $taskInput -or (@($taskInput.PSObject.Properties.Name | Sort-Object) -join '|') -ne 'action|CsrfHash|employeeId|SessionHash') { throw 'Invalid input shape.' }
    if ($taskInput.action -notin @('list','create','inspect','touch','logout','refresh')) { throw 'Invalid action.' }
    if ($null -ne $taskInput.employeeId -and $taskInput.employeeId -notmatch '^EMP[0-9]{3}$') { throw 'Invalid employee ID.' }
    foreach($taskName in @('SessionHash','CsrfHash')) {
        if($null -ne $taskInput.$taskName -and [Convert]::FromBase64String($taskInput.$taskName).Length -ne 32){throw 'Invalid session binding.'}
    }
    # Each operation has a fresh SQL connection and executes the original SQL
    # transaction/marker/authorization checks. Only the helper process is reused.
    $taskConnection=Open-GatePassLocalSql -TrustLocalServerCertificate
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
        return [string]$taskCommand.ExecuteScalar()
    } finally { $taskCommand.Dispose() }
} catch {
    return '{"ok":false}'
} finally { if($null -ne $taskConnection){$taskConnection.Dispose()} }
}
if($Persistent){
    while($null -ne ($taskLine=[Console]::In.ReadLine())){
        if($taskLine.Length -gt 8192){throw 'Input too large.'}
        $taskEnvelope=$taskLine|ConvertFrom-Json
        if($taskEnvelope.id -isnot [string] -or $taskEnvelope.id -notmatch '^[a-f0-9]{32}$'){throw 'Invalid request ID.'}
        $taskResult=Invoke-DevelopmentSsoCall $taskEnvelope.request
        [Console]::Out.WriteLine((@{id=$taskEnvelope.id;result=($taskResult|ConvertFrom-Json)}|ConvertTo-Json -Compress -Depth 12));[Console]::Out.Flush()
    }
}else{
    [Console]::Out.Write((Invoke-DevelopmentSsoCall ([Console]::In.ReadToEnd()|ConvertFrom-Json)))
}
