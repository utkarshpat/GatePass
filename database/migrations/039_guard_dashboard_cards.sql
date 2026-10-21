SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='038') THROW 53600,'Migration 038 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='039') THROW 53600,'Migration 039 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
ALTER PROCEDURE gp.ListGuardRecentScans @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@result nvarchar(max);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='VISITS_READ' JOIN gp.Locations l ON l.LocationId=g.LocationId AND l.IsActive=1 WHERE g.UserId=@actor AND g.RoleCode='GUARD' AND g.ScopeType='LOCATION' AND g.LocationId=@LocationId AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@now AND(g.ValidUntilUtc IS NULL OR @now<g.ValidUntilUtc)) THROW 52001,'Not authorized.',1;
 SET @result=(SELECT JSON_QUERY(COALESCE((SELECT TOP(20) CONVERT(varchar(20),a.ScanAttemptId) scanId,a.OutcomeCode outcome,REPLACE(CONVERT(char(23),a.OccurredAtUtc,121),' ','T')+'Z' occurredAtUtc,
 CASE WHEN gp._VisitReadAllowed(@actor,'GUARD',a.VisitRequestId,@now,@cutoff)=1 THEN v.PersonName END personName,
 CASE WHEN scope.Visible=1 THEN v.PublicReference END publicReference,
 CASE WHEN scope.Visible=1 THEN v.VisitRequestId END visitRequestId,
 CASE WHEN scope.Visible=1 THEN p.PublicPassNumber END publicPassNumber,
 CASE WHEN scope.Visible=1 THEN CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END END requestType,
 CASE WHEN scope.Visible=1 THEN pr.ProjectName END projectName,
 CASE WHEN scope.Visible=1 THEN REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' END validUntilUtc,
 CASE WHEN scope.Visible=1 THEN CONVERT(bit,CASE WHEN ph.PhotoAssetId IS NOT NULL AND ph.PurgedAtUtc IS NULL AND ph.StorageKey IS NOT NULL THEN 1 ELSE 0 END) END photoAvailable
 FROM gp.PassScanAttempts a LEFT JOIN gp.VisitRequests v ON v.VisitRequestId=a.VisitRequestId
 OUTER APPLY(SELECT gp._VisitReadAllowed(@actor,'GUARD',a.VisitRequestId,@now,@cutoff) Visible) scope
 LEFT JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1
 LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId
 LEFT JOIN gp.Projects pr ON pr.ProjectId=pl.ProjectId
 LEFT JOIN gp.PhotoAssets ph ON ph.PhotoAssetId=v.PhotoAssetId WHERE a.ActorUserId=@actor AND a.LocationId=@LocationId ORDER BY a.OccurredAtUtc DESC,a.ScanAttemptId DESC FOR JSON PATH),N'[]')) scans FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('039',N'Guard dashboard card projection retains current row-level scope and private-photo boundary');COMMIT;
