/* Execute-only planning configuration and bounded version construction.
   No caller-supplied actor, participant list, decision or aggregate is accepted. */
SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='124') THROW 52000,'Migration 124 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='125') THROW 52000,'Migration 125 already applied.',1;
BEGIN TRANSACTION; EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
CREATE PROCEDURE gp._ValidatePlanningPolicy @Definition nvarchar(max),@LocationPolicy bit,@Now datetime2(3),@Cutoff datetime2(3) AS BEGIN
 SET NOCOUNT ON;
 IF ISJSON(@Definition)<>1 OR DATALENGTH(@Definition)>60000 OR LEFT(LTRIM(@Definition),1)<>'{' THROW 52002,'Invalid planning policy.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Definition) WHERE [key] NOT IN('approvalRules','arrangements','receptionIds','securityIds','notifyIds','vipNotifyIds','maximumAdvanceDays','maximumVisitDays'))
  OR EXISTS(SELECT [key] FROM OPENJSON(@Definition) GROUP BY [key] HAVING COUNT(*)>1) THROW 52002,'Invalid planning policy fields.',1;
 IF NOT EXISTS(SELECT 1 FROM OPENJSON(@Definition) WHERE [key]='approvalRules' AND type=4) THROW 52002,'Approval rules required.',1;
 IF(SELECT COUNT(*) FROM OPENJSON(@Definition,'$.approvalRules')) NOT BETWEEN 1 AND 50 THROW 52002,'Invalid approval count.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Definition,'$.approvalRules') r WHERE r.type<>5 OR EXISTS(SELECT 1 FROM OPENJSON(r.value) WHERE [key] NOT IN('id','name','kind','mode','approverIds'))
  OR EXISTS(SELECT [key] FROM OPENJSON(r.value) GROUP BY [key] HAVING COUNT(*)>1)) THROW 52002,'Invalid approval rule.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@Definition,'$.approvalRules') WITH(id uniqueidentifier,name nvarchar(max),kind nvarchar(max),mode nvarchar(max),approverIds nvarchar(max) AS JSON) r
  WHERE id IS NULL OR name IS NULL OR DATALENGTH(name) NOT BETWEEN 2 AND 240 OR LEN(LTRIM(RTRIM(name)))=0 OR kind IS NULL OR kind COLLATE Latin1_General_100_BIN2 NOT IN('PROJECT','SECURITY','CLIENT_CONFIRMATION')
   OR mode IS NULL OR mode COLLATE Latin1_General_100_BIN2 NOT IN('ALL','ANY') OR approverIds IS NULL OR LEFT(LTRIM(approverIds),1)<>'[' OR(SELECT COUNT(*) FROM OPENJSON(approverIds)) NOT BETWEEN 1 AND 20
   OR EXISTS(SELECT 1 FROM OPENJSON(approverIds) a WHERE a.type<>1 OR TRY_CONVERT(uniqueidentifier,a.value) IS NULL OR gp._PlanningInternal(TRY_CONVERT(uniqueidentifier,a.value),@Now,@Cutoff)=0)
   OR EXISTS(SELECT value FROM OPENJSON(approverIds) GROUP BY value HAVING COUNT(*)>1)) THROW 52002,'Internal approval authority required.',1;
 IF EXISTS(SELECT id FROM OPENJSON(@Definition,'$.approvalRules') WITH(id uniqueidentifier) GROUP BY id HAVING COUNT(*)>1) THROW 52002,'Duplicate approval identifier.',1;
 IF @LocationPolicy=0 AND(SELECT COUNT(*) FROM OPENJSON(@Definition))<>1 THROW 52002,'Project policies contain approval rules only.',1;
 IF @LocationPolicy=1 BEGIN
  IF TRY_CONVERT(int,JSON_VALUE(@Definition,'$.maximumAdvanceDays')) IS NULL OR TRY_CONVERT(int,JSON_VALUE(@Definition,'$.maximumVisitDays')) IS NULL OR TRY_CONVERT(int,JSON_VALUE(@Definition,'$.maximumAdvanceDays')) NOT BETWEEN 1 AND 366 OR JSON_VALUE(@Definition,'$.maximumAdvanceDays') IS NULL
   OR TRY_CONVERT(int,JSON_VALUE(@Definition,'$.maximumVisitDays')) NOT BETWEEN 1 AND 366 OR JSON_VALUE(@Definition,'$.maximumVisitDays') IS NULL THROW 52002,'Planning date limits required.',1;
  IF(SELECT COUNT(*) FROM OPENJSON(@Definition) WHERE [key] IN('arrangements','receptionIds','securityIds','notifyIds','vipNotifyIds') AND type=4)<>5 THROW 52002,'Planning recipient arrays required.',1;
  IF(SELECT COUNT(*) FROM OPENJSON(@Definition,'$.arrangements'))>20 THROW 52002,'Too many arrangements.',1;
  IF EXISTS(SELECT 1 FROM OPENJSON(@Definition,'$.arrangements') r WHERE r.type<>5 OR EXISTS(SELECT 1 FROM OPENJSON(r.value) WHERE [key] NOT IN('id','name','kind','mandatoryForEntry','ownerIds'))
   OR EXISTS(SELECT [key] FROM OPENJSON(r.value) GROUP BY [key] HAVING COUNT(*)>1)) THROW 52002,'Invalid arrangement rule.',1;
  IF EXISTS(SELECT 1 FROM OPENJSON(@Definition,'$.arrangements') WITH(id uniqueidentifier,name nvarchar(max),kind nvarchar(max),mandatoryForEntry bit,ownerIds nvarchar(max) AS JSON) r
   WHERE id IS NULL OR name IS NULL OR DATALENGTH(name) NOT BETWEEN 2 AND 240 OR LEN(LTRIM(RTRIM(name)))=0 OR kind IS NULL OR kind COLLATE Latin1_General_100_BIN2 NOT IN('STAY','OTHER') OR mandatoryForEntry IS NULL
    OR ownerIds IS NULL OR LEFT(LTRIM(ownerIds),1)<>'[' OR(SELECT COUNT(*) FROM OPENJSON(ownerIds)) NOT BETWEEN 1 AND 20
    OR EXISTS(SELECT 1 FROM OPENJSON(ownerIds) a WHERE a.type<>1 OR TRY_CONVERT(uniqueidentifier,a.value) IS NULL OR gp._PlanningInternal(TRY_CONVERT(uniqueidentifier,a.value),@Now,@Cutoff)=0)
    OR EXISTS(SELECT value FROM OPENJSON(ownerIds) GROUP BY value HAVING COUNT(*)>1)) THROW 52002,'Internal arrangement owners required.',1;
  IF EXISTS(SELECT id FROM OPENJSON(@Definition,'$.arrangements') WITH(id uniqueidentifier) GROUP BY id HAVING COUNT(*)>1) THROW 52002,'Duplicate arrangement identifier.',1;
  IF EXISTS(SELECT 1 FROM OPENJSON(@Definition) r WHERE r.[key] IN('receptionIds','securityIds','notifyIds','vipNotifyIds') AND
   ((SELECT COUNT(*) FROM OPENJSON(r.value))>100 OR EXISTS(SELECT 1 FROM OPENJSON(r.value) a WHERE a.type<>1 OR TRY_CONVERT(uniqueidentifier,a.value) IS NULL OR gp._PlanningInternal(TRY_CONVERT(uniqueidentifier,a.value),@Now,@Cutoff)=0)
    OR EXISTS(SELECT value FROM OPENJSON(r.value) GROUP BY value HAVING COUNT(*)>1))) THROW 52002,'Invalid internal recipient.',1;
 END;
