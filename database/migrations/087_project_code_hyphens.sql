/* SQL LIKE bracket syntax requires the literal hyphen first in the allowed set. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54600,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='086') THROW 54600,'Migration 086 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='087') THROW 54600,'Migration 087 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
DECLARE @definition nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID('gp.CreateScopedProject'));
IF @definition IS NULL OR CHARINDEX(N'%[^A-Z0-9._-]%',@definition)=0 THROW 54600,'Project code contract changed.',1;
SET @definition=REPLACE(@definition,N'%[^A-Z0-9._-]%',N'%[^-A-Z0-9._]%');
SET @definition=STUFF(@definition,1,6,'ALTER');EXEC sys.sp_executesql @definition;
INSERT gp.SchemaMigrations(Version,Description) VALUES('087',N'Accept literal hyphens in scoped project codes');COMMIT;
