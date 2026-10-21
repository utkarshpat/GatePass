/* Guard workspace discovery and actor-owned recent scan history. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='035') THROW 53600,'Migration 035 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='036') THROW 53600,'Migration 036 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
CREATE PROCEDURE gp.GetGuardWorkspaceContext @SessionHash varbinary(8000),@CsrfHash varbinary(8000)
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@result nvarchar(max),@locations nvarchar(max),@name nvarchar(200);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 SELECT @name=DisplayName FROM gp.Users WHERE UserId=@actor;
 SET @locations=COALESCE((SELECT TOP(50) l.LocationId locationId,l.LocationName locationName FROM gp.Locations l WHERE l.IsActive=1 AND EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='VISITS_READ' WHERE g.UserId=@actor AND g.RoleCode='GUARD' AND g.ScopeType='LOCATION' AND g.LocationId=l.LocationId AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@now AND(g.ValidUntilUtc IS NULL OR @now<g.ValidUntilUtc)) ORDER BY l.LocationName FOR JSON PATH),N'[]');
 IF @locations=N'[]' THROW 52001,'Not authorized.',1;
 SET @result=(SELECT @name displayName,JSON_QUERY(@locations) locations FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp.ListGuardRecentScans @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@result nvarchar(max);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='VISITS_READ' JOIN gp.Locations l ON l.LocationId=g.LocationId AND l.IsActive=1 WHERE g.UserId=@actor AND g.RoleCode='GUARD' AND g.ScopeType='LOCATION' AND g.LocationId=@LocationId AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@now AND(g.ValidUntilUtc IS NULL OR @now<g.ValidUntilUtc)) THROW 52001,'Not authorized.',1;
 SET @result=(SELECT JSON_QUERY(COALESCE((SELECT TOP(20) CONVERT(varchar(20),a.ScanAttemptId) scanId,a.OutcomeCode outcome,REPLACE(CONVERT(char(23),a.OccurredAtUtc,121),' ','T')+'Z' occurredAtUtc,
 CASE WHEN gp._VisitReadAllowed(@actor,'GUARD',a.VisitRequestId,@now,@cutoff)=1 THEN v.PersonName END personName,
 CASE WHEN gp._VisitReadAllowed(@actor,'GUARD',a.VisitRequestId,@now,@cutoff)=1 THEN v.PublicReference END publicReference
 FROM gp.PassScanAttempts a LEFT JOIN gp.VisitRequests v ON v.VisitRequestId=a.VisitRequestId WHERE a.ActorUserId=@actor AND a.LocationId=@LocationId ORDER BY a.OccurredAtUtc DESC,a.ScanAttemptId DESC FOR JSON PATH),N'[]')) scans FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON gp.GetGuardWorkspaceContext TO gp_api_runtime;
GRANT EXECUTE ON gp.ListGuardRecentScans TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('036',N'Guard workspace discovery and scope-safe recent scans');
COMMIT;
