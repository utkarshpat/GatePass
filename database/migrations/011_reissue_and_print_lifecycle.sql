/* Explicit credential replacement and reception print jobs. No printer/network
   calls under locks. Renderer attestation is a trusted, isolated server boundary. */
SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53100,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='010') THROW 53100,'Migration 010 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='011') THROW 53100,'Migration 011 already applied.',1;
BEGIN TRANSACTION;
CREATE TABLE gp.PassPrintRenderState (
    PrintJobId uniqueidentifier NOT NULL,
    ClaimToken uniqueidentifier NULL,
    LeaseUntilUtc datetime2(3) NULL,
    AttemptCount int NOT NULL CONSTRAINT DF_PrintRender_Attempts DEFAULT (0),
    SourceVisitStatus varchar(12) NULL,
    SourceSnapshotHash varbinary(32) NULL,
    SourcePhotoHash varbinary(32) NULL,
    ArtifactDigest varbinary(32) NULL,
    FailureCode varchar(40) NULL,
    CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_PrintRender_Created DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_PassPrintRenderState PRIMARY KEY(PrintJobId),
    CONSTRAINT CK_PrintRender_Lease CHECK ((ClaimToken IS NULL AND LeaseUntilUtc IS NULL) OR (ClaimToken IS NOT NULL AND LeaseUntilUtc IS NOT NULL)),
    CONSTRAINT CK_PrintRender_Attempts CHECK (AttemptCount BETWEEN 0 AND 3),
    CONSTRAINT CK_PrintRender_Source CHECK ((SourceVisitStatus IS NULL AND SourceSnapshotHash IS NULL AND SourcePhotoHash IS NULL) OR
        (SourceVisitStatus IS NOT NULL AND SourceVisitStatus IN('PENDING','APPROVED') AND SourceSnapshotHash IS NOT NULL AND DATALENGTH(SourceSnapshotHash)=32 AND SourcePhotoHash IS NOT NULL AND DATALENGTH(SourcePhotoHash)=32)),
    CONSTRAINT CK_PrintRender_Digest CHECK (ArtifactDigest IS NULL OR DATALENGTH(ArtifactDigest)=32),
    CONSTRAINT CK_PrintRender_Failure CHECK (FailureCode IS NULL OR FailureCode IN('RENDER_FAILED','STORAGE_UNAVAILABLE','KEY_UNAVAILABLE','STALE_CREDENTIAL','ATTEMPTS_EXHAUSTED'))
);
ALTER TABLE gp.PassPrintRenderState WITH CHECK ADD CONSTRAINT FK_PrintRender_Job FOREIGN KEY(PrintJobId) REFERENCES gp.PassPrintJobs(PrintJobId);
GO
CREATE PROCEDURE gp._RequireReceptionPass
    @Actor uniqueidentifier,@Visit uniqueidentifier,@Now datetime2(3),@Reissue bit=0
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS(SELECT 1 FROM gp.VisitRequests v JOIN gp.StaffRoleGrants g ON g.LocationId=v.LocationId
        JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='PASS_PRINT'
        WHERE v.VisitRequestId=@Visit AND g.UserId=@Actor AND g.RoleCode='RECEPTION' AND g.ScopeType='LOCATION'
        AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@Now AND (g.ValidUntilUtc IS NULL OR @Now<g.ValidUntilUtc)
        AND (@Reissue=0 OR EXISTS(SELECT 1 FROM gp.GrantCapabilities x WHERE x.RoleGrantId=g.RoleGrantId AND x.CapabilityCode='PASS_REISSUE')))
        THROW 53101,'Not authorized.',1;
END;
GO
CREATE PROCEDURE gp._RequirePrintablePass
    @Visit uniqueidentifier,@Pass uniqueidentifier,@Now datetime2(3),@AllowRevoked bit=0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @cutoff datetime2(3);EXEC gp._DirectoryCutoff @Now,@cutoff OUTPUT;
    IF NOT EXISTS(SELECT 1 FROM gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId
        JOIN gp.PhotoAssets a ON a.PhotoAssetId=v.PhotoAssetId JOIN gp.Locations l ON l.LocationId=v.LocationId
        WHERE v.VisitRequestId=@Visit AND p.AccessPassId=@Pass AND p.IsCurrent=1 AND v.PersonalDataPurgedAtUtc IS NULL
        AND v.Status IN('PENDING','APPROVED') AND @Now<v.ValidUntilUtc AND l.IsActive=1
        AND (v.Status='APPROVED' OR @Now<v.ApprovalDeadlineUtc)
        AND ((v.Status='PENDING' AND p.Status='PENDING') OR (v.Status='APPROVED' AND p.Status='ACTIVE') OR (@AllowRevoked=1 AND p.Status='REVOKED'))
        AND a.PurgedAtUtc IS NULL AND a.StorageKey IS NOT NULL AND a.ContentHash IS NOT NULL
        AND (v.ProjectLocationId IS NULL OR EXISTS(SELECT 1 FROM gp.ProjectLocations pl JOIN gp.Projects pj ON pj.ProjectId=pl.ProjectId
            WHERE pl.ProjectLocationId=v.ProjectLocationId AND pl.IsActive=1 AND pj.IsActive=1))
        AND (v.EmployeeId IS NULL OR EXISTS(SELECT 1 FROM gp.Employees e WHERE e.EmployeeId=v.EmployeeId AND e.IsActive=1 AND e.LastSyncedAtUtc BETWEEN @cutoff AND @Now)))
        THROW 53105,'Credential cannot be printed or replaced.',1;
