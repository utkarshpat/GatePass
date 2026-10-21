/* Scoped administration selectors, operational summary and redacted audit pages.
   No schema-wide reads, exports, raw metadata or authentication material. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='018') THROW 52000,'Migration 018 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='019') THROW 52000,'Migration 019 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
CREATE FUNCTION gp._AdminScopeAllowed(@Actor uniqueidentifier,@Capability varchar(40),@Location int,@Pair bigint,@Now datetime2(3))
RETURNS bit
AS
BEGIN
    DECLARE @project bigint;
    IF @Pair IS NOT NULL
    BEGIN
        SELECT @project=ProjectId FROM gp.ProjectLocations WHERE ProjectLocationId=@Pair AND LocationId=@Location;
        IF @project IS NULL RETURN 0;
    END;
    IF EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId
        WHERE g.UserId=@Actor AND c.CapabilityCode=@Capability AND g.RoleCode IN('INDIA_ADMIN','LOCATION_ADMIN','PROJECT_ADMIN')
        AND gp._RoleCapabilityAllowed(g.RoleCode,@Capability)=1 AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@Now AND (g.ValidUntilUtc IS NULL OR @Now<g.ValidUntilUtc)
        AND ((g.RoleCode='INDIA_ADMIN' AND g.ScopeType='INDIA')
            OR (g.RoleCode='LOCATION_ADMIN' AND g.ScopeType='LOCATION' AND @Location IS NOT NULL AND g.LocationId=@Location)
            OR (g.RoleCode='PROJECT_ADMIN' AND @Pair IS NOT NULL AND ((g.ScopeType='PROJECT' AND g.ProjectId=@project) OR (g.ScopeType='PROJECT_LOCATION' AND g.ProjectLocationId=@Pair)))))
        RETURN 1;
    RETURN 0;
END;
GO
CREATE FUNCTION gp._GuardAllocationEligible(@User uniqueidentifier,@Location int,@Start datetime2(3),@End datetime2(3))
RETURNS bit
AS
BEGIN
    IF NOT EXISTS(SELECT 1 FROM gp.Users WHERE UserId=@User AND IsActive=1) RETURN 0;
    IF EXISTS(SELECT 1 FROM gp.StaffRoleGrants WHERE UserId=@User AND RoleCode<>'GUARD' AND RevokedAtUtc IS NULL
        AND (@End IS NULL OR ValidFromUtc<@End) AND (ValidUntilUtc IS NULL OR @Start<ValidUntilUtc)) RETURN 0;
    IF EXISTS(SELECT 1 FROM gp.StaffRoleGrants g WHERE g.UserId=@User AND g.RoleCode='GUARD' AND g.ScopeType='LOCATION' AND g.LocationId=@Location
        AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@Start AND (g.ValidUntilUtc IS NULL OR @End IS NOT NULL AND @End<=g.ValidUntilUtc)
        AND EXISTS(SELECT 1 FROM gp.GrantCapabilities WHERE RoleGrantId=g.RoleGrantId AND CapabilityCode='PROJECT_MOVEMENT')
        AND EXISTS(SELECT 1 FROM gp.GrantCapabilities WHERE RoleGrantId=g.RoleGrantId AND CapabilityCode='VISITS_READ')) RETURN 1;
    RETURN 0;
END;
GO
CREATE FUNCTION gp._AuditEventReadAllowed(@Actor uniqueidentifier,@Audit bigint,@Now datetime2(3))
RETURNS bit
AS
BEGIN
    DECLARE @location int,@pair bigint,@kind varchar(50),@target varchar(100),@project bigint;
    SELECT @location=LocationId,@pair=ProjectLocationId,@kind=TargetType,@target=TargetReference FROM gp.SecurityAuditEvents WHERE AuditEventId=@Audit;
    IF @kind IS NULL RETURN 0;
    IF @location IS NOT NULL RETURN gp._AdminScopeAllowed(@Actor,'AUDIT_READ',@location,@pair,@Now);
    -- Only this typed target may resolve a project-wide event. Never guess scope
    -- from arbitrary operation references, shared actors or free-text metadata.
    IF @kind='ROLE_GRANT'
        SELECT @project=ProjectId FROM gp.StaffRoleGrants WHERE RoleGrantId=TRY_CONVERT(bigint,@target) AND ScopeType='PROJECT';
    IF @project IS NOT NULL AND EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId
        WHERE g.UserId=@Actor AND c.CapabilityCode='AUDIT_READ' AND g.RoleCode='PROJECT_ADMIN' AND g.ScopeType='PROJECT' AND g.ProjectId=@project
        AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@Now AND (g.ValidUntilUtc IS NULL OR @Now<g.ValidUntilUtc)) RETURN 1;
    RETURN gp._AdminScopeAllowed(@Actor,'AUDIT_READ',NULL,NULL,@Now);
END;
GO
CREATE PROCEDURE gp._RequireAdminReadCapability @Actor uniqueidentifier,@Capability varchar(40),@Now datetime2(3)
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId
        WHERE g.UserId=@Actor AND c.CapabilityCode=@Capability AND g.RoleCode IN('INDIA_ADMIN','LOCATION_ADMIN','PROJECT_ADMIN')
        AND gp._RoleCapabilityAllowed(g.RoleCode,@Capability)=1 AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@Now AND (g.ValidUntilUtc IS NULL OR @Now<g.ValidUntilUtc))
        THROW 52001,'Not authorized.',1;
END;
GO
CREATE PROCEDURE gp.ListAdminProjectLocations
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@PageSize int=25,@AfterProjectLocationId bigint=NULL
AS
BEGIN
    SET NOCOUNT ON;SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
    IF @LocationId IS NULL OR @LocationId<=0 OR @PageSize IS NULL OR @PageSize NOT BETWEEN 1 AND 50 OR @AfterProjectLocationId<=0 THROW 52002,'Invalid project page.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@result nvarchar(max),@more bit,@after bigint,@global bit;
    DECLARE @page table(Id bigint PRIMARY KEY);
    BEGIN TRY
        BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        SET @global=gp._AdminScopeAllowed(@actor,'ROLE_GRANTS_MANAGE',NULL,NULL,@now);
        IF @global=0 EXEC gp._RequireAdminReadCapability @actor,'GUARDS_MANAGE',@now;
        IF NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@LocationId) THROW 52001,'Not authorized.',1;
        INSERT @page SELECT TOP(@PageSize+1) pl.ProjectLocationId FROM gp.ProjectLocations pl WHERE pl.LocationId=@LocationId
            AND (@AfterProjectLocationId IS NULL OR pl.ProjectLocationId>@AfterProjectLocationId)
            AND (@global=1 OR gp._AdminScopeAllowed(@actor,'GUARDS_MANAGE',pl.LocationId,pl.ProjectLocationId,@now)=1) ORDER BY pl.ProjectLocationId;
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        SET @global=gp._AdminScopeAllowed(@actor,'ROLE_GRANTS_MANAGE',NULL,NULL,@now);
        IF @global=0 EXEC gp._RequireAdminReadCapability @actor,'GUARDS_MANAGE',@now;
        IF EXISTS(SELECT 1 FROM @page pg JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=pg.Id WHERE @global=0 AND gp._AdminScopeAllowed(@actor,'GUARDS_MANAGE',pl.LocationId,pl.ProjectLocationId,@now)=0) THROW 52001,'Scope changed during read.',1;
        EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
        SET @more=CASE WHEN (SELECT COUNT(*) FROM @page)>@PageSize THEN 1 ELSE 0 END;
        IF @more=1 DELETE @page WHERE Id=(SELECT MAX(Id) FROM @page);
        IF @more=1 SELECT @after=MAX(Id) FROM @page;
        SET @result=(SELECT JSON_QUERY(COALESCE((SELECT CONVERT(varchar(20),pl.ProjectLocationId) projectLocationId,CONVERT(varchar(20),pl.ProjectId) projectId,pl.LocationId locationId,
            l.LocationName locationName,p.ExternalProjectCode projectCode,p.ProjectName projectName,
            CONVERT(bit,CASE WHEN pl.IsActive=1 AND p.IsActive=1 AND l.IsActive=1 THEN 1 ELSE 0 END) active,
            CONVERT(bit,CASE WHEN pl.IsActive=1 AND p.IsActive=1 AND l.IsActive=1 AND p.LastSyncedAtUtc BETWEEN @cutoff AND @now
                AND gp._AdminScopeAllowed(@actor,'GUARDS_MANAGE',pl.LocationId,pl.ProjectLocationId,@now)=1 THEN 1 ELSE 0 END) canAllocate
            FROM @page pg JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=pg.Id JOIN gp.Projects p ON p.ProjectId=pl.ProjectId JOIN gp.Locations l ON l.LocationId=pl.LocationId ORDER BY pl.ProjectLocationId FOR JSON PATH),N'[]')) projects,
            @more hasMore,CONVERT(varchar(20),@after) afterProjectLocationId,REPLACE(CONVERT(char(23),@now,121),' ','T')+'Z' checkedAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,LocationId,ResultCode) VALUES(@actor,'ADMIN_PROJECTS_READ','ADMIN_QUERY',@LocationId,'SUCCESS');
        COMMIT;SELECT @result;
    END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp.ListAdminGuards
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ProjectLocationId bigint,@ValidFromUtc datetime2(3)=NULL,@ValidUntilUtc datetime2(3)=NULL,
    @NamePrefix nvarchar(max)=NULL,@PageSize int=25,@AfterUserId uniqueidentifier=NULL
AS
BEGIN
    SET NOCOUNT ON;SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
    IF @ProjectLocationId IS NULL OR @ProjectLocationId<=0 OR @PageSize IS NULL OR @PageSize NOT BETWEEN 1 AND 50
        OR (@NamePrefix IS NOT NULL AND (DATALENGTH(@NamePrefix)>160 OR LEN(LTRIM(RTRIM(@NamePrefix)))<2)) THROW 52002,'Invalid guard selector.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@start datetime2(3),@location int,@cutoff datetime2(3),@ready bit,@result nvarchar(max),@more bit,@after uniqueidentifier;
    DECLARE @page table(Id uniqueidentifier PRIMARY KEY);
    BEGIN TRY
        BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        SELECT @location=LocationId FROM gp.ProjectLocations WHERE ProjectLocationId=@ProjectLocationId;
        IF gp._AdminScopeAllowed(@actor,'GUARDS_MANAGE',@location,@ProjectLocationId,@now)=0 THROW 52001,'Not authorized.',1;
        SET @start=COALESCE(@ValidFromUtc,@now);
        IF @start<@now OR @ValidUntilUtc<=@start THROW 52002,'Invalid guard interval.',1;
        DECLARE @pattern nvarchar(400)=REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(@NamePrefix)),N'~',N'~~'),N'%',N'~%'),N'_',N'~_'),N'[',N'~[')+N'%';
        INSERT @page SELECT TOP(@PageSize+1) u.UserId FROM gp.Users u WHERE gp._GuardAllocationEligible(u.UserId,@location,@start,@ValidUntilUtc)=1
            AND (@AfterUserId IS NULL OR u.UserId>@AfterUserId) AND (@NamePrefix IS NULL OR u.DisplayName LIKE @pattern ESCAPE N'~') ORDER BY u.UserId;
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        IF gp._AdminScopeAllowed(@actor,'GUARDS_MANAGE',@location,@ProjectLocationId,@now)=0 THROW 52001,'Scope changed during read.',1;
        SET @start=COALESCE(@ValidFromUtc,@now);EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
        DELETE @page WHERE gp._GuardAllocationEligible(Id,@location,@start,@ValidUntilUtc)=0;
        SET @ready=CASE WHEN EXISTS(SELECT 1 FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId JOIN gp.Locations l ON l.LocationId=pl.LocationId
            WHERE pl.ProjectLocationId=@ProjectLocationId AND pl.IsActive=1 AND p.IsActive=1 AND l.IsActive=1 AND p.LastSyncedAtUtc BETWEEN @cutoff AND @now) THEN 1 ELSE 0 END;
        SET @more=CASE WHEN (SELECT COUNT(*) FROM @page)>@PageSize THEN 1 ELSE 0 END;
        IF @more=1 DELETE @page WHERE Id=(SELECT TOP(1) Id FROM @page ORDER BY Id DESC);
        IF @more=1 SELECT TOP(1) @after=Id FROM @page ORDER BY Id DESC;
        SET @result=(SELECT JSON_QUERY(COALESCE((SELECT u.UserId userId,u.DisplayName displayName,
            CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM gp.GuardAssignments a WHERE a.GuardUserId=u.UserId AND a.ProjectLocationId=@ProjectLocationId AND a.DeallocatedAtUtc IS NULL
                AND (@ValidUntilUtc IS NULL OR a.ValidFromUtc<@ValidUntilUtc) AND (a.ValidUntilUtc IS NULL OR @start<a.ValidUntilUtc)) THEN 1 ELSE 0 END) overlappingAssignment,
            CONVERT(bit,CASE WHEN @ready=1 AND NOT EXISTS(SELECT 1 FROM gp.GuardAssignments a WHERE a.GuardUserId=u.UserId AND a.ProjectLocationId=@ProjectLocationId AND a.DeallocatedAtUtc IS NULL
                AND (@ValidUntilUtc IS NULL OR a.ValidFromUtc<@ValidUntilUtc) AND (a.ValidUntilUtc IS NULL OR @start<a.ValidUntilUtc)) THEN 1 ELSE 0 END) canAllocate
            FROM @page pg JOIN gp.Users u ON u.UserId=pg.Id ORDER BY u.UserId FOR JSON PATH),N'[]')) guards,
            @more hasMore,@after afterUserId,REPLACE(CONVERT(char(23),@now,121),' ','T')+'Z' checkedAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,LocationId,ProjectLocationId,ResultCode) VALUES(@actor,'ADMIN_GUARDS_READ','ADMIN_QUERY',@location,@ProjectLocationId,'SUCCESS');
        COMMIT;SELECT @result;
    END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp.SearchStaffSubjects
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@NamePrefix nvarchar(max),@PageSize int=25,@AfterUserId uniqueidentifier=NULL
AS
BEGIN
    SET NOCOUNT ON;SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
    IF @NamePrefix IS NULL OR DATALENGTH(@NamePrefix)>160 OR LEN(LTRIM(RTRIM(@NamePrefix)))<2 OR @PageSize IS NULL OR @PageSize NOT BETWEEN 1 AND 50 THROW 52002,'Invalid staff search.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@result nvarchar(max),@more bit,@after uniqueidentifier;
    DECLARE @page table(Id uniqueidentifier PRIMARY KEY);
    BEGIN TRY
        BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._RequireRoleAdministrator @actor,@now;
        DECLARE @pattern nvarchar(400)=REPLACE(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(@NamePrefix)),N'~',N'~~'),N'%',N'~%'),N'_',N'~_'),N'[',N'~[')+N'%';
        INSERT @page SELECT TOP(@PageSize+1) UserId FROM gp.Users WHERE (@AfterUserId IS NULL OR UserId>@AfterUserId) AND DisplayName LIKE @pattern ESCAPE N'~' ORDER BY UserId;
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._RequireRoleAdministrator @actor,@now;
        SET @more=CASE WHEN (SELECT COUNT(*) FROM @page)>@PageSize THEN 1 ELSE 0 END;
        IF @more=1 DELETE @page WHERE Id=(SELECT TOP(1) Id FROM @page ORDER BY Id DESC);
        IF @more=1 SELECT TOP(1) @after=Id FROM @page ORDER BY Id DESC;
        SET @result=(SELECT JSON_QUERY(COALESCE((SELECT u.UserId userId,u.DisplayName displayName,u.IsActive active FROM @page pg JOIN gp.Users u ON u.UserId=pg.Id ORDER BY u.UserId FOR JSON PATH),N'[]')) users,
            @more hasMore,@after afterUserId,REPLACE(CONVERT(char(23),@now,121),' ','T')+'Z' checkedAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,ResultCode) VALUES(@actor,'STAFF_SUBJECTS_READ','ADMIN_QUERY','SUCCESS');
        COMMIT;SELECT @result;
    END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp.ListStaffRoles
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@TargetUserId uniqueidentifier,@State varchar(8000)='CURRENT',@PageSize int=25,@AfterRoleGrantId bigint=NULL
AS
BEGIN
    SET NOCOUNT ON;SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
    IF @TargetUserId IS NULL OR @State IS NULL OR DATALENGTH(@State)<>LEN(@State) OR @State COLLATE Latin1_General_100_BIN2 NOT IN('CURRENT','ALL')
        OR @PageSize IS NULL OR @PageSize NOT BETWEEN 1 AND 50 OR @AfterRoleGrantId<=0 THROW 52002,'Invalid role page.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@result nvarchar(max),@more bit,@after bigint;
    DECLARE @page table(Id bigint PRIMARY KEY);
    BEGIN TRY
        BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._RequireRoleAdministrator @actor,@now;
        INSERT @page SELECT TOP(@PageSize+1) RoleGrantId FROM gp.StaffRoleGrants WHERE UserId=@TargetUserId AND (@AfterRoleGrantId IS NULL OR RoleGrantId>@AfterRoleGrantId)
            AND (@State='ALL' OR RevokedAtUtc IS NULL AND ValidFromUtc<=@now AND (ValidUntilUtc IS NULL OR @now<ValidUntilUtc)) ORDER BY RoleGrantId;
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._RequireRoleAdministrator @actor,@now;
        IF @State='CURRENT' DELETE pg FROM @page pg JOIN gp.StaffRoleGrants g ON g.RoleGrantId=pg.Id WHERE g.RevokedAtUtc IS NOT NULL OR g.ValidFromUtc>@now OR g.ValidUntilUtc<=@now;
        SET @more=CASE WHEN (SELECT COUNT(*) FROM @page)>@PageSize THEN 1 ELSE 0 END;
        IF @more=1 DELETE @page WHERE Id=(SELECT MAX(Id) FROM @page);
        IF @more=1 SELECT @after=MAX(Id) FROM @page;
        SET @result=(SELECT JSON_QUERY(COALESCE((SELECT CONVERT(varchar(20),g.RoleGrantId) roleGrantId,g.UserId userId,g.RoleCode roleCode,g.ScopeType scopeType,
            g.LocationId locationId,CONVERT(varchar(20),g.ProjectId) projectId,CONVERT(varchar(20),g.ProjectLocationId) projectLocationId,
            REPLACE(CONVERT(char(23),g.ValidFromUtc,121),' ','T')+'Z' validFromUtc,
            CASE WHEN g.ValidUntilUtc IS NOT NULL THEN REPLACE(CONVERT(char(23),g.ValidUntilUtc,121),' ','T')+'Z' END validUntilUtc,
            CONVERT(bit,CASE WHEN g.RevokedAtUtc IS NULL THEN 0 ELSE 1 END) revoked,
            JSON_QUERY(COALESCE((SELECT N'['+STRING_AGG(CONVERT(nvarchar(max),QUOTENAME(CapabilityCode,'"')),N',') WITHIN GROUP(ORDER BY CapabilityCode)+N']' FROM gp.GrantCapabilities WHERE RoleGrantId=g.RoleGrantId),N'[]')) capabilities
            FROM @page pg JOIN gp.StaffRoleGrants g ON g.RoleGrantId=pg.Id ORDER BY g.RoleGrantId FOR JSON PATH,INCLUDE_NULL_VALUES),N'[]')) grants,
            @more hasMore,CONVERT(varchar(20),@after) afterRoleGrantId,REPLACE(CONVERT(char(23),@now,121),' ','T')+'Z' checkedAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,ResultCode) VALUES(@actor,'STAFF_ROLES_READ','ADMIN_QUERY','SUCCESS');
        COMMIT;SELECT @result;
    END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp.GetOperationalSummary
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@LocalVisitDate date,@ProjectLocationId bigint=NULL
AS
BEGIN
    SET NOCOUNT ON;SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
    IF @LocationId IS NULL OR @LocationId<=0 OR @LocalVisitDate IS NULL OR @ProjectLocationId<=0 THROW 52002,'Invalid report scope.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@today date,@result nvarchar(max);
    DECLARE @rows table(LocationId int,Pair bigint NULL,Day date,Kind varchar(24),State varchar(12),Inside bit);
    BEGIN TRY
        BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._RequireAdminReadCapability @actor,'REPORTS_READ',@now;
        IF NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@LocationId) OR (@ProjectLocationId IS NOT NULL AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',@LocationId,@ProjectLocationId,@now)=0)
            OR (@ProjectLocationId IS NULL AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',@LocationId,NULL,@now)=0 AND NOT EXISTS(SELECT 1 FROM gp.ProjectLocations pl WHERE pl.LocationId=@LocationId AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',@LocationId,pl.ProjectLocationId,@now)=1)) THROW 52001,'Not authorized for report scope.',1;
        SET @today=CONVERT(date,DATEADD(minute,330,@now));
        IF @LocalVisitDate<DATEADD(day,-30,@today) OR @LocalVisitDate>DATEADD(day,90,@today) THROW 52002,'Report day outside operational range.',1;
        INSERT @rows SELECT v.LocationId,v.ProjectLocationId,v.LocalVisitDate,v.RequestType,v.Status,s.IsInside FROM gp.VisitRequests v JOIN gp.VisitPresence s ON s.VisitRequestId=v.VisitRequestId
            WHERE v.LocationId=@LocationId AND (@ProjectLocationId IS NULL OR v.ProjectLocationId=@ProjectLocationId)
            AND (v.LocalVisitDate=@LocalVisitDate OR s.IsInside=1) AND gp._AdminScopeAllowed(@actor,'REPORTS_READ',v.LocationId,v.ProjectLocationId,@now)=1;
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._RequireAdminReadCapability @actor,'REPORTS_READ',@now;
        IF EXISTS(SELECT 1 FROM @rows WHERE gp._AdminScopeAllowed(@actor,'REPORTS_READ',LocationId,Pair,@now)=0) THROW 52001,'Scope changed during read.',1;
        SET @result=(SELECT @LocalVisitDate localVisitDate,
            JSON_QUERY((SELECT CONVERT(varchar(20),COUNT_BIG(*)) total,CONVERT(varchar(20),COUNT_BIG(CASE WHEN State='PENDING' THEN 1 END)) pending,
                CONVERT(varchar(20),COUNT_BIG(CASE WHEN State='APPROVED' THEN 1 END)) approved,CONVERT(varchar(20),COUNT_BIG(CASE WHEN State='DENIED' THEN 1 END)) denied,
                CONVERT(varchar(20),COUNT_BIG(CASE WHEN State='CANCELLED' THEN 1 END)) cancelled FROM @rows WHERE Day=@LocalVisitDate FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) visits,
            JSON_QUERY((SELECT CONVERT(varchar(20),COUNT_BIG(CASE WHEN Kind<>'TEMP_ID' AND Inside=1 THEN 1 END)) projectVisitsInside,
                CONVERT(varchar(20),COUNT_BIG(CASE WHEN Kind='TEMP_ID' AND Inside=1 THEN 1 END)) digitalIdsInside FROM @rows FOR JSON PATH,WITHOUT_ARRAY_WRAPPER)) recordedPresence,
            REPLACE(CONVERT(char(23),@now,121),' ','T')+'Z' checkedAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,LocationId,ProjectLocationId,ResultCode) VALUES(@actor,'OPERATIONAL_SUMMARY_READ','REPORT_QUERY',@LocationId,@ProjectLocationId,'SUCCESS');
        COMMIT;SELECT @result;
    END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp.ListScopedAuditEvents
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@FromUtc datetime2(3),@UntilUtc datetime2(3),@LocationId int=NULL,@ProjectLocationId bigint=NULL,
    @PageSize int=25,@AfterAuditEventId bigint=NULL
AS
BEGIN
    SET NOCOUNT ON;SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
    IF @FromUtc IS NULL OR @UntilUtc IS NULL OR @FromUtc>=@UntilUtc OR @UntilUtc>DATEADD(day,31,@FromUtc) OR @LocationId<=0 OR @ProjectLocationId<=0
        OR @PageSize IS NULL OR @PageSize NOT BETWEEN 1 AND 50 OR @AfterAuditEventId<=0 THROW 52002,'Invalid bounded audit page.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@result nvarchar(max),@more bit,@after bigint;
    DECLARE @page table(Id bigint PRIMARY KEY);
    BEGIN TRY
        BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._RequireAdminReadCapability @actor,'AUDIT_READ',@now;
        IF @LocationId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@LocationId) THROW 52002,'Invalid audit location.',1;
        IF @FromUtc>@now OR @UntilUtc>DATEADD(day,1,@now) THROW 52002,'Audit window is in the future.',1;
        IF @ProjectLocationId IS NOT NULL AND (@LocationId IS NULL OR NOT EXISTS(SELECT 1 FROM gp.ProjectLocations WHERE ProjectLocationId=@ProjectLocationId AND LocationId=@LocationId)) THROW 52002,'Audit pair requires its matching location.',1;
        INSERT @page SELECT TOP(@PageSize+1) a.AuditEventId FROM gp.SecurityAuditEvents a WHERE a.OccurredAtUtc>=@FromUtc AND a.OccurredAtUtc<@UntilUtc
            AND (@AfterAuditEventId IS NULL OR a.AuditEventId<@AfterAuditEventId) AND (@LocationId IS NULL OR a.LocationId=@LocationId)
            AND (@ProjectLocationId IS NULL OR a.ProjectLocationId=@ProjectLocationId) AND gp._AuditEventReadAllowed(@actor,a.AuditEventId,@now)=1 ORDER BY a.AuditEventId DESC;
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._RequireAdminReadCapability @actor,'AUDIT_READ',@now;
        IF EXISTS(SELECT 1 FROM @page WHERE gp._AuditEventReadAllowed(@actor,Id,@now)=0) THROW 52001,'Audit scope changed during read.',1;
        SET @more=CASE WHEN (SELECT COUNT(*) FROM @page)>@PageSize THEN 1 ELSE 0 END;
        IF @more=1 DELETE @page WHERE Id=(SELECT MIN(Id) FROM @page);
        IF @more=1 SELECT @after=MIN(Id) FROM @page;
        SET @result=(SELECT JSON_QUERY(COALESCE((SELECT CONVERT(varchar(20),a.AuditEventId) auditEventId,a.ActionCode actionCode,a.TargetType targetType,a.ResultCode resultCode,
            a.LocationId locationId,CONVERT(varchar(20),a.ProjectLocationId) projectLocationId,COALESCE(u.DisplayName,N'System') actorDisplayName,
            REPLACE(CONVERT(char(23),a.OccurredAtUtc,121),' ','T')+'Z' occurredAtUtc
            FROM @page pg JOIN gp.SecurityAuditEvents a ON a.AuditEventId=pg.Id LEFT JOIN gp.Users u ON u.UserId=a.ActorUserId ORDER BY a.AuditEventId DESC FOR JSON PATH,INCLUDE_NULL_VALUES),N'[]')) events,
            @more hasMore,CONVERT(varchar(20),@after) afterAuditEventId,REPLACE(CONVERT(char(23),@now,121),' ','T')+'Z' checkedAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,LocationId,ProjectLocationId,ResultCode) VALUES(@actor,'SCOPED_AUDIT_READ','AUDIT_QUERY',@LocationId,@ProjectLocationId,'SUCCESS');
        COMMIT;SELECT @result;
    END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON gp.ListAdminProjectLocations TO gp_api_runtime;
GRANT EXECUTE ON gp.ListAdminGuards TO gp_api_runtime;
GRANT EXECUTE ON gp.SearchStaffSubjects TO gp_api_runtime;
GRANT EXECUTE ON gp.ListStaffRoles TO gp_api_runtime;
GRANT EXECUTE ON gp.GetOperationalSummary TO gp_api_runtime;
GRANT EXECUTE ON gp.ListScopedAuditEvents TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('019',N'Scoped admin selectors, explicit role history, operational summary and redacted audit paging');
COMMIT;

