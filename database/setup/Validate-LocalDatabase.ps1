#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$Server = '.\SQLEXPRESS',
    [ValidateSet('SqlClient', 'Sqlcmd')]
    [string]$Driver = 'SqlClient',
    [switch]$TrustLocalServerCertificate
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# This is a Windows-local development helper, not a production migration runner.
# Requires the user's existing SQL Server; uses the available .NET SQL client by default.
# Optional Sqlcmd driver requires SQL Server 2025 sqlcmd (ODBC). No installers,
# firewall changes, new logins, grants, reset/drop operations or real visitor data.
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'Use this helper on the Windows development laptop. Linux uses the same SQL files with its approved connection/provisioning workflow.'
}
$taskLocalNames = @('.', 'localhost', '127.0.0.1', $env:COMPUTERNAME)
$taskServerParts = $Server.Split('\')
$taskIsLocalDb = $Server -match '^\(localdb\)\\[a-zA-Z0-9_-]+$'
if (-not $taskIsLocalDb -and (
    $taskServerParts.Count -gt 2 -or
    $taskServerParts[0] -notin $taskLocalNames -or
    ($taskServerParts.Count -eq 2 -and $taskServerParts[1] -notmatch '^[a-zA-Z0-9_-]+$')
)) {
    throw 'Only a local Windows SQL Server instance is accepted. Remote production servers are excluded.'
}
$taskSqlcmd = $null
if ($Driver -eq 'Sqlcmd') {
    $taskSqlcmd = Get-Command sqlcmd -CommandType Application -ErrorAction SilentlyContinue
    if (-not $taskSqlcmd) {
        throw 'sqlcmd is not installed or is not on PATH. Use the default SqlClient driver or install approved SQL Server tools; no software was installed.'
    }
}
else {
    Add-Type -AssemblyName System.Data.SqlClient -ErrorAction Stop
}
$taskRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$taskDatabase = 'GatePass_DesignTest'
$taskEvidence = Join-Path $env:LOCALAPPDATA ('GatePass/validation/' + [guid]::NewGuid().ToString('N'))
$taskConnection = @('-S', $Server, '-E', '-Nm', '-b', '-r', '1', '-l', '15', '-t', '120', '-f', '65001')
if ($TrustLocalServerCertificate) { $taskConnection += '-C' }

function Invoke-GatePassSql {
    param([string]$Database, [string]$Query, [string]$InputFile, [switch]$Unbounded)
    if ($Driver -eq 'SqlClient') {
        if ($InputFile) { $taskText = [IO.File]::ReadAllText($InputFile) }
        else { $taskText = $Query }
        # The reviewed package contains single-batch T-SQL, no sqlcmd directives.
        if ($taskText -match '(?im)^\s*(?:GO(?:\s+\d+)?\s*(?:--.*)?$|:|!!)') {
            throw 'SqlClient mode accepts single-batch SQL only; sqlcmd directives/GO require a reviewed execution path.'
        }
        $taskBuilder = [System.Data.SqlClient.SqlConnectionStringBuilder]::new()
        $taskBuilder['Data Source'] = $Server
        $taskBuilder['Initial Catalog'] = $Database
        $taskBuilder['Integrated Security'] = $true
        $taskBuilder['Encrypt'] = $true
        $taskBuilder['TrustServerCertificate'] = [bool]$TrustLocalServerCertificate
        $taskBuilder['Connect Timeout'] = 15
        $taskBuilder['Application Name'] = 'GatePass Local Database Validation'
        $taskDbConnection = [System.Data.SqlClient.SqlConnection]::new($taskBuilder.ConnectionString)
        $taskLines = [Collections.Generic.List[string]]::new()
        $taskMessages = [Collections.Generic.List[string]]::new()
        $taskInfoHandler = [System.Data.SqlClient.SqlInfoMessageEventHandler]({
            param($sender, $eventArgs)
            $taskMessages.Add($eventArgs.Message)
        }.GetNewClosure())
        $taskDbConnection.add_InfoMessage($taskInfoHandler)
        try {
            $taskDbConnection.Open()
            $taskDbCommand = $taskDbConnection.CreateCommand()
            try {
                $taskDbCommand.CommandTimeout = 120
                $taskDbCommand.CommandText = $taskText
                $taskDbReader = $taskDbCommand.ExecuteReader()
                try {
                    do {
                        while ($taskDbReader.Read()) {
                            $taskFields = for ($taskIndex = 0; $taskIndex -lt $taskDbReader.FieldCount; $taskIndex++) {
                                if ($taskDbReader.IsDBNull($taskIndex)) { '[null]' }
                                else { [Convert]::ToString($taskDbReader.GetValue($taskIndex), [Globalization.CultureInfo]::InvariantCulture) }
                            }
                            $taskLines.Add(($taskFields -join "`t"))
                        }
                    } while ($taskDbReader.NextResult())
                }
                finally { $taskDbReader.Dispose() }
            }
            finally { $taskDbCommand.Dispose() }
        }
        finally { $taskDbConnection.Dispose() }
        if ($Unbounded) { return ($taskLines -join '').Trim() }
        foreach ($taskMessage in $taskMessages) { $taskLines.Add($taskMessage) }
        return ($taskLines -join [Environment]::NewLine).Trim()
    }
    $taskArguments = $taskConnection + @('-d', $Database, '-h', '-1')
    if ($Unbounded) { $taskArguments += @('-y', '0', '-w', '65535') }
    else { $taskArguments += '-W' }
    if ($InputFile) { $taskArguments += @('-i', $InputFile) }
    else { $taskArguments += @('-Q', $Query) }
    # Passwords are never accepted; this helper uses the signed-in Windows identity.
    $taskOutput = @(& $taskSqlcmd.Source @taskArguments 2>&1)
    $taskExit = $LASTEXITCODE
    if ($taskExit -ne 0) {
        throw "SQL command failed (exit $taskExit) on dedicated local test workflow. $($taskOutput -join [Environment]::NewLine)"
    }
    # FOR JSON may stream several result chunks; row separators are not JSON data.
    if ($Unbounded) { return ($taskOutput -join '').Trim() }
    return ($taskOutput -join [Environment]::NewLine).Trim()
}

$taskReport = [ordered]@{
    StartedAtUtc = [datetime]::UtcNow.ToString('o')
    Server = $Server
    Database = $taskDatabase
    Driver = $Driver
    TrustLocalServerCertificate = [bool]$TrustLocalServerCertificate
    Status = 'RUNNING'
    SqlServerExecution = $false
    MigrationActions = @()
    ConstraintScenariosPassed = $false
    CatalogSanityPassed = $false
    Sources = @()
}
try {
    # Connect before creating evidence folders or database files.
    $taskInfoQuery = @"
SET NOCOUNT ON;
SELECT CONVERT(nvarchar(128),SERVERPROPERTY('ProductVersion')) AS product_version,
       CONVERT(nvarchar(128),SERVERPROPERTY('Edition')) AS edition,
       CONVERT(nvarchar(4000),SERVERPROPERTY('InstanceDefaultDataPath')) AS data_path,
       CONVERT(nvarchar(4000),SERVERPROPERTY('InstanceDefaultLogPath')) AS log_path
FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;
"@
    $taskInfo = (Invoke-GatePassSql -Database master -Query $taskInfoQuery -Unbounded) | ConvertFrom-Json
    $taskReport.SqlServerExecution = $true
    $taskReport.Engine = $taskInfo
    if ([int]($taskInfo.product_version.Split('.')[0]) -lt 16) {
        throw 'This SQL package requires SQL Server 2022 or newer.'
    }
    if ($taskInfo.data_path -match '(?i)OneDrive' -or $taskInfo.log_path -match '(?i)OneDrive') {
        throw 'SQL Server default data/log storage is in OneDrive. Configure approved local data paths before creating this database.'
    }
    New-Item -ItemType Directory -Path $taskEvidence -Force | Out-Null
    Invoke-GatePassSql -Database master -Query "IF DB_ID(N'GatePass_DesignTest') IS NULL EXEC(N'CREATE DATABASE [GatePass_DesignTest]');" | Out-Null
    $taskStateQuery = @"
SET NOCOUNT ON;
IF OBJECT_ID(N'gp.SchemaMigrations',N'U') IS NULL
BEGIN
    IF EXISTS(SELECT 1 FROM sys.tables WHERE is_ms_shipped=0)
        THROW 51300, 'Existing test database contains unrecognized tables; no reset is performed.', 1;
    SELECT '[]';
END
ELSE
    EXEC(N'SELECT Version FROM gp.SchemaMigrations ORDER BY Version FOR JSON PATH;');
"@
    $taskVersions = @((Invoke-GatePassSql -Database $taskDatabase -Query $taskStateQuery -Unbounded) | ConvertFrom-Json)
    foreach ($taskVersion in $taskVersions) {
        if ($taskVersion.Version -notin @('001', '002', '003', '004', '005', '006', '007', '008', '009', '010', '011', '012', '013', '014', '015', '016', '017', '018', '019', '020', '021', '022', '023', '024', '025', '026', '027', '028', '029', '030', '031', '032', '033', '034', '035', '036', '037', '038', '039')) { throw 'Unrecognized migration version. Use a reviewed upgrade workflow.' }
    }
    if ('002' -in @($taskVersions | ForEach-Object { $_.Version }) -and '001' -notin @($taskVersions | ForEach-Object { $_.Version })) {
        throw 'Migration history is inconsistent: 002 exists without 001.'
    }
    foreach ($taskMigration in @(
        @{ Version = '001'; File = 'database/migrations/001_individual_visit_baseline.sql' },
        @{ Version = '002'; File = 'database/migrations/002_reference_data.sql' }
    )) {
        $taskPath = Join-Path $taskRoot $taskMigration.File
        $taskReport.Sources += @{ File = $taskMigration.File; Sha256 = (Get-FileHash -LiteralPath $taskPath -Algorithm SHA256).Hash }
        if ($taskMigration.Version -in @($taskVersions | ForEach-Object { $_.Version })) {
            $taskReport.MigrationActions += "$($taskMigration.Version): already recorded; not reapplied"
        }
        else {
            Write-Host "Applying migration $($taskMigration.Version) to $taskDatabase..."
            Invoke-GatePassSql -Database $taskDatabase -InputFile $taskPath | Out-Null
            $taskReport.MigrationActions += "$($taskMigration.Version): applied"
        }
    }
    $taskTestFile = Join-Path $taskRoot 'database/tests/001_schema_constraints.sql'
    $taskReport.Sources += @{ File = 'database/tests/001_schema_constraints.sql'; Sha256 = (Get-FileHash -LiteralPath $taskTestFile -Algorithm SHA256).Hash }
    $taskTestOutput = Invoke-GatePassSql -Database $taskDatabase -InputFile $taskTestFile
    $taskTestOutput | Set-Content -LiteralPath (Join-Path $taskEvidence 'constraint-results.txt') -Encoding utf8
    if ($taskTestOutput -notmatch 'All 18 constraint scenarios passed') { throw 'Constraint test completion marker missing; inspect the saved output.' }
    $taskReport.ConstraintScenariosPassed = $true

    $taskCatalogText = Invoke-GatePassSql -Database $taskDatabase -InputFile (Join-Path $taskRoot 'database/inspection/001_live_catalog.sql') -Unbounded
    $taskCatalog = $taskCatalogText | ConvertFrom-Json -AsHashtable
    $taskCatalogText | Set-Content -LiteralPath (Join-Path $taskEvidence 'live-catalog.json') -Encoding utf8
    $taskTableCount = @($taskCatalog.tables).Count
    $taskColumnCount = @($taskCatalog.tables | ForEach-Object { $_.columns }).Count
    $taskForeignKeyCount = @($taskCatalog.tables | ForEach-Object { if ($_.ContainsKey('foreign_keys')) { $_['foreign_keys'] } }).Count
    $taskGuardSchemaApplied='006' -in @($taskVersions | ForEach-Object {$_.Version})
    $taskRegistrationApplied='008' -in @($taskVersions | ForEach-Object {$_.Version})
    ${taskCardDetailsApplied}='014' -in @($taskVersions | ForEach-Object {$_.Version})
    $taskPrintApplied='011' -in @($taskVersions | ForEach-Object {$_.Version})
    $taskExpectedTables=if ($taskPrintApplied) {33} elseif ($taskRegistrationApplied) {32} elseif ($taskGuardSchemaApplied) {31} else {27}
    $taskExpectedColumns=if ($taskCardDetailsApplied) {297} elseif ($taskPrintApplied) {296} elseif ($taskRegistrationApplied) {286} elseif ($taskGuardSchemaApplied) {281} else {250}
    $taskExpectedFks=if ($taskPrintApplied) {58} elseif ($taskRegistrationApplied) {57} elseif ($taskGuardSchemaApplied) {56} else {52}
    if ($taskTableCount -ne $taskExpectedTables -or $taskColumnCount -ne $taskExpectedColumns -or $taskForeignKeyCount -ne $taskExpectedFks) {
        throw "Unexpected live catalog totals: $taskTableCount tables, $taskColumnCount columns, $taskForeignKeyCount foreign keys."
    }
    foreach ($taskTable in $taskCatalog.tables) {
        foreach ($taskConstraint in @($taskTable['checks']) + @($taskTable['foreign_keys'])) {
            if ($taskConstraint -and ($taskConstraint.is_disabled -or $taskConstraint.is_not_trusted)) {
                throw "Disabled or untrusted constraint: $($taskTable.table_name).$($taskConstraint.name)"
            }
        }
    }
    $taskReport.CatalogSanityPassed = $true
    $taskReport.CatalogCounts = @{ Tables = $taskTableCount; Columns = $taskColumnCount; ForeignKeys = $taskForeignKeyCount }
    $taskReport.Status = 'PASS'
    Write-Host "Local schema/constraint validation passed. Evidence: $taskEvidence"
    Write-Host 'This does not verify runtime authorization, transaction races, enterprise integrations or Linux deployment.'
}
catch {
    $taskReport.Status = 'FAILED'
    $taskReport.Error = $_.Exception.Message
    throw
}
finally {
    $taskReport.CompletedAtUtc = [datetime]::UtcNow.ToString('o')
    if (Test-Path -LiteralPath $taskEvidence) {
        $taskReport | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $taskEvidence 'validation-report.json') -Encoding utf8
    }
}

