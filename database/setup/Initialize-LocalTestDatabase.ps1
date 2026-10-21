param([string]$LocalDbExecutable)
$ErrorActionPreference = 'Stop'
# Requires an already-installed Microsoft LocalDB engine and sqlcmd.
# Creates a private named developer instance; no firewall/network/public sharing changes.
if (-not $LocalDbExecutable) {
    $taskCandidates = @(
        (Join-Path $env:ProgramFiles 'Microsoft SQL Server/170/Tools/Binn/SqlLocalDB.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft SQL Server/160/Tools/Binn/SqlLocalDB.exe')
    )
    $LocalDbExecutable = $taskCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $LocalDbExecutable) { throw 'Install Microsoft SQL Server Express LocalDB from the official Microsoft distribution first. No engine was found.' }
$taskSqlcmd = Get-Command sqlcmd -ErrorAction Stop
$taskInstance = 'GatePassDev'
$taskDatabase = 'GatePass_DesignTest'
$taskData = Join-Path $env:LOCALAPPDATA 'GatePass/sql-data'
New-Item -ItemType Directory -Path $taskData -Force | Out-Null
$taskInstances = & $LocalDbExecutable info
if ($LASTEXITCODE -ne 0) { throw 'Unable to enumerate LocalDB instances.' }
if ($taskInstances -notcontains $taskInstance) {
    & $LocalDbExecutable create $taskInstance
    if ($LASTEXITCODE -ne 0) { throw 'Unable to create private GatePassDev instance.' }
}
& $LocalDbExecutable start $taskInstance
if ($LASTEXITCODE -ne 0) { throw 'Unable to start private GatePassDev instance.' }
# Only the fixed dedicated database name is accepted here; no string-built identifiers from users.
$taskMdf = (Join-Path $taskData 'GatePass_DesignTest.mdf').Replace("'","''")
$taskLdf = (Join-Path $taskData 'GatePass_DesignTest_log.ldf').Replace("'","''")
$taskQuery = "IF DB_ID(N'GatePass_DesignTest') IS NULL CREATE DATABASE [GatePass_DesignTest] ON PRIMARY (NAME=N'GatePass_DesignTest', FILENAME=N'$taskMdf') LOG ON (NAME=N'GatePass_DesignTest_log', FILENAME=N'$taskLdf'); SELECT DB_ID(N'GatePass_DesignTest') AS DatabaseId;"
& $taskSqlcmd.Source -S '(localdb)\GatePassDev' -E -b -d master -Q $taskQuery
if ($LASTEXITCODE -ne 0) { throw 'Database creation/connection failed; no existing database was dropped.' }
Write-Output 'Private test database ready. Apply the migrations using database/README.md.'

