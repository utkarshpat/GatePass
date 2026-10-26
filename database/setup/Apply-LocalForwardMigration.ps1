#Requires -Version 7.0
[CmdletBinding()]param([Parameter(Mandatory)][ValidatePattern('^[0-9]{3}$')][string]$Version,[switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskFiles=@(Get-ChildItem -LiteralPath (Join-Path $taskRoot 'database/migrations') -Filter ($Version+'_*.sql') -File)
if($taskFiles.Count -ne 1){throw 'Exactly one forward migration required'}
$taskFile=$taskFiles[0];$taskSql=[IO.File]::ReadAllText($taskFile.FullName).Replace("`r`n","`n")
$taskManifest=Get-Content -LiteralPath (Join-Path $taskRoot 'database/migrations.sha256.json') -Raw|ConvertFrom-Json
$taskHash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($taskSql))).ToLowerInvariant()
if($null -eq $taskManifest.PSObject.Properties[$taskFile.Name] -or $taskManifest.($taskFile.Name) -ne $taskHash){throw 'Forward migration manifest mismatch'}
$taskDb=Open-GatePassLocalSql -TrustLocalServerCertificate:$TrustLocalServerCertificate
try{
 if((Invoke-GatePassScalar $taskDb 'SELECT COUNT(*) FROM gp.SchemaMigrations WHERE Version=@version;' @{version=$Version}) -ne 0){throw 'Applied migrations cannot be reapplied'}
 if((Invoke-GatePassScalar $taskDb 'SELECT COUNT(*) FROM gp.SchemaMigrations WHERE TRY_CONVERT(int,Version)=@previous;' @{previous=([int]$Version-1)}) -ne 1){throw 'Previous migration required'}
 foreach($taskBatch in [regex]::Split($taskSql,'(?m)^GO\s*$')){if(-not [string]::IsNullOrWhiteSpace($taskBatch)){Invoke-GatePassNonQuery $taskDb $taskBatch}}
 if((Invoke-GatePassScalar $taskDb 'SELECT COUNT(*) FROM gp.SchemaMigrations WHERE Version=@version;' @{version=$Version}) -ne 1){throw 'Migration did not record completion'}
 @{status='PASS';database='GatePass_DesignTest';version=$Version;sha256=$taskHash;applied=$true}|ConvertTo-Json -Compress
}catch{try{Invoke-GatePassNonQuery $taskDb 'IF @@TRANCOUNT>0 ROLLBACK;'}catch{};throw}finally{$taskDb.Dispose()}
