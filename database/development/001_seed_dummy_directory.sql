/* Explicit local-development DATA seed, not a production schema migration.
   @Directory/@Staff are normalized, parameterized JSON from the development
   adapter. Real SSO sessions, SQL logins, passwords, visits and mail are absent.
   Repeat execution refreshes directory cache; revoked grants/allocations stay revoked. */
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME()<>N'GatePass_DesignTest' OR @@TRANCOUNT<>0 THROW 52910,'Dedicated local test database required.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='005') THROW 52910,'Apply reviewed migrations 001-005 first.',1;
IF @Directory IS NULL OR ISJSON(@Directory)<>1 OR COALESCE(JSON_VALUE(@Directory,'$.schemaVersion'),'')<>'1'
 OR @Staff IS NULL OR ISJSON(@Staff)<>1 OR COALESCE(JSON_VALUE(@Staff,'$.developmentOnly'),'')<>'true'
 THROW 52910,'Explicit development fixture data required.',1;
DECLARE @employees table(EmployeeId nvarchar(64) PRIMARY KEY,FullName nvarchar(200),OfficialEmail nvarchar(320),ManagerId nvarchar(64),IsActive bit,Projects nvarchar(max),Offices nvarchar(max),Assignments nvarchar(max),PrimaryOffice varchar(16));
DECLARE @projects table(ProjectCode nvarchar(80) PRIMARY KEY,ProjectName nvarchar(200),IsActive bit,Locations nvarchar(max));
DECLARE @guards table(GuardId nvarchar(64) PRIMARY KEY,DisplayName nvarchar(200),LocationCode varchar(16),Capabilities nvarchar(max),Projects nvarchar(max),Areas nvarchar(max));
INSERT @employees SELECT * FROM OPENJSON(@Directory,'$.employees') WITH(
 EmployeeId nvarchar(64) '$.employeeId',FullName nvarchar(200) '$.displayName',OfficialEmail nvarchar(320) '$.officialEmail',
 ManagerId nvarchar(64) '$.managerEmployeeId',IsActive bit '$.isActive',Projects nvarchar(max) '$.projectCodes' AS JSON,Offices nvarchar(max) '$.locationCodes' AS JSON,Assignments nvarchar(max) '$.projectLocations' AS JSON,PrimaryOffice varchar(16) '$.primaryOfficeLocationCode');
INSERT @projects SELECT * FROM OPENJSON(@Directory,'$.projects') WITH(
 ProjectCode nvarchar(80) '$.projectCode',ProjectName nvarchar(200) '$.projectName',IsActive bit '$.isActive',Locations nvarchar(max) '$.locationCodes' AS JSON);
INSERT @guards SELECT * FROM OPENJSON(@Staff,'$.guards') WITH(
 GuardId nvarchar(64) '$.guardId',DisplayName nvarchar(200) '$.displayName',LocationCode varchar(16) '$.locationCode',
 Capabilities nvarchar(max) '$.capabilities' AS JSON,Projects nvarchar(max) '$.projectCodes' AS JSON,Areas nvarchar(max) '$.commonAreas' AS JSON);
IF NOT EXISTS(SELECT 1 FROM @employees) OR NOT EXISTS(SELECT 1 FROM @projects) OR NOT EXISTS(SELECT 1 FROM @guards)
 THROW 52910,'Development seed lists cannot be empty.',1;
IF EXISTS(SELECT 1 FROM @employees WHERE EmployeeId COLLATE Latin1_General_100_BIN2 NOT LIKE N'EMP[0-9][0-9][0-9]' OR OfficialEmail NOT LIKE N'%@example.com'
 OR FullName IS NULL OR IsActive IS NULL OR Projects IS NULL OR Offices IS NULL OR Assignments IS NULL)
 OR EXISTS(SELECT 1 FROM @projects WHERE ProjectCode COLLATE Latin1_General_100_BIN2 NOT LIKE N'DEMO-PRJ-[0-9][0-9][0-9]' OR ProjectName IS NULL OR IsActive IS NULL OR Locations IS NULL)
 OR EXISTS(SELECT 1 FROM @guards WHERE GuardId COLLATE Latin1_General_100_BIN2 NOT LIKE N'GRD[0-9][0-9][0-9]' OR DisplayName IS NULL OR Capabilities IS NULL OR Projects IS NULL)
 THROW 52910,'Only labeled synthetic development records are accepted.',1;
