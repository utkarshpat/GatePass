/* Reception trusted display fields and operator-attributed manual intake audit. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54400,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='064') THROW 54400,'Migration 064 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='065') THROW 54400,'Migration 065 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
ALTER PROCEDURE gp.ListReceptionVisits @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@LocalVisitDate date=NULL,
 @Search nvarchar(100)=NULL,@Status varchar(12)='ALL',@AfterSubmittedAtUtc datetime2(3)=NULL,@AfterVisitRequestId uniqueidentifier=NULL
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 53500,'Ambient transaction not accepted.',1;
 IF @LocationId IS NULL OR @LocationId<=0 OR @Status IS NULL OR @Status COLLATE Latin1_General_100_BIN2 NOT IN('ALL','PENDING','APPROVED','DENIED','CANCELLED')
  OR (@AfterSubmittedAtUtc IS NULL AND @AfterVisitRequestId IS NOT NULL) OR (@AfterSubmittedAtUtc IS NOT NULL AND @AfterVisitRequestId IS NULL) THROW 53502,'Invalid reception filter.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@today date,@cutoff datetime2(3),@result nvarchar(max);
 BEGIN TRY
  BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
  EXEC gp._RequireReceptionLocation @actor,@LocationId,@now;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
  SET @today=CONVERT(date,DATEADD(minute,330,@now));SET @LocalVisitDate=COALESCE(@LocalVisitDate,@today);
  IF @LocalVisitDate<DATEADD(day,-30,@today) OR @LocalVisitDate>DATEADD(day,90,@today) THROW 53502,'Date outside operational range.',1;
  SET @Search=NULLIF(LTRIM(RTRIM(@Search)),N'');
  DECLARE @page table(VisitId uniqueidentifier PRIMARY KEY,Submitted datetime2(3));
  INSERT @page SELECT TOP(51) v.VisitRequestId,v.SubmittedAtUtc FROM gp.VisitRequests v
   JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1
   WHERE v.LocationId=@LocationId AND v.LocalVisitDate=@LocalVisitDate AND gp._VisitReadAllowed(@actor,'RECEPTION',v.VisitRequestId,@now,@cutoff)=1
    AND (@Status='ALL' OR v.Status=@Status) AND (@Search IS NULL OR CHARINDEX(@Search,v.PersonName)>0 OR CHARINDEX(@Search,v.PublicReference)>0 OR CHARINDEX(@Search,p.PublicPassNumber)>0 OR CHARINDEX(@Search,v.EmployeeId)>0)
    AND (@AfterSubmittedAtUtc IS NULL OR v.SubmittedAtUtc<@AfterSubmittedAtUtc OR v.SubmittedAtUtc=@AfterSubmittedAtUtc AND v.VisitRequestId<@AfterVisitRequestId)
   ORDER BY v.SubmittedAtUtc DESC,v.VisitRequestId DESC;
  DECLARE @more bit=CASE WHEN (SELECT COUNT(*) FROM @page)>50 THEN 1 ELSE 0 END,@afterTime datetime2(3),@afterId uniqueidentifier;
  IF @more=1 DELETE @page WHERE VisitId=(SELECT TOP(1) VisitId FROM @page ORDER BY Submitted,VisitId);
  IF @more=1 SELECT TOP(1) @afterTime=Submitted,@afterId=VisitId FROM @page ORDER BY Submitted,VisitId;
  SET @result=(SELECT JSON_QUERY(COALESCE((SELECT v.VisitRequestId visitRequestId,v.PersonName personName,v.EmployeeId employeeId,
    CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END requestType,v.PublicReference publicReference,p.PublicPassNumber publicPassNumber,
    p.AccessPassId accessPassId,v.Status status,p.Status passStatus,pj.ProjectName projectName,he.FullName hostName,he.OfficialEmail hostEmail,JSON_QUERY(CASE WHEN v.RequestType='TEMP_ID' THEN gp._EmployeeProjectSummary(v.EmployeeId,@cutoff,@now,v.LocationId) END) employeeProjects,CONVERT(bit,CASE WHEN v.RequestType='TEMP_ID' THEN CASE WHEN EXISTS(SELECT 1 FROM gp.EmployeeProjectPresence ep JOIN gp.ProjectLocations epl ON epl.ProjectLocationId=ep.ProjectLocationId WHERE ep.EmployeeId=v.EmployeeId AND epl.LocationId=v.LocationId AND ep.IsInside=1) THEN 1 ELSE 0 END ELSE s.IsInside END) isInside,
    REPLACE(CONVERT(char(23),v.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc,
    REPLACE(CONVERT(char(23),n.Submitted,121),' ','T')+'Z' submittedAtUtc,
    (SELECT COUNT(*) FROM gp.PassPrintJobs j WHERE j.AccessPassId=p.AccessPassId AND j.Status='DISPATCHED') printCount
    FROM @page n JOIN gp.VisitRequests v ON v.VisitRequestId=n.VisitId JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1
    JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId
    LEFT JOIN gp.Projects pj ON pj.ProjectId=pl.ProjectId LEFT JOIN gp.Employees he ON he.EmployeeId=v.HostEmployeeId AND he.IsActive=1 AND he.LastSyncedAtUtc BETWEEN @cutoff AND @now ORDER BY n.Submitted DESC,n.VisitId DESC FOR JSON PATH),N'[]')) visits,
    @more hasMore,@afterId afterVisitRequestId,REPLACE(CONVERT(char(23),@afterTime,121),' ','T')+'Z' afterSubmittedAtUtc,
    CONVERT(char(10),@LocalVisitDate,23) visitDate FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ResultCode) VALUES(@actor,'RECEPTION_LIST_READ','LOCATION',CONVERT(varchar(12),@LocationId),@LocationId,'SUCCESS');
  COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
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
            ELSE IF (@type<>'TEMP_ID' OR gp._EmployeeOfficeEligible(@employee,@location,@cutoff,@Now)=1) AND @from<=@Now AND @Now<@until AND @photo=1 AND (@employee IS NULL OR EXISTS(SELECT 1 FROM gp.Employees
                WHERE EmployeeId=@employee AND IsActive=1 AND LastSyncedAtUtc BETWEEN @cutoff AND @Now)) SET @entry=1;
        END;
        IF @inside=1 AND @exit=0 AND gp._HasCapability(@Actor,'RECONCILE_EXIT',@location,@pair,1,@Now)=1 SET @reconcile=1;
    END;
    IF @View='GUARD' AND @type='TEMP_ID' BEGIN SET @entry=0;SET @exit=0;SET @reconcile=0;END;
    SET @Result=(SELECT v.VisitRequestId visitRequestId,v.PublicReference publicReference,
        CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END requestType,v.PersonName personName,
        v.LocationId locationId,l.LocationName locationName,CONVERT(varchar(20),v.ProjectLocationId) projectLocationId,pj.ProjectName projectName,
        he.FullName hostName,CASE WHEN @View='RECEPTION' THEN he.OfficialEmail END hostEmail,
        JSON_QUERY(CASE WHEN v.RequestType='TEMP_ID' THEN gp._EmployeeProjectSummary(v.EmployeeId,@cutoff,@now,v.LocationId) END) employeeProjects,
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
CREATE PROCEDURE gp.AuditReceptionRegistration
 @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@IntakeId uniqueidentifier,@TokenHash varbinary(8000),@IntakeCsrfHash varbinary(8000)
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 54400,'Ambient transaction not accepted.',1;
 DECLARE @actor uniqueidentifier,@unused uniqueidentifier,@now datetime2(3),@type varchar(12),@location int,@ref varchar(36)=LOWER(CONVERT(varchar(36),@IntakeId));
 BEGIN TRY
  BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';
  EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
  DECLARE @resource nvarchar(255)=N'gp:intake:'+@ref;EXEC gp._TakeLock @resource;
  EXEC gp._RequireRegistrationIntake @IntakeId,@TokenHash,@IntakeCsrfHash,NULL,NULL,@unused OUTPUT,@type OUTPUT,@now OUTPUT;
  IF @type<>'EXTERNAL' OR NOT EXISTS(SELECT 1 FROM gp.RegistrationIntakes WHERE IntakeId=@IntakeId AND Status='SUBMITTED') THROW 53501,'Not authorized.',1;
  SELECT @location=MIN(LocationId) FROM gp.VisitRequests WHERE IntakeId=@IntakeId;
  IF @location IS NULL OR EXISTS(SELECT 1 FROM gp.VisitRequests WHERE IntakeId=@IntakeId AND (LocationId<>@location OR RequestType<>'EXTERNAL')) THROW 53501,'Not authorized.',1;
  EXEC gp._RequireReceptionLocation @actor,@location,@now;
  IF NOT EXISTS(SELECT 1 FROM gp.SecurityAuditEvents WHERE ActionCode='RECEPTION_MANUAL_REGISTER' AND TargetType='INTAKE' AND TargetReference=@ref)
   INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ResultCode) VALUES(@actor,'RECEPTION_MANUAL_REGISTER','INTAKE',@ref,@location,'SUCCESS');
  COMMIT;SELECT N'{"ok":true}';
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON gp.AuditReceptionRegistration TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('065',N'Reception host/project projections and attributed manual registration audit');
COMMIT;
