/* Movement history timeline for guard and reception detail views */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='042') THROW 53600,'Migration 042 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='043') THROW 53600,'Migration 043 already applied.',1;
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
        JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId
        WHERE v.VisitRequestId=@Visit FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('043',N'Bounded operational movement timeline with exact bigint IDs and explicit truncation');
COMMIT;
