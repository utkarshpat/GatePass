#Requires -Version 7.0
[CmdletBinding()]param()
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
if($env:TF_BUILD -ne 'True' -or $env:CI -ne 'true' -or $env:NODE_ENV -ne 'test'){
 throw 'This creates a disposable private LocalDB instance on an Azure hosted test agent only.'
}
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $taskRoot
New-Item -ItemType Directory -Path 'tmp','database/validation','output/test-results' -Force | Out-Null
$taskLocalDb=@('170','160','150')|ForEach-Object{Join-Path $env:ProgramFiles "Microsoft SQL Server/$_/Tools/Binn/SqlLocalDB.exe"}|Where-Object{Test-Path -LiteralPath $_}|Select-Object -First 1
if(-not $taskLocalDb){throw 'Hosted image lacks LocalDB. No paid resource or automatic installation was requested.'}
$taskInstance='GatePassCI_'+[guid]::NewGuid().ToString('N')
& $taskLocalDb create $taskInstance
if($LASTEXITCODE -ne 0){throw 'Private CI LocalDB creation failed.'}
& $taskLocalDb start $taskInstance
if($LASTEXITCODE -ne 0){throw 'Private CI LocalDB start failed.'}
$env:GATEPASS_TEST_SQL_SERVER='(localdb)\'+$taskInstance
Write-Output "##vso[task.setvariable variable=GatePassTestSqlServer]$env:GATEPASS_TEST_SQL_SERVER"
Add-Type -AssemblyName System.Data.SqlClient
$taskMaster=[Data.SqlClient.SqlConnection]::new("Data Source=$env:GATEPASS_TEST_SQL_SERVER;Initial Catalog=master;Integrated Security=True;Encrypt=True;TrustServerCertificate=True;Pooling=False")
try{$taskMaster.Open();$taskCreate=$taskMaster.CreateCommand();$taskCreate.CommandText='CREATE DATABASE [GatePass_DesignTest]; ALTER DATABASE [GatePass_DesignTest] SET AUTO_CLOSE OFF;';$null=$taskCreate.ExecuteNonQuery();$taskCreate.Dispose()}finally{$taskMaster.Dispose()}
& (Join-Path $taskRoot 'tools/prepare_sql_parser.ps1')
Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
Add-Type -Path (Join-Path $taskRoot '.tools/scriptdom/180.140.0/lib/net8.0/Microsoft.SqlServer.TransactSql.ScriptDom.dll')
$taskConnection=Open-GatePassLocalSql -TrustLocalServerCertificate
try{
 foreach($taskMigration in Get-ChildItem -LiteralPath 'database/migrations' -Filter '*.sql'|Sort-Object Name){
  $taskSql=[IO.File]::ReadAllText($taskMigration.FullName)
  $taskParser=[Microsoft.SqlServer.TransactSql.ScriptDom.TSql160Parser]::new($true)
  $taskErrors=[Collections.Generic.List[Microsoft.SqlServer.TransactSql.ScriptDom.ParseError]]::new()
  $taskReader=[IO.StringReader]::new($taskSql)
  try{$taskScript=$taskParser.Parse($taskReader,[ref]$taskErrors)}finally{$taskReader.Dispose()}
  if($taskErrors.Count){throw "Migration syntax failed: $($taskMigration.Name)"}
  foreach($taskBatch in $taskScript.Batches){if($taskBatch.FragmentLength -gt 0){Invoke-GatePassNonQuery $taskConnection $taskSql.Substring($taskBatch.StartOffset,$taskBatch.FragmentLength)}}
  Write-Output "Applied $($taskMigration.Name)"
 }
 $taskCount=Invoke-GatePassScalar $taskConnection 'SELECT COUNT(*) FROM gp.SchemaMigrations;'
 if($taskCount -ne (Get-ChildItem 'database/migrations' -Filter '*.sql').Count){throw 'Migration ledger is incomplete.'}
 if((Invoke-GatePassScalar $taskConnection 'SELECT COUNT(*) FROM sys.foreign_keys WHERE is_disabled=1 OR is_not_trusted=1;') -ne 0){throw 'Untrusted or disabled foreign key.'}
 Invoke-GatePassNonQuery $taskConnection ([IO.File]::ReadAllText((Join-Path $taskRoot 'database/tests/001_schema_constraints.sql')))
 Write-Output ('SQL engine '+(Invoke-GatePassScalar $taskConnection "SELECT CONVERT(nvarchar(128),SERVERPROPERTY('ProductVersion'));"))
}finally{$taskConnection.Dispose()}
& (Join-Path $taskRoot 'database/setup/Seed-LocalDirectory.ps1') -TrustLocalServerCertificate
& node tools/seed-development-guard-logins.ts
if($LASTEXITCODE -ne 0){throw 'CI guard fixtures failed.'}
& node tools/seed-development-staff-logins.ts
if($LASTEXITCODE -ne 0){throw 'CI staff fixtures failed.'}
& node tools/set-development-test-passwords.ts
if($LASTEXITCODE -ne 0){throw 'CI fixture password setup failed.'}
Write-Output 'PASS: fresh isolated SQL schema, constraints and synthetic accounts ready.'
