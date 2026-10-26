#Requires -Version 7.0
[CmdletBinding()]param([switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$taskPrevious=(Get-Location).Path
try{Set-Location -LiteralPath $taskRoot;& node --test tests/sql/development-leases.test.ts;if($LASTEXITCODE -ne 0){throw 'Development lease lifecycle SQL integration failed'}}finally{Set-Location -LiteralPath $taskPrevious}
