#Requires -Version 7.0
Set-StrictMode -Version Latest

function Open-GatePassLocalSql {
    param([string]$Server='localhost\SQLEXPRESS',[switch]$TrustLocalServerCertificate)
    # CI can target only its newly-created private LocalDB instance. This never
    # enables remote SQL or changes the normal developer's SQLEXPRESS default.
    if ($env:GATEPASS_TEST_SQL_SERVER) {
        if ($env:CI -ne 'true' -or $env:NODE_ENV -ne 'test' -or
            $env:GATEPASS_TEST_SQL_SERVER -notmatch '^\(localdb\)\\GatePassCI_[a-f0-9]{32}$') {
            throw 'CI SQL override requires test mode and an isolated GatePassCI LocalDB instance.'
        }
        $Server=$env:GATEPASS_TEST_SQL_SERVER
    }
    $taskParts=$Server.Split('\')
    $taskCiLocalDb=$env:CI -eq 'true' -and $env:NODE_ENV -eq 'test' -and $Server -match '^\(localdb\)\\GatePassCI_[a-f0-9]{32}$'
    if (-not $taskCiLocalDb -and ($taskParts.Count -gt 2 -or $taskParts[0] -notin @('.','localhost','127.0.0.1',$env:COMPUTERNAME) -or
        ($taskParts.Count -eq 2 -and $taskParts[1] -notmatch '^[a-zA-Z0-9_-]+$'))) {
        throw 'Only a local SQL Server instance is allowed by this development helper.'
    }
    Add-Type -AssemblyName System.Data.SqlClient
    $taskBuilder=[System.Data.SqlClient.SqlConnectionStringBuilder]::new()
    $taskBuilder['Data Source']=$Server
    $taskBuilder['Initial Catalog']='GatePass_DesignTest'
    $taskBuilder['Integrated Security']=$true
    $taskBuilder['Encrypt']=$true
    $taskBuilder['TrustServerCertificate']=[bool]$TrustLocalServerCertificate
    $taskBuilder['Connect Timeout']=15
    $taskBuilder['Application Name']='GatePass Phase02 Local Validation'
    # Validation impersonates disposable SQL users. Pooled impersonated sessions
    # cannot be reset safely after their fixture principal is dropped (SQL 18059).
    $taskBuilder['Pooling']=$false
    $taskConnection=[System.Data.SqlClient.SqlConnection]::new($taskBuilder.ConnectionString)
    try { $taskConnection.Open() }
    catch { $taskConnection.Dispose(); throw }
    return $taskConnection
}

function New-GatePassSqlCommand {
    param($Connection,[string]$Sql,[hashtable]$Parameters=@{})
    $taskCommand=$Connection.CreateCommand()
    $taskCommand.CommandText=$Sql
    $taskCommand.CommandTimeout=30
    foreach ($taskKey in $Parameters.Keys) {
        $taskValue=$Parameters[$taskKey]
        if ($null -eq $taskValue -and $taskKey -match 'Hash$') {
            $taskParameter=$taskCommand.Parameters.Add('@'+$taskKey,[System.Data.SqlDbType]::VarBinary,8000)
            $taskParameter.Value=[DBNull]::Value
        }
        elseif (($null -eq $taskValue -and $taskKey -eq 'OccurredAtUtc') -or $taskValue -is [datetime]) {
            $taskParameter=$taskCommand.Parameters.Add('@'+$taskKey,[System.Data.SqlDbType]::DateTime2)
            $taskParameter.Scale=3
            $taskParameter.Value=if ($null -eq $taskValue) { [DBNull]::Value } else { $taskValue }
        }
        else {
            if ($null -eq $taskValue) { $taskValue=[DBNull]::Value }
            $null=$taskCommand.Parameters.AddWithValue('@'+$taskKey,$taskValue)
        }
    }
    return $taskCommand
}

function Invoke-GatePassScalar {
    param($Connection,[string]$Sql,[hashtable]$Parameters=@{})
    $taskCommand=New-GatePassSqlCommand $Connection $Sql $Parameters
    try { return $taskCommand.ExecuteScalar() }
    finally { $taskCommand.Dispose() }
}

function Invoke-GatePassNonQuery {
    param($Connection,[string]$Sql,[hashtable]$Parameters=@{})
    $taskCommand=New-GatePassSqlCommand $Connection $Sql $Parameters
    try { $null=$taskCommand.ExecuteNonQuery() }
    finally { $taskCommand.Dispose() }
}

Export-ModuleMember -Function Open-GatePassLocalSql,New-GatePassSqlCommand,Invoke-GatePassScalar,Invoke-GatePassNonQuery
