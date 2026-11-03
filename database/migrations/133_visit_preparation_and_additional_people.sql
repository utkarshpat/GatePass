/* Planning-only preparation and additive approvals. Existing pass/gate flows are unchanged. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='132') OR EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='133') THROW 52000,'Migration 132 required; 133 must be new.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
CREATE TABLE gp.VisitPlanPreparation(PlanId uniqueidentifier NOT NULL,Version int NOT NULL,DefinitionJson nvarchar(max) NOT NULL,
 CONSTRAINT PK_VisitPlanPreparation PRIMARY KEY(PlanId,Version),CONSTRAINT FK_VisitPlanPreparation_Version FOREIGN KEY(PlanId,Version) REFERENCES gp.VisitPlanVersions(PlanId,Version),CONSTRAINT CK_VisitPlanPreparation_Json CHECK(ISJSON(DefinitionJson)=1));
CREATE TABLE gp.VisitPlanExtraPeople(PlanId uniqueidentifier NOT NULL,Version int NOT NULL,ExtraId uniqueidentifier NOT NULL,UserId uniqueidentifier NOT NULL REFERENCES gp.Users(UserId),SubProjectId uniqueidentifier NULL,Kind varchar(8) COLLATE Latin1_General_100_BIN2 NOT NULL,StepId uniqueidentifier NULL,IsAutomatic bit NOT NULL,
 CONSTRAINT PK_VisitPlanExtraPeople PRIMARY KEY(PlanId,Version,ExtraId),CONSTRAINT FK_VisitPlanExtraPeople_Version FOREIGN KEY(PlanId,Version) REFERENCES gp.VisitPlanVersions(PlanId,Version),
 CONSTRAINT FK_VisitPlanExtraPeople_Project FOREIGN KEY(PlanId,Version,SubProjectId) REFERENCES gp.VisitPlanProjects(PlanId,Version,SubProjectId),CONSTRAINT FK_VisitPlanExtraPeople_Step FOREIGN KEY(PlanId,Version,StepId) REFERENCES gp.VisitPlanApprovalSteps(PlanId,Version,StepId),
 CONSTRAINT CK_VisitPlanExtraPeople_Kind CHECK((Kind='APPROVAL' AND StepId IS NOT NULL) OR(Kind='NOTIFY' AND StepId IS NULL)));
CREATE UNIQUE INDEX UX_VisitPlanExtraPeople_Person ON gp.VisitPlanExtraPeople(PlanId,Version,UserId,SubProjectId);
CREATE INDEX IX_VisitPlanExtraPeople_User ON gp.VisitPlanExtraPeople(UserId,PlanId,Version);
CREATE TABLE gp.VisitPlanServiceTasks(PlanId uniqueidentifier NOT NULL,Version int NOT NULL,TaskId uniqueidentifier NOT NULL,ServiceCode varchar(20) NOT NULL,
 CONSTRAINT PK_VisitPlanServiceTasks PRIMARY KEY(PlanId,Version,TaskId),CONSTRAINT FK_VisitPlanServiceTasks_Task FOREIGN KEY(PlanId,Version,TaskId) REFERENCES gp.VisitPlanTasks(PlanId,Version,TaskId),
 CONSTRAINT CK_VisitPlanServiceTasks_Code CHECK(ServiceCode IN('MEETING_ROOM','AV_SUPPORT','HOSPITALITY','PARKING','TRANSPORT','TRAVEL','ACCESSIBILITY')));
GO
/* Preserve the reviewed mandatory policy builder. The wrapper cannot remove any of its checks. */
DECLARE @base nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID('gp._BuildVisitPlanVersion'));
IF @base IS NULL OR CHARINDEX('CREATE PROCEDURE gp._BuildVisitPlanVersion ',@base)=0 THROW 52000,'Reviewed version builder required.',1;
SET @base=REPLACE(@base,'CREATE PROCEDURE gp._BuildVisitPlanVersion ','CREATE PROCEDURE gp._BuildVisitPlanBase132 ');EXEC sys.sp_executesql @base;
GO
ALTER PROCEDURE gp._BuildVisitPlanVersion @Plan uniqueidentifier,@Version int,@Draft nvarchar(max),@Host uniqueidentifier,@Now datetime2(3),@Cutoff datetime2(3) AS BEGIN
 SET NOCOUNT ON;
 IF @@TRANCOUNT=0 THROW 52000,'Plan transaction required.',1;
 IF @Draft IS NULL OR ISJSON(@Draft)<>1 OR LEFT(LTRIM(@Draft),1)<>'{' OR DATALENGTH(@Draft)>48000
  OR EXISTS(SELECT 1 FROM OPENJSON(@Draft) WHERE [key] NOT IN('locationId','subProjectIds','visitorName','visitorEmail','company','purpose','startsAtUtc','untilUtc','vip','stay','preparation','additionalPeople'))
  OR EXISTS(SELECT [key] FROM OPENJSON(@Draft) GROUP BY [key] HAVING COUNT(*)>1)
  OR EXISTS(SELECT 1 FROM OPENJSON(@Draft) WHERE([key]='preparation' AND type<>5) OR([key]='additionalPeople' AND type<>4)) THROW 52002,'Invalid invitation fields.',1;
 DECLARE @prep nvarchar(max)=JSON_QUERY(@Draft,'$.preparation'),@extra nvarchar(max)=JSON_QUERY(@Draft,'$.additionalPeople'),@coordinator uniqueidentifier;
 IF @prep IS NOT NULL BEGIN
  IF DATALENGTH(@prep)>16000 OR EXISTS(SELECT 1 FROM OPENJSON(@prep) WHERE [key] NOT IN('category','visitType','meetingLocation','agenda','requirements','services','devices','specialAccess','coordinatorId','visitOwnerId','alternateReceiverId'))
   OR EXISTS(SELECT [key] FROM OPENJSON(@prep) GROUP BY [key] HAVING COUNT(*)>1)
   OR JSON_VALUE(@prep,'$.category') COLLATE Latin1_General_100_BIN2 NOT IN('GENERAL','CLIENT','VENDOR','CANDIDATE','CONTRACTOR','SUPPORT_STAFF','REGULATOR','INTERNAL') OR JSON_VALUE(@prep,'$.category') IS NULL
   OR JSON_VALUE(@prep,'$.visitType') COLLATE Latin1_General_100_BIN2 NOT IN('MEETING','INTERVIEW','SERVICE','SITE_TOUR','LEADERSHIP') OR JSON_VALUE(@prep,'$.visitType') IS NULL
   OR(SELECT COUNT(*) FROM OPENJSON(@prep) WHERE [key] IN('services','devices','specialAccess') AND type=4)<>3
   OR EXISTS(SELECT 1 FROM OPENJSON(@prep) WHERE [key] IN('meetingLocation','agenda','requirements') AND(type<>1 OR LEN(LTRIM(RTRIM(value)))=0 OR DATALENGTH(value)>CASE [key] WHEN 'meetingLocation' THEN 400 WHEN 'agenda' THEN 4000 ELSE 2000 END)) THROW 52002,'Invalid preparation fields.',1;
  IF EXISTS(SELECT 1 FROM OPENJSON(@prep,'$.services') WHERE type<>1 OR value COLLATE Latin1_General_100_BIN2 NOT IN('MEETING_ROOM','AV_SUPPORT','HOSPITALITY','PARKING','TRANSPORT','TRAVEL','ACCESSIBILITY'))
   OR EXISTS(SELECT 1 FROM OPENJSON(@prep,'$.devices') WHERE type<>1 OR value COLLATE Latin1_General_100_BIN2 NOT IN('LAPTOP','TABLET','CAMERA','PEN_DRIVE','OTHER'))
   OR EXISTS(SELECT 1 FROM OPENJSON(@prep,'$.specialAccess') WHERE type<>1 OR value COLLATE Latin1_General_100_BIN2 NOT IN('NETWORK','RECORDING','AFTER_HOURS','RESTRICTED_AREA','DATA_CENTRE'))
   OR EXISTS(SELECT p.[key],x.value FROM OPENJSON(@prep) p CROSS APPLY OPENJSON(CASE WHEN p.[key] IN('services','devices','specialAccess') THEN p.value ELSE N'[]' END) x GROUP BY p.[key],x.value HAVING COUNT(*)>1)
   OR EXISTS(SELECT 1 FROM OPENJSON(@prep) WHERE [key] IN('coordinatorId','visitOwnerId','alternateReceiverId') AND(type<>1 OR DATALENGTH(value)<>72 OR TRY_CONVERT(uniqueidentifier,value) IS NULL OR gp._PlanningInternal(TRY_CONVERT(uniqueidentifier,value),@Now,@Cutoff)=0)) THROW 52002,'Invalid preparation options or contacts.',1;
  SET @coordinator=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@prep,'$.coordinatorId'));
  IF EXISTS(SELECT 1 FROM OPENJSON(@prep,'$.services')) AND @coordinator IS NULL THROW 52002,'Assign an internal coordinator for requested services.',1;
 END;
 IF @extra IS NOT NULL AND((SELECT COUNT(*) FROM OPENJSON(@extra))>20 OR EXISTS(SELECT 1 FROM OPENJSON(@extra) WHERE type<>5)
  OR EXISTS(SELECT 1 FROM OPENJSON(@extra) x CROSS APPLY OPENJSON(x.value) p WHERE p.[key] NOT IN('userId','kind','subProjectId'))
  OR EXISTS(SELECT x.[key],p.[key] FROM OPENJSON(@extra) x CROSS APPLY OPENJSON(x.value) p GROUP BY x.[key],p.[key] HAVING COUNT(*)>1)
  OR EXISTS(SELECT 1 FROM OPENJSON(@extra) x WHERE JSON_VALUE(x.value,'$.kind') IS NULL OR JSON_VALUE(x.value,'$.kind') COLLATE Latin1_General_100_BIN2 NOT IN('APPROVAL','NOTIFY') OR DATALENGTH(JSON_VALUE(x.value,'$.userId'))<>72 OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(x.value,'$.userId')) IS NULL
   OR TRY_CONVERT(uniqueidentifier,JSON_VALUE(x.value,'$.userId'))=@Host OR gp._PlanningInternal(TRY_CONVERT(uniqueidentifier,JSON_VALUE(x.value,'$.userId')),@Now,@Cutoff)=0)
  OR EXISTS(SELECT 1 FROM OPENJSON(@extra) x CROSS APPLY OPENJSON(x.value) p WHERE(p.[key] IN('userId','kind') AND p.type<>1) OR(p.[key]='subProjectId' AND(p.type<>1 OR DATALENGTH(p.value)<>72 OR TRY_CONVERT(uniqueidentifier,p.value) IS NULL OR NOT EXISTS(SELECT 1 FROM OPENJSON(@Draft,'$.subProjectIds') s WHERE TRY_CONVERT(uniqueidentifier,s.value)=TRY_CONVERT(uniqueidentifier,p.value)))))
  OR EXISTS(SELECT TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.userId')),TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.subProjectId')) FROM OPENJSON(@extra) GROUP BY TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.userId')),TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.subProjectId')) HAVING COUNT(*)>1)) THROW 52002,'Invalid additional people; required approvals cannot be replaced.',1;
 DECLARE @base nvarchar(max)=JSON_MODIFY(JSON_MODIFY(@Draft,'$.preparation',NULL),'$.additionalPeople',NULL);
 EXEC gp._BuildVisitPlanBase132 @Plan,@Version,@base,@Host,@Now,@Cutoff;
 IF @prep IS NOT NULL INSERT gp.VisitPlanPreparation VALUES(@Plan,@Version,@prep);
 DECLARE @people table(ExtraId uniqueidentifier,UserId uniqueidentifier,SubProjectId uniqueidentifier NULL,Kind varchar(8),StepId uniqueidentifier NULL);
 INSERT @people SELECT NEWID(),CONVERT(uniqueidentifier,JSON_VALUE(value,'$.userId')),TRY_CONVERT(uniqueidentifier,JSON_VALUE(value,'$.subProjectId')),JSON_VALUE(value,'$.kind'),CASE WHEN JSON_VALUE(value,'$.kind')='APPROVAL' THEN NEWID() END FROM OPENJSON(@extra);
 INSERT gp.VisitPlanApprovalSteps SELECT @Plan,@Version,StepId,SubProjectId,N'Additional approval','PROJECT','ALL' FROM @people WHERE Kind='APPROVAL';
 INSERT gp.VisitPlanApprovers SELECT @Plan,@Version,StepId,UserId FROM @people WHERE Kind='APPROVAL';
 INSERT gp.VisitPlanExtraPeople SELECT @Plan,@Version,ExtraId,UserId,SubProjectId,Kind,StepId,0 FROM @people;
 INSERT gp.VisitPlanExtraPeople SELECT @Plan,@Version,NEWID(),TRY_CONVERT(uniqueidentifier,p.value),NULL,'NOTIFY',NULL,1 FROM OPENJSON(@prep) p
  WHERE p.[key] IN('visitOwnerId','alternateReceiverId') AND TRY_CONVERT(uniqueidentifier,p.value)<>@Host
  AND NOT EXISTS(SELECT 1 FROM gp.VisitPlanExtraPeople e WHERE e.PlanId=@Plan AND e.Version=@Version AND e.UserId=TRY_CONVERT(uniqueidentifier,p.value) AND e.SubProjectId IS NULL)
  GROUP BY TRY_CONVERT(uniqueidentifier,p.value);
 DECLARE @services table(TaskId uniqueidentifier,Code varchar(20),Name nvarchar(120));
 INSERT @services SELECT NEWID(),value,CASE value WHEN 'MEETING_ROOM' THEN N'Meeting room' WHEN 'AV_SUPPORT' THEN N'AV / video conference support' WHEN 'HOSPITALITY' THEN N'Hospitality / refreshments' WHEN 'PARKING' THEN N'Parking' WHEN 'TRANSPORT' THEN N'Ground transport / transfers' WHEN 'TRAVEL' THEN N'Travel arrangements' ELSE N'Accessibility assistance' END FROM OPENJSON(@prep,'$.services');
 INSERT gp.VisitPlanTasks SELECT @Plan,@Version,TaskId,Name,'OTHER',1,'REQUESTED',N'' FROM @services;
 INSERT gp.VisitPlanTaskOwners SELECT @Plan,@Version,TaskId,@coordinator FROM @services;
 INSERT gp.VisitPlanServiceTasks SELECT @Plan,@Version,TaskId,Code FROM @services;
