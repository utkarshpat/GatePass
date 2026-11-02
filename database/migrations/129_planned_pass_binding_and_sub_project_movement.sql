/* Reception-assisted planned pass binding. Exact destination movements never use
   the legacy account-wide movement path. Public invitation redemption is separate. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='128') THROW 52000,'Migration 128 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='129') THROW 52000,'Migration 129 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
CREATE TABLE gp.PlannedPassBindings(
 VisitRequestId uniqueidentifier NOT NULL PRIMARY KEY REFERENCES gp.VisitRequests(VisitRequestId),
 PlanId uniqueidentifier NOT NULL,Version int NOT NULL,LocationId int NOT NULL,
 BoundByUserId uniqueidentifier NOT NULL REFERENCES gp.Users(UserId),BoundAtUtc datetime2(3) NOT NULL,
 CONSTRAINT UQ_PlannedPass_Plan UNIQUE(PlanId,Version),
 CONSTRAINT FK_PlannedPass_VisitOffice FOREIGN KEY(VisitRequestId,LocationId) REFERENCES gp.VisitRequests(VisitRequestId,LocationId),
 CONSTRAINT FK_PlannedPass_Version FOREIGN KEY(PlanId,Version,LocationId) REFERENCES gp.VisitPlanVersions(PlanId,Version,LocationId));
CREATE TABLE gp.SubProjectVisitPresence(
 VisitRequestId uniqueidentifier NOT NULL REFERENCES gp.PlannedPassBindings(VisitRequestId),
 SubProjectId uniqueidentifier NOT NULL REFERENCES gp.SubProjects(SubProjectId),IsInside bit NOT NULL DEFAULT(0),
 CONSTRAINT PK_SubProjectVisitPresence PRIMARY KEY(VisitRequestId,SubProjectId));
CREATE TABLE gp.PlannedAccessEventDestinations(
 AccessEventId bigint NOT NULL PRIMARY KEY,VisitRequestId uniqueidentifier NOT NULL,SubProjectId uniqueidentifier NOT NULL,
 CONSTRAINT FK_PlannedAccess_Event FOREIGN KEY(AccessEventId,VisitRequestId) REFERENCES gp.AccessEvents(AccessEventId,VisitRequestId),
 CONSTRAINT FK_PlannedAccess_Presence FOREIGN KEY(VisitRequestId,SubProjectId) REFERENCES gp.SubProjectVisitPresence(VisitRequestId,SubProjectId));
GO
CREATE FUNCTION gp._PlannedDestinationReady(@Visit uniqueidentifier,@Sub uniqueidentifier,@Now datetime2(3),@Cutoff datetime2(3)) RETURNS bit WITH INLINE=OFF AS BEGIN
 IF EXISTS(SELECT 1 FROM gp.PlannedPassBindings b JOIN gp.VisitPlanVersions v ON v.PlanId=b.PlanId AND v.Version=b.Version AND v.IsCurrent=1
 JOIN gp.VisitPlanProjects p ON p.PlanId=b.PlanId AND p.Version=b.Version AND p.SubProjectId=@Sub
 WHERE b.VisitRequestId=@Visit AND @Now>=v.StartsAtUtc AND @Now<v.UntilUtc AND gp._PlanReadiness(b.PlanId,b.Version,@Sub,@Now,@Cutoff)='READY') RETURN 1;
 RETURN 0;
END;
GO
CREATE PROCEDURE gp.PlannedAccess @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@Mode varchar(10),@PayloadJson nvarchar(max) AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF @Mode IS NULL OR DATALENGTH(@Mode)<>LEN(@Mode) OR @Mode COLLATE Latin1_General_100_BIN2 NOT IN('OPTIONS','LINK','DUTIES','QUEUE','DETAIL','MOVE') OR ISJSON(@PayloadJson)<>1 OR LEFT(LTRIM(@PayloadJson),1)<>'{' OR DATALENGTH(@PayloadJson)>6000 THROW 52002,'Invalid planned access.',1;
 DECLARE @allowed varchar(200)=CASE @Mode WHEN 'OPTIONS' THEN 'visitRequestId' WHEN 'LINK' THEN 'visitRequestId,planId,version,clientKey,reason' WHEN 'DUTIES' THEN '' WHEN 'QUEUE' THEN 'subProjectId,queue,search,offset' WHEN 'DETAIL' THEN 'subProjectId,visitRequestId,credentialHash' WHEN 'MOVE' THEN 'subProjectId,visitRequestId,accessPassId,eventType,clientKey,credentialHash' END;
 IF EXISTS(SELECT [key] FROM OPENJSON(@PayloadJson) GROUP BY [key] HAVING COUNT(*)>1) OR EXISTS(SELECT 1 FROM OPENJSON(@PayloadJson) j WHERE NOT EXISTS(SELECT 1 FROM STRING_SPLIT(@allowed,',') a WHERE a.value COLLATE Latin1_General_100_BIN2=j.[key] COLLATE Latin1_General_100_BIN2)) THROW 52002,'Invalid planned fields.',1;
 IF EXISTS(SELECT 1 FROM OPENJSON(@PayloadJson) WHERE [key] IN('visitRequestId','planId','subProjectId','accessPassId','clientKey') AND(type<>1 OR DATALENGTH(value)<>72 OR TRY_CONVERT(uniqueidentifier,value) IS NULL)) THROW 52002,'Invalid resource.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@location int,@pair bigint,@sub uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@PayloadJson,'$.subProjectId')),
 @visit uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@PayloadJson,'$.visitRequestId')),@plan uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@PayloadJson,'$.planId')),
 @version int=TRY_CONVERT(int,JSON_VALUE(@PayloadJson,'$.version')),@key uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@PayloadJson,'$.clientKey')),
 @pass uniqueidentifier=TRY_CONVERT(uniqueidentifier,JSON_VALUE(@PayloadJson,'$.accessPassId')),@hash varbinary(32),@op uniqueidentifier,@cached nvarchar(max),@result nvarchar(max),@lock nvarchar(255),@reason nvarchar(max)=JSON_VALUE(@PayloadJson,'$.reason');
 DECLARE @hashText nvarchar(max)=JSON_VALUE(@PayloadJson,'$.credentialHash');
 IF EXISTS(SELECT 1 FROM OPENJSON(@PayloadJson) WHERE [key]='credentialHash' AND(type<>1 OR DATALENGTH(value)<>128 OR TRY_CONVERT(varbinary(32),value,2) IS NULL)) THROW 52002,'Invalid credential.',1;
 SET @hash=TRY_CONVERT(varbinary(32),@hashText,2);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF @Mode IN('OPTIONS','LINK') BEGIN
  IF @visit IS NULL THROW 52002,'Visit required.',1;
  SELECT @location=LocationId FROM gp.VisitRequests WHERE VisitRequestId=@visit AND PersonalDataPurgedAtUtc IS NULL;
  IF @location IS NULL OR gp._OperationsScopeAllowed(@actor,'RECEPTION',@location,'OFFICE',0,@now)=0 THROW 52001,'Reception office scope required.',1;
  IF @Mode='OPTIONS' BEGIN
   SET @result=(SELECT JSON_QUERY(COALESCE((SELECT TOP(50) p.PlanId id,v.Version version,v.VisitorName visitorName,REPLACE(CONVERT(char(23),v.StartsAtUtc,121),' ','T')+'Z' startsAtUtc,REPLACE(CONVERT(char(23),v.UntilUtc,121),' ','T')+'Z' untilUtc,
    JSON_QUERY((SELECT s.Name name,pr.ProjectName accountName,gp._PlanReadiness(p.PlanId,v.Version,s.SubProjectId,@now,@cutoff) readiness FROM gp.VisitPlanProjects d JOIN gp.SubProjects s ON s.SubProjectId=d.SubProjectId JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=s.AccountOfficeId JOIN gp.Projects pr ON pr.ProjectId=pl.ProjectId WHERE d.PlanId=p.PlanId AND d.Version=v.Version FOR JSON PATH)) destinations
    FROM gp.VisitPlans p JOIN gp.VisitPlanVersions v ON v.PlanId=p.PlanId AND v.IsCurrent=1 JOIN gp.Employees h ON h.UserId=p.HostUserId JOIN gp.VisitRequests r ON r.VisitRequestId=@visit
    WHERE p.LocationId=@location AND p.State='SUBMITTED' AND v.UntilUtc>@now AND v.VisitorName=r.PersonName AND (v.VisitorEmail IS NULL OR v.VisitorEmail=r.PersonEmail)
    AND h.EmployeeId=r.HostEmployeeId AND r.RequestType='EXTERNAL' AND NOT EXISTS(SELECT 1 FROM gp.PlannedPassBindings b WHERE b.PlanId=p.PlanId AND b.Version=v.Version)
    ORDER BY v.StartsAtUtc,p.PlanId FOR JSON PATH),N'[]')) candidates,
    JSON_QUERY((SELECT b.PlanId planId,b.Version version FROM gp.PlannedPassBindings b WHERE b.VisitRequestId=@visit FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) binding,
    JSON_QUERY(COALESCE((SELECT s.Name projectName,pr.ProjectName accountName,e.EventType eventType,REPLACE(CONVERT(char(23),e.OccurredAtUtc,121),' ','T')+'Z' occurredAtUtc,u.DisplayName guardName FROM gp.PlannedAccessEventDestinations d JOIN gp.AccessEvents e ON e.AccessEventId=d.AccessEventId JOIN gp.SubProjects s ON s.SubProjectId=d.SubProjectId JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=s.AccountOfficeId JOIN gp.Projects pr ON pr.ProjectId=pl.ProjectId JOIN gp.Users u ON u.UserId=e.ActorUserId WHERE d.VisitRequestId=@visit ORDER BY e.AccessEventId DESC OFFSET 0 ROWS FETCH NEXT 100 ROWS ONLY FOR JSON PATH),N'[]')) movements FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  END ELSE BEGIN
   IF @plan IS NULL OR @key IS NULL OR @version IS NULL OR @version<1 OR @reason IS NULL OR LEN(LTRIM(RTRIM(@reason)))=0 OR LEN(@reason)>300 OR EXISTS(SELECT 1 FROM OPENJSON(@PayloadJson) WHERE [key]='version' AND type<>2) THROW 52002,'Binding and reason required.',1;
   SET @lock=N'gp:visit-plan:'+CONVERT(nvarchar(36),@plan);EXEC gp._TakeLock @lock;
   SET @lock=N'gp:visit:'+LOWER(CONVERT(char(36),@visit));EXEC gp._TakeLock @lock;
   EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
   IF gp._OperationsScopeAllowed(@actor,'RECEPTION',@location,'OFFICE',0,@now)=0 THROW 52001,'Reception scope changed.',1;
   IF NOT EXISTS(SELECT 1 FROM gp.VisitPlans p JOIN gp.VisitPlanVersions v ON v.PlanId=p.PlanId AND v.Version=@version AND v.IsCurrent=1 JOIN gp.VisitRequests r ON r.VisitRequestId=@visit JOIN gp.Employees h ON h.UserId=p.HostUserId
    WHERE p.PlanId=@plan AND p.LocationId=@location AND r.LocationId=@location AND p.State='SUBMITTED' AND v.UntilUtc>@now AND v.VisitorName=r.PersonName AND(v.VisitorEmail IS NULL OR v.VisitorEmail=r.PersonEmail) AND h.EmployeeId=r.HostEmployeeId AND r.RequestType='EXTERNAL' AND r.Status IN('PENDING','APPROVED') AND r.PersonalDataPurgedAtUtc IS NULL AND r.ValidUntilUtc>@now
    AND r.ValidFromUtc<v.UntilUtc AND r.ValidUntilUtc>v.StartsAtUtc AND EXISTS(SELECT 1 FROM gp.PhotoAssets a WHERE a.PhotoAssetId=r.PhotoAssetId AND a.PurgedAtUtc IS NULL AND a.StorageKey IS NOT NULL AND a.ContentHash IS NOT NULL)) THROW 52003,'Current matching registration and invitation required.',1;
   IF NOT EXISTS(SELECT 1 FROM gp.VisitPlanProjects WHERE PlanId=@plan AND Version=@version AND gp._PlanReadiness(@plan,@version,SubProjectId,@now,@cutoff)='READY') THROW 52003,'At least one independently cleared destination required.',1;
   EXEC gp._BeginOperation @actor,'PLAN_PASS_BIND',@key,@PayloadJson,@op OUTPUT,@cached OUTPUT;
   IF @cached IS NOT NULL BEGIN COMMIT;SELECT @cached;RETURN;END;
   IF EXISTS(SELECT 1 FROM gp.PlannedPassBindings WHERE VisitRequestId=@visit OR(PlanId=@plan AND Version=@version)) OR EXISTS(SELECT 1 FROM gp.VisitPresence WHERE VisitRequestId=@visit AND IsInside=1) OR EXISTS(SELECT 1 FROM gp.PassReturns WHERE VisitRequestId=@visit) OR NOT EXISTS(SELECT 1 FROM gp.AccessPasses WHERE VisitRequestId=@visit AND IsCurrent=1 AND Status IN('PENDING','ACTIVE')) THROW 52003,'Pass already linked, closed or occupied.',1;
   INSERT gp.PlannedPassBindings VALUES(@visit,@plan,@version,@location,@actor,@now);
   UPDATE gp.VisitRequests SET Status='APPROVED',DecisionAtUtc=@now WHERE VisitRequestId=@visit;
   UPDATE gp.AccessPasses SET Status='ACTIVE' WHERE VisitRequestId=@visit AND IsCurrent=1;
   SET @result=(SELECT @visit visitRequestId,@plan planId,@version version FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
   INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ResultCode,MetadataJson) VALUES(@actor,'PLANNED_PASS_BOUND','VISIT',CONVERT(varchar(36),@visit),@location,'SUCCESS',(SELECT @plan planId,@version version,@reason reason FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
   EXEC gp._CompleteOperation @op,@result;
  END;
 END ELSE IF @Mode='DUTIES' BEGIN
  SET @result=(SELECT JSON_QUERY(COALESCE((SELECT s.SubProjectId subProjectId,s.Name projectName,pr.ProjectName accountName,l.LocationName locationName,s.LocationId locationId FROM gp.SubProjects s JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=s.AccountOfficeId JOIN gp.Projects pr ON pr.ProjectId=pl.ProjectId JOIN gp.Locations l ON l.LocationId=s.LocationId
   WHERE gp._GuardDutyAssigned(@actor,'PROJECT',s.AccountOfficeId,s.LocationId,@now)=1 AND((s.IsActive=1 AND pl.IsActive=1 AND pr.IsActive=1 AND l.IsActive=1) OR EXISTS(SELECT 1 FROM gp.SubProjectVisitPresence q WHERE q.SubProjectId=s.SubProjectId AND q.IsInside=1)) ORDER BY l.LocationName,pr.ProjectName,s.Name,s.SubProjectId FOR JSON PATH),N'[]')) duties FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 END ELSE BEGIN
  SELECT @location=LocationId,@pair=AccountOfficeId FROM gp.SubProjects WHERE SubProjectId=@sub;
  IF @sub IS NULL OR @location IS NULL OR gp._GuardDutyAssigned(@actor,'PROJECT',@pair,@location,@now)=0 THROW 52001,'Current destination duty required.',1;
  IF @Mode='QUEUE' BEGIN
   DECLARE @search nvarchar(max)=JSON_VALUE(@PayloadJson,'$.search'),@queue varchar(20)=JSON_VALUE(@PayloadJson,'$.queue'),@offset int=TRY_CONVERT(int,JSON_VALUE(@PayloadJson,'$.offset'));
   IF @queue IS NULL OR @queue COLLATE Latin1_General_100_BIN2 NOT IN('EXPECTED','INSIDE') OR @search IS NULL OR LEN(@search)>100 OR @offset IS NULL OR @offset NOT BETWEEN 0 AND 100000 OR EXISTS(SELECT 1 FROM OPENJSON(@PayloadJson) WHERE [key]='offset' AND type<>2) THROW 52002,'Invalid queue.',1;
   SET @result=(SELECT JSON_QUERY(COALESCE((SELECT r.VisitRequestId visitRequestId,r.PersonName personName,p.PublicPassNumber publicPassNumber,
    gp._PlanReadiness(b.PlanId,b.Version,@sub,@now,@cutoff) readiness,CONVERT(bit,COALESCE(q.IsInside,0)) isInside
    FROM gp.PlannedPassBindings b JOIN gp.VisitPlanProjects d ON d.PlanId=b.PlanId AND d.Version=b.Version AND d.SubProjectId=@sub JOIN gp.VisitRequests r ON r.VisitRequestId=b.VisitRequestId AND r.PersonalDataPurgedAtUtc IS NULL JOIN gp.AccessPasses p ON p.VisitRequestId=r.VisitRequestId AND p.IsCurrent=1
    LEFT JOIN gp.SubProjectVisitPresence q ON q.VisitRequestId=r.VisitRequestId AND q.SubProjectId=@sub
    WHERE((@queue='INSIDE' AND q.IsInside=1) OR(@queue='EXPECTED' AND COALESCE(q.IsInside,0)=0 AND r.ValidUntilUtc>@now AND r.Status='APPROVED' AND p.Status='ACTIVE' AND EXISTS(SELECT 1 FROM gp.VisitPlanVersions v WHERE v.PlanId=b.PlanId AND v.Version=b.Version AND v.IsCurrent=1) AND NOT EXISTS(SELECT 1 FROM gp.PassReturns WHERE VisitRequestId=r.VisitRequestId)))
    AND(@search='' OR CHARINDEX(@search,r.PersonName)>0 OR CHARINDEX(@search,p.PublicPassNumber)>0 OR CHARINDEX(@search,r.PublicReference)>0)
    ORDER BY r.SubmittedAtUtc DESC,r.VisitRequestId OFFSET @offset ROWS FETCH NEXT 51 ROWS ONLY FOR JSON PATH),N'[]')) visits FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  END ELSE BEGIN
   IF @Mode='DETAIL' AND @hash IS NOT NULL BEGIN
    IF @visit IS NOT NULL THROW 52002,'Select one lookup method.',1;
    SELECT @visit=VisitRequestId FROM gp.AccessPasses WHERE CredentialHash=@hash AND IsCurrent=1;
   END;
   IF @visit IS NULL THROW 52001,'Matching planned pass required.',1;
   SELECT @plan=PlanId FROM gp.PlannedPassBindings WHERE VisitRequestId=@visit;
   IF @plan IS NULL THROW 52001,'Matching invitation required.',1;
   SET @lock=N'gp:visit-plan:'+CONVERT(nvarchar(36),@plan);EXEC gp._TakeLock @lock;
   SET @lock=N'gp:visit:'+LOWER(CONVERT(char(36),@visit));EXEC gp._TakeLock @lock;
   EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
   IF gp._GuardDutyAssigned(@actor,'PROJECT',@pair,@location,@now)=0 OR NOT EXISTS(SELECT 1 FROM gp.PlannedPassBindings b JOIN gp.VisitPlanProjects p ON p.PlanId=b.PlanId AND p.Version=b.Version AND p.SubProjectId=@sub JOIN gp.VisitRequests r ON r.VisitRequestId=b.VisitRequestId AND r.LocationId=@location WHERE b.VisitRequestId=@visit AND r.PersonalDataPurgedAtUtc IS NULL) THROW 52001,'Destination unavailable.',1;
   DECLARE @inside bit=COALESCE((SELECT IsInside FROM gp.SubProjectVisitPresence WHERE VisitRequestId=@visit AND SubProjectId=@sub),0),@enter bit=0,@exit bit=0,@currentPass uniqueidentifier;
   SELECT @currentPass=p.AccessPassId FROM gp.AccessPasses p WHERE p.VisitRequestId=@visit AND p.IsCurrent=1 AND(@hash IS NULL OR p.CredentialHash=@hash);
   IF @currentPass IS NULL THROW 52001,'Current presented pass required.',1;
   IF @inside=1 SET @exit=1;
   IF @inside=0 AND gp._PlannedDestinationReady(@visit,@sub,@now,@cutoff)=1 AND EXISTS(SELECT 1 FROM gp.VisitRequests r JOIN gp.AccessPasses p ON p.VisitRequestId=r.VisitRequestId AND p.AccessPassId=@currentPass JOIN gp.PhotoAssets ph ON ph.PhotoAssetId=r.PhotoAssetId WHERE r.VisitRequestId=@visit AND r.Status='APPROVED' AND p.Status='ACTIVE' AND @now>=r.ValidFromUtc AND @now<r.ValidUntilUtc AND ph.PurgedAtUtc IS NULL AND ph.StorageKey IS NOT NULL AND ph.ContentHash IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM gp.PassReturns WHERE VisitRequestId=@visit) SET @enter=1;
   IF @Mode='DETAIL' BEGIN
    SET @result=(SELECT r.VisitRequestId visitRequestId,@currentPass accessPassId,r.PersonName personName,r.PublicReference publicReference,p.PublicPassNumber publicPassNumber,h.FullName hostName,
     gp._PlanReadiness(b.PlanId,b.Version,@sub,@now,@cutoff) readiness,@sub subProjectId,@inside isInside,@enter canEnter,@exit canExit,
     JSON_QUERY(COALESCE((SELECT e.EventType eventType,REPLACE(CONVERT(char(23),e.OccurredAtUtc,121),' ','T')+'Z' occurredAtUtc,u.DisplayName guardName FROM gp.PlannedAccessEventDestinations d JOIN gp.AccessEvents e ON e.AccessEventId=d.AccessEventId JOIN gp.Users u ON u.UserId=e.ActorUserId WHERE d.VisitRequestId=@visit AND d.SubProjectId=@sub ORDER BY e.AccessEventId DESC OFFSET 0 ROWS FETCH NEXT 100 ROWS ONLY FOR JSON PATH),N'[]')) movements
     FROM gp.VisitRequests r JOIN gp.PlannedPassBindings b ON b.VisitRequestId=r.VisitRequestId JOIN gp.AccessPasses p ON p.AccessPassId=@currentPass JOIN gp.Employees h ON h.EmployeeId=r.HostEmployeeId WHERE r.VisitRequestId=@visit FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
   END ELSE BEGIN
    DECLARE @eventType nvarchar(max)=JSON_VALUE(@PayloadJson,'$.eventType');
    IF @key IS NULL OR @pass IS NULL OR @pass<>@currentPass OR @eventType IS NULL OR @eventType COLLATE Latin1_General_100_BIN2 NOT IN('ENTRY','EXIT') THROW 52002,'Invalid movement.',1;
    EXEC gp._BeginOperation @actor,'PLANNED_MOVEMENT',@key,@PayloadJson,@op OUTPUT,@cached OUTPUT;
    -- Replay is authorized against the current identity/duty and credential, not current occupancy.
    IF @cached IS NOT NULL BEGIN COMMIT;SELECT @cached;RETURN;END;
    IF(@eventType='ENTRY' AND @enter=0) OR(@eventType='EXIT' AND @exit=0) THROW 52005,'Destination is not enterable or movement conflicts.',1;
    IF NOT EXISTS(SELECT 1 FROM gp.SubProjectVisitPresence WHERE VisitRequestId=@visit AND SubProjectId=@sub) INSERT gp.SubProjectVisitPresence VALUES(@visit,@sub,0);
    INSERT gp.AccessEvents(VisitRequestId,AccessPassId,ActorUserId,LocationId,EventType,EntryMethod,OperationId,OccurredAtUtc) VALUES(@visit,@pass,@actor,@location,@eventType,CASE WHEN @hash IS NULL THEN 'MANUAL' ELSE 'SCAN' END,@op,@now);
    DECLARE @event bigint=CONVERT(bigint,SCOPE_IDENTITY());
    INSERT gp.PlannedAccessEventDestinations VALUES(@event,@visit,@sub);
    UPDATE gp.SubProjectVisitPresence SET IsInside=CASE WHEN @eventType='ENTRY' THEN 1 ELSE 0 END WHERE VisitRequestId=@visit AND SubProjectId=@sub;
    UPDATE gp.VisitPresence SET IsInside=CASE WHEN EXISTS(SELECT 1 FROM gp.SubProjectVisitPresence WHERE VisitRequestId=@visit AND IsInside=1) THEN 1 ELSE 0 END,LastAccessEventId=@event,LastMovementAtUtc=@now WHERE VisitRequestId=@visit;
    SET @result=(SELECT @visit visitRequestId,@sub subProjectId,@eventType eventType,@event accessEventId,@op operationId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
    INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode,MetadataJson) VALUES(@actor,'PLANNED_MOVEMENT','VISIT',CONVERT(varchar(36),@visit),@location,@pair,'SUCCESS',@result);
    EXEC gp._CompleteOperation @op,@result;
   END;
  END;
 END;
 IF @Mode='DETAIL' AND @hash IS NOT NULL INSERT gp.PassScanAttempts(AccessPassId,VisitRequestId,ActorUserId,LocationId,OutcomeCode,CorrelationId) VALUES(@currentPass,@visit,@actor,@location,CASE WHEN @enter=1 OR @exit=1 THEN 'VALID' ELSE 'NOT_AUTHORIZED' END,NEWID());
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH
  DECLARE @error int=ERROR_NUMBER();IF @@TRANCOUNT>0 ROLLBACK;
  EXEC gp._AuditFailure @actor,'PLANNED_ACCESS_FAILED',NULL,@error;
  THROW;
 END CATCH;
END;
GO
/* Linked passes cannot fall back to account-wide entry, exit or old host decisions. */
DECLARE @name sysname,@definition nvarchar(max),@needle nvarchar(300),@replacement nvarchar(max);
DECLARE patches CURSOR LOCAL FAST_FORWARD FOR SELECT n FROM(VALUES('gp.RecordMovement'),('gp.RecordGuardDutyMovement'),('gp.DecideVisit')) names(n);
OPEN patches;FETCH NEXT FROM patches INTO @name;
WHILE @@FETCH_STATUS=0 BEGIN
 SET @definition=OBJECT_DEFINITION(OBJECT_ID(@name));SET @needle=N'EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;';
 IF @name='gp.RecordMovement' SET @needle=N'IF @location IS NULL OR @location<>@LocationId THROW 52001, ''Not authorized.'', 1;';
 IF @name='gp.DecideVisit' SET @needle=N'EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;';
 IF @definition IS NULL OR CHARINDEX(@needle,@definition)=0 THROW 52000,'Legacy movement/decision contract required.',1;
 SET @replacement=@needle+N' IF EXISTS(SELECT 1 FROM gp.PlannedPassBindings WHERE VisitRequestId=@VisitRequestId) THROW 52001,''Use the planned destination workflow.'',1;';
 SET @definition=REPLACE(@definition,@needle,@replacement);SET @definition=STUFF(@definition,1,CHARINDEX(' ',@definition)-1,'ALTER');EXEC sys.sp_executesql @definition;
 FETCH NEXT FROM patches INTO @name;
