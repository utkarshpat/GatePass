SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54800,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='102') THROW 54800,'Migration 102 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='103') THROW 54800,'Migration 103 already applied.',1;
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
 SET @result=(SELECT JSON_QUERY((SELECT v.VisitRequestId visitRequestId,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,v.PersonName personName,
 CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END requestType,pj.ProjectName projectName,he.FullName hostName,
 JSON_QUERY(CASE WHEN v.RequestType='TEMP_ID' THEN gp._EmployeeProjectSummary(v.EmployeeId,@cutoff,@now,v.LocationId) END) employeeProjects,
 JSON_QUERY((SELECT d.Kind kind,CONVERT(varchar(20),d.DutyId) dutyId,d.Name name FROM @matches m JOIN @duties d ON d.Kind=m.Kind AND d.DutyId=m.DutyId WHERE m.VisitId=v.VisitRequestId ORDER BY d.Kind DESC,d.DutyId FOR JSON PATH)) allocations,
 v.Status status,p.Status passStatus,CONVERT(bit,CASE WHEN @Queue='INSIDE' THEN 1 ELSE 0 END) isInside,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc,
 REPLACE(CONVERT(char(23),q.Submitted,121),' ','T')+'Z' submittedAtUtc,CONVERT(bit,CASE WHEN ph.PurgedAtUtc IS NULL AND ph.StorageKey IS NOT NULL THEN 1 ELSE 0 END) photoAvailable,LOWER(CONVERT(varchar(64),ph.ContentHash,2)) photoVersion
 FROM @page q JOIN gp.VisitRequests v ON v.VisitRequestId=q.VisitId JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 JOIN gp.PhotoAssets ph ON ph.PhotoAssetId=v.PhotoAssetId
 LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=COALESCE((SELECT TOP(1) DutyId FROM @matches WHERE VisitId=v.VisitRequestId AND Kind='PROJECT' ORDER BY DutyId),v.ProjectLocationId)
 LEFT JOIN gp.Projects pj ON pj.ProjectId=pl.ProjectId LEFT JOIN gp.Employees he ON he.EmployeeId=v.HostEmployeeId ORDER BY q.Submitted DESC,q.VisitId DESC FOR JSON PATH)) visitors,
 (SELECT COUNT(*) FROM(SELECT DISTINCT VisitId FROM @matches) m) total,@more hasMore,@afterId afterVisitRequestId,REPLACE(CONVERT(char(23),@afterTime,121),' ','T')+'Z' afterSubmittedAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('103',N'Authorized queue photo content versions for scoped thumbnail reuse');COMMIT;
