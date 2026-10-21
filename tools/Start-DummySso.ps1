#Requires -Version 7.0
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
if ($env:NODE_ENV -eq 'production') { throw 'Dummy SSO cannot start from production mode.' }
$env:NODE_ENV='development';$env:GATEPASS_SSO_MODE='dummy';$env:GATEPASS_DIRECTORY_MODE='mock'
& (Join-Path $PSScriptRoot '../database/setup/Seed-LocalDirectory.ps1') -TrustLocalServerCertificate
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw 'Dummy directory refresh failed.' }
& node (Join-Path $PSScriptRoot 'start-dummy-sso.ts')
exit $LASTEXITCODE
