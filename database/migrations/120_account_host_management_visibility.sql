/* Host-list management does not imply permission to delegate another administrator. */
SET NOCOUNT ON;SET XACT_ABORT ON;
IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='119') THROW 52000,'Migration 119 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='120') THROW 52000,'Migration 120 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
DECLARE @sql nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID('gp.ListLeadProjects')),@old nvarchar(1000)=N'canAssignLocation';
IF @sql IS NULL OR CHARINDEX(@old,@sql)=0 THROW 52000,'Account catalogue definition required.',1;
SET @sql=REPLACE(@sql,@old,N'canAssignLocation,CONVERT(bit,gp._AdminScopeAllowed(@actor,''ROLE_GRANTS_MANAGE'',@LocationId,pl.ProjectLocationId,@now)) canManageHosts');
SET @sql=STUFF(@sql,1,CHARINDEX(' ',@sql)-1,'ALTER');EXEC sys.sp_executesql @sql;
INSERT gp.SchemaMigrations(Version,Description) VALUES('120',N'Expose exact account-office host-list administration visibility');COMMIT;
