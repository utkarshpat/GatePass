/* Explicit synthetic reception identities; reruns never restore removed capabilities/grants. */
SET NOCOUNT ON;SET XACT_ABORT ON;
IF NOT EXISTS(SELECT 1 FROM sys.extended_properties WHERE class=0 AND name=N'GatePass.DevelopmentDirectoryMarker' AND CONVERT(nvarchar(100),value)=N'SYNTHETIC-DIRECTORY-V1') THROW 53500,'Synthetic database required.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
DECLARE @actor uniqueidentifier=(SELECT UserId FROM gp.Users WHERE IdentityIssuer=N'urn:gatepass:development-directory' AND IdentitySubject=N'local-seed'),@now datetime2(3)=SYSUTCDATETIME();
DECLARE @staff table(EmployeeId nvarchar(64),LocationCode varchar(16));
INSERT @staff VALUES('EMP021','NOIDA'),('EMP022','BENGALURU'),('EMP023','CHENNAI'),('EMP024','PUNE');
DECLARE @new table(RoleGrantId bigint);
INSERT gp.StaffRoleGrants(UserId,RoleCode,ScopeType,LocationId,GrantedByUserId,ValidFromUtc)
OUTPUT inserted.RoleGrantId INTO @new
SELECT e.UserId,'RECEPTION','LOCATION',l.LocationId,@actor,@now FROM @staff s JOIN gp.Employees e ON e.EmployeeId=s.EmployeeId JOIN gp.Locations l ON l.LocationCode=s.LocationCode
WHERE NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants g WHERE g.UserId=e.UserId AND g.RoleCode='RECEPTION' AND g.LocationId=l.LocationId AND g.ScopeType='LOCATION');
INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT n.RoleGrantId,c.CapabilityCode FROM @new n CROSS JOIN(VALUES('VISITS_READ'),('PASS_PRINT'))c(CapabilityCode);
INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,ResultCode) SELECT @actor,'DEVELOPMENT_RECEPTION_SEEDED','DEVELOPMENT_FIXTURE','SUCCESS' WHERE EXISTS(SELECT 1 FROM @new);
COMMIT;
