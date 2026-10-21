#Requires -Version 7.0
# Development-only RPC transport, with a disposable execute-only principal per call.
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
if($env:NODE_ENV -notin @('development','test') -or $env:GATEPASS_SSO_MODE -ne 'dummy' -or $env:GATEPASS_DIRECTORY_MODE -ne 'mock'){throw 'Explicit local dummy mode required.'}
$taskInput=[Console]::In.ReadToEnd()|ConvertFrom-Json
Import-Module (Join-Path $PSScriptRoot 'GatePass.LocalSql.psm1') -Force
$taskConnection=Open-GatePassLocalSql -TrustLocalServerCertificate
$taskPrincipal='gp_dev_api_'+[guid]::NewGuid().ToString('N');$taskCreated=$false;$taskImpersonated=$false
try{
 if($taskInput.procedure -notin @('gp.CreateRegistrationIntake','gp.RecordRegistrationPhoto','gp.SubmitRegistration','gp.ListRegistrationLocations','gp.GetRegistrationOptions','gp.GetVisitDetail','gp.GetOwnDigitalIdCard','gp.GetStaffAccessContext','gp.ManageStaffCredential','gp.GetAdminWorkspaceContext','gp.GetGuardWorkspaceContext','gp.FindGuardPass','gp.ListGuardVisitors','gp.ListGuardRecentScans','gp.ListGuardWorkContexts','gp.ListVisits','gp.VerifyGuardPass','gp.RecordMovement','gp.ListLeadProjects','gp.SearchProjectLeadCandidates','gp.ListProjectHeads','gp.GrantStaffRole','gp.RevokeStaffRole','gp.BeginGuardLogin','gp.CompleteGuardLogin','gp.TouchGuardSession','gp.RevokeGuardSession','gp.ResolveStaffLoginIdentity','gp.BeginStaffLogin','gp.CompleteStaffLogin','gp.TouchStaffSession','gp.RevokeStaffSession','gp.InspectStaffSetup','gp.CompleteStaffSetup','gp.GetReceptionContext','gp.ListReceptionVisits','gp.RequestPassPrint','gp.GetPassPrintJob','gp.GetReceptionCardSource','gp.BeginPassRender','gp.FinishPassRender','gp.DispatchPassPrint','gp.FailPassPrint','gp.ResolveVisitPhoto')){throw 'Procedure not allowed.'}
 if((Invoke-GatePassScalar $taskConnection "SELECT COUNT(*) FROM sys.extended_properties WHERE class=0 AND name=N'GatePass.DevelopmentDirectoryMarker' AND CONVERT(nvarchar(100),value)=N'SYNTHETIC-DIRECTORY-V1'") -ne 1){throw 'Synthetic development database required.'}
 $taskRole=if($taskInput.procedure -in @('gp.ResolveStaffLoginIdentity','gp.BeginStaffLogin','gp.CompleteStaffLogin','gp.TouchStaffSession','gp.RevokeStaffSession','gp.InspectStaffSetup','gp.CompleteStaffSetup')){'gp_staff_auth_runtime'}elseif($taskInput.procedure -in @('gp.BeginGuardLogin','gp.CompleteGuardLogin','gp.TouchGuardSession','gp.RevokeGuardSession')){'gp_guard_auth_runtime'}elseif($taskInput.procedure -in @('gp.GetOwnDigitalIdCard','gp.GetReceptionCardSource','gp.BeginPassRender','gp.FinishPassRender','gp.DispatchPassPrint','gp.FailPassPrint')){'gp_render_runtime'}elseif($taskInput.procedure -eq 'gp.ResolveVisitPhoto'){'gp_media_runtime'}else{'gp_api_runtime'}
 Invoke-GatePassNonQuery $taskConnection "CREATE USER [$taskPrincipal] WITHOUT LOGIN; ALTER ROLE $taskRole ADD MEMBER [$taskPrincipal];";$taskCreated=$true
 Invoke-GatePassNonQuery $taskConnection "EXECUTE AS USER='$taskPrincipal';";$taskImpersonated=$true
 $taskCommand=$taskConnection.CreateCommand();$taskCommand.CommandType=[Data.CommandType]::StoredProcedure;$taskCommand.CommandText=$taskInput.procedure;$taskCommand.CommandTimeout=15
 try{
  foreach($taskProperty in $taskInput.parameters.PSObject.Properties){
   if($taskProperty.Name -notmatch '^[A-Za-z][A-Za-z0-9]{0,127}$'){throw 'Invalid parameter name.'}
   $taskValue=$taskProperty.Value
   $taskType=switch($taskValue.type){'bit'{[Data.SqlDbType]::Bit};'binary'{[Data.SqlDbType]::VarBinary};'text'{[Data.SqlDbType]::NVarChar};'guid'{[Data.SqlDbType]::UniqueIdentifier};'int'{[Data.SqlDbType]::Int};'bigint'{[Data.SqlDbType]::BigInt};'datetime'{[Data.SqlDbType]::DateTime2};'date'{[Data.SqlDbType]::Date};default{throw 'Invalid parameter type.'}}
   $taskParameter=$taskCommand.Parameters.Add('@'+$taskProperty.Name,$taskType)
   if($taskValue.type -eq 'binary'){$taskParameter.Size=8000};if($taskValue.type -eq 'text'){$taskParameter.Size=-1};if($taskValue.type -eq 'datetime'){$taskParameter.Scale=3}
   if($null -eq $taskValue.value){$taskParameter.Value=[DBNull]::Value}
   elseif($taskValue.type -eq 'binary'){$taskParameter.Value=[Convert]::FromBase64String($taskValue.value)}
   elseif($taskValue.type -eq 'guid'){$taskParameter.Value=[guid]$taskValue.value}
   elseif($taskValue.type -eq 'datetime'){$taskParameter.Value=if($taskValue.value -is [datetime]){$taskValue.value}else{[datetime]::Parse($taskValue.value,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind)}}
   elseif($taskValue.type -eq 'bigint'){$taskParameter.Value=[long]$taskValue.value}
   elseif($taskValue.type -eq 'bit'){$taskParameter.Value=[bool]$taskValue.value}
   elseif($taskValue.type -eq 'int'){$taskParameter.Value=[int]$taskValue.value}
   else{$taskParameter.Value=$taskValue.value}
  }
  [Console]::Out.Write([string]$taskCommand.ExecuteScalar())
 }finally{$taskCommand.Dispose()}
}catch{
 $taskError=$_.Exception;while($null -ne $taskError.InnerException -and $taskError -isnot [Data.SqlClient.SqlException]){$taskError=$taskError.InnerException};$taskNumber=if($taskError -is [Data.SqlClient.SqlException]){$taskError.Number}else{0}
 [Console]::Out.Write((@{bridgeError=$true;number=$taskNumber;errorKind=$taskError.GetType().FullName}|ConvertTo-Json -Compress))
}finally{
 try{if($taskImpersonated){Invoke-GatePassNonQuery $taskConnection 'REVERT;'};if($taskCreated){Invoke-GatePassNonQuery $taskConnection "DROP USER [$taskPrincipal];"}}finally{$taskConnection.Dispose()}
}


