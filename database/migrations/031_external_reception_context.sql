/* Reception identity is independent of employee/SSO affiliation. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='030') THROW 53600,'Migration 030 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='031') THROW 53600,'Migration 031 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
ALTER PROCEDURE gp.GetReceptionContext @SessionHash varbinary(8000),@CsrfHash varbinary(8000)
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 53500,'Ambient transaction not accepted.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@employee nvarchar(64),@name nvarchar(200),@email nvarchar(320),@result nvarchar(max);
 BEGIN TRY
  BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
  IF EXISTS(SELECT 1 FROM gp.Employees WHERE UserId=@actor)
   EXEC gp._RequireRegistrationEmployee @actor,@now,@employee OUTPUT,@name OUTPUT,@email OUTPUT;
  ELSE BEGIN
   IF gp._StaffLocalIdentityEligible(@actor,@now)=0 THROW 53501,'Not authorized.',1;
   SELECT @name=DisplayName FROM gp.Users WHERE UserId=@actor;
  END;
  DECLARE @locations nvarchar(max)=(SELECT TOP(50) l.LocationId locationId,l.LocationName locationName,l.LocationCode locationCode,
   CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM gp.StaffRoleGrants p JOIN gp.GrantCapabilities pc ON pc.RoleGrantId=p.RoleGrantId AND pc.CapabilityCode='PASS_PRINT'
    WHERE p.UserId=@actor AND p.RoleCode='RECEPTION' AND p.ScopeType='LOCATION' AND p.LocationId=l.LocationId AND p.RevokedAtUtc IS NULL
     AND p.ValidFromUtc<=@now AND (p.ValidUntilUtc IS NULL OR @now<p.ValidUntilUtc)) THEN 1 ELSE 0 END) canPrint
   FROM gp.Locations l WHERE l.IsActive=1 AND EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='VISITS_READ'
    WHERE g.UserId=@actor AND g.RoleCode='RECEPTION' AND g.ScopeType='LOCATION' AND g.LocationId=l.LocationId AND g.RevokedAtUtc IS NULL
     AND g.ValidFromUtc<=@now AND (g.ValidUntilUtc IS NULL OR @now<g.ValidUntilUtc)) ORDER BY l.LocationName FOR JSON PATH);
  IF @locations IS NULL OR @locations=N'[]' THROW 53501,'Not authorized.',1;
  SET @result=(SELECT @name displayName,CONVERT(char(10),DATEADD(minute,330,@now),23) currentDate,JSON_QUERY(@locations) locations FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('031',N'External reception login context without employee directory affiliation');
COMMIT;
