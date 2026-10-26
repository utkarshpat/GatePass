SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54900,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='108') THROW 54900,'Migration 108 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='109') THROW 54900,'Migration 109 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
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
 SET @result=(SELECT JSON_QUERY(COALESCE((SELECT v.VisitRequestId visitRequestId,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,v.PersonName personName,
 CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END requestType,pj.ProjectName projectName,he.FullName hostName,
 JSON_QUERY(CASE WHEN v.RequestType='TEMP_ID' THEN gp._EmployeeProjectSummary(v.EmployeeId,@cutoff,@now,v.LocationId) END) employeeProjects,
 JSON_QUERY((SELECT d.Kind kind,CONVERT(varchar(20),d.DutyId) dutyId,d.Name name FROM @matches m JOIN @duties d ON d.Kind=m.Kind AND d.DutyId=m.DutyId WHERE m.VisitId=v.VisitRequestId ORDER BY d.Kind DESC,d.DutyId FOR JSON PATH)) allocations,
 v.Status status,p.Status passStatus,CONVERT(bit,CASE WHEN @Queue='INSIDE' THEN 1 ELSE 0 END) isInside,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc,
 REPLACE(CONVERT(char(23),q.Submitted,121),' ','T')+'Z' submittedAtUtc,CONVERT(bit,CASE WHEN ph.PurgedAtUtc IS NULL AND ph.StorageKey IS NOT NULL THEN 1 ELSE 0 END) photoAvailable,LOWER(CONVERT(varchar(64),ph.ContentHash,2)) photoVersion
 FROM @page q JOIN gp.VisitRequests v ON v.VisitRequestId=q.VisitId JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 JOIN gp.PhotoAssets ph ON ph.PhotoAssetId=v.PhotoAssetId
 LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=COALESCE((SELECT TOP(1) DutyId FROM @matches WHERE VisitId=v.VisitRequestId AND Kind='PROJECT' ORDER BY DutyId),v.ProjectLocationId)
 LEFT JOIN gp.Projects pj ON pj.ProjectId=pl.ProjectId LEFT JOIN gp.Employees he ON he.EmployeeId=v.HostEmployeeId ORDER BY q.Submitted DESC,q.VisitId DESC FOR JSON PATH),N'[]')) visitors,
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
 JSON_QUERY(COALESCE((SELECT v.VisitRequestId visitRequestId,v.PersonName personName,CONVERT(char(10),v.LocalVisitDate,23) visitDate,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,
 REPLACE(CONVERT(char(23),q.Submitted,121),' ','T')+'Z' submittedAtUtc FROM @page q JOIN gp.VisitRequests v ON v.VisitRequestId=q.VisitId JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 ORDER BY q.Submitted DESC,q.VisitId DESC FOR JSON PATH),N'[]')) items,
 @more hasMore,@afterId afterVisitRequestId,REPLACE(CONVERT(char(23),@afterTime,121),' ','T')+'Z' afterSubmittedAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,LocationId,ProjectLocationId,ResultCode) VALUES(@actor,'ACTION_CENTRE_READ','REPORT_QUERY',@LocationId,CASE WHEN @DutyKind='PROJECT' THEN @DutyId END,'SUCCESS');
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('109',N'Emit explicit empty arrays for guard queues and action-centre pages');COMMIT;
