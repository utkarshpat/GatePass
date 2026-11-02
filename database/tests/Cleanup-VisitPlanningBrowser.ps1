#Requires -Version 7.0
[CmdletBinding()]param([switch]$TrustLocalServerCertificate)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$path=Join-Path $root 'tmp/planning-browser-fixture.json'
if(-not(Test-Path -LiteralPath $path)){Write-Output 'No retained planning browser fixture.';return}
$record=Get-Content -LiteralPath $path -Raw|ConvertFrom-Json
if($record.createdBy -ne 'Test-VisitPlanningFoundation' -or $record.database -notmatch '^GatePass_Verification_[a-f0-9]{32}$'){throw 'Unexpected cleanup target.'}
$taskSqlServer='localhost\SQLEXPRESS'
if($env:GATEPASS_TEST_SQL_SERVER){
 if($env:CI -ne 'true' -or $env:NODE_ENV -ne 'test' -or $env:GATEPASS_TEST_SQL_SERVER -notmatch '^\(localdb\)\\GatePassCI_[a-f0-9]{32}$'){throw 'CI override requires an isolated test LocalDB instance.'}
 $taskSqlServer=$env:GATEPASS_TEST_SQL_SERVER
}
Add-Type -AssemblyName System.Data.SqlClient
$builder=[Data.SqlClient.SqlConnectionStringBuilder]::new();$builder['Data Source']=$taskSqlServer;$builder['Initial Catalog']='master';$builder['Integrated Security']=$true;$builder['Encrypt']=$true;$builder['TrustServerCertificate']=[bool]$TrustLocalServerCertificate;$builder['Pooling']=$false
$db=[Data.SqlClient.SqlConnection]::new($builder.ConnectionString)
try{
 $db.Open();$cmd=$db.CreateCommand();try{
  $name=$record.database
  $cmd.CommandText="SELECT COUNT(*) FROM [$name].sys.extended_properties WHERE class=0 AND name=N'GatePass.DisposableVerification' AND CONVERT(nvarchar(100),value)=N'$name';"
  if($cmd.ExecuteScalar() -ne 1){throw 'Ownership marker missing. Cleanup refused.'}
  $cmd.CommandText="ALTER DATABASE [$name] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$name];";$null=$cmd.ExecuteNonQuery()
 }finally{$cmd.Dispose()}
 if((Get-Content -LiteralPath $path -Raw|ConvertFrom-Json).database -ne $name){throw 'Fixture ownership file changed. Preserve it.'}
 Remove-Item -LiteralPath $path
 Write-Output 'Owned disposable planning browser database removed.'
}finally{$db.Dispose()}
