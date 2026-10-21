/* Bounded office selector for an authenticated/capability-bound registration intake. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='020') THROW 52000,'Migration 020 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='021') THROW 52000,'Migration 021 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
CREATE PROCEDURE gp.ListRegistrationLocations
 @IntakeId uniqueidentifier,@TokenHash varbinary(8000),@IntakeCsrfHash varbinary(8000),@SessionHash varbinary(8000)=NULL,@CsrfHash varbinary(8000)=NULL
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 DECLARE @actor uniqueidentifier,@type varchar(12),@now datetime2(3),@result nvarchar(max),@resource nvarchar(255)=N'gp:intake:'+LOWER(CONVERT(char(36),@IntakeId));
 BEGIN TRY
  BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';
  EXEC gp._RequireRegistrationIntake @IntakeId,@TokenHash,@IntakeCsrfHash,@SessionHash,@CsrfHash,@actor OUTPUT,@type OUTPUT,@now OUTPUT;
  EXEC gp._TakeLock @resource,'Shared';
  EXEC gp._RequireRegistrationIntake @IntakeId,@TokenHash,@IntakeCsrfHash,@SessionHash,@CsrfHash,@actor OUTPUT,@type OUTPUT,@now OUTPUT;
  SET @result=(SELECT JSON_QUERY(COALESCE((SELECT TOP(100) LocationId locationId,LocationCode locationCode,LocationName locationName FROM gp.Locations WHERE IsActive=1 ORDER BY LocationId FOR JSON PATH),N'[]')) locations FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  EXEC gp._RequireRegistrationIntake @IntakeId,@TokenHash,@IntakeCsrfHash,@SessionHash,@CsrfHash,@actor OUTPUT,@type OUTPUT,@now OUTPUT;
  INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode) VALUES(@actor,'REGISTRATION_LOCATIONS_READ','REGISTRATION_INTAKE',CONVERT(varchar(36),@IntakeId),'SUCCESS');
  COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON gp.ListRegistrationLocations TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('021',N'Capability-bound bounded active office selector for registration');
COMMIT;
