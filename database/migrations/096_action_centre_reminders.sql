/* Explicit, scoped reminders from Action centre; original immutable host only. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54800,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='095') THROW 54800,'Migration 095 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='096') THROW 54800,'Migration 096 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
CREATE PROCEDURE gp.RemindPendingApproval @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@VisitRequestId uniqueidentifier,@Workspace varchar(12),@DutyKind varchar(10),@ClientKey uniqueidentifier=NULL,@LocationId int=NULL,@DutyId bigint=NULL
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 54500,'Ambient transaction not accepted.',1;
 IF @VisitRequestId IS NULL OR @Workspace IS NULL OR DATALENGTH(@Workspace)<>LEN(@Workspace) OR @Workspace COLLATE Latin1_General_100_BIN2 NOT IN('RECEPTION','GUARD','ADMIN') OR @DutyKind IS NULL OR @DutyKind COLLATE Latin1_General_100_BIN2 NOT IN('PROJECT','COMMON','OFFICE') OR @LocationId IS NULL OR @DutyId IS NULL THROW 52002,'Invalid reminder.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@office int,@project bigint,@host nvarchar(64),@state varchar(12),@end datetime2(3),@deadline datetime2(3),@id bigint,@status varchar(12),@created datetime2(3),@reason varchar(40),@result nvarchar(max),@cached nvarchar(max),@oldVisit uniqueidentifier;
 BEGIN TRY
  BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
  DECLARE @resource nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@VisitRequestId));EXEC gp._TakeLock @resource;
  SELECT @office=LocationId,@project=ProjectLocationId,@host=HostEmployeeId,@state=Status,@end=ValidUntilUtc,@deadline=ApprovalDeadlineUtc FROM gp.VisitRequests WHERE VisitRequestId=@VisitRequestId AND RequestType IN('EXTERNAL','EMPLOYEE_PROJECT') AND PersonalDataPurgedAtUtc IS NULL;
  IF @office IS NULL THROW 52001,'Not authorized.',1;
  EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
  IF @LocationId<>@office OR gp._OperationsScopeAllowed(@actor,@Workspace,@LocationId,@DutyKind,@DutyId,@now)=0 THROW 52001,'Not authorized.',1;
  IF @Workspace='GUARD' AND gp._GuardDutyVisitAllowed(@actor,@DutyKind,@DutyId,@office,@VisitRequestId,@cutoff,@now)=0
   OR @Workspace='RECEPTION' AND gp._VisitReadAllowed(@actor,'RECEPTION',@VisitRequestId,@now,@cutoff)=0
   OR @Workspace='ADMIN' AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',@office,@project,@now)=0 THROW 52001,'Not authorized.',1;
  -- The claim lock serializes enqueue with worker claims; never reset an active lease.
  EXEC gp._TakeLock N'gp:outbox:claim';
  IF @ClientKey IS NOT NULL
  BEGIN
   SELECT @cached=ResultJson,@oldVisit=VisitRequestId FROM gp.HostReminderOperations WHERE ActorUserId=@actor AND ClientKey=@ClientKey;
   IF @cached IS NOT NULL BEGIN IF @oldVisit<>@VisitRequestId THROW 52003,'Idempotency key conflict.',1;COMMIT;SELECT @cached;RETURN;END;
  END;
  SELECT TOP(1) @id=NotificationId,@status=Status,@created=CreatedAtUtc FROM gp.NotificationOutbox WHERE VisitRequestId=@VisitRequestId AND TemplateCode='HOST_APPROVAL_REQUEST' ORDER BY NotificationId DESC;
  IF @id IS NULL THROW 52003,'Approval notification unavailable.',1;
  DECLARE @eligible bit=CASE WHEN @state='PENDING' AND @end>@now AND @deadline>@now AND NOT EXISTS(SELECT 1 FROM gp.PassReturns WHERE VisitRequestId=@VisitRequestId) AND EXISTS(SELECT 1 FROM gp.AccessPasses ap WHERE ap.VisitRequestId=@VisitRequestId AND ap.Status='PENDING' AND ap.PassVersion=(SELECT MAX(PassVersion) FROM gp.AccessPasses WHERE VisitRequestId=@VisitRequestId)) THEN 1 ELSE 0 END,@outcome varchar(16)='STATUS';
  IF @ClientKey IS NOT NULL
  BEGIN
   IF @eligible=0 THROW 52003,'Request no longer pending.',1;
   EXEC gp._NotificationRelevance @id,@now,@reason OUTPUT;
   IF @reason IS NOT NULL OR @status='CANCELLED' THROW 52003,'Host notification no longer available.',1;
   IF @status IN('PENDING','PROCESSING') SET @outcome='ALREADY_QUEUED';
   ELSE IF DATEADD(minute,5,@created)>@now SET @outcome='COOLDOWN';
   ELSE
   BEGIN
    INSERT gp.NotificationOutbox(VisitRequestId,RecipientKind,RecipientEmployeeId,TemplateCode,PayloadJson,DedupeHash)
     SELECT VisitRequestId,RecipientKind,RecipientEmployeeId,TemplateCode,PayloadJson,HASHBYTES('SHA2_256',CONVERT(char(36),@actor)+':'+CONVERT(char(36),@ClientKey)) FROM gp.NotificationOutbox WHERE NotificationId=@id;
    SET @id=SCOPE_IDENTITY();SET @created=@now;SET @status='PENDING';SET @outcome='QUEUED';
   END;
  END;
  SET @result=(SELECT @outcome outcome,CASE @status WHEN 'SENT' THEN 'SENT' WHEN 'DEAD' THEN 'FAILED' WHEN 'CANCELLED' THEN 'CANCELLED' ELSE 'QUEUED' END mailStatus,@eligible eligible,REPLACE(CONVERT(char(23),@created,121),' ','T')+'Z' lastQueuedAtUtc,REPLACE(CONVERT(char(23),DATEADD(minute,5,@created),121),' ','T')+'Z' nextReminderAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  IF @ClientKey IS NOT NULL
  BEGIN
   INSERT gp.HostReminderOperations(ActorUserId,ClientKey,VisitRequestId,ResultJson) VALUES(@actor,@ClientKey,@VisitRequestId,@result);
   INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode,MetadataJson) VALUES(@actor,'APPROVAL_REMINDER','VISIT',CONVERT(varchar(36),@VisitRequestId),@office,@project,'SUCCESS',@result);
  END;
  COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON gp.RemindPendingApproval TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('096',N'Scoped inline approval reminders with immutable recipient and queue deduplication');
COMMIT;
