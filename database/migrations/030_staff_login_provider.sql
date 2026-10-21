/* Provider choice is server/DB owned; local staff login does not depend on a directory API call. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='029') THROW 53600,'Migration 029 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='030') THROW 53600,'Migration 030 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
CREATE PROCEDURE gp.ResolveStaffLoginIdentity @LoginId nvarchar(4000)
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
 IF @LoginId IS NULL OR LEN(@LoginId) NOT BETWEEN 1 AND 320 OR DATALENGTH(@LoginId)<>DATALENGTH(LTRIM(RTRIM(@LoginId))) THROW 52602,'Invalid authentication input.',1;
 DECLARE @employee nvarchar(64),@result nvarchar(max);
 BEGIN TRY
  BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';
  SELECT @employee=e.EmployeeId FROM gp.Employees e JOIN gp.Users u ON u.UserId=e.UserId WHERE e.OfficialEmail=LOWER(@LoginId) COLLATE SQL_Latin1_General_CP1_CI_AS AND e.IsActive=1 AND u.IsActive=1;
  -- Unknown IDs follow normal local verification, including its dummy hash work and source budget.
  SET @result=(SELECT CASE WHEN @employee IS NULL THEN 'LOCAL' ELSE 'SSO' END provider,@employee employeeId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON gp.ResolveStaffLoginIdentity TO gp_staff_auth_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('030',N'Database-resolved employee and local staff login providers');
COMMIT;
