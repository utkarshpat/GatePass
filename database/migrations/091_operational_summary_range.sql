/* One authorized range snapshot; current presence is never summed across days. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54800,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='090') THROW 54800,'Migration 090 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='091') THROW 54800,'Migration 091 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
CREATE PROCEDURE gp.GetOperationalSummaryRange
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
 BEGIN TRY
  BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._RequireAdminReadCapability @actor,'REPORTS_READ',@now;
  IF NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@LocationId) OR(@ProjectLocationId IS NOT NULL AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',@LocationId,@ProjectLocationId,@now)=0)
   OR(@ProjectLocationId IS NULL AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',@LocationId,NULL,@now)=0 AND NOT EXISTS(SELECT 1 FROM gp.ProjectLocations pl WHERE pl.LocationId=@LocationId AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',@LocationId,pl.ProjectLocationId,@now)=1)) THROW 52001,'Not authorized for report scope.',1;
  SET @today=CONVERT(date,DATEADD(minute,330,@now));
  IF @FromDate<DATEADD(day,-30,@today) OR @ToDate>DATEADD(day,90,@today) THROW 52002,'Report range outside operational bounds.',1;
  SET @day=@FromDate;WHILE @day<=@ToDate BEGIN INSERT @days VALUES(@day);SET @day=DATEADD(day,1,@day);END;
  INSERT @rows SELECT v.LocationId,v.ProjectLocationId,v.LocalVisitDate,v.RequestType,v.Status,p.IsInside FROM gp.VisitRequests v JOIN gp.VisitPresence p ON p.VisitRequestId=v.VisitRequestId
   WHERE v.LocationId=@LocationId AND(@ProjectLocationId IS NULL OR v.ProjectLocationId=@ProjectLocationId)
   AND(v.LocalVisitDate BETWEEN @FromDate AND @ToDate OR p.IsInside=1) AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',v.LocationId,v.ProjectLocationId,@now)=1;
  INSERT @occupants SELECT DISTINCT ep.EmployeeId,ep.ProjectLocationId,pl.LocationId FROM gp.EmployeeProjectPresence ep JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=ep.ProjectLocationId
   WHERE ep.IsInside=1 AND pl.LocationId=@LocationId AND(@ProjectLocationId IS NULL OR ep.ProjectLocationId=@ProjectLocationId) AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',pl.LocationId,ep.ProjectLocationId,@now)=1;
  INSERT @daily SELECT Day,COUNT_BIG(*),COUNT_BIG(CASE WHEN State='PENDING' THEN 1 END),COUNT_BIG(CASE WHEN State='APPROVED' THEN 1 END),COUNT_BIG(CASE WHEN State='DENIED' THEN 1 END),COUNT_BIG(CASE WHEN State='CANCELLED' THEN 1 END)
   FROM @rows WHERE Day BETWEEN @FromDate AND @ToDate GROUP BY Day;
  -- Recheck authority and the complete materialized scopes before returning any counts.
  EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._RequireAdminReadCapability @actor,'REPORTS_READ',@now;
  IF(@ProjectLocationId IS NOT NULL AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',@LocationId,@ProjectLocationId,@now)=0)
   OR(@ProjectLocationId IS NULL AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',@LocationId,NULL,@now)=0 AND NOT EXISTS(SELECT 1 FROM gp.ProjectLocations pl WHERE pl.LocationId=@LocationId AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',@LocationId,pl.ProjectLocationId,@now)=1)) THROW 52001,'Not authorized for report scope.',1;
  IF EXISTS(SELECT 1 FROM @rows WHERE gp._AdminScopeAllowed(@actor,'REPORTS_READ',LocationId,Pair,@now)=0) OR EXISTS(SELECT 1 FROM @occupants WHERE gp._AdminScopeAllowed(@actor,'REPORTS_READ',LocationId,Pair,@now)=0) THROW 52001,'Scope changed during read.',1;
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
GRANT EXECUTE ON gp.GetOperationalSummaryRange TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('091',N'Bounded authorized range summary with daily totals and current presence');
COMMIT;
