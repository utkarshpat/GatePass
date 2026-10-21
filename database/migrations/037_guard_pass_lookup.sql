/* Exact manual pass/request lookup with the same guard visibility boundary as scan. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='036') THROW 53600,'Migration 036 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='037') THROW 53600,'Migration 037 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
CREATE PROCEDURE gp.FindGuardPass @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@Reference nvarchar(100)
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
 IF @LocationId IS NULL OR @LocationId<=0 OR @Reference IS NULL OR LEN(LTRIM(RTRIM(@Reference)))=0 OR DATALENGTH(@Reference)>100 THROW 52002,'Invalid lookup.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@visit uniqueidentifier,@result nvarchar(max);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='VISITS_READ' JOIN gp.Locations l ON l.LocationId=g.LocationId AND l.IsActive=1 WHERE g.UserId=@actor AND g.RoleCode='GUARD' AND g.ScopeType='LOCATION' AND g.LocationId=@LocationId AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@now AND(g.ValidUntilUtc IS NULL OR @now<g.ValidUntilUtc)) THROW 52001,'Not authorized.',1;
 SELECT TOP(1) @visit=v.VisitRequestId FROM gp.VisitRequests v WHERE v.LocationId=@LocationId AND (v.PublicReference=@Reference COLLATE Latin1_General_100_BIN2 OR EXISTS(SELECT 1 FROM gp.AccessPasses p WHERE p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 AND p.PublicPassNumber=@Reference COLLATE Latin1_General_100_BIN2)) AND gp._VisitReadAllowed(@actor,'GUARD',v.VisitRequestId,@now,@cutoff)=1 ORDER BY v.VisitRequestId;
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ResultCode) VALUES(@actor,'GUARD_MANUAL_LOOKUP','LOCATION',CONVERT(varchar(20),@LocationId),@LocationId,CASE WHEN @visit IS NULL THEN 'NOT_AVAILABLE' ELSE 'SUCCESS' END);
 SET @result=(SELECT @visit visitRequestId FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER);COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON gp.FindGuardPass TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('037',N'Exact manual guard pass and request reference lookup');COMMIT;
