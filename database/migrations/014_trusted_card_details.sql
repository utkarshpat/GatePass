/* Bind the approved compact card fields to trusted DB data and the render lease.
   No caller identity/project/purpose overrides and no external I/O under locks. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53100,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='013') THROW 53100,'Migration 013 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='014') THROW 53100,'Migration 014 already applied.',1;
BEGIN TRANSACTION;
EXEC gp._TakeLock N'gp:authorization','Exclusive';
ALTER TABLE gp.PassPrintRenderState ADD SourceCardDataHash varbinary(32) NULL;
GO
ALTER TABLE gp.PassPrintRenderState ADD CONSTRAINT CK_PrintRender_CardDataHash CHECK(SourceCardDataHash IS NULL OR DATALENGTH(SourceCardDataHash)=32);
UPDATE r SET ClaimToken=NULL,LeaseUntilUtc=NULL,FailureCode='RENDER_FAILED' FROM gp.PassPrintRenderState r JOIN gp.PassPrintJobs j ON j.PrintJobId=r.PrintJobId WHERE j.Status IN('REQUESTED','RENDERED');
UPDATE gp.PassPrintJobs SET Status='FAILED',UpdatedAtUtc=SYSUTCDATETIME() WHERE Status IN('REQUESTED','RENDERED');
GO
CREATE PROCEDURE gp._ReadPrintCardDetails
    @Visit uniqueidentifier,@Now datetime2(3),@Details nvarchar(max) OUTPUT,@Digest varbinary(32) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET @Details=NULL;SET @Digest=NULL;
    DECLARE @type varchar(24),@employee nvarchar(64),@host nvarchar(64),@hostName nvarchar(200),@purpose nvarchar(1000),@reason varchar(12),
        @cutoff datetime2(3),@projects nvarchar(max)=N'[]',@count int=0;
    EXEC gp._DirectoryCutoff @Now,@cutoff OUTPUT;
    SELECT @type=RequestType,@employee=EmployeeId,@host=HostEmployeeId,@purpose=Reason,@reason=TemporaryIdReason FROM gp.VisitRequests WHERE VisitRequestId=@Visit;
    IF @type IS NULL THROW 53105,'Card details unavailable.',1;
    IF @employee IS NOT NULL
    BEGIN
        IF NOT EXISTS(SELECT 1 FROM gp.Employees WHERE EmployeeId=@employee AND IsActive=1 AND LastSyncedAtUtc BETWEEN @cutoff AND @Now)
            THROW 53105,'Current employee data required for card.',1;
        -- Never silently turn stale active memberships into a partial assignment list.
        IF EXISTS(SELECT 1 FROM gp.EmployeeProjectMemberships m JOIN gp.Projects p ON p.ProjectId=m.ProjectId
            WHERE m.EmployeeId=@employee AND m.IsActive=1 AND p.IsActive=1
            AND (m.VerifiedAtUtc<@cutoff OR m.VerifiedAtUtc>@Now OR p.LastSyncedAtUtc IS NULL OR p.LastSyncedAtUtc<@cutoff OR p.LastSyncedAtUtc>@Now))
            THROW 53105,'Current project data required for card.',1;
        SELECT @count=COUNT(*) FROM gp.EmployeeProjectMemberships m JOIN gp.Projects p ON p.ProjectId=m.ProjectId WHERE m.EmployeeId=@employee AND m.IsActive=1 AND p.IsActive=1;
        SET @projects=(SELECT TOP(3) p.ExternalProjectCode code,p.ProjectName name FROM gp.EmployeeProjectMemberships m JOIN gp.Projects p ON p.ProjectId=m.ProjectId
            WHERE m.EmployeeId=@employee AND m.IsActive=1 AND p.IsActive=1 ORDER BY p.ExternalProjectCode COLLATE Latin1_General_100_BIN2 FOR JSON PATH);
    END;
    IF @type='EXTERNAL'
    BEGIN
        SELECT @hostName=FullName FROM gp.Employees WHERE EmployeeId=@host AND IsActive=1 AND LastSyncedAtUtc BETWEEN @cutoff AND @Now;
        IF @hostName IS NULL OR LEN(LTRIM(RTRIM(@hostName)))=0 THROW 53105,'Current host details required for card.',1;
    END
    ELSE SET @host=NULL;
    IF @type='TEMP_ID' SET @purpose=CASE @reason WHEN 'FORGOT' THEN N'Forgot physical ID' WHEN 'LOST' THEN N'Lost physical ID' WHEN 'OTHER' THEN N'ID card unavailable' END;
    IF @purpose IS NULL OR LEN(LTRIM(RTRIM(@purpose)))=0 THROW 53105,'Card purpose unavailable.',1;
    SET @Details=(SELECT @employee employeeId,@host hostEmployeeId,@hostName hostName,@purpose purpose,
        @count assignedProjectCount,JSON_QUERY(COALESCE(@projects,N'[]')) assignedProjects FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER);
    SET @Digest=HASHBYTES('SHA2_256',@Details);
END;
GO
ALTER PROCEDURE gp.BeginPassRender
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@PrintJobId uniqueidentifier,@ClaimToken uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON;SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 53100,'Ambient transaction not accepted.',1;
    IF @PrintJobId IS NULL OR @ClaimToken IS NULL THROW 53102,'Invalid render claim.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@visit uniqueidentifier,@pass uniqueidentifier,@result nvarchar(max),@claim uniqueidentifier,@lease datetime2(3),@attempt int,@cardDetails nvarchar(max),@cardHash varbinary(32);
    BEGIN TRY
        BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';
        EXEC gp._RequirePrintJob @SessionHash,@CsrfHash,@PrintJobId,@actor OUTPUT,@now OUTPUT,@visit OUTPUT,@pass OUTPUT;
        EXEC gp._RequirePrintablePass @visit,@pass,@now;
        EXEC gp._ReadPrintCardDetails @visit,@now,@cardDetails OUTPUT,@cardHash OUTPUT;
        IF NOT EXISTS(SELECT 1 FROM gp.PassPrintJobs WHERE PrintJobId=@PrintJobId AND Status='REQUESTED') THROW 53105,'Job cannot render.',1;
        SELECT @claim=ClaimToken,@lease=LeaseUntilUtc,@attempt=AttemptCount FROM gp.PassPrintRenderState WHERE PrintJobId=@PrintJobId;
        IF @lease>@now AND @claim<>@ClaimToken THROW 53103,'Render already in progress.',1;
        IF @lease<=@now AND @claim=@ClaimToken THROW 53103,'Expired claim requires a fresh fencing token.',1;
        IF @lease>@now AND @claim=@ClaimToken AND NOT EXISTS(SELECT 1 FROM gp.PassPrintRenderState WHERE PrintJobId=@PrintJobId AND SourceCardDataHash=@cardHash)
            THROW 53103,'Card details changed during the render claim.',1;
        IF @claim IS NULL OR @lease<=@now
        BEGIN
            IF @attempt>=3
            BEGIN
                UPDATE gp.PassPrintJobs SET Status='FAILED',UpdatedAtUtc=@now WHERE PrintJobId=@PrintJobId;
                UPDATE gp.PassPrintRenderState SET ClaimToken=NULL,LeaseUntilUtc=NULL,FailureCode='ATTEMPTS_EXHAUSTED' WHERE PrintJobId=@PrintJobId;
                INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode) VALUES(@actor,'PASS_RENDER_EXHAUSTED','VISIT',CONVERT(varchar(36),@visit),'SUCCESS');
                COMMIT;SELECT N'{"status":"FAILED","failureCode":"ATTEMPTS_EXHAUSTED"}';RETURN;
            END;
            UPDATE r SET ClaimToken=@ClaimToken,LeaseUntilUtc=DATEADD(second,60,@now),AttemptCount=AttemptCount+1,
                SourceCardDataHash=@cardHash,SourceVisitStatus=v.Status,SourceSnapshotHash=v.SnapshotHash,SourcePhotoHash=a.ContentHash,ArtifactDigest=NULL,FailureCode=NULL
                FROM gp.PassPrintRenderState r JOIN gp.PassPrintJobs j ON j.PrintJobId=r.PrintJobId JOIN gp.VisitRequests v ON v.VisitRequestId=j.VisitRequestId
                JOIN gp.PhotoAssets a ON a.PhotoAssetId=v.PhotoAssetId WHERE r.PrintJobId=@PrintJobId;
        END;
        -- Both pending and approved cards identify the individual; live project authorization remains separate.
        SET @result=(SELECT j.PrintJobId printJobId,v.VisitRequestId visitRequestId,p.AccessPassId accessPassId,v.PersonName personName,
            CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END requestType,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,
            v.Status visitStatus,l.LocationName locationName,pj.ProjectName projectName,JSON_QUERY(@cardDetails) cardDetails,
            REPLACE(CONVERT(char(23),v.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc,
            a.PhotoAssetId photoAssetId,a.StorageKey storageKey,CONVERT(varchar(64),a.ContentHash,2) photoContentHash,a.MimeType mimeType,a.ByteLength byteLength,
            CONVERT(varchar(64),p.CredentialHash,2) credentialHash,
            CONVERT(varchar(max),s.Ciphertext,2) ciphertext,
            CONVERT(varchar(24),s.Nonce,2) nonce,
            CONVERT(varchar(32),s.AuthenticationTag,2) authenticationTag,
            s.KeyVersion keyVersion
            FROM gp.PassPrintJobs j JOIN gp.VisitRequests v ON v.VisitRequestId=j.VisitRequestId JOIN gp.AccessPasses p ON p.AccessPassId=j.AccessPassId
            JOIN gp.PassPrintRenderState r ON r.PrintJobId=j.PrintJobId JOIN gp.PhotoAssets a ON a.PhotoAssetId=v.PhotoAssetId JOIN gp.Locations l ON l.LocationId=v.LocationId
            LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId LEFT JOIN gp.Projects pj ON pj.ProjectId=pl.ProjectId
            LEFT JOIN gp.PassSecrets s ON s.AccessPassId=p.AccessPassId WHERE j.PrintJobId=@PrintJobId
            AND r.SourceCardDataHash=@cardHash AND r.SourceVisitStatus=v.Status AND r.SourceSnapshotHash=v.SnapshotHash AND r.SourcePhotoHash=a.ContentHash FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        IF @result IS NULL OR JSON_VALUE(@result,'$.ciphertext') IS NULL THROW 53105,'Render source unavailable or changed.',1;
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode) VALUES(@actor,'PASS_RENDER_AUTHORIZED','VISIT',CONVERT(varchar(36),@visit),'SUCCESS');
        COMMIT;SELECT @result;
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
ALTER PROCEDURE gp.FinishPassRender
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@PrintJobId uniqueidentifier,@ClaimToken uniqueidentifier,@ArtifactDigest varbinary(8000)
AS
BEGIN
    SET NOCOUNT ON;SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 53100,'Ambient transaction not accepted.',1;
    IF @PrintJobId IS NULL OR @ClaimToken IS NULL OR @ArtifactDigest IS NULL OR DATALENGTH(@ArtifactDigest)<>32 THROW 53102,'Invalid render completion.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@visit uniqueidentifier,@pass uniqueidentifier,@result nvarchar(max);
    DECLARE @cardDetails nvarchar(max),@cardHash varbinary(32);
    BEGIN TRY
        BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';
        EXEC gp._RequirePrintJob @SessionHash,@CsrfHash,@PrintJobId,@actor OUTPUT,@now OUTPUT,@visit OUTPUT,@pass OUTPUT;
        EXEC gp._RequirePrintablePass @visit,@pass,@now;
        EXEC gp._ReadPrintCardDetails @visit,@now,@cardDetails OUTPUT,@cardHash OUTPUT;
        IF NOT EXISTS(SELECT 1 FROM gp.PassPrintRenderState r JOIN gp.VisitRequests v ON v.VisitRequestId=@visit JOIN gp.PhotoAssets a ON a.PhotoAssetId=v.PhotoAssetId
            JOIN gp.PassPrintJobs j ON j.PrintJobId=r.PrintJobId WHERE r.PrintJobId=@PrintJobId AND r.ClaimToken=@ClaimToken AND @now<r.LeaseUntilUtc
            AND r.SourceCardDataHash=@cardHash AND r.SourceVisitStatus=v.Status AND r.SourceSnapshotHash=v.SnapshotHash AND r.SourcePhotoHash=a.ContentHash
            AND (j.Status='REQUESTED' OR j.Status='RENDERED' AND r.ArtifactDigest=@ArtifactDigest)) THROW 53103,'Render expired or source changed.',1;
        UPDATE gp.PassPrintRenderState SET ArtifactDigest=@ArtifactDigest WHERE PrintJobId=@PrintJobId;
        UPDATE gp.PassPrintJobs SET Status='RENDERED',UpdatedAtUtc=@now WHERE PrintJobId=@PrintJobId;
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode) VALUES(@actor,'PASS_RENDER_COMPLETED','VISIT',CONVERT(varchar(36),@visit),'SUCCESS');
        SET @result=(SELECT @PrintJobId printJobId,'RENDERED' status FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);COMMIT;SELECT @result;
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
ALTER PROCEDURE gp.DispatchPassPrint
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@PrintJobId uniqueidentifier,@ClaimToken uniqueidentifier,@ArtifactDigest varbinary(8000)
AS
BEGIN
    SET NOCOUNT ON;SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 53100,'Ambient transaction not accepted.',1;
    IF @PrintJobId IS NULL OR @ClaimToken IS NULL OR @ArtifactDigest IS NULL OR DATALENGTH(@ArtifactDigest)<>32 THROW 53102,'Invalid print handoff.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@visit uniqueidentifier,@pass uniqueidentifier,@result nvarchar(max),@first bit=1;
    DECLARE @cardDetails nvarchar(max),@cardHash varbinary(32);
    BEGIN TRY
        BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';
        EXEC gp._RequirePrintJob @SessionHash,@CsrfHash,@PrintJobId,@actor OUTPUT,@now OUTPUT,@visit OUTPUT,@pass OUTPUT;
        EXEC gp._RequirePrintablePass @visit,@pass,@now;
        EXEC gp._ReadPrintCardDetails @visit,@now,@cardDetails OUTPUT,@cardHash OUTPUT;
        IF NOT EXISTS(SELECT 1 FROM gp.PassPrintRenderState r JOIN gp.VisitRequests v ON v.VisitRequestId=@visit JOIN gp.PhotoAssets a ON a.PhotoAssetId=v.PhotoAssetId
            WHERE r.PrintJobId=@PrintJobId AND r.ClaimToken=@ClaimToken AND r.ArtifactDigest=@ArtifactDigest AND @now<r.LeaseUntilUtc
            AND r.SourceCardDataHash=@cardHash AND r.SourceVisitStatus=v.Status AND r.SourceSnapshotHash=v.SnapshotHash AND r.SourcePhotoHash=a.ContentHash) THROW 53103,'Render expired or source changed.',1;
        IF EXISTS(SELECT 1 FROM gp.PassPrintJobs WHERE PrintJobId=@PrintJobId AND Status='DISPATCHED') SET @first=0;
        ELSE
        BEGIN
            IF NOT EXISTS(SELECT 1 FROM gp.PassPrintJobs WHERE PrintJobId=@PrintJobId AND Status='RENDERED') THROW 53105,'Job cannot dispatch.',1;
            UPDATE gp.PassPrintJobs SET Status='DISPATCHED',UpdatedAtUtc=@now WHERE PrintJobId=@PrintJobId;
            INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode) VALUES(@actor,'PASS_PRINT_HANDED_OFF','VISIT',CONVERT(varchar(36),@visit),'SUCCESS');
        END;
        SET @result=(SELECT @PrintJobId printJobId,'DISPATCHED' status,@first firstDispatch FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);COMMIT;SELECT @result;
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('014',N'Trusted employee, project and host print details bound to render claims');
COMMIT;
