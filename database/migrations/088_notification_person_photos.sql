/* Resolve a person photo only for a live, relevant notification claim. No general media or QR authority. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54600,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='087') THROW 54600,'Migration 087 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='088') THROW 54600,'Migration 088 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
CREATE PROCEDURE gp.ResolveNotificationPhoto @NotificationId bigint,@ClaimToken uniqueidentifier AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF @NotificationId IS NULL OR @NotificationId<1 OR @ClaimToken IS NULL THROW 52002,'Claim reference required.',1;
 DECLARE @visit uniqueidentifier,@now datetime2(3),@reason varchar(40),@result nvarchar(max);
 SELECT @visit=VisitRequestId FROM gp.NotificationOutbox WHERE NotificationId=@NotificationId AND Status='PROCESSING' AND LockedBy=@ClaimToken;
 IF @visit IS NULL THROW 52003,'Notification lease unavailable.',1;
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';
 DECLARE @visitLock nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@visit));EXEC gp._TakeLock @visitLock,'Shared';
 EXEC gp._TakeLock N'gp:outbox:claim';SET @now=SYSUTCDATETIME();
 IF NOT EXISTS(SELECT 1 FROM gp.NotificationOutbox WITH(UPDLOCK) WHERE NotificationId=@NotificationId AND VisitRequestId=@visit AND Status='PROCESSING' AND LockedBy=@ClaimToken AND @now<LockedUntilUtc) THROW 52003,'Notification lease unavailable.',1;
 EXEC gp._NotificationRelevance @NotificationId,@now,@reason OUTPUT;
 IF @reason IS NOT NULL THROW 52004,'Notification no longer relevant.',1;
 DECLARE @allowed bit=CASE WHEN EXISTS(SELECT 1 FROM gp.NotificationOutbox WHERE NotificationId=@NotificationId AND TemplateCode IN('HOST_APPROVAL_REQUEST','TEMP_ID_MANAGER_NOTICE','REQUEST_RECEIVED','VISIT_DECIDED','PASS_DELIVERY')) THEN 1 ELSE 0 END;
 SET @result=(SELECT v.VisitRequestId visitRequestId,CONVERT(bit,CASE WHEN @allowed=1 AND a.PurgedAtUtc IS NULL AND a.StorageKey IS NOT NULL AND a.ContentHash IS NOT NULL THEN 1 ELSE 0 END) available,
 CASE WHEN @allowed=1 AND a.PurgedAtUtc IS NULL THEN a.PhotoAssetId END photoAssetId,
 CASE WHEN @allowed=1 AND a.PurgedAtUtc IS NULL THEN a.StorageKey END storageKey,
 CASE WHEN @allowed=1 AND a.PurgedAtUtc IS NULL THEN a.MimeType END mimeType,
 CASE WHEN @allowed=1 AND a.PurgedAtUtc IS NULL THEN a.ByteLength END byteLength,
 CASE WHEN @allowed=1 AND a.PurgedAtUtc IS NULL THEN CONVERT(varchar(64),a.ContentHash,2) END contentHash
 FROM gp.VisitRequests v LEFT JOIN gp.PhotoAssets a ON a.PhotoAssetId=v.PhotoAssetId WHERE v.VisitRequestId=@visit AND v.PersonalDataPurgedAtUtc IS NULL FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 IF @result IS NULL THROW 52004,'Notification no longer relevant.',1;
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON OBJECT::gp.ResolveNotificationPhoto TO gp_worker_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('088',N'Fenced person photos for host, manager and holder notification emails');
COMMIT;
