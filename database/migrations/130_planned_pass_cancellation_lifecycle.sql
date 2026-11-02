/* A cancelled/revised invitation closes its old credential and print lifecycle.
   Occupancy and movement history remain for authorized destination exits. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='129') THROW 52000,'Migration 129 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='130') THROW 52000,'Migration 130 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
DECLARE @definition nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID('gp.ChangePlannedVisit'));
DECLARE @needle nvarchar(200)=N'SET @revision+=1;UPDATE gp.VisitPlans SET Revision=@revision WHERE PlanId=@PlanId;';
IF @definition IS NULL OR (LEN(@definition)-LEN(REPLACE(@definition,@needle,N'')))/LEN(@needle)<>1 THROW 52000,'Planning change lifecycle contract required.',1;
DECLARE @lifecycle nvarchar(max)=N'
 IF @kind IN(''CANCEL'',''REVISE'') BEGIN
  DECLARE @boundVisit uniqueidentifier,@boundLock nvarchar(255),@closeReason nvarchar(300)=CASE WHEN @kind=''CANCEL'' THEN N''Planned visit cancelled'' ELSE N''Planned visit revised; a new version requires a new registration binding'' END;
  DECLARE closeBound CURSOR LOCAL FAST_FORWARD FOR SELECT VisitRequestId FROM gp.PlannedPassBindings WHERE PlanId=@PlanId AND Version<=@previousVersion ORDER BY LOWER(CONVERT(char(36),VisitRequestId)) COLLATE Latin1_General_100_BIN2;
  OPEN closeBound;FETCH NEXT FROM closeBound INTO @boundVisit;
  WHILE @@FETCH_STATUS=0 BEGIN
   SET @boundLock=N''gp:visit:''+LOWER(CONVERT(char(36),@boundVisit));EXEC gp._TakeLock @boundLock;
   UPDATE gp.VisitRequests SET Status=''CANCELLED'',CancelledAtUtc=COALESCE(CancelledAtUtc,@now) WHERE VisitRequestId=@boundVisit;
   UPDATE gp.AccessPasses SET Status=''REVOKED'',RevokedAtUtc=@now,RevocationReason=@closeReason WHERE VisitRequestId=@boundVisit AND Status<>''REVOKED'';
   UPDATE gp.PassDeliveryLinks SET RevokedAtUtc=COALESCE(RevokedAtUtc,@now) WHERE VisitRequestId=@boundVisit;
   UPDATE r SET ClaimToken=NULL,LeaseUntilUtc=NULL,FailureCode=''RENDER_FAILED'' FROM gp.PassPrintRenderState r JOIN gp.PassPrintJobs j ON j.PrintJobId=r.PrintJobId WHERE j.VisitRequestId=@boundVisit AND j.Status IN(''REQUESTED'',''RENDERED'');
   UPDATE gp.PassPrintJobs SET Status=''FAILED'',UpdatedAtUtc=@now WHERE VisitRequestId=@boundVisit AND Status IN(''REQUESTED'',''RENDERED'');
   EXEC gp._TakeLock N''gp:outbox:claim'';
   UPDATE gp.NotificationOutbox SET Status=''CANCELLED'',LockedBy=NULL,LockedUntilUtc=NULL,LastErrorCode=''VISIT_CANCELLED'' WHERE VisitRequestId=@boundVisit AND Status IN(''PENDING'',''PROCESSING'');
   INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ResultCode,MetadataJson) VALUES(@actor,''PLANNED_PASS_CLOSED'',''VISIT'',CONVERT(varchar(36),@boundVisit),@location,''SUCCESS'',(SELECT @PlanId planId,@previousVersion previousVersion,@kind cause FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
   FETCH NEXT FROM closeBound INTO @boundVisit;
  END;CLOSE closeBound;DEALLOCATE closeBound;
 END;
 ';
SET @definition=REPLACE(@definition,@needle,@lifecycle+@needle);
SET @definition=STUFF(@definition,1,CHARINDEX(' ',@definition)-1,'ALTER');EXEC sys.sp_executesql @definition;
INSERT gp.SchemaMigrations(Version,Description) VALUES('130',N'Atomic planned cancellation/revision closes old credentials, delivery links, pending prints and notifications while preserving occupancy');
COMMIT;
