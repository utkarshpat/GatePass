/* Visit register: scoped business projection, literal field filters and whitelisted ordering. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54600,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='076') THROW 54600,'Migration 076 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='077') THROW 54600,'Migration 077 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
CREATE PROCEDURE gp.ReadAdminVisitRegister
 @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@FromDate date,@ToDate date,
 @ProjectLocationId bigint=NULL,@FiltersJson nvarchar(max)=N'{}',@Sort nvarchar(200)=N'submittedAtUtc',@Direction nvarchar(200)=N'DESC',@Page int=1
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 54600,'Ambient transaction not accepted.',1;
 DECLARE @fields table(name nvarchar(200) COLLATE Latin1_General_100_BIN2 PRIMARY KEY);
 INSERT @fields VALUES ('localVisitDate'),('submittedAtUtc'),('personName'),('employeeId'),('personEmail'),('personPhone'),('companyName'),('deviceTypes'),('locationName'),('projectName'),('hostName'),('hostEmail'),('requestType'),('reason'),('publicReference'),('publicPassNumber'),('status'),('passStatus'),('presence'),('printStatus'),('returnedAtUtc'),('validFromUtc'),('validUntilUtc');
 IF @LocationId IS NULL OR @LocationId<=0 OR @ProjectLocationId<=0 OR @FromDate IS NULL OR @ToDate IS NULL OR @FromDate>@ToDate OR DATEDIFF(day,@FromDate,@ToDate)>30
 OR @Page IS NULL OR @Page<1 OR @Page>100000 OR @Sort IS NULL OR NOT EXISTS(SELECT 1 FROM @fields WHERE name=@Sort COLLATE Latin1_General_100_BIN2 AND DATALENGTH(name)=DATALENGTH(@Sort))
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
 OR(@ProjectLocationId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gp.ProjectLocations WHERE ProjectLocationId=@ProjectLocationId AND LocationId=@LocationId AND IsActive=1)) THROW 52001,'Not authorized.',1;
 EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 SELECT v.VisitRequestId visitRequestId,CONVERT(char(10),v.LocalVisitDate,23) localVisitDate,
 REPLACE(CONVERT(char(23),v.SubmittedAtUtc,121),' ','T')+'Z' submittedAtUtc,
 v.PersonName personName,v.EmployeeId employeeId,v.PersonEmail personEmail,v.PersonPhone personPhone,v.CompanyName companyName,
 COALESCE((SELECT STRING_AGG(CONVERT(nvarchar(max),j.value),N', ') WITHIN GROUP(ORDER BY j.value) FROM OPENJSON(v.DeviceTypesJson) j),N'') deviceTypes,
 l.LocationName locationName,pj.ProjectName projectName,h.FullName hostName,h.OfficialEmail hostEmail,
 CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END requestType,v.Reason reason,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,
 v.Status status,p.Status passStatus,CASE WHEN gp._PersonInsideOffice(v.VisitRequestId)=1 THEN 'INSIDE' ELSE 'OUTSIDE' END presence,
 CASE WHEN ret.VisitRequestId IS NOT NULL THEN 'RETURNED' WHEN EXISTS(SELECT 1 FROM gp.PassPrintJobs j WHERE j.VisitRequestId=v.VisitRequestId AND j.Status='DISPATCHED') THEN 'PRINTED' ELSE 'NOT_PRINTED' END printStatus,
 REPLACE(CONVERT(char(23),ret.ReturnedAtUtc,121),' ','T')+'Z' returnedAtUtc,
 REPLACE(CONVERT(char(23),v.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc
 INTO #register FROM gp.VisitRequests v JOIN gp.Locations l ON l.LocationId=v.LocationId
 JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1
 LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId LEFT JOIN gp.Projects pj ON pj.ProjectId=pl.ProjectId
 LEFT JOIN gp.Employees h ON h.EmployeeId=v.HostEmployeeId LEFT JOIN gp.PassReturns ret ON ret.VisitRequestId=v.VisitRequestId
 WHERE v.LocationId=@LocationId AND v.LocalVisitDate BETWEEN @FromDate AND @ToDate AND(@ProjectLocationId IS NULL OR v.ProjectLocationId=@ProjectLocationId)
 AND v.PersonalDataPurgedAtUtc IS NULL AND gp._VisitReadAllowed(@actor,'ADMIN',v.VisitRequestId,@now,@cutoff)=1;
 DELETE r FROM #register r WHERE EXISTS(SELECT 1 FROM @filters f WHERE NOT EXISTS(
 SELECT 1 FROM (VALUES (N'localVisitDate',CONVERT(nvarchar(max),r.localVisitDate)),(N'submittedAtUtc',CONVERT(nvarchar(max),r.submittedAtUtc)),(N'personName',CONVERT(nvarchar(max),r.personName)),(N'employeeId',CONVERT(nvarchar(max),r.employeeId)),(N'personEmail',CONVERT(nvarchar(max),r.personEmail)),(N'personPhone',CONVERT(nvarchar(max),r.personPhone)),(N'companyName',CONVERT(nvarchar(max),r.companyName)),(N'deviceTypes',CONVERT(nvarchar(max),r.deviceTypes)),(N'locationName',CONVERT(nvarchar(max),r.locationName)),(N'projectName',CONVERT(nvarchar(max),r.projectName)),(N'hostName',CONVERT(nvarchar(max),r.hostName)),(N'hostEmail',CONVERT(nvarchar(max),r.hostEmail)),(N'requestType',CONVERT(nvarchar(max),r.requestType)),(N'reason',CONVERT(nvarchar(max),r.reason)),(N'publicReference',CONVERT(nvarchar(max),r.publicReference)),(N'publicPassNumber',CONVERT(nvarchar(max),r.publicPassNumber)),(N'status',CONVERT(nvarchar(max),r.status)),(N'passStatus',CONVERT(nvarchar(max),r.passStatus)),(N'presence',CONVERT(nvarchar(max),r.presence)),(N'printStatus',CONVERT(nvarchar(max),r.printStatus)),(N'returnedAtUtc',CONVERT(nvarchar(max),r.returnedAtUtc)),(N'validFromUtc',CONVERT(nvarchar(max),r.validFromUtc)),(N'validUntilUtc',CONVERT(nvarchar(max),r.validUntilUtc))) c(name,value)
 WHERE c.name COLLATE Latin1_General_100_BIN2=f.name AND ((f.name IN('status','passStatus','requestType','presence','printStatus') AND c.value COLLATE Latin1_General_100_BIN2=f.value COLLATE Latin1_General_100_BIN2) OR(f.name NOT IN('status','passStatus','requestType','presence','printStatus') AND CHARINDEX(f.value COLLATE Latin1_General_100_CI_AS,COALESCE(c.value,N'') COLLATE Latin1_General_100_CI_AS)>0))));
 SELECT @total=COUNT(*) FROM #register;
 -- Only names from the fixed projection and a validated direction reach this statement. Filter values remain data.
 DECLARE @sql nvarchar(max)=N'SET @rows=COALESCE((SELECT * FROM #register ORDER BY '+QUOTENAME(@Sort)+N' '+@Direction+N',visitRequestId ASC OFFSET @offset ROWS FETCH NEXT 50 ROWS ONLY FOR JSON PATH,INCLUDE_NULL_VALUES),N''[]'');';
 DECLARE @offset int=(@Page-1)*50;
 EXEC sys.sp_executesql @sql,N'@offset int,@rows nvarchar(max) OUTPUT',@offset,@rows OUTPUT;
 SET @result=(SELECT JSON_QUERY(@rows) rows,@total total,@Page page,50 pageSize,REPLACE(CONVERT(char(23),@now,121),' ','T')+'Z' checkedAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,LocationId,ProjectLocationId,ResultCode) VALUES(@actor,'ADMIN_REGISTER_READ','ADMIN_QUERY',@LocationId,@ProjectLocationId,'SUCCESS');
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON gp.ReadAdminVisitRegister TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('077',N'Scoped admin visit register with field filters, sorting and bounded pages');
COMMIT;
