SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54800,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='100') THROW 54800,'Migration 100 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='101') THROW 54800,'Migration 101 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
ALTER PROCEDURE gp.ReadReceptionQueue @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@LocalVisitDate date=NULL,
 @Search nvarchar(100)=NULL,@Status varchar(12)='ALL',@AfterSubmittedAtUtc datetime2(3)=NULL,@AfterVisitRequestId uniqueidentifier=NULL,@PendingReturns bit=0,@TypeFilter varchar(12)='ALL',@PrintFilter varchar(20)='ALL',@InsideOnly bit=0,@Take int=50
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 53500,'Ambient transaction not accepted.',1;
 IF @Take IS NULL OR @Take<50 OR @Take>500 OR @InsideOnly IS NULL OR @TypeFilter IS NULL OR @TypeFilter COLLATE Latin1_General_100_BIN2 NOT IN('ALL','EMPLOYEE','VISITOR') OR @PrintFilter IS NULL OR @PrintFilter COLLATE Latin1_General_100_BIN2 NOT IN('ALL','PRINTED','UNPRINTED','PENDING_RETURN','RETURNED') OR @PendingReturns IS NULL OR @LocationId IS NULL OR @LocationId<=0 OR @Status IS NULL OR @Status COLLATE Latin1_General_100_BIN2 NOT IN('ALL','PENDING','APPROVED','DENIED','CANCELLED','REVOKED','EXPIRED')
  OR (@AfterSubmittedAtUtc IS NULL AND @AfterVisitRequestId IS NOT NULL) OR (@AfterSubmittedAtUtc IS NOT NULL AND @AfterVisitRequestId IS NULL) THROW 53502,'Invalid reception filter.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@today date,@cutoff datetime2(3),@result nvarchar(max);
 BEGIN TRY
  BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
  EXEC gp._RequireReceptionLocation @actor,@LocationId,@now;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
  SET @today=CONVERT(date,DATEADD(minute,330,@now));SET @LocalVisitDate=COALESCE(@LocalVisitDate,@today);
  IF @LocalVisitDate<DATEADD(day,-30,@today) OR @LocalVisitDate>DATEADD(day,90,@today) THROW 53502,'Date outside operational range.',1;
  SET @Search=NULLIF(LTRIM(RTRIM(@Search)),N'');
  DECLARE @matches table(VisitId uniqueidentifier PRIMARY KEY,Submitted datetime2(3),EmployeeId nvarchar(64),Inside bit,Pending bit);

  -- Resolve the office's distinct people once, including every active project.
  DECLARE @insideEmployees table(EmployeeId nvarchar(64) COLLATE DATABASE_DEFAULT PRIMARY KEY);
  DECLARE @insideGuests table(IntakeId uniqueidentifier,PersonKey uniqueidentifier,PRIMARY KEY(IntakeId,PersonKey));
  INSERT @insideEmployees SELECT v.EmployeeId FROM gp.VisitRequests v JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId WHERE v.LocationId=@LocationId AND s.IsInside=1 AND v.EmployeeId IS NOT NULL
   UNION SELECT s.EmployeeId FROM gp.EmployeeProjectPresence s JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=s.ProjectLocationId WHERE pl.LocationId=@LocationId AND s.IsInside=1;
  INSERT @insideGuests SELECT DISTINCT v.IntakeId,v.ClientPersonKey FROM gp.VisitRequests v JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId WHERE v.LocationId=@LocationId AND s.IsInside=1 AND v.EmployeeId IS NULL;
  INSERT @matches SELECT v.VisitRequestId,v.SubmittedAtUtc,v.EmployeeId,x.Inside,CONVERT(bit,CASE WHEN v.Status='PENDING' AND ret.VisitRequestId IS NULL AND p.Status='PENDING' AND v.ValidUntilUtc>@now THEN 1 ELSE 0 END)
  FROM gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 LEFT JOIN gp.PassReturns ret ON ret.VisitRequestId=v.VisitRequestId
  CROSS APPLY(SELECT CONVERT(bit,CASE WHEN v.EmployeeId IS NOT NULL AND EXISTS(SELECT 1 FROM @insideEmployees i WHERE i.EmployeeId=v.EmployeeId) OR v.EmployeeId IS NULL AND EXISTS(SELECT 1 FROM @insideGuests i WHERE i.IntakeId=v.IntakeId AND i.PersonKey=v.ClientPersonKey) THEN 1 ELSE 0 END) Inside,(SELECT COUNT(*) FROM gp.PassPrintJobs j WHERE j.VisitRequestId=v.VisitRequestId AND j.Status='DISPATCHED') Printed) x
  CROSS APPLY(SELECT CASE WHEN v.Status='CANCELLED' THEN 'CANCELLED' WHEN ret.VisitRequestId IS NULL AND p.Status='REVOKED' THEN 'REVOKED' WHEN v.ValidUntilUtc<=@now THEN 'EXPIRED' ELSE v.Status END State) e
  WHERE v.LocationId=@LocationId AND(@PendingReturns=1 OR v.LocalVisitDate=@LocalVisitDate) AND v.PersonalDataPurgedAtUtc IS NULL AND EXISTS(SELECT 1 FROM gp.VisitPresence vp WHERE vp.VisitRequestId=v.VisitRequestId)
  AND(@PendingReturns=0 OR ret.VisitRequestId IS NULL AND x.Printed>0)
  AND(@Status='ALL' OR @Status='PENDING' AND v.Status='PENDING' AND ret.VisitRequestId IS NULL AND p.Status='PENDING' AND v.ValidUntilUtc>@now OR @Status<>'PENDING' AND e.State=@Status)
  AND(@Search IS NULL OR CHARINDEX(@Search,v.PersonName)>0 OR CHARINDEX(@Search,v.PublicReference)>0 OR CHARINDEX(@Search,p.PublicPassNumber)>0 OR CHARINDEX(@Search,v.EmployeeId)>0)
  AND(@TypeFilter='ALL' OR @TypeFilter='VISITOR' AND v.RequestType='EXTERNAL' OR @TypeFilter='EMPLOYEE' AND v.RequestType<>'EXTERNAL')
  AND(@PrintFilter='ALL' OR @PrintFilter='PRINTED' AND x.Printed>0 OR @PrintFilter='UNPRINTED' AND x.Printed=0 OR @PrintFilter='PENDING_RETURN' AND x.Printed>0 AND ret.VisitRequestId IS NULL OR @PrintFilter='RETURNED' AND ret.VisitRequestId IS NOT NULL)
  AND(@InsideOnly=0 OR x.Inside=1);
  DECLARE @page table(VisitId uniqueidentifier PRIMARY KEY,Submitted datetime2(3));
  INSERT @page SELECT TOP(@Take+1) VisitId,Submitted FROM @matches WHERE @AfterSubmittedAtUtc IS NULL OR Submitted<@AfterSubmittedAtUtc OR Submitted=@AfterSubmittedAtUtc AND VisitId<@AfterVisitRequestId ORDER BY Submitted DESC,VisitId DESC;
  DECLARE @more bit=CASE WHEN (SELECT COUNT(*) FROM @page)>@Take THEN 1 ELSE 0 END,@afterTime datetime2(3),@afterId uniqueidentifier;
  IF @more=1 DELETE @page WHERE VisitId=(SELECT TOP(1) VisitId FROM @page ORDER BY Submitted,VisitId);
  IF @more=1 SELECT TOP(1) @afterTime=Submitted,@afterId=VisitId FROM @page ORDER BY Submitted,VisitId;
  EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._RequireReceptionLocation @actor,@LocationId,@now;
  SET @result=(SELECT JSON_QUERY(COALESCE((SELECT v.VisitRequestId visitRequestId,v.PersonName personName,v.CompanyName companyName,JSON_QUERY(v.DeviceTypesJson) deviceTypes,v.EmployeeId employeeId,
    CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END requestType,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,
    p.AccessPassId accessPassId,v.Status status,p.Status passStatus,pj.ProjectName projectName,he.FullName hostName,he.OfficialEmail hostEmail,JSON_QUERY(CASE WHEN v.RequestType='TEMP_ID' THEN gp._EmployeeProjectSummary(v.EmployeeId,@cutoff,@now,v.LocationId) END) employeeProjects,n.Inside isInside,
    REPLACE(CONVERT(char(23),v.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc,
    REPLACE(CONVERT(char(23),n.Submitted,121),' ','T')+'Z' submittedAtUtc,
    REPLACE(CONVERT(char(23),ret.ReturnedAtUtc,121),' ','T')+'Z' returnedAtUtc,
    (SELECT COUNT(*) FROM gp.PassPrintJobs j WHERE j.VisitRequestId=v.VisitRequestId AND j.Status='DISPATCHED') printCount
    FROM @page pg JOIN @matches n ON n.VisitId=pg.VisitId JOIN gp.VisitRequests v ON v.VisitRequestId=n.VisitId JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1
    JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId LEFT JOIN gp.PassReturns ret ON ret.VisitRequestId=v.VisitRequestId LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId
    LEFT JOIN gp.Projects pj ON pj.ProjectId=pl.ProjectId LEFT JOIN gp.Employees he ON he.EmployeeId=v.HostEmployeeId AND he.IsActive=1 AND he.LastSyncedAtUtc BETWEEN @cutoff AND @now ORDER BY n.Submitted DESC,n.VisitId DESC FOR JSON PATH),N'[]')) visits,
    (SELECT COUNT(*) FROM gp.VisitRequests rv WHERE rv.LocationId=@LocationId AND rv.PersonalDataPurgedAtUtc IS NULL AND EXISTS(SELECT 1 FROM gp.VisitPresence vp WHERE vp.VisitRequestId=rv.VisitRequestId) AND NOT EXISTS(SELECT 1 FROM gp.PassReturns r WHERE r.VisitRequestId=rv.VisitRequestId) AND EXISTS(SELECT 1 FROM gp.PassPrintJobs j WHERE j.VisitRequestId=rv.VisitRequestId AND j.Status='DISPATCHED')) pendingReturnCount,
    JSON_QUERY((SELECT COUNT(*) total,COALESCE(SUM(CONVERT(int,Pending)),0) pending,(SELECT COUNT(*) FROM(SELECT DISTINCT CASE WHEN EmployeeId IS NULL THEN CONVERT(nvarchar(64),VisitId) ELSE EmployeeId END Person FROM @matches WHERE Inside=1) i) inside FROM @matches FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) counts,
    @more hasMore,@afterId afterVisitRequestId,REPLACE(CONVERT(char(23),@afterTime,121),' ','T')+'Z' afterSubmittedAtUtc,
    CONVERT(char(10),@LocalVisitDate,23) visitDate FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ResultCode) VALUES(@actor,'RECEPTION_QUEUE_READ','LOCATION',CONVERT(varchar(12),@LocationId),@LocationId,'SUCCESS');
  COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
ALTER PROCEDURE gp.ReadAdminVisitRegister
 @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@FromDate date,@ToDate date,
 @ProjectLocationId bigint=NULL,@FiltersJson nvarchar(max)=N'{}',@Sort nvarchar(200)=N'submittedAtUtc',@Direction nvarchar(200)=N'DESC',@Page int=1,@ForExport bit=0,@PageSize int=50
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 54600,'Ambient transaction not accepted.',1;
 DECLARE @fields table(name nvarchar(200) COLLATE Latin1_General_100_BIN2 PRIMARY KEY);
 INSERT @fields VALUES ('localVisitDate'),('submittedAtUtc'),('personName'),('employeeId'),('personEmail'),('personPhone'),('companyName'),('deviceTypes'),('locationName'),('projectName'),('hostName'),('hostEmail'),('requestType'),('reason'),('publicReference'),('publicPassNumber'),('status'),('passStatus'),('presence'),('printStatus'),('returnedAtUtc'),('validFromUtc'),('validUntilUtc'),('firstEntryAtUtc'),('lastEntryAtUtc'),('lastExitAtUtc');
 IF @PageSize IS NULL OR @PageSize NOT IN(50,200) OR(@ForExport=0 AND @PageSize<>50) OR @LocationId IS NULL OR @LocationId<=0 OR @ProjectLocationId<=0 OR @FromDate IS NULL OR @ToDate IS NULL OR @FromDate>@ToDate OR DATEDIFF(day,@FromDate,@ToDate)>30
 OR @ForExport IS NULL OR @Page IS NULL OR @Page<1 OR @Page>100000 OR @Sort IS NULL OR NOT EXISTS(SELECT 1 FROM @fields WHERE name=@Sort COLLATE Latin1_General_100_BIN2 AND DATALENGTH(name)=DATALENGTH(@Sort))
 OR @Direction IS NULL OR @Direction COLLATE Latin1_General_100_BIN2 NOT IN(N'ASC',N'DESC') OR DATALENGTH(@Direction) NOT IN(6,8)
 OR @FiltersJson IS NULL OR DATALENGTH(@FiltersJson)>16000 OR ISJSON(@FiltersJson)<>1 OR LEFT(LTRIM(@FiltersJson),1)<>N'{' THROW 52002,'Invalid register query.',1;
 DECLARE @filters table(name nvarchar(200) COLLATE Latin1_General_100_BIN2 PRIMARY KEY,value nvarchar(200));
 IF EXISTS(SELECT 1 FROM OPENJSON(@FiltersJson) j WHERE j.type<>1 OR LEN(j.value)=0 OR DATALENGTH(j.value)>400 OR DATALENGTH(j.value)<>DATALENGTH(LTRIM(RTRIM(j.value))) OR NOT EXISTS(SELECT 1 FROM @fields f WHERE f.name=j.[key] COLLATE Latin1_General_100_BIN2 AND DATALENGTH(f.name)=DATALENGTH(j.[key])))
 OR EXISTS(SELECT 1 FROM OPENJSON(@FiltersJson) GROUP BY [key] COLLATE Latin1_General_100_BIN2 HAVING COUNT(*)>1) THROW 52002,'Invalid register filters.',1;
 INSERT @filters SELECT [key],value FROM OPENJSON(@FiltersJson);
 IF EXISTS(SELECT 1 FROM @filters WHERE (name='status' AND value COLLATE Latin1_General_100_BIN2 NOT IN('PENDING','APPROVED','DENIED','CANCELLED'))
 OR(name='requestType' AND value COLLATE Latin1_General_100_BIN2 NOT IN('DIGITAL_ID','EMPLOYEE_PROJECT','EXTERNAL'))
 OR(name='passStatus' AND value COLLATE Latin1_General_100_BIN2 NOT IN('PENDING','ACTIVE','DENIED','REVOKED'))
 OR(name='presence' AND value COLLATE Latin1_General_100_BIN2 NOT IN('INSIDE','OUTSIDE'))
 OR(name='printStatus' AND value COLLATE Latin1_General_100_BIN2 NOT IN('NOT_PRINTED','PRINTED','RETURNED'))
 OR(name='deviceTypes' AND value COLLATE Latin1_General_100_BIN2 NOT IN('LAPTOP','TABLET','PEN_DRIVE','CAMERA','OTHER'))) THROW 52002,'Invalid register filters.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@result nvarchar(max),@total int,@rows nvarchar(max);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 IF NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@LocationId AND IsActive=1)
 OR gp._AdminScopeAllowed(@actor,'VISITS_READ',@LocationId,@ProjectLocationId,@now)=0
 OR(@ForExport=1 AND gp._AdminScopeAllowed(@actor,'REPORTS_EXPORT',@LocationId,@ProjectLocationId,@now)=0)
 OR(@ProjectLocationId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gp.ProjectLocations WHERE ProjectLocationId=@ProjectLocationId AND LocationId=@LocationId AND IsActive=1)) THROW 52001,'Not authorized.',1;
 EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
  -- Resolve the office's distinct people once, including every active project.
  DECLARE @insideEmployees table(EmployeeId nvarchar(64) COLLATE DATABASE_DEFAULT PRIMARY KEY);
  DECLARE @insideGuests table(IntakeId uniqueidentifier,PersonKey uniqueidentifier,PRIMARY KEY(IntakeId,PersonKey));
  INSERT @insideEmployees SELECT v.EmployeeId FROM gp.VisitRequests v JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId WHERE v.LocationId=@LocationId AND s.IsInside=1 AND v.EmployeeId IS NOT NULL
   UNION SELECT s.EmployeeId FROM gp.EmployeeProjectPresence s JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=s.ProjectLocationId WHERE pl.LocationId=@LocationId AND s.IsInside=1;
  INSERT @insideGuests SELECT DISTINCT v.IntakeId,v.ClientPersonKey FROM gp.VisitRequests v JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId WHERE v.LocationId=@LocationId AND s.IsInside=1 AND v.EmployeeId IS NULL;

 CREATE TABLE #candidateIds(VisitId uniqueidentifier PRIMARY KEY);
 INSERT #candidateIds SELECT v.VisitRequestId FROM gp.VisitRequests v JOIN gp.VisitPresence vp ON vp.VisitRequestId=v.VisitRequestId JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1
 WHERE v.LocationId=@LocationId AND v.LocalVisitDate BETWEEN @FromDate AND @ToDate AND(@ProjectLocationId IS NULL OR v.ProjectLocationId=@ProjectLocationId) AND v.PersonalDataPurgedAtUtc IS NULL;
 DECLARE @late bit=CASE WHEN @ForExport=0 AND @Sort=N'submittedAtUtc' AND NOT EXISTS(SELECT 1 FROM @filters) THEN 1 ELSE 0 END,@fullTotal int=(SELECT COUNT(*) FROM #candidateIds);
 IF @late=1
 BEGIN
  DECLARE @pick nvarchar(max)=N'DELETE FROM #candidateIds WHERE VisitId NOT IN(SELECT v.VisitRequestId FROM #candidateIds c JOIN gp.VisitRequests v ON v.VisitRequestId=c.VisitId ORDER BY v.SubmittedAtUtc '+@Direction+N',v.VisitRequestId ASC OFFSET @offset ROWS FETCH NEXT @take ROWS ONLY);';
  DECLARE @pickOffset int=(@Page-1)*@PageSize;EXEC sys.sp_executesql @pick,N'@offset int,@take int',@offset=@pickOffset,@take=@PageSize;
 END;
 DECLARE @history table(VisitId uniqueidentifier PRIMARY KEY,firstEntry datetime2(3),lastEntry datetime2(3),lastExit datetime2(3));
 INSERT @history SELECT VisitId,MIN(CASE WHEN EventType='ENTRY' THEN OccurredAtUtc END),MAX(CASE WHEN EventType='ENTRY' THEN OccurredAtUtc END),MAX(CASE WHEN EventType='EXIT' THEN OccurredAtUtc END) FROM(
 SELECT c.VisitId,a.EventType,a.OccurredAtUtc FROM #candidateIds c JOIN gp.AccessEvents a ON a.VisitRequestId=c.VisitId
 UNION ALL SELECT c.VisitId,a.EventType,a.OccurredAtUtc FROM #candidateIds c JOIN gp.VisitRequests v ON v.VisitRequestId=c.VisitId JOIN gp.EmployeeProjectAccessEvents a ON a.VisitRequestId=c.VisitId OR a.PresentedVisitRequestId=c.VisitId
 JOIN gp.ProjectLocations ep ON ep.ProjectLocationId=a.ProjectLocationId WHERE ep.LocationId=v.LocationId AND(v.RequestType='TEMP_ID' OR a.ProjectLocationId=v.ProjectLocationId)) e GROUP BY VisitId;

 SELECT v.VisitRequestId visitRequestId,CONVERT(char(10),v.LocalVisitDate,23) localVisitDate,
 REPLACE(CONVERT(char(23),v.SubmittedAtUtc,121),' ','T')+'Z' submittedAtUtc,
 v.PersonName personName,v.EmployeeId employeeId,v.PersonEmail personEmail,v.PersonPhone personPhone,v.CompanyName companyName,
 COALESCE((SELECT STRING_AGG(CONVERT(nvarchar(max),j.value),N', ') WITHIN GROUP(ORDER BY j.value) FROM OPENJSON(v.DeviceTypesJson) j),N'') deviceTypes,
 l.LocationName locationName,pj.ProjectName projectName,h.FullName hostName,h.OfficialEmail hostEmail,
 CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END requestType,v.Reason reason,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,
 v.Status status,p.Status passStatus,CASE WHEN (CASE WHEN v.RequestType='TEMP_ID' THEN CASE WHEN EXISTS(SELECT 1 FROM @insideEmployees i WHERE i.EmployeeId=v.EmployeeId) THEN 1 ELSE 0 END ELSE vp.IsInside END)=1 THEN 'INSIDE' ELSE 'OUTSIDE' END presence,
 CASE WHEN ret.VisitRequestId IS NOT NULL THEN 'RETURNED' WHEN EXISTS(SELECT 1 FROM gp.PassPrintJobs j WHERE j.VisitRequestId=v.VisitRequestId AND j.Status='DISPATCHED') THEN 'PRINTED' ELSE 'NOT_PRINTED' END printStatus,
 REPLACE(CONVERT(char(23),ret.ReturnedAtUtc,121),' ','T')+'Z' returnedAtUtc,
 REPLACE(CONVERT(char(23),v.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc
  ,REPLACE(CONVERT(char(23),mv.firstEntry,121),' ','T')+'Z' firstEntryAtUtc,REPLACE(CONVERT(char(23),mv.lastEntry,121),' ','T')+'Z' lastEntryAtUtc,REPLACE(CONVERT(char(23),mv.lastExit,121),' ','T')+'Z' lastExitAtUtc
 INTO #register FROM #candidateIds ci JOIN gp.VisitRequests v ON v.VisitRequestId=ci.VisitId JOIN gp.VisitPresence vp ON vp.VisitRequestId=v.VisitRequestId JOIN gp.Locations l ON l.LocationId=v.LocationId
 JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1
 LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId LEFT JOIN gp.Projects pj ON pj.ProjectId=pl.ProjectId
 LEFT JOIN gp.Employees h ON h.EmployeeId=v.HostEmployeeId LEFT JOIN gp.PassReturns ret ON ret.VisitRequestId=v.VisitRequestId
 LEFT JOIN @history mv ON mv.VisitId=v.VisitRequestId
 WHERE v.LocationId=@LocationId AND v.LocalVisitDate BETWEEN @FromDate AND @ToDate AND(@ProjectLocationId IS NULL OR v.ProjectLocationId=@ProjectLocationId)
 -- Admission above grants this whole office or the exact selected project.
 AND v.PersonalDataPurgedAtUtc IS NULL;
 DELETE r FROM #register r WHERE EXISTS(SELECT 1 FROM @filters f WHERE NOT EXISTS(
 SELECT 1 FROM (VALUES (N'localVisitDate',CONVERT(nvarchar(max),r.localVisitDate)),(N'submittedAtUtc',CONVERT(nvarchar(max),r.submittedAtUtc)),(N'personName',CONVERT(nvarchar(max),r.personName)),(N'employeeId',CONVERT(nvarchar(max),r.employeeId)),(N'personEmail',CONVERT(nvarchar(max),r.personEmail)),(N'personPhone',CONVERT(nvarchar(max),r.personPhone)),(N'companyName',CONVERT(nvarchar(max),r.companyName)),(N'deviceTypes',CONVERT(nvarchar(max),r.deviceTypes)),(N'locationName',CONVERT(nvarchar(max),r.locationName)),(N'projectName',CONVERT(nvarchar(max),r.projectName)),(N'hostName',CONVERT(nvarchar(max),r.hostName)),(N'hostEmail',CONVERT(nvarchar(max),r.hostEmail)),(N'requestType',CONVERT(nvarchar(max),r.requestType)),(N'reason',CONVERT(nvarchar(max),r.reason)),(N'publicReference',CONVERT(nvarchar(max),r.publicReference)),(N'publicPassNumber',CONVERT(nvarchar(max),r.publicPassNumber)),(N'status',CONVERT(nvarchar(max),r.status)),(N'passStatus',CONVERT(nvarchar(max),r.passStatus)),(N'presence',CONVERT(nvarchar(max),r.presence)),(N'printStatus',CONVERT(nvarchar(max),r.printStatus)),(N'returnedAtUtc',CONVERT(nvarchar(max),r.returnedAtUtc)),(N'validFromUtc',CONVERT(nvarchar(max),r.validFromUtc)),(N'validUntilUtc',CONVERT(nvarchar(max),r.validUntilUtc)),(N'firstEntryAtUtc',CONVERT(nvarchar(max),r.firstEntryAtUtc)),(N'lastEntryAtUtc',CONVERT(nvarchar(max),r.lastEntryAtUtc)),(N'lastExitAtUtc',CONVERT(nvarchar(max),r.lastExitAtUtc))) c(name,value)
 WHERE c.name COLLATE Latin1_General_100_BIN2=f.name AND ((f.name IN('status','passStatus','requestType','presence','printStatus') AND c.value COLLATE Latin1_General_100_BIN2=f.value COLLATE Latin1_General_100_BIN2) OR(f.name NOT IN('status','passStatus','requestType','presence','printStatus') AND CHARINDEX(f.value COLLATE Latin1_General_100_CI_AS,COALESCE(c.value,N'') COLLATE Latin1_General_100_CI_AS)>0))));
 SELECT @total=CASE WHEN @late=1 THEN @fullTotal ELSE COUNT(*) END FROM #register;
 DECLARE @datasetVersion varchar(64)=NULL;
 IF @ForExport=1
 BEGIN
  IF @total>10000 THROW 52002,'Narrow the export range.',1;
  -- Row digests include every exported value; the ordered aggregate is bounded to 10,000 hashes.
  SELECT @datasetVersion=LOWER(CONVERT(varchar(64),HASHBYTES('SHA2_256',COALESCE(
   STRING_AGG(CONVERT(varchar(max),CONVERT(varchar(64),HASHBYTES('SHA2_256',j.data),2)),',') WITHIN GROUP(ORDER BY r.visitRequestId),'')),2))
  FROM #register r CROSS APPLY(SELECT (SELECT r.* FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER) data) j;
 END;
 -- Recheck the session/capabilities after materialization and hashing; never cache authority.
 EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 IF gp._AdminScopeAllowed(@actor,'VISITS_READ',@LocationId,@ProjectLocationId,@now)=0 OR(@ForExport=1 AND gp._AdminScopeAllowed(@actor,'REPORTS_EXPORT',@LocationId,@ProjectLocationId,@now)=0) THROW 52001,'Scope changed during read.',1;
 -- Only names from the fixed projection and a validated direction reach this statement. Filter values remain data.
 DECLARE @sql nvarchar(max)=N'SET @rows=COALESCE((SELECT * FROM #register ORDER BY '+QUOTENAME(@Sort)+N' '+@Direction+N',visitRequestId ASC OFFSET @offset ROWS FETCH NEXT @take ROWS ONLY FOR JSON PATH,INCLUDE_NULL_VALUES),N''[]'');';
 DECLARE @offset int=CASE WHEN @late=1 THEN 0 ELSE (@Page-1)*@PageSize END;
 EXEC sys.sp_executesql @sql,N'@offset int,@take int,@rows nvarchar(max) OUTPUT',@offset,@PageSize,@rows OUTPUT;
 SET @result=(SELECT JSON_QUERY(@rows) rows,@total total,@Page page,@PageSize pageSize,@datasetVersion datasetVersion,REPLACE(CONVERT(char(23),@now,121),' ','T')+'Z' checkedAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,LocationId,ProjectLocationId,ResultCode) VALUES(@actor,CASE WHEN @ForExport=1 THEN 'ADMIN_REGISTER_EXPORTED' ELSE 'ADMIN_REGISTER_READ' END,'ADMIN_QUERY',@LocationId,@ProjectLocationId,'SUCCESS');
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp.ReadGuardPhotoSource @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@DutyKind varchar(10),@DutyId bigint,@VisitRequestId uniqueidentifier AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52800,'Ambient transaction not accepted.',1;
 IF @LocationId IS NULL OR @LocationId<=0 OR @DutyId IS NULL OR @DutyId<=0 OR @VisitRequestId IS NULL OR @DutyKind IS NULL OR @DutyKind COLLATE Latin1_General_100_BIN2 NOT IN('PROJECT','COMMON') THROW 52802,'Invalid photo scope.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@result nvarchar(max),@lock nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@VisitRequestId));
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._TakeLock @lock,'Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF gp._GuardDutyVisitAllowed(@actor,@DutyKind,@DutyId,@LocationId,@VisitRequestId,@cutoff,@now)=0 OR gp._VisitReadAllowed(@actor,'GUARD',@VisitRequestId,@now,@cutoff)=0 THROW 52801,'Not authorized.',1;
 SET @result=(SELECT v.VisitRequestId visitRequestId,p.AccessPassId accessPassId,a.PhotoAssetId photoAssetId,a.StorageKey storageKey,LOWER(CONVERT(varchar(64),a.ContentHash,2)) contentHash,a.MimeType mimeType,a.ByteLength byteLength FROM gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 JOIN gp.PhotoAssets a ON a.PhotoAssetId=v.PhotoAssetId WHERE v.VisitRequestId=@VisitRequestId AND a.PurgedAtUtc IS NULL AND a.StorageKey IS NOT NULL AND a.ContentHash IS NOT NULL FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 IF @result IS NULL THROW 52801,'Not authorized.',1;
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode) SELECT @actor,'VISIT_PHOTO_AUTHORIZED','VISIT',CONVERT(varchar(36),VisitRequestId),LocationId,ProjectLocationId,'SUCCESS' FROM gp.VisitRequests WHERE VisitRequestId=@VisitRequestId;
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON gp.ReadGuardPhotoSource TO gp_media_runtime;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('101',N'Set-based office presence, late register projection and scoped guard photo metadata');COMMIT;
