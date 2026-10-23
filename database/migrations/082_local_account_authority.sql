/* Account creation requires the same staff credential authority as setup reissue. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54600,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='081') THROW 54600,'Migration 081 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='082') THROW 54600,'Migration 082 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
ALTER FUNCTION gp._CanProvisionStaff(@Actor uniqueidentifier,@Role varchar(24),@Location int,@Now datetime2(3)) RETURNS bit
AS BEGIN
 DECLARE @scope varchar(24)=CASE WHEN @Role='PLATFORM_ADMIN' THEN 'PLATFORM' WHEN @Role='INDIA_ADMIN' THEN 'INDIA' ELSE 'LOCATION' END,@targetLocation int=CASE WHEN @Role NOT IN('PLATFORM_ADMIN','INDIA_ADMIN') THEN @Location END;
 IF @Role NOT IN('GUARD','RECEPTION','LOCATION_ADMIN','INDIA_ADMIN','PLATFORM_ADMIN') RETURN 0;
 IF gp._StaffRoleDelegationAllowed(@Actor,@Role,@scope,@targetLocation,NULL,NULL,@Now)=0 RETURN 0;
 RETURN gp._AdminScopeAllowed(@Actor,'STAFF_CREDENTIALS_MANAGE',@targetLocation,NULL,@Now);
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('082',N'Align new local account creation with staff credential reset authority');COMMIT;