END;
GO
CREATE PROCEDURE gp.ReissuePass
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ClientKey uniqueidentifier,@VisitRequestId uniqueidentifier,
    @ExpectedPassId uniqueidentifier,@Reason nvarchar(max),@NewAccessPassId uniqueidentifier=NULL,
    @CredentialHash varbinary(8000)=NULL,@Ciphertext varbinary(max)=NULL,@Nonce varbinary(8000)=NULL,@AuthenticationTag varbinary(8000)=NULL,@KeyVersion varchar(8000)=NULL
AS
BEGIN
    SET NOCOUNT ON;SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 53100,'Ambient transaction not accepted.',1;
    IF @VisitRequestId IS NULL OR @ExpectedPassId IS NULL OR @ClientKey IS NULL OR @Reason IS NULL OR DATALENGTH(@Reason) NOT BETWEEN 2 AND 600
        OR LEN(LTRIM(RTRIM(@Reason)))=0 THROW 53102,'Invalid reissue input.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@op uniqueidentifier,@cached nvarchar(max),@result nvarchar(max),@version int,@status varchar(12),
        @lock nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@VisitRequestId));
    BEGIN TRY
        BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        DECLARE @payload nvarchar(max)=(SELECT @VisitRequestId visitRequestId,@ExpectedPassId expectedPassId,@Reason reason FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        EXEC gp._BeginOperation @actor,'REISSUE_PASS',@ClientKey,@payload,@op OUTPUT,@cached OUTPUT;
        EXEC gp._TakeLock @lock;EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        EXEC gp._RequireReceptionPass @actor,@VisitRequestId,@now,1;
        IF @cached IS NOT NULL BEGIN COMMIT;SELECT @cached;RETURN;END;
        IF NOT EXISTS(SELECT 1 FROM gp.AccessPasses WHERE AccessPassId=@ExpectedPassId AND VisitRequestId=@VisitRequestId AND IsCurrent=1) THROW 53103,'Credential changed; refresh current visit.',1;
        EXEC gp._RequirePrintablePass @VisitRequestId,@ExpectedPassId,@now,1;
        IF @NewAccessPassId IS NULL AND @CredentialHash IS NULL AND @Ciphertext IS NULL AND @Nonce IS NULL AND @AuthenticationTag IS NULL AND @KeyVersion IS NULL
            BEGIN ROLLBACK;SELECT N'{"status":"NEEDS_CREDENTIALS"}';RETURN;END;
        IF @NewAccessPassId IS NULL OR @CredentialHash IS NULL OR DATALENGTH(@CredentialHash)<>32 OR @Ciphertext IS NULL OR DATALENGTH(@Ciphertext)<>32
            OR @Nonce IS NULL OR DATALENGTH(@Nonce)<>12 OR @AuthenticationTag IS NULL OR DATALENGTH(@AuthenticationTag)<>16 OR @KeyVersion IS NULL
            OR DATALENGTH(@KeyVersion) NOT BETWEEN 7 AND 86 OR @KeyVersion COLLATE Latin1_General_100_BIN2 NOT LIKE 'qr.v1.[A-Za-z0-9_-]%'
            OR SUBSTRING(@KeyVersion,7,8000) COLLATE Latin1_General_100_BIN2 LIKE '%[^A-Za-z0-9_-]%' OR DATALENGTH(@KeyVersion)<>LEN(@KeyVersion) THROW 53102,'Invalid replacement envelope.',1;
        SELECT @version=PassVersion FROM gp.AccessPasses WHERE AccessPassId=@ExpectedPassId;
        IF @version=2147483647 THROW 53105,'Credential version exhausted.',1;
        SELECT @status=CASE WHEN Status='APPROVED' THEN 'ACTIVE' ELSE 'PENDING' END FROM gp.VisitRequests WHERE VisitRequestId=@VisitRequestId;
        UPDATE gp.AccessPasses SET IsCurrent=0,Status='REVOKED',RevokedAtUtc=COALESCE(RevokedAtUtc,@now),RevocationReason=COALESCE(RevocationReason,@Reason) WHERE AccessPassId=@ExpectedPassId;
        UPDATE gp.PassDeliveryLinks SET RevokedAtUtc=COALESCE(RevokedAtUtc,@now) WHERE AccessPassId=@ExpectedPassId;
        INSERT gp.AccessPasses(AccessPassId,VisitRequestId,PassVersion,PublicPassNumber,CredentialHash,Status)
            VALUES(@NewAccessPassId,@VisitRequestId,@version+1,'GP-'+REPLACE(LOWER(CONVERT(char(36),@NewAccessPassId)),'-',''),@CredentialHash,@status);
        INSERT gp.PassSecrets(AccessPassId,Ciphertext,Nonce,AuthenticationTag,KeyVersion) VALUES(@NewAccessPassId,@Ciphertext,@Nonce,@AuthenticationTag,@KeyVersion);
        UPDATE gp.PassPrintJobs SET Status='FAILED',UpdatedAtUtc=@now WHERE AccessPassId=@ExpectedPassId AND Status IN('REQUESTED','RENDERED');
        UPDATE r SET ClaimToken=NULL,LeaseUntilUtc=NULL,FailureCode='STALE_CREDENTIAL' FROM gp.PassPrintRenderState r JOIN gp.PassPrintJobs j ON j.PrintJobId=r.PrintJobId
            WHERE j.AccessPassId=@ExpectedPassId AND j.Status='FAILED';
        EXEC gp._TakeLock N'gp:outbox:claim';
        UPDATE n SET Status='CANCELLED',LockedBy=NULL,LockedUntilUtc=NULL,LastErrorCode='CREDENTIAL_REISSUED' FROM gp.NotificationOutbox n
            JOIN gp.PassDeliveryLinks d ON d.DeliveryLinkId=n.DeliveryLinkId WHERE d.AccessPassId=@ExpectedPassId AND n.Status IN('PENDING','PROCESSING');
        SET @result=(SELECT 'REISSUED' status,@VisitRequestId visitRequestId,@ExpectedPassId replacedPassId,@NewAccessPassId accessPassId,@version+1 passVersion FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        INSERT gp.NotificationOutbox(VisitRequestId,RecipientKind,RecipientEmployeeId,RecipientEmail,TemplateCode,PayloadJson,DedupeHash)
            SELECT VisitRequestId,CASE WHEN EmployeeId IS NULL THEN 'EMAIL' ELSE 'EMPLOYEE' END,EmployeeId,
                CASE WHEN EmployeeId IS NULL THEN PersonEmail END,'PASS_REISSUED',@result,HASHBYTES('SHA2_256',CONVERT(char(36),@op)+':PASS_REISSUED')
            FROM gp.VisitRequests WHERE VisitRequestId=@VisitRequestId AND (EmployeeId IS NOT NULL OR PersonEmail IS NOT NULL);
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode,MetadataJson)
            SELECT @actor,'PASS_REISSUED','VISIT',CONVERT(varchar(36),VisitRequestId),LocationId,ProjectLocationId,'SUCCESS',
                (SELECT JSON_QUERY(@result) outcome,@Reason reason FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) FROM gp.VisitRequests WHERE VisitRequestId=@VisitRequestId;
        EXEC gp._CompleteOperation @op,@result;COMMIT;SELECT @result;
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp.RequestPassPrint
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ClientKey uniqueidentifier,@VisitRequestId uniqueidentifier,
    @ExpectedPassId uniqueidentifier,@PrinterLabel nvarchar(max)=NULL
AS
BEGIN
    SET NOCOUNT ON;SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 53100,'Ambient transaction not accepted.',1;
    IF @VisitRequestId IS NULL OR @ExpectedPassId IS NULL OR @ClientKey IS NULL OR DATALENGTH(@PrinterLabel)>200
        OR (@PrinterLabel IS NOT NULL AND LEN(LTRIM(RTRIM(@PrinterLabel)))=0) THROW 53102,'Invalid print request.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@op uniqueidentifier,@cached nvarchar(max),@result nvarchar(max),@job uniqueidentifier=NEWID(),@reason varchar(12),
        @lock nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@VisitRequestId));
    BEGIN TRY
        BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        DECLARE @payload nvarchar(max)=(SELECT @VisitRequestId visitRequestId,@ExpectedPassId expectedPassId,@PrinterLabel printerLabel FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER);
        EXEC gp._BeginOperation @actor,'REQUEST_PASS_PRINT',@ClientKey,@payload,@op OUTPUT,@cached OUTPUT;
        EXEC gp._TakeLock @lock;EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._RequireReceptionPass @actor,@VisitRequestId,@now;
        IF @cached IS NOT NULL BEGIN COMMIT;SELECT @cached;RETURN;END;
        EXEC gp._RequirePrintablePass @VisitRequestId,@ExpectedPassId,@now;
        -- An expired abandoned render may be explicitly replaced by a new job.
        UPDATE j SET Status='FAILED',UpdatedAtUtc=@now FROM gp.PassPrintJobs j JOIN gp.PassPrintRenderState r ON r.PrintJobId=j.PrintJobId
            WHERE j.AccessPassId=@ExpectedPassId AND j.Status IN('REQUESTED','RENDERED') AND COALESCE(r.LeaseUntilUtc,DATEADD(second,60,j.CreatedAtUtc))<=@now;
        UPDATE r SET ClaimToken=NULL,LeaseUntilUtc=NULL,FailureCode='RENDER_FAILED' FROM gp.PassPrintRenderState r JOIN gp.PassPrintJobs j ON j.PrintJobId=r.PrintJobId
            WHERE j.AccessPassId=@ExpectedPassId AND j.Status='FAILED' AND r.FailureCode IS NULL;
        IF EXISTS(SELECT 1 FROM gp.PassPrintJobs WHERE AccessPassId=@ExpectedPassId AND Status IN('REQUESTED','RENDERED')) THROW 53103,'Print already in progress.',1;
        SET @reason=CASE WHEN EXISTS(SELECT 1 FROM gp.PassPrintJobs WHERE AccessPassId=@ExpectedPassId) THEN 'REPRINT'
            WHEN EXISTS(SELECT 1 FROM gp.AccessPasses WHERE AccessPassId=@ExpectedPassId AND PassVersion>1) THEN 'REISSUE' ELSE 'FIRST' END;
        INSERT gp.PassPrintJobs(PrintJobId,AccessPassId,VisitRequestId,LocationId,RequestedByUserId,OperationId,PrintReason,Status,PrinterLabel)
            SELECT @job,@ExpectedPassId,@VisitRequestId,LocationId,@actor,@op,@reason,'REQUESTED',@PrinterLabel FROM gp.VisitRequests WHERE VisitRequestId=@VisitRequestId;
        INSERT gp.PassPrintRenderState(PrintJobId) VALUES(@job);
        SET @result=(SELECT @job printJobId,@VisitRequestId visitRequestId,@ExpectedPassId accessPassId,@reason printReason,'REQUESTED' status FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode,MetadataJson)
            SELECT @actor,'PASS_PRINT_REQUESTED','VISIT',CONVERT(varchar(36),VisitRequestId),LocationId,ProjectLocationId,'SUCCESS',@result FROM gp.VisitRequests WHERE VisitRequestId=@VisitRequestId;
        EXEC gp._CompleteOperation @op,@result;COMMIT;SELECT @result;
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp.GetPassPrintJob @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@PrintJobId uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON;SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 53100,'Ambient transaction not accepted.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@visit uniqueidentifier,@result nvarchar(max),@lock nvarchar(255);
    BEGIN TRY
        BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        SELECT @visit=VisitRequestId FROM gp.PassPrintJobs WHERE PrintJobId=@PrintJobId AND RequestedByUserId=@actor;
        IF @visit IS NULL THROW 53101,'Not authorized.',1;
        SET @lock=N'gp:visit:'+LOWER(CONVERT(char(36),@visit));EXEC gp._TakeLock @lock,'Shared';
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._RequireReceptionPass @actor,@visit,@now;
        SET @result=(SELECT j.PrintJobId printJobId,j.VisitRequestId visitRequestId,j.AccessPassId accessPassId,j.PrintReason printReason,j.Status status,r.FailureCode failureCode
            FROM gp.PassPrintJobs j JOIN gp.PassPrintRenderState r ON r.PrintJobId=j.PrintJobId WHERE j.PrintJobId=@PrintJobId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        COMMIT;SELECT @result;
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp._RequirePrintJob
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@Job uniqueidentifier,@Actor uniqueidentifier OUTPUT,@Now datetime2(3) OUTPUT,
    @Visit uniqueidentifier OUTPUT,@Pass uniqueidentifier OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    EXEC gp._RequireActor @SessionHash,@CsrfHash,@Actor OUTPUT,@Now OUTPUT;
    SET @Visit=NULL;SET @Pass=NULL;
    SELECT @Visit=VisitRequestId,@Pass=AccessPassId FROM gp.PassPrintJobs WHERE PrintJobId=@Job AND RequestedByUserId=@Actor;
    IF @Visit IS NULL THROW 53101,'Not authorized.',1;
    DECLARE @lock nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@Visit));EXEC gp._TakeLock @lock;
    EXEC gp._RequireActor @SessionHash,@CsrfHash,@Actor OUTPUT,@Now OUTPUT;EXEC gp._RequireReceptionPass @Actor,@Visit,@Now;
