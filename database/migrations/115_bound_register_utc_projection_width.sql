/* REPLACE returns varchar(8000) metadata for the fixed 24-byte UTC display
   strings. Declare their actual width so narrow-key sorts get realistic grants. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54800,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='114') THROW 54800,'Migration 114 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='115') THROW 54800,'Migration 115 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
DECLARE @definition nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID('gp.ReadAdminVisitRegister'));
IF @definition IS NULL OR CHARINDEX('CREATE TABLE #registerDevices',@definition)=0 THROW 54800,'Unexpected register display contract.',1;
DECLARE @fields table(Name nvarchar(100) PRIMARY KEY);
INSERT @fields VALUES(N'v.SubmittedAtUtc'),(N'ret.ReturnedAtUtc'),(N'v.ValidFromUtc'),(N'v.ValidUntilUtc'),(N'mv.firstEntry'),(N'mv.lastEntry'),(N'mv.lastExit');
DECLARE @field nvarchar(100),@old nvarchar(300);
WHILE EXISTS(SELECT 1 FROM @fields)
BEGIN
 SELECT TOP(1) @field=Name FROM @fields ORDER BY Name;
 SET @old=N'REPLACE(CONVERT(char(23),'+@field+N',121),'' '',''T'')+''Z''';
 IF (LEN(@definition)-LEN(REPLACE(@definition,@old,N'')))<>LEN(@old) THROW 54800,'Unexpected register UTC expression.',1;
 SET @definition=REPLACE(@definition,@old,N'CONVERT(varchar(24),'+@old+N')');
 DELETE FROM @fields WHERE Name=@field;
END;
SET @definition=REPLACE(@definition,N'CREATE PROCEDURE',N'ALTER PROCEDURE');
EXEC sys.sp_executesql @definition;
INSERT gp.SchemaMigrations(Version,Description) VALUES('115',N'Bound fixed register UTC display columns to their exact 24-byte width');COMMIT;
