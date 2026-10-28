/* Expose only approved host-change metadata through the existing scoped audit projection. */
SET NOCOUNT ON;SET XACT_ABORT ON;
IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='120') THROW 52000,'Migration 120 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='121') THROW 52000,'Migration 121 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
DECLARE @sql nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID('gp.ManageAccountHost')),@old nvarchar(max)=N'JSON_MODIFY(@payload,''$.result'',JSON_QUERY((SELECT @revision revision FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)))';
IF @sql IS NULL OR CHARINDEX(@old,@sql)=0 THROW 52000,'Host audit definition required.',1;
SET @sql=REPLACE(@sql,@old,N'JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(@payload,''$.targetDisplayName'',(SELECT FullName FROM gp.Employees WHERE EmployeeId=@EmployeeId)),''$.staffCode'',CONVERT(nvarchar(64),@EmployeeId)),''$.scopeName'',(SELECT LEFT(p.ProjectName+N'' · ''+l.LocationName,200) FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId JOIN gp.Locations l ON l.LocationId=pl.LocationId WHERE pl.ProjectLocationId=@ProjectLocationId))');
SET @sql=STUFF(@sql,1,CHARINDEX(' ',@sql)-1,'ALTER');EXEC sys.sp_executesql @sql;
SET @sql=OBJECT_DEFINITION(OBJECT_ID('gp.ListScopedAuditEvents'));
SET @old=N'''STAFF_ACCOUNT_CREATED'',''STAFF_SETUP_ISSUED'',''STAFF_SETUP_REISSUED'',''GUARD_ALLOCATED''';
IF @sql IS NULL OR CHARINDEX(@old,@sql)=0 THROW 52000,'Scoped audit projection required.',1;
SET @sql=REPLACE(@sql,@old,@old+N',''ACCOUNT_HOST_ADDED'',''ACCOUNT_HOST_REMOVED''');
SET @sql=STUFF(@sql,1,CHARINDEX(' ',@sql)-1,'ALTER');EXEC sys.sp_executesql @sql;
INSERT gp.SchemaMigrations(Version,Description) VALUES('121',N'Account host target, actor, scope and reason in scoped audit display');COMMIT;
