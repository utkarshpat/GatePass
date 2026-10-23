#Requires -Version 7.0
param([Parameter(Mandatory)][guid]$RunId,[ValidateSet('Create','Cleanup')][string]$Action)
$ErrorActionPreference='Stop'
if($Action -eq 'Cleanup'){
 Import-Module './tools/GatePass.LocalSql.psm1' -Force
 $db=Open-GatePassLocalSql -TrustLocalServerCertificate
 try{Invoke-GatePassNonQuery $db (Get-Content database/tests/LocalStaffOwnedCleanup.sql -Raw) @{RunId=$RunId}}finally{$db.Dispose()}
}
& './tests/browser/AdminConsoleFixture.ps1' -RunId $RunId -Action $Action