IF EXISTS(SELECT 1 FROM @employees e WHERE e.ManagerId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM @employees m WHERE m.EmployeeId=e.ManagerId))
 OR EXISTS(SELECT 1 FROM @employees e CROSS APPLY OPENJSON(e.Projects) p WHERE NOT EXISTS(SELECT 1 FROM @projects x WHERE x.ProjectCode=p.value))
 OR EXISTS(SELECT 1 FROM @projects p CROSS APPLY OPENJSON(p.Locations) l WHERE NOT EXISTS(SELECT 1 FROM gp.Locations x WHERE x.LocationCode=l.value))
 OR EXISTS(SELECT 1 FROM @guards g WHERE NOT EXISTS(SELECT 1 FROM gp.Locations l WHERE l.LocationCode=g.LocationCode))
 OR EXISTS(SELECT 1 FROM @guards g CROSS APPLY OPENJSON(g.Capabilities) c WHERE c.value NOT IN('VISITS_READ','PROJECT_MOVEMENT','TEMP_ID_MOVEMENT','RECONCILE_EXIT'))
 OR EXISTS(SELECT 1 FROM @guards g CROSS APPLY OPENJSON(g.Projects) pc WHERE NOT EXISTS(
    SELECT 1 FROM @projects p CROSS APPLY OPENJSON(p.Locations) l WHERE p.ProjectCode=pc.value AND l.value=g.LocationCode))
 THROW 52910,'Invalid synthetic directory/staff relationships.',1;
