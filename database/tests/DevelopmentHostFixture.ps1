#Requires -Version 7.0
param([Parameter(Mandatory)][guid]$RunId,[Parameter(Mandatory)][ValidateSet('Create','Cleanup')][string]$Action)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $root 'tools/GatePass.LocalSql.psm1') -Force
$db=Open-GatePassLocalSql -TrustLocalServerCertificate
try{Invoke-GatePassNonQuery $db @'
SET XACT_ABORT ON;
IF DB_NAME()<>'GatePass_DesignTest' AND NOT(DB_NAME() LIKE 'GatePass[_]Verification[_]%' AND EXISTS(SELECT 1 FROM sys.extended_properties WHERE name='GatePass.DisposableVerification' AND CONVERT(nvarchar(100),value)=DB_NAME())) THROW 52900,'Dedicated test database required.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
DECLARE @owner uniqueidentifier=(SELECT UserId FROM gp.Users WHERE IdentityIssuer='gatepass-owned-host-test' AND IdentitySubject=CONVERT(varchar(36),@run));
IF @action='Cleanup' BEGIN
 DELETE gp.AccountHosts WHERE ChangedByUserId=@owner;
 DELETE gp.Users WHERE UserId=@owner;
END ELSE BEGIN
 IF @owner IS NOT NULL THROW 52900,'Fixture already exists.',1;
 SET @owner=NEWID();INSERT gp.Users(UserId,IdentityIssuer,IdentitySubject,DisplayName,IsActive) VALUES(@owner,'gatepass-owned-host-test',CONVERT(varchar(36),@run),N'Owned HTTP test host administrator',1);
 IF EXISTS(SELECT 1 FROM gp.AccountHosts h JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=h.ProjectLocationId JOIN gp.Locations l ON l.LocationId=pl.LocationId WHERE h.EmployeeId IN('EMP001','EMP002','EMP003') AND l.LocationCode='NOIDA' AND h.IsActive=0) THROW 52900,'Preserve an explicitly removed test host; choose unused synthetic data.',1;
 INSERT gp.AccountHosts(ProjectLocationId,EmployeeId,IsActive,ChangedByUserId,ChangedAtUtc,Reason)
 SELECT m.ProjectLocationId,m.EmployeeId,1,@owner,SYSUTCDATETIME(),N'Explicit temporary HTTP test host approval'
 FROM gp.EmployeeProjectLocationMemberships m JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=m.ProjectLocationId JOIN gp.Projects p ON p.ProjectId=pl.ProjectId JOIN gp.Locations l ON l.LocationId=pl.LocationId
 WHERE m.EmployeeId IN('EMP001','EMP002','EMP003') AND m.IsActive=1 AND l.LocationCode='NOIDA' AND p.ExternalProjectCode IN('DEMO-PRJ-001','DEMO-PRJ-002','DEMO-PRJ-003')
 AND NOT EXISTS(SELECT 1 FROM gp.AccountHosts h WHERE h.EmployeeId=m.EmployeeId AND h.ProjectLocationId=m.ProjectLocationId);
END;COMMIT;
'@ @{run=$RunId;action=$Action}}finally{$db.Dispose()}
