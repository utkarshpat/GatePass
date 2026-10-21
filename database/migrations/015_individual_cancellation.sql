/* Individual cancellation and credential revocation. No new privilege or presence override. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='014') THROW 52000,'Migration 014 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='015') THROW 52000,'Migration 015 already applied.',1;
BEGIN TRANSACTION;
EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
CREATE PROCEDURE gp.CancelVisit
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ClientKey uniqueidentifier,
    @VisitRequestId uniqueidentifier,@ExpectedPassId uniqueidentifier,@Reason nvarchar(max)
AS
BEGIN
    SET NOCOUNT ON;SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 52000,'Ambient transactions are not accepted.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@op uniqueidentifier,@cached nvarchar(max),@result nvarchar(max);
    BEGIN TRY
        IF @VisitRequestId IS NULL OR @ExpectedPassId IS NULL OR @Reason IS NULL OR DATALENGTH(@Reason)>600 OR LEN(LTRIM(RTRIM(@Reason)))=0
            THROW 52002,'Invalid cancellation input.',1;
        BEGIN TRANSACTION;
        EXEC gp._TakeLock N'gp:authorization','Shared';
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        DECLARE @payload nvarchar(max)=(SELECT @VisitRequestId visitId,@ExpectedPassId expectedPassId,@Reason reason FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        EXEC gp._BeginOperation @actor,'CANCEL_VISIT',@ClientKey,@payload,@op OUTPUT,@cached OUTPUT;
        DECLARE @resource nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@VisitRequestId));
        EXEC gp._TakeLock @resource;
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        DECLARE @cutoff datetime2(3),@location int,@pair bigint,@state varchar(12),@pass uniqueidentifier,@inside bit;
        EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
        -- Same trusted individual ownership as protected OWN/HOST reads, never an admin/role-name bypass.
        IF gp._VisitReadAllowed(@actor,'OWN',@VisitRequestId,@now,@cutoff)=0 AND gp._VisitReadAllowed(@actor,'HOST',@VisitRequestId,@now,@cutoff)=0
            THROW 52001,'Not authorized.',1;
        SELECT @location=LocationId,@pair=ProjectLocationId,@state=Status FROM gp.VisitRequests WITH(UPDLOCK) WHERE VisitRequestId=@VisitRequestId;
        SELECT @pass=AccessPassId FROM gp.AccessPasses WITH(UPDLOCK) WHERE VisitRequestId=@VisitRequestId AND IsCurrent=1;
        IF @pass IS NULL OR @pass<>@ExpectedPassId THROW 52003,'Current pass changed; refresh the individual request.',1;
        -- Replays authenticate and reauthorize after waits; historical receipts never assert current presence.
        IF @cached IS NOT NULL BEGIN COMMIT;SELECT @cached;RETURN;END;
        IF @state NOT IN('PENDING','APPROVED') THROW 52005,'Visit cannot be cancelled.',1;
        SELECT @inside=IsInside FROM gp.VisitPresence WITH(UPDLOCK) WHERE VisitRequestId=@VisitRequestId;
        IF @inside IS NULL THROW 52005,'Presence unavailable.',1;
        UPDATE gp.VisitRequests SET Status='CANCELLED',CancelledAtUtc=@now WHERE VisitRequestId=@VisitRequestId;
        UPDATE gp.AccessPasses SET Status='REVOKED',RevokedAtUtc=@now,RevocationReason=@Reason WHERE VisitRequestId=@VisitRequestId AND Status<>'REVOKED';
        UPDATE gp.PassDeliveryLinks SET RevokedAtUtc=COALESCE(RevokedAtUtc,@now) WHERE VisitRequestId=@VisitRequestId;
        UPDATE r SET ClaimToken=NULL,LeaseUntilUtc=NULL,FailureCode='RENDER_FAILED' FROM gp.PassPrintRenderState r JOIN gp.PassPrintJobs j ON j.PrintJobId=r.PrintJobId
            WHERE j.VisitRequestId=@VisitRequestId AND j.Status IN('REQUESTED','RENDERED');
        UPDATE gp.PassPrintJobs SET Status='FAILED',UpdatedAtUtc=@now WHERE VisitRequestId=@VisitRequestId AND Status IN('REQUESTED','RENDERED');
        UPDATE gp.NotificationOutbox SET Status='CANCELLED',LockedBy=NULL,LockedUntilUtc=NULL,LastErrorCode='VISIT_CANCELLED'
            WHERE VisitRequestId=@VisitRequestId AND Status IN('PENDING','PROCESSING');
        -- Do not delete/reset presence, access history, approved decision, daily slot or encrypted credentials.
        SET @result=(SELECT @op operationId,@VisitRequestId visitRequestId,@pass accessPassId,'CANCELLED' status,@inside wasInsideAtCancellation FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        DECLARE @metadata nvarchar(max)=JSON_MODIFY(@result,'$.reason',@Reason);
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode,MetadataJson)
            VALUES(@actor,'VISIT_CANCELLED','VISIT',CONVERT(varchar(36),@VisitRequestId),@location,@pair,'SUCCESS',@metadata);
        EXEC gp._CompleteOperation @op,@result;
        COMMIT;SELECT @result;
    END TRY
    BEGIN CATCH
        DECLARE @error int=ERROR_NUMBER(),@target varchar(100)=CONVERT(varchar(36),@VisitRequestId);
        IF @@TRANCOUNT>0 ROLLBACK;
        EXEC gp._AuditFailure @actor,'VISIT_CANCELLATION_FAILED',@target,@error;
        THROW;
    END CATCH;
END;
GO
ALTER PROCEDURE gp._VisitReadJson
    @Actor uniqueidentifier,@View varchar(20),@Visit uniqueidentifier,@Now datetime2(3),@Result nvarchar(max) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @cutoff datetime2(3); EXEC gp._DirectoryCutoff @Now,@cutoff OUTPUT;
    IF gp._VisitReadAllowed(@Actor,@View,@Visit,@Now,@cutoff)=0 THROW 52801,'Not authorized.',1;
    DECLARE @location int,@pair bigint,@type varchar(24),@state varchar(12),@passState varchar(12),@inside bit,@from datetime2(3),@until datetime2(3),
        @employee nvarchar(64),@target bit=0,@photo bit=0,@normal bit=0,@entry bit=0,@exit bit=0,@reconcile bit=0,@decide bit=0;
    SELECT @location=v.LocationId,@pair=v.ProjectLocationId,@type=v.RequestType,@state=v.Status,@passState=p.Status,
        @inside=s.IsInside,@from=v.ValidFromUtc,@until=v.ValidUntilUtc,@employee=v.EmployeeId,
        @photo=CASE WHEN a.PurgedAtUtc IS NULL AND a.StorageKey IS NOT NULL AND a.ContentHash IS NOT NULL THEN 1 ELSE 0 END
    FROM gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1
        JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId JOIN gp.PhotoAssets a ON a.PhotoAssetId=v.PhotoAssetId WHERE v.VisitRequestId=@Visit;
    IF @location IS NULL THROW 52804,'Visit unavailable.',1;
    IF EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@location AND IsActive=1) AND (@pair IS NULL OR EXISTS(
        SELECT 1 FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId WHERE pl.ProjectLocationId=@pair AND pl.IsActive=1 AND p.IsActive=1)) SET @target=1;
    IF @View='HOST' AND @target=1 AND @state='PENDING' AND @passState='PENDING'
        AND EXISTS(SELECT 1 FROM gp.VisitRequests WHERE VisitRequestId=@Visit AND ApprovalDeadlineUtc>@Now) SET @decide=1;
    IF @View='GUARD'
    BEGIN
        DECLARE @cap varchar(40)=CASE WHEN @type='TEMP_ID' THEN 'TEMP_ID_MOVEMENT' ELSE 'PROJECT_MOVEMENT' END;
        IF gp._HasCapability(@Actor,@cap,@location,@pair,1,@Now)=1 AND (@pair IS NULL OR EXISTS(SELECT 1 FROM gp.GuardAssignments
            WHERE GuardUserId=@Actor AND ProjectLocationId=@pair AND DeallocatedAtUtc IS NULL AND ValidFromUtc<=@Now AND (ValidUntilUtc IS NULL OR @Now<ValidUntilUtc))) SET @normal=1;
        IF @normal=1 AND @target=1 AND @state='APPROVED' AND @passState='ACTIVE'
        BEGIN
            IF @inside=1 SET @exit=1;
            ELSE IF @from<=@Now AND @Now<@until AND @photo=1 AND (@employee IS NULL OR EXISTS(SELECT 1 FROM gp.Employees
                WHERE EmployeeId=@employee AND IsActive=1 AND LastSyncedAtUtc BETWEEN @cutoff AND @Now)) SET @entry=1;
        END;
        IF @inside=1 AND @exit=0 AND gp._HasCapability(@Actor,'RECONCILE_EXIT',@location,@pair,1,@Now)=1 SET @reconcile=1;
    END;
    SET @Result=(SELECT v.VisitRequestId visitRequestId,v.PublicReference publicReference,
        CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END requestType,v.PersonName personName,
        v.LocationId locationId,l.LocationName locationName,CONVERT(varchar(20),v.ProjectLocationId) projectLocationId,pj.ProjectName projectName,
        v.Status status,p.AccessPassId accessPassId,p.PublicPassNumber publicPassNumber,p.Status passStatus,s.IsInside isInside,
        REPLACE(CONVERT(char(23),v.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc,
        CASE WHEN @View<>'GUARD' THEN v.Reason END reason,CASE WHEN @View='HOST' THEN v.SnapshotVersion END snapshotVersion,
        CASE WHEN @View='HOST' THEN CONVERT(varchar(64),v.SnapshotHash,2) END snapshotHash,
        CONVERT(bit,CASE WHEN @View IN('OWN','HOST') AND @state IN('PENDING','APPROVED') THEN 1 ELSE 0 END) canCancel,
        @photo photoAvailable,@decide canDecide,@entry canEnter,@exit canExit,@reconcile canReconcileExit,
        REPLACE(CONVERT(char(23),@Now,121),' ','T')+'Z' checkedAtUtc
        FROM gp.VisitRequests v JOIN gp.Locations l ON l.LocationId=v.LocationId
        LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId LEFT JOIN gp.Projects pj ON pj.ProjectId=pl.ProjectId
        JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId
        WHERE v.VisitRequestId=@Visit FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
END;
GO
GRANT EXECUTE ON gp.CancelVisit TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('015',N'Individual cancellation, credential revocation and preserved exit reconciliation');
COMMIT;
