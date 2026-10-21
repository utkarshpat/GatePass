/* Common staff entry: role/capability/scope discovery does not grant operational access. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='026') THROW 53600,'Migration 026 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='027') THROW 53600,'Migration 027 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
CREATE PROCEDURE gp.GetStaffAccessContext @SessionHash varbinary(8000),@CsrfHash varbinary(8000)
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@result nvarchar(max),@name nvarchar(200);
 BEGIN TRY
  BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
  EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
  IF EXISTS(SELECT 1 FROM gp.Employees WHERE UserId=@actor) AND NOT EXISTS(SELECT 1 FROM gp.Employees WHERE UserId=@actor AND IsActive=1 AND LastSyncedAtUtc BETWEEN @cutoff AND @now) THROW 53601,'Current employee data required.',1;
  SELECT @name=DisplayName FROM gp.Users WHERE UserId=@actor;
  DECLARE @grants table(RoleGrantId bigint,RoleCode varchar(24),ScopeType varchar(24),ScopeName nvarchar(200));
  INSERT @grants SELECT g.RoleGrantId,g.RoleCode,g.ScopeType,CASE g.ScopeType WHEN 'INDIA' THEN N'India' WHEN 'LOCATION' THEN l.LocationName WHEN 'PROJECT' THEN p.ProjectName ELSE lp.ProjectName+N' · '+ll.LocationName END
   FROM gp.StaffRoleGrants g LEFT JOIN gp.Locations l ON l.LocationId=g.LocationId LEFT JOIN gp.Projects p ON p.ProjectId=g.ProjectId
   LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=g.ProjectLocationId LEFT JOIN gp.Projects lp ON lp.ProjectId=pl.ProjectId LEFT JOIN gp.Locations ll ON ll.LocationId=pl.LocationId
   WHERE g.UserId=@actor AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@now AND (g.ValidUntilUtc IS NULL OR @now<g.ValidUntilUtc)
    AND (g.ScopeType='INDIA' OR g.ScopeType='LOCATION' AND l.IsActive=1 OR g.ScopeType='PROJECT' AND p.IsActive=1 AND p.LastSyncedAtUtc BETWEEN @cutoff AND @now
      OR g.ScopeType='PROJECT_LOCATION' AND pl.IsActive=1 AND lp.IsActive=1 AND ll.IsActive=1 AND lp.LastSyncedAtUtc BETWEEN @cutoff AND @now);
  SET @result=(SELECT @name displayName,JSON_QUERY(COALESCE((SELECT TOP(100) g.RoleCode roleCode,g.ScopeType scopeType,g.ScopeName scopeName,
    JSON_QUERY(COALESCE((SELECT c.CapabilityCode code FROM gp.GrantCapabilities c WHERE c.RoleGrantId=g.RoleGrantId ORDER BY c.CapabilityCode FOR JSON PATH),N'[]')) capabilities
    FROM @grants g ORDER BY g.RoleCode,g.ScopeName,g.RoleGrantId FOR JSON PATH),N'[]')) grants,
    CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM @grants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='VISITS_READ' WHERE g.RoleCode='RECEPTION') THEN 1 ELSE 0 END) receptionAvailable
    FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON gp.GetStaffAccessContext TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('027',N'Common staff entry with live role, capability and scope discovery');
COMMIT;
