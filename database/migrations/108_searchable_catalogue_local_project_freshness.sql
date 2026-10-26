SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54800,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='107') THROW 54800,'Migration 107 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='108') THROW 54800,'Migration 108 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
ALTER PROCEDURE gp.ListLeadProjects @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@AfterProjectLocationId bigint=NULL,@Search nvarchar(100)=NULL
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
 IF @LocationId IS NULL OR @LocationId<=0 OR @AfterProjectLocationId<=0 THROW 52002,'Invalid project page.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@more bit,@after bigint,@result nvarchar(max);
 DECLARE @page table(Pair bigint PRIMARY KEY);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@LocationId AND IsActive=1) OR(gp._LeadWorkspaceScope(@actor,@LocationId,NULL,@now)=0 AND NOT EXISTS(SELECT 1 FROM gp.ProjectLocations pl WHERE pl.LocationId=@LocationId AND pl.IsActive=1 AND gp._LeadWorkspaceScope(@actor,@LocationId,pl.ProjectLocationId,@now)=1)) THROW 52001,'Not authorized.',1;
 INSERT @page SELECT TOP(26) pl.ProjectLocationId FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId WHERE pl.LocationId=@LocationId AND pl.IsActive=1 AND p.IsActive=1 AND(@AfterProjectLocationId IS NULL OR pl.ProjectLocationId>@AfterProjectLocationId) AND(@Search IS NULL OR CHARINDEX(@Search,p.ProjectName)>0 OR CHARINDEX(@Search,p.ExternalProjectCode)>0) AND gp._LeadWorkspaceScope(@actor,@LocationId,pl.ProjectLocationId,@now)=1 ORDER BY pl.ProjectLocationId;
 SET @more=CASE WHEN(SELECT COUNT(*) FROM @page)>25 THEN 1 ELSE 0 END;
 IF @more=1 BEGIN DELETE @page WHERE Pair=(SELECT MAX(Pair) FROM @page);SELECT @after=MAX(Pair) FROM @page;END;
 EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF EXISTS(SELECT 1 FROM @page pg JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=pg.Pair WHERE gp._LeadWorkspaceScope(@actor,@LocationId,pl.ProjectLocationId,@now)=0) THROW 52001,'Project scope changed during read.',1;
 SET @result=(SELECT JSON_QUERY(COALESCE((SELECT CONVERT(varchar(20),pl.ProjectLocationId) projectLocationId,CONVERT(varchar(20),p.ProjectId) projectId,p.ProjectName projectName,p.ExternalProjectCode projectCode,
 CONVERT(bit,gp._ProjectCurrent(p.ProjectId,@cutoff,@now)) directoryCurrent,
 CONVERT(bit,gp._StaffRoleDelegationAllowed(@actor,'PROJECT_ADMIN','PROJECT',NULL,p.ProjectId,NULL,@now)) canAssignProject,
 CONVERT(bit,gp._StaffRoleDelegationAllowed(@actor,'PROJECT_ADMIN','PROJECT_LOCATION',NULL,NULL,pl.ProjectLocationId,@now)) canAssignLocation
 FROM @page pg JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=pg.Pair JOIN gp.Projects p ON p.ProjectId=pl.ProjectId ORDER BY pl.ProjectLocationId FOR JSON PATH),N'[]')) projects,@more hasMore,CONVERT(varchar(20),@after) afterProjectLocationId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('108',N'Preserve local project freshness in searchable catalogue and recheck response authority');COMMIT;
