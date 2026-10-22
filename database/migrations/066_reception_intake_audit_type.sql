/* Audit public visitor intakes through the authenticated reception boundary. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54400,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='065') THROW 54400,'Migration 065 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='066') THROW 54400,'Migration 066 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
ALTER PROCEDURE gp.AuditReceptionRegistration
 @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@IntakeId uniqueidentifier,@TokenHash varbinary(8000),@IntakeCsrfHash varbinary(8000)
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 54400,'Ambient transaction not accepted.',1;
 DECLARE @actor uniqueidentifier,@unused uniqueidentifier,@now datetime2(3),@type varchar(12),@location int,@ref varchar(36)=LOWER(CONVERT(varchar(36),@IntakeId));
 BEGIN TRY
  BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';
  EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
  DECLARE @resource nvarchar(255)=N'gp:intake:'+@ref;EXEC gp._TakeLock @resource;
  EXEC gp._RequireRegistrationIntake @IntakeId,@TokenHash,@IntakeCsrfHash,NULL,NULL,@unused OUTPUT,@type OUTPUT,@now OUTPUT;
  IF @type<>'PUBLIC' OR NOT EXISTS(SELECT 1 FROM gp.RegistrationIntakes WHERE IntakeId=@IntakeId AND Status='SUBMITTED') THROW 53501,'Not authorized.',1;
  SELECT @location=MIN(LocationId) FROM gp.VisitRequests WHERE IntakeId=@IntakeId;
  IF @location IS NULL OR EXISTS(SELECT 1 FROM gp.VisitRequests WHERE IntakeId=@IntakeId AND (LocationId<>@location OR RequestType<>'EXTERNAL')) THROW 53501,'Not authorized.',1;
  EXEC gp._RequireReceptionLocation @actor,@location,@now;
  IF NOT EXISTS(SELECT 1 FROM gp.SecurityAuditEvents WHERE ActionCode='RECEPTION_MANUAL_REGISTER' AND TargetType='INTAKE' AND TargetReference=@ref)
   INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ResultCode) VALUES(@actor,'RECEPTION_MANUAL_REGISTER','INTAKE',@ref,@location,'SUCCESS');
  COMMIT;SELECT N'{"ok":true}';
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('066',N'Reception manual audit binds the PUBLIC intake type');
COMMIT;
