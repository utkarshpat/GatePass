SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54800,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='093') THROW 54800,'Migration 093 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='094') THROW 54800,'Migration 094 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
ALTER PROCEDURE gp.ReadActionCentre @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@Workspace varchar(12),@LocationId int,@DutyKind varchar(10),@DutyId bigint,
 @Category varchar(20)='PENDING',@AfterSubmittedAtUtc datetime2(3)=NULL,@AfterVisitRequestId uniqueidentifier=NULL AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF @Workspace IS NULL OR @Workspace COLLATE Latin1_General_100_BIN2 NOT IN('GUARD','RECEPTION','ADMIN') OR @DutyKind IS NULL OR @DutyKind COLLATE Latin1_General_100_BIN2 NOT IN('PROJECT','COMMON','OFFICE') OR @LocationId IS NULL OR @DutyId IS NULL
 OR @Category IS NULL OR @Category COLLATE Latin1_General_100_BIN2 NOT IN('PENDING','EXPIRED_INSIDE','UNRETURNED') OR(@AfterSubmittedAtUtc IS NULL AND @AfterVisitRequestId IS NOT NULL) OR(@AfterSubmittedAtUtc IS NOT NULL AND @AfterVisitRequestId IS NULL) THROW 52002,'Invalid action scope.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@result nvarchar(max),@more bit=0,@afterTime datetime2(3),@afterId uniqueidentifier;
 DECLARE @matches table(VisitId uniqueidentifier PRIMARY KEY,Submitted datetime2(3),Pending bit,ExpiredInside bit,Unreturned bit);
 DECLARE @page table(VisitId uniqueidentifier PRIMARY KEY,Submitted datetime2(3));
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF gp._OperationsScopeAllowed(@actor,@Workspace,@LocationId,@DutyKind,@DutyId,@now)=0 THROW 52001,'Not authorized.',1;
 INSERT @matches SELECT v.VisitRequestId,v.SubmittedAtUtc,flags.Pending,flags.ExpiredInside,flags.Unreturned FROM gp.VisitRequests v
 JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId
 CROSS APPLY(SELECT CONVERT(bit,CASE WHEN @Workspace<>'GUARD' THEN gp._PersonInsideOffice(v.VisitRequestId) WHEN @DutyKind='COMMON' THEN 0 WHEN v.RequestType='TEMP_ID' THEN CASE WHEN EXISTS(SELECT 1 FROM gp.EmployeeProjectPresence ep WHERE ep.VisitRequestId=v.VisitRequestId AND ep.ProjectLocationId=@DutyId AND ep.IsInside=1) THEN 1 ELSE 0 END ELSE s.IsInside END) Inside) x
 CROSS APPLY(SELECT CONVERT(bit,CASE WHEN v.Status='PENDING' AND p.Status='PENDING' AND v.ValidUntilUtc>@now AND v.SubmittedAtUtc<=DATEADD(minute,-15,@now) AND NOT EXISTS(SELECT 1 FROM gp.PassReturns WHERE VisitRequestId=v.VisitRequestId) THEN 1 ELSE 0 END) Pending,
 CONVERT(bit,CASE WHEN x.Inside=1 AND v.ValidUntilUtc<=@now THEN 1 ELSE 0 END) ExpiredInside,
 CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM gp.PassPrintJobs WHERE VisitRequestId=v.VisitRequestId AND Status='DISPATCHED') AND NOT EXISTS(SELECT 1 FROM gp.PassReturns WHERE VisitRequestId=v.VisitRequestId) THEN 1 ELSE 0 END) Unreturned) flags
 WHERE v.LocationId=@LocationId AND(flags.Pending=1 OR flags.ExpiredInside=1 OR flags.Unreturned=1)
 AND(@Workspace='GUARD' AND gp._GuardDutyVisitAllowed(@actor,@DutyKind,@DutyId,@LocationId,v.VisitRequestId,@cutoff,@now)=1
 OR @Workspace='RECEPTION' AND gp._VisitReadAllowed(@actor,'RECEPTION',v.VisitRequestId,@now,@cutoff)=1
 OR @Workspace='ADMIN' AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',v.LocationId,v.ProjectLocationId,@now)=1);
 INSERT @page SELECT TOP(25) VisitId,Submitted FROM @matches WHERE(@Category='PENDING' AND Pending=1 OR @Category='EXPIRED_INSIDE' AND ExpiredInside=1 OR @Category='UNRETURNED' AND Unreturned=1)
 AND(@AfterSubmittedAtUtc IS NULL OR Submitted<@AfterSubmittedAtUtc OR Submitted=@AfterSubmittedAtUtc AND VisitId<@AfterVisitRequestId) ORDER BY Submitted DESC,VisitId DESC;
 IF(SELECT COUNT(*) FROM @page)>24 BEGIN SET @more=1;DELETE @page WHERE VisitId=(SELECT TOP(1) VisitId FROM @page ORDER BY Submitted,VisitId);END;
 IF @more=1 SELECT TOP(1) @afterTime=Submitted,@afterId=VisitId FROM @page ORDER BY Submitted,VisitId;
 EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 IF gp._OperationsScopeAllowed(@actor,@Workspace,@LocationId,@DutyKind,@DutyId,@now)=0 THROW 52001,'Scope changed.',1;
 EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF EXISTS(SELECT 1 FROM @matches m JOIN gp.VisitRequests v ON v.VisitRequestId=m.VisitId WHERE
 (@Workspace='GUARD' AND gp._GuardDutyVisitAllowed(@actor,@DutyKind,@DutyId,@LocationId,v.VisitRequestId,@cutoff,@now)=0)
 OR(@Workspace='RECEPTION' AND gp._VisitReadAllowed(@actor,'RECEPTION',v.VisitRequestId,@now,@cutoff)=0)
 OR(@Workspace='ADMIN' AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',v.LocationId,v.ProjectLocationId,@now)=0)) THROW 52001,'Scope changed during read.',1;
 SET @result=(SELECT @Category category,REPLACE(CONVERT(char(23),@now,121),' ','T')+'Z' checkedAtUtc,
 JSON_QUERY((SELECT COALESCE(SUM(CONVERT(int,Pending)),0) pending,COALESCE(SUM(CONVERT(int,ExpiredInside)),0) expiredInside,COALESCE(SUM(CONVERT(int,Unreturned)),0) unreturned FROM @matches FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) counts,
 JSON_QUERY((SELECT v.VisitRequestId visitRequestId,v.PersonName personName,CONVERT(char(10),v.LocalVisitDate,23) visitDate,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,
 REPLACE(CONVERT(char(23),q.Submitted,121),' ','T')+'Z' submittedAtUtc FROM @page q JOIN gp.VisitRequests v ON v.VisitRequestId=q.VisitId JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 ORDER BY q.Submitted DESC,q.VisitId DESC FOR JSON PATH)) items,
 @more hasMore,@afterId afterVisitRequestId,REPLACE(CONVERT(char(23),@afterTime,121),' ','T')+'Z' afterSubmittedAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,LocationId,ProjectLocationId,ResultCode) VALUES(@actor,'ACTION_CENTRE_READ','REPORT_QUERY',@LocationId,CASE WHEN @DutyKind='PROJECT' THEN @DutyId END,'SUCCESS');
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
ALTER PROCEDURE gp.ReadReceptionQueue @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@LocalVisitDate date=NULL,
 @Search nvarchar(100)=NULL,@Status varchar(12)='ALL',@AfterSubmittedAtUtc datetime2(3)=NULL,@AfterVisitRequestId uniqueidentifier=NULL,@PendingReturns bit=0,@TypeFilter varchar(12)='ALL',@PrintFilter varchar(20)='ALL',@InsideOnly bit=0
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 53500,'Ambient transaction not accepted.',1;
 IF @InsideOnly IS NULL OR @TypeFilter IS NULL OR @TypeFilter COLLATE Latin1_General_100_BIN2 NOT IN('ALL','EMPLOYEE','VISITOR') OR @PrintFilter IS NULL OR @PrintFilter COLLATE Latin1_General_100_BIN2 NOT IN('ALL','PRINTED','UNPRINTED','PENDING_RETURN','RETURNED') OR @PendingReturns IS NULL OR @LocationId IS NULL OR @LocationId<=0 OR @Status IS NULL OR @Status COLLATE Latin1_General_100_BIN2 NOT IN('ALL','PENDING','APPROVED','DENIED','CANCELLED','REVOKED','EXPIRED')
  OR (@AfterSubmittedAtUtc IS NULL AND @AfterVisitRequestId IS NOT NULL) OR (@AfterSubmittedAtUtc IS NOT NULL AND @AfterVisitRequestId IS NULL) THROW 53502,'Invalid reception filter.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@today date,@cutoff datetime2(3),@result nvarchar(max);
 BEGIN TRY
  BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
  EXEC gp._RequireReceptionLocation @actor,@LocationId,@now;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
  SET @today=CONVERT(date,DATEADD(minute,330,@now));SET @LocalVisitDate=COALESCE(@LocalVisitDate,@today);
  IF @LocalVisitDate<DATEADD(day,-30,@today) OR @LocalVisitDate>DATEADD(day,90,@today) THROW 53502,'Date outside operational range.',1;
  SET @Search=NULLIF(LTRIM(RTRIM(@Search)),N'');
  DECLARE @matches table(VisitId uniqueidentifier PRIMARY KEY,Submitted datetime2(3),EmployeeId nvarchar(64),Inside bit,Pending bit);
  INSERT @matches SELECT v.VisitRequestId,v.SubmittedAtUtc,v.EmployeeId,x.Inside,CONVERT(bit,CASE WHEN v.Status='PENDING' AND ret.VisitRequestId IS NULL AND p.Status='PENDING' AND v.ValidUntilUtc>@now THEN 1 ELSE 0 END)
  FROM gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 LEFT JOIN gp.PassReturns ret ON ret.VisitRequestId=v.VisitRequestId
  CROSS APPLY(SELECT gp._PersonInsideOffice(v.VisitRequestId) Inside,(SELECT COUNT(*) FROM gp.PassPrintJobs j WHERE j.VisitRequestId=v.VisitRequestId AND j.Status='DISPATCHED') Printed) x
  CROSS APPLY(SELECT CASE WHEN v.Status='CANCELLED' THEN 'CANCELLED' WHEN ret.VisitRequestId IS NULL AND p.Status='REVOKED' THEN 'REVOKED' WHEN v.ValidUntilUtc<=@now THEN 'EXPIRED' ELSE v.Status END State) e
  WHERE v.LocationId=@LocationId AND(@PendingReturns=1 OR v.LocalVisitDate=@LocalVisitDate) AND gp._VisitReadAllowed(@actor,'RECEPTION',v.VisitRequestId,@now,@cutoff)=1
  AND(@PendingReturns=0 OR ret.VisitRequestId IS NULL AND x.Printed>0)
  AND(@Status='ALL' OR @Status='PENDING' AND v.Status='PENDING' AND ret.VisitRequestId IS NULL AND p.Status='PENDING' AND v.ValidUntilUtc>@now OR @Status<>'PENDING' AND e.State=@Status)
  AND(@Search IS NULL OR CHARINDEX(@Search,v.PersonName)>0 OR CHARINDEX(@Search,v.PublicReference)>0 OR CHARINDEX(@Search,p.PublicPassNumber)>0 OR CHARINDEX(@Search,v.EmployeeId)>0)
  AND(@TypeFilter='ALL' OR @TypeFilter='VISITOR' AND v.RequestType='EXTERNAL' OR @TypeFilter='EMPLOYEE' AND v.RequestType<>'EXTERNAL')
  AND(@PrintFilter='ALL' OR @PrintFilter='PRINTED' AND x.Printed>0 OR @PrintFilter='UNPRINTED' AND x.Printed=0 OR @PrintFilter='PENDING_RETURN' AND x.Printed>0 AND ret.VisitRequestId IS NULL OR @PrintFilter='RETURNED' AND ret.VisitRequestId IS NOT NULL)
  AND(@InsideOnly=0 OR x.Inside=1);
  DECLARE @page table(VisitId uniqueidentifier PRIMARY KEY,Submitted datetime2(3));
  INSERT @page SELECT TOP(51) VisitId,Submitted FROM @matches WHERE @AfterSubmittedAtUtc IS NULL OR Submitted<@AfterSubmittedAtUtc OR Submitted=@AfterSubmittedAtUtc AND VisitId<@AfterVisitRequestId ORDER BY Submitted DESC,VisitId DESC;
  DECLARE @more bit=CASE WHEN (SELECT COUNT(*) FROM @page)>50 THEN 1 ELSE 0 END,@afterTime datetime2(3),@afterId uniqueidentifier;
  IF @more=1 DELETE @page WHERE VisitId=(SELECT TOP(1) VisitId FROM @page ORDER BY Submitted,VisitId);
  IF @more=1 SELECT TOP(1) @afterTime=Submitted,@afterId=VisitId FROM @page ORDER BY Submitted,VisitId;
  EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._RequireReceptionLocation @actor,@LocationId,@now;
  SET @result=(SELECT JSON_QUERY(COALESCE((SELECT v.VisitRequestId visitRequestId,v.PersonName personName,v.CompanyName companyName,JSON_QUERY(v.DeviceTypesJson) deviceTypes,v.EmployeeId employeeId,
    CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END requestType,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,
    p.AccessPassId accessPassId,v.Status status,p.Status passStatus,pj.ProjectName projectName,he.FullName hostName,he.OfficialEmail hostEmail,JSON_QUERY(CASE WHEN v.RequestType='TEMP_ID' THEN gp._EmployeeProjectSummary(v.EmployeeId,@cutoff,@now,v.LocationId) END) employeeProjects,CONVERT(bit,CASE WHEN gp._PersonInsideOffice(v.VisitRequestId)=1 THEN 1 ELSE 0 END) isInside,
    REPLACE(CONVERT(char(23),v.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc,
    REPLACE(CONVERT(char(23),n.Submitted,121),' ','T')+'Z' submittedAtUtc,
    REPLACE(CONVERT(char(23),ret.ReturnedAtUtc,121),' ','T')+'Z' returnedAtUtc,
    (SELECT COUNT(*) FROM gp.PassPrintJobs j WHERE j.VisitRequestId=v.VisitRequestId AND j.Status='DISPATCHED') printCount
    FROM @page n JOIN gp.VisitRequests v ON v.VisitRequestId=n.VisitId JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1
    JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId LEFT JOIN gp.PassReturns ret ON ret.VisitRequestId=v.VisitRequestId LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId
    LEFT JOIN gp.Projects pj ON pj.ProjectId=pl.ProjectId LEFT JOIN gp.Employees he ON he.EmployeeId=v.HostEmployeeId AND he.IsActive=1 AND he.LastSyncedAtUtc BETWEEN @cutoff AND @now ORDER BY n.Submitted DESC,n.VisitId DESC FOR JSON PATH),N'[]')) visits,
    (SELECT COUNT(*) FROM gp.VisitRequests rv WHERE rv.LocationId=@LocationId AND gp._VisitReadAllowed(@actor,'RECEPTION',rv.VisitRequestId,@now,@cutoff)=1 AND NOT EXISTS(SELECT 1 FROM gp.PassReturns r WHERE r.VisitRequestId=rv.VisitRequestId) AND EXISTS(SELECT 1 FROM gp.PassPrintJobs j WHERE j.VisitRequestId=rv.VisitRequestId AND j.Status='DISPATCHED')) pendingReturnCount,
    JSON_QUERY((SELECT COUNT(*) total,COALESCE(SUM(CONVERT(int,Pending)),0) pending,(SELECT COUNT(*) FROM(SELECT DISTINCT CASE WHEN EmployeeId IS NULL THEN N'visit:'+CONVERT(nvarchar(64),VisitId) ELSE N'employee:'+EmployeeId END Person FROM @matches WHERE Inside=1) i) inside FROM @matches FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) counts,
    @more hasMore,@afterId afterVisitRequestId,REPLACE(CONVERT(char(23),@afterTime,121),' ','T')+'Z' afterSubmittedAtUtc,
    CONVERT(char(10),@LocalVisitDate,23) visitDate FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ResultCode) VALUES(@actor,'RECEPTION_QUEUE_READ','LOCATION',CONVERT(varchar(12),@LocationId),@LocationId,'SUCCESS');
  COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;

GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('094',N'Fresh per-record action scope fencing and dated follow-up navigation');COMMIT;
