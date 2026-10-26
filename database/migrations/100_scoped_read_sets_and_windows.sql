/* Request-local authorization sets and bounded refresh/export windows.
   Existing single-record/movement policies and role permissions remain unchanged. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54800,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='099') THROW 54800,'Migration 099 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='100') THROW 54800,'Migration 100 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
ALTER PROCEDURE gp.GetOperationalSummaryRange
 @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@FromDate date,@ToDate date,@ProjectLocationId bigint=NULL
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF @LocationId IS NULL OR @LocationId<=0 OR @FromDate IS NULL OR @ToDate IS NULL OR @FromDate>@ToDate OR DATEDIFF(day,@FromDate,@ToDate)>30 OR @ProjectLocationId<=0 THROW 52002,'Invalid report scope or range.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@today date,@day date,@result nvarchar(max);
 DECLARE @days table(Day date PRIMARY KEY);
 DECLARE @daily table(Day date PRIMARY KEY,Total bigint,Pending bigint,Approved bigint,Denied bigint,Cancelled bigint);
 DECLARE @rows table(LocationId int,Pair bigint NULL,Day date,Kind varchar(24),State varchar(12),Inside bit);
 DECLARE @occupants table(EmployeeId nvarchar(64),Pair bigint,LocationId int);
 DECLARE @scopes table(LocationId int,Pair bigint NULL,Allowed bit NOT NULL);
 BEGIN TRY
  BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._RequireAdminReadCapability @actor,'REPORTS_READ',@now;
  IF NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@LocationId) OR(@ProjectLocationId IS NOT NULL AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',@LocationId,@ProjectLocationId,@now)=0)
   OR(@ProjectLocationId IS NULL AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',@LocationId,NULL,@now)=0 AND NOT EXISTS(SELECT 1 FROM gp.ProjectLocations pl WHERE pl.LocationId=@LocationId AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',@LocationId,pl.ProjectLocationId,@now)=1)) THROW 52001,'Not authorized for report scope.',1;
  SET @today=CONVERT(date,DATEADD(minute,330,@now));
  IF @FromDate<DATEADD(day,-30,@today) OR @ToDate>DATEADD(day,90,@today) THROW 52002,'Report range outside operational bounds.',1;
  SET @day=@FromDate;WHILE @day<=@ToDate BEGIN INSERT @days VALUES(@day);SET @day=DATEADD(day,1,@day);END;
  INSERT @rows SELECT v.LocationId,v.ProjectLocationId,v.LocalVisitDate,v.RequestType,v.Status,p.IsInside FROM gp.VisitRequests v JOIN gp.VisitPresence p ON p.VisitRequestId=v.VisitRequestId
   WHERE v.LocationId=@LocationId AND(@ProjectLocationId IS NULL OR v.ProjectLocationId=@ProjectLocationId)
   AND(v.LocalVisitDate BETWEEN @FromDate AND @ToDate OR p.IsInside=1);
  INSERT @occupants SELECT DISTINCT ep.EmployeeId,ep.ProjectLocationId,pl.LocationId FROM gp.EmployeeProjectPresence ep JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=ep.ProjectLocationId
   WHERE ep.IsInside=1 AND pl.LocationId=@LocationId AND(@ProjectLocationId IS NULL OR ep.ProjectLocationId=@ProjectLocationId);
  -- Policy is constant within a location/project scope, not a visit row.
  INSERT @scopes SELECT LocationId,Pair,0 FROM @rows GROUP BY LocationId,Pair
   UNION SELECT LocationId,Pair,0 FROM @occupants GROUP BY LocationId,Pair;
  UPDATE @scopes SET Allowed=gp._AdminScopeAllowed(@actor,'REPORTS_READ',LocationId,Pair,@now);
  DELETE r FROM @rows r WHERE NOT EXISTS(SELECT 1 FROM @scopes s WHERE s.Allowed=1 AND s.LocationId=r.LocationId AND(s.Pair=r.Pair OR s.Pair IS NULL AND r.Pair IS NULL));
  DELETE r FROM @occupants r WHERE NOT EXISTS(SELECT 1 FROM @scopes s WHERE s.Allowed=1 AND s.LocationId=r.LocationId AND s.Pair=r.Pair);
  INSERT @daily SELECT Day,COUNT_BIG(*),COUNT_BIG(CASE WHEN State='PENDING' THEN 1 END),COUNT_BIG(CASE WHEN State='APPROVED' THEN 1 END),COUNT_BIG(CASE WHEN State='DENIED' THEN 1 END),COUNT_BIG(CASE WHEN State='CANCELLED' THEN 1 END)
   FROM @rows WHERE Day BETWEEN @FromDate AND @ToDate GROUP BY Day;
  -- Recheck authority and the complete materialized scopes before returning any counts.
  EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._RequireAdminReadCapability @actor,'REPORTS_READ',@now;
  IF(@ProjectLocationId IS NOT NULL AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',@LocationId,@ProjectLocationId,@now)=0)
   OR(@ProjectLocationId IS NULL AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',@LocationId,NULL,@now)=0 AND NOT EXISTS(SELECT 1 FROM gp.ProjectLocations pl WHERE pl.LocationId=@LocationId AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',@LocationId,pl.ProjectLocationId,@now)=1)) THROW 52001,'Not authorized for report scope.',1;
  IF EXISTS(SELECT 1 FROM @scopes WHERE Allowed=1 AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',LocationId,Pair,@now)=0) THROW 52001,'Scope changed during read.',1;
  SET @result=(SELECT @FromDate [from],@ToDate [to],
   JSON_QUERY((SELECT CONVERT(varchar(20),COALESCE(SUM(Total),0)) total,CONVERT(varchar(20),COALESCE(SUM(Pending),0)) pending,
    CONVERT(varchar(20),COALESCE(SUM(Approved),0)) approved,CONVERT(varchar(20),COALESCE(SUM(Denied),0)) denied,
    CONVERT(varchar(20),COALESCE(SUM(Cancelled),0)) cancelled FROM @daily FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) visits,
   JSON_QUERY((SELECT d.Day localVisitDate,JSON_QUERY((SELECT CONVERT(varchar(20),COALESCE(r.Total,0)) total,CONVERT(varchar(20),COALESCE(r.Pending,0)) pending,
    CONVERT(varchar(20),COALESCE(r.Approved,0)) approved,CONVERT(varchar(20),COALESCE(r.Denied,0)) denied,
    CONVERT(varchar(20),COALESCE(r.Cancelled,0)) cancelled FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) visits FROM @days d LEFT JOIN @daily r ON r.Day=d.Day ORDER BY d.Day FOR JSON PATH)) days,
   JSON_QUERY((SELECT CONVERT(varchar(20),COUNT_BIG(CASE WHEN Kind<>'TEMP_ID' AND Inside=1 THEN 1 END)) projectVisitsInside,
    (SELECT CONVERT(varchar(20),COUNT_BIG(*)) FROM(SELECT DISTINCT EmployeeId FROM @occupants) e) digitalIdsInside FROM @rows FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) recordedPresence,
   REPLACE(CONVERT(char(23),@now,121),' ','T')+'Z' checkedAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,LocationId,ProjectLocationId,ResultCode,MetadataJson)
   VALUES(@actor,'OPERATIONAL_SUMMARY_RANGE_READ','REPORT_QUERY',@LocationId,@ProjectLocationId,'SUCCESS',(SELECT @FromDate [from],@ToDate [to] FOR JSON PATH,WITHOUT_ARRAY_WRAPPER));
  COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
ALTER PROCEDURE gp.ReadGuardQueue @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@DutyKind varchar(10),@DutyId bigint=NULL,
 @Queue varchar(10),@Search nvarchar(100)=N'',@AfterSubmittedAtUtc datetime2(3)=NULL,@AfterVisitRequestId uniqueidentifier=NULL,@Take int=24 AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF @Take IS NULL OR @Take<24 OR @Take>240 OR @LocationId IS NULL OR @LocationId<=0 OR @DutyKind IS NULL OR @DutyKind COLLATE Latin1_General_100_BIN2 NOT IN('ALL','PROJECT','COMMON')
 OR(@DutyKind='ALL' AND @DutyId IS NOT NULL) OR(@DutyKind<>'ALL' AND(@DutyId IS NULL OR @DutyId<=0)) OR @Queue IS NULL OR @Queue COLLATE Latin1_General_100_BIN2 NOT IN('EXPECTED','INSIDE')
 OR(@DutyKind='COMMON' AND @Queue='INSIDE') OR @Search IS NULL OR(@AfterSubmittedAtUtc IS NULL AND @AfterVisitRequestId IS NOT NULL) OR(@AfterSubmittedAtUtc IS NOT NULL AND @AfterVisitRequestId IS NULL) THROW 52002,'Invalid queue.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@result nvarchar(max),@more bit=0,@afterTime datetime2(3),@afterId uniqueidentifier;
 DECLARE @duties table(Kind varchar(10),DutyId bigint,Name nvarchar(200),PRIMARY KEY(Kind,DutyId));
 DECLARE @matches table(VisitId uniqueidentifier,Kind varchar(10),DutyId bigint,PRIMARY KEY(VisitId,Kind,DutyId));
 DECLARE @page table(VisitId uniqueidentifier PRIMARY KEY,Submitted datetime2(3));
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId WHERE g.UserId=@actor AND g.RoleCode='GUARD' AND g.ScopeType='LOCATION' AND g.LocationId=@LocationId
 AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@now AND(g.ValidUntilUtc IS NULL OR @now<g.ValidUntilUtc) AND c.CapabilityCode='VISITS_READ') THROW 52001,'Not authorized.',1;
 INSERT @duties SELECT DISTINCT 'PROJECT',pl.ProjectLocationId,p.ProjectName FROM gp.GuardAssignments a JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=a.ProjectLocationId JOIN gp.Projects p ON p.ProjectId=pl.ProjectId
 WHERE a.GuardUserId=@actor AND pl.LocationId=@LocationId AND(@DutyKind='ALL' OR @DutyKind='PROJECT' AND pl.ProjectLocationId=@DutyId) AND gp._GuardDutyAssigned(@actor,'PROJECT',pl.ProjectLocationId,@LocationId,@now)=1
 UNION ALL SELECT DISTINCT 'COMMON',c.CommonAreaId,c.AreaName FROM gp.GuardCommonAreaAssignments a JOIN gp.CommonAreas c ON c.CommonAreaId=a.CommonAreaId
 WHERE a.GuardUserId=@actor AND c.LocationId=@LocationId AND(@DutyKind='ALL' OR @DutyKind='COMMON' AND c.CommonAreaId=@DutyId) AND gp._GuardDutyAssigned(@actor,'COMMON',c.CommonAreaId,@LocationId,@now)=1;
 IF NOT EXISTS(SELECT 1 FROM @duties) THROW 52001,'No current duty.',1;
 IF(SELECT COUNT(*) FROM @duties)>500 THROW 52003,'Duty roster too large.',1;
 -- Resolve row-independent duty policy once; keep employee policy request-local.
 DECLARE @base table(VisitId uniqueidentifier PRIMARY KEY,Pair bigint NULL,EmployeeId nvarchar(64) COLLATE DATABASE_DEFAULT NULL,Kind varchar(24),Submitted datetime2(3),Inside bit,SearchMatch bit);
 DECLARE @eligible table(EmployeeId nvarchar(64) COLLATE DATABASE_DEFAULT,DutyId bigint,Allowed bit,PRIMARY KEY(EmployeeId,DutyId));
 INSERT @base SELECT v.VisitRequestId,v.ProjectLocationId,v.EmployeeId,v.RequestType,v.SubmittedAtUtc,s.IsInside,
 CONVERT(bit,CASE WHEN @Search=N'' OR CHARINDEX(@Search,v.PersonName COLLATE Latin1_General_100_CI_AI)>0 OR CHARINDEX(@Search,v.PublicReference)>0 OR CHARINDEX(@Search,p.PublicPassNumber)>0 THEN 1 ELSE 0 END)
 FROM gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId
 WHERE v.LocationId=@LocationId AND v.PersonalDataPurgedAtUtc IS NULL
 AND((@Queue='EXPECTED' AND v.LocalVisitDate=CONVERT(date,DATEADD(minute,330,@now)) AND v.Status IN('PENDING','APPROVED') AND p.Status IN('PENDING','ACTIVE') AND v.ValidUntilUtc>@now) OR @Queue='INSIDE')
 AND(@Search=N'' OR CHARINDEX(@Search,v.PersonName COLLATE Latin1_General_100_CI_AI)>0 OR CHARINDEX(@Search,v.PublicReference)>0 OR CHARINDEX(@Search,p.PublicPassNumber)>0 OR EXISTS(SELECT 1 FROM @duties WHERE CHARINDEX(@Search,Name COLLATE Latin1_General_100_CI_AI)>0))
 AND EXISTS(SELECT 1 FROM @duties d WHERE d.Kind='COMMON' OR v.ProjectLocationId=d.DutyId OR v.RequestType='TEMP_ID');
 INSERT @eligible SELECT DISTINCT b.EmployeeId,d.DutyId,0 FROM @base b CROSS JOIN @duties d WHERE b.Kind='TEMP_ID' AND b.EmployeeId IS NOT NULL AND d.Kind='PROJECT';
 UPDATE e SET Allowed=gp._EmployeeProjectLocationEligible(e.EmployeeId,e.DutyId,@cutoff,@now) FROM @eligible e;
 INSERT @matches SELECT b.VisitId,d.Kind,d.DutyId FROM @base b JOIN @duties d ON d.Kind='COMMON' OR b.Pair=d.DutyId OR b.Kind='TEMP_ID'
 LEFT JOIN @eligible e ON e.EmployeeId=b.EmployeeId AND e.DutyId=d.DutyId AND d.Kind='PROJECT'
 LEFT JOIN gp.EmployeeProjectPresence ep ON ep.EmployeeId=b.EmployeeId AND ep.ProjectLocationId=d.DutyId AND ep.IsInside=1 AND d.Kind='PROJECT'
 WHERE(d.Kind='COMMON' OR b.Pair=d.DutyId OR b.Kind='TEMP_ID' AND(e.Allowed=1 OR ep.IsInside=1))
 AND(b.SearchMatch=1 OR CHARINDEX(@Search,d.Name COLLATE Latin1_General_100_CI_AI)>0)
 AND((@Queue='EXPECTED' AND(d.Kind='COMMON' OR CASE WHEN b.Kind='TEMP_ID' THEN COALESCE(ep.IsInside,0) ELSE b.Inside END=0))
 OR(@Queue='INSIDE' AND d.Kind='PROJECT' AND(b.Kind<>'TEMP_ID' OR ep.VisitRequestId=b.VisitId) AND CASE WHEN b.Kind='TEMP_ID' THEN COALESCE(ep.IsInside,0) ELSE b.Inside END=1
 AND((b.Kind='TEMP_ID' AND EXISTS(SELECT 1 FROM gp.EmployeeProjectAccessEvents x WHERE x.AccessEventId=ep.LastEventId AND x.ActorUserId=@actor AND x.EventType='ENTRY'))
 OR(b.Kind<>'TEMP_ID' AND EXISTS(SELECT 1 FROM gp.VisitPresence vp JOIN gp.AccessEvents x ON x.AccessEventId=vp.LastAccessEventId WHERE vp.VisitRequestId=b.VisitId AND x.ActorUserId=@actor AND x.EventType='ENTRY')))));
 INSERT @page SELECT TOP(@Take+1) v.VisitRequestId,v.SubmittedAtUtc FROM gp.VisitRequests v WHERE EXISTS(SELECT 1 FROM @matches m WHERE m.VisitId=v.VisitRequestId)
 AND(@AfterSubmittedAtUtc IS NULL OR v.SubmittedAtUtc<@AfterSubmittedAtUtc OR v.SubmittedAtUtc=@AfterSubmittedAtUtc AND v.VisitRequestId<@AfterVisitRequestId) ORDER BY v.SubmittedAtUtc DESC,v.VisitRequestId DESC;
 IF(SELECT COUNT(*) FROM @page)>@Take BEGIN SET @more=1;DELETE @page WHERE VisitId=(SELECT TOP(1) VisitId FROM @page ORDER BY Submitted,VisitId);END;
 IF @more=1 SELECT TOP(1) @afterTime=Submitted,@afterId=VisitId FROM @page ORDER BY Submitted,VisitId;
 EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 IF EXISTS(SELECT 1 FROM @duties WHERE gp._GuardDutyAssigned(@actor,Kind,DutyId,@LocationId,@now)=0) THROW 52001,'Scope changed.',1;
 EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 UPDATE e SET Allowed=gp._EmployeeProjectLocationEligible(e.EmployeeId,e.DutyId,@cutoff,@now) FROM @eligible e;
 IF EXISTS(SELECT 1 FROM @matches m JOIN @duties d ON d.Kind=m.Kind AND d.DutyId=m.DutyId LEFT JOIN gp.VisitRequests v ON v.VisitRequestId=m.VisitId
 LEFT JOIN @eligible e ON e.EmployeeId=v.EmployeeId AND e.DutyId=d.DutyId
 WHERE v.VisitRequestId IS NULL OR v.PersonalDataPurgedAtUtc IS NOT NULL OR v.LocationId<>@LocationId OR CASE WHEN d.Kind='COMMON' OR v.ProjectLocationId=d.DutyId OR v.RequestType='TEMP_ID' AND(e.Allowed=1 OR EXISTS(SELECT 1 FROM gp.EmployeeProjectPresence ep WHERE ep.EmployeeId=v.EmployeeId AND ep.ProjectLocationId=d.DutyId AND ep.IsInside=1)) THEN 1 ELSE 0 END=0) THROW 52001,'Scope changed during read.',1;
 SET @result=(SELECT JSON_QUERY((SELECT v.VisitRequestId visitRequestId,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,v.PersonName personName,
 CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END requestType,pj.ProjectName projectName,he.FullName hostName,
 JSON_QUERY(CASE WHEN v.RequestType='TEMP_ID' THEN gp._EmployeeProjectSummary(v.EmployeeId,@cutoff,@now,v.LocationId) END) employeeProjects,
 JSON_QUERY((SELECT d.Kind kind,CONVERT(varchar(20),d.DutyId) dutyId,d.Name name FROM @matches m JOIN @duties d ON d.Kind=m.Kind AND d.DutyId=m.DutyId WHERE m.VisitId=v.VisitRequestId ORDER BY d.Kind DESC,d.DutyId FOR JSON PATH)) allocations,
 v.Status status,p.Status passStatus,CONVERT(bit,CASE WHEN @Queue='INSIDE' THEN 1 ELSE 0 END) isInside,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc,
 REPLACE(CONVERT(char(23),q.Submitted,121),' ','T')+'Z' submittedAtUtc,CONVERT(bit,CASE WHEN ph.PurgedAtUtc IS NULL AND ph.StorageKey IS NOT NULL THEN 1 ELSE 0 END) photoAvailable
 FROM @page q JOIN gp.VisitRequests v ON v.VisitRequestId=q.VisitId JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 JOIN gp.PhotoAssets ph ON ph.PhotoAssetId=v.PhotoAssetId
 LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=COALESCE((SELECT TOP(1) DutyId FROM @matches WHERE VisitId=v.VisitRequestId AND Kind='PROJECT' ORDER BY DutyId),v.ProjectLocationId)
 LEFT JOIN gp.Projects pj ON pj.ProjectId=pl.ProjectId LEFT JOIN gp.Employees he ON he.EmployeeId=v.HostEmployeeId ORDER BY q.Submitted DESC,q.VisitId DESC FOR JSON PATH)) visitors,
 (SELECT COUNT(*) FROM(SELECT DISTINCT VisitId FROM @matches) m) total,@more hasMore,@afterId afterVisitRequestId,REPLACE(CONVERT(char(23),@afterTime,121),' ','T')+'Z' afterSubmittedAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
ALTER PROCEDURE gp.ReadActionCentre @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@Workspace varchar(12),@LocationId int,@DutyKind varchar(10),@DutyId bigint,
 @Category varchar(20)='PENDING',@AfterSubmittedAtUtc datetime2(3)=NULL,@AfterVisitRequestId uniqueidentifier=NULL,@Take int=24 AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF @Take IS NULL OR @Take<24 OR @Take>240 OR @Workspace IS NULL OR @Workspace COLLATE Latin1_General_100_BIN2 NOT IN('GUARD','RECEPTION','ADMIN') OR @DutyKind IS NULL OR @DutyKind COLLATE Latin1_General_100_BIN2 NOT IN('PROJECT','COMMON','OFFICE') OR @LocationId IS NULL OR @DutyId IS NULL
 OR @Category IS NULL OR @Category COLLATE Latin1_General_100_BIN2 NOT IN('PENDING','EXPIRED_INSIDE','UNRETURNED') OR(@AfterSubmittedAtUtc IS NULL AND @AfterVisitRequestId IS NOT NULL) OR(@AfterSubmittedAtUtc IS NOT NULL AND @AfterVisitRequestId IS NULL) THROW 52002,'Invalid action scope.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@result nvarchar(max),@more bit=0,@afterTime datetime2(3),@afterId uniqueidentifier;
 DECLARE @matches table(VisitId uniqueidentifier PRIMARY KEY,Submitted datetime2(3),Pending bit,ExpiredInside bit,Unreturned bit);
 DECLARE @page table(VisitId uniqueidentifier PRIMARY KEY,Submitted datetime2(3));
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF gp._OperationsScopeAllowed(@actor,@Workspace,@LocationId,@DutyKind,@DutyId,@now)=0 THROW 52001,'Not authorized.',1;
 IF @Workspace='GUARD' AND @Category='UNRETURNED' THROW 52001,'Return follow-ups belong to reception.',1;
 DECLARE @eligible table(EmployeeId nvarchar(64) COLLATE DATABASE_DEFAULT PRIMARY KEY,Allowed bit);
 DECLARE @scopes table(Pair bigint NULL,Allowed bit);
 IF @Workspace='GUARD' AND @DutyKind='PROJECT'
 BEGIN
  INSERT @eligible SELECT DISTINCT EmployeeId,0 FROM gp.VisitRequests WHERE LocationId=@LocationId AND RequestType='TEMP_ID' AND EmployeeId IS NOT NULL AND PersonalDataPurgedAtUtc IS NULL;
  UPDATE @eligible SET Allowed=gp._EmployeeProjectLocationEligible(EmployeeId,@DutyId,@cutoff,@now);
 END;
 IF @Workspace='ADMIN'
 BEGIN
  INSERT @scopes SELECT DISTINCT ProjectLocationId,0 FROM gp.VisitRequests WHERE LocationId=@LocationId;
  UPDATE @scopes SET Allowed=gp._AdminScopeAllowed(@actor,'REPORTS_READ',@LocationId,Pair,@now);
 END;
 INSERT @matches SELECT v.VisitRequestId,v.SubmittedAtUtc,flags.Pending,flags.ExpiredInside,flags.Unreturned FROM gp.VisitRequests v
 JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId
 -- Expired follow-ups belong to the visit that owns the actual entry, not another daily ID for the same person.
 CROSS APPLY(SELECT CONVERT(bit,CASE WHEN @Workspace='GUARD' AND @DutyKind='COMMON' THEN 0
 WHEN v.RequestType='TEMP_ID' THEN CASE WHEN EXISTS(SELECT 1 FROM gp.EmployeeProjectPresence ep
 JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=ep.ProjectLocationId
 WHERE ep.VisitRequestId=v.VisitRequestId AND ep.EmployeeId=v.EmployeeId AND ep.IsInside=1 AND pl.LocationId=v.LocationId
 AND(@Workspace<>'GUARD' OR ep.ProjectLocationId=@DutyId)) THEN 1 ELSE 0 END ELSE s.IsInside END) Inside) x
 CROSS APPLY(SELECT CONVERT(bit,CASE WHEN v.Status='PENDING' AND p.Status='PENDING' AND v.ValidUntilUtc>@now AND v.SubmittedAtUtc<=DATEADD(minute,-15,@now) AND NOT EXISTS(SELECT 1 FROM gp.PassReturns WHERE VisitRequestId=v.VisitRequestId) THEN 1 ELSE 0 END) Pending,
 CONVERT(bit,CASE WHEN x.Inside=1 AND v.ValidUntilUtc<=@now THEN 1 ELSE 0 END) ExpiredInside,
 CONVERT(bit,CASE WHEN @Workspace<>'GUARD' AND EXISTS(SELECT 1 FROM gp.PassPrintJobs WHERE VisitRequestId=v.VisitRequestId AND Status='DISPATCHED') AND NOT EXISTS(SELECT 1 FROM gp.PassReturns WHERE VisitRequestId=v.VisitRequestId) THEN 1 ELSE 0 END) Unreturned) flags
 WHERE v.LocationId=@LocationId AND(flags.Pending=1 OR flags.ExpiredInside=1 OR flags.Unreturned=1)
 AND(@Workspace='ADMIN' OR v.PersonalDataPurgedAtUtc IS NULL)
 AND(@Workspace='RECEPTION'
 OR @Workspace='ADMIN' AND EXISTS(SELECT 1 FROM @scopes sc WHERE sc.Allowed=1 AND(sc.Pair=v.ProjectLocationId OR sc.Pair IS NULL AND v.ProjectLocationId IS NULL))
 OR @Workspace='GUARD' AND(@DutyKind='COMMON' OR v.ProjectLocationId=@DutyId OR v.RequestType='TEMP_ID' AND(EXISTS(SELECT 1 FROM @eligible e WHERE e.EmployeeId=v.EmployeeId AND e.Allowed=1) OR EXISTS(SELECT 1 FROM gp.EmployeeProjectPresence ep WHERE ep.EmployeeId=v.EmployeeId AND ep.ProjectLocationId=@DutyId AND ep.IsInside=1))));
 INSERT @page SELECT TOP(@Take+1) VisitId,Submitted FROM @matches WHERE(@Category='PENDING' AND Pending=1 OR @Category='EXPIRED_INSIDE' AND ExpiredInside=1 OR @Category='UNRETURNED' AND Unreturned=1)
 AND(@AfterSubmittedAtUtc IS NULL OR Submitted<@AfterSubmittedAtUtc OR Submitted=@AfterSubmittedAtUtc AND VisitId<@AfterVisitRequestId) ORDER BY Submitted DESC,VisitId DESC;
 IF(SELECT COUNT(*) FROM @page)>@Take BEGIN SET @more=1;DELETE @page WHERE VisitId=(SELECT TOP(1) VisitId FROM @page ORDER BY Submitted,VisitId);END;
 IF @more=1 SELECT TOP(1) @afterTime=Submitted,@afterId=VisitId FROM @page ORDER BY Submitted,VisitId;
 EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 IF gp._OperationsScopeAllowed(@actor,@Workspace,@LocationId,@DutyKind,@DutyId,@now)=0 THROW 52001,'Scope changed.',1;
 EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 UPDATE @eligible SET Allowed=gp._EmployeeProjectLocationEligible(EmployeeId,@DutyId,@cutoff,@now);
 IF @Workspace='ADMIN' AND EXISTS(SELECT 1 FROM @scopes sc WHERE sc.Allowed=1 AND EXISTS(SELECT 1 FROM @matches m JOIN gp.VisitRequests v ON v.VisitRequestId=m.VisitId WHERE sc.Pair=v.ProjectLocationId OR sc.Pair IS NULL AND v.ProjectLocationId IS NULL)
 AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',@LocationId,sc.Pair,@now)=0) THROW 52001,'Scope changed during read.',1;
 IF @Workspace<>'ADMIN' AND EXISTS(SELECT 1 FROM @matches m LEFT JOIN gp.VisitRequests v ON v.VisitRequestId=m.VisitId WHERE v.VisitRequestId IS NULL OR v.PersonalDataPurgedAtUtc IS NOT NULL OR v.LocationId<>@LocationId
 OR(@Workspace='GUARD' AND CASE WHEN @DutyKind='COMMON' OR v.ProjectLocationId=@DutyId OR v.RequestType='TEMP_ID' AND(EXISTS(SELECT 1 FROM @eligible e WHERE e.EmployeeId=v.EmployeeId AND e.Allowed=1) OR EXISTS(SELECT 1 FROM gp.EmployeeProjectPresence ep WHERE ep.EmployeeId=v.EmployeeId AND ep.ProjectLocationId=@DutyId AND ep.IsInside=1)) THEN 1 ELSE 0 END=0)) THROW 52001,'Scope changed during read.',1;
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
  INSERT @matches SELECT v.VisitRequestId,v.SubmittedAtUtc,v.EmployeeId,x.Inside,CONVERT(bit,CASE WHEN v.Status='PENDING' AND ret.VisitRequestId IS NULL AND p.Status='PENDING' AND v.ValidUntilUtc>@now THEN 1 ELSE 0 END)
  FROM gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 LEFT JOIN gp.PassReturns ret ON ret.VisitRequestId=v.VisitRequestId
  CROSS APPLY(SELECT gp._PersonInsideOffice(v.VisitRequestId) Inside,(SELECT COUNT(*) FROM gp.PassPrintJobs j WHERE j.VisitRequestId=v.VisitRequestId AND j.Status='DISPATCHED') Printed) x
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
    p.AccessPassId accessPassId,v.Status status,p.Status passStatus,pj.ProjectName projectName,he.FullName hostName,he.OfficialEmail hostEmail,JSON_QUERY(CASE WHEN v.RequestType='TEMP_ID' THEN gp._EmployeeProjectSummary(v.EmployeeId,@cutoff,@now,v.LocationId) END) employeeProjects,CONVERT(bit,CASE WHEN gp._PersonInsideOffice(v.VisitRequestId)=1 THEN 1 ELSE 0 END) isInside,
    REPLACE(CONVERT(char(23),v.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc,
    REPLACE(CONVERT(char(23),n.Submitted,121),' ','T')+'Z' submittedAtUtc,
    REPLACE(CONVERT(char(23),ret.ReturnedAtUtc,121),' ','T')+'Z' returnedAtUtc,
    (SELECT COUNT(*) FROM gp.PassPrintJobs j WHERE j.VisitRequestId=v.VisitRequestId AND j.Status='DISPATCHED') printCount
    FROM @page n JOIN gp.VisitRequests v ON v.VisitRequestId=n.VisitId JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1
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
 SELECT v.VisitRequestId visitRequestId,CONVERT(char(10),v.LocalVisitDate,23) localVisitDate,
 REPLACE(CONVERT(char(23),v.SubmittedAtUtc,121),' ','T')+'Z' submittedAtUtc,
 v.PersonName personName,v.EmployeeId employeeId,v.PersonEmail personEmail,v.PersonPhone personPhone,v.CompanyName companyName,
 COALESCE((SELECT STRING_AGG(CONVERT(nvarchar(max),j.value),N', ') WITHIN GROUP(ORDER BY j.value) FROM OPENJSON(v.DeviceTypesJson) j),N'') deviceTypes,
 l.LocationName locationName,pj.ProjectName projectName,h.FullName hostName,h.OfficialEmail hostEmail,
 CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END requestType,v.Reason reason,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,
 v.Status status,p.Status passStatus,CASE WHEN (CASE WHEN v.RequestType='TEMP_ID' THEN gp._PersonInsideOffice(v.VisitRequestId) ELSE vp.IsInside END)=1 THEN 'INSIDE' ELSE 'OUTSIDE' END presence,
 CASE WHEN ret.VisitRequestId IS NOT NULL THEN 'RETURNED' WHEN EXISTS(SELECT 1 FROM gp.PassPrintJobs j WHERE j.VisitRequestId=v.VisitRequestId AND j.Status='DISPATCHED') THEN 'PRINTED' ELSE 'NOT_PRINTED' END printStatus,
 REPLACE(CONVERT(char(23),ret.ReturnedAtUtc,121),' ','T')+'Z' returnedAtUtc,
 REPLACE(CONVERT(char(23),v.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc
  ,REPLACE(CONVERT(char(23),mv.firstEntry,121),' ','T')+'Z' firstEntryAtUtc,REPLACE(CONVERT(char(23),mv.lastEntry,121),' ','T')+'Z' lastEntryAtUtc,REPLACE(CONVERT(char(23),mv.lastExit,121),' ','T')+'Z' lastExitAtUtc
 INTO #register FROM gp.VisitRequests v JOIN gp.VisitPresence vp ON vp.VisitRequestId=v.VisitRequestId JOIN gp.Locations l ON l.LocationId=v.LocationId
 JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1
 LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId LEFT JOIN gp.Projects pj ON pj.ProjectId=pl.ProjectId
 LEFT JOIN gp.Employees h ON h.EmployeeId=v.HostEmployeeId LEFT JOIN gp.PassReturns ret ON ret.VisitRequestId=v.VisitRequestId
 OUTER APPLY(SELECT MIN(CASE WHEN e.EventType='ENTRY' THEN e.OccurredAtUtc END) firstEntry,MAX(CASE WHEN e.EventType='ENTRY' THEN e.OccurredAtUtc END) lastEntry,MAX(CASE WHEN e.EventType='EXIT' THEN e.OccurredAtUtc END) lastExit FROM(
 SELECT a.EventType,a.OccurredAtUtc FROM gp.AccessEvents a WHERE a.VisitRequestId=v.VisitRequestId
 UNION ALL SELECT a.EventType,a.OccurredAtUtc FROM gp.EmployeeProjectAccessEvents a JOIN gp.ProjectLocations ep ON ep.ProjectLocationId=a.ProjectLocationId
 WHERE (a.VisitRequestId=v.VisitRequestId OR a.PresentedVisitRequestId=v.VisitRequestId) AND ep.LocationId=v.LocationId AND(v.RequestType='TEMP_ID' OR a.ProjectLocationId=v.ProjectLocationId)) e) mv
 WHERE v.LocationId=@LocationId AND v.LocalVisitDate BETWEEN @FromDate AND @ToDate AND(@ProjectLocationId IS NULL OR v.ProjectLocationId=@ProjectLocationId)
 -- Admission above grants this whole office or the exact selected project.
 AND v.PersonalDataPurgedAtUtc IS NULL;
 DELETE r FROM #register r WHERE EXISTS(SELECT 1 FROM @filters f WHERE NOT EXISTS(
 SELECT 1 FROM (VALUES (N'localVisitDate',CONVERT(nvarchar(max),r.localVisitDate)),(N'submittedAtUtc',CONVERT(nvarchar(max),r.submittedAtUtc)),(N'personName',CONVERT(nvarchar(max),r.personName)),(N'employeeId',CONVERT(nvarchar(max),r.employeeId)),(N'personEmail',CONVERT(nvarchar(max),r.personEmail)),(N'personPhone',CONVERT(nvarchar(max),r.personPhone)),(N'companyName',CONVERT(nvarchar(max),r.companyName)),(N'deviceTypes',CONVERT(nvarchar(max),r.deviceTypes)),(N'locationName',CONVERT(nvarchar(max),r.locationName)),(N'projectName',CONVERT(nvarchar(max),r.projectName)),(N'hostName',CONVERT(nvarchar(max),r.hostName)),(N'hostEmail',CONVERT(nvarchar(max),r.hostEmail)),(N'requestType',CONVERT(nvarchar(max),r.requestType)),(N'reason',CONVERT(nvarchar(max),r.reason)),(N'publicReference',CONVERT(nvarchar(max),r.publicReference)),(N'publicPassNumber',CONVERT(nvarchar(max),r.publicPassNumber)),(N'status',CONVERT(nvarchar(max),r.status)),(N'passStatus',CONVERT(nvarchar(max),r.passStatus)),(N'presence',CONVERT(nvarchar(max),r.presence)),(N'printStatus',CONVERT(nvarchar(max),r.printStatus)),(N'returnedAtUtc',CONVERT(nvarchar(max),r.returnedAtUtc)),(N'validFromUtc',CONVERT(nvarchar(max),r.validFromUtc)),(N'validUntilUtc',CONVERT(nvarchar(max),r.validUntilUtc)),(N'firstEntryAtUtc',CONVERT(nvarchar(max),r.firstEntryAtUtc)),(N'lastEntryAtUtc',CONVERT(nvarchar(max),r.lastEntryAtUtc)),(N'lastExitAtUtc',CONVERT(nvarchar(max),r.lastExitAtUtc))) c(name,value)
 WHERE c.name COLLATE Latin1_General_100_BIN2=f.name AND ((f.name IN('status','passStatus','requestType','presence','printStatus') AND c.value COLLATE Latin1_General_100_BIN2=f.value COLLATE Latin1_General_100_BIN2) OR(f.name NOT IN('status','passStatus','requestType','presence','printStatus') AND CHARINDEX(f.value COLLATE Latin1_General_100_CI_AS,COALESCE(c.value,N'') COLLATE Latin1_General_100_CI_AS)>0))));
 SELECT @total=COUNT(*) FROM #register;
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
 DECLARE @offset int=(@Page-1)*@PageSize;
 EXEC sys.sp_executesql @sql,N'@offset int,@take int,@rows nvarchar(max) OUTPUT',@offset,@PageSize,@rows OUTPUT;
 SET @result=(SELECT JSON_QUERY(@rows) rows,@total total,@Page page,@PageSize pageSize,@datasetVersion datasetVersion,REPLACE(CONVERT(char(23),@now,121),' ','T')+'Z' checkedAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,LocationId,ProjectLocationId,ResultCode) VALUES(@actor,CASE WHEN @ForExport=1 THEN 'ADMIN_REGISTER_EXPORTED' ELSE 'ADMIN_REGISTER_READ' END,'ADMIN_QUERY',@LocationId,@ProjectLocationId,'SUCCESS');
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('100',N'Request-local authorization sets and bounded refresh/export windows');COMMIT;
