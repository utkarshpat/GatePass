/* Bounded workspace queues with full-filter counts and stable keyset paging. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54800,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='091') THROW 54800,'Migration 091 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='092') THROW 54800,'Migration 092 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
CREATE PROCEDURE gp.ReadGuardQueue @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@DutyKind varchar(10),@DutyId bigint=NULL,
 @Queue varchar(10),@Search nvarchar(100)=N'',@AfterSubmittedAtUtc datetime2(3)=NULL,@AfterVisitRequestId uniqueidentifier=NULL AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF @LocationId IS NULL OR @LocationId<=0 OR @DutyKind IS NULL OR @DutyKind COLLATE Latin1_General_100_BIN2 NOT IN('ALL','PROJECT','COMMON')
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
 INSERT @matches SELECT v.VisitRequestId,d.Kind,d.DutyId FROM gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1
 JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId CROSS JOIN @duties d
 LEFT JOIN gp.EmployeeProjectPresence ep ON ep.EmployeeId=v.EmployeeId AND ep.ProjectLocationId=d.DutyId AND ep.IsInside=1 AND d.Kind='PROJECT'
 WHERE v.LocationId=@LocationId AND gp._GuardDutyVisitAllowed(@actor,d.Kind,d.DutyId,@LocationId,v.VisitRequestId,@cutoff,@now)=1
 AND(@Search=N'' OR CHARINDEX(@Search,v.PersonName COLLATE Latin1_General_100_CI_AI)>0 OR CHARINDEX(@Search,v.PublicReference)>0 OR CHARINDEX(@Search,p.PublicPassNumber)>0 OR CHARINDEX(@Search,d.Name COLLATE Latin1_General_100_CI_AI)>0)
 AND((@Queue='EXPECTED' AND v.LocalVisitDate=CONVERT(date,DATEADD(minute,330,@now)) AND v.Status IN('PENDING','APPROVED') AND p.Status IN('PENDING','ACTIVE') AND v.ValidUntilUtc>@now
 AND(d.Kind='COMMON' OR CASE WHEN v.RequestType='TEMP_ID' THEN COALESCE(ep.IsInside,0) ELSE s.IsInside END=0))
 OR(@Queue='INSIDE' AND d.Kind='PROJECT' AND(v.RequestType<>'TEMP_ID' OR ep.VisitRequestId=v.VisitRequestId) AND CASE WHEN v.RequestType='TEMP_ID' THEN COALESCE(ep.IsInside,0) ELSE s.IsInside END=1
 AND((v.RequestType='TEMP_ID' AND EXISTS(SELECT 1 FROM gp.EmployeeProjectAccessEvents e WHERE e.AccessEventId=ep.LastEventId AND e.ActorUserId=@actor AND e.EventType='ENTRY'))
 OR(v.RequestType<>'TEMP_ID' AND EXISTS(SELECT 1 FROM gp.AccessEvents e WHERE e.AccessEventId=s.LastAccessEventId AND e.ActorUserId=@actor AND e.EventType='ENTRY')))));
 INSERT @page SELECT TOP(25) v.VisitRequestId,v.SubmittedAtUtc FROM gp.VisitRequests v WHERE EXISTS(SELECT 1 FROM @matches m WHERE m.VisitId=v.VisitRequestId)
 AND(@AfterSubmittedAtUtc IS NULL OR v.SubmittedAtUtc<@AfterSubmittedAtUtc OR v.SubmittedAtUtc=@AfterSubmittedAtUtc AND v.VisitRequestId<@AfterVisitRequestId) ORDER BY v.SubmittedAtUtc DESC,v.VisitRequestId DESC;
 IF(SELECT COUNT(*) FROM @page)>24 BEGIN SET @more=1;DELETE @page WHERE VisitId=(SELECT TOP(1) VisitId FROM @page ORDER BY Submitted,VisitId);END;
 IF @more=1 SELECT TOP(1) @afterTime=Submitted,@afterId=VisitId FROM @page ORDER BY Submitted,VisitId;
 EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 IF EXISTS(SELECT 1 FROM @duties WHERE gp._GuardDutyAssigned(@actor,Kind,DutyId,@LocationId,@now)=0) THROW 52001,'Scope changed.',1;
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
CREATE PROCEDURE gp.ReadReceptionQueue @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@LocalVisitDate date=NULL,
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
    JSON_QUERY((SELECT COUNT(*) total,COALESCE(SUM(CONVERT(int,Pending)),0) pending,(SELECT COUNT(*) FROM(SELECT DISTINCT CASE WHEN EmployeeId IS NULL THEN CONVERT(nvarchar(64),VisitId) ELSE EmployeeId END Person FROM @matches WHERE Inside=1) i) inside FROM @matches FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) counts,
    @more hasMore,@afterId afterVisitRequestId,REPLACE(CONVERT(char(23),@afterTime,121),' ','T')+'Z' afterSubmittedAtUtc,
    CONVERT(char(10),@LocalVisitDate,23) visitDate FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ResultCode) VALUES(@actor,'RECEPTION_QUEUE_READ','LOCATION',CONVERT(varchar(12),@LocationId),@LocationId,'SUCCESS');
  COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;

GO
GRANT EXECUTE ON gp.ReadGuardQueue TO gp_api_runtime;
GRANT EXECUTE ON gp.ReadReceptionQueue TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('092',N'Bounded guard and reception queues with keyset paging and full-filter counts');COMMIT;
