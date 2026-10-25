/* Owner/cancellation office presence and request-owned expired-occupant follow-ups. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54800,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='097') THROW 54800,'Migration 097 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='098') THROW 54800,'Migration 098 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
ALTER PROCEDURE gp.GetVisitDetail
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@View varchar(8000),@VisitRequestId uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 52800,'Ambient transaction not accepted.',1;
    IF @View IS NULL OR DATALENGTH(@View)<>LEN(@View) OR @View COLLATE Latin1_General_100_BIN2 NOT IN('OWN','HOST','GUARD','RECEPTION','ADMIN') OR @VisitRequestId IS NULL THROW 52802,'Invalid detail input.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@result nvarchar(max),@lock nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@VisitRequestId));
    BEGIN TRY
        BEGIN TRANSACTION; EXEC gp._TakeLock N'gp:authorization','Shared';
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        EXEC gp._TakeLock @lock,'Shared'; EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        EXEC gp._VisitReadJson @actor,@View,@VisitRequestId,@now,@result OUTPUT;
        -- Digital IDs record project presence separately; expose office presence only after the existing owner/admin authorization.
        IF @View IN('OWN','ADMIN') AND JSON_VALUE(@result,'$.requestType')='DIGITAL_ID'
            SET @result=JSON_MODIFY(@result,'$.isInside',CONVERT(bit,gp._PersonInsideOffice(@VisitRequestId)));
        COMMIT; SELECT @result;
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH;
END;
GO
ALTER PROCEDURE gp.CancelVisit
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
        IF gp._VisitReadAllowed(@actor,'OWN',@VisitRequestId,@now,@cutoff)=0 AND gp._VisitReadAllowed(@actor,'HOST',@VisitRequestId,@now,@cutoff)=0
            THROW 52001,'Not authorized.',1;
        SELECT @location=LocationId,@pair=ProjectLocationId,@state=Status FROM gp.VisitRequests WITH(UPDLOCK) WHERE VisitRequestId=@VisitRequestId;
        SELECT @pass=AccessPassId FROM gp.AccessPasses WITH(UPDLOCK) WHERE VisitRequestId=@VisitRequestId AND IsCurrent=1;
        IF @pass IS NULL OR @pass<>@ExpectedPassId THROW 52003,'Current pass changed; refresh the individual request.',1;
        IF @cached IS NOT NULL BEGIN COMMIT;SELECT @cached;RETURN;END;
        IF @state NOT IN('PENDING','APPROVED') OR EXISTS(SELECT 1 FROM gp.PassReturns WHERE VisitRequestId=@VisitRequestId)
            THROW 52005,'Visit cannot be cancelled.',1;
        SELECT @inside=CASE WHEN v.RequestType='TEMP_ID' THEN gp._PersonInsideOffice(v.VisitRequestId) ELSE s.IsInside END
            FROM gp.VisitRequests v JOIN gp.VisitPresence s WITH(UPDLOCK) ON s.VisitRequestId=v.VisitRequestId
            WHERE v.VisitRequestId=@VisitRequestId;
        IF @inside IS NULL THROW 52005,'Presence unavailable.',1;
        UPDATE gp.VisitRequests SET Status='CANCELLED',CancelledAtUtc=@now WHERE VisitRequestId=@VisitRequestId;
        UPDATE gp.AccessPasses SET Status='REVOKED',RevokedAtUtc=@now,RevocationReason=@Reason WHERE VisitRequestId=@VisitRequestId AND Status<>'REVOKED';
        UPDATE gp.PassDeliveryLinks SET RevokedAtUtc=COALESCE(RevokedAtUtc,@now) WHERE VisitRequestId=@VisitRequestId;
        UPDATE r SET ClaimToken=NULL,LeaseUntilUtc=NULL,FailureCode='RENDER_FAILED' FROM gp.PassPrintRenderState r JOIN gp.PassPrintJobs j ON j.PrintJobId=r.PrintJobId
            WHERE j.VisitRequestId=@VisitRequestId AND j.Status IN('REQUESTED','RENDERED');
        UPDATE gp.PassPrintJobs SET Status='FAILED',UpdatedAtUtc=@now WHERE VisitRequestId=@VisitRequestId AND Status IN('REQUESTED','RENDERED');
        UPDATE gp.NotificationOutbox SET Status='CANCELLED',LockedBy=NULL,LockedUntilUtc=NULL,LastErrorCode='VISIT_CANCELLED'
            WHERE VisitRequestId=@VisitRequestId AND Status IN('PENDING','PROCESSING');
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
ALTER PROCEDURE gp.ReadActionCentre @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@Workspace varchar(12),@LocationId int,@DutyKind varchar(10),@DutyId bigint,
 @Category varchar(20)='PENDING',@AfterSubmittedAtUtc datetime2(3)=NULL,@AfterVisitRequestId uniqueidentifier=NULL AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF @Workspace IS NULL OR @Workspace COLLATE Latin1_General_100_BIN2 NOT IN('GUARD','RECEPTION','ADMIN') OR @DutyKind IS NULL OR @DutyKind COLLATE Latin1_General_100_BIN2 NOT IN('PROJECT','COMMON','OFFICE') OR @LocationId IS NULL OR @DutyId IS NULL
 OR @Category IS NULL OR @Category COLLATE Latin1_General_100_BIN2 NOT IN('PENDING','EXPIRED_INSIDE','UNRETURNED') OR(@AfterSubmittedAtUtc IS NULL AND @AfterVisitRequestId IS NOT NULL) OR(@AfterSubmittedAtUtc IS NOT NULL AND @AfterVisitRequestId IS NULL) THROW 52002,'Invalid action scope.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@result nvarchar(max),@more bit=0,@afterTime datetime2(3),@afterId uniqueidentifier;
 DECLARE @matches table(VisitId uniqueidentifier PRIMARY KEY,Submitted datetime2(3),Pending bit,ExpiredInside bit,Unreturned bit);
 DECLARE @page table(VisitId uniqueidentifier PRIMARY KEY,Submitted datetime2(3));
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF gp._OperationsScopeAllowed(@actor,@Workspace,@LocationId,@DutyKind,@DutyId,@now)=0 THROW 52001,'Not authorized.',1;
 IF @Workspace='GUARD' AND @Category='UNRETURNED' THROW 52001,'Return follow-ups belong to reception.',1;
 INSERT @matches SELECT v.VisitRequestId,v.SubmittedAtUtc,flags.Pending,flags.ExpiredInside,flags.Unreturned FROM gp.VisitRequests v
 JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId
 -- Expired follow-ups belong to the visit that owns the actual entry, not another daily ID for the same person.
 CROSS APPLY(SELECT CONVERT(bit,CASE WHEN @Workspace='GUARD' AND @DutyKind='COMMON' THEN 0
 WHEN v.RequestType='TEMP_ID' THEN CASE WHEN EXISTS(SELECT 1 FROM gp.EmployeeProjectPresence ep
 JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=ep.ProjectLocationId
 WHERE ep.VisitRequestId=v.VisitRequestId AND ep.EmployeeId=v.EmployeeId AND ep.IsInside=1 AND pl.LocationId=v.LocationId
 AND(@Workspace<>'GUARD' OR ep.ProjectLocationId=@DutyId)) THEN 1 ELSE 0 END ELSE s.IsInside END) Inside) x
 CROSS APPLY(SELECT CONVERT(bit,CASE WHEN v.Status='PENDING' AND p.Status='PENDING' AND v.ValidUntilUtc>@now AND v.SubmittedAtUtc<=DATEADD(minute,-15,@now) AND NOT EXISTS(SELECT 1 FROM gp.PassReturns WHERE VisitRequestId=v.VisitRequestId) THEN 1 ELSE 0 END) Pending,
 CONVERT(bit,CASE WHEN x.Inside=1 AND v.ValidUntilUtc<=@now THEN 1 ELSE 0 END) ExpiredInside,
 CONVERT(bit,CASE WHEN @Workspace<>'GUARD' AND EXISTS(SELECT 1 FROM gp.PassPrintJobs WHERE VisitRequestId=v.VisitRequestId AND Status='DISPATCHED') AND NOT EXISTS(SELECT 1 FROM gp.PassReturns WHERE VisitRequestId=v.VisitRequestId) THEN 1 ELSE 0 END) Unreturned) flags
 WHERE v.LocationId=@LocationId AND(flags.Pending=1 OR flags.ExpiredInside=1 OR flags.Unreturned=1)
 AND(@Workspace='GUARD' AND gp._GuardDutyVisitAllowed(@actor,@DutyKind,@DutyId,@LocationId,v.VisitRequestId,@cutoff,@now)=1
 OR @Workspace='RECEPTION' AND gp._VisitReadAllowed(@actor,'RECEPTION',v.VisitRequestId,@now,@cutoff)=1
 OR @Workspace='ADMIN' AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',v.LocationId,v.ProjectLocationId,@now)=1);
 INSERT @page SELECT TOP(25) VisitId,Submitted FROM @matches WHERE(@Category='PENDING' AND Pending=1 OR @Category='EXPIRED_INSIDE' AND ExpiredInside=1 OR @Category='UNRETURNED' AND Unreturned=1)
 AND(@AfterSubmittedAtUtc IS NULL OR Submitted<@AfterSubmittedAtUtc OR Submitted=@AfterSubmittedAtUtc AND VisitId<@AfterVisitRequestId) ORDER BY Submitted DESC,VisitId DESC;
 IF(SELECT COUNT(*) FROM @page)>24 BEGIN SET @more=1;DELETE @page WHERE VisitId=(SELECT TOP(1) VisitId FROM @page ORDER BY Submitted,VisitId);END;
 IF @more=1 SELECT TOP(1) @afterTime=Submitted,@afterId=VisitId FROM @page ORDER BY Submitted,VisitId;
 EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 IF gp._OperationsScopeAllowed(@actor,@Workspace,@LocationId,@DutyKind,@DutyId,@now)=0 THROW 52001,'Scope changed.',1;
 EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF EXISTS(SELECT 1 FROM @matches m JOIN gp.VisitRequests v ON v.VisitRequestId=m.VisitId WHERE
 (@Workspace='GUARD' AND gp._GuardDutyVisitAllowed(@actor,@DutyKind,@DutyId,@LocationId,v.VisitRequestId,@cutoff,@now)=0)
 OR(@Workspace='RECEPTION' AND gp._VisitReadAllowed(@actor,'RECEPTION',v.VisitRequestId,@now,@cutoff)=0)
 OR(@Workspace='ADMIN' AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',v.LocationId,v.ProjectLocationId,@now)=0)) THROW 52001,'Scope changed during read.',1;
 SET @result=(SELECT @Category category,REPLACE(CONVERT(char(23),@now,121),' ','T')+'Z' checkedAtUtc,
 JSON_QUERY((SELECT COALESCE(SUM(CONVERT(int,Pending)),0) pending,COALESCE(SUM(CONVERT(int,ExpiredInside)),0) expiredInside,COALESCE(SUM(CONVERT(int,Unreturned)),0) unreturned FROM @matches FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) counts,
 JSON_QUERY((SELECT v.VisitRequestId visitRequestId,v.PersonName personName,CONVERT(char(10),v.LocalVisitDate,23) visitDate,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,
 REPLACE(CONVERT(char(23),q.Submitted,121),' ','T')+'Z' submittedAtUtc FROM @page q JOIN gp.VisitRequests v ON v.VisitRequestId=q.VisitId JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 ORDER BY q.Submitted DESC,q.VisitId DESC FOR JSON PATH)) items,
 @more hasMore,@afterId afterVisitRequestId,REPLACE(CONVERT(char(23),@afterTime,121),' ','T')+'Z' afterSubmittedAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,LocationId,ProjectLocationId,ResultCode) VALUES(@actor,'ACTION_CENTRE_READ','REPORT_QUERY',@LocationId,CASE WHEN @DutyKind='PROJECT' THEN @DutyId END,'SUCCESS');
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('098',N'Digital ID owner/cancellation presence and request-owned expired follow-ups');COMMIT;
