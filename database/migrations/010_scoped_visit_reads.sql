/* Operational read contracts. No table changes, bearer delivery or print/QR
   rendering grant. Lists are advisory live pages; actions recheck current state. */
SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52800,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='009') THROW 52800,'Migration 009 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='010') THROW 52800,'Migration 010 already applied.',1;
BEGIN TRANSACTION;
GO
CREATE FUNCTION gp._VisitReadAllowed(@Actor uniqueidentifier,@View varchar(20),@Visit uniqueidentifier,@Now datetime2(3),@Cutoff datetime2(3))
RETURNS bit
AS
BEGIN
    DECLARE @allowed bit=0;
    IF EXISTS(SELECT 1 FROM gp.VisitRequests v JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId
        LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId
        WHERE v.VisitRequestId=@Visit AND v.PersonalDataPurgedAtUtc IS NULL AND
        ((@View='OWN' AND EXISTS(SELECT 1 FROM gp.Employees e WHERE e.UserId=@Actor AND e.EmployeeId=v.EmployeeId
            AND e.IsActive=1 AND e.LastSyncedAtUtc BETWEEN @Cutoff AND @Now))
        OR (@View='HOST' AND EXISTS(SELECT 1 FROM gp.Employees e JOIN gp.EmployeeProjectMemberships m ON m.EmployeeId=e.EmployeeId
            JOIN gp.Projects p ON p.ProjectId=m.ProjectId WHERE e.UserId=@Actor AND e.EmployeeId=v.HostEmployeeId
            AND e.IsActive=1 AND e.LastSyncedAtUtc BETWEEN @Cutoff AND @Now AND m.ProjectId=pl.ProjectId
            AND m.IsActive=1 AND m.VerifiedAtUtc BETWEEN @Cutoff AND @Now AND p.LastSyncedAtUtc BETWEEN @Cutoff AND @Now))
        OR EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='VISITS_READ'
            WHERE g.UserId=@Actor AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@Now AND (g.ValidUntilUtc IS NULL OR @Now<g.ValidUntilUtc)
            AND ((@View='RECEPTION' AND g.RoleCode='RECEPTION' AND g.ScopeType='LOCATION' AND g.LocationId=v.LocationId)
            OR (@View='ADMIN' AND ((g.RoleCode='INDIA_ADMIN' AND g.ScopeType='INDIA')
                OR (g.RoleCode='LOCATION_ADMIN' AND g.ScopeType='LOCATION' AND g.LocationId=v.LocationId)
                OR (g.RoleCode='PROJECT_ADMIN' AND ((g.ScopeType='PROJECT' AND g.ProjectId=pl.ProjectId)
                    OR (g.ScopeType='PROJECT_LOCATION' AND g.ProjectLocationId=v.ProjectLocationId)))))
            OR (@View='GUARD' AND g.RoleCode='GUARD' AND g.ScopeType='LOCATION' AND g.LocationId=v.LocationId AND
                ((s.IsInside=1 AND EXISTS(SELECT 1 FROM gp.GrantCapabilities x WHERE x.RoleGrantId=g.RoleGrantId AND x.CapabilityCode='RECONCILE_EXIT'))
                OR (v.RequestType='TEMP_ID' AND EXISTS(SELECT 1 FROM gp.GrantCapabilities x WHERE x.RoleGrantId=g.RoleGrantId AND x.CapabilityCode='TEMP_ID_MOVEMENT'))
                OR (v.ProjectLocationId IS NOT NULL AND EXISTS(SELECT 1 FROM gp.GuardAssignments a WHERE a.GuardUserId=@Actor
                    AND a.ProjectLocationId=v.ProjectLocationId AND a.DeallocatedAtUtc IS NULL AND a.ValidFromUtc<=@Now
                    AND (a.ValidUntilUtc IS NULL OR @Now<a.ValidUntilUtc))))))))) SET @allowed=1;
    RETURN @allowed;
END;
GO
CREATE PROCEDURE gp._VisitReadJson
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
        @photo photoAvailable,@decide canDecide,@entry canEnter,@exit canExit,@reconcile canReconcileExit,
        REPLACE(CONVERT(char(23),@Now,121),' ','T')+'Z' checkedAtUtc
        FROM gp.VisitRequests v JOIN gp.Locations l ON l.LocationId=v.LocationId
        LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId LEFT JOIN gp.Projects pj ON pj.ProjectId=pl.ProjectId
        JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId
        WHERE v.VisitRequestId=@Visit FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
