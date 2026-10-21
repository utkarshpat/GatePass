#Requires -Version 7.0
# Test-only scoped read .NET RPC bridge. No production route, driver or service identity is
# provisioned. Pipe input/output never carries raw photos, keys or QR plaintext.
$ErrorActionPreference='Stop'; Set-StrictMode -Version Latest
# Windows redirected console pipes must agree with Node's UTF-8 encoding.
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$taskInput=[Console]::In.ReadToEnd() | ConvertFrom-Json
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskConnection=Open-GatePassLocalSql -Server $taskInput.server -TrustLocalServerCertificate:$taskInput.trustLocalCertificate
try {
        if ($taskInput.procedure -notin @('gp.ListVisits','gp.GetVisitDetail','gp.VerifyGuardPass','gp.ResolveVisitPhoto')) {throw 'Invalid test procedure.'}
        $taskPrincipal=if ($taskInput.procedure -eq 'gp.ResolveVisitPhoto') {'gp_reads_media_fixture'} else {'gp_reads_api_fixture'}
        Invoke-GatePassNonQuery $taskConnection ("EXECUTE AS USER='"+$taskPrincipal+"';")
        $taskCommand=$taskConnection.CreateCommand()
        try {
            $taskCommand.CommandType=[Data.CommandType]::StoredProcedure;$taskCommand.CommandText=$taskInput.procedure
            foreach ($taskProperty in $taskInput.parameters.PSObject.Properties) {
                $taskValue=$taskProperty.Value
                $taskType=switch ($taskValue.type) {'binary' {[Data.SqlDbType]::VarBinary};'text' {[Data.SqlDbType]::NVarChar};'guid' {[Data.SqlDbType]::UniqueIdentifier};'int' {[Data.SqlDbType]::Int};'bigint' {[Data.SqlDbType]::BigInt};'datetime' {[Data.SqlDbType]::DateTime2};'date' {[Data.SqlDbType]::Date};default {throw 'Invalid parameter type.'}}
                $taskParameter=$taskCommand.Parameters.Add('@'+$taskProperty.Name,$taskType)
                if ($taskValue.type -eq 'binary') {$taskParameter.Size=8000};if ($taskValue.type -eq 'text') {$taskParameter.Size=-1};if ($taskValue.type -eq 'datetime') {$taskParameter.Scale=3}
                if ($null -eq $taskValue.value) {$taskParameter.Value=[DBNull]::Value}
                elseif ($taskValue.type -eq 'binary') {$taskParameter.Value=[Convert]::FromBase64String($taskValue.value)}
                elseif ($taskValue.type -eq 'guid') {$taskParameter.Value=[guid]$taskValue.value}
                elseif ($taskValue.type -in @('datetime','date')) {$taskParameter.Value=[datetime]::Parse($taskValue.value,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind)}
                elseif ($taskValue.type -eq 'bigint') {$taskParameter.Value=[long]$taskValue.value}
                elseif ($taskValue.type -eq 'int') {$taskParameter.Value=[int]$taskValue.value}
                else {$taskParameter.Value=$taskValue.value}
            }
            [Console]::Out.Write([string]$taskCommand.ExecuteScalar())
        } finally {$taskCommand.Dispose()}
    

}
catch {
    $taskBase=$_.Exception.GetBaseException();$taskNumber=if ($taskBase -is [Data.SqlClient.SqlException]) {$taskBase.Number} else {0}
    [Console]::Out.Write((@{bridgeError=$true;number=$taskNumber} | ConvertTo-Json -Compress))
}
finally {$taskConnection.Dispose()}
