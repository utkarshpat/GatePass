/* Query-level OPTION cannot be placed inside a scalar FOR JSON subquery.
   The explicit LOOP JOIN and ordinal index retain ordered narrow-key lookup. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54800,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='112') THROW 54800,'Migration 112 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='113') THROW 54800,'Migration 113 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
DECLARE @definition nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID('gp.ReadAdminVisitRegister')),
 @old nvarchar(100)=N'INCLUDE_NULL_VALUES OPTION(FORCE ORDER)';
IF @definition IS NULL OR (LEN(@definition)-LEN(REPLACE(@definition,@old,N'')))<>2*LEN(@old)
 OR CHARINDEX('CREATE TABLE #registerOrder',@definition)=0 THROW 54800,'Unexpected narrow-register contract.',1;
SET @definition=REPLACE(@definition,@old,N'INCLUDE_NULL_VALUES');
SET @definition=REPLACE(@definition,N'CREATE PROCEDURE',N'ALTER PROCEDURE');
EXEC sys.sp_executesql @definition;
INSERT gp.SchemaMigrations(Version,Description) VALUES('113',N'Keep ordinal register lookup compatible with scalar FOR JSON subqueries');COMMIT;
