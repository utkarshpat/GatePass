SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54800,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='106') THROW 54800,'Migration 106 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='107') THROW 54800,'Migration 107 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
DECLARE @check sysname=(SELECT name FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('gp.AdminExportSnapshots') AND definition LIKE '%RowsJson%' AND definition LIKE '%datalength%');
IF @check IS NULL THROW 54800,'Snapshot storage constraint required.',1;
DECLARE @ddl nvarchar(max)=N'ALTER TABLE gp.AdminExportSnapshots DROP CONSTRAINT '+QUOTENAME(@check);EXEC sys.sp_executesql @ddl;
ALTER TABLE gp.AdminExportSnapshots ADD CONSTRAINT CK_AdminExportSnapshots_Rows CHECK(ISJSON(RowsJson)=1 AND DATALENGTH(RowsJson)<=33554432);
GO
ALTER PROCEDURE gp.ReadAdminVisitRegister
 @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@FromDate date,@ToDate date,
 @ProjectLocationId bigint=NULL,@FiltersJson nvarchar(max)=N'{}',@Sort nvarchar(200)=N'submittedAtUtc',@Direction nvarchar(200)=N'DESC',@Page int=1,@ForExport bit=0,@PageSize int=50,@CreateExportSnapshot bit=0,@ExportSnapshotId uniqueidentifier=NULL,@FinishExport bit=0,@CancelExport bit=0
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 54600,'Ambient transaction not accepted.',1;
 DECLARE @fields table(name nvarchar(200) COLLATE Latin1_General_100_BIN2 PRIMARY KEY);
 INSERT @fields VALUES ('localVisitDate'),('submittedAtUtc'),('personName'),('employeeId'),('personEmail'),('personPhone'),('companyName'),('deviceTypes'),('locationName'),('projectName'),('hostName'),('hostEmail'),('requestType'),('reason'),('publicReference'),('publicPassNumber'),('status'),('passStatus'),('presence'),('printStatus'),('returnedAtUtc'),('validFromUtc'),('validUntilUtc'),('firstEntryAtUtc'),('lastEntryAtUtc'),('lastExitAtUtc');
 IF @CancelExport IS NULL OR(@CancelExport=1 AND(@ExportSnapshotId IS NULL OR @ForExport<>1 OR @CreateExportSnapshot=1 OR @FinishExport=1)) OR @CreateExportSnapshot IS NULL OR @FinishExport IS NULL OR(@CreateExportSnapshot=1 AND(@ForExport<>1 OR @Page<>1 OR @ExportSnapshotId IS NOT NULL)) OR(@ExportSnapshotId IS NOT NULL AND @ForExport<>1) OR(@FinishExport=1 AND @ExportSnapshotId IS NULL) OR @PageSize IS NULL OR @PageSize NOT IN(50,200) OR(@ForExport=0 AND @PageSize<>50) OR @LocationId IS NULL OR @LocationId<=0 OR @ProjectLocationId<=0 OR @FromDate IS NULL OR @ToDate IS NULL OR @FromDate>@ToDate OR DATEDIFF(day,@FromDate,@ToDate)>30
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
 IF @CancelExport=1
 BEGIN
  -- Session/CSRF remains mandatory; removing only this session's own temporary
  -- data is allowed even when its former report scope has been revoked.
  DELETE gp.AdminExportSnapshots WHERE SnapshotId=@ExportSnapshotId AND OwnerSessionHash=@SessionHash;
  DECLARE @cancelled bit=CASE WHEN @@ROWCOUNT=1 THEN 1 ELSE 0 END;
  COMMIT;SELECT(SELECT @cancelled cancelled FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);RETURN;
 END;
 IF NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@LocationId AND IsActive=1)
 OR gp._AdminScopeAllowed(@actor,'VISITS_READ',@LocationId,@ProjectLocationId,@now)=0
 OR(@ForExport=1 AND gp._AdminScopeAllowed(@actor,'REPORTS_EXPORT',@LocationId,@ProjectLocationId,@now)=0)
 OR(@ProjectLocationId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gp.ProjectLocations WHERE ProjectLocationId=@ProjectLocationId AND LocationId=@LocationId AND IsActive=1)) THROW 52001,'Not authorized.',1;

 DELETE gp.AdminExportSnapshots WHERE ExpiresAtUtc<=@now;
 DECLARE @queryHash binary(32)=HASHBYTES('SHA2_256',(SELECT @LocationId locationId,@ProjectLocationId projectLocationId,@FromDate [from],@ToDate [to],@Sort sort,@Direction direction,
 JSON_QUERY((SELECT name,value FROM @filters ORDER BY name FOR JSON PATH)) filters FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER));
 DECLARE @snapshotRows nvarchar(max),@snapshotVersion varchar(64),@snapshotTotal int,@snapshotOffset int=(@Page-1)*@PageSize;
 IF @ExportSnapshotId IS NOT NULL
 BEGIN
  SELECT @snapshotRows=RowsJson,@snapshotVersion=DatasetVersion,@snapshotTotal=TotalRows FROM gp.AdminExportSnapshots WHERE SnapshotId=@ExportSnapshotId AND OwnerSessionHash=@SessionHash AND QueryHash=@queryHash AND ExpiresAtUtc>@now;
  IF @snapshotRows IS NULL THROW 52003,'Export expired or changed. Restart the export.',1;
  IF @FinishExport=0
  BEGIN
   -- Materialize the bounded slice once. The stable integer order is explicit;
   -- it cannot interact with other ordered aggregates in the full projection.
   DECLARE @slice table(Ordinal int PRIMARY KEY,Data nvarchar(max));
   INSERT @slice SELECT CONVERT(int,j.[key]),j.value FROM OPENJSON(@snapshotRows) j WHERE CONVERT(int,j.[key])>=@snapshotOffset AND CONVERT(int,j.[key])<@snapshotOffset+@PageSize;
   DECLARE @ordinal int=(SELECT MIN(Ordinal) FROM @slice),@piece nvarchar(max);SET @rows=N'[';
   WHILE @ordinal IS NOT NULL
   BEGIN
    SELECT @piece=Data FROM @slice WHERE Ordinal=@ordinal;
    SET @rows=@rows+CASE WHEN LEN(@rows)>1 THEN N',' ELSE N'' END+@piece;
    DELETE @slice WHERE Ordinal=@ordinal;SELECT @ordinal=MIN(Ordinal) FROM @slice;
   END;SET @rows=@rows+N']';
   EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
   IF gp._AdminScopeAllowed(@actor,'VISITS_READ',@LocationId,@ProjectLocationId,@now)=0 OR gp._AdminScopeAllowed(@actor,'REPORTS_EXPORT',@LocationId,@ProjectLocationId,@now)=0 THROW 52001,'Not authorized.',1;
   IF NOT EXISTS(SELECT 1 FROM gp.AdminExportSnapshots WHERE SnapshotId=@ExportSnapshotId AND ExpiresAtUtc>@now) THROW 52003,'Export expired.',1;
   SET @result=(SELECT JSON_QUERY(@rows) rows,@snapshotTotal total,@Page page,@PageSize pageSize,@snapshotVersion datasetVersion,@ExportSnapshotId exportSnapshotId,REPLACE(CONVERT(char(23),@now,121),' ','T')+'Z' checkedAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
   INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,LocationId,ProjectLocationId,ResultCode) VALUES(@actor,'ADMIN_REGISTER_EXPORTED','ADMIN_QUERY',@LocationId,@ProjectLocationId,'SUCCESS');
   COMMIT;SELECT @result;RETURN;
  END;
 END;
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
  DECLARE @pickOffset int=(@Page-1)*@PageSize;
  DELETE FROM #candidateIds WHERE VisitId NOT IN(SELECT v.VisitRequestId FROM #candidateIds c JOIN gp.VisitRequests v ON v.VisitRequestId=c.VisitId ORDER BY
   CASE WHEN @Direction=N'DESC' THEN v.SubmittedAtUtc END DESC,CASE WHEN @Direction=N'ASC' THEN v.SubmittedAtUtc END ASC,v.VisitRequestId ASC OFFSET @pickOffset ROWS FETCH NEXT @PageSize ROWS ONLY);
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
  IF @FinishExport=1 AND(@snapshotVersion<>@datasetVersion OR @snapshotTotal<>@total) THROW 52003,'Visit register changed during export.',1;
 END;
 -- Recheck the session/capabilities after materialization and hashing; never cache authority.
 EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 IF gp._AdminScopeAllowed(@actor,'VISITS_READ',@LocationId,@ProjectLocationId,@now)=0 OR(@ForExport=1 AND gp._AdminScopeAllowed(@actor,'REPORTS_EXPORT',@LocationId,@ProjectLocationId,@now)=0) THROW 52001,'Scope changed during read.',1;

 IF @CreateExportSnapshot=1 AND @total>0
 BEGIN
  DECLARE @snapshotSql nvarchar(max)=N'SET @data=(SELECT * FROM #register ORDER BY '+QUOTENAME(@Sort)+N' '+@Direction+N',visitRequestId ASC FOR JSON PATH,INCLUDE_NULL_VALUES);';
  EXEC sys.sp_executesql @snapshotSql,N'@data nvarchar(max) OUTPUT',@snapshotRows OUTPUT;
  SET @snapshotRows=COALESCE(@snapshotRows,N'[]');
  IF DATALENGTH(@snapshotRows)>33554432 THROW 52003,'Export is too large. Narrow the filters.',1;
  EXEC gp._TakeLock N'gp:export-snapshots','Exclusive';
  IF(SELECT COUNT(*) FROM gp.AdminExportSnapshots)>=4 THROW 52003,'Export capacity busy. Retry shortly.',1;
  SET @ExportSnapshotId=NEWID();
  INSERT gp.AdminExportSnapshots(SnapshotId,OwnerSessionHash,QueryHash,DatasetVersion,TotalRows,RowsJson,ExpiresAtUtc) VALUES(@ExportSnapshotId,@SessionHash,@queryHash,@datasetVersion,@total,@snapshotRows,DATEADD(minute,2,@now));
 END;
 IF @FinishExport=1
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM gp.AdminExportSnapshots WHERE SnapshotId=@ExportSnapshotId AND ExpiresAtUtc>@now) THROW 52003,'Export expired.',1;
  DELETE gp.AdminExportSnapshots WHERE SnapshotId=@ExportSnapshotId;
 END;
 -- Only names from the fixed projection and a validated direction reach this statement. Filter values remain data.
 DECLARE @sql nvarchar(max)=N'SET @rows=COALESCE((SELECT * FROM #register ORDER BY '+QUOTENAME(@Sort)+N' '+@Direction+N',visitRequestId ASC OFFSET @offset ROWS FETCH NEXT @take ROWS ONLY FOR JSON PATH,INCLUDE_NULL_VALUES),N''[]'');';
 DECLARE @offset int=CASE WHEN @late=1 THEN 0 ELSE (@Page-1)*@PageSize END;
 EXEC sys.sp_executesql @sql,N'@offset int,@take int,@rows nvarchar(max) OUTPUT',@offset,@PageSize,@rows OUTPUT;
 SET @result=(SELECT JSON_QUERY(@rows) rows,@total total,@Page page,@PageSize pageSize,@datasetVersion datasetVersion,@ExportSnapshotId exportSnapshotId,CASE WHEN @FinishExport=1 THEN CONVERT(bit,1) END exportValidated,REPLACE(CONVERT(char(23),@now,121),' ','T')+'Z' checkedAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,LocationId,ProjectLocationId,ResultCode) VALUES(@actor,CASE WHEN @ForExport=1 THEN 'ADMIN_REGISTER_EXPORTED' ELSE 'ADMIN_REGISTER_READ' END,'ADMIN_QUERY',@LocationId,@ProjectLocationId,'SUCCESS');
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('107',N'Measured 10k-row export support with bounded 32 MiB snapshots and four-slot global admission');COMMIT;
