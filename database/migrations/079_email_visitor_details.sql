/* Project visitor company and declared devices in external email status and notification email details. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54600,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='078') THROW 54600,'Migration 078 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='079') THROW 54600,'Migration 079 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
ALTER PROCEDURE gp.ReadEmailRequest @VisitRequestId uniqueidentifier,@RecipientEmailHash varbinary(8000),@SnapshotHash varbinary(8000) AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;IF @@TRANCOUNT<>0 THROW 54100,'Ambient transaction not accepted.',1;
 IF @VisitRequestId IS NULL OR @RecipientEmailHash IS NULL OR DATALENGTH(@RecipientEmailHash)<>32 OR @SnapshotHash IS NULL OR DATALENGTH(@SnapshotHash)<>32 THROW 54102,'Invalid request.',1;
 DECLARE @now datetime2(3)=SYSUTCDATETIME(),@result nvarchar(max),@lock nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@VisitRequestId));
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock @lock,'Shared';
 IF NOT EXISTS(SELECT 1 FROM gp.VisitRequests WHERE VisitRequestId=@VisitRequestId AND RequestType='EXTERNAL' AND PersonEmail IS NOT NULL AND HASHBYTES('SHA2_256',LOWER(PersonEmail))=@RecipientEmailHash AND SnapshotHash=@SnapshotHash AND PersonalDataPurgedAtUtc IS NULL AND @now<DATEADD(day,1,ValidUntilUtc)) THROW 54101,'Request unavailable.',1;
 SET @result=(SELECT v.VisitRequestId visitRequestId,v.PersonName personName,v.CompanyName companyName,JSON_QUERY(v.DeviceTypesJson) deviceTypes,v.PublicReference publicReference,v.Status status,p.Status passStatus,l.LocationName locationName,pr.ProjectName projectName,h.FullName hostName,v.Reason reason,
 REPLACE(CONVERT(char(23),v.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc
 FROM gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 JOIN gp.Locations l ON l.LocationId=v.LocationId
 JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId JOIN gp.Projects pr ON pr.ProjectId=pl.ProjectId JOIN gp.Employees h ON h.EmployeeId=v.HostEmployeeId
 WHERE v.VisitRequestId=@VisitRequestId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
ALTER PROCEDURE gp.GetNotificationEmail @NotificationId bigint,@ClaimToken uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
    IF @@TRANCOUNT<>0 THROW 52000,'Ambient transactions are not accepted.',1;
    IF @NotificationId IS NULL OR @ClaimToken IS NULL THROW 52002,'Claim reference required.',1;
    DECLARE @visit uniqueidentifier,@found bit=0;
    SELECT @visit=VisitRequestId,@found=1 FROM gp.NotificationOutbox
        WHERE NotificationId=@NotificationId AND Status='PROCESSING' AND LockedBy=@ClaimToken;
    IF @found=0 THROW 52003,'Notification lease unavailable.',1;
    BEGIN TRY
        BEGIN TRANSACTION;
        EXEC gp._TakeLock N'gp:authorization','Shared';
        IF @visit IS NOT NULL
        BEGIN
            DECLARE @visitLock nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@visit));
            EXEC gp._TakeLock @visitLock,'Shared';
        END;
        EXEC gp._TakeLock N'gp:outbox:claim';
        DECLARE @now datetime2(3)=SYSUTCDATETIME();
        IF NOT EXISTS(SELECT 1 FROM gp.NotificationOutbox WITH(UPDLOCK) WHERE NotificationId=@NotificationId
            AND Status='PROCESSING' AND LockedBy=@ClaimToken AND @now<LockedUntilUtc)
            THROW 52003,'Notification lease unavailable.',1;
        DECLARE @reason varchar(40),@result nvarchar(max);
        EXEC gp._NotificationRelevance @NotificationId,@now,@reason OUTPUT;
        IF @reason IS NOT NULL
        BEGIN
            UPDATE gp.NotificationOutbox SET Status='CANCELLED',LockedBy=NULL,LockedUntilUtc=NULL,LastErrorCode=@reason
                WHERE NotificationId=@NotificationId;
            SET @result=(SELECT @NotificationId AS notificationId,'CANCELLED' AS status,@reason AS reasonCode FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
            INSERT gp.SecurityAuditEvents(ActionCode,TargetType,TargetReference,ResultCode,MetadataJson)
            VALUES('NOTIFICATION_CANCELLED','NOTIFICATION',CONVERT(varchar(100),@NotificationId),'SUCCESS',@result);
        END
        ELSE
            SELECT @result=(SELECT NotificationId AS notificationId,'READY' AS status,VisitRequestId AS visitRequestId,
                DeliveryLinkId AS deliveryLinkId,RecipientKind AS recipientKind,RecipientEmployeeId AS recipientEmployeeId,
                CASE WHEN RecipientKind='EMAIL' THEN RecipientEmail END AS recipientEmail,TemplateCode AS templateCode,
                JSON_QUERY(PayloadJson) AS payload,AttemptCount AS attemptCount,LockedUntilUtc AS leaseUntilUtc,
                JSON_QUERY((SELECT v.VisitRequestId visitRequestId,v.PublicReference publicReference,v.RequestType requestType,v.PersonName personName,v.CompanyName companyName,JSON_QUERY(v.DeviceTypesJson) deviceTypes,v.Reason purpose,v.Status visitStatus,
                l.LocationName locationName,p.ProjectName projectName,h.FullName hostName,
                CONVERT(varchar(64),v.SnapshotHash,2) snapshotHash,
                CONVERT(varchar(64),HASHBYTES('SHA2_256',LOWER(v.PersonEmail)),2) recipientEmailHash,
                REPLACE(CONVERT(char(23),v.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc
                FROM gp.VisitRequests v JOIN gp.Locations l ON l.LocationId=v.LocationId LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId
                LEFT JOIN gp.Projects p ON p.ProjectId=pl.ProjectId LEFT JOIN gp.Employees h ON h.EmployeeId=v.HostEmployeeId WHERE v.VisitRequestId=NotificationOutbox.VisitRequestId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) details
                FROM gp.NotificationOutbox WHERE NotificationId=@NotificationId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        COMMIT;
        SELECT @result AS ResultJson;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT>0 ROLLBACK;
        THROW;
    END CATCH;
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('079',N'Project visitor company and declared devices in email status and notifications');
COMMIT;
