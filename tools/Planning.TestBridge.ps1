# Test-only bridge for a previously created, ownership-marked disposable catalogue.
param([Parameter(Mandatory)][ValidatePattern('^GatePass_Verification_[a-f0-9]{32}$')][string]$Database)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
if($env:NODE_ENV -ne 'test' -or $env:GATEPASS_SSO_MODE -ne 'dummy' -or $env:GATEPASS_DIRECTORY_MODE -ne 'mock'){throw 'Explicit isolated test mode required.'}
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Import-Module (Join-Path $PSScriptRoot 'GatePass.LocalSql.psm1') -Force
$connection=Open-GatePassLocalSql -Database $Database -TrustLocalServerCertificate
try{
 while($null -ne ($line=[Console]::ReadLine())){
  try{
   $packet=$line|ConvertFrom-Json -Depth 30
   if($packet.PSObject.Properties.Name -contains 'warmup'){$result='{"ready":true}'}else{
    if($packet.procedure -notin @('gp.ClaimPlanningNotifications','gp.GetPlanningNotification','gp.RenewPlanningNotificationLease','gp.CompletePlanningNotification','gp.PreviewPlanningNotifications','gp.ReadVisitCoordination','gp.ManageVisitPlanning','gp.CreatePlannedVisit','gp.ChangePlannedVisit')){throw 'Unknown test procedure.'}
    $principal=if($packet.procedure -in @('gp.ClaimPlanningNotifications','gp.GetPlanningNotification','gp.RenewPlanningNotificationLease','gp.CompletePlanningNotification','gp.PreviewPlanningNotifications')){'gp_planning_worker_probe'}else{'gp_planning_api_probe'};Invoke-GatePassNonQuery $connection "EXECUTE AS USER='$principal';"
    try{
     $c=$connection.CreateCommand();$c.CommandType=[Data.CommandType]::StoredProcedure;$c.CommandText=$packet.procedure;$c.CommandTimeout=20
     try{
      foreach($property in $packet.parameters.PSObject.Properties){
       $value=$property.Value
       $type=switch($value.type){binary{[Data.SqlDbType]::VarBinary};text{[Data.SqlDbType]::NVarChar};guid{[Data.SqlDbType]::UniqueIdentifier};int{[Data.SqlDbType]::Int};default{throw 'Unknown test parameter.'}}
       $p=$c.Parameters.Add('@'+$property.Name,$type);if($value.type -eq 'text'){$p.Size=-1};if($value.type -eq 'binary'){$p.Size=8000}
       if($null -eq $value.value){$p.Value=[DBNull]::Value}elseif($value.type -eq 'binary'){$p.Value=[Convert]::FromBase64String($value.value)}elseif($value.type -eq 'guid'){$p.Value=[guid]$value.value}elseif($value.type -eq 'int'){$p.Value=[int]$value.value}else{$p.Value=$value.value}
      }
      $result=[string]$c.ExecuteScalar()
     }finally{$c.Dispose()}
    }finally{Invoke-GatePassNonQuery $connection 'IF @@TRANCOUNT>0 ROLLBACK;REVERT;'}
   }
  }catch{$base=$_.Exception.GetBaseException();$result=@{bridgeError=$true;number=$(if($base -is [Data.SqlClient.SqlException]){$base.Number}else{0})}|ConvertTo-Json -Compress}
  [Console]::WriteLine((@{result=$result}|ConvertTo-Json -Compress -Depth 4));[Console]::Out.Flush()
 }
}finally{$connection.Dispose()}