IF EXISTS(SELECT 1 FROM @employees e WHERE e.PrimaryOffice IS NULL OR NOT EXISTS(SELECT 1 FROM OPENJSON(e.Offices) x WHERE x.value=e.PrimaryOffice)) THROW 52910,'Explicit assigned primary office required.',1;
DECLARE @issuer nvarchar(200)=N'urn:gatepass:development-directory',@now datetime2(3)=SYSUTCDATETIME(),@seedActor uniqueidentifier;
BEGIN TRY
 BEGIN TRANSACTION;
 EXEC gp._TakeLock N'gp:authorization','Exclusive';
 IF EXISTS(SELECT 1 FROM gp.Employees e JOIN @employees d ON d.EmployeeId=e.EmployeeId
    LEFT JOIN gp.Users u ON u.UserId=e.UserId
    WHERE u.UserId IS NULL OR u.IdentityIssuer<>@issuer OR u.IdentitySubject<>(N'employee:'+e.EmployeeId) COLLATE Latin1_General_100_BIN2)
    THROW 52910,'Employee ID collides with data outside the development directory.',1;
 IF EXISTS(SELECT 1 FROM gp.Projects p JOIN @projects d ON d.ProjectCode=p.ExternalProjectCode)
    AND NOT EXISTS(SELECT 1 FROM sys.extended_properties WHERE class=0 AND name=N'GatePass.DevelopmentDirectoryMarker' AND CONVERT(nvarchar(100),value)=N'SYNTHETIC-DIRECTORY-V1')
    THROW 52910,'Project IDs already exist without development ownership marker.',1;
 IF NOT EXISTS(SELECT 1 FROM gp.Users WHERE IdentityIssuer=@issuer AND IdentitySubject=N'local-seed')
    INSERT gp.Users(IdentityIssuer,IdentitySubject,DisplayName,IsActive) VALUES(@issuer,N'local-seed',N'Local Seed (development only)',0);
 SELECT @seedActor=UserId FROM gp.Users WHERE IdentityIssuer=@issuer AND IdentitySubject=N'local-seed';
 INSERT gp.Users(IdentityIssuer,IdentitySubject,DisplayName,IsActive)
 SELECT @issuer,N'employee:'+e.EmployeeId,e.FullName,e.IsActive FROM @employees e
 WHERE NOT EXISTS(SELECT 1 FROM gp.Users u WHERE u.IdentityIssuer=@issuer AND u.IdentitySubject=(N'employee:'+e.EmployeeId) COLLATE Latin1_General_100_BIN2);
 INSERT gp.Users(IdentityIssuer,IdentitySubject,DisplayName)
 SELECT @issuer,N'guard:'+g.GuardId,g.DisplayName FROM @guards g
 WHERE NOT EXISTS(SELECT 1 FROM gp.Users u WHERE u.IdentityIssuer=@issuer AND u.IdentitySubject=(N'guard:'+g.GuardId) COLLATE Latin1_General_100_BIN2);
 -- Never reactivate an existing application account or recreate its sessions.
 UPDATE e SET FullName=d.FullName,OfficialEmail=d.OfficialEmail,ManagerEmployeeId=d.ManagerId,IsActive=d.IsActive,LastSyncedAtUtc=@now
 FROM gp.Employees e JOIN @employees d ON d.EmployeeId=e.EmployeeId;
 INSERT gp.Employees(EmployeeId,UserId,FullName,OfficialEmail,ManagerEmployeeId,IsActive,LastSyncedAtUtc)
 SELECT e.EmployeeId,u.UserId,e.FullName,e.OfficialEmail,e.ManagerId,e.IsActive,@now FROM @employees e
 JOIN gp.Users u ON u.IdentityIssuer=@issuer AND u.IdentitySubject=(N'employee:'+e.EmployeeId) COLLATE Latin1_General_100_BIN2
 WHERE NOT EXISTS(SELECT 1 FROM gp.Employees x WHERE x.EmployeeId=e.EmployeeId);
 UPDATE p SET ProjectName=d.ProjectName,IsActive=d.IsActive,LastSyncedAtUtc=@now
 FROM gp.Projects p JOIN @projects d ON d.ProjectCode=p.ExternalProjectCode;
 INSERT gp.Projects(ExternalProjectCode,ProjectName,IsActive,LastSyncedAtUtc)
 SELECT p.ProjectCode,p.ProjectName,p.IsActive,@now FROM @projects p
 WHERE NOT EXISTS(SELECT 1 FROM gp.Projects x WHERE x.ExternalProjectCode=p.ProjectCode);
 UPDATE pl SET IsActive=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(d.Locations) l WHERE l.value=loc.LocationCode) THEN 1 ELSE 0 END
 FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId
 JOIN @projects d ON d.ProjectCode=p.ExternalProjectCode JOIN gp.Locations loc ON loc.LocationId=pl.LocationId;
 INSERT gp.ProjectLocations(ProjectId,LocationId)
 SELECT p.ProjectId,loc.LocationId FROM @projects d CROSS APPLY OPENJSON(d.Locations) l
 JOIN gp.Projects p ON p.ExternalProjectCode=d.ProjectCode JOIN gp.Locations loc ON loc.LocationCode=l.value
 WHERE NOT EXISTS(SELECT 1 FROM gp.ProjectLocations x WHERE x.ProjectId=p.ProjectId AND x.LocationId=loc.LocationId);
 UPDATE m SET IsActive=CASE WHEN EXISTS(SELECT 1 FROM OPENJSON(e.Projects) x WHERE x.value=p.ExternalProjectCode) THEN 1 ELSE 0 END,VerifiedAtUtc=@now
 FROM gp.EmployeeProjectMemberships m JOIN @employees e ON e.EmployeeId=m.EmployeeId JOIN gp.Projects p ON p.ProjectId=m.ProjectId;
 INSERT gp.EmployeeProjectMemberships(EmployeeId,ProjectId,IsActive,VerifiedAtUtc)
 SELECT e.EmployeeId,p.ProjectId,1,@now FROM @employees e CROSS APPLY OPENJSON(e.Projects) pc JOIN gp.Projects p ON p.ExternalProjectCode=pc.value
 WHERE NOT EXISTS(SELECT 1 FROM gp.EmployeeProjectMemberships m WHERE m.EmployeeId=e.EmployeeId AND m.ProjectId=p.ProjectId);
 UPDATE m SET IsPrimary=0 FROM gp.EmployeeOfficeMemberships m JOIN @employees e ON e.EmployeeId=m.EmployeeId;
 UPDATE m SET IsPrimary=CASE WHEN l.LocationCode=e.PrimaryOffice THEN 1 ELSE 0 END,IsActive=CASE WHEN e.IsActive=1 AND EXISTS(SELECT 1 FROM OPENJSON(e.Offices) x WHERE x.value=l.LocationCode) THEN 1 ELSE 0 END,VerifiedAtUtc=@now
 FROM gp.EmployeeOfficeMemberships m JOIN @employees e ON e.EmployeeId=m.EmployeeId JOIN gp.Locations l ON l.LocationId=m.LocationId;
 INSERT gp.EmployeeOfficeMemberships(EmployeeId,LocationId,IsActive,VerifiedAtUtc,IsPrimary)
 SELECT e.EmployeeId,l.LocationId,e.IsActive,@now,CASE WHEN l.LocationCode=e.PrimaryOffice THEN 1 ELSE 0 END FROM @employees e CROSS APPLY OPENJSON(e.Offices) x JOIN gp.Locations l ON l.LocationCode=x.value
 WHERE NOT EXISTS(SELECT 1 FROM gp.EmployeeOfficeMemberships m WHERE m.EmployeeId=e.EmployeeId AND m.LocationId=l.LocationId);
 UPDATE m SET IsActive=CASE WHEN e.IsActive=1 AND EXISTS(SELECT 1 FROM OPENJSON(e.Assignments) WITH(projectCode nvarchar(80),locationCode varchar(16)) x WHERE x.projectCode=p.ExternalProjectCode AND x.locationCode=l.LocationCode) THEN 1 ELSE 0 END,VerifiedAtUtc=@now
 FROM gp.EmployeeProjectLocationMemberships m JOIN @employees e ON e.EmployeeId=m.EmployeeId JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=m.ProjectLocationId JOIN gp.Projects p ON p.ProjectId=pl.ProjectId JOIN gp.Locations l ON l.LocationId=pl.LocationId;
 INSERT gp.EmployeeProjectLocationMemberships(EmployeeId,ProjectLocationId,IsActive,VerifiedAtUtc)
 SELECT e.EmployeeId,pl.ProjectLocationId,e.IsActive,@now FROM @employees e CROSS APPLY OPENJSON(e.Assignments) WITH(projectCode nvarchar(80),locationCode varchar(16)) x
 JOIN gp.Projects p ON p.ExternalProjectCode=x.projectCode JOIN gp.Locations l ON l.LocationCode=x.locationCode JOIN gp.ProjectLocations pl ON pl.ProjectId=p.ProjectId AND pl.LocationId=l.LocationId
 WHERE NOT EXISTS(SELECT 1 FROM gp.EmployeeProjectLocationMemberships m WHERE m.EmployeeId=e.EmployeeId AND m.ProjectLocationId=pl.ProjectLocationId);
 DECLARE @newGrants table(RoleGrantId bigint,UserId uniqueidentifier);
 INSERT gp.StaffRoleGrants(UserId,RoleCode,ScopeType,LocationId,GrantedByUserId,ValidFromUtc)
 OUTPUT inserted.RoleGrantId,inserted.UserId INTO @newGrants
 SELECT u.UserId,'GUARD','LOCATION',l.LocationId,@seedActor,@now FROM @guards g
 JOIN gp.Users u ON u.IdentityIssuer=@issuer AND u.IdentitySubject=(N'guard:'+g.GuardId) COLLATE Latin1_General_100_BIN2
 JOIN gp.Locations l ON l.LocationCode=g.LocationCode
 WHERE NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants r WHERE r.UserId=u.UserId AND r.RoleCode='GUARD' AND r.ScopeType='LOCATION' AND r.LocationId=l.LocationId);
 -- Populate only NEW grants: do not restore a deliberately removed capability.
 INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode)
 SELECT n.RoleGrantId,c.value FROM @newGrants n JOIN gp.Users u ON u.UserId=n.UserId
 JOIN @guards g ON u.IdentitySubject=(N'guard:'+g.GuardId) COLLATE Latin1_General_100_BIN2 CROSS APPLY OPENJSON(g.Capabilities) c;
 INSERT gp.GuardAssignments(GuardUserId,ProjectLocationId,AssignedByUserId,ValidFromUtc,Reason)
 SELECT u.UserId,pl.ProjectLocationId,@seedActor,@now,N'Development dummy allocation'
 FROM @guards g CROSS APPLY OPENJSON(g.Projects) pc JOIN gp.Users u ON u.IdentityIssuer=@issuer AND u.IdentitySubject=(N'guard:'+g.GuardId) COLLATE Latin1_General_100_BIN2
 JOIN gp.Projects p ON p.ExternalProjectCode=pc.value JOIN gp.Locations l ON l.LocationCode=g.LocationCode
 JOIN gp.ProjectLocations pl ON pl.ProjectId=p.ProjectId AND pl.LocationId=l.LocationId
 WHERE u.IsActive=1 AND NOT EXISTS(SELECT 1 FROM gp.GuardAssignments a WHERE a.GuardUserId=u.UserId AND a.ProjectLocationId=pl.ProjectLocationId)
 AND EXISTS(SELECT 1 FROM gp.StaffRoleGrants r JOIN gp.GrantCapabilities c ON c.RoleGrantId=r.RoleGrantId
    WHERE r.UserId=u.UserId AND r.RoleCode='GUARD' AND r.LocationId=l.LocationId AND r.RevokedAtUtc IS NULL
    AND r.ValidFromUtc<=@now AND (r.ValidUntilUtc IS NULL OR @now<r.ValidUntilUtc) AND c.CapabilityCode='PROJECT_MOVEMENT');
 UPDATE gp.Users SET AuthorizationVersion=AuthorizationVersion+1 WHERE IdentityIssuer=@issuer AND IdentitySubject<>N'local-seed';
 IF NOT EXISTS(SELECT 1 FROM sys.extended_properties WHERE class=0 AND name=N'GatePass.DevelopmentDirectoryMarker')
    EXEC sys.sp_addextendedproperty @name=N'GatePass.DevelopmentDirectoryMarker',@value=N'SYNTHETIC-DIRECTORY-V1';

 INSERT gp.CommonAreas(LocationId,AreaName)
 SELECT DISTINCT l.LocationId,x.value FROM @guards g CROSS APPLY OPENJSON(g.Areas) x JOIN gp.Locations l ON l.LocationCode=g.LocationCode
 WHERE NOT EXISTS(SELECT 1 FROM gp.CommonAreas a WHERE a.LocationId=l.LocationId AND a.AreaName=x.value);
 INSERT gp.GuardCommonAreaAssignments(GuardUserId,CommonAreaId,AssignedByUserId,ValidFromUtc,Reason)
 SELECT u.UserId,a.CommonAreaId,@seedActor,@now,N'Explicit development common duty'
 FROM @guards g CROSS APPLY OPENJSON(g.Areas) x JOIN gp.Locations l ON l.LocationCode=g.LocationCode
 JOIN gp.CommonAreas a ON a.LocationId=l.LocationId AND a.AreaName=x.value JOIN gp.Users u ON u.IdentityIssuer=@issuer AND u.IdentitySubject=(N'guard:'+g.GuardId) COLLATE Latin1_General_100_BIN2
 WHERE NOT EXISTS(SELECT 1 FROM gp.GuardCommonAreaAssignments ca WHERE ca.GuardUserId=u.UserId AND ca.CommonAreaId=a.CommonAreaId);
 DECLARE @metadata nvarchar(max)=(SELECT (SELECT COUNT(*) FROM @employees) AS employees,(SELECT COUNT(*) FROM @guards) AS guards,
    (SELECT COUNT(*) FROM @newGrants) AS newGuardGrants FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,ResultCode,MetadataJson)
 VALUES(@seedActor,'DEVELOPMENT_DIRECTORY_SEEDED','DEVELOPMENT_FIXTURE','SUCCESS',@metadata);
 COMMIT;
 DECLARE @summary nvarchar(max)=(SELECT @issuer AS mock_issuer,
    (SELECT COUNT(*) FROM gp.Employees e JOIN gp.Users u ON u.UserId=e.UserId WHERE u.IdentityIssuer=@issuer) AS employees,
    (SELECT COUNT(DISTINCT ManagerEmployeeId) FROM gp.Employees e JOIN gp.Users u ON u.UserId=e.UserId WHERE u.IdentityIssuer=@issuer) AS managers,
    (SELECT COUNT(*) FROM gp.Users WHERE IdentityIssuer=@issuer AND IdentitySubject LIKE N'guard:%') AS guards,
    (SELECT COUNT(*) FROM gp.Projects WHERE ExternalProjectCode IN(SELECT ProjectCode FROM @projects)) AS projects,
    (SELECT COUNT(*) FROM gp.GuardAssignments a JOIN gp.Users u ON u.UserId=a.GuardUserId WHERE u.IdentityIssuer=@issuer) AS guard_assignments,
    (SELECT COUNT(*) FROM gp.Sessions s JOIN gp.Users u ON u.UserId=s.UserId WHERE u.IdentityIssuer=@issuer) AS sessions,
    @metadata AS seed_counts FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 SELECT @summary;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK;
 THROW;
END CATCH;
