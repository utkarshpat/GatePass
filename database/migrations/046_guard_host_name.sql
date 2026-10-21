/* Host name projection for guard workspace without exposing private contact or reason */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53700,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='045') THROW 53700,'Migration 045 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='046') THROW 53700,'Migration 046 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
ALTER PROCEDURE gp._VisitReadJson
    @Actor uniqueidentifier,@View varchar(20),@Visit uniqueidentifier,@Now datetime2(3),@Result nvarchar(max) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @cutoff datetime2(3); EXEC gp._DirectoryCutoff @Now,@cutoff OUTPUT;
    IF gp._VisitReadAllowed(@Actor,@View,@Visit,@Now,@cutoff)=0 THROW 52801,'Not authorized.',1;
    DECLARE @location int,@pair bigint,@type varchar(24),@state varchar(12),@passState varchar(12),@inside bit,@from datetime2(3),@until datetime2(3),
        @employee nvarchar(64),@target bit=0,@photo bit=0,@normal bit=0,@entry bit=0,@exit bit=0,@reconcile bit=0,@decide bit=0;
    SELECT @location=v.LocationId,@pair=v.ProjectLocationId,@type=v.RequestType,@state=v.Status,@passState=p.Status,
        @inside=s.IsInside,@from=v.ValidFromUtc,@until=v.ValidUntilUtc,@employee=v.EmployeeId,
        @photo=CASE WHEN a.PurgedAtUtc IS NULL AND a.StorageKey IS NOT NULL AND a.ContentHash IS NOT NULL THEN 1 ELSE 0 END
    FROM gp.VisitRequests v JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1
        JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId JOIN gp.PhotoAssets a ON a.PhotoAssetId=v.PhotoAssetId WHERE v.VisitRequestId=@Visit;
    IF @location IS NULL THROW 52804,'Visit unavailable.',1;
    IF EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@location AND IsActive=1) AND (@pair IS NULL OR EXISTS(
        SELECT 1 FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId WHERE pl.ProjectLocationId=@pair AND pl.IsActive=1 AND p.IsActive=1)) SET @target=1;
    IF @View='HOST' AND @target=1 AND @state='PENDING' AND @passState='PENDING'
        AND EXISTS(SELECT 1 FROM gp.VisitRequests WHERE VisitRequestId=@Visit AND ApprovalDeadlineUtc>@Now) SET @decide=1;
    IF @View='GUARD'
    BEGIN
        DECLARE @cap varchar(40)=CASE WHEN @type='TEMP_ID' THEN 'TEMP_ID_MOVEMENT' ELSE 'PROJECT_MOVEMENT' END;
        IF gp._HasCapability(@Actor,@cap,@location,@pair,1,@Now)=1 AND (@pair IS NULL OR EXISTS(SELECT 1 FROM gp.GuardAssignments
            WHERE GuardUserId=@Actor AND ProjectLocationId=@pair AND DeallocatedAtUtc IS NULL AND ValidFromUtc<=@Now AND (ValidUntilUtc IS NULL OR @Now<ValidUntilUtc))) SET @normal=1;
        IF @normal=1 AND @target=1 AND @state='APPROVED' AND @passState='ACTIVE'
        BEGIN
            IF @inside=1 SET @exit=1;
            ELSE IF @from<=@Now AND @Now<@until AND @photo=1 AND (@employee IS NULL OR EXISTS(SELECT 1 FROM gp.Employees
                WHERE EmployeeId=@employee AND IsActive=1 AND LastSyncedAtUtc BETWEEN @cutoff AND @Now)) SET @entry=1;
        END;
        IF @inside=1 AND @exit=0 AND gp._HasCapability(@Actor,'RECONCILE_EXIT',@location,@pair,1,@Now)=1 SET @reconcile=1;
    END;
    SET @Result=(SELECT v.VisitRequestId visitRequestId,v.PublicReference publicReference,
        CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END requestType,v.PersonName personName,
        v.LocationId locationId,l.LocationName locationName,CONVERT(varchar(20),v.ProjectLocationId) projectLocationId,pj.ProjectName projectName,
        he.FullName hostName,
        v.Status status,p.AccessPassId accessPassId,p.PublicPassNumber publicPassNumber,p.Status passStatus,s.IsInside isInside,
        REPLACE(CONVERT(char(23),v.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc,
        CASE WHEN @View<>'GUARD' THEN v.Reason END reason,CASE WHEN @View='HOST' THEN v.SnapshotVersion END snapshotVersion,
        CASE WHEN @View='HOST' THEN CONVERT(varchar(64),v.SnapshotHash,2) END snapshotHash,
        CONVERT(bit,CASE WHEN @View IN('OWN','HOST') AND @state IN('PENDING','APPROVED') THEN 1 ELSE 0 END) canCancel,
        @photo photoAvailable,@decide canDecide,@entry canEnter,@exit canExit,@reconcile canReconcileExit,
        REPLACE(CONVERT(char(23),@Now,121),' ','T')+'Z' checkedAtUtc,
        JSON_QUERY(CASE WHEN @View IN('GUARD','RECEPTION','ADMIN') THEN COALESCE((
            SELECT TOP(100) CONVERT(varchar(20),e.AccessEventId) accessEventId,
                   e.EventType eventType,
                   e.EntryMethod entryMethod,
                   u.DisplayName guardName,
                   REPLACE(CONVERT(char(23),e.OccurredAtUtc,121),' ','T')+'Z' occurredAtUtc
            FROM gp.AccessEvents e
            JOIN gp.Users u ON u.UserId=e.ActorUserId
            WHERE e.VisitRequestId=v.VisitRequestId
            ORDER BY e.OccurredAtUtc DESC, e.AccessEventId DESC
            FOR JSON PATH
        ), N'[]') ELSE N'[]' END) movements,
        CONVERT(bit,CASE WHEN @View IN('GUARD','RECEPTION','ADMIN') AND (SELECT COUNT(*) FROM(SELECT TOP(101) e.AccessEventId FROM gp.AccessEvents e WHERE e.VisitRequestId=v.VisitRequestId) bounded)>100 THEN 1 ELSE 0 END) movementsHasMore
        FROM gp.VisitRequests v JOIN gp.Locations l ON l.LocationId=v.LocationId
        LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId LEFT JOIN gp.Projects pj ON pj.ProjectId=pl.ProjectId
        LEFT JOIN gp.Employees he ON he.EmployeeId=v.HostEmployeeId
        JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId
        WHERE v.VisitRequestId=@Visit FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
END;
GO
ALTER PROCEDURE gp.ListGuardVisitors
 @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,
 @Queue varchar(20),@Search nvarchar(200)=N'',@Offset int=0,@ProjectFilter varchar(24)='ALL'
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
 IF @LocationId IS NULL OR @LocationId<=0 OR @Queue IS NULL OR @Queue COLLATE Latin1_General_100_BIN2 NOT IN('EXPECTED','INSIDE')
  OR DATALENGTH(@Queue)<>LEN(@Queue) OR @Search IS NULL OR DATALENGTH(@Search)>200 OR @Offset IS NULL OR @Offset<0 OR @Offset>100000 THROW 52002,'Invalid queue input.',1;
 IF @ProjectFilter IS NULL OR DATALENGTH(@ProjectFilter)<>LEN(@ProjectFilter) OR (@ProjectFilter COLLATE Latin1_General_100_BIN2 NOT IN('ALL','DIGITAL_ID') AND (TRY_CONVERT(bigint,@ProjectFilter) IS NULL OR TRY_CONVERT(bigint,@ProjectFilter)<=0 OR CONVERT(varchar(24),TRY_CONVERT(bigint,@ProjectFilter))<>@ProjectFilter COLLATE Latin1_General_100_BIN2)) THROW 52002,'Invalid project filter.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@result nvarchar(max),@today date;
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='VISITS_READ'
  JOIN gp.Locations l ON l.LocationId=g.LocationId AND l.IsActive=1 WHERE g.UserId=@actor AND g.RoleCode='GUARD' AND g.ScopeType='LOCATION'
  AND g.LocationId=@LocationId AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@now AND(g.ValidUntilUtc IS NULL OR @now<g.ValidUntilUtc)) THROW 52001,'Not authorized.',1;
 SET @today=CONVERT(date,DATEADD(minute,330,@now));SET @Search=LTRIM(RTRIM(@Search));
 DECLARE @page table(VisitId uniqueidentifier PRIMARY KEY,Submitted datetime2(3),Position int);
 INSERT @page
 SELECT v.VisitRequestId,v.SubmittedAtUtc,ROW_NUMBER() OVER(ORDER BY v.SubmittedAtUtc DESC,v.VisitRequestId DESC)
 FROM gp.VisitRequests v JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId
 JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1
 LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId LEFT JOIN gp.Projects pr ON pr.ProjectId=pl.ProjectId
 WHERE v.LocationId=@LocationId AND (@ProjectFilter='ALL' OR @ProjectFilter='DIGITAL_ID' AND v.RequestType='TEMP_ID' OR v.ProjectLocationId=TRY_CONVERT(bigint,@ProjectFilter)) AND gp._VisitReadAllowed(@actor,'GUARD',v.VisitRequestId,@now,@cutoff)=1
 /* Reconciliation permission alone must not broaden the upcoming project roster. */
 AND (v.RequestType='TEMP_ID' AND gp._HasCapability(@actor,'TEMP_ID_MOVEMENT',@LocationId,NULL,1,@now)=1
  OR EXISTS(SELECT 1 FROM gp.GuardAssignments a WHERE a.GuardUserId=@actor AND a.ProjectLocationId=v.ProjectLocationId
   AND a.DeallocatedAtUtc IS NULL AND a.ValidFromUtc<=@now AND(a.ValidUntilUtc IS NULL OR @now<a.ValidUntilUtc)))
 AND ((@Queue='EXPECTED' AND s.IsInside=0 AND v.LocalVisitDate=@today AND v.Status IN('PENDING','APPROVED') AND p.Status IN('PENDING','ACTIVE') AND v.ValidUntilUtc>@now)
  OR (@Queue='INSIDE' AND s.IsInside=1 AND EXISTS(SELECT 1 FROM gp.AccessEvents e WHERE e.AccessEventId=s.LastAccessEventId AND e.VisitRequestId=v.VisitRequestId AND e.EventType='ENTRY' AND e.ActorUserId=@actor)))
 AND (@Search=N'' OR CHARINDEX(@Search,v.PersonName COLLATE Latin1_General_100_CI_AI)>0 OR CHARINDEX(@Search,v.PublicReference)>0
  OR CHARINDEX(@Search,p.PublicPassNumber)>0 OR CHARINDEX(@Search,pr.ProjectName COLLATE Latin1_General_100_CI_AI)>0)
 ORDER BY v.SubmittedAtUtc DESC,v.VisitRequestId DESC OFFSET @Offset ROWS FETCH NEXT 51 ROWS ONLY;
 DECLARE @more bit=CASE WHEN (SELECT COUNT(*) FROM @page)>50 THEN 1 ELSE 0 END;
 IF @more=1 DELETE FROM @page WHERE Position=(SELECT MAX(Position) FROM @page);
 SET @result=(SELECT JSON_QUERY(COALESCE((SELECT v.VisitRequestId visitRequestId,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,
  v.PersonName personName,CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END requestType,pr.ProjectName projectName,
  he.FullName hostName,
  v.Status status,p.Status passStatus,s.IsInside isInside,
  REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc,
  CONVERT(bit,CASE WHEN ph.PurgedAtUtc IS NULL AND ph.StorageKey IS NOT NULL THEN 1 ELSE 0 END) photoAvailable
  FROM @page n JOIN gp.VisitRequests v ON v.VisitRequestId=n.VisitId JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId
  JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 LEFT JOIN gp.PhotoAssets ph ON ph.PhotoAssetId=v.PhotoAssetId
  LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId LEFT JOIN gp.Projects pr ON pr.ProjectId=pl.ProjectId
  LEFT JOIN gp.Employees he ON he.EmployeeId=v.HostEmployeeId
  ORDER BY n.Position FOR JSON PATH),N'[]')) visitors,@more hasMore FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON gp.ListGuardVisitors TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('046',N'Guard workspace host name projection');COMMIT;
