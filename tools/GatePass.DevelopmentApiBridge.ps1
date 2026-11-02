#Requires -Version 7.0
# Development-only RPC transport; one leased execute-only connection per role/worker.
param([switch]$Persistent)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
if($env:NODE_ENV -notin @('development','test') -or $env:GATEPASS_SSO_MODE -ne 'dummy' -or $env:GATEPASS_DIRECTORY_MODE -ne 'mock'){throw 'Explicit local dummy mode required.'}
Import-Module (Join-Path $PSScriptRoot 'GatePass.LocalSql.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'GatePass.DevelopmentLeases.psm1') -Force
# Principal DDL invalidates SQL's permission cache. Keep it outside concurrent
# execute-only calls; shared calls still run together. Session ownership releases
# the gate even if this disposable connection is interrupted.
function Enter-DevelopmentGate($Connection,[string]$Mode){
 Invoke-GatePassNonQuery $Connection "DECLARE @r int;EXEC @r=sys.sp_getapplock @Resource=N'gp:development:principal-ddl',@LockMode=@mode,@LockOwner='Session',@LockTimeout=10000;IF @r<0 THROW 52901,'Development principal gate unavailable.',1;" @{mode=$Mode}
}
function Exit-DevelopmentGate($Connection){Invoke-GatePassNonQuery $Connection "EXEC sys.sp_releaseapplock @Resource=N'gp:development:principal-ddl',@LockOwner='Session';"}
function Invoke-DevelopmentCall($taskInput) {
$taskProfile=$env:NODE_ENV -eq 'test' -and $env:GATEPASS_LOAD_DIAGNOSTICS -eq '1';$script:taskTiming=$null
$taskWatch=[Diagnostics.Stopwatch]::StartNew()
$taskConnection=$null;$taskConnected=0;$taskImpersonated=$false;$taskGate=$false;$taskRole=$null;$taskDiscard=$false
try{
 if($taskInput.procedure -notin @('gp.ClaimPlanningNotifications','gp.GetPlanningNotification','gp.RenewPlanningNotificationLease','gp.CompletePlanningNotification','gp.PreviewPlanningNotifications','gp.ReadVisitCoordination','gp.ManageVisitPlanning','gp.CreatePlannedVisit','gp.ChangePlannedVisit','gp.ReadAccountHosts','gp.ManageAccountHost','gp.GetAdminProjectGroups','gp.ManageProjectGroup','gp.ManageProjectGroupGuard','gp.DecideVisit','gp.ReadEmailRequest','gp.RevokeEmailRequest','gp.CancelVisit','gp.GetEmployeeRequestCard','gp.GetEmailRequestCard','gp.GetPublicRegistrationCard','gp.ClaimNotifications','gp.GetNotificationEmail','gp.ResolveNotificationPhoto','gp.RenewNotificationLease','gp.CompleteNotification','gp.CreateRegistrationIntake','gp.RecordRegistrationPhoto','gp.SubmitRegistration','gp.ListRegistrationLocations','gp.GetRegistrationOptions','gp.GetVisitDetail','gp.GetOwnDigitalIdCard','gp.GetStaffAccessContext','gp.ManageStaffCredential','gp.ReadAdminVisitRegister','gp.GetAdminConsoleScope','gp.ListAdminGuardAssignments','gp.ListAdminProjectLocations','gp.ListAdminGuards','gp.SearchStaffSubjects','gp.ListStaffRoles','gp.GetOperationalSummary','gp.GetOperationalSummaryRange','gp.ReadGuardQueue','gp.ReadReceptionQueue','gp.ReadActionCentre','gp.RemindPendingApproval','gp.ListScopedAuditEvents','gp.AllocateGuard','gp.DeallocateGuard','gp.CreateScopedProject','gp.GetAdminWorkspaceContext','gp.GetGuardWorkspaceContext','gp.ListGuardDuties','gp.ReadGuardDutyPass','gp.ListGuardDutyVisitors','gp.RecordGuardDutyMovement','gp.GetCommonDutyAdministration','gp.ManageCommonDuty','gp.FindGuardPass','gp.ListGuardVisitors','gp.ListGuardRecentScans','gp.ListGuardWorkContexts','gp.ListVisits','gp.VerifyGuardPass','gp.RecordMovement','gp.ListLeadProjects','gp.SearchProjectLeadCandidates','gp.ListProjectHeads','gp.GrantStaffRole','gp.RevokeStaffRole','gp.BeginGuardLogin','gp.CompleteGuardLogin','gp.TouchGuardSession','gp.RevokeGuardSession','gp.ResolveStaffLoginIdentity','gp.BeginStaffLogin','gp.CompleteStaffLogin','gp.TouchStaffSession','gp.RevokeStaffSession','gp.InspectStaffSetup','gp.CompleteStaffSetup','gp.RemindVisitHost','gp.GetReceptionEmployeeTimeline','gp.AuditReceptionRegistration','gp.LookupReceptionVisits','gp.CorrectReceptionReturn','gp.CreateLocalStaffAccount','gp.ReissueLocalStaffSetup','gp.ReturnReceptionPass','gp.GetReceptionContext','gp.ListReceptionVisits','gp.RequestPassPrint','gp.GetPassPrintJob','gp.GetReceptionCardSource','gp.BeginPassRender','gp.FinishPassRender','gp.DispatchPassPrint','gp.FailPassPrint','gp.ResolveVisitPhoto','gp.ReadGuardPhotoSource')){throw 'Procedure not allowed.'}
 $taskRole=if($taskInput.procedure -in @('gp.ClaimPlanningNotifications','gp.GetPlanningNotification','gp.RenewPlanningNotificationLease','gp.CompletePlanningNotification','gp.PreviewPlanningNotifications','gp.ClaimNotifications','gp.GetNotificationEmail','gp.ResolveNotificationPhoto','gp.RenewNotificationLease','gp.CompleteNotification')){'gp_worker_runtime'}elseif($taskInput.procedure -in @('gp.ResolveStaffLoginIdentity','gp.BeginStaffLogin','gp.CompleteStaffLogin','gp.TouchStaffSession','gp.RevokeStaffSession','gp.InspectStaffSetup','gp.CompleteStaffSetup')){'gp_staff_auth_runtime'}elseif($taskInput.procedure -in @('gp.BeginGuardLogin','gp.CompleteGuardLogin','gp.TouchGuardSession','gp.RevokeGuardSession')){'gp_guard_auth_runtime'}elseif($taskInput.procedure -in @('gp.GetEmployeeRequestCard','gp.GetEmailRequestCard','gp.GetPublicRegistrationCard','gp.GetOwnDigitalIdCard','gp.GetReceptionCardSource','gp.BeginPassRender','gp.FinishPassRender','gp.DispatchPassPrint','gp.FailPassPrint')){'gp_render_runtime'}elseif($taskInput.procedure -in @('gp.ResolveVisitPhoto','gp.ReadGuardPhotoSource')){'gp_media_runtime'}else{'gp_api_runtime'}
 $taskLease=Get-GatePassDevelopmentLease $taskRole;$taskConnection=$taskLease.Connection;$taskPrincipal=$taskLease.Principal
 $taskConnected=$taskWatch.Elapsed.TotalMilliseconds
 Enter-DevelopmentGate $taskConnection 'Shared';$taskGate=$true
 if((Invoke-GatePassScalar $taskConnection "SELECT COUNT(*) FROM sys.extended_properties WHERE class=0 AND name=N'GatePass.DevelopmentDirectoryMarker' AND CONVERT(nvarchar(100),value)=N'SYNTHETIC-DIRECTORY-V1'") -ne 1){throw 'Synthetic development database required.'}
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
  $taskPrepared=$taskWatch.Elapsed.TotalMilliseconds
  try{return [string]$taskCommand.ExecuteScalar()}finally{$taskExecuted=$taskWatch.Elapsed.TotalMilliseconds}
 }finally{$taskCommand.Dispose()}
}catch{
 $taskError=$_.Exception;while($null -ne $taskError.InnerException -and $taskError -isnot [Data.SqlClient.SqlException]){$taskError=$taskError.InnerException};$taskNumber=if($taskError -is [Data.SqlClient.SqlException]){$taskError.Number}else{0}
 return (@{bridgeError=$true;number=$taskNumber;errorKind=$taskError.GetType().FullName}|ConvertTo-Json -Compress)
}finally{
 # A cleanup fault must not replay or disguise a committed result. Discard the
 # role connection; its released lease permits safe collection on next startup.
 if($taskConnection){
  try{if($taskImpersonated){Invoke-GatePassNonQuery $taskConnection 'REVERT;'}
   if((Invoke-GatePassScalar $taskConnection 'SELECT @@TRANCOUNT;') -ne 0){Invoke-GatePassNonQuery $taskConnection 'ROLLBACK;';$taskDiscard=$true}
   if($taskGate){Exit-DevelopmentGate $taskConnection}
  }catch{$taskDiscard=$true}
  if($taskDiscard -or $taskConnection.State -ne [Data.ConnectionState]::Open){Remove-GatePassDevelopmentLease $taskRole}
 }
 if($taskProfile -and (Test-Path variable:taskExecuted)){$script:taskTiming=@{connectMs=$taskConnected;setupMs=$taskPrepared-$taskConnected;executeMs=$taskExecuted-$taskPrepared;cleanupMs=$taskWatch.Elapsed.TotalMilliseconds-$taskExecuted;totalMs=$taskWatch.Elapsed.TotalMilliseconds}}
}



}
try{
if($Persistent){
 while($null -ne ($taskLine=[Console]::In.ReadLine())){
  if($taskLine.Length -gt 2097152){throw 'RPC input too large.'}
  try{
   $taskInput=$taskLine|ConvertFrom-Json
   $script:taskTiming=$null
   if(@($taskInput.PSObject.Properties.Name).Count -eq 1 -and $taskInput.PSObject.Properties['warmup'] -and $taskInput.warmup -is [bool] -and $taskInput.warmup){
    # Private stdio readiness control: load the provider, open no SQL connection,
    # create no principal, and run no stored procedure or authorization cache.
    Add-Type -AssemblyName System.Data.SqlClient
    $taskResult='{"ready":true}'
   }else{$taskResult=Invoke-DevelopmentCall $taskInput}
   $taskPacket=@{result=[string]$taskResult};if($null -ne $script:taskTiming){$taskPacket.timing=$script:taskTiming}
   [Console]::Out.WriteLine(($taskPacket|ConvertTo-Json -Compress -Depth 3));[Console]::Out.Flush()
  }finally{$taskResult=$null;$taskInput=$null;$taskLine=$null}
 }
}else{[Console]::Out.Write((Invoke-DevelopmentCall ([Console]::In.ReadToEnd()|ConvertFrom-Json)))}

}finally{try{Close-GatePassDevelopmentLeases}catch{[Console]::Error.WriteLine('DEVELOPMENT_RPC_CLEANUP_PENDING')}}
