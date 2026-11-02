/* Planning-only email dispatch. Existing registration/pass/guard procedures remain unchanged.
   Only notices inserted after this migration are queued; no historical backfill. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='131') THROW 52000,'Migration 131 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='132') THROW 52000,'Migration 132 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
CREATE TABLE gp.PlanningMailDispatch(
 PlanId uniqueidentifier NOT NULL,NoticeId uniqueidentifier NOT NULL,
 Status varchar(10) COLLATE Latin1_General_100_BIN2 NOT NULL DEFAULT('PENDING'),Attempts int NOT NULL DEFAULT(0),
 NextAttemptAtUtc datetime2(3) NOT NULL DEFAULT(SYSUTCDATETIME()),QueuedAtUtc datetime2(3) NOT NULL DEFAULT(SYSUTCDATETIME()),
 ClaimToken uniqueidentifier NULL,LeaseUntilUtc datetime2(3) NULL,CompletedAtUtc datetime2(3) NULL,
 LastErrorCode varchar(40) NULL,ProviderMessageId nvarchar(200) NULL,
 CONSTRAINT PK_PlanningMailDispatch PRIMARY KEY(NoticeId),
 CONSTRAINT FK_PlanningMailDispatch_Notice FOREIGN KEY(PlanId,NoticeId) REFERENCES gp.VisitPlanNotices(PlanId,NoticeId),
 CONSTRAINT CK_PlanningMailDispatch_Status CHECK(Status IN('PENDING','PROCESSING','SENT','DEAD','CANCELLED') AND Attempts BETWEEN 0 AND 6),
 CONSTRAINT CK_PlanningMailDispatch_Lease CHECK((Status='PROCESSING' AND ClaimToken IS NOT NULL AND LeaseUntilUtc IS NOT NULL) OR(Status<>'PROCESSING' AND ClaimToken IS NULL AND LeaseUntilUtc IS NULL)));
CREATE INDEX IX_PlanningMailDispatch_Claim ON gp.PlanningMailDispatch(Status,NextAttemptAtUtc,QueuedAtUtc) INCLUDE(Attempts,PlanId,LeaseUntilUtc);
GO
CREATE TRIGGER gp.QueuePlanningMail ON gp.VisitPlanNotices AFTER INSERT AS BEGIN
 SET NOCOUNT ON;
 INSERT gp.PlanningMailDispatch(PlanId,NoticeId) SELECT PlanId,NoticeId FROM inserted;
END;
GO
CREATE FUNCTION gp._PlanningMailAudience(@Plan uniqueidentifier,@Notice uniqueidentifier,@Now datetime2(3),@Cutoff datetime2(3)) RETURNS varchar(16) WITH INLINE=OFF AS BEGIN
 DECLARE @user uniqueidentifier,@host uniqueidentifier,@kind varchar(12),@target uniqueidentifier,@event varchar(20),@version int,@current int,@source int,@state varchar(12),@location int,@until datetime2(3),@vip bit;
 SELECT @user=n.RecipientUserId,@kind=n.Kind,@target=n.TargetId,@event=e.Kind,@version=e.Version FROM gp.VisitPlanNotices n JOIN gp.VisitPlanEvents e ON e.PlanId=n.PlanId AND e.Sequence=n.EventSequence WHERE n.PlanId=@Plan AND n.NoticeId=@Notice;
 SELECT @host=HostUserId,@state=State,@location=LocationId FROM gp.VisitPlans WHERE PlanId=@Plan;
 SELECT @current=Version FROM gp.VisitPlanVersions WHERE PlanId=@Plan AND IsCurrent=1;
 SET @source=@version;
 IF @event IN('REVISE','CANCEL') SELECT @source=MAX(Version) FROM gp.VisitPlanEvents WHERE PlanId=@Plan AND Kind='SUBMIT' AND Sequence<(SELECT EventSequence FROM gp.VisitPlanNotices WHERE PlanId=@Plan AND NoticeId=@Notice);
 SELECT @until=UntilUtc,@vip=IsVip FROM gp.VisitPlanVersions WHERE PlanId=@Plan AND Version=@source;
 IF @user IS NULL OR @current<>@version OR @until IS NULL OR NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@location AND IsActive=1) RETURN 'NONE';
 IF NOT EXISTS(SELECT 1 FROM gp.Users u JOIN gp.Employees e ON e.UserId=u.UserId WHERE u.UserId=@user AND u.IsActive=1 AND e.IsActive=1) RETURN 'NONE';
 IF gp._PlanningInternal(@user,@Now,@Cutoff)=0 RETURN 'DIRECTORY';
 IF @kind IN('UPDATE','CANCELLED') AND @event IN('REVISE','CANCEL') BEGIN
  IF @user=@host OR gp._PlanFullManager(@user,@Plan,@source,@Now)=1 OR gp._PlanOfficeParticipant(@user,@Plan,@source,@Now,@Cutoff)=1
   OR EXISTS(SELECT 1 FROM gp.VisitPlanApprovalSteps s WHERE s.PlanId=@Plan AND s.Version=@source AND gp._PlanLiveApprover(@user,@Plan,@source,s.StepId,@Now,@Cutoff)=1)
   OR EXISTS(SELECT 1 FROM gp.VisitPlanTasks t WHERE t.PlanId=@Plan AND t.Version=@source AND gp._PlanLiveTaskOwner(@user,@Plan,@source,t.TaskId,@Now,@Cutoff)=1) RETURN 'UPDATE';
 END ELSE BEGIN
  IF @state<>'SUBMITTED' OR @Now>=@until RETURN 'NONE';
  IF @kind='DISCUSSION' AND gp._PlanThreadReadable(@user,@Plan,@source,@target,@Now,@Cutoff)=1 RETURN 'DISCUSSION';
  IF @kind='UPDATE' AND gp._PlanVisible(@user,@Plan,@source,@Now,@Cutoff)=1 RETURN 'UPDATE';
  IF @kind IN('APPROVAL','ARRANGEMENT') BEGIN
   IF EXISTS(SELECT 1 FROM gp.Users u JOIN gp.Employees e ON e.UserId=u.UserId WHERE u.UserId=@host AND u.IsActive=1 AND e.IsActive=1) AND gp._PlanningInternal(@host,@Now,@Cutoff)=0 RETURN 'DIRECTORY';
   IF gp._PlanPolicyFresh(@Plan,@source)=0 OR gp._PlanningSponsor(@host,@location,@Now,@Cutoff)=0 RETURN 'NONE';
   IF @kind='APPROVAL' AND @user<>@host AND gp._PlanLiveApprover(@user,@Plan,@source,@target,@Now,@Cutoff)=1 AND gp._PlanStepStatus(@Plan,@source,@target,@Now,@Cutoff)='PENDING' RETURN 'APPROVAL';
   IF @kind='ARRANGEMENT' AND gp._PlanLiveTaskOwner(@user,@Plan,@source,@target,@Now,@Cutoff)=1 AND EXISTS(SELECT 1 FROM gp.VisitPlanTasks WHERE PlanId=@Plan AND Version=@source AND TaskId=@target AND Status IN('REQUESTED','IN_PROGRESS')) RETURN 'ARRANGEMENT';
   RETURN 'NONE';
  END;
 END;
 /* FYI is current-policy information, never membership or approval authority. */
 IF @kind IN('FYI','UPDATE','CANCELLED') AND EXISTS(SELECT 1 FROM gp.VisitPlanningPolicies p CROSS APPLY OPENJSON(p.DefinitionJson) r CROSS APPLY OPENJSON(CASE WHEN r.[key] IN('notifyIds','vipNotifyIds') THEN r.value ELSE N'[]' END) m
  WHERE p.LocationId=@location AND p.ScopeKind='LOCATION' AND p.IsActive=1 AND TRY_CONVERT(uniqueidentifier,m.value)=@user AND(r.[key]='notifyIds' OR r.[key]='vipNotifyIds' AND @vip=1)) RETURN 'FYI';
 RETURN 'NONE';