END;
GO
CREATE PROCEDURE gp.BeginPassRender
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@PrintJobId uniqueidentifier,@ClaimToken uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON;SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 53100,'Ambient transaction not accepted.',1;
    IF @PrintJobId IS NULL OR @ClaimToken IS NULL THROW 53102,'Invalid render claim.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@visit uniqueidentifier,@pass uniqueidentifier,@result nvarchar(max),@claim uniqueidentifier,@lease datetime2(3),@attempt int;
    BEGIN TRY
        BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';
        EXEC gp._RequirePrintJob @SessionHash,@CsrfHash,@PrintJobId,@actor OUTPUT,@now OUTPUT,@visit OUTPUT,@pass OUTPUT;
        EXEC gp._RequirePrintablePass @visit,@pass,@now;
        IF NOT EXISTS(SELECT 1 FROM gp.PassPrintJobs WHERE PrintJobId=@PrintJobId AND Status='REQUESTED') THROW 53105,'Job cannot render.',1;
        SELECT @claim=ClaimToken,@lease=LeaseUntilUtc,@attempt=AttemptCount FROM gp.PassPrintRenderState WHERE PrintJobId=@PrintJobId;
        IF @lease>@now AND @claim<>@ClaimToken THROW 53103,'Render already in progress.',1;
        IF @lease<=@now AND @claim=@ClaimToken THROW 53103,'Expired claim requires a fresh fencing token.',1;
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
                SourceVisitStatus=v.Status,SourceSnapshotHash=v.SnapshotHash,SourcePhotoHash=a.ContentHash,ArtifactDigest=NULL,FailureCode=NULL
                FROM gp.PassPrintRenderState r JOIN gp.PassPrintJobs j ON j.PrintJobId=r.PrintJobId JOIN gp.VisitRequests v ON v.VisitRequestId=j.VisitRequestId
                JOIN gp.PhotoAssets a ON a.PhotoAssetId=v.PhotoAssetId WHERE r.PrintJobId=@PrintJobId;
        END;
        -- Pending badges contain no QR; the renderer never receives their secret.
        SET @result=(SELECT j.PrintJobId printJobId,v.VisitRequestId visitRequestId,p.AccessPassId accessPassId,v.PersonName personName,
            CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END requestType,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,
            v.Status visitStatus,l.LocationName locationName,pj.ProjectName projectName,
            REPLACE(CONVERT(char(23),v.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc,
            a.PhotoAssetId photoAssetId,a.StorageKey storageKey,CONVERT(varchar(64),a.ContentHash,2) photoContentHash,a.MimeType mimeType,a.ByteLength byteLength,
            CASE WHEN v.Status='APPROVED' THEN CONVERT(varchar(64),p.CredentialHash,2) END credentialHash,
            CASE WHEN v.Status='APPROVED' THEN CONVERT(varchar(max),s.Ciphertext,2) END ciphertext,
            CASE WHEN v.Status='APPROVED' THEN CONVERT(varchar(24),s.Nonce,2) END nonce,
            CASE WHEN v.Status='APPROVED' THEN CONVERT(varchar(32),s.AuthenticationTag,2) END authenticationTag,
            CASE WHEN v.Status='APPROVED' THEN s.KeyVersion END keyVersion
            FROM gp.PassPrintJobs j JOIN gp.VisitRequests v ON v.VisitRequestId=j.VisitRequestId JOIN gp.AccessPasses p ON p.AccessPassId=j.AccessPassId
            JOIN gp.PassPrintRenderState r ON r.PrintJobId=j.PrintJobId JOIN gp.PhotoAssets a ON a.PhotoAssetId=v.PhotoAssetId JOIN gp.Locations l ON l.LocationId=v.LocationId
            LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId LEFT JOIN gp.Projects pj ON pj.ProjectId=pl.ProjectId
            LEFT JOIN gp.PassSecrets s ON s.AccessPassId=p.AccessPassId WHERE j.PrintJobId=@PrintJobId
            AND r.SourceVisitStatus=v.Status AND r.SourceSnapshotHash=v.SnapshotHash AND r.SourcePhotoHash=a.ContentHash FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        IF @result IS NULL OR (JSON_VALUE(@result,'$.visitStatus')='APPROVED' AND JSON_VALUE(@result,'$.ciphertext') IS NULL) THROW 53105,'Render source unavailable or changed.',1;
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode) VALUES(@actor,'PASS_RENDER_AUTHORIZED','VISIT',CONVERT(varchar(36),@visit),'SUCCESS');
        COMMIT;SELECT @result;
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp.FinishPassRender
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@PrintJobId uniqueidentifier,@ClaimToken uniqueidentifier,@ArtifactDigest varbinary(8000)
AS
BEGIN
    SET NOCOUNT ON;SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 53100,'Ambient transaction not accepted.',1;
    IF @PrintJobId IS NULL OR @ClaimToken IS NULL OR @ArtifactDigest IS NULL OR DATALENGTH(@ArtifactDigest)<>32 THROW 53102,'Invalid render completion.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@visit uniqueidentifier,@pass uniqueidentifier,@result nvarchar(max);
    BEGIN TRY
        BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';
        EXEC gp._RequirePrintJob @SessionHash,@CsrfHash,@PrintJobId,@actor OUTPUT,@now OUTPUT,@visit OUTPUT,@pass OUTPUT;
        EXEC gp._RequirePrintablePass @visit,@pass,@now;
        IF NOT EXISTS(SELECT 1 FROM gp.PassPrintRenderState r JOIN gp.VisitRequests v ON v.VisitRequestId=@visit JOIN gp.PhotoAssets a ON a.PhotoAssetId=v.PhotoAssetId
            JOIN gp.PassPrintJobs j ON j.PrintJobId=r.PrintJobId WHERE r.PrintJobId=@PrintJobId AND r.ClaimToken=@ClaimToken AND @now<r.LeaseUntilUtc
            AND r.SourceVisitStatus=v.Status AND r.SourceSnapshotHash=v.SnapshotHash AND r.SourcePhotoHash=a.ContentHash
            AND (j.Status='REQUESTED' OR j.Status='RENDERED' AND r.ArtifactDigest=@ArtifactDigest)) THROW 53103,'Render expired or source changed.',1;
        UPDATE gp.PassPrintRenderState SET ArtifactDigest=@ArtifactDigest WHERE PrintJobId=@PrintJobId;
        UPDATE gp.PassPrintJobs SET Status='RENDERED',UpdatedAtUtc=@now WHERE PrintJobId=@PrintJobId;
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode) VALUES(@actor,'PASS_RENDER_COMPLETED','VISIT',CONVERT(varchar(36),@visit),'SUCCESS');
        SET @result=(SELECT @PrintJobId printJobId,'RENDERED' status FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);COMMIT;SELECT @result;
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp.DispatchPassPrint
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@PrintJobId uniqueidentifier,@ClaimToken uniqueidentifier,@ArtifactDigest varbinary(8000)
AS
BEGIN
    SET NOCOUNT ON;SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 53100,'Ambient transaction not accepted.',1;
    IF @PrintJobId IS NULL OR @ClaimToken IS NULL OR @ArtifactDigest IS NULL OR DATALENGTH(@ArtifactDigest)<>32 THROW 53102,'Invalid print handoff.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@visit uniqueidentifier,@pass uniqueidentifier,@result nvarchar(max),@first bit=1;
    BEGIN TRY
        BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';
        EXEC gp._RequirePrintJob @SessionHash,@CsrfHash,@PrintJobId,@actor OUTPUT,@now OUTPUT,@visit OUTPUT,@pass OUTPUT;
        EXEC gp._RequirePrintablePass @visit,@pass,@now;
        IF NOT EXISTS(SELECT 1 FROM gp.PassPrintRenderState r JOIN gp.VisitRequests v ON v.VisitRequestId=@visit JOIN gp.PhotoAssets a ON a.PhotoAssetId=v.PhotoAssetId
            WHERE r.PrintJobId=@PrintJobId AND r.ClaimToken=@ClaimToken AND r.ArtifactDigest=@ArtifactDigest AND @now<r.LeaseUntilUtc
            AND r.SourceVisitStatus=v.Status AND r.SourceSnapshotHash=v.SnapshotHash AND r.SourcePhotoHash=a.ContentHash) THROW 53103,'Render expired or source changed.',1;
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
CREATE PROCEDURE gp.FailPassPrint
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@PrintJobId uniqueidentifier,@ClaimToken uniqueidentifier,@FailureCode varchar(8000)
AS
BEGIN
    SET NOCOUNT ON;SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 53100,'Ambient transaction not accepted.',1;
    IF @PrintJobId IS NULL OR @ClaimToken IS NULL OR @FailureCode IS NULL OR DATALENGTH(@FailureCode)<>LEN(@FailureCode)
        OR @FailureCode COLLATE Latin1_General_100_BIN2 NOT IN('RENDER_FAILED','STORAGE_UNAVAILABLE','KEY_UNAVAILABLE') THROW 53102,'Invalid render failure.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@visit uniqueidentifier,@pass uniqueidentifier;
    BEGIN TRY
        BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';
        EXEC gp._RequirePrintJob @SessionHash,@CsrfHash,@PrintJobId,@actor OUTPUT,@now OUTPUT,@visit OUTPUT,@pass OUTPUT;
        IF NOT EXISTS(SELECT 1 FROM gp.PassPrintRenderState r JOIN gp.PassPrintJobs j ON j.PrintJobId=r.PrintJobId WHERE r.PrintJobId=@PrintJobId
            AND r.ClaimToken=@ClaimToken AND @now<r.LeaseUntilUtc AND j.Status IN('REQUESTED','RENDERED')) THROW 53103,'Render claim unavailable.',1;
        UPDATE gp.PassPrintJobs SET Status='FAILED',UpdatedAtUtc=@now WHERE PrintJobId=@PrintJobId;
        UPDATE gp.PassPrintRenderState SET ClaimToken=NULL,LeaseUntilUtc=NULL,FailureCode=@FailureCode WHERE PrintJobId=@PrintJobId;
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,ResultCode) VALUES(@actor,'PASS_RENDER_FAILED','VISIT',CONVERT(varchar(36),@visit),'SUCCESS');
        COMMIT;SELECT N'{"status":"FAILED"}';
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
ALTER PROCEDURE gp._NotificationRelevance @NotificationId bigint,@Now datetime2(3),@Reason varchar(40) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;SET @Reason=NULL;
    DECLARE @visit uniqueidentifier,@link uniqueidentifier,@template varchar(40),@kind varchar(12),@recipient nvarchar(64),@email nvarchar(320),@payload nvarchar(max);
    SELECT @visit=VisitRequestId,@link=DeliveryLinkId,@template=TemplateCode,@kind=RecipientKind,@recipient=RecipientEmployeeId,@email=RecipientEmail,@payload=PayloadJson
        FROM gp.NotificationOutbox WHERE NotificationId=@NotificationId;
    IF @template NOT IN('HOST_APPROVAL_REQUEST','TEMP_ID_MANAGER_NOTICE','VISIT_DECIDED','PASS_DELIVERY','PASS_REISSUED') BEGIN SET @Reason='UNSUPPORTED_TEMPLATE';RETURN;END;
    IF @visit IS NULL BEGIN SET @Reason='MISSING_VISIT';RETURN;END;
    DECLARE @state varchar(12),@type varchar(24),@employee nvarchar(64),@personEmail nvarchar(320),@host nvarchar(64),@pair bigint,@location int,
        @deadline datetime2(3),@end datetime2(3),@project bigint,@cutoff datetime2(3);
    SELECT @state=Status,@type=RequestType,@employee=EmployeeId,@personEmail=PersonEmail,@host=HostEmployeeId,@pair=ProjectLocationId,
        @location=LocationId,@deadline=ApprovalDeadlineUtc,@end=ValidUntilUtc FROM gp.VisitRequests WHERE VisitRequestId=@visit;
    IF @state IS NULL BEGIN SET @Reason='MISSING_VISIT';RETURN;END;
    -- Replacement and issuance notices describe history; they carry no access link.
    IF @template='PASS_REISSUED'
    BEGIN
        IF TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.visitRequestId')) IS NULL
            OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.visitRequestId'))<>@visit OR NOT EXISTS(SELECT 1 FROM gp.AccessPasses
                WHERE AccessPassId=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.accessPassId')) AND VisitRequestId=@visit AND PassVersion>1)
            BEGIN SET @Reason='STATE_CHANGED';RETURN;END;
        IF (@employee IS NULL AND (@kind<>'EMAIL' OR @email IS NULL OR @personEmail IS NULL OR @email<>@personEmail))
            OR (@employee IS NOT NULL AND (@kind<>'EMPLOYEE' OR @recipient IS NULL OR @recipient<>@employee)) SET @Reason='RECIPIENT_MISMATCH';
        RETURN;
    END;
    IF @template='TEMP_ID_MANAGER_NOTICE'
    BEGIN
        IF @type<>'TEMP_ID' OR @kind<>'MANAGER' OR @recipient IS NULL OR @recipient<>@employee SET @Reason='RECIPIENT_MISMATCH';RETURN;
    END;
    IF @template='VISIT_DECIDED'
    BEGIN
        IF @state NOT IN('APPROVED','DENIED') OR NOT EXISTS(SELECT 1 FROM gp.ApprovalDecisions WHERE VisitRequestId=@visit AND Decision=@state)
            OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.visitRequestId')) IS NULL OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(@payload,'$.visitRequestId'))<>@visit
            OR JSON_VALUE(@payload,'$.decision') IS NULL OR JSON_VALUE(@payload,'$.decision')<>@state BEGIN SET @Reason='STATE_CHANGED';RETURN;END;
        IF (@employee IS NULL AND (@kind<>'EMAIL' OR @email IS NULL OR @personEmail IS NULL OR @email<>@personEmail))
            OR (@employee IS NOT NULL AND (@kind<>'EMPLOYEE' OR @recipient IS NULL OR @recipient<>@employee)) SET @Reason='RECIPIENT_MISMATCH';RETURN;
    END;
    IF NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@location AND IsActive=1) BEGIN SET @Reason='TARGET_INACTIVE';RETURN;END;
    IF @pair IS NOT NULL
    BEGIN
        SELECT @project=pl.ProjectId FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId WHERE pl.ProjectLocationId=@pair AND pl.IsActive=1 AND p.IsActive=1;
        IF @project IS NULL BEGIN SET @Reason='TARGET_INACTIVE';RETURN;END;
    END;
    IF @template='HOST_APPROVAL_REQUEST'
    BEGIN
        IF @state<>'PENDING' OR @deadline IS NULL OR @Now>=@deadline OR @Now>=@end BEGIN SET @Reason='STATE_CHANGED';RETURN;END;
        IF @kind<>'EMPLOYEE' OR @recipient IS NULL OR @recipient<>@host BEGIN SET @Reason='RECIPIENT_MISMATCH';RETURN;END;
        EXEC gp._DirectoryCutoff @Now,@cutoff OUTPUT;
        IF NOT EXISTS(SELECT 1 FROM gp.Employees WHERE EmployeeId=@host AND IsActive=1 AND LastSyncedAtUtc BETWEEN @cutoff AND @Now)
            OR NOT EXISTS(SELECT 1 FROM gp.EmployeeProjectMemberships WHERE EmployeeId=@host AND ProjectId=@project AND IsActive=1 AND VerifiedAtUtc BETWEEN @cutoff AND @Now)
            THROW 52004,'Current host directory data must be verified.',1;
        RETURN;
    END;
    IF @state<>'APPROVED' OR @Now>=@end OR @link IS NULL BEGIN SET @Reason='STATE_CHANGED';RETURN;END;
    DECLARE @linkEmail nvarchar(320);
    SELECT @linkEmail=l.RecipientEmail FROM gp.PassDeliveryLinks l JOIN gp.AccessPasses p ON p.AccessPassId=l.AccessPassId AND p.VisitRequestId=l.VisitRequestId
        WHERE l.DeliveryLinkId=@link AND l.VisitRequestId=@visit AND l.RevokedAtUtc IS NULL AND @Now<l.ExpiresAtUtc AND p.IsCurrent=1 AND p.Status='ACTIVE';
    IF @linkEmail IS NULL BEGIN SET @Reason='LINK_UNAVAILABLE';RETURN;END;
    IF @employee IS NULL
    BEGIN
        IF @kind<>'EMAIL' OR @email IS NULL OR @personEmail IS NULL OR @email<>@linkEmail OR @email<>@personEmail SET @Reason='RECIPIENT_MISMATCH';RETURN;
    END;
    EXEC gp._DirectoryCutoff @Now,@cutoff OUTPUT;DECLARE @official nvarchar(320);
    SELECT @official=OfficialEmail FROM gp.Employees WHERE EmployeeId=@employee AND IsActive=1 AND LastSyncedAtUtc BETWEEN @cutoff AND @Now;
    IF @official IS NULL THROW 52004,'Current employee directory data must be verified.',1;
    IF @kind<>'EMPLOYEE' OR @recipient IS NULL OR @recipient<>@employee OR @linkEmail<>@official SET @Reason='RECIPIENT_MISMATCH';
END;
GO
CREATE ROLE gp_render_runtime AUTHORIZATION dbo;
DENY SELECT,INSERT,UPDATE,DELETE,ALTER ON SCHEMA::gp TO gp_render_runtime;
GRANT EXECUTE ON gp.BeginPassRender TO gp_render_runtime;
GRANT EXECUTE ON gp.FinishPassRender TO gp_render_runtime;
GRANT EXECUTE ON gp.DispatchPassPrint TO gp_render_runtime;
GRANT EXECUTE ON gp.FailPassPrint TO gp_render_runtime;
GRANT EXECUTE ON gp.ReissuePass TO gp_api_runtime;
GRANT EXECUTE ON gp.RequestPassPrint TO gp_api_runtime;
GRANT EXECUTE ON gp.GetPassPrintJob TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('011',N'Explicit credential reissue and fenced isolated reception print lifecycle');
COMMIT;