END;
GO
CREATE PROCEDURE gp.ManageVisitPlanning @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ClientKey uniqueidentifier,@Action varchar(20),@PayloadJson nvarchar(max) AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF @ClientKey IS NULL OR @Action IS NULL OR @Action COLLATE Latin1_General_100_BIN2 NOT IN('PROJECT','HOST','POLICY') OR ISJSON(@PayloadJson)<>1 OR DATALENGTH(@PayloadJson)>65000 OR LEFT(LTRIM(@PayloadJson),1)<>'{' THROW 52002,'Invalid planning management.',1;
 IF EXISTS(SELECT [key] FROM OPENJSON(@PayloadJson) GROUP BY [key] HAVING COUNT(*)>1) THROW 52002,'Duplicate planning fields.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@location int,@pair bigint,@sub uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@PayloadJson,'$.subProjectId')),
  @expected int=TRY_CONVERT(int,JSON_VALUE(@PayloadJson,'$.revision')),@revision int,@reason nvarchar(max)=JSON_VALUE(@PayloadJson,'$.reason'),@op uniqueidentifier,@cached nvarchar(max),@result nvarchar(max),@target uniqueidentifier;
 IF JSON_VALUE(@PayloadJson,'$.subProjectId') IS NOT NULL AND @sub IS NULL THROW 52002,'Invalid project identifier.',1;
 IF @expected IS NULL OR @expected<0 OR @expected>=2147483647 OR @reason IS NULL OR DATALENGTH(@reason) NOT BETWEEN 2 AND 1000 OR LEN(LTRIM(RTRIM(@reason)))=0 THROW 52002,'Revision and reason required.',1;
 BEGIN TRY
 BEGIN TRANSACTION; EXEC gp._TakeLock N'gp:authorization','Exclusive'; EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT; EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF EXISTS(SELECT 1 FROM gp.Employees WHERE UserId=@actor) AND gp._PlanningInternal(@actor,@now,@cutoff)=0 THROW 52001,'Current employee identity required.',1;
 IF @sub IS NOT NULL SELECT @location=LocationId,@pair=AccountOfficeId FROM gp.SubProjects WHERE SubProjectId=@sub;
 ELSE BEGIN SET @location=TRY_CONVERT(int,JSON_VALUE(@PayloadJson,'$.locationId'));SET @pair=TRY_CONVERT(bigint,JSON_VALUE(@PayloadJson,'$.accountOfficeId'));END;
 IF @location IS NULL OR NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@location AND IsActive=1) OR gp._AdminScopeAllowed(@actor,'ROLE_GRANTS_MANAGE',@location,@pair,@now)=0 THROW 52001,'Scoped planning management required.',1;
 DECLARE @operationPayload nvarchar(max)=(SELECT @Action action,JSON_QUERY(@PayloadJson) payload FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 EXEC gp._BeginOperation @actor,'PLANNING_MANAGE',@ClientKey,@operationPayload,@op OUTPUT,@cached OUTPUT;
 IF @cached IS NOT NULL BEGIN COMMIT;SELECT @cached;RETURN;END;
 IF @Action='PROJECT' BEGIN
  IF EXISTS(SELECT 1 FROM OPENJSON(@PayloadJson) WHERE [key] NOT IN('subProjectId','locationId','accountOfficeId','name','active','revision','reason')) THROW 52002,'Invalid project fields.',1;
  DECLARE @name nvarchar(max)=JSON_VALUE(@PayloadJson,'$.name'),@active bit=CASE JSON_VALUE(@PayloadJson,'$.active') WHEN 'true' THEN 1 WHEN 'false' THEN 0 END;
  IF @pair IS NULL OR @name IS NULL OR DATALENGTH(@name) NOT BETWEEN 2 AND 400 OR LEN(LTRIM(RTRIM(@name)))=0 OR @active IS NULL
   OR NOT EXISTS(SELECT 1 FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId WHERE pl.ProjectLocationId=@pair AND pl.LocationId=@location AND pl.IsActive=1 AND p.IsActive=1 AND p.LastSyncedAtUtc BETWEEN @cutoff AND @now) THROW 52002,'Valid account-office and project required.',1;
  IF @sub IS NULL BEGIN
   IF @expected<>0 THROW 52003,'Project revision changed.',1;
   SET @sub=NEWID();SET @revision=1;
   INSERT gp.SubProjects(SubProjectId,AccountOfficeId,LocationId,Name,IsActive,Revision,ChangedByUserId,ChangedAtUtc) VALUES(@sub,@pair,@location,LTRIM(RTRIM(@name)),@active,1,@actor,@now);
  END ELSE BEGIN
   SELECT @revision=Revision FROM gp.SubProjects WHERE SubProjectId=@sub;
   IF @revision<>@expected THROW 52003,'Project revision changed.',1;
   SET @revision+=1;UPDATE gp.SubProjects SET Name=LTRIM(RTRIM(@name)),IsActive=@active,Revision=@revision,ChangedByUserId=@actor,ChangedAtUtc=@now WHERE SubProjectId=@sub;
  END;
  SET @target=@sub;
 END ELSE IF @Action='HOST' BEGIN
  IF EXISTS(SELECT 1 FROM OPENJSON(@PayloadJson) WHERE [key] NOT IN('subProjectId','locationId','userId','active','revision','reason')) THROW 52002,'Invalid host fields.',1;
  DECLARE @user uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@PayloadJson,'$.userId')),@enabled bit=CASE JSON_VALUE(@PayloadJson,'$.active') WHEN 'true' THEN 1 WHEN 'false' THEN 0 END,@employee nvarchar(64);
  SELECT @employee=EmployeeId FROM gp.Employees WHERE UserId=@user;
  IF @user IS NULL OR @employee IS NULL OR @enabled IS NULL THROW 52002,'Internal employee required.',1;
  IF @enabled=1 AND(gp._PlanningInternal(@user,@now,@cutoff)=0 OR(@sub IS NULL AND gp._EmployeeOfficeEligible(@employee,@location,@cutoff,@now)=0) OR(@sub IS NOT NULL AND gp._AccountHostEligible(@employee,@pair,@cutoff,@now)=0)) THROW 52001,'Current approved host eligibility required.',1;
  IF @sub IS NULL SELECT @revision=Revision FROM gp.LocationPlanningHosts WHERE LocationId=@location AND EmployeeId=@employee;
  ELSE SELECT @revision=Revision FROM gp.SubProjectHosts WHERE SubProjectId=@sub AND EmployeeId=@employee;
  IF COALESCE(@revision,0)<>@expected THROW 52003,'Host revision changed.',1;
  SET @revision=COALESCE(@revision,0)+1;
  IF @sub IS NULL BEGIN
   IF @expected=0 INSERT gp.LocationPlanningHosts VALUES(@location,@employee,@enabled,@revision,@actor,@now,@reason);
   ELSE UPDATE gp.LocationPlanningHosts SET IsActive=@enabled,Revision=@revision,ChangedByUserId=@actor,ChangedAtUtc=@now,Reason=@reason WHERE LocationId=@location AND EmployeeId=@employee;
  END ELSE BEGIN
   IF @expected=0 INSERT gp.SubProjectHosts VALUES(@sub,@employee,@enabled,@revision,@actor,@now,@reason);
   ELSE UPDATE gp.SubProjectHosts SET IsActive=@enabled,Revision=@revision,ChangedByUserId=@actor,ChangedAtUtc=@now,Reason=@reason WHERE SubProjectId=@sub AND EmployeeId=@employee;
  END;
  SET @target=@user;
 END ELSE BEGIN
  IF EXISTS(SELECT 1 FROM OPENJSON(@PayloadJson) WHERE [key] NOT IN('subProjectId','locationId','revision','reason','definition')) THROW 52002,'Invalid policy fields.',1;
  DECLARE @definition nvarchar(max)=JSON_QUERY(@PayloadJson,'$.definition'),@local bit=CASE WHEN @sub IS NULL THEN 1 ELSE 0 END,@policy uniqueidentifier;
  EXEC gp._ValidatePlanningPolicy @definition,@local,@now,@cutoff;
  SELECT @revision=Revision,@policy=PolicyId FROM gp.VisitPlanningPolicies WHERE LocationId=@location AND((@sub IS NULL AND ScopeKind='LOCATION') OR SubProjectId=@sub);
  IF COALESCE(@revision,0)<>@expected THROW 52003,'Policy revision changed.',1;
  SET @revision=COALESCE(@revision,0)+1;
  IF @policy IS NULL BEGIN SET @policy=NEWID();INSERT gp.VisitPlanningPolicies VALUES(@policy,@location,CASE WHEN @sub IS NULL THEN 'LOCATION' ELSE 'SUBPROJECT' END,@pair,@sub,@revision,1,@definition,@actor,@now,@reason);END;
  ELSE UPDATE gp.VisitPlanningPolicies SET DefinitionJson=@definition,Revision=@revision,IsActive=1,ChangedByUserId=@actor,ChangedAtUtc=@now,Reason=@reason WHERE PolicyId=@policy;
  SET @target=@policy;
 END;
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode,MetadataJson)
 VALUES(@actor,'VISIT_PLANNING_MANAGED','PLANNING',CONVERT(nvarchar(36),@target),@location,@pair,'SUCCESS',(SELECT @Action action,@reason reason,@revision revision,@sub subProjectId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
 SET @result=(SELECT @target id,@revision revision FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);EXEC gp._CompleteOperation @op,@result;COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp._BuildVisitPlanVersion @Plan uniqueidentifier,@Version int,@Draft nvarchar(max),@Host uniqueidentifier,@Now datetime2(3),@Cutoff datetime2(3) AS BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 THROW 52000,'Plan transaction required.',1;
 IF ISJSON(@Draft)<>1 OR LEFT(LTRIM(@Draft),1)<>'{' OR DATALENGTH(@Draft)>16000
  OR EXISTS(SELECT 1 FROM OPENJSON(@Draft) WHERE [key] NOT IN('locationId','subProjectIds','visitorName','visitorEmail','company','purpose','startsAtUtc','untilUtc','vip','stay'))
  OR EXISTS(SELECT [key] FROM OPENJSON(@Draft) GROUP BY [key] HAVING COUNT(*)>1) THROW 52002,'Invalid invitation fields.',1;
 DECLARE @location int=TRY_CONVERT(int,JSON_VALUE(@Draft,'$.locationId')),@name nvarchar(max)=JSON_VALUE(@Draft,'$.visitorName'),@email nvarchar(max)=JSON_VALUE(@Draft,'$.visitorEmail'),@company nvarchar(max)=JSON_VALUE(@Draft,'$.company'),@purpose nvarchar(max)=JSON_VALUE(@Draft,'$.purpose'),
  @start datetime2(3)=TRY_CONVERT(datetime2(3),JSON_VALUE(@Draft,'$.startsAtUtc'),127),@until datetime2(3)=TRY_CONVERT(datetime2(3),JSON_VALUE(@Draft,'$.untilUtc'),127),
  @vip bit=CASE JSON_VALUE(@Draft,'$.vip') WHEN 'true' THEN 1 WHEN 'false' THEN 0 END,@checkIn date=TRY_CONVERT(date,JSON_VALUE(@Draft,'$.stay.checkInDate'),23),@checkOut date=TRY_CONVERT(date,JSON_VALUE(@Draft,'$.stay.checkOutDate'),23),@stayNotes nvarchar(max)=JSON_VALUE(@Draft,'$.stay.notes'),@stay nvarchar(max)=JSON_QUERY(@Draft,'$.stay'),@policy nvarchar(max),@policyId uniqueidentifier,@policyRevision int;
 IF @location IS NULL OR @location<>(SELECT LocationId FROM gp.VisitPlans WHERE PlanId=@Plan) OR @name IS NULL OR DATALENGTH(@name) NOT BETWEEN 2 AND 400 OR LEN(LTRIM(RTRIM(@name)))=0 OR @purpose IS NULL OR DATALENGTH(@purpose) NOT BETWEEN 2 AND 2000 OR LEN(LTRIM(RTRIM(@purpose)))=0 OR @vip IS NULL
  OR @start IS NULL OR @until IS NULL OR @start<@Now OR @start>=@until OR RIGHT(JSON_VALUE(@Draft,'$.startsAtUtc'),1)<>'Z' OR RIGHT(JSON_VALUE(@Draft,'$.untilUtc'),1)<>'Z'
  OR(@email IS NOT NULL AND(DATALENGTH(@email)>640 OR @email NOT LIKE '%_@_%._%')) OR(@company IS NOT NULL AND(DATALENGTH(@company) NOT BETWEEN 2 AND 400)) OR(@stayNotes IS NOT NULL AND DATALENGTH(@stayNotes)>2000) THROW 52002,'Invalid invitation details.',1;
 SELECT @policy=DefinitionJson,@policyId=PolicyId,@policyRevision=Revision FROM gp.VisitPlanningPolicies WHERE LocationId=@location AND ScopeKind='LOCATION' AND IsActive=1;
 IF @policy IS NULL THROW 52004,'Office planning policy unavailable.',1;
 EXEC gp._ValidatePlanningPolicy @policy,1,@Now,@Cutoff;
 IF @start>DATEADD(day,TRY_CONVERT(int,JSON_VALUE(@policy,'$.maximumAdvanceDays')),@Now) OR @until>DATEADD(day,TRY_CONVERT(int,JSON_VALUE(@policy,'$.maximumVisitDays')),@start) THROW 52002,'Invitation date limit exceeded.',1;
 IF @stay IS NOT NULL AND(@checkIn IS NULL OR @checkOut IS NULL OR @checkIn>=@checkOut OR DATEDIFF(day,@checkIn,@checkOut)>366 OR DATEADD(minute,-330,CONVERT(datetime2(3),@checkIn))>=@until OR DATEADD(minute,-330,CONVERT(datetime2(3),@checkOut))<=@start
  OR EXISTS(SELECT 1 FROM OPENJSON(@stay) WHERE [key] NOT IN('checkInDate','checkOutDate','notes')) OR EXISTS(SELECT [key] FROM OPENJSON(@stay) GROUP BY [key] HAVING COUNT(*)>1)) THROW 52002,'Invalid stay dates.',1;
 IF NOT EXISTS(SELECT 1 FROM OPENJSON(@Draft) WHERE [key]='subProjectIds' AND type=4) THROW 52002,'Project selection required.',1;
 DECLARE @selected table(SubProjectId uniqueidentifier PRIMARY KEY);
 IF(SELECT COUNT(*) FROM OPENJSON(@Draft,'$.subProjectIds'))>10 OR EXISTS(SELECT 1 FROM OPENJSON(@Draft,'$.subProjectIds') WHERE type<>1 OR TRY_CONVERT(uniqueidentifier,value) IS NULL)
  OR EXISTS(SELECT TRY_CONVERT(uniqueidentifier,value) FROM OPENJSON(@Draft,'$.subProjectIds') GROUP BY TRY_CONVERT(uniqueidentifier,value) HAVING COUNT(*)>1) THROW 52002,'Invalid selected projects.',1;
 INSERT @selected SELECT CONVERT(uniqueidentifier,value) FROM OPENJSON(@Draft,'$.subProjectIds');
 IF gp._PlanningInternal(@Host,@Now,@Cutoff)=0 OR(EXISTS(SELECT 1 FROM @selected) AND EXISTS(SELECT 1 FROM @selected WHERE gp._PlanningHost(@Host,@location,SubProjectId,@Now,@Cutoff)=0)) OR(NOT EXISTS(SELECT 1 FROM @selected) AND gp._PlanningHost(@Host,@location,NULL,@Now,@Cutoff)=0) THROW 52001,'Explicit current host authority required.',1;
 IF EXISTS(SELECT 1 FROM @selected s LEFT JOIN gp.VisitPlanningPolicies p ON p.SubProjectId=s.SubProjectId AND p.ScopeKind='SUBPROJECT' AND p.IsActive=1 WHERE p.PolicyId IS NULL) THROW 52004,'Project planning policy unavailable.',1;
 DECLARE @snapshot nvarchar(max)=(SELECT JSON_QUERY((SELECT PolicyId policyId,Revision revision FROM gp.VisitPlanningPolicies WHERE PolicyId=@policyId OR(SubProjectId IN(SELECT SubProjectId FROM @selected) AND ScopeKind='SUBPROJECT' AND IsActive=1) ORDER BY PolicyId FOR JSON PATH)) policies,
  JSON_QUERY(COALESCE((SELECT s.SubProjectId subProjectId,s.Revision revision,CONVERT(varchar(20),s.AccountOfficeId) accountOfficeId FROM gp.SubProjects s JOIN @selected p ON p.SubProjectId=s.SubProjectId ORDER BY s.SubProjectId FOR JSON PATH),N'[]')) projects FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.VisitPlanVersions(PlanId,Version,LocationId,IsCurrent,VisitorName,VisitorEmail,Company,Purpose,StartsAtUtc,UntilUtc,IsVip,StayCheckInDate,StayCheckOutDate,StayNotes,PolicySnapshotJson)
 VALUES(@Plan,@Version,@location,1,LTRIM(RTRIM(@name)),@email,@company,@purpose,@start,@until,@vip,@checkIn,@checkOut,@stayNotes,@snapshot);
 INSERT gp.VisitPlanProjects SELECT @Plan,@Version,s.SubProjectId,s.AccountOfficeId,@location FROM gp.SubProjects s JOIN @selected p ON p.SubProjectId=s.SubProjectId;
 DECLARE @ruleDefs table(SubProjectId uniqueidentifier NULL,Definition nvarchar(max));
 INSERT @ruleDefs VALUES(NULL,@policy);
 INSERT @ruleDefs SELECT s.SubProjectId,p.DefinitionJson FROM @selected s JOIN gp.VisitPlanningPolicies p ON p.SubProjectId=s.SubProjectId AND p.ScopeKind='SUBPROJECT' AND p.IsActive=1;
 DECLARE @definition nvarchar(max),@local bit;
 DECLARE rules CURSOR LOCAL FAST_FORWARD FOR SELECT Definition,CASE WHEN SubProjectId IS NULL THEN 1 ELSE 0 END FROM @ruleDefs;
 OPEN rules;FETCH NEXT FROM rules INTO @definition,@local;
 WHILE @@FETCH_STATUS=0 BEGIN EXEC gp._ValidatePlanningPolicy @definition,@local,@Now,@Cutoff;FETCH NEXT FROM rules INTO @definition,@local;END;
 CLOSE rules;DEALLOCATE rules;
 IF(SELECT COUNT(*) FROM @ruleDefs d CROSS APPLY OPENJSON(d.Definition,'$.approvalRules'))>50 OR EXISTS(SELECT r.id FROM @ruleDefs d CROSS APPLY OPENJSON(d.Definition,'$.approvalRules') WITH(id uniqueidentifier) r GROUP BY r.id HAVING COUNT(*)>1) THROW 52004,'Conflicting approval policy identifiers.',1;
 INSERT gp.VisitPlanApprovalSteps SELECT @Plan,@Version,r.id,d.SubProjectId,r.name,r.kind,r.mode FROM @ruleDefs d CROSS APPLY OPENJSON(d.Definition,'$.approvalRules') WITH(id uniqueidentifier,name nvarchar(120),kind varchar(24),mode varchar(3)) r;
 INSERT gp.VisitPlanApprovers SELECT @Plan,@Version,r.id,CONVERT(uniqueidentifier,a.value) FROM @ruleDefs d CROSS APPLY OPENJSON(d.Definition,'$.approvalRules') WITH(id uniqueidentifier,approverIds nvarchar(max) AS JSON) r CROSS APPLY OPENJSON(r.approverIds) a;
 IF EXISTS(SELECT 1 FROM gp.VisitPlanApprovalSteps s WHERE s.PlanId=@Plan AND s.Version=@Version AND
  ((s.Mode='ALL' AND EXISTS(SELECT 1 FROM gp.VisitPlanApprovers a WHERE a.PlanId=@Plan AND a.Version=@Version AND a.StepId=s.StepId AND a.UserId=@Host)) OR
   (s.Mode='ANY' AND NOT EXISTS(SELECT 1 FROM gp.VisitPlanApprovers a WHERE a.PlanId=@Plan AND a.Version=@Version AND a.StepId=s.StepId AND a.UserId<>@Host)))) THROW 52004,'Independent approval authority required.',1;
 INSERT gp.VisitPlanTasks SELECT @Plan,@Version,r.id,r.name,r.kind,r.mandatoryForEntry,'REQUESTED',N'' FROM OPENJSON(@policy,'$.arrangements') WITH(id uniqueidentifier,name nvarchar(120),kind varchar(8),mandatoryForEntry bit) r WHERE r.kind<>'STAY' OR @stay IS NOT NULL;
 INSERT gp.VisitPlanTaskOwners SELECT @Plan,@Version,r.id,CONVERT(uniqueidentifier,o.value) FROM OPENJSON(@policy,'$.arrangements') WITH(id uniqueidentifier,ownerIds nvarchar(max) AS JSON) r CROSS APPLY OPENJSON(r.ownerIds) o WHERE EXISTS(SELECT 1 FROM gp.VisitPlanTasks t WHERE t.PlanId=@Plan AND t.Version=@Version AND t.TaskId=r.id);
 IF @stay IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gp.VisitPlanTasks WHERE PlanId=@Plan AND Version=@Version AND Kind='STAY') THROW 52004,'Stay responsibility unavailable.',1;
 INSERT gp.VisitPlanParticipants SELECT @Plan,@Version,NEWID(),CONVERT(uniqueidentifier,m.value),NULL,r.roleCode FROM(VALUES('RECEPTION',JSON_QUERY(@policy,'$.receptionIds')),('SECURITY',JSON_QUERY(@policy,'$.securityIds')))r(roleCode,members) CROSS APPLY OPENJSON(r.members) m;
END;
GO
GRANT EXECUTE ON gp.ManageVisitPlanning TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('125',N'Scoped planning administration and validated immutable visit version construction');
COMMIT;
