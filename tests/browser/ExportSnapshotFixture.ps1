#Requires -Version 7.0
[CmdletBinding()]param([Parameter(Mandatory)][guid]$RunId,[ValidateSet('Create','Inspect','Cleanup')][string]$Action)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot);Import-Module (Join-Path $taskRoot 'tools/GatePass.LocalSql.psm1') -Force
$taskPrefix='GP02-'+$RunId.ToString('N').Substring(0,20).ToUpperInvariant()
if($Action -eq 'Create'){$taskFixture=(& (Join-Path $PSScriptRoot 'WorkspaceQueueFixture.ps1') -RunId $RunId -Action Create)|ConvertFrom-Json}
$taskDb=Open-GatePassLocalSql -TrustLocalServerCertificate
try{
 if($Action -eq 'Create'){
  Invoke-GatePassNonQuery $taskDb "INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT g.RoleGrantId,'REPORTS_EXPORT' FROM gp.StaffRoleGrants g JOIN gp.Users u ON u.UserId=g.UserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject=@subject AND g.RoleCode='LOCATION_ADMIN' AND NOT EXISTS(SELECT 1 FROM gp.GrantCapabilities c WHERE c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='REPORTS_EXPORT');" @{subject=$taskPrefix+':ADMIN'}
  $taskFixture|ConvertTo-Json -Compress
 }elseif($Action -eq 'Inspect'){
  Invoke-GatePassScalar $taskDb "SELECT(SELECT COUNT(*) snapshots FROM gp.AdminExportSnapshots x JOIN gp.Sessions s ON s.SessionHash=x.OwnerSessionHash JOIN gp.Users u ON u.UserId=s.UserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject LIKE @prefix+':%' FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);" @{prefix=$taskPrefix}
 }else{Invoke-GatePassNonQuery $taskDb "DELETE x FROM gp.AdminExportSnapshots x JOIN gp.Sessions s ON s.SessionHash=x.OwnerSessionHash JOIN gp.Users u ON u.UserId=s.UserId WHERE u.IdentityIssuer='gatepass-phase02-fixture' AND u.IdentitySubject LIKE @prefix+':%';" @{prefix=$taskPrefix}}
}finally{$taskDb.Dispose()}
if($Action -eq 'Cleanup'){$null=& (Join-Path $PSScriptRoot 'WorkspaceQueueFixture.ps1') -RunId $RunId -Action Cleanup}
