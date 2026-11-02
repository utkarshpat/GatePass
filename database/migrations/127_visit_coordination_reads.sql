SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='126') THROW 52000,'Migration 126 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='127') THROW 52000,'Migration 127 already applied.',1;
BEGIN TRANSACTION; EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
CREATE PROCEDURE gp.ReadVisitCoordination @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@Mode varchar(12),@QueryJson nvarchar(max)=N'{}' AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF @Mode IS NULL OR @Mode COLLATE Latin1_General_100_BIN2 NOT IN('OPTIONS','LIST','DETAIL','THREAD') OR @QueryJson IS NULL OR ISJSON(@QueryJson)<>1 OR LEFT(LTRIM(@QueryJson),1)<>'{' OR DATALENGTH(@QueryJson)>4000
  OR EXISTS(SELECT [key] FROM OPENJSON(@QueryJson) GROUP BY [key] HAVING COUNT(*)>1) THROW 52002,'Invalid coordination query.',1;
 /* Invalid optional selectors must never turn into an unfiltered query. */
 IF EXISTS(SELECT 1 FROM OPENJSON(@QueryJson) WHERE
  ([key]='locationId' AND(type<>2 OR TRY_CONVERT(int,value) IS NULL OR TRY_CONVERT(int,value)<=0))
  OR([key] IN('search','folder') AND type<>1)
  OR([key]='offset' AND(type<>2 OR TRY_CONVERT(int,value) IS NULL OR value LIKE '%[.eE]%'))
  OR([key] IN('planId','threadId','beforeMessageId') AND(type<>1 OR DATALENGTH(value)<>72 OR TRY_CONVERT(uniqueidentifier,value) IS NULL))
  OR([key] IN('fromUtc','untilUtc') AND(type<>1 OR DATALENGTH(value)<>48 OR TRY_CONVERT(datetime2(3),value,127) IS NULL
    OR value COLLATE Latin1_General_100_BIN2<>(REPLACE(CONVERT(char(23),TRY_CONVERT(datetime2(3),value,127),121),' ','T')+'Z') COLLATE Latin1_General_100_BIN2))) THROW 52002,'Invalid coordination selector.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@result nvarchar(max),@location int=TRY_CONVERT(int,JSON_VALUE(@QueryJson,'$.locationId')),@search nvarchar(max)=JSON_VALUE(@QueryJson,'$.search');
 IF @search IS NOT NULL AND DATALENGTH(@search)>160 THROW 52002,'Search too long.',1;
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF gp._PlanningAvailable(@actor,@now,@cutoff)=0 THROW 52001,'Visit coordination unavailable.',1;
 IF @Mode='OPTIONS' BEGIN
  IF EXISTS(SELECT 1 FROM OPENJSON(@QueryJson) WHERE [key] NOT IN('locationId','search')) THROW 52002,'Invalid options query.',1;
  DECLARE @offices table(LocationId int PRIMARY KEY);
  INSERT @offices SELECT l.LocationId FROM gp.Locations l WHERE l.IsActive=1 AND(@location IS NULL OR @location=l.LocationId) AND
   (gp._PlanningAdmin(@actor,l.LocationId,NULL,@now)=1 OR EXISTS(SELECT 1 FROM gp.ProjectLocations pl WHERE pl.LocationId=l.LocationId AND gp._AdminScopeAllowed(@actor,'ROLE_GRANTS_MANAGE',l.LocationId,pl.ProjectLocationId,@now)=1)
    OR gp._PlanningHost(@actor,l.LocationId,NULL,@now,@cutoff)=1 OR EXISTS(SELECT 1 FROM gp.SubProjects s WHERE s.LocationId=l.LocationId AND gp._PlanningHost(@actor,l.LocationId,s.SubProjectId,@now,@cutoff)=1)
    OR EXISTS(SELECT 1 FROM gp.VisitPlans p JOIN gp.VisitPlanVersions v ON v.PlanId=p.PlanId AND v.IsCurrent=1 WHERE p.LocationId=l.LocationId AND gp._PlanVisible(@actor,p.PlanId,v.Version,@now,@cutoff)=1));
  SET @result=(SELECT CONVERT(varchar(36),@actor) actorId,(SELECT DisplayName FROM gp.Users WHERE UserId=@actor) displayName,
   JSON_QUERY(COALESCE((SELECT l.LocationId locationId,l.LocationName name,CONVERT(bit,gp._PlanningAdmin(@actor,l.LocationId,NULL,@now)) canManage,CONVERT(bit,gp._PlanningHost(@actor,l.LocationId,NULL,@now,@cutoff)) canHostLocation FROM gp.Locations l JOIN @offices o ON o.LocationId=l.LocationId ORDER BY l.LocationName FOR JSON PATH),N'[]')) locations,
   JSON_QUERY(COALESCE((SELECT CONVERT(varchar(20),pl.ProjectLocationId) accountOfficeId,pl.LocationId locationId,p.ProjectName name,CONVERT(bit,gp._AdminScopeAllowed(@actor,'ROLE_GRANTS_MANAGE',pl.LocationId,pl.ProjectLocationId,@now)) canManage
    FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId JOIN @offices o ON o.LocationId=pl.LocationId WHERE pl.IsActive=1 AND p.IsActive=1 AND p.LastSyncedAtUtc BETWEEN @cutoff AND @now
     AND(gp._AdminScopeAllowed(@actor,'ROLE_GRANTS_MANAGE',pl.LocationId,pl.ProjectLocationId,@now)=1 OR EXISTS(SELECT 1 FROM gp.SubProjects s WHERE s.AccountOfficeId=pl.ProjectLocationId AND gp._PlanningHost(@actor,pl.LocationId,s.SubProjectId,@now,@cutoff)=1)) ORDER BY p.ProjectName,pl.ProjectLocationId FOR JSON PATH),N'[]')) accounts,
   JSON_QUERY(COALESCE((SELECT CONVERT(varchar(36),s.SubProjectId) subProjectId,CONVERT(varchar(20),s.AccountOfficeId) accountOfficeId,s.LocationId locationId,s.Name name,s.Revision revision,s.IsActive active,
     CONVERT(bit,gp._AdminScopeAllowed(@actor,'ROLE_GRANTS_MANAGE',s.LocationId,s.AccountOfficeId,@now)) canManage,CONVERT(bit,gp._PlanningHost(@actor,s.LocationId,s.SubProjectId,@now,@cutoff)) canHost
    FROM gp.SubProjects s JOIN @offices o ON o.LocationId=s.LocationId WHERE gp._AdminScopeAllowed(@actor,'ROLE_GRANTS_MANAGE',s.LocationId,s.AccountOfficeId,@now)=1 OR gp._PlanningHost(@actor,s.LocationId,s.SubProjectId,@now,@cutoff)=1 ORDER BY s.Name,s.SubProjectId FOR JSON PATH),N'[]')) projects,
   JSON_QUERY(COALESCE((SELECT TOP(100) CONVERT(varchar(36),e.UserId) userId,e.FullName name,e.OfficialEmail email FROM gp.Employees e JOIN gp.Users u ON u.UserId=e.UserId
    WHERE gp._PlanningInternal(e.UserId,@now,@cutoff)=1 AND EXISTS(SELECT 1 FROM @offices o WHERE gp._PlanningAdmin(@actor,o.LocationId,NULL,@now)=1 OR EXISTS(SELECT 1 FROM gp.ProjectLocations pl WHERE pl.LocationId=o.LocationId AND gp._AdminScopeAllowed(@actor,'ROLE_GRANTS_MANAGE',o.LocationId,pl.ProjectLocationId,@now)=1))
     AND(@search IS NULL OR LEN(@search)>=2 AND(CHARINDEX(@search,e.FullName)>0 OR CHARINDEX(@search,e.OfficialEmail)>0)) ORDER BY e.FullName,e.UserId FOR JSON PATH),N'[]')) people,
   JSON_QUERY(COALESCE((SELECT CONVERT(varchar(36),p.PolicyId) id,p.LocationId locationId,p.ScopeKind scopeKind,CONVERT(varchar(36),p.SubProjectId) subProjectId,p.Revision revision,JSON_QUERY(p.DefinitionJson) definition
    FROM gp.VisitPlanningPolicies p JOIN @offices o ON o.LocationId=p.LocationId WHERE gp._PlanningAdmin(@actor,p.LocationId,p.SubProjectId,@now)=1 ORDER BY p.LocationId,p.ScopeKind,p.PolicyId FOR JSON PATH),N'[]')) policies,
   JSON_QUERY(COALESCE((SELECT * FROM(SELECT h.LocationId locationId,CONVERT(varchar(36),NULL) subProjectId,CONVERT(varchar(36),e.UserId) userId,e.FullName name,e.OfficialEmail email,h.Revision revision,h.IsActive active
    FROM gp.LocationPlanningHosts h JOIN gp.Employees e ON e.EmployeeId=h.EmployeeId JOIN @offices o ON o.LocationId=h.LocationId WHERE gp._PlanningAdmin(@actor,h.LocationId,NULL,@now)=1
    UNION ALL SELECT s.LocationId,CONVERT(varchar(36),h.SubProjectId),CONVERT(varchar(36),e.UserId),e.FullName,e.OfficialEmail,h.Revision,h.IsActive FROM gp.SubProjectHosts h JOIN gp.SubProjects s ON s.SubProjectId=h.SubProjectId JOIN gp.Employees e ON e.EmployeeId=h.EmployeeId JOIN @offices o ON o.LocationId=s.LocationId
     WHERE gp._AdminScopeAllowed(@actor,'ROLE_GRANTS_MANAGE',s.LocationId,s.AccountOfficeId,@now)=1) hostRows FOR JSON PATH),N'[]')) hosts
   FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 END ELSE IF @Mode='LIST' BEGIN
  IF EXISTS(SELECT 1 FROM OPENJSON(@QueryJson) WHERE [key] NOT IN('locationId','search','folder','offset','fromUtc','untilUtc')) THROW 52002,'Invalid list query.',1;
  DECLARE @folder nvarchar(20)=COALESCE(JSON_VALUE(@QueryJson,'$.folder'),N'MY'),@offset int=COALESCE(TRY_CONVERT(int,JSON_VALUE(@QueryJson,'$.offset')),0),
   @from datetime2(3)=COALESCE(TRY_CONVERT(datetime2(3),JSON_VALUE(@QueryJson,'$.fromUtc'),127),DATEADD(day,-30,@now)),@until datetime2(3)=COALESCE(TRY_CONVERT(datetime2(3),JSON_VALUE(@QueryJson,'$.untilUtc'),127),DATEADD(day,90,@now));
  IF @folder COLLATE Latin1_General_100_BIN2 NOT IN('MY','ASSIGNED','PARTICIPATING') OR @offset NOT BETWEEN 0 AND 5000 OR @from>=@until OR DATEDIFF(day,@from,@until)>366 THROW 52002,'Invalid list filter.',1;
  DECLARE @listed table(PlanId uniqueidentifier PRIMARY KEY,Version int,Starts datetime2(3),RowNumber bigint);
  INSERT @listed SELECT p.PlanId,v.Version,v.StartsAtUtc,ROW_NUMBER() OVER(ORDER BY v.StartsAtUtc,p.PlanId) FROM gp.VisitPlans p JOIN gp.VisitPlanVersions v ON v.PlanId=p.PlanId AND v.IsCurrent=1
   WHERE(@location IS NULL OR p.LocationId=@location) AND v.UntilUtc>@from AND v.StartsAtUtc<@until
    AND(@search IS NULL OR CHARINDEX(@search,v.VisitorName)>0 OR CHARINDEX(@search,CONVERT(varchar(36),p.PlanId))>0)
    AND gp._PlanVisible(@actor,p.PlanId,v.Version,@now,@cutoff)=1
    AND((@folder='MY' AND p.HostUserId=@actor) OR @folder='PARTICIPATING' OR(@folder='ASSIGNED' AND p.State='SUBMITTED' AND v.UntilUtc>@now AND(
     EXISTS(SELECT 1 FROM gp.VisitPlanApprovalSteps s WHERE s.PlanId=p.PlanId AND s.Version=v.Version AND gp._PlanLiveApprover(@actor,p.PlanId,v.Version,s.StepId,@now,@cutoff)=1 AND gp._PlanStepStatus(p.PlanId,v.Version,s.StepId,@now,@cutoff)='PENDING')
     OR EXISTS(SELECT 1 FROM gp.VisitPlanTasks t WHERE t.PlanId=p.PlanId AND t.Version=v.Version AND t.Status IN('REQUESTED','IN_PROGRESS','UNAVAILABLE') AND gp._PlanLiveTaskOwner(@actor,p.PlanId,v.Version,t.TaskId,@now,@cutoff)=1))));
  SET @result=(SELECT CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM @listed WHERE RowNumber>@offset+50) THEN 1 ELSE 0 END) hasMore,
   JSON_QUERY(COALESCE((SELECT p.PlanId id,p.Revision revision,p.State state,v.VisitorName visitorName,l.LocationName locationName,v.LocationId locationId,v.IsVip vip,u.DisplayName hostName,
    REPLACE(CONVERT(char(23),v.StartsAtUtc,121),' ','T')+'Z' startsAtUtc,REPLACE(CONVERT(char(23),v.UntilUtc,121),' ','T')+'Z' untilUtc
    FROM @listed i JOIN gp.VisitPlans p ON p.PlanId=i.PlanId JOIN gp.VisitPlanVersions v ON v.PlanId=i.PlanId AND v.Version=i.Version JOIN gp.Locations l ON l.LocationId=p.LocationId JOIN gp.Users u ON u.UserId=p.HostUserId
    WHERE i.RowNumber>@offset AND i.RowNumber<=@offset+50 ORDER BY i.RowNumber FOR JSON PATH),N'[]')) visits FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 END ELSE IF @Mode='THREAD' BEGIN
  IF EXISTS(SELECT 1 FROM OPENJSON(@QueryJson) WHERE [key] NOT IN('planId','threadId','beforeMessageId')) THROW 52002,'Invalid thread query.',1;
  DECLARE @threadPlan uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@QueryJson,'$.planId')),@thread uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@QueryJson,'$.threadId')),@threadVersion int,
   @before uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@QueryJson,'$.beforeMessageId')),@beforeAt datetime2(3),@threadOwner uniqueidentifier;
  SELECT @threadVersion=Version FROM gp.VisitPlanVersions WHERE PlanId=@threadPlan AND IsCurrent=1;
  SELECT @threadOwner=HostUserId FROM gp.VisitPlans WHERE PlanId=@threadPlan;
  IF @threadPlan IS NULL OR @thread IS NULL OR @threadVersion IS NULL OR gp._PlanThreadReadable(@actor,@threadPlan,@threadVersion,@thread,@now,@cutoff)=0 THROW 52001,'Thread not available.',1;
  IF JSON_VALUE(@QueryJson,'$.beforeMessageId') IS NOT NULL BEGIN
   SELECT @beforeAt=CreatedAtUtc FROM gp.VisitPlanMessages WHERE PlanId=@threadPlan AND Version=@threadVersion AND ThreadId=@thread AND MessageId=@before;
   IF @beforeAt IS NULL THROW 52002,'Message cursor must belong to the thread.',1;
  END;
  DECLARE @page table(MessageId uniqueidentifier PRIMARY KEY,Created datetime2(3),RowNumber bigint);
  INSERT @page SELECT TOP(51) MessageId,CreatedAtUtc,ROW_NUMBER() OVER(ORDER BY CreatedAtUtc DESC,MessageId DESC) FROM gp.VisitPlanMessages
   WHERE PlanId=@threadPlan AND Version=@threadVersion AND ThreadId=@thread AND(@before IS NULL OR CreatedAtUtc<@beforeAt OR CreatedAtUtc=@beforeAt AND MessageId<@before) ORDER BY CreatedAtUtc DESC,MessageId DESC;
  SET @result=(SELECT @thread threadId,CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM @page WHERE RowNumber=51) THEN 1 ELSE 0 END) hasMore,
   (SELECT MessageId FROM @page WHERE RowNumber=50) nextBeforeId,
   JSON_QUERY(COALESCE((SELECT m.MessageId id,m.ReplyToId replyToId,m.AuthorUserId authorId,u.DisplayName authorName,m.Body body,REPLACE(CONVERT(char(23),m.CreatedAtUtc,121),' ','T')+'Z' atUtc,
    JSON_QUERY(COALESCE((SELECT n.UserId userId,nu.DisplayName name FROM gp.VisitPlanMentions n JOIN gp.Users nu ON nu.UserId=n.UserId WHERE n.PlanId=@threadPlan AND n.Version=@threadVersion AND n.ThreadId=@thread AND n.MessageId=m.MessageId ORDER BY n.UserId FOR JSON PATH),N'[]')) mentions
    FROM @page q JOIN gp.VisitPlanMessages m ON m.PlanId=@threadPlan AND m.Version=@threadVersion AND m.ThreadId=@thread AND m.MessageId=q.MessageId JOIN gp.Users u ON u.UserId=m.AuthorUserId WHERE q.RowNumber<=50 ORDER BY q.RowNumber DESC FOR JSON PATH),N'[]')) messages,
   JSON_QUERY(COALESCE((SELECT TOP(100) CONVERT(varchar(36),u.UserId) userId,u.DisplayName name FROM gp.Users u WHERE u.UserId IN(SELECT @threadOwner UNION SELECT @actor UNION SELECT UserId FROM gp.VisitPlanApprovers WHERE PlanId=@threadPlan AND Version=@threadVersion UNION SELECT UserId FROM gp.VisitPlanTaskOwners WHERE PlanId=@threadPlan AND Version=@threadVersion UNION SELECT UserId FROM gp.VisitPlanParticipants WHERE PlanId=@threadPlan AND Version=@threadVersion)
    AND gp._PlanningInternal(u.UserId,@now,@cutoff)=1 AND gp._PlanThreadReadable(u.UserId,@threadPlan,@threadVersion,@thread,@now,@cutoff)=1 ORDER BY u.DisplayName,u.UserId FOR JSON PATH),N'[]')) readers FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 END ELSE BEGIN
  IF EXISTS(SELECT 1 FROM OPENJSON(@QueryJson) WHERE [key]<>'planId') THROW 52002,'Invalid detail query.',1;
  DECLARE @plan uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@QueryJson,'$.planId')),@version int,@owner uniqueidentifier,@state varchar(12),@expiry datetime2(3),@full bit,@office bit,@hostReady bit=1;
  SELECT @version=Version,@location=LocationId,@expiry=UntilUtc FROM gp.VisitPlanVersions WHERE PlanId=@plan AND IsCurrent=1;
  SELECT @owner=HostUserId,@state=State FROM gp.VisitPlans WHERE PlanId=@plan;
  IF @version IS NULL OR gp._PlanVisible(@actor,@plan,@version,@now,@cutoff)=0 THROW 52001,'Visit not available.',1;
  SET @full=gp._PlanFullManager(@actor,@plan,@version,@now);SET @office=gp._PlanOfficeParticipant(@actor,@plan,@version,@now,@cutoff);
  IF EXISTS(SELECT 1 FROM gp.VisitPlanProjects WHERE PlanId=@plan AND Version=@version) BEGIN
   IF EXISTS(SELECT 1 FROM gp.VisitPlanProjects WHERE PlanId=@plan AND Version=@version AND gp._PlanningHost(@owner,@location,SubProjectId,@now,@cutoff)=0) SET @hostReady=0;
  END ELSE SET @hostReady=gp._PlanningHost(@owner,@location,NULL,@now,@cutoff);
  SET @result=(SELECT p.PlanId id,p.Revision revision,p.State state,v.Version version,CONVERT(varchar(36),@actor) actorId,u.DisplayName hostName,CONVERT(bit,CASE WHEN @actor=@owner THEN 1 ELSE 0 END) canEdit,CONVERT(bit,@full) canManage,
   v.VisitorName visitorName,CASE WHEN @actor=@owner OR @full=1 OR @office=1 THEN v.VisitorEmail END visitorEmail,v.Company company,v.LocationId locationId,l.LocationName locationName,v.IsVip vip,
   REPLACE(CONVERT(char(23),v.StartsAtUtc,121),' ','T')+'Z' startsAtUtc,REPLACE(CONVERT(char(23),v.UntilUtc,121),' ','T')+'Z' untilUtc,
   CASE WHEN @actor=@owner OR @full=1 OR @office=1 OR EXISTS(SELECT 1 FROM gp.VisitPlanProjects x WHERE x.PlanId=@plan AND x.Version=@version AND gp._PlanProjectReadable(@actor,@plan,@version,x.SubProjectId,@now,@cutoff)=1) THEN v.Purpose END purpose,
   CASE WHEN NOT EXISTS(SELECT 1 FROM gp.VisitPlanProjects WHERE PlanId=@plan AND Version=@version) THEN gp._PlanReadiness(@plan,@version,NULL,@now,@cutoff) END locationReadiness,
   JSON_QUERY(COALESCE((SELECT x.SubProjectId subProjectId,s.Name name,gp._PlanReadiness(@plan,@version,x.SubProjectId,@now,@cutoff) readiness FROM gp.VisitPlanProjects x JOIN gp.SubProjects s ON s.SubProjectId=x.SubProjectId
    WHERE x.PlanId=@plan AND x.Version=@version AND gp._PlanProjectReadable(@actor,@plan,@version,x.SubProjectId,@now,@cutoff)=1 ORDER BY s.Name,x.SubProjectId FOR JSON PATH),N'[]')) projects,
   JSON_QUERY(COALESCE((SELECT s.StepId id,s.Name name,s.Kind kind,s.Mode mode,s.SubProjectId subProjectId,gp._PlanStepStatus(@plan,@version,s.StepId,@now,@cutoff) status,
    CONVERT(bit,CASE WHEN @actor<>@owner AND @state='SUBMITTED' AND @now<@expiry AND @hostReady=1 AND gp._PlanPolicyFresh(@plan,@version)=1 AND gp._PlanLiveApprover(@actor,@plan,@version,s.StepId,@now,@cutoff)=1 AND gp._PlanStepStatus(@plan,@version,s.StepId,@now,@cutoff)='PENDING' THEN 1 ELSE 0 END) canDecide,CONVERT(bit,CASE WHEN gp._PlanLiveApprover(@actor,@plan,@version,s.StepId,@now,@cutoff)=1 OR gp._PlanningAdmin(@actor,@location,s.SubProjectId,@now)=1 THEN 1 ELSE 0 END) canDiscuss,
    JSON_QUERY(COALESCE((SELECT d.UserId userId,du.DisplayName name,d.Decision decision,d.Reason reason,d.ClientReference reference,REPLACE(CONVERT(char(23),d.DecidedAtUtc,121),' ','T')+'Z' atUtc FROM gp.VisitPlanDecisions d JOIN gp.Users du ON du.UserId=d.UserId
     WHERE d.PlanId=@plan AND d.Version=@version AND d.StepId=s.StepId AND(gp._PlanLiveApprover(@actor,@plan,@version,s.StepId,@now,@cutoff)=1 OR gp._PlanningAdmin(@actor,@location,s.SubProjectId,@now)=1) ORDER BY d.DecidedAtUtc,d.UserId FOR JSON PATH),N'[]')) decisions
    FROM gp.VisitPlanApprovalSteps s WHERE s.PlanId=@plan AND s.Version=@version AND(@actor=@owner OR @full=1 OR(s.SubProjectId IS NULL AND @office=1) OR(s.SubProjectId IS NOT NULL AND gp._PlanProjectReadable(@actor,@plan,@version,s.SubProjectId,@now,@cutoff)=1)) ORDER BY s.SubProjectId,s.StepId FOR JSON PATH),N'[]')) approvals,
   JSON_QUERY(COALESCE((SELECT t.TaskId id,t.Name name,t.Kind kind,t.MandatoryForEntry mandatoryForEntry,t.Status status,t.Remark remark,
    CONVERT(bit,CASE WHEN @state='SUBMITTED' AND @now<@expiry AND @hostReady=1 AND gp._PlanPolicyFresh(@plan,@version)=1 AND gp._PlanLiveTaskOwner(@actor,@plan,@version,t.TaskId,@now,@cutoff)=1 THEN 1 ELSE 0 END) canUpdate,
    JSON_QUERY(COALESCE((SELECT o.UserId userId,ou.DisplayName name FROM gp.VisitPlanTaskOwners o JOIN gp.Users ou ON ou.UserId=o.UserId WHERE o.PlanId=@plan AND o.Version=@version AND o.TaskId=t.TaskId ORDER BY ou.DisplayName,o.UserId FOR JSON PATH),N'[]')) owners
    FROM gp.VisitPlanTasks t WHERE t.PlanId=@plan AND t.Version=@version AND(@actor=@owner OR @full=1 OR gp._PlanLiveTaskOwner(@actor,@plan,@version,t.TaskId,@now,@cutoff)=1) ORDER BY t.TaskId FOR JSON PATH),N'[]')) tasks,
   CASE WHEN @actor=@owner OR @full=1 OR EXISTS(SELECT 1 FROM gp.VisitPlanTasks t WHERE t.PlanId=@plan AND t.Version=@version AND t.Kind='STAY' AND gp._PlanLiveTaskOwner(@actor,@plan,@version,t.TaskId,@now,@cutoff)=1) THEN CONVERT(char(10),v.StayCheckInDate,23) END stayCheckInDate,
   CASE WHEN @actor=@owner OR @full=1 OR EXISTS(SELECT 1 FROM gp.VisitPlanTasks t WHERE t.PlanId=@plan AND t.Version=@version AND t.Kind='STAY' AND gp._PlanLiveTaskOwner(@actor,@plan,@version,t.TaskId,@now,@cutoff)=1) THEN CONVERT(char(10),v.StayCheckOutDate,23) END stayCheckOutDate,
   CASE WHEN @actor=@owner OR @full=1 OR EXISTS(SELECT 1 FROM gp.VisitPlanTasks t WHERE t.PlanId=@plan AND t.Version=@version AND t.Kind='STAY' AND gp._PlanLiveTaskOwner(@actor,@plan,@version,t.TaskId,@now,@cutoff)=1) THEN v.StayNotes END stayNotes,
   JSON_QUERY(COALESCE((SELECT th.ThreadId id,th.Title title,th.Audience audience,th.SubProjectId subProjectId,COALESCE(th.ApprovalStepId,th.TaskId) targetId,th.IsResolved resolved,
    CONVERT(bit,CASE WHEN @state='SUBMITTED' AND @now<@expiry AND(th.CreatedByUserId=@actor OR @actor=@owner OR @full=1) THEN 1 ELSE 0 END) canResolve,
    JSON_QUERY(N'[]') messages,JSON_QUERY(N'[]') readers
    FROM gp.VisitPlanThreads th WHERE th.PlanId=@plan AND th.Version=@version AND gp._PlanThreadReadable(@actor,@plan,@version,th.ThreadId,@now,@cutoff)=1 ORDER BY th.ThreadId FOR JSON PATH),N'[]')) threads,
   JSON_QUERY(COALESCE((SELECT TOP(100) e.Sequence sequence,e.Version version,e.Kind kind,REPLACE(CONVERT(char(23),e.OccurredAtUtc,121),' ','T')+'Z' atUtc,
    CASE WHEN e.Kind IN('CANCEL','REVISE') THEN JSON_VALUE(e.DetailJson,'$.reason') END reason
    FROM gp.VisitPlanEvents e WHERE e.PlanId=@plan AND(@actor=@owner OR @full=1 OR e.ActorUserId=@actor OR e.Kind IN('SUBMIT','CANCEL')) ORDER BY e.Sequence DESC FOR JSON PATH),N'[]')) activity,
   CASE WHEN @actor=@owner THEN JSON_QUERY((SELECT v.LocationId locationId,JSON_QUERY(COALESCE((SELECT CONVERT(varchar(36),x.SubProjectId) [value] FROM gp.VisitPlanProjects x WHERE x.PlanId=@plan AND x.Version=@version ORDER BY x.SubProjectId FOR JSON PATH),N'[]')) subProjects,
    v.VisitorName visitorName,v.VisitorEmail visitorEmail,v.Company company,v.Purpose purpose,REPLACE(CONVERT(char(23),v.StartsAtUtc,121),' ','T')+'Z' startsAtUtc,REPLACE(CONVERT(char(23),v.UntilUtc,121),' ','T')+'Z' untilUtc,v.IsVip vip,
    CONVERT(char(10),v.StayCheckInDate,23) checkInDate,CONVERT(char(10),v.StayCheckOutDate,23) checkOutDate,v.StayNotes stayNotes FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) END draft
   FROM gp.VisitPlans p JOIN gp.VisitPlanVersions v ON v.PlanId=p.PlanId AND v.IsCurrent=1 JOIN gp.Users u ON u.UserId=p.HostUserId JOIN gp.Locations l ON l.LocationId=p.LocationId WHERE p.PlanId=@plan FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 END;
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON gp.ReadVisitCoordination TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('127',N'Permission-filtered planning options, inbox pagination and private visit/task/thread projections');
COMMIT;
