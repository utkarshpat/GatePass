/* Keep country-wide subject discovery and scope-filtered role visibility separate from mutation authority. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='033') THROW 53600,'Migration 033 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='034') THROW 53600,'Migration 034 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
ALTER PROCEDURE gp.SearchStaffSubjects
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
        INSERT @page SELECT TOP(@PageSize+1) UserId FROM gp.Users WHERE (gp._AdminScopeAllowed(@actor,'ROLE_GRANTS_MANAGE',NULL,NULL,@now)=1 OR UserId=@actor OR EXISTS(SELECT 1 FROM gp.Employees e WHERE e.UserId=gp.Users.UserId AND e.IsActive=1) OR EXISTS(SELECT 1 FROM gp.StaffRoleGrants t WHERE t.UserId=gp.Users.UserId AND gp._StaffRoleDelegationAllowed(@actor,t.RoleCode,t.ScopeType,t.LocationId,t.ProjectId,t.ProjectLocationId,@now)=1)) AND (@AfterUserId IS NULL OR UserId>@AfterUserId) AND DisplayName LIKE @pattern ESCAPE N'~' ORDER BY UserId;
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
ALTER PROCEDURE gp.ListStaffRoles
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
        INSERT @page SELECT TOP(@PageSize+1) RoleGrantId FROM gp.StaffRoleGrants WHERE UserId=@TargetUserId AND (UserId=@actor OR (ScopeType<>'PLATFORM' AND gp._AdminScopeAllowed(@actor,'ROLE_GRANTS_MANAGE',COALESCE(LocationId,(SELECT pl.LocationId FROM gp.ProjectLocations pl WHERE pl.ProjectLocationId=gp.StaffRoleGrants.ProjectLocationId)),ProjectLocationId,@now)=1) OR gp._StaffRoleDelegationAllowed(@actor,RoleCode,ScopeType,LocationId,ProjectId,ProjectLocationId,@now)=1) AND (@AfterRoleGrantId IS NULL OR RoleGrantId>@AfterRoleGrantId)
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
ALTER FUNCTION gp._HasCapability(
    @Actor uniqueidentifier, @Capability varchar(40), @LocationId int,
    @ProjectLocationId bigint, @GuardOnly bit, @Now datetime2(3)
) RETURNS bit
AS
BEGIN
    DECLARE @allowed bit=0;
    IF EXISTS(
        SELECT 1 FROM gp.StaffRoleGrants g
        JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId
        LEFT JOIN gp.ProjectLocations target ON target.ProjectLocationId=@ProjectLocationId
        WHERE g.UserId=@Actor AND c.CapabilityCode=@Capability
          AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@Now
          AND (g.ValidUntilUtc IS NULL OR @Now<g.ValidUntilUtc)
          AND ((@GuardOnly=1 AND g.RoleCode='GUARD' AND g.ScopeType='LOCATION'
                AND @Capability IN ('PROJECT_MOVEMENT','TEMP_ID_MOVEMENT','RECONCILE_EXIT'))
            OR (@GuardOnly=0 AND g.RoleCode IN ('INDIA_ADMIN','LOCATION_ADMIN','PROJECT_ADMIN','PLATFORM_ADMIN')
                AND @Capability='GUARDS_MANAGE'))
          AND ((g.ScopeType='INDIA' AND g.RoleCode='INDIA_ADMIN') OR (g.ScopeType='PLATFORM' AND g.RoleCode='PLATFORM_ADMIN')
            OR (g.ScopeType='LOCATION' AND g.LocationId=@LocationId)
            OR (g.ScopeType='PROJECT' AND g.ProjectId=target.ProjectId)
            OR (g.ScopeType='PROJECT_LOCATION' AND g.ProjectLocationId=@ProjectLocationId))
    ) SET @allowed=1;
    RETURN @allowed;
END;
GO
ALTER FUNCTION gp._AdminScopeAllowed(@Actor uniqueidentifier,@Capability varchar(40),@Location int,@Pair bigint,@Now datetime2(3))
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
        WHERE g.UserId=@Actor AND c.CapabilityCode=@Capability AND g.RoleCode IN('INDIA_ADMIN','LOCATION_ADMIN','PROJECT_ADMIN','PLATFORM_ADMIN')
        AND gp._RoleCapabilityAllowed(g.RoleCode,@Capability)=1 AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@Now AND (g.ValidUntilUtc IS NULL OR @Now<g.ValidUntilUtc)
        AND ((g.RoleCode='INDIA_ADMIN' AND g.ScopeType='INDIA') OR (g.RoleCode='PLATFORM_ADMIN' AND g.ScopeType='PLATFORM')
            OR (g.RoleCode='LOCATION_ADMIN' AND g.ScopeType='LOCATION' AND @Location IS NOT NULL AND g.LocationId=@Location)
            OR (g.RoleCode='PROJECT_ADMIN' AND @Pair IS NOT NULL AND ((g.ScopeType='PROJECT' AND g.ProjectId=@project) OR (g.ScopeType='PROJECT_LOCATION' AND g.ProjectLocationId=@Pair)))))
        RETURN 1;
    RETURN 0;
END;
GO
ALTER PROCEDURE gp._RequireAdminReadCapability @Actor uniqueidentifier,@Capability varchar(40),@Now datetime2(3)
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId
        WHERE g.UserId=@Actor AND c.CapabilityCode=@Capability AND g.RoleCode IN('INDIA_ADMIN','LOCATION_ADMIN','PROJECT_ADMIN','PLATFORM_ADMIN')
        AND gp._RoleCapabilityAllowed(g.RoleCode,@Capability)=1 AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@Now AND (g.ValidUntilUtc IS NULL OR @Now<g.ValidUntilUtc))
        THROW 52001,'Not authorized.',1;
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('034',N'Country-wide staff discovery with bounded role visibility and unchanged mutation policy');
COMMIT;
