#Requires -Version 7.0
[CmdletBinding()]param()
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
if($env:CI -ne 'true' -or $env:NODE_ENV -ne 'test' -or $env:GATEPASS_TEST_SQL_SERVER -notmatch '^\(localdb\)\\GatePassCI_[a-f0-9]{32}$'){
 throw 'SQL CI requires its isolated private test instance.'
}
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $taskRoot
$taskSuites=@('Test-TransactionCore.ps1','Test-Registration.ps1','Test-GuardDuties.ps1','Test-PassPrinting.ps1','Test-EmailWorkflow.ps1','Test-OutlookActions.ps1','Test-PublicRegistration.ps1')
$taskResults=[Collections.Generic.List[object]]::new()
foreach($taskSuite in $taskSuites){
 $taskWatch=[Diagnostics.Stopwatch]::StartNew()
 try{
  if($taskSuite -in @('Test-TransactionCore.ps1','Test-Registration.ps1','Test-GuardDuties.ps1','Test-PassPrinting.ps1','Test-EmailWorkflow.ps1','Test-OutlookActions.ps1')){& (Join-Path $taskRoot "database/tests/$taskSuite") -TrustLocalServerCertificate}
  else{& (Join-Path $taskRoot "database/tests/$taskSuite")}
  $taskResults.Add(@{name=$taskSuite;time=$taskWatch.Elapsed.TotalSeconds;passed=$true})
 }catch{
  $taskResults.Add(@{name=$taskSuite;time=$taskWatch.Elapsed.TotalSeconds;passed=$false})
  throw
 }finally{
  $taskXml=[Xml.XmlDocument]::new();$taskTop=$taskXml.CreateElement('testsuite');$taskXml.AppendChild($taskTop)|Out-Null
  $taskTop.SetAttribute('name','Live SQL security and HTTP integration');$taskTop.SetAttribute('tests',[string]$taskResults.Count)
  foreach($taskResult in $taskResults){$taskCase=$taskXml.CreateElement('testcase');$taskCase.SetAttribute('name',$taskResult.name);$taskCase.SetAttribute('time',$taskResult.time.ToString('F3',[Globalization.CultureInfo]::InvariantCulture));if(-not $taskResult.passed){$taskFailure=$taskXml.CreateElement('failure');$taskFailure.SetAttribute('message','Integration suite failed; inspect redacted job log.');$taskCase.AppendChild($taskFailure)|Out-Null};$taskTop.AppendChild($taskCase)|Out-Null}
  $taskXml.Save((Join-Path $taskRoot 'output/test-results/sql.xml'))
 }
}
