/* Place literal hyphen first in SQL LIKE character sets. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54600,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='082') THROW 54600,'Migration 082 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='083') THROW 54600,'Migration 083 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
DECLARE @name sysname,@definition nvarchar(max);
DECLARE definitions CURSOR LOCAL FAST_FORWARD FOR SELECT OBJECT_NAME(object_id),definition FROM sys.sql_modules WHERE object_id IN(OBJECT_ID('gp.CreateLocalStaffAccount'),OBJECT_ID('gp.ManageGuardCredential'),OBJECT_ID('gp.BeginGuardLogin'),OBJECT_ID('gp.ManageStaffCredential'),OBJECT_ID('gp.BeginStaffLogin'));
OPEN definitions;FETCH NEXT FROM definitions INTO @name,@definition;
WHILE @@FETCH_STATUS=0 BEGIN
 IF @definition IS NULL OR CHARINDEX('[^a-z0-9@._-]',@definition)=0 THROW 54600,'Expected login validation unavailable.',1;
 SET @definition=REPLACE(@definition,'[^a-z0-9@._-]','[^-a-z0-9@._]');
 SET @definition=STUFF(@definition,1,CHARINDEX('PROCEDURE',@definition)+8,'ALTER PROCEDURE');
 EXEC sys.sp_executesql @definition;
 FETCH NEXT FROM definitions INTO @name,@definition;
END;
CLOSE definitions;DEALLOCATE definitions;
ALTER TABLE gp.GuardCredentials DROP CONSTRAINT CK_GuardCredentials_Login;
ALTER TABLE gp.GuardCredentials WITH CHECK ADD CONSTRAINT CK_GuardCredentials_Login CHECK
 (DATALENGTH(LoginId) BETWEEN 3 AND 64 AND DATALENGTH(LoginId)=LEN(LoginId) AND LoginId COLLATE Latin1_General_100_BIN2 NOT LIKE '%[^-a-z0-9@._]%' AND LoginId COLLATE Latin1_General_100_BIN2 NOT LIKE '[^a-z0-9]%');
INSERT gp.SchemaMigrations(Version,Description) VALUES('083',N'Accept literal hyphens consistently in local staff login IDs');COMMIT;