END;
GO
CREATE PROCEDURE gp.ClaimPlanningNotifications @BatchSize int=5,@LeaseSeconds int=120,@PlanId uniqueidentifier=NULL AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF @BatchSize IS NULL OR @BatchSize NOT BETWEEN 1 AND 5 OR @LeaseSeconds IS NULL OR @LeaseSeconds NOT BETWEEN 60 AND 300 THROW 52002,'Invalid mail claim.',1;
 DECLARE @now datetime2(3)=SYSUTCDATETIME();
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:planning-mail:claim';
 UPDATE gp.PlanningMailDispatch SET Status=CASE WHEN Attempts>=6 THEN 'DEAD' ELSE 'PENDING' END,ClaimToken=NULL,LeaseUntilUtc=NULL,NextAttemptAtUtc=@now,LastErrorCode='LEASE_EXPIRED',CompletedAtUtc=CASE WHEN Attempts>=6 THEN @now ELSE NULL END WHERE Status='PROCESSING' AND LeaseUntilUtc<=@now AND(@PlanId IS NULL OR PlanId=@PlanId);
 DECLARE @claims table(NoticeId uniqueidentifier,ClaimToken uniqueidentifier);
 ;WITH due AS(SELECT TOP(@BatchSize) * FROM gp.PlanningMailDispatch WITH(UPDLOCK) WHERE Status='PENDING' AND Attempts<6 AND NextAttemptAtUtc<=@now AND(@PlanId IS NULL OR PlanId=@PlanId) ORDER BY QueuedAtUtc,NoticeId)
 UPDATE due SET Status='PROCESSING',Attempts=Attempts+1,ClaimToken=NEWID(),LeaseUntilUtc=DATEADD(second,@LeaseSeconds,@now) OUTPUT inserted.NoticeId,inserted.ClaimToken INTO @claims;
 COMMIT;SELECT COALESCE((SELECT NoticeId noticeId,ClaimToken claimToken FROM @claims ORDER BY NoticeId FOR JSON PATH),N'[]');
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp._PlanningMailJson @Plan uniqueidentifier,@NoticeId uniqueidentifier,@Now datetime2(3),@Cutoff datetime2(3),@Result nvarchar(max) OUTPUT AS BEGIN
 SET NOCOUNT ON;
 DECLARE @source int,@current int,@kind varchar(12),@event varchar(20),@target uniqueidentifier,@recipient uniqueidentifier,@audience varchar(16)=gp._PlanningMailAudience(@Plan,@NoticeId,@Now,@Cutoff),@sub uniqueidentifier,@stay bit=0;
 IF @audience='DIRECTORY' THROW 52004,'Current directory required.',1;
 IF @audience='NONE' BEGIN SET @Result=(SELECT 'CANCELLED' status,@NoticeId noticeId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);RETURN;END;
 SELECT @source=CASE WHEN e.Kind='REVISE' THEN e.Version-1 ELSE e.Version END,@kind=n.Kind,@event=e.Kind,@target=n.TargetId,@recipient=n.RecipientUserId FROM gp.VisitPlanNotices n JOIN gp.VisitPlanEvents e ON e.PlanId=n.PlanId AND e.Sequence=n.EventSequence WHERE n.PlanId=@Plan AND n.NoticeId=@NoticeId;
 IF @event IN('REVISE','CANCEL') SELECT @source=MAX(Version) FROM gp.VisitPlanEvents WHERE PlanId=@Plan AND Kind='SUBMIT' AND Sequence<(SELECT EventSequence FROM gp.VisitPlanNotices WHERE PlanId=@Plan AND NoticeId=@NoticeId);
 SELECT @current=Version FROM gp.VisitPlanVersions WHERE PlanId=@Plan AND IsCurrent=1;
 IF @audience='APPROVAL' SELECT @sub=SubProjectId FROM gp.VisitPlanApprovalSteps WHERE PlanId=@Plan AND Version=@source AND StepId=@target;
 IF @audience='DISCUSSION' SELECT @sub=SubProjectId FROM gp.VisitPlanThreads WHERE PlanId=@Plan AND Version=@source AND ThreadId=@target;
 IF @audience='ARRANGEMENT' AND EXISTS(SELECT 1 FROM gp.VisitPlanTasks WHERE PlanId=@Plan AND Version=@source AND TaskId=@target AND Kind='STAY') SET @stay=1;
 SET @result=(SELECT 'READY' status,@NoticeId noticeId,@plan planId,@kind kind,@audience audience,@event eventKind,@source version,e.OfficialEmail recipientEmail,
  CONVERT(bit,CASE WHEN @audience<>'FYI' AND gp._PlanVisible(@recipient,@plan,@current,@now,@cutoff)=1 THEN 1 ELSE 0 END) canReview,
  JSON_QUERY((SELECT v.VisitorName visitorName,v.Company company,l.LocationName locationName,h.FullName hostName,v.IsVip vip,
   REPLACE(CONVERT(char(23),v.StartsAtUtc,121),' ','T')+'Z' startsAtUtc,REPLACE(CONVERT(char(23),v.UntilUtc,121),' ','T')+'Z' untilUtc,
   CASE WHEN @audience='APPROVAL' THEN(SELECT Name FROM gp.VisitPlanApprovalSteps WHERE PlanId=@plan AND Version=@source AND StepId=@target)
    WHEN @audience='ARRANGEMENT' THEN(SELECT Name FROM gp.VisitPlanTasks WHERE PlanId=@plan AND Version=@source AND TaskId=@target)
    WHEN @audience='DISCUSSION' THEN(SELECT Title FROM gp.VisitPlanThreads WHERE PlanId=@plan AND Version=@source AND ThreadId=@target) END targetName,
   JSON_QUERY(COALESCE((SELECT s.Name name,pr.ProjectName accountName FROM gp.VisitPlanProjects d JOIN gp.SubProjects s ON s.SubProjectId=d.SubProjectId JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=s.AccountOfficeId JOIN gp.Projects pr ON pr.ProjectId=pl.ProjectId
    WHERE d.PlanId=@plan AND d.Version=@source AND @audience IN('APPROVAL','DISCUSSION') AND(@sub IS NULL OR d.SubProjectId=@sub) AND gp._PlanProjectReadable(@recipient,@plan,@source,d.SubProjectId,@now,@cutoff)=1 ORDER BY pr.ProjectName,s.Name,s.SubProjectId FOR JSON PATH),N'[]')) destinations,
   CASE WHEN @stay=1 THEN CONVERT(char(10),v.StayCheckInDate,23) END checkInDate,CASE WHEN @stay=1 THEN CONVERT(char(10),v.StayCheckOutDate,23) END checkOutDate,
   CASE WHEN @stay=1 THEN v.StayNotes END stayNotes
   FROM gp.VisitPlanVersions v JOIN gp.Locations l ON l.LocationId=v.LocationId JOIN gp.VisitPlans p ON p.PlanId=v.PlanId JOIN gp.Employees h ON h.UserId=p.HostUserId WHERE v.PlanId=@plan AND v.Version=@source FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) details
  FROM gp.Employees e WHERE e.UserId=@recipient FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
END;
GO
CREATE PROCEDURE gp.GetPlanningNotification @NoticeId uniqueidentifier,@ClaimToken uniqueidentifier AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF @NoticeId IS NULL OR @ClaimToken IS NULL THROW 52002,'Invalid planning mail.',1;
 DECLARE @now datetime2(3)=SYSUTCDATETIME(),@cutoff datetime2(3),@plan uniqueidentifier,@source int,@current int,@kind varchar(12),@event varchar(20),@target uniqueidentifier,@recipient uniqueidentifier,@audience varchar(16),@result nvarchar(max),@lock nvarchar(255),@sub uniqueidentifier;
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 SELECT @plan=PlanId FROM gp.PlanningMailDispatch WHERE NoticeId=@NoticeId AND Status='PROCESSING' AND ClaimToken=@ClaimToken AND LeaseUntilUtc>@now;
 IF @plan IS NULL THROW 52003,'Mail lease unavailable.',1;
 SET @lock=N'gp:visit-plan:'+CONVERT(nvarchar(36),@plan);EXEC gp._TakeLock @lock,'Shared';
 SET @now=SYSUTCDATETIME();EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF NOT EXISTS(SELECT 1 FROM gp.PlanningMailDispatch WHERE NoticeId=@NoticeId AND Status='PROCESSING' AND ClaimToken=@ClaimToken AND LeaseUntilUtc>@now) THROW 52003,'Mail lease unavailable.',1;
 EXEC gp._PlanningMailJson @plan,@NoticeId,@now,@cutoff,@result OUTPUT;
 IF JSON_VALUE(@result,'$.status')='CANCELLED' UPDATE gp.PlanningMailDispatch SET Status='CANCELLED',ClaimToken=NULL,LeaseUntilUtc=NULL,CompletedAtUtc=@now,LastErrorCode='NOT_RELEVANT' WHERE NoticeId=@NoticeId AND ClaimToken=@ClaimToken;
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp.RenewPlanningNotificationLease @NoticeId uniqueidentifier,@ClaimToken uniqueidentifier,@LeaseSeconds int=120 AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF @NoticeId IS NULL OR @ClaimToken IS NULL OR @LeaseSeconds IS NULL OR @LeaseSeconds NOT BETWEEN 60 AND 300 THROW 52002,'Invalid mail lease.',1;
 DECLARE @now datetime2(3)=SYSUTCDATETIME();
 UPDATE gp.PlanningMailDispatch SET LeaseUntilUtc=DATEADD(second,@LeaseSeconds,@now) WHERE NoticeId=@NoticeId AND Status='PROCESSING' AND ClaimToken=@ClaimToken AND LeaseUntilUtc>@now;
 IF @@ROWCOUNT<>1 THROW 52003,'Mail lease unavailable.',1;
 SELECT N'{"ok":true}';
END;
GO
CREATE PROCEDURE gp.CompletePlanningNotification @NoticeId uniqueidentifier,@ClaimToken uniqueidentifier,@Outcome varchar(10),@ErrorCode varchar(40)=NULL,@ProviderMessageId nvarchar(200)=NULL AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF @NoticeId IS NULL OR @ClaimToken IS NULL OR @Outcome IS NULL OR @Outcome COLLATE Latin1_General_100_BIN2 NOT IN('SENT','FAILED') OR DATALENGTH(@Outcome)<>LEN(@Outcome)
  OR(@Outcome='SENT' AND @ErrorCode IS NOT NULL) OR(@Outcome='FAILED' AND(@ErrorCode IS NULL OR @ErrorCode COLLATE Latin1_General_100_BIN2 NOT IN('DIRECTORY_UNAVAILABLE','PROVIDER_TIMEOUT','PROVIDER_UNAVAILABLE','PROVIDER_REJECTED','RENDER_FAILED','INVALID_RECIPIENT','INTERNAL_ERROR') OR @ProviderMessageId IS NOT NULL)) THROW 52002,'Invalid completion.',1;
 DECLARE @now datetime2(3)=SYSUTCDATETIME(),@status varchar(10),@plan uniqueidentifier;
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:planning-mail:claim';
 SELECT @plan=PlanId FROM gp.PlanningMailDispatch WHERE NoticeId=@NoticeId AND Status='PROCESSING' AND ClaimToken=@ClaimToken AND LeaseUntilUtc>@now;
 IF @plan IS NULL THROW 52003,'Mail lease unavailable.',1;
 UPDATE gp.PlanningMailDispatch SET Status=CASE WHEN @Outcome='SENT' THEN 'SENT' WHEN Attempts>=6 THEN 'DEAD' ELSE 'PENDING' END,
  NextAttemptAtUtc=DATEADD(second,CASE WHEN Attempts>=5 THEN 300 ELSE 30*CONVERT(int,POWER(2,Attempts-1)) END,@now),ClaimToken=NULL,LeaseUntilUtc=NULL,
  CompletedAtUtc=CASE WHEN @Outcome='SENT' OR Attempts>=6 THEN @now ELSE NULL END,LastErrorCode=@ErrorCode,ProviderMessageId=@ProviderMessageId WHERE NoticeId=@NoticeId;
 SELECT @status=Status FROM gp.PlanningMailDispatch WHERE NoticeId=@NoticeId;
 INSERT gp.SecurityAuditEvents(ActionCode,LocationId,TargetType,TargetReference,ResultCode,MetadataJson) SELECT 'PLANNING_MAIL_COMPLETED',LocationId,'PLAN',CONVERT(varchar(36),@plan),CASE WHEN @Outcome='SENT' THEN 'SUCCESS' ELSE 'ERROR' END,(SELECT @NoticeId noticeId,@status status,@ErrorCode errorCode FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) FROM gp.VisitPlans WHERE PlanId=@plan;
 COMMIT;SELECT(SELECT @NoticeId noticeId,@status status FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp.PreviewPlanningNotifications @PlanId uniqueidentifier AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF @PlanId IS NULL THROW 52002,'Selected plan required.',1;
 DECLARE @now datetime2(3)=SYSUTCDATETIME(),@cutoff datetime2(3),@notice uniqueidentifier,@job nvarchar(max),@lock nvarchar(255)=N'gp:visit-plan:'+CONVERT(nvarchar(36),@PlanId);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._TakeLock @lock,'Shared';EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 DECLARE @messages table(NoticeId uniqueidentifier,Job nvarchar(max));
 DECLARE previewMail CURSOR LOCAL FAST_FORWARD FOR SELECT TOP(20) NoticeId FROM gp.PlanningMailDispatch WHERE PlanId=@PlanId AND Status<>'CANCELLED' ORDER BY QueuedAtUtc DESC,NoticeId;
 OPEN previewMail;FETCH NEXT FROM previewMail INTO @notice;
 WHILE @@FETCH_STATUS=0 BEGIN
  EXEC gp._PlanningMailJson @PlanId,@notice,@now,@cutoff,@job OUTPUT;
  IF JSON_VALUE(@job,'$.status')='READY' INSERT @messages VALUES(@notice,@job);
  FETCH NEXT FROM previewMail INTO @notice;
 END;CLOSE previewMail;DEALLOCATE previewMail;
 COMMIT;SELECT(SELECT @PlanId planId,JSON_QUERY(COALESCE((SELECT JSON_QUERY(Job) job FROM @messages ORDER BY NoticeId FOR JSON PATH),N'[]')) messages FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
/* Update/cancellation notifications address the last submitted version, never an unpublished draft. */
DECLARE @command nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID('gp.ChangePlannedVisit')),@old nvarchar(max)=N'  INSERT @notices SELECT UserId,CASE @kind WHEN ''CANCEL'' THEN ''CANCELLED'' ELSE ''UPDATE'' END,NULL FROM(
   SELECT @owner UserId UNION SELECT UserId FROM gp.VisitPlanApprovers WHERE PlanId=@PlanId AND Version=@previousVersion
   UNION SELECT UserId FROM gp.VisitPlanTaskOwners WHERE PlanId=@PlanId AND Version=@previousVersion
   UNION SELECT UserId FROM gp.VisitPlanParticipants WHERE PlanId=@PlanId AND Version=@previousVersion
   UNION SELECT RecipientUserId FROM gp.VisitPlanNotices WHERE PlanId=@PlanId AND Kind=''FYI'') recipients;',@new nvarchar(max)=N'  DECLARE @publishedVersion int=(SELECT MAX(Version) FROM gp.VisitPlanEvents WHERE PlanId=@PlanId AND Kind=''SUBMIT'');
  INSERT @notices SELECT UserId,CASE @kind WHEN ''CANCEL'' THEN ''CANCELLED'' ELSE ''UPDATE'' END,NULL FROM(
   SELECT @owner UserId UNION SELECT UserId FROM gp.VisitPlanApprovers WHERE PlanId=@PlanId AND Version=@publishedVersion
   UNION SELECT UserId FROM gp.VisitPlanTaskOwners WHERE PlanId=@PlanId AND Version=@publishedVersion
   UNION SELECT UserId FROM gp.VisitPlanParticipants WHERE PlanId=@PlanId AND Version=@publishedVersion
   UNION SELECT RecipientUserId FROM gp.VisitPlanNotices WHERE PlanId=@PlanId AND Kind=''FYI'') recipients WHERE @publishedVersion IS NOT NULL;';
IF CHARINDEX(@old,@command)=0 BEGIN SET @old=REPLACE(@old,CHAR(13)+CHAR(10),CHAR(10));IF CHARINDEX(@old,@command)=0 SET @old=REPLACE(@old,CHAR(10),CHAR(13)+CHAR(10));END;
IF @command IS NULL OR CHARINDEX(@old,@command)=0 THROW 52000,'Planning notice recipient contract required.',1;
SET @command=REPLACE(@command,@old,@new);SET @command=STUFF(@command,1,CHARINDEX(' ',@command)-1,'ALTER');EXEC sys.sp_executesql @command;
GRANT EXECUTE ON gp.PreviewPlanningNotifications TO gp_worker_runtime;
GRANT EXECUTE ON gp.ClaimPlanningNotifications TO gp_worker_runtime;
GRANT EXECUTE ON gp.GetPlanningNotification TO gp_worker_runtime;
GRANT EXECUTE ON gp.RenewPlanningNotificationLease TO gp_worker_runtime;
GRANT EXECUTE ON gp.CompletePlanningNotification TO gp_worker_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('132',N'Planning-only fenced mail outbox, live recipient scope, scoped content, bounded retries and no historical backfill');
COMMIT;