END;CLOSE patches;DEALLOCATE patches;
DECLARE @read nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID('gp.ReadGuardDutyPass')),@readNeedle nvarchar(300)=N'EXEC gp._GuardDutyJson @actor,@DutyKind,@DutyId,@LocationId,@visit,@now,@detail OUTPUT;';
IF @read IS NULL OR CHARINDEX(@readNeedle,@read)=0 THROW 52000,'Guard detail contract required.',1;
SET @read=REPLACE(@read,@readNeedle,@readNeedle+N' IF EXISTS(SELECT 1 FROM gp.PlannedPassBindings WHERE VisitRequestId=@visit) SET @detail=JSON_MODIFY(JSON_MODIFY(@detail,''$.canEnter'',CONVERT(bit,0)),''$.canExit'',CONVERT(bit,0));');
SET @read=STUFF(@read,1,CHARINDEX(' ',@read)-1,'ALTER');EXEC sys.sp_executesql @read;
/* Existing reception/admin timeline labels retain the exact planned destination.
   Guard account views omit other-account events rather than disclose them. */
DECLARE @timeline nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID('gp._VisitReadJson')),@timelineNeedle nvarchar(100)=N'u.DisplayName guardName,';
IF @timeline IS NULL OR CHARINDEX(@timelineNeedle,@timeline)=0 THROW 52000,'Visit timeline contract required.',1;
SET @timeline=REPLACE(@timeline,@timelineNeedle,@timelineNeedle+N' (SELECT pr.ProjectName+N'' / ''+s.Name FROM gp.PlannedAccessEventDestinations d JOIN gp.SubProjects s ON s.SubProjectId=d.SubProjectId JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=s.AccountOfficeId JOIN gp.Projects pr ON pr.ProjectId=pl.ProjectId WHERE d.AccessEventId=e.AccessEventId) projectName,');
DECLARE @eventNeedle nvarchar(100)=N'WHERE e.VisitRequestId=v.VisitRequestId';
IF CHARINDEX(@eventNeedle,@timeline)=0 THROW 52000,'Visit event scope contract required.',1;
SET @timeline=REPLACE(@timeline,@eventNeedle,@eventNeedle+N' AND(@View<>''GUARD'' OR NOT EXISTS(SELECT 1 FROM gp.PlannedAccessEventDestinations d JOIN gp.SubProjects sp ON sp.SubProjectId=d.SubProjectId WHERE d.AccessEventId=e.AccessEventId AND gp._GuardDutyAssigned(@Actor,''PROJECT'',sp.AccountOfficeId,sp.LocationId,@Now)=0))');
SET @timeline=STUFF(@timeline,1,CHARINDEX(' ',@timeline)-1,'ALTER');EXEC sys.sp_executesql @timeline;
GRANT EXECUTE ON gp.PlannedAccess TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('129',N'Reception-audited plan/pass binding and exact destination movement with live approval and legacy bypass denial');
COMMIT;
