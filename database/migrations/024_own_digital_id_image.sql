/* Owner-only Digital ID image source. Encrypted QR material is render-role only. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53400,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='023') THROW 53400,'Migration 023 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='024') THROW 53400,'Migration 024 already applied.',1;
BEGIN TRANSACTION;
GO
CREATE PROCEDURE gp.GetOwnDigitalIdCard
 @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@VisitRequestId uniqueidentifier
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 53400,'Ambient transaction not accepted.',1;
 IF @VisitRequestId IS NULL THROW 53402,'Invalid card request.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@pass uniqueidentifier,@details nvarchar(max),@digest varbinary(32),@result nvarchar(max),
  @lock nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@VisitRequestId));
 BEGIN TRY
  BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';
  EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
  EXEC gp._TakeLock @lock,'Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
  EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
  IF gp._VisitReadAllowed(@actor,'OWN',@VisitRequestId,@now,@cutoff)=0 OR NOT EXISTS(
    SELECT 1 FROM gp.VisitRequests WHERE VisitRequestId=@VisitRequestId AND RequestType='TEMP_ID' AND Status='APPROVED')
   THROW 53401,'Not authorized.',1;
  SELECT @pass=AccessPassId FROM gp.AccessPasses WHERE VisitRequestId=@VisitRequestId AND IsCurrent=1 AND Status='ACTIVE';
  IF @pass IS NULL THROW 53401,'Not authorized.',1;
  EXEC gp._RequirePrintablePass @VisitRequestId,@pass,@now;
  EXEC gp._ReadPrintCardDetails @VisitRequestId,@now,@details OUTPUT,@digest OUTPUT;
  SET @result=(SELECT v.VisitRequestId visitRequestId,p.AccessPassId accessPassId,'DIGITAL_ID' requestType,v.Status visitStatus,
    v.PersonName personName,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,l.LocationName locationName,
    REPLACE(CONVERT(char(23),v.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc,
    JSON_QUERY(@details) cardDetails,a.PhotoAssetId photoAssetId,a.StorageKey storageKey,a.MimeType mimeType,a.ByteLength byteLength,
    CONVERT(varchar(64),a.ContentHash,2) photoContentHash,CONVERT(varchar(64),p.CredentialHash,2) credentialHash,
    CONVERT(varchar(max),s.Ciphertext,2) ciphertext,CONVERT(varchar(24),s.Nonce,2) nonce,CONVERT(varchar(32),s.AuthenticationTag,2) authenticationTag,s.KeyVersion keyVersion
    FROM gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.AccessPassId=@pass
    JOIN gp.PhotoAssets a ON a.PhotoAssetId=v.PhotoAssetId JOIN gp.Locations l ON l.LocationId=v.LocationId
    JOIN gp.PassSecrets s ON s.AccessPassId=p.AccessPassId WHERE v.VisitRequestId=@VisitRequestId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  IF @result IS NULL OR JSON_VALUE(@result,'$.ciphertext') IS NULL THROW 53401,'Not authorized.',1;
  INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode)
    VALUES(@actor,'OWN_CARD_EXPORT_AUTHORIZED','VISIT',CONVERT(varchar(36),@VisitRequestId),'SUCCESS');
  COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON gp.GetOwnDigitalIdCard TO gp_render_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('024',N'Owner-only active Digital ID image export with render-role encrypted source');
COMMIT;
