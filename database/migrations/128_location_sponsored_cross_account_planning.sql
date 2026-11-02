/* Invitation sponsorship and destination permission are independent.
   An approved host may request any active destination in the same eligible office.
   Destination policy/independent approval, private reads and gate grants are unchanged. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='127') THROW 52000,'Migration 127 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='128') THROW 52000,'Migration 128 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
CREATE INDEX IX_AccountHosts_Employee_Active ON gp.AccountHosts(EmployeeId,IsActive,ProjectLocationId);
GO
CREATE FUNCTION gp._PlanningSponsor(@User uniqueidentifier,@Location int,@Now datetime2(3),@Cutoff datetime2(3)) RETURNS bit WITH INLINE=OFF AS BEGIN
 IF gp._PlanningInternal(@User,@Now,@Cutoff)=0 OR NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@Location AND IsActive=1) RETURN 0;
 IF EXISTS(SELECT 1 FROM gp.LocationPlanningHosts h JOIN gp.Employees e ON e.EmployeeId=h.EmployeeId
  WHERE h.LocationId=@Location AND h.IsActive=1 AND e.UserId=@User AND gp._EmployeeOfficeEligible(e.EmployeeId,@Location,@Cutoff,@Now)=1) RETURN 1;
 IF EXISTS(SELECT 1 FROM gp.Employees e JOIN gp.AccountHosts h ON h.EmployeeId=e.EmployeeId JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=h.ProjectLocationId
  WHERE e.UserId=@User AND pl.LocationId=@Location AND h.IsActive=1 AND gp._AccountHostEligible(e.EmployeeId,h.ProjectLocationId,@Cutoff,@Now)=1) RETURN 1;
 RETURN 0;
END;
GO
ALTER FUNCTION gp._PlanningHost(@User uniqueidentifier,@Location int,@Sub uniqueidentifier,@Now datetime2(3),@Cutoff datetime2(3)) RETURNS bit WITH INLINE=OFF AS BEGIN
 /* Legacy helper name: permission to sponsor a request, never destination entry. */
 IF gp._PlanningSponsor(@User,@Location,@Now,@Cutoff)=0 RETURN 0;
 IF @Sub IS NULL RETURN 1;
 IF EXISTS(SELECT 1 FROM gp.SubProjects s JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=s.AccountOfficeId AND pl.LocationId=s.LocationId JOIN gp.Projects p ON p.ProjectId=pl.ProjectId
  WHERE s.SubProjectId=@Sub AND s.LocationId=@Location AND s.IsActive=1 AND pl.IsActive=1 AND p.IsActive=1 AND p.LastSyncedAtUtc BETWEEN @Cutoff AND @Now) RETURN 1;
 RETURN 0;
END;
GO
/* Staff discovery must also work for an existing account host before a child
   host roster has been configured. Preserve historical/read/admin conditions. */
DECLARE @definition nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID('gp._PlanningAvailable'));
DECLARE @needle nvarchar(250)=N'IF gp._PlanningInternal(@User,@Now,@Cutoff)=0 RETURN 0;';
IF @definition IS NULL OR (LEN(@definition)-LEN(REPLACE(@definition,@needle,N'')))/LEN(@needle)<>1 THROW 52000,'Planning workspace discovery contract required.',1;
SET @definition=REPLACE(@definition,@needle,@needle+N'
 IF EXISTS(SELECT 1 FROM gp.Employees e JOIN gp.AccountHosts h ON h.EmployeeId=e.EmployeeId JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=h.ProjectLocationId
  WHERE e.UserId=@User AND h.IsActive=1 AND gp._PlanningSponsor(@User,pl.LocationId,@Now,@Cutoff)=1) RETURN 1;');
SET @definition=STUFF(@definition,1,CHARINDEX(' ',@definition)-1,'ALTER');EXEC sys.sp_executesql @definition;
INSERT gp.SchemaMigrations(Version,Description) VALUES('128',N'Location-approved invitation sponsors may request cross-account projects subject to independent destination approval');
COMMIT;
