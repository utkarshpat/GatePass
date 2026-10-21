/* Bound SQL optimizer expansion of nested authorization helpers on queue reads. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53800,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='049') THROW 53800,'Migration 049 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='050') THROW 53800,'Migration 050 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
ALTER FUNCTION gp._EmployeeOfficeEligible(@Employee nvarchar(64),@Location int,@Cutoff datetime2(3),@Now datetime2(3)) RETURNS bit WITH INLINE=OFF AS
BEGIN
 IF EXISTS(SELECT 1 FROM gp.EmployeeOfficeMemberships m JOIN gp.Employees e ON e.EmployeeId=m.EmployeeId
 JOIN gp.Locations l ON l.LocationId=m.LocationId LEFT JOIN gp.Users u ON u.UserId=e.UserId
 WHERE m.EmployeeId=@Employee AND m.LocationId=@Location AND m.IsActive=1 AND l.IsActive=1
 AND e.IsActive=1 AND (e.UserId IS NULL OR u.IsActive=1) AND e.LastSyncedAtUtc BETWEEN @Cutoff AND @Now AND m.VerifiedAtUtc BETWEEN @Cutoff AND @Now) RETURN 1;
 RETURN 0;
END;
GO
ALTER FUNCTION gp._EmployeeProjectLocationEligible(@Employee nvarchar(64),@Pair bigint,@Cutoff datetime2(3),@Now datetime2(3)) RETURNS bit WITH INLINE=OFF AS
BEGIN
 IF EXISTS(SELECT 1 FROM gp.EmployeeProjectLocationMemberships m JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=m.ProjectLocationId
 JOIN gp.Projects p ON p.ProjectId=pl.ProjectId JOIN gp.EmployeeProjectMemberships a ON a.EmployeeId=m.EmployeeId AND a.ProjectId=p.ProjectId
 WHERE m.EmployeeId=@Employee AND m.ProjectLocationId=@Pair AND m.IsActive=1 AND pl.IsActive=1 AND p.IsActive=1 AND a.IsActive=1
 AND m.VerifiedAtUtc BETWEEN @Cutoff AND @Now AND a.VerifiedAtUtc BETWEEN @Cutoff AND @Now AND p.LastSyncedAtUtc BETWEEN @Cutoff AND @Now
 AND gp._EmployeeOfficeEligible(@Employee,pl.LocationId,@Cutoff,@Now)=1) RETURN 1;
 RETURN 0;
END;
GO
ALTER FUNCTION gp._EmployeeProjectSummary(@Employee nvarchar(64),@Cutoff datetime2(3),@Now datetime2(3),@Location int)
RETURNS nvarchar(max) WITH INLINE=OFF AS BEGIN
 IF @Employee IS NULL RETURN NULL;
 IF gp._EmployeeOfficeEligible(@Employee,@Location,@Cutoff,@Now)=0 OR EXISTS(
 SELECT 1 FROM gp.EmployeeProjectLocationMemberships m JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=m.ProjectLocationId
 WHERE m.EmployeeId=@Employee AND pl.LocationId=@Location AND m.IsActive=1 AND gp._EmployeeProjectLocationEligible(@Employee,m.ProjectLocationId,@Cutoff,@Now)=0)
 RETURN N'{"available":false,"total":null,"items":[]}';
 RETURN (SELECT CONVERT(bit,1) available,(SELECT COUNT(*) FROM gp.EmployeeProjectLocationMemberships m JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=m.ProjectLocationId WHERE m.EmployeeId=@Employee AND pl.LocationId=@Location AND gp._EmployeeProjectLocationEligible(@Employee,m.ProjectLocationId,@Cutoff,@Now)=1) total,
 JSON_QUERY(COALESCE((SELECT TOP(3) p.ProjectName name FROM gp.EmployeeProjectLocationMemberships m JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=m.ProjectLocationId JOIN gp.Projects p ON p.ProjectId=pl.ProjectId WHERE m.EmployeeId=@Employee AND pl.LocationId=@Location AND gp._EmployeeProjectLocationEligible(@Employee,m.ProjectLocationId,@Cutoff,@Now)=1 ORDER BY p.ExternalProjectCode FOR JSON PATH),N'[]')) items FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
END;
GO
ALTER FUNCTION gp._VisitReadAllowed(@Actor uniqueidentifier,@View varchar(20),@Visit uniqueidentifier,@Now datetime2(3),@Cutoff datetime2(3))
RETURNS bit WITH INLINE=OFF AS
BEGIN
    DECLARE @allowed bit=0;
    IF EXISTS(SELECT 1 FROM gp.VisitRequests v JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId
        LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId
        WHERE v.VisitRequestId=@Visit AND v.PersonalDataPurgedAtUtc IS NULL AND
        ((@View='OWN' AND EXISTS(SELECT 1 FROM gp.Employees e WHERE e.UserId=@Actor AND e.EmployeeId=v.EmployeeId
            AND e.IsActive=1 AND e.LastSyncedAtUtc BETWEEN @Cutoff AND @Now))
        OR (@View='HOST' AND EXISTS(SELECT 1 FROM gp.Employees e JOIN gp.EmployeeProjectMemberships m ON m.EmployeeId=e.EmployeeId
            JOIN gp.Projects p ON p.ProjectId=m.ProjectId WHERE e.UserId=@Actor AND e.EmployeeId=v.HostEmployeeId
            AND gp._EmployeeProjectLocationEligible(e.EmployeeId,v.ProjectLocationId,@Cutoff,@Now)=1 AND e.IsActive=1 AND e.LastSyncedAtUtc BETWEEN @Cutoff AND @Now AND m.ProjectId=pl.ProjectId
            AND m.IsActive=1 AND m.VerifiedAtUtc BETWEEN @Cutoff AND @Now AND p.LastSyncedAtUtc BETWEEN @Cutoff AND @Now))
        OR EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='VISITS_READ'
            WHERE g.UserId=@Actor AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@Now AND (g.ValidUntilUtc IS NULL OR @Now<g.ValidUntilUtc)
            AND ((@View='RECEPTION' AND g.RoleCode='RECEPTION' AND g.ScopeType='LOCATION' AND g.LocationId=v.LocationId)
            OR (@View='ADMIN' AND ((g.RoleCode='INDIA_ADMIN' AND g.ScopeType='INDIA') OR (g.RoleCode='PLATFORM_ADMIN' AND g.ScopeType='PLATFORM')
                OR (g.RoleCode='LOCATION_ADMIN' AND g.ScopeType='LOCATION' AND g.LocationId=v.LocationId)
                OR (g.RoleCode='PROJECT_ADMIN' AND ((g.ScopeType='PROJECT' AND g.ProjectId=pl.ProjectId)
                    OR (g.ScopeType='PROJECT_LOCATION' AND g.ProjectLocationId=v.ProjectLocationId)))))
            OR (@View='GUARD' AND g.RoleCode='GUARD' AND g.ScopeType='LOCATION' AND g.LocationId=v.LocationId AND
                ((s.IsInside=1 AND EXISTS(SELECT 1 FROM gp.GrantCapabilities x WHERE x.RoleGrantId=g.RoleGrantId AND x.CapabilityCode='RECONCILE_EXIT'))
                OR (v.RequestType='TEMP_ID' AND EXISTS(SELECT 1 FROM gp.GrantCapabilities x WHERE x.RoleGrantId=g.RoleGrantId AND x.CapabilityCode='TEMP_ID_MOVEMENT'))
                OR (v.ProjectLocationId IS NOT NULL AND EXISTS(SELECT 1 FROM gp.GuardAssignments a WHERE a.GuardUserId=@Actor
                    AND a.ProjectLocationId=v.ProjectLocationId AND a.DeallocatedAtUtc IS NULL AND a.ValidFromUtc<=@Now
                    AND (a.ValidUntilUtc IS NULL OR @Now<a.ValidUntilUtc))))))))) SET @allowed=1;
    RETURN @allowed;
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('050',N'Bound nested authorization helper optimization');COMMIT;
