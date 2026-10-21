/* Preserve migration 022's key alphabet after the registration memory rewrite. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='044') THROW 52000,'Migration 044 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='045') THROW 52000,'Migration 045 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
DECLARE @definition nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID(N'gp.SubmitRegistration')),
 @old nvarchar(100)=N'LIKE N''%[^A-Za-z0-9._-]%''';
IF @definition IS NULL OR (LEN(@definition)-LEN(REPLACE(@definition,@old,N'')))<>LEN(@old) THROW 52000,'Unexpected QR validation module.',1;
SET @definition=REPLACE(REPLACE(@definition,N'CREATE PROCEDURE',N'ALTER PROCEDURE'),@old,N'LIKE N''%[^-A-Za-z0-9._]%''');
EXEC sys.sp_executesql @definition;
INSERT gp.SchemaMigrations(Version,Description) VALUES('045',N'Preserve the established QR key alphabet after bounded property validation');COMMIT;
