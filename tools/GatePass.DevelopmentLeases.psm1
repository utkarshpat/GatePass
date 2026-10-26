#Requires -Version 7.0
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'GatePass.LocalSql.psm1')
$script:taskLeases=@{}
$script:taskRoles=@('gp_api_runtime','gp_worker_runtime','gp_staff_auth_runtime','gp_guard_auth_runtime','gp_render_runtime','gp_media_runtime')
function Enter-TaskMetadata($Connection){Invoke-GatePassNonQuery $Connection "DECLARE @r int;EXEC @r=sys.sp_getapplock @Resource=N'gp:development:principal-ddl',@LockMode='Exclusive',@LockOwner='Session',@LockTimeout=10000;IF @r<0 THROW 52901,'Development metadata gate unavailable.',1;"}
function Exit-TaskMetadata($Connection){Invoke-GatePassNonQuery $Connection "EXEC sys.sp_releaseapplock @Resource=N'gp:development:principal-ddl',@LockOwner='Session';"}
function Assert-TaskSynthetic($Connection){if((Invoke-GatePassScalar $Connection "SELECT COUNT(*) FROM sys.extended_properties WHERE class=0 AND name=N'GatePass.DevelopmentDirectoryMarker' AND CONVERT(nvarchar(100),value)=N'SYNTHETIC-DIRECTORY-V1';") -ne 1){throw 'Synthetic development database required.'}}
function Remove-TaskOrphans($Connection){
 # The principal is exclusively leased by its live SQL session, including idle
 # periods. A crashed worker releases that lease when its connection ends.
 $taskJson=Invoke-GatePassScalar $Connection @'
SELECT(SELECT p.name FROM sys.database_principals p JOIN sys.extended_properties e ON e.class=4 AND e.major_id=p.principal_id AND e.minor_id=0
 WHERE e.name=N'GatePass.DevelopmentRpcLease' AND CONVERT(nvarchar(64),e.value)=N'SYNTHETIC-RPC-LEASE-V1' AND p.type='S' AND p.authentication_type=0
 AND NOT EXISTS(SELECT 1 FROM sys.schemas s WHERE s.principal_id=p.principal_id)
 AND NOT EXISTS(SELECT 1 FROM sys.objects o WHERE o.principal_id=p.principal_id)
 AND(SELECT COUNT(*) FROM sys.database_role_members m WHERE m.member_principal_id=p.principal_id)=1
 AND EXISTS(SELECT 1 FROM sys.database_role_members m JOIN sys.database_principals r ON r.principal_id=m.role_principal_id WHERE m.member_principal_id=p.principal_id
 AND r.name IN('gp_api_runtime','gp_worker_runtime','gp_staff_auth_runtime','gp_guard_auth_runtime','gp_render_runtime','gp_media_runtime')) FOR JSON PATH);
'@
 foreach($taskRow in ($taskJson|ConvertFrom-Json)){
  $taskName=[string]$taskRow.name;if($taskName -notmatch '^gp_dev_rpc_[a-f0-9]{32}$'){continue}
  $taskResource='gp:development:rpc-lease:'+$taskName
  $taskLock=Invoke-GatePassScalar $Connection "DECLARE @r int;EXEC @r=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Session',@LockTimeout=0;SELECT @r;" @{resource=$taskResource}
  if($taskLock -ge 0){try{Invoke-GatePassNonQuery $Connection "DROP USER [$taskName];"}finally{Invoke-GatePassNonQuery $Connection "EXEC sys.sp_releaseapplock @Resource=@resource,@LockOwner='Session';" @{resource=$taskResource}}}
 }
}
function Get-GatePassDevelopmentLease([string]$Role){
 if($env:NODE_ENV -notin @('development','test') -or $env:GATEPASS_SSO_MODE -ne 'dummy' -or $env:GATEPASS_DIRECTORY_MODE -ne 'mock'){throw 'Explicit local dummy mode required.'}
 if($Role -notin $script:taskRoles){throw 'Development role not allowed.'}
 if($script:taskLeases.ContainsKey($Role)){
  $taskExisting=$script:taskLeases[$Role]
  if($taskExisting.Connection.State -eq [Data.ConnectionState]::Open){return $taskExisting}
  $taskExisting.Connection.Dispose();$script:taskLeases.Remove($Role)
 }
 $taskConnection=Open-GatePassLocalSql -TrustLocalServerCertificate
 try{
  Assert-TaskSynthetic $taskConnection;Enter-TaskMetadata $taskConnection
  try{
   Remove-TaskOrphans $taskConnection
   $taskPrincipal='gp_dev_rpc_'+[guid]::NewGuid().ToString('N')
   Invoke-GatePassNonQuery $taskConnection @"
BEGIN TRY
 BEGIN TRANSACTION;
 CREATE USER [$taskPrincipal] WITHOUT LOGIN;ALTER ROLE $Role ADD MEMBER [$taskPrincipal];
 EXEC sys.sp_addextendedproperty @name=N'GatePass.DevelopmentRpcLease',@value=N'SYNTHETIC-RPC-LEASE-V1',@level0type=N'USER',@level0name=N'$taskPrincipal';
 EXEC sys.sp_addextendedproperty @name=N'GatePass.DevelopmentRpcWorker',@value=@workerId,@level0type=N'USER',@level0name=N'$taskPrincipal';
 DECLARE @r int;EXEC @r=sys.sp_getapplock @Resource=@lease,@LockMode='Exclusive',@LockOwner='Session',@LockTimeout=10000;
 IF @r<0 THROW 52901,'Development principal lease unavailable.',1;
 COMMIT;
END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
"@ @{lease='gp:development:rpc-lease:'+$taskPrincipal;workerId=[int]$PID}
  }finally{Exit-TaskMetadata $taskConnection}
  $taskLease=@{Connection=$taskConnection;Principal=$taskPrincipal;Role=$Role}
  $script:taskLeases[$Role]=$taskLease;return $taskLease
 }catch{$taskConnection.Dispose();throw}
}
function Remove-GatePassDevelopmentLease([string]$Role){
 if($script:taskLeases.ContainsKey($Role)){$script:taskLeases[$Role].Connection.Dispose();$script:taskLeases.Remove($Role)}
}
function Close-GatePassDevelopmentLeases {
 if(-not $script:taskLeases.Count){return}
 foreach($taskLease in @($script:taskLeases.Values)){$taskLease.Connection.Dispose()};$script:taskLeases.Clear()
 $taskControl=Open-GatePassLocalSql -TrustLocalServerCertificate
 try{Assert-TaskSynthetic $taskControl;Enter-TaskMetadata $taskControl;try{Remove-TaskOrphans $taskControl}finally{Exit-TaskMetadata $taskControl}}finally{$taskControl.Dispose()}
}
Export-ModuleMember -Function Get-GatePassDevelopmentLease,Remove-GatePassDevelopmentLease,Close-GatePassDevelopmentLeases
