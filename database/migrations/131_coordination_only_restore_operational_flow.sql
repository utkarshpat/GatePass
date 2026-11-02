/* Scope correction: coordination is additive to the host/facilities workspace.
   Restore existing reception/card/guard behavior; preserve applied history and
   dormant schema. Refuse automatic restoration if any linked operational data exists. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='130') THROW 52000,'Migration 130 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='131') THROW 52000,'Migration 131 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
IF EXISTS(SELECT 1 FROM gp.PlannedPassBindings) OR EXISTS(SELECT 1 FROM gp.SubProjectVisitPresence) OR EXISTS(SELECT 1 FROM gp.PlannedAccessEventDestinations)
 THROW 52003,'Existing linked operational records require a reviewed preservation plan before restoring the ordinary flow.',1;
DECLARE @patches table(Position int IDENTITY,Name sysname,Needle nvarchar(max));
INSERT @patches(Name,Needle) VALUES
(N'gp.RecordMovement',N' IF EXISTS(SELECT 1 FROM gp.PlannedPassBindings WHERE VisitRequestId=@VisitRequestId) THROW 52001,''Use the planned destination workflow.'',1;'),
(N'gp.RecordGuardDutyMovement',N' IF EXISTS(SELECT 1 FROM gp.PlannedPassBindings WHERE VisitRequestId=@VisitRequestId) THROW 52001,''Use the planned destination workflow.'',1;'),
(N'gp.DecideVisit',N' IF EXISTS(SELECT 1 FROM gp.PlannedPassBindings WHERE VisitRequestId=@VisitRequestId) THROW 52001,''Use the planned destination workflow.'',1;'),
(N'gp.ReadGuardDutyPass',N' IF EXISTS(SELECT 1 FROM gp.PlannedPassBindings WHERE VisitRequestId=@visit) SET @detail=JSON_MODIFY(JSON_MODIFY(@detail,''$.canEnter'',CONVERT(bit,0)),''$.canExit'',CONVERT(bit,0));'),
(N'gp._VisitReadJson',N' (SELECT pr.ProjectName+N'' / ''+s.Name FROM gp.PlannedAccessEventDestinations d JOIN gp.SubProjects s ON s.SubProjectId=d.SubProjectId JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=s.AccountOfficeId JOIN gp.Projects pr ON pr.ProjectId=pl.ProjectId WHERE d.AccessEventId=e.AccessEventId) projectName,'),
(N'gp._VisitReadJson',N' AND(@View<>''GUARD'' OR NOT EXISTS(SELECT 1 FROM gp.PlannedAccessEventDestinations d JOIN gp.SubProjects sp ON sp.SubProjectId=d.SubProjectId WHERE d.AccessEventId=e.AccessEventId AND gp._GuardDutyAssigned(@Actor,''PROJECT'',sp.AccountOfficeId,sp.LocationId,@Now)=0))'),
(N'gp.ChangePlannedVisit',N'
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
 ');
DECLARE @name sysname,@needle nvarchar(max),@definition nvarchar(max);
DECLARE restoreFlow CURSOR LOCAL FAST_FORWARD FOR SELECT Name,Needle FROM @patches ORDER BY Position;
OPEN restoreFlow;FETCH NEXT FROM restoreFlow INTO @name,@needle;
WHILE @@FETCH_STATUS=0 BEGIN
 SET @definition=OBJECT_DEFINITION(OBJECT_ID(@name));
 IF @definition IS NOT NULL AND CHARINDEX(@needle,@definition)=0 BEGIN
  SET @needle=REPLACE(@needle,CHAR(13)+CHAR(10),CHAR(10));
  IF CHARINDEX(@needle,@definition)=0 SET @needle=REPLACE(@needle,CHAR(10),CHAR(13)+CHAR(10));
 END;
 IF @definition IS NULL OR CHARINDEX(@needle,@definition)=0 BEGIN
  DECLARE @failure nvarchar(2048)=N'Expected extension missing in '+@name+N'; restoration refused.';
  THROW 52000,@failure,1;
 END;
 SET @definition=REPLACE(@definition,@needle,N'');
 SET @definition=STUFF(@definition,1,CHARINDEX(' ',@definition)-1,'ALTER');EXEC sys.sp_executesql @definition;
 FETCH NEXT FROM restoreFlow INTO @name,@needle;
END;CLOSE restoreFlow;DEALLOCATE restoreFlow;
REVOKE EXECUTE ON gp.PlannedAccess FROM gp_api_runtime;
GO
ALTER PROCEDURE gp.PlannedAccess @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@Mode varchar(10),@PayloadJson nvarchar(max) AS BEGIN
 SET NOCOUNT ON;THROW 52001,'Retired extension. Use the existing registration, card and guard workflow.',1;
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('131',N'Coordination-only scope: remove reception linking and separate destination gates; restore ordinary operational procedures without erasing history');
COMMIT;