END;
GO
CREATE PROCEDURE gp.ListVisits
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@View varchar(8000),@Queue varchar(8000)='DAY',
    @LocationId int=NULL,@LocalVisitDate date=NULL,@ProjectLocationId bigint=NULL,@PublicReference varchar(8000)=NULL,
    @PageSize int=25,@AfterSubmittedAtUtc datetime2(3)=NULL,@AfterVisitRequestId uniqueidentifier=NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 52800,'Ambient transaction not accepted.',1;
    IF @View IS NULL OR DATALENGTH(@View)<>LEN(@View) OR @View COLLATE Latin1_General_100_BIN2 NOT IN('OWN','HOST','GUARD','RECEPTION','ADMIN')
        OR @Queue IS NULL OR DATALENGTH(@Queue)<>LEN(@Queue) OR @Queue COLLATE Latin1_General_100_BIN2 NOT IN('DAY','PENDING','INSIDE')
        OR @PageSize IS NULL OR @PageSize NOT BETWEEN 1 AND 50 OR (@AfterSubmittedAtUtc IS NULL AND @AfterVisitRequestId IS NOT NULL)
        OR (@AfterSubmittedAtUtc IS NOT NULL AND @AfterVisitRequestId IS NULL) OR (@Queue='INSIDE' AND @LocalVisitDate IS NOT NULL)
        OR (@LocationId IS NOT NULL AND @LocationId<=0) OR (@View IN('GUARD','RECEPTION','ADMIN') AND @LocationId IS NULL)
        OR (@ProjectLocationId IS NOT NULL AND @ProjectLocationId<=0) OR (@PublicReference IS NOT NULL AND (DATALENGTH(@PublicReference) NOT BETWEEN 1 AND 40 OR LEN(LTRIM(RTRIM(@PublicReference)))=0))
        THROW 52802,'Invalid list input.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@today date,@result nvarchar(max);
    BEGIN TRY
        BEGIN TRANSACTION; EXEC gp._TakeLock N'gp:authorization','Shared';
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT; EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
        SET @today=CONVERT(date,DATEADD(minute,330,@now));
        IF @Queue='DAY' SET @LocalVisitDate=COALESCE(@LocalVisitDate,@today);
        IF @LocalVisitDate IS NOT NULL AND (@LocalVisitDate<DATEADD(day,-30,@today) OR @LocalVisitDate>DATEADD(day,90,@today)) THROW 52802,'Date outside operational range.',1;
        IF @View IN('OWN','HOST')
        BEGIN
            DECLARE @employee nvarchar(64),@name nvarchar(200),@email nvarchar(320);
            EXEC gp._RequireRegistrationEmployee @actor,@now,@employee OUTPUT,@name OUTPUT,@email OUTPUT;
        END;
        -- One bounded query; no global totals, contacts, storage paths or bearer data.
        DECLARE @page table(VisitId uniqueidentifier PRIMARY KEY,Submitted datetime2(3));
        INSERT @page SELECT TOP(@PageSize+1) v.VisitRequestId,v.SubmittedAtUtc FROM gp.VisitRequests v JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId
            WHERE gp._VisitReadAllowed(@actor,@View,v.VisitRequestId,@now,@cutoff)=1
            AND (@LocationId IS NULL OR v.LocationId=@LocationId) AND (@ProjectLocationId IS NULL OR v.ProjectLocationId=@ProjectLocationId)
            AND (@PublicReference IS NULL OR v.PublicReference=@PublicReference COLLATE Latin1_General_100_BIN2)
            AND (@Queue='INSIDE' AND s.IsInside=1 OR @Queue<>'INSIDE' AND (@LocalVisitDate IS NULL OR v.LocalVisitDate=@LocalVisitDate)
                AND (@Queue<>'PENDING' OR v.Status='PENDING' AND v.ApprovalDeadlineUtc>@now))
            AND (@AfterSubmittedAtUtc IS NULL OR v.SubmittedAtUtc<@AfterSubmittedAtUtc OR v.SubmittedAtUtc=@AfterSubmittedAtUtc AND v.VisitRequestId<@AfterVisitRequestId)
            ORDER BY v.SubmittedAtUtc DESC,v.VisitRequestId DESC;
        DECLARE @more bit=CASE WHEN (SELECT COUNT(*) FROM @page)>@PageSize THEN 1 ELSE 0 END,@afterTime datetime2(3),@afterId uniqueidentifier;
        IF @more=1 DELETE FROM @page WHERE VisitId=(SELECT TOP(1) VisitId FROM @page ORDER BY Submitted,VisitId);
        IF @more=1 SELECT TOP(1) @afterTime=Submitted,@afterId=VisitId FROM @page ORDER BY Submitted,VisitId;
        SET @result=(SELECT JSON_QUERY(COALESCE((SELECT v.VisitRequestId visitRequestId,v.PublicReference publicReference,
            CASE WHEN v.RequestType='TEMP_ID' THEN 'DIGITAL_ID' ELSE v.RequestType END requestType,v.PersonName personName,v.LocationId locationId,
            l.LocationName locationName,CONVERT(varchar(20),v.ProjectLocationId) projectLocationId,pj.ProjectName projectName,v.Status status,
            p.Status passStatus,s.IsInside isInside,REPLACE(CONVERT(char(23),v.ValidFromUtc,121),' ','T')+'Z' validFromUtc,
            REPLACE(CONVERT(char(23),v.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc
            FROM @page n JOIN gp.VisitRequests v ON v.VisitRequestId=n.VisitId JOIN gp.Locations l ON l.LocationId=v.LocationId
            LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=v.ProjectLocationId LEFT JOIN gp.Projects pj ON pj.ProjectId=pl.ProjectId
            JOIN gp.AccessPasses p ON p.VisitRequestId=v.VisitRequestId AND p.IsCurrent=1 JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId
            ORDER BY n.Submitted DESC,n.VisitId DESC FOR JSON PATH),N'[]')) visits,@more hasMore,
            @afterId afterVisitRequestId,CASE WHEN @afterTime IS NOT NULL THEN REPLACE(CONVERT(char(23),@afterTime,121),' ','T')+'Z' END afterSubmittedAtUtc,
            REPLACE(CONVERT(char(23),@now,121),' ','T')+'Z' checkedAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        COMMIT; SELECT @result;
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH;
END;
GO
CREATE PROCEDURE gp.GetVisitDetail
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@View varchar(8000),@VisitRequestId uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 52800,'Ambient transaction not accepted.',1;
    IF @View IS NULL OR DATALENGTH(@View)<>LEN(@View) OR @View COLLATE Latin1_General_100_BIN2 NOT IN('OWN','HOST','GUARD','RECEPTION','ADMIN') OR @VisitRequestId IS NULL THROW 52802,'Invalid detail input.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@result nvarchar(max),@lock nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@VisitRequestId));
    BEGIN TRY
        BEGIN TRANSACTION; EXEC gp._TakeLock N'gp:authorization','Shared';
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        EXEC gp._TakeLock @lock,'Shared'; EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        EXEC gp._VisitReadJson @actor,@View,@VisitRequestId,@now,@result OUTPUT;
        COMMIT; SELECT @result;
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH;
END;
GO
CREATE PROCEDURE gp.ResolveVisitPhoto
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@View varchar(8000),@VisitRequestId uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 52800,'Ambient transaction not accepted.',1;
    IF @View IS NULL OR DATALENGTH(@View)<>LEN(@View) OR @View COLLATE Latin1_General_100_BIN2 NOT IN('OWN','HOST','GUARD','RECEPTION','ADMIN') OR @VisitRequestId IS NULL THROW 52802,'Invalid photo input.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@result nvarchar(max),@lock nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@VisitRequestId));
    BEGIN TRY
        BEGIN TRANSACTION; EXEC gp._TakeLock N'gp:authorization','Shared';
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        EXEC gp._TakeLock @lock,'Shared'; EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT; EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
        IF gp._VisitReadAllowed(@actor,@View,@VisitRequestId,@now,@cutoff)=0 THROW 52801,'Not authorized.',1;
        SET @result=(SELECT a.PhotoAssetId photoAssetId,a.StorageKey storageKey,CONVERT(varchar(64),a.ContentHash,2) contentHash,a.MimeType mimeType,
            a.ByteLength byteLength,a.PixelWidth width,a.PixelHeight height FROM gp.VisitRequests v JOIN gp.PhotoAssets a ON a.PhotoAssetId=v.PhotoAssetId
            WHERE v.VisitRequestId=@VisitRequestId AND a.PurgedAtUtc IS NULL AND a.StorageKey IS NOT NULL AND a.ContentHash IS NOT NULL
            FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        IF @result IS NULL THROW 52801,'Not authorized.',1;
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode)
            SELECT @actor,'VISIT_PHOTO_AUTHORIZED','VISIT',CONVERT(varchar(36),VisitRequestId),LocationId,ProjectLocationId,'SUCCESS' FROM gp.VisitRequests WHERE VisitRequestId=@VisitRequestId;
        COMMIT; SELECT @result;
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH;
END;
GO
CREATE PROCEDURE gp.VerifyGuardPass
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@CredentialHash varbinary(8000),@CorrelationId uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 52800,'Ambient transaction not accepted.',1;
    IF @LocationId IS NULL OR @LocationId<=0 OR @CredentialHash IS NULL OR DATALENGTH(@CredentialHash)<>32 OR @CorrelationId IS NULL THROW 52802,'Invalid scan input.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@visit uniqueidentifier,@pass uniqueidentifier,@location int,@passState varchar(12),@current bit,
        @state varchar(12),@from datetime2(3),@until datetime2(3),@outcome varchar(32),@detail nvarchar(max),@result nvarchar(max);
    BEGIN TRY
        BEGIN TRANSACTION; EXEC gp._TakeLock N'gp:authorization','Shared'; EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        IF NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='VISITS_READ'
            WHERE g.UserId=@actor AND g.RoleCode='GUARD' AND g.ScopeType='LOCATION' AND g.LocationId=@LocationId AND g.RevokedAtUtc IS NULL
            AND g.ValidFromUtc<=@now AND (g.ValidUntilUtc IS NULL OR @now<g.ValidUntilUtc)) THROW 52801,'Not authorized.',1;
        SELECT @visit=VisitRequestId,@pass=AccessPassId FROM gp.AccessPasses WHERE CredentialHash=@CredentialHash;
        IF @visit IS NOT NULL
        BEGIN
            DECLARE @lock nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@visit)); EXEC gp._TakeLock @lock,'Shared';
            EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT; EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
            SELECT @location=LocationId FROM gp.VisitRequests WHERE VisitRequestId=@visit;
            IF @location<>@LocationId OR gp._VisitReadAllowed(@actor,'GUARD',@visit,@now,@cutoff)=0 SET @visit=NULL;
        END;
        IF @visit IS NULL
        BEGIN
            -- Unknown and known-out-of-scope credentials have identical responses
            -- and unlinked logs. Correlation is tracing only, never a replay receipt.
            INSERT gp.PassScanAttempts(ActorUserId,LocationId,OutcomeCode,CorrelationId) VALUES(@actor,@LocationId,'NOT_AUTHORIZED',@CorrelationId);
            SET @result=N'{"outcome":"NOT_AVAILABLE"}';
        END
        ELSE
        BEGIN
            EXEC gp._VisitReadJson @actor,'GUARD',@visit,@now,@detail OUTPUT;
            SELECT @passState=p.Status,@current=p.IsCurrent,@state=v.Status,@from=v.ValidFromUtc,@until=v.ValidUntilUtc
                FROM gp.AccessPasses p JOIN gp.VisitRequests v ON v.VisitRequestId=p.VisitRequestId WHERE p.AccessPassId=@pass;
            SET @outcome=CASE WHEN @current=0 OR @passState='REVOKED' THEN 'REVOKED' WHEN @state='CANCELLED' THEN 'CANCELLED'
                WHEN @state='DENIED' OR @passState='DENIED' THEN 'DENIED' WHEN @state='PENDING' OR @passState='PENDING' THEN 'PENDING'
                WHEN @now>=@until THEN 'EXPIRED' WHEN @now<@from THEN 'NOT_YET_VALID'
                WHEN JSON_VALUE(@detail,'$.canEnter')='true' OR JSON_VALUE(@detail,'$.canExit')='true' THEN 'VALID' ELSE 'NOT_AUTHORIZED' END;
            -- A stale printed QR never suggests a normal action on its replacement.
            IF @current=0 OR @passState='REVOKED' SET @detail=JSON_MODIFY(JSON_MODIFY(@detail,'$.canEnter',CONVERT(bit,0)),'$.canExit',CONVERT(bit,0));
            INSERT gp.PassScanAttempts(AccessPassId,VisitRequestId,ActorUserId,LocationId,OutcomeCode,CorrelationId)
                VALUES(@pass,@visit,@actor,@LocationId,@outcome,@CorrelationId);
            SET @result=(SELECT @outcome outcome,JSON_QUERY(@detail) visit FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        END;
        COMMIT; SELECT @result;
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH;
END;
GO
CREATE ROLE gp_media_runtime AUTHORIZATION dbo;
DENY SELECT,INSERT,UPDATE,DELETE,ALTER ON SCHEMA::gp TO gp_media_runtime;
GRANT EXECUTE ON gp.ResolveVisitPhoto TO gp_media_runtime;
GRANT EXECUTE ON gp.ListVisits TO gp_api_runtime;
GRANT EXECUTE ON gp.GetVisitDetail TO gp_api_runtime;
GRANT EXECUTE ON gp.VerifyGuardPass TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('010',N'Scoped operational reads, non-moving guard verification and isolated photo authorization');
COMMIT;