END;
GO
/* Additional decision/task membership is version-bound and never substitutes a configured policy rule. */
DECLARE @definition nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID('gp._PlanLiveApprover')),@needle nvarchar(200)=N' IF gp._PlanningInternal(@User,@Now,@Cutoff)=0 RETURN 0;';
IF CHARINDEX(@needle,@definition)=0 THROW 52000,'Live approver contract required.',1;
SET @definition=REPLACE(@definition,@needle,@needle+N'
 IF EXISTS(SELECT 1 FROM gp.VisitPlanExtraPeople e JOIN gp.VisitPlanApprovers a ON a.PlanId=e.PlanId AND a.Version=e.Version AND a.StepId=e.StepId AND a.UserId=e.UserId WHERE e.PlanId=@Plan AND e.Version=@Version AND e.StepId=@Step AND e.UserId=@User AND e.Kind=''APPROVAL'') RETURN 1;');
SET @definition=STUFF(@definition,1,CHARINDEX(' ',@definition)-1,'ALTER');EXEC sys.sp_executesql @definition;
SET @definition=OBJECT_DEFINITION(OBJECT_ID('gp._PlanLiveTaskOwner'));
IF CHARINDEX(@needle,@definition)=0 THROW 52000,'Live task contract required.',1;
SET @definition=REPLACE(@definition,@needle,@needle+N'
 IF EXISTS(SELECT 1 FROM gp.VisitPlanServiceTasks s JOIN gp.VisitPlanTaskOwners o ON o.PlanId=s.PlanId AND o.Version=s.Version AND o.TaskId=s.TaskId WHERE s.PlanId=@Plan AND s.Version=@Version AND s.TaskId=@Task AND o.UserId=@User) RETURN 1;');
SET @definition=STUFF(@definition,1,CHARINDEX(' ',@definition)-1,'ALTER');EXEC sys.sp_executesql @definition;
GO
DECLARE @definition nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID('gp.ChangePlannedVisit')),@needle nvarchar(200)=N' END ELSE IF @kind IN(''CANCEL'',''REVISE'') BEGIN';
IF CHARINDEX(@needle,@definition)=0 THROW 52000,'Planning notice contract required.',1;
SET @definition=REPLACE(@definition,@needle,N'  INSERT @notices SELECT DISTINCT e.UserId,''FYI'',NULL FROM gp.VisitPlanExtraPeople e WHERE e.PlanId=@PlanId AND e.Version=@version AND e.Kind=''NOTIFY'' AND NOT EXISTS(SELECT 1 FROM @notices n WHERE n.UserId=e.UserId AND n.Kind=''FYI'');
'+@needle);
SET @definition=REPLACE(@definition,'DATALENGTH(@CommandJson)>20000','DATALENGTH(@CommandJson)>52000');
SET @definition=STUFF(@definition,1,CHARINDEX(' ',@definition)-1,'ALTER');EXEC sys.sp_executesql @definition;
SET @definition=OBJECT_DEFINITION(OBJECT_ID('gp.CreatePlannedVisit'));SET @definition=REPLACE(@definition,'DATALENGTH(@DraftJson)>16000','DATALENGTH(@DraftJson)>48000');
SET @definition=STUFF(@definition,1,CHARINDEX(' ',@definition)-1,'ALTER');EXEC sys.sp_executesql @definition;
SET @definition=OBJECT_DEFINITION(OBJECT_ID('gp._PlanningMailAudience'));SET @needle=N' /* FYI is current-policy information, never membership or approval authority. */';
IF CHARINDEX(@needle,@definition)=0 THROW 52000,'Scoped mail audience contract required.',1;
SET @definition=REPLACE(@definition,@needle,N' IF @kind IN(''FYI'',''UPDATE'',''CANCELLED'') AND EXISTS(SELECT 1 FROM gp.VisitPlanExtraPeople WHERE PlanId=@Plan AND Version=@source AND UserId=@user AND Kind=''NOTIFY'') RETURN ''FYI'';
'+@needle);
SET @definition=STUFF(@definition,1,CHARINDEX(' ',@definition)-1,'ALTER');EXEC sys.sp_executesql @definition;
INSERT gp.SchemaMigrations(Version,Description) VALUES('133',N'Planning preparation, named coordination, additional approvals and FYI without changing existing gate/card flows');
COMMIT;
