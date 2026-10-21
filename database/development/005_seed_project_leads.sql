/* Project lead roles are mapped to existing active directory employees. */
SET NOCOUNT ON;SET XACT_ABORT ON;
IF DB_NAME()<>N'GatePass_DesignTest' OR @@TRANCOUNT<>0 OR NOT EXISTS(SELECT 1 FROM sys.extended_properties WHERE class=0 AND name=N'GatePass.DevelopmentDirectoryMarker' AND CONVERT(nvarchar(100),value)=N'SYNTHETIC-DIRECTORY-V1') THROW 53600,'Dedicated synthetic database required.',1;
DECLARE @leads table(EmployeeId nvarchar(64) NOT NULL UNIQUE,ProjectCode varchar(64) NOT NULL PRIMARY KEY);
INSERT @leads SELECT EmployeeId,ProjectCode FROM OPENJSON(@Fixtures) WITH(EmployeeId nvarchar(64) '$.employeeId',ProjectCode varchar(64) '$.projectCode');
IF (SELECT COUNT(*) FROM @leads)<>6 THROW 53600,'Six explicit project leads required.',1;
BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
 DECLARE @actor uniqueidentifier=(SELECT UserId FROM gp.Users WHERE IdentityIssuer=N'urn:gatepass:development-directory' AND IdentitySubject=N'local-seed'),@now datetime2(3)=SYSUTCDATETIME();
 IF @actor IS NULL OR EXISTS(SELECT 1 FROM @leads x LEFT JOIN gp.Employees e ON e.EmployeeId=x.EmployeeId LEFT JOIN gp.Users u ON u.UserId=e.UserId LEFT JOIN gp.Projects p ON p.ExternalProjectCode=x.ProjectCode LEFT JOIN gp.EmployeeProjectMemberships m ON m.EmployeeId=e.EmployeeId AND m.ProjectId=p.ProjectId WHERE e.EmployeeId IS NULL OR u.IdentityIssuer<>N'urn:gatepass:development-directory' OR e.IsActive<>1 OR u.IsActive<>1 OR p.ProjectId IS NULL OR p.IsActive<>1 OR m.EmployeeId IS NULL OR m.IsActive<>1) THROW 53600,'Lead must be an existing active employee assigned to that project.',1;
 DECLARE @new table(RoleGrantId bigint,UserId uniqueidentifier);
 INSERT gp.StaffRoleGrants(UserId,RoleCode,ScopeType,ProjectId,GrantedByUserId,ValidFromUtc)
 OUTPUT inserted.RoleGrantId,inserted.UserId INTO @new
 SELECT e.UserId,'PROJECT_ADMIN','PROJECT',p.ProjectId,@actor,@now FROM @leads x JOIN gp.Employees e ON e.EmployeeId=x.EmployeeId JOIN gp.Projects p ON p.ExternalProjectCode=x.ProjectCode WHERE NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants g WHERE g.UserId=e.UserId AND g.RoleCode='PROJECT_ADMIN' AND g.ScopeType='PROJECT' AND g.ProjectId=p.ProjectId);
 INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT n.RoleGrantId,c.Code FROM @new n CROSS JOIN(VALUES('VISITS_READ'),('GUARDS_MANAGE'),('REPORTS_READ'),('REPORTS_EXPORT'),('AUDIT_READ'),('ROLE_GRANTS_MANAGE'))c(Code);
 UPDATE u SET AuthorizationVersion=AuthorizationVersion+1 FROM gp.Users u WHERE EXISTS(SELECT 1 FROM @new n WHERE n.UserId=u.UserId);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode) SELECT @actor,'DEV_PROJECT_LEAD_SEEDED','USER',CONVERT(nvarchar(36),UserId),'SUCCESS' FROM @new;
 -- Retire only the obsolete local project-admin fixtures created before the SSO clarification.
 DECLARE @retired table(UserId uniqueidentifier PRIMARY KEY);
 UPDATE s SET IsActive=0 OUTPUT inserted.UserId INTO @retired FROM gp.StaffProfiles s JOIN gp.Users u ON u.UserId=s.UserId WHERE u.IdentityIssuer=N'urn:gatepass:development-staff' AND s.StaffCode IN('ADM006','ADM007','ADM008','ADM009','ADM010','ADM011') AND s.IsActive=1;
 UPDATE c SET IsEnabled=0,CredentialVersion=CredentialVersion+1 FROM gp.StaffLocalCredentials c WHERE EXISTS(SELECT 1 FROM @retired r WHERE r.UserId=c.UserId);
 UPDATE u SET IsActive=0,AuthorizationVersion=AuthorizationVersion+1 FROM gp.Users u WHERE EXISTS(SELECT 1 FROM @retired r WHERE r.UserId=u.UserId);
 UPDATE g SET RevokedAtUtc=@now,RevokedByUserId=@actor FROM gp.StaffRoleGrants g WHERE g.RevokedAtUtc IS NULL AND EXISTS(SELECT 1 FROM @retired r WHERE r.UserId=g.UserId);
 UPDATE s SET RevokedAtUtc=@now FROM gp.Sessions s WHERE s.RevokedAtUtc IS NULL AND EXISTS(SELECT 1 FROM @retired r WHERE r.UserId=s.UserId);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode) SELECT @actor,'DEV_LOCAL_LEAD_RETIRED','USER',CONVERT(nvarchar(36),UserId),'SUCCESS' FROM @retired;
 COMMIT;SELECT N'{"status":"PASS","projectLeads":6}';
END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
