$ErrorActionPreference = 'Stop'
$taskVersion = '180.140.0'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskCache = Join-Path $taskRoot '.tools/scriptdom'
$taskPackage = Join-Path $taskCache 'package.zip'
$taskTarget = Join-Path $taskCache $taskVersion
New-Item -ItemType Directory -Path $taskCache -Force | Out-Null
$taskUrl = "https://api.nuget.org/v3-flatcontainer/microsoft.sqlserver.transactsql.scriptdom/$taskVersion/microsoft.sqlserver.transactsql.scriptdom.$taskVersion.nupkg"
if (-not (Test-Path -LiteralPath $taskPackage)) { Invoke-WebRequest -Uri $taskUrl -OutFile $taskPackage }
$taskRegistration = Invoke-RestMethod -Uri "https://api.nuget.org/v3/registration5-gz-semver2/microsoft.sqlserver.transactsql.scriptdom/$taskVersion.json"
$taskCatalog = Invoke-RestMethod -Uri $taskRegistration.catalogEntry
$taskActual = [Convert]::ToBase64String([Security.Cryptography.SHA512]::HashData([IO.File]::ReadAllBytes($taskPackage)))
if ($taskCatalog.packageHashAlgorithm -ne 'SHA512' -or $taskActual -ne $taskCatalog.packageHash) {
    throw 'Package does not match the official NuGet catalog SHA-512.'
}
if (-not (Test-Path -LiteralPath $taskTarget)) { Expand-Archive -LiteralPath $taskPackage -DestinationPath $taskTarget }
$taskDll = Join-Path $taskTarget 'lib/net8.0/Microsoft.SqlServer.TransactSql.ScriptDom.dll'
if (-not (Test-Path -LiteralPath $taskDll)) { throw 'Expected .NET 8 parser assembly was not found.' }
[ordered]@{
    Package='Microsoft.SqlServer.TransactSql.ScriptDom'
    Version=$taskVersion
    Source=$taskUrl
    CatalogSha512Verified=$true
    AssemblySha256=(Get-FileHash -LiteralPath $taskDll -Algorithm SHA256).Hash
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskCache 'provenance.json') -Encoding utf8
Write-Output 'Microsoft ScriptDom package is ready; official catalog SHA-512 matched.'

