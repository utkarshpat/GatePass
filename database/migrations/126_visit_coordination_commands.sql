SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='125') THROW 52000,'Migration 125 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='126') THROW 52000,'Migration 126 already applied.',1;
BEGIN TRANSACTION; EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
CREATE PROCEDURE gp.CreatePlannedVisit @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ClientKey uniqueidentifier,@DraftJson nvarchar(max) AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF @ClientKey IS NULL OR ISJSON(@DraftJson)<>1 OR DATALENGTH(@DraftJson)>16000 THROW 52002,'Invalid invitation.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@location int=TRY_CONVERT(int,JSON_VALUE(@DraftJson,'$.locationId')),@op uniqueidentifier,@cached nvarchar(max),@plan uniqueidentifier=NEWID(),@result nvarchar(max);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF @location IS NULL OR gp._PlanningInternal(@actor,@now,@cutoff)=0
  OR(EXISTS(SELECT 1 FROM OPENJSON(@DraftJson,'$.subProjectIds')) AND EXISTS(SELECT 1 FROM OPENJSON(@DraftJson,'$.subProjectIds') WHERE gp._PlanningHost(@actor,@location,TRY_CONVERT(uniqueidentifier,value),@now,@cutoff)=0))
  OR(NOT EXISTS(SELECT 1 FROM OPENJSON(@DraftJson,'$.subProjectIds')) AND gp._PlanningHost(@actor,@location,NULL,@now,@cutoff)=0) THROW 52001,'Approved host authority required.',1;
 EXEC gp._BeginOperation @actor,'PLAN_CREATE',@ClientKey,@DraftJson,@op OUTPUT,@cached OUTPUT;
 IF @cached IS NOT NULL BEGIN COMMIT;SELECT @cached;RETURN;END;
 INSERT gp.VisitPlans VALUES(@plan,@location,@actor,1,'DRAFT',@now);
 EXEC gp._BuildVisitPlanVersion @plan,1,@DraftJson,@actor,@now,@cutoff;
 INSERT gp.VisitPlanEvents VALUES(@plan,1,1,@actor,'CREATED',NULL,@now,N'{}');
 SET @result=(SELECT @plan id,1 revision FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 EXEC gp._CompleteOperation @op,@result;COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp.ChangePlannedVisit @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@PlanId uniqueidentifier,@ClientKey uniqueidentifier,@ExpectedRevision int,@CommandJson nvarchar(max) AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF @PlanId IS NULL OR @ClientKey IS NULL OR @ExpectedRevision IS NULL OR @ExpectedRevision NOT BETWEEN 1 AND 2147483646 OR ISJSON(@CommandJson)<>1 OR LEFT(LTRIM(@CommandJson),1)<>'{' OR DATALENGTH(@CommandJson)>20000 THROW 52002,'Invalid planning command.',1;
 DECLARE @kind nvarchar(max)=JSON_VALUE(@CommandJson,'$.kind'),@allowed nvarchar(300);
 SET @allowed=CASE @kind WHEN 'SUBMIT' THEN N'kind' WHEN 'CANCEL' THEN N'kind,reason' WHEN 'REVISE' THEN N'kind,draft,reason' WHEN 'DECIDE' THEN N'kind,stepId,decision,reason,reference' WHEN 'ARRANGE' THEN N'kind,taskId,status,remark'
  WHEN 'THREAD' THEN N'kind,threadId,title,audience,subProjectId,targetId' WHEN 'COMMENT' THEN N'kind,threadId,messageId,body,replyToId,mentionIds' WHEN 'THREAD_STATE' THEN N'kind,threadId,resolved' END;
 IF EXISTS(SELECT 1 FROM OPENJSON(@CommandJson) WHERE [key] IN('stepId','taskId','threadId','messageId','replyToId','subProjectId','targetId') AND type<>0 AND TRY_CONVERT(uniqueidentifier,value) IS NULL) THROW 52002,'Invalid resource identifier.',1;
 IF @allowed IS NULL OR EXISTS(SELECT 1 FROM OPENJSON(@CommandJson) j WHERE NOT EXISTS(SELECT 1 FROM STRING_SPLIT(@allowed,',') a WHERE a.value COLLATE Latin1_General_100_BIN2=j.[key] COLLATE Latin1_General_100_BIN2))
  OR EXISTS(SELECT [key] FROM OPENJSON(@CommandJson) GROUP BY [key] HAVING COUNT(*)>1) THROW 52002,'Invalid command fields.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@location int,@owner uniqueidentifier,@version int,@revision int,@state varchar(12),@until datetime2(3),@start datetime2(3),
  @target uniqueidentifier,@hash binary(32)=HASHBYTES('SHA2_256',@CommandJson),@oldHash binary(32),@oldExpected int,@sequence int,@reason nvarchar(max)=JSON_VALUE(@CommandJson,'$.reason'),@details nvarchar(max)=N'{}',@result nvarchar(max),@previousVersion int;
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';
 DECLARE @lock nvarchar(255)=N'gp:visit-plan:'+CONVERT(nvarchar(36),@PlanId);EXEC gp._TakeLock @lock,'Exclusive';
 EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF EXISTS(SELECT 1 FROM gp.Employees WHERE UserId=@actor) AND gp._PlanningInternal(@actor,@now,@cutoff)=0 THROW 52001,'Current employee identity required.',1;
 SELECT @location=p.LocationId,@owner=p.HostUserId,@revision=p.Revision,@state=p.State,@version=v.Version,@until=v.UntilUtc,@start=v.StartsAtUtc FROM gp.VisitPlans p JOIN gp.VisitPlanVersions v ON v.PlanId=p.PlanId AND v.IsCurrent=1 WHERE p.PlanId=@PlanId;
 IF @version IS NULL OR gp._PlanVisible(@actor,@PlanId,@version,@now,@cutoff)=0 THROW 52001,'Visit coordination access required.',1;
 SET @previousVersion=@version;
 IF @kind IN('SUBMIT','REVISE','CANCEL') AND(@actor<>@owner OR gp._PlanningInternal(@actor,@now,@cutoff)=0) THROW 52001,'Invitation owner required.',1;
 IF @kind='DECIDE' BEGIN
  SET @target=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@CommandJson,'$.stepId'));
  IF @actor=@owner OR @target IS NULL OR gp._PlanLiveApprover(@actor,@PlanId,@version,@target,@now,@cutoff)=0 THROW 52001,'Assigned internal authority required.',1;
 END;
 IF @kind='ARRANGE' BEGIN
  SET @target=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@CommandJson,'$.taskId'));
  IF @target IS NULL OR gp._PlanLiveTaskOwner(@actor,@PlanId,@version,@target,@now,@cutoff)=0 THROW 52001,'Assigned arrangement owner required.',1;
 END;
 IF @kind IN('COMMENT','THREAD_STATE') BEGIN
  SET @target=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@CommandJson,'$.threadId'));
  IF @target IS NULL OR gp._PlanThreadReadable(@actor,@PlanId,@version,@target,@now,@cutoff)=0 THROW 52001,'Thread access required.',1;
  IF @kind='THREAD_STATE' AND @actor<>@owner AND gp._PlanFullManager(@actor,@PlanId,@version,@now)=0 AND NOT EXISTS(SELECT 1 FROM gp.VisitPlanThreads WHERE PlanId=@PlanId AND Version=@version AND ThreadId=@target AND CreatedByUserId=@actor) THROW 52001,'Thread owner required.',1;
 END;
 SELECT @oldHash=PayloadHash,@oldExpected=ExpectedRevision FROM gp.VisitPlanOperations WHERE PlanId=@PlanId AND ActorUserId=@actor AND ClientKey=@ClientKey;
 IF @oldHash IS NOT NULL BEGIN
  IF @oldHash<>@hash OR @oldExpected<>@ExpectedRevision THROW 52003,'Operation key reused with different input.',1;
  COMMIT;SELECT(SELECT @PlanId id,@revision revision FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);RETURN;
 END;
 IF @state='CANCELLED' OR @ExpectedRevision<>@revision OR(SELECT COUNT(*) FROM gp.VisitPlanEvents WHERE PlanId=@PlanId)>=2000 THROW 52003,'Visit changed. Refresh.',1;
 IF @kind NOT IN('SUBMIT','REVISE','CANCEL') AND(@state<>'SUBMITTED' OR @now>=@until) THROW 52003,'Visit is not open for this action.',1;
 IF @kind IN('SUBMIT','DECIDE','ARRANGE') BEGIN
  IF gp._PlanPolicyFresh(@PlanId,@version)=0 THROW 52003,'Planning policy changed. Revise the invitation.',1;
  IF(EXISTS(SELECT 1 FROM gp.VisitPlanProjects WHERE PlanId=@PlanId AND Version=@version) AND EXISTS(SELECT 1 FROM gp.VisitPlanProjects WHERE PlanId=@PlanId AND Version=@version AND gp._PlanningHost(@owner,@location,SubProjectId,@now,@cutoff)=0))
   OR(NOT EXISTS(SELECT 1 FROM gp.VisitPlanProjects WHERE PlanId=@PlanId AND Version=@version) AND gp._PlanningHost(@owner,@location,NULL,@now,@cutoff)=0) THROW 52001,'Current host authority required.',1;
 END;
 DECLARE @notices table(UserId uniqueidentifier NOT NULL,Kind varchar(12),TargetId uniqueidentifier NULL);
 IF @kind='SUBMIT' BEGIN
  IF @state<>'DRAFT' OR @now>@start THROW 52003,'Invitation cannot be submitted.',1;
  UPDATE gp.VisitPlans SET State='SUBMITTED' WHERE PlanId=@PlanId;
  INSERT @notices SELECT UserId,'APPROVAL',StepId FROM gp.VisitPlanApprovers WHERE PlanId=@PlanId AND Version=@version AND UserId<>@owner;
  INSERT @notices SELECT UserId,'ARRANGEMENT',TaskId FROM gp.VisitPlanTaskOwners WHERE PlanId=@PlanId AND Version=@version;
  INSERT @notices SELECT TRY_CONVERT(uniqueidentifier,m.value),'FYI',NULL FROM gp.VisitPlanVersions v JOIN gp.VisitPlanningPolicies p ON p.LocationId=v.LocationId AND p.ScopeKind='LOCATION' AND p.IsActive=1
   CROSS APPLY OPENJSON(p.DefinitionJson) r CROSS APPLY OPENJSON(CASE WHEN r.[key] IN('notifyIds','vipNotifyIds') THEN r.value ELSE N'[]' END) m WHERE v.PlanId=@PlanId AND v.Version=@version AND(r.[key]='notifyIds' OR r.[key]='vipNotifyIds' AND v.IsVip=1);
 END ELSE IF @kind IN('CANCEL','REVISE') BEGIN
  IF @reason IS NULL OR DATALENGTH(@reason) NOT BETWEEN 2 AND 1000 OR LEN(LTRIM(RTRIM(@reason)))=0 THROW 52002,'A reason is required.',1;
  SET @details=(SELECT @reason reason FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  IF @kind='CANCEL' UPDATE gp.VisitPlans SET State='CANCELLED' WHERE PlanId=@PlanId;
  ELSE BEGIN
   IF @version>=21 THROW 52003,'Invitation version limit reached.',1;
   UPDATE gp.VisitPlanVersions SET IsCurrent=0 WHERE PlanId=@PlanId AND IsCurrent=1;SET @version+=1;
   DECLARE @draft nvarchar(max)=JSON_QUERY(@CommandJson,'$.draft');
   EXEC gp._BuildVisitPlanVersion @PlanId,@version,@draft,@owner,@now,@cutoff;
   UPDATE gp.VisitPlans SET State='DRAFT' WHERE PlanId=@PlanId;
  END;
  INSERT @notices SELECT UserId,CASE @kind WHEN 'CANCEL' THEN 'CANCELLED' ELSE 'UPDATE' END,NULL FROM(
   SELECT @owner UserId UNION SELECT UserId FROM gp.VisitPlanApprovers WHERE PlanId=@PlanId AND Version=@previousVersion
   UNION SELECT UserId FROM gp.VisitPlanTaskOwners WHERE PlanId=@PlanId AND Version=@previousVersion
   UNION SELECT UserId FROM gp.VisitPlanParticipants WHERE PlanId=@PlanId AND Version=@previousVersion
   UNION SELECT RecipientUserId FROM gp.VisitPlanNotices WHERE PlanId=@PlanId AND Kind='FYI') recipients;
 END ELSE IF @kind='DECIDE' BEGIN
  DECLARE @decision nvarchar(max)=JSON_VALUE(@CommandJson,'$.decision'),@reference nvarchar(max)=JSON_VALUE(@CommandJson,'$.reference'),@stepKind varchar(24);
  SELECT @stepKind=Kind FROM gp.VisitPlanApprovalSteps WHERE PlanId=@PlanId AND Version=@version AND StepId=@target;
  IF @decision IS NULL OR @decision COLLATE Latin1_General_100_BIN2 NOT IN('APPROVED','REJECTED') OR @reason IS NULL OR DATALENGTH(@reason) NOT BETWEEN 2 AND 1000 OR LEN(LTRIM(RTRIM(@reason)))=0
   OR(@reference IS NOT NULL AND DATALENGTH(@reference) NOT BETWEEN 2 AND 600) OR(@stepKind='CLIENT_CONFIRMATION' AND @decision='APPROVED' AND(@reference IS NULL OR LEN(LTRIM(RTRIM(@reference)))=0)) THROW 52002,'Decision and internal client reference required.',1;
  IF gp._PlanStepStatus(@PlanId,@version,@target,@now,@cutoff)<>'PENDING' OR EXISTS(SELECT 1 FROM gp.VisitPlanDecisions WHERE PlanId=@PlanId AND Version=@version AND StepId=@target AND UserId=@actor) THROW 52003,'Approval step already decided.',1;
  INSERT gp.VisitPlanDecisions VALUES(@PlanId,@version,@target,@actor,@stepKind,@decision,@reason,@reference,@now);
  INSERT @notices VALUES(@owner,'UPDATE',@target);
 END ELSE IF @kind='ARRANGE' BEGIN
  DECLARE @status nvarchar(max)=JSON_VALUE(@CommandJson,'$.status'),@remark nvarchar(max)=JSON_VALUE(@CommandJson,'$.remark');
  IF @status IS NULL OR @status COLLATE Latin1_General_100_BIN2 NOT IN('IN_PROGRESS','CONFIRMED','UNAVAILABLE') OR @remark IS NULL OR DATALENGTH(@remark) NOT BETWEEN 2 AND 2000 OR LEN(LTRIM(RTRIM(@remark)))=0 THROW 52002,'Arrangement result and remark required.',1;
  IF EXISTS(SELECT 1 FROM gp.VisitPlanTasks WHERE PlanId=@PlanId AND Version=@version AND TaskId=@target AND Status=@status) THROW 52003,'Arrangement status unchanged.',1;
  UPDATE gp.VisitPlanTasks SET Status=@status,Remark=@remark WHERE PlanId=@PlanId AND Version=@version AND TaskId=@target;
  SET @details=(SELECT @status status,@remark remark FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);INSERT @notices VALUES(@owner,'UPDATE',@target);
 END ELSE IF @kind='THREAD' BEGIN
  SET @target=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@CommandJson,'$.threadId'));
  DECLARE @audience nvarchar(max)=JSON_VALUE(@CommandJson,'$.audience'),@title nvarchar(max)=JSON_VALUE(@CommandJson,'$.title'),@sub uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@CommandJson,'$.subProjectId')),@resource uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@CommandJson,'$.targetId'));
  IF @target IS NULL OR @audience IS NULL OR @audience COLLATE Latin1_General_100_BIN2 NOT IN('GENERAL','APPROVAL','OPERATIONS') OR @title IS NULL OR DATALENGTH(@title) NOT BETWEEN 2 AND 240 OR LEN(LTRIM(RTRIM(@title)))=0 THROW 52002,'Invalid discussion thread.',1;
  IF @sub IS NOT NULL AND(NOT EXISTS(SELECT 1 FROM gp.VisitPlanProjects WHERE PlanId=@PlanId AND Version=@version AND SubProjectId=@sub) OR gp._PlanProjectReadable(@actor,@PlanId,@version,@sub,@now,@cutoff)=0) THROW 52001,'Project discussion access required.',1;
  IF @audience='GENERAL' AND @resource IS NOT NULL THROW 52002,'General thread has no approval/task target.',1;
  IF @audience='APPROVAL' AND(@resource IS NULL OR NOT EXISTS(SELECT 1 FROM gp.VisitPlanApprovalSteps WHERE PlanId=@PlanId AND Version=@version AND StepId=@resource AND(SubProjectId=@sub OR SubProjectId IS NULL AND @sub IS NULL))
   OR(gp._PlanningAdmin(@actor,@location,@sub,@now)=0 AND gp._PlanLiveApprover(@actor,@PlanId,@version,@resource,@now,@cutoff)=0)) THROW 52001,'Private approval discussion access required.',1;
  IF @audience='OPERATIONS' AND(@sub IS NOT NULL OR @resource IS NULL OR NOT EXISTS(SELECT 1 FROM gp.VisitPlanTasks WHERE PlanId=@PlanId AND Version=@version AND TaskId=@resource)
   OR(@actor<>@owner AND gp._PlanFullManager(@actor,@PlanId,@version,@now)=0 AND gp._PlanLiveTaskOwner(@actor,@PlanId,@version,@resource,@now,@cutoff)=0)) THROW 52001,'Arrangement discussion access required.',1;
  IF(SELECT COUNT(*) FROM gp.VisitPlanThreads WHERE PlanId=@PlanId AND Version=@version)>=100 OR EXISTS(SELECT 1 FROM gp.VisitPlanThreads WHERE PlanId=@PlanId AND ThreadId=@target) THROW 52003,'Thread limit or duplicate identifier.',1;
  INSERT gp.VisitPlanThreads VALUES(@PlanId,@version,@target,@title,@audience,@sub,CASE WHEN @audience='APPROVAL' THEN @resource END,CASE WHEN @audience='OPERATIONS' THEN @resource END,@actor,0);
 END ELSE IF @kind='COMMENT' BEGIN
  DECLARE @message uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@CommandJson,'$.messageId')),@reply uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@CommandJson,'$.replyToId')),@body nvarchar(max)=JSON_VALUE(@CommandJson,'$.body'),@mentions nvarchar(max)=JSON_QUERY(@CommandJson,'$.mentionIds');
  IF @message IS NULL OR @body IS NULL OR DATALENGTH(@body) NOT BETWEEN 2 AND 8000 OR LEN(LTRIM(RTRIM(@body)))=0 OR @mentions IS NULL OR LEFT(LTRIM(@mentions),1)<>'[' OR(SELECT COUNT(*) FROM OPENJSON(@mentions))>10
   OR EXISTS(SELECT 1 FROM OPENJSON(@mentions) WHERE type<>1 OR TRY_CONVERT(uniqueidentifier,value) IS NULL OR gp._PlanThreadReadable(TRY_CONVERT(uniqueidentifier,value),@PlanId,@version,@target,@now,@cutoff)=0)
   OR EXISTS(SELECT TRY_CONVERT(uniqueidentifier,value) FROM OPENJSON(@mentions) GROUP BY TRY_CONVERT(uniqueidentifier,value) HAVING COUNT(*)>1) THROW 52002,'Invalid message or mentioned reader.',1;
  IF EXISTS(SELECT 1 FROM gp.VisitPlanThreads WHERE PlanId=@PlanId AND Version=@version AND ThreadId=@target AND IsResolved=1)
   OR EXISTS(SELECT 1 FROM gp.VisitPlanMessages WHERE PlanId=@PlanId AND MessageId=@message) OR(SELECT COUNT(*) FROM gp.VisitPlanMessages WHERE PlanId=@PlanId AND Version=@version)>=500 THROW 52003,'Thread closed, duplicate message or message limit.',1;
  IF @reply IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gp.VisitPlanMessages WHERE PlanId=@PlanId AND Version=@version AND ThreadId=@target AND MessageId=@reply) THROW 52002,'Reply must belong to this thread.',1;
  INSERT gp.VisitPlanMessages VALUES(@PlanId,@version,@target,@message,@reply,@actor,@body,@now);
  INSERT gp.VisitPlanMentions SELECT @PlanId,@version,@target,@message,CONVERT(uniqueidentifier,value) FROM OPENJSON(@mentions);
  INSERT @notices SELECT CONVERT(uniqueidentifier,value),'DISCUSSION',@target FROM OPENJSON(@mentions) WHERE CONVERT(uniqueidentifier,value)<>@actor;
 END ELSE IF @kind='THREAD_STATE' BEGIN
  DECLARE @resolved bit=CASE JSON_VALUE(@CommandJson,'$.resolved') WHEN 'true' THEN 1 WHEN 'false' THEN 0 END;
  IF @resolved IS NULL THROW 52002,'Thread resolution required.',1;
  IF EXISTS(SELECT 1 FROM gp.VisitPlanThreads WHERE PlanId=@PlanId AND Version=@version AND ThreadId=@target AND IsResolved=@resolved) THROW 52003,'Thread state unchanged.',1;
  UPDATE gp.VisitPlanThreads SET IsResolved=@resolved WHERE PlanId=@PlanId AND Version=@version AND ThreadId=@target;
  SET @details=(SELECT @resolved resolved FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 END;
 SET @revision+=1;UPDATE gp.VisitPlans SET Revision=@revision WHERE PlanId=@PlanId;
 SELECT @sequence=COALESCE(MAX(Sequence),0)+1 FROM gp.VisitPlanEvents WHERE PlanId=@PlanId;
 INSERT gp.VisitPlanEvents VALUES(@PlanId,@sequence,@version,@actor,@kind,@target,@now,@details);
 INSERT gp.VisitPlanOperations VALUES(@PlanId,@actor,@ClientKey,@hash,@ExpectedRevision,@revision);
 INSERT gp.VisitPlanNotices SELECT DISTINCT @PlanId,@sequence,NEWID(),n.UserId,n.Kind,n.TargetId FROM(SELECT DISTINCT UserId,Kind,TargetId FROM @notices) n WHERE gp._PlanningInternal(n.UserId,@now,@cutoff)=1;
 SET @result=(SELECT @PlanId id,@revision revision FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON gp.CreatePlannedVisit TO gp_api_runtime;
GRANT EXECUTE ON gp.ChangePlannedVisit TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('126',N'Atomic scoped invitations, independent decisions, arrangements and thread commands with replay and revision checks');
COMMIT;
