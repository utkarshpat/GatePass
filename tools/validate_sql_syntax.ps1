param([string]$ScriptDomPath)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
if (-not $ScriptDomPath) {
    $ScriptDomPath = Join-Path $taskRoot '.tools/scriptdom/180.140.0/lib/net8.0/Microsoft.SqlServer.TransactSql.ScriptDom.dll'
}
if (-not (Test-Path -LiteralPath $ScriptDomPath)) {
    throw 'Microsoft ScriptDom is required. See database/README.md for the official NuGet package and parser setup.'
}
Add-Type -Path $ScriptDomPath
$taskParser = [Microsoft.SqlServer.TransactSql.ScriptDom.TSql160Parser]::new($true)
$taskFiles = Get-ChildItem -LiteralPath (Join-Path $taskRoot 'database') -Filter '*.sql' -Recurse | Sort-Object FullName
$taskFailures = 0
$taskResults = foreach ($taskFile in $taskFiles) {
    $taskErrors = [System.Collections.Generic.List[Microsoft.SqlServer.TransactSql.ScriptDom.ParseError]]::new()
    $taskReader = [System.IO.StringReader]::new([IO.File]::ReadAllText($taskFile.FullName))
    try { $taskFragment = $taskParser.Parse($taskReader, [ref]$taskErrors) }
    finally { $taskReader.Dispose() }
    if ($taskErrors.Count -gt 0) { $taskFailures += $taskErrors.Count }
    [pscustomobject]@{
        File = [IO.Path]::GetRelativePath($taskRoot, $taskFile.FullName).Replace('\','/')
        ErrorCount = $taskErrors.Count
        Errors = @($taskErrors | ForEach-Object { [pscustomobject]@{ Line=$_.Line; Column=$_.Column; Message=$_.Message } })
    }
}
$taskReport = [ordered]@{
    Parser = 'Microsoft ScriptDom TSql160Parser'
    AssemblyVersion = [Microsoft.SqlServer.TransactSql.ScriptDom.TSql160Parser].Assembly.GetName().Version.ToString()
    AssemblySha256 = (Get-FileHash -LiteralPath $ScriptDomPath -Algorithm SHA256).Hash
    SqlServerExecution = $false
    Results = @($taskResults)
}
$taskReport | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $taskRoot 'database/validation/sql-syntax-report.json') -Encoding utf8
$taskResults | Select-Object File,ErrorCount | Format-Table -AutoSize
if ($taskFailures -gt 0) { throw "SQL syntax validation failed: $taskFailures errors." }

