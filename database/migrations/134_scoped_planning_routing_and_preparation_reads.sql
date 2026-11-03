SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='133') OR EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='134') THROW 52000,'Migration 133 required; 134 must be new.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
CREATE FUNCTION gp._PlanPreparationRead(@Actor uniqueidentifier,@Plan uniqueidentifier,@Version int,@Now datetime2(3),@Cutoff datetime2(3)) RETURNS nvarchar(max) WITH INLINE=OFF AS BEGIN
 DECLARE @json nvarchar(max),@host uniqueidentifier;
 SELECT @host=HostUserId FROM gp.VisitPlans WHERE PlanId=@Plan;
 SELECT @json=DefinitionJson FROM gp.VisitPlanPreparation WHERE PlanId=@Plan AND Version=@Version;
 IF @json IS NULL RETURN NULL;
 IF @Actor=@host OR gp._PlanFullManager(@Actor,@Plan,@Version,@Now)=1 OR gp._PlanOfficeParticipant(@Actor,@Plan,@Version,@Now,@Cutoff)=1
  OR EXISTS(SELECT 1 FROM gp.VisitPlanProjects WHERE PlanId=@Plan AND Version=@Version AND gp._PlanProjectReadable(@Actor,@Plan,@Version,SubProjectId,@Now,@Cutoff)=1) BEGIN
  SET @json=JSON_MODIFY(@json,'$.contacts',JSON_QUERY(COALESCE((SELECT p.[key] role,u.UserId userId,u.DisplayName name FROM OPENJSON(@json) p JOIN gp.Users u ON u.UserId=TRY_CONVERT(uniqueidentifier,p.value) WHERE p.[key] IN('coordinatorId','visitOwnerId','alternateReceiverId') AND gp._PlanningInternal(u.UserId,@Now,@Cutoff)=1 ORDER BY p.[key] FOR JSON PATH),N'[]')));
  RETURN @json;
 END;
 IF EXISTS(SELECT 1 FROM gp.VisitPlanTasks t WHERE t.PlanId=@Plan AND t.Version=@Version AND t.Kind='OTHER' AND gp._PlanLiveTaskOwner(@Actor,@Plan,@Version,t.TaskId,@Now,@Cutoff)=1)
  RETURN(SELECT JSON_QUERY(@json,'$.services') services,JSON_VALUE(@json,'$.meetingLocation') meetingLocation,JSON_VALUE(@json,'$.requirements') requirements FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 RETURN NULL;
END;
GO
DECLARE @definition nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID('gp.ReadVisitCoordination')),@needle nvarchar(200),@replacement nvarchar(max);
SET @needle=N'''OPTIONS'',''LIST'',''DETAIL'',''THREAD''';
IF CHARINDEX(@needle,@definition)=0 THROW 52000,'Planning mode contract required.',1;
SET @definition=REPLACE(@definition,@needle,N'''OPTIONS'',''LIST'',''DETAIL'',''THREAD'',''PEOPLE'',''ROUTING''');
SET @needle=N' IF @Mode=''OPTIONS'' BEGIN';
SET @replacement=N' IF @Mode IN(''PEOPLE'',''ROUTING'') BEGIN
  IF @location IS NULL OR @location<=0 OR (gp._PlanningSponsor(@actor,@location,@now,@cutoff)=0 AND gp._PlanningAdmin(@actor,@location,NULL,@now)=0) THROW 52001,''Current invitation-host scope required.'',1;
  IF EXISTS(SELECT 1 FROM OPENJSON(@QueryJson) WHERE [key] NOT IN(''locationId'',''search'',''subProjectIds'')) THROW 52002,''Invalid routing query.'',1;
  IF @Mode=''PEOPLE'' BEGIN
   IF @search IS NULL OR LEN(LTRIM(RTRIM(@search)))<2 OR LEN(@search)>80 OR EXISTS(SELECT 1 FROM OPENJSON(@QueryJson) WHERE [key]=''subProjectIds'') THROW 52002,''Enter at least two characters.'',1;
   SET @result=(SELECT JSON_QUERY(COALESCE((SELECT TOP(20) e.UserId userId,e.FullName name,e.OfficialEmail email FROM gp.Employees e WHERE gp._PlanningInternal(e.UserId,@now,@cutoff)=1 AND(CHARINDEX(@search,e.FullName)>0 OR CHARINDEX(@search,e.OfficialEmail)>0) ORDER BY e.FullName,e.UserId FOR JSON PATH),N''[]'')) people FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  END ELSE BEGIN
   DECLARE @requested nvarchar(max)=JSON_QUERY(@QueryJson,''$.subProjectIds'');
   IF @requested IS NULL OR LEFT(LTRIM(@requested),1)<>''['' OR (SELECT COUNT(*) FROM OPENJSON(@requested))>10 OR EXISTS(SELECT 1 FROM OPENJSON(@requested) WHERE type<>1 OR DATALENGTH(value)<>72 OR TRY_CONVERT(uniqueidentifier,value) IS NULL OR gp._PlanningHost(@actor,@location,TRY_CONVERT(uniqueidentifier,value),@now,@cutoff)=0)
    OR EXISTS(SELECT TRY_CONVERT(uniqueidentifier,value) FROM OPENJSON(@requested) GROUP BY TRY_CONVERT(uniqueidentifier,value) HAVING COUNT(*)>1) OR EXISTS(SELECT 1 FROM OPENJSON(@QueryJson) WHERE [key]=''search'') THROW 52002,''Invalid requested destinations.'',1;
   SET @result=(SELECT JSON_QUERY(COALESCE((SELECT p.LocationId locationId,p.SubProjectId subProjectId,
    JSON_QUERY(COALESCE((SELECT r.id id,r.name name,r.mode mode,JSON_QUERY(COALESCE((SELECT u.UserId userId,u.DisplayName name FROM OPENJSON(r.approverIds) a JOIN gp.Users u ON u.UserId=TRY_CONVERT(uniqueidentifier,a.value) WHERE gp._PlanningInternal(u.UserId,@now,@cutoff)=1 ORDER BY u.DisplayName,u.UserId FOR JSON PATH),N''[]'')) approvers FROM OPENJSON(p.DefinitionJson,''$.approvalRules'') WITH(id uniqueidentifier,name nvarchar(120),mode varchar(3),approverIds nvarchar(max) AS JSON) r FOR JSON PATH),N''[]'')) approvalSteps,
    JSON_QUERY(COALESCE((SELECT u.UserId userId,u.DisplayName name FROM OPENJSON(p.DefinitionJson,''$.notifyIds'') m JOIN gp.Users u ON u.UserId=TRY_CONVERT(uniqueidentifier,m.value) WHERE gp._PlanningInternal(u.UserId,@now,@cutoff)=1 ORDER BY u.DisplayName,u.UserId FOR JSON PATH),N''[]'')) notify,
    JSON_QUERY(COALESCE((SELECT u.UserId userId,u.DisplayName name FROM OPENJSON(p.DefinitionJson,''$.vipNotifyIds'') m JOIN gp.Users u ON u.UserId=TRY_CONVERT(uniqueidentifier,m.value) WHERE gp._PlanningInternal(u.UserId,@now,@cutoff)=1 ORDER BY u.DisplayName,u.UserId FOR JSON PATH),N''[]'')) vipNotify,
    JSON_QUERY(COALESCE((SELECT a.name name,a.kind kind,JSON_QUERY(COALESCE((SELECT u.UserId userId,u.DisplayName name FROM OPENJSON(a.ownerIds) m JOIN gp.Users u ON u.UserId=TRY_CONVERT(uniqueidentifier,m.value) WHERE gp._PlanningInternal(u.UserId,@now,@cutoff)=1 ORDER BY u.DisplayName,u.UserId FOR JSON PATH),N''[]'')) owners FROM OPENJSON(p.DefinitionJson,''$.arrangements'') WITH(name nvarchar(120),kind varchar(5),ownerIds nvarchar(max) AS JSON) a FOR JSON PATH),N''[]'')) arrangements
    FROM gp.VisitPlanningPolicies p WHERE p.IsActive=1 AND p.LocationId=@location AND(p.ScopeKind=''LOCATION'' OR p.ScopeKind=''SUBPROJECT'' AND EXISTS(SELECT 1 FROM OPENJSON(@requested) r WHERE TRY_CONVERT(uniqueidentifier,r.value)=p.SubProjectId)) ORDER BY p.ScopeKind,p.SubProjectId FOR JSON PATH),N''[]'')) routing FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  END;
 END ELSE IF @Mode=''OPTIONS'' BEGIN';
IF CHARINDEX(@needle,@definition)=0 THROW 52000,'Planning options contract required.',1;
SET @definition=REPLACE(@definition,@needle,@replacement);
SET @needle=N' COMMIT;SELECT @result;';
SET @replacement=N' IF @Mode=''DETAIL'' BEGIN
  SET @result=JSON_MODIFY(@result,''$.preparation'',JSON_QUERY(gp._PlanPreparationRead(@actor,@plan,@version,@now,@cutoff)));
  DECLARE @additional nvarchar(max)=(SELECT e.UserId userId,e.Kind kind,e.SubProjectId subProjectId,u.DisplayName name FROM gp.VisitPlanExtraPeople e JOIN gp.Users u ON u.UserId=e.UserId WHERE e.PlanId=@plan AND e.Version=@version AND e.IsAutomatic=0 AND(@actor=@owner OR @full=1 OR(e.SubProjectId IS NULL AND @office=1) OR(e.SubProjectId IS NOT NULL AND gp._PlanProjectReadable(@actor,@plan,@version,e.SubProjectId,@now,@cutoff)=1)) ORDER BY e.Kind,u.DisplayName,e.ExtraId FOR JSON PATH);
  SET @result=JSON_MODIFY(@result,''$.additionalPeople'',JSON_QUERY(COALESCE(@additional,N''[]'')));
  IF @actor=@owner BEGIN
   DECLARE @ownerDraft nvarchar(max)=(SELECT value FROM OPENJSON(@result) WHERE [key]=''draft'');
   IF ISJSON(@ownerDraft)=1 SET @result=JSON_MODIFY(@result,''$.draft'',JSON_QUERY(@ownerDraft));
   SET @result=JSON_MODIFY(@result,''$.draft.preparation'',JSON_QUERY((SELECT DefinitionJson FROM gp.VisitPlanPreparation WHERE PlanId=@plan AND Version=@version)));
   SET @result=JSON_MODIFY(@result,''$.draft.additionalPeople'',JSON_QUERY(COALESCE((SELECT e.UserId userId,e.Kind kind,e.SubProjectId subProjectId FROM gp.VisitPlanExtraPeople e WHERE e.PlanId=@plan AND e.Version=@version AND e.IsAutomatic=0 ORDER BY e.ExtraId FOR JSON PATH),N''[]'')));
  END;
  DECLARE @approvalIndex nvarchar(20),@approvalId uniqueidentifier,@approvers nvarchar(max);
  DECLARE approvalNames CURSOR LOCAL FAST_FORWARD FOR SELECT [key],TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,''$.id'')) FROM OPENJSON(@result,''$.approvals'');
  OPEN approvalNames;FETCH NEXT FROM approvalNames INTO @approvalIndex,@approvalId;
  WHILE @@FETCH_STATUS=0 BEGIN
   SET @approvers=(SELECT u.UserId userId,u.DisplayName name FROM gp.VisitPlanApprovers a JOIN gp.Users u ON u.UserId=a.UserId WHERE a.PlanId=@plan AND a.Version=@version AND a.StepId=@approvalId AND gp._PlanLiveApprover(a.UserId,@plan,@version,@approvalId,@now,@cutoff)=1 ORDER BY u.DisplayName,u.UserId FOR JSON PATH);
   SET @result=JSON_MODIFY(@result,''$.approvals[''+@approvalIndex+''].approvers'',JSON_QUERY(COALESCE(@approvers,N''[]'')));
   FETCH NEXT FROM approvalNames INTO @approvalIndex,@approvalId;
  END;CLOSE approvalNames;DEALLOCATE approvalNames;
 END;
 COMMIT;SELECT @result;';
IF CHARINDEX(@needle,@definition)=0 THROW 52000,'Planning projection contract required.',1;
SET @definition=REPLACE(@definition,@needle,@replacement);
SET @definition=STUFF(@definition,1,CHARINDEX(' ',@definition)-1,'ALTER');EXEC sys.sp_executesql @definition;
INSERT gp.SchemaMigrations(Version,Description) VALUES('134',N'Host-scoped people search, selected-destination routing preview and private preparation/recipient projections');
COMMIT;
