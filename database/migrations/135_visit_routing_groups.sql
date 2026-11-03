/* Admin-owned routing groups; additive reviews, never a replacement for mandatory policies. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='134') OR EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='135') THROW 52000,'Migration 134 required; 135 must be new.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
CREATE TABLE gp.VisitRoutingGroups(GroupId uniqueidentifier NOT NULL PRIMARY KEY,LocationId int NOT NULL REFERENCES gp.Locations(LocationId),SubProjectId uniqueidentifier NULL REFERENCES gp.SubProjects(SubProjectId),Name nvarchar(120) NOT NULL,Description nvarchar(500) NOT NULL,IsVipOnly bit NOT NULL,IsActive bit NOT NULL,Revision int NOT NULL CHECK(Revision>0),MembersJson nvarchar(max) NOT NULL CHECK(ISJSON(MembersJson)=1),ChangedByUserId uniqueidentifier NOT NULL REFERENCES gp.Users(UserId),ChangedAtUtc datetime2(3) NOT NULL,Reason nvarchar(500) NOT NULL);
CREATE INDEX IX_VisitRoutingGroups_Office ON gp.VisitRoutingGroups(LocationId,IsActive);
CREATE TABLE gp.VisitPlanGroups(PlanId uniqueidentifier NOT NULL,Version int NOT NULL,GroupId uniqueidentifier NOT NULL REFERENCES gp.VisitRoutingGroups(GroupId),Revision int NOT NULL,Name nvarchar(120) NOT NULL,SubProjectId uniqueidentifier NULL,IsVipOnly bit NOT NULL,MembersJson nvarchar(max) NOT NULL CHECK(ISJSON(MembersJson)=1),
 CONSTRAINT PK_VisitPlanGroups PRIMARY KEY(PlanId,Version,GroupId),CONSTRAINT FK_VisitPlanGroups_Version FOREIGN KEY(PlanId,Version) REFERENCES gp.VisitPlanVersions(PlanId,Version),CONSTRAINT FK_VisitPlanGroups_Project FOREIGN KEY(PlanId,Version,SubProjectId) REFERENCES gp.VisitPlanProjects(PlanId,Version,SubProjectId));
CREATE TABLE gp.VisitPlanGroupReviewers(PlanId uniqueidentifier NOT NULL,Version int NOT NULL,StepId uniqueidentifier NOT NULL,UserId uniqueidentifier NOT NULL REFERENCES gp.Users(UserId),SubProjectId uniqueidentifier NULL,
 CONSTRAINT PK_VisitPlanGroupReviewers PRIMARY KEY(PlanId,Version,StepId),CONSTRAINT FK_VisitPlanGroupReviewers_Step FOREIGN KEY(PlanId,Version,StepId) REFERENCES gp.VisitPlanApprovalSteps(PlanId,Version,StepId));
GO
CREATE PROCEDURE gp._ManageVisitRoutingGroup @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ClientKey uniqueidentifier,@PayloadJson nvarchar(max) AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF @ClientKey IS NULL OR @PayloadJson IS NULL OR ISJSON(@PayloadJson)<>1 OR LEFT(LTRIM(@PayloadJson),1)<>'{' OR DATALENGTH(@PayloadJson)>32000
  OR EXISTS(SELECT 1 FROM OPENJSON(@PayloadJson) WHERE [key] NOT IN('id','locationId','subProjectId','name','description','vipOnly','active','members','revision','reason')) OR EXISTS(SELECT [key] FROM OPENJSON(@PayloadJson) GROUP BY [key] HAVING COUNT(*)>1) THROW 52002,'Invalid visit group.',1;
 DECLARE @id uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@PayloadJson,'$.id')),@sub uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@PayloadJson,'$.subProjectId')),@location int=TRY_CONVERT(int,JSON_VALUE(@PayloadJson,'$.locationId')),@expected int=TRY_CONVERT(int,JSON_VALUE(@PayloadJson,'$.revision')),
 @name nvarchar(max)=JSON_VALUE(@PayloadJson,'$.name'),@description nvarchar(max)=JSON_VALUE(@PayloadJson,'$.description'),@reason nvarchar(max)=JSON_VALUE(@PayloadJson,'$.reason'),@members nvarchar(max)=JSON_QUERY(@PayloadJson,'$.members'),@vip bit=CASE JSON_VALUE(@PayloadJson,'$.vipOnly') WHEN 'true' THEN 1 WHEN 'false' THEN 0 END,@active bit=CASE JSON_VALUE(@PayloadJson,'$.active') WHEN 'true' THEN 1 WHEN 'false' THEN 0 END,@actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@revision int,@op uniqueidentifier,@cached nvarchar(max),@result nvarchar(max),@pair bigint;
 IF @expected IS NULL OR @expected<0 OR @expected>=2147483647 OR @name IS NULL OR DATALENGTH(@name) NOT BETWEEN 2 AND 240 OR LEN(LTRIM(RTRIM(@name)))=0 OR @description IS NULL OR DATALENGTH(@description)>1000 OR @reason IS NULL OR DATALENGTH(@reason) NOT BETWEEN 2 AND 1000 OR LEN(LTRIM(RTRIM(@reason)))=0 OR @active IS NULL OR @vip IS NULL
  OR EXISTS(SELECT 1 FROM OPENJSON(@PayloadJson) WHERE ([key] IN('id','subProjectId') AND(type<>1 OR DATALENGTH(value)<>72 OR TRY_CONVERT(uniqueidentifier,value) IS NULL)) OR([key] IN('name','description','reason') AND type<>1) OR([key] IN('active','vipOnly') AND type<>3))
  OR @members IS NULL OR LEFT(LTRIM(@members),1)<>'[' OR(SELECT COUNT(*) FROM OPENJSON(@members)) NOT BETWEEN 1 AND 20 THROW 52002,'Bounded group fields and members required.',1;
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF EXISTS(SELECT 1 FROM gp.Employees WHERE UserId=@actor) AND gp._PlanningInternal(@actor,@now,@cutoff)=0 THROW 52001,'Current identity required.',1;
 IF @sub IS NOT NULL SELECT @location=LocationId,@pair=AccountOfficeId FROM gp.SubProjects WHERE SubProjectId=@sub AND IsActive=1;
 IF @location IS NULL OR NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@location AND IsActive=1) OR gp._PlanningAdmin(@actor,@location,@sub,@now)=0 THROW 52001,'Scoped group administration required.',1;
 IF @sub IS NOT NULL AND JSON_VALUE(@PayloadJson,'$.locationId') IS NOT NULL THROW 52002,'Use one scope.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@members) WHERE type<>5) OR EXISTS(SELECT 1 FROM OPENJSON(@members) m CROSS APPLY OPENJSON(m.value) p WHERE p.[key] NOT IN('userId','email','name','kind'))
  OR EXISTS(SELECT m.[key],p.[key] FROM OPENJSON(@members) m CROSS APPLY OPENJSON(m.value) p GROUP BY m.[key],p.[key] HAVING COUNT(*)>1)
  OR EXISTS(SELECT 1 FROM OPENJSON(@members) m WHERE JSON_VALUE(m.value,'$.kind') IS NULL OR JSON_VALUE(m.value,'$.kind') COLLATE Latin1_General_100_BIN2 NOT IN('APPROVAL','NOTIFY')
   OR(JSON_VALUE(m.value,'$.userId') IS NOT NULL AND(DATALENGTH(JSON_VALUE(m.value,'$.userId'))<>72 OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(m.value,'$.userId')) IS NULL OR(@active=1 AND gp._PlanningInternal(TRY_CONVERT(uniqueidentifier,JSON_VALUE(m.value,'$.userId')),@now,@cutoff)=0) OR JSON_VALUE(m.value,'$.email') IS NOT NULL OR JSON_VALUE(m.value,'$.name') IS NOT NULL))
   OR(JSON_VALUE(m.value,'$.userId') IS NULL AND(JSON_VALUE(m.value,'$.kind')<>'NOTIFY' OR JSON_VALUE(m.value,'$.email') IS NULL OR DATALENGTH(JSON_VALUE(m.value,'$.email'))>640 OR JSON_VALUE(m.value,'$.email') NOT LIKE '%_@_%._%' OR JSON_VALUE(m.value,'$.email') LIKE '%[ <>]%' OR CHARINDEX(CHAR(13),JSON_VALUE(m.value,'$.email'))>0 OR CHARINDEX(CHAR(10),JSON_VALUE(m.value,'$.email'))>0 OR CHARINDEX(CHAR(9),JSON_VALUE(m.value,'$.email'))>0 OR CHARINDEX(';',JSON_VALUE(m.value,'$.email'))>0 OR CHARINDEX(',',JSON_VALUE(m.value,'$.email'))>0 OR DATALENGTH(JSON_VALUE(m.value,'$.name'))>400)))
  OR EXISTS(SELECT 1 FROM OPENJSON(@members) m CROSS APPLY OPENJSON(m.value) p WHERE p.[key] IN('userId','email','name','kind') AND p.type<>1)
  OR EXISTS(SELECT COALESCE(LOWER(JSON_VALUE(value,'$.userId')),LOWER(JSON_VALUE(value,'$.email'))) FROM OPENJSON(@members) GROUP BY COALESCE(LOWER(JSON_VALUE(value,'$.userId')),LOWER(JSON_VALUE(value,'$.email'))) HAVING COUNT(*)>1) THROW 52002,'Only internal approvals and valid notification recipients are allowed.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@members) m JOIN gp.Employees e ON e.OfficialEmail=JSON_VALUE(m.value,'$.email') WHERE gp._PlanningInternal(e.UserId,@now,@cutoff)=1) THROW 52002,'Select directory employees by name rather than adding their email again.',1;
 EXEC gp._BeginOperation @actor,'VISIT_GROUP_MANAGE',@ClientKey,@PayloadJson,@op OUTPUT,@cached OUTPUT;
 IF @cached IS NOT NULL BEGIN COMMIT;SELECT @cached;RETURN;END;
 IF EXISTS(SELECT 1 FROM gp.VisitRoutingGroups WHERE LocationId=@location AND ISNULL(SubProjectId,'00000000-0000-0000-0000-000000000000')=ISNULL(@sub,'00000000-0000-0000-0000-000000000000') AND Name=LTRIM(RTRIM(@name)) AND(@id IS NULL OR GroupId<>@id)) THROW 52003,'Group name already exists in this scope.',1;
 IF @id IS NULL BEGIN
  IF @expected<>0 THROW 52003,'Group revision changed.',1;
  SET @id=NEWID();SET @revision=1;
  INSERT gp.VisitRoutingGroups VALUES(@id,@location,@sub,LTRIM(RTRIM(@name)),@description,@vip,@active,@revision,@members,@actor,@now,@reason);
 END ELSE BEGIN
  SELECT @revision=Revision FROM gp.VisitRoutingGroups WHERE GroupId=@id AND LocationId=@location AND ISNULL(SubProjectId,'00000000-0000-0000-0000-000000000000')=ISNULL(@sub,'00000000-0000-0000-0000-000000000000');
  IF @revision IS NULL OR @revision<>@expected THROW 52003,'Group scope or revision changed.',1;
  SET @revision+=1;UPDATE gp.VisitRoutingGroups SET Name=LTRIM(RTRIM(@name)),Description=@description,IsVipOnly=@vip,IsActive=@active,Revision=@revision,MembersJson=@members,ChangedByUserId=@actor,ChangedAtUtc=@now,Reason=@reason WHERE GroupId=@id;
 END;
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,LocationId,ProjectLocationId,TargetType,TargetReference,ResultCode,MetadataJson) VALUES(@actor,'VISIT_GROUP_MANAGED',@location,@pair,'VISIT_GROUP',CONVERT(varchar(36),@id),'SUCCESS',(SELECT @reason reason,@revision revision,@active active,@name name,JSON_QUERY(@members) members FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
 SET @result=(SELECT @id id,@revision revision FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);EXEC gp._CompleteOperation @op,@result;COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
DECLARE @d nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID('gp.ManageVisitPlanning'));
SET @d=STUFF(@d,1,CHARINDEX(' ',@d)-1,'CREATE');SET @d=REPLACE(@d,'gp.ManageVisitPlanning','gp._ManageVisitPlanning134');EXEC sys.sp_executesql @d;
GO
ALTER PROCEDURE gp.ManageVisitPlanning @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ClientKey uniqueidentifier,@Action varchar(20),@PayloadJson nvarchar(max) AS BEGIN
 SET NOCOUNT ON;
 IF @Action COLLATE Latin1_General_100_BIN2='GROUP' EXEC gp._ManageVisitRoutingGroup @SessionHash,@CsrfHash,@ClientKey,@PayloadJson;
 ELSE EXEC gp._ManageVisitPlanning134 @SessionHash,@CsrfHash,@ClientKey,@Action,@PayloadJson;
END;
GO
DECLARE @d nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID('gp._BuildVisitPlanVersion'));
SET @d=STUFF(@d,1,CHARINDEX(' ',@d)-1,'CREATE');SET @d=REPLACE(@d,'gp._BuildVisitPlanVersion','gp._BuildVisitPlanPrepared134');EXEC sys.sp_executesql @d;
GO
ALTER PROCEDURE gp._BuildVisitPlanVersion @Plan uniqueidentifier,@Version int,@Draft nvarchar(max),@Host uniqueidentifier,@Now datetime2(3),@Cutoff datetime2(3) AS BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 THROW 52000,'Plan transaction required.',1;
 IF @Draft IS NULL OR ISJSON(@Draft)<>1 OR LEFT(LTRIM(@Draft),1)<>'{' OR DATALENGTH(@Draft)>48000 OR EXISTS(SELECT [key] FROM OPENJSON(@Draft) GROUP BY [key] HAVING COUNT(*)>1) OR EXISTS(SELECT 1 FROM OPENJSON(@Draft) WHERE [key]='groups' AND type<>4) THROW 52002,'Invalid invitation group selection.',1;
 DECLARE @groups nvarchar(max)=JSON_QUERY(@Draft,'$.groups'),@base nvarchar(max)=JSON_MODIFY(@Draft,'$.groups',NULL);
 IF @groups IS NOT NULL AND((SELECT COUNT(*) FROM OPENJSON(@groups))>5 OR EXISTS(SELECT 1 FROM OPENJSON(@groups) WHERE type<>5)
  OR EXISTS(SELECT 1 FROM OPENJSON(@groups) g CROSS APPLY OPENJSON(g.value) p WHERE p.[key] NOT IN('id','revision')) OR EXISTS(SELECT g.[key],p.[key] FROM OPENJSON(@groups) g CROSS APPLY OPENJSON(g.value) p GROUP BY g.[key],p.[key] HAVING COUNT(*)>1)
  OR EXISTS(SELECT 1 FROM OPENJSON(@groups) WHERE DATALENGTH(JSON_VALUE(value,'$.id'))<>72 OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.id')) IS NULL OR TRY_CONVERT(int,JSON_VALUE(value,'$.revision')) IS NULL OR TRY_CONVERT(int,JSON_VALUE(value,'$.revision'))<=0)
  OR EXISTS(SELECT TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.id')) FROM OPENJSON(@groups) GROUP BY TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.id')) HAVING COUNT(*)>1)) THROW 52002,'Select at most five distinct current groups.',1;
 EXEC gp._BuildVisitPlanPrepared134 @Plan,@Version,@base,@Host,@Now,@Cutoff;
 IF EXISTS(SELECT 1 FROM OPENJSON(@groups) r LEFT JOIN gp.VisitRoutingGroups g ON g.GroupId=TRY_CONVERT(uniqueidentifier,JSON_VALUE(r.value,'$.id')) WHERE g.GroupId IS NULL OR g.IsActive=0 OR g.Revision<>TRY_CONVERT(int,JSON_VALUE(r.value,'$.revision'))) THROW 52003,'Visit group changed. Refresh and review its members.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@groups) r JOIN gp.VisitRoutingGroups g ON g.GroupId=TRY_CONVERT(uniqueidentifier,JSON_VALUE(r.value,'$.id')) WHERE g.LocationId<>TRY_CONVERT(int,JSON_VALUE(@Draft,'$.locationId')) OR(g.IsVipOnly=1 AND JSON_VALUE(@Draft,'$.vip')<>'true') OR(g.SubProjectId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gp.VisitPlanProjects WHERE PlanId=@Plan AND Version=@Version AND SubProjectId=g.SubProjectId))) THROW 52001,'Group is outside this invitation scope or category.',1;
 INSERT gp.VisitPlanGroups SELECT @Plan,@Version,g.GroupId,g.Revision,g.Name,g.SubProjectId,g.IsVipOnly,g.MembersJson FROM OPENJSON(@groups) r JOIN gp.VisitRoutingGroups g ON g.GroupId=TRY_CONVERT(uniqueidentifier,JSON_VALUE(r.value,'$.id'));
 IF EXISTS(SELECT 1 FROM gp.VisitPlanGroups g CROSS APPLY OPENJSON(g.MembersJson) m WHERE g.PlanId=@Plan AND g.Version=@Version AND JSON_VALUE(m.value,'$.userId') IS NOT NULL AND gp._PlanningInternal(TRY_CONVERT(uniqueidentifier,JSON_VALUE(m.value,'$.userId')),@Now,@Cutoff)=0) THROW 52004,'Group contains an unavailable internal recipient.',1;
 IF EXISTS(SELECT 1 FROM gp.VisitPlanGroups g CROSS APPLY OPENJSON(g.MembersJson) m WHERE g.PlanId=@Plan AND g.Version=@Version AND JSON_VALUE(m.value,'$.kind')='APPROVAL' AND TRY_CONVERT(uniqueidentifier,JSON_VALUE(m.value,'$.userId'))=@Host) THROW 52002,'Host cannot approve their own visit through a group.',1;
 DECLARE @reviewers table(StepId uniqueidentifier,UserId uniqueidentifier,SubProjectId uniqueidentifier NULL);
 INSERT @reviewers SELECT NEWID(),x.UserId,x.SubProjectId FROM(SELECT DISTINCT TRY_CONVERT(uniqueidentifier,JSON_VALUE(m.value,'$.userId')) UserId,g.SubProjectId FROM gp.VisitPlanGroups g CROSS APPLY OPENJSON(g.MembersJson) m WHERE g.PlanId=@Plan AND g.Version=@Version AND JSON_VALUE(m.value,'$.kind')='APPROVAL') x;
 INSERT gp.VisitPlanApprovalSteps SELECT @Plan,@Version,StepId,SubProjectId,N'Group approval','PROJECT','ALL' FROM @reviewers;
 INSERT gp.VisitPlanApprovers SELECT @Plan,@Version,StepId,UserId FROM @reviewers;
 INSERT gp.VisitPlanGroupReviewers SELECT @Plan,@Version,StepId,UserId,SubProjectId FROM @reviewers;
END;
GO
DECLARE @d nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID('gp._PlanPolicyFresh')),@needle nvarchar(100)=N' RETURN 1;';
IF CHARINDEX(@needle,@d)=0 THROW 52000,'Freshness contract required.',1;
SET @d=REPLACE(@d,@needle,N' IF EXISTS(SELECT 1 FROM gp.VisitPlanGroups s JOIN gp.VisitRoutingGroups g ON g.GroupId=s.GroupId WHERE s.PlanId=@Plan AND s.Version=@Version AND(g.IsActive=0 OR g.Revision<>s.Revision)) RETURN 0;'+@needle);
SET @d=STUFF(@d,1,CHARINDEX(' ',@d)-1,'ALTER');EXEC sys.sp_executesql @d;
SET @d=OBJECT_DEFINITION(OBJECT_ID('gp._PlanLiveApprover'));SET @needle=N' IF gp._PlanningInternal(@User,@Now,@Cutoff)=0 RETURN 0;';
IF CHARINDEX(@needle,@d)=0 THROW 52000,'Live authority contract required.',1;
SET @d=REPLACE(@d,@needle,@needle+N'
 IF EXISTS(SELECT 1 FROM gp.VisitPlanGroupReviewers WHERE PlanId=@Plan AND Version=@Version AND StepId=@Step AND UserId=@User) BEGIN
  IF EXISTS(SELECT 1 FROM gp.VisitPlanGroups s JOIN gp.VisitRoutingGroups g ON g.GroupId=s.GroupId CROSS APPLY OPENJSON(g.MembersJson) m WHERE s.PlanId=@Plan AND s.Version=@Version AND g.IsActive=1 AND g.Revision=s.Revision AND JSON_VALUE(m.value,''$.kind'')=''APPROVAL'' AND TRY_CONVERT(uniqueidentifier,JSON_VALUE(m.value,''$.userId''))=@User AND EXISTS(SELECT 1 FROM gp.VisitPlanGroupReviewers r WHERE r.PlanId=@Plan AND r.Version=@Version AND r.StepId=@Step AND ISNULL(r.SubProjectId,''00000000-0000-0000-0000-000000000000'')=ISNULL(s.SubProjectId,''00000000-0000-0000-0000-000000000000''))) RETURN 1;
  RETURN 0;
 END;');SET @d=STUFF(@d,1,CHARINDEX(' ',@d)-1,'ALTER');EXEC sys.sp_executesql @d;
INSERT gp.SchemaMigrations(Version,Description) VALUES('135',N'Scoped configurable visit approval and notification groups with versioned membership and additive internal approvals');
COMMIT;
