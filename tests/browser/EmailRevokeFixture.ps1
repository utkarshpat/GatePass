#Requires -Version 7.0
[CmdletBinding()]param([Parameter(Mandatory)][guid]$RunId,[ValidateSet('Create','Cleanup')][string]$Action)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $root 'tools/GatePass.LocalSql.psm1') -Force
$db=Open-GatePassLocalSql -TrustLocalServerCertificate
try{
 if($Action -eq 'Create'){
  $f=(Invoke-GatePassScalar $db (Get-Content (Join-Path $root 'database/tests/002_transaction_fixtures.sql') -Raw) @{RunId=$RunId})|ConvertFrom-Json;$visit=$f.visits.Where({$_.Label -eq 'PENDING'})[0]
  Invoke-GatePassScalar $db "SELECT LOWER(CONVERT(char(36),VisitRequestId)) visit,LOWER(CONVERT(varchar(64),SnapshotHash,2)) snapshot,LOWER(CONVERT(varchar(64),HASHBYTES('SHA2_256',LOWER(PersonEmail)),2)) emailHash,DATEDIFF_BIG(millisecond,'1970-01-01',DATEADD(day,1,ValidUntilUtc)) expires FROM gp.VisitRequests WHERE VisitRequestId=@id FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;" @{id=[guid]$visit.VisitId}
 }else{
  $prefix='GP02-'+$RunId.ToString('N').Substring(0,20)
  Invoke-GatePassNonQuery $db "DELETE gp.IdempotencyRequests WHERE OperationCode='EMAIL_REVOKE_PASS' AND ActorBindingHash IN(SELECT HASHBYTES('SHA2_256',CONVERT(binary(16),VisitRequestId)) FROM gp.VisitRequests WHERE PublicReference LIKE @prefix+'-%');" @{prefix=$prefix}
  Invoke-GatePassNonQuery $db (Get-Content (Join-Path $root 'database/tests/003_transaction_cleanup.sql') -Raw) @{RunId=$RunId}
 }
}finally{$db.Dispose()}
