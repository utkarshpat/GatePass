/* Project leads use employee SSO; explicitly permit guard/reception dual duty. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='031') THROW 53600,'Migration 031 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='032') THROW 53600,'Migration 032 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
ALTER FUNCTION gp._StaffLocalIdentityEligible(@UserId uniqueidentifier,@Now datetime2(3)) RETURNS bit
AS BEGIN
 IF NOT EXISTS(SELECT 1 FROM gp.Users u JOIN gp.StaffProfiles s ON s.UserId=u.UserId WHERE u.UserId=@UserId AND u.IsActive=1 AND s.IsActive=1) RETURN 0;
 IF EXISTS(SELECT 1 FROM gp.Employees WHERE UserId=@UserId) RETURN 0;
 IF EXISTS(SELECT 1 FROM gp.StaffRoleGrants WHERE UserId=@UserId AND RoleCode='PROJECT_ADMIN' AND RevokedAtUtc IS NULL AND ValidFromUtc<=@Now AND (ValidUntilUtc IS NULL OR @Now<ValidUntilUtc)) RETURN 0;
 IF NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants g LEFT JOIN gp.Locations l ON l.LocationId=g.LocationId LEFT JOIN gp.Projects p ON p.ProjectId=g.ProjectId LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=g.ProjectLocationId LEFT JOIN gp.Locations ll ON ll.LocationId=pl.LocationId LEFT JOIN gp.Projects pp ON pp.ProjectId=pl.ProjectId
 WHERE g.UserId=@UserId AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@Now AND (g.ValidUntilUtc IS NULL OR @Now<g.ValidUntilUtc)
 AND ((g.RoleCode='INDIA_ADMIN' AND g.ScopeType='INDIA') OR (g.RoleCode IN('GUARD','RECEPTION','LOCATION_ADMIN') AND g.ScopeType='LOCATION' AND l.IsActive=1) OR(g.RoleCode='PROJECT_ADMIN' AND ((g.ScopeType='PROJECT' AND p.IsActive=1) OR(g.ScopeType='PROJECT_LOCATION' AND pl.IsActive=1 AND ll.IsActive=1 AND pp.IsActive=1))))) RETURN 0;
 RETURN 1;
END;
GO
ALTER PROCEDURE gp.GrantStaffRole
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ClientKey uniqueidentifier,@TargetUserId uniqueidentifier,
    @RoleCode varchar(8000),@ScopeType varchar(8000),@LocationId int=NULL,@ProjectId bigint=NULL,@ProjectLocationId bigint=NULL,
    @ValidFromUtc datetime2(3)=NULL,@ValidUntilUtc datetime2(3)=NULL,@CapabilitiesJson nvarchar(max)=NULL,@Reason nvarchar(max)=NULL
AS
BEGIN
    SET NOCOUNT ON;SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@op uniqueidentifier,@cached nvarchar(max),@result nvarchar(max);
    BEGIN TRY
        IF @TargetUserId IS NULL OR @RoleCode IS NULL OR DATALENGTH(@RoleCode)<>LEN(@RoleCode) OR @RoleCode COLLATE Latin1_General_100_BIN2 NOT IN('GUARD','RECEPTION','PROJECT_ADMIN','LOCATION_ADMIN','INDIA_ADMIN')
            OR @ScopeType IS NULL OR DATALENGTH(@ScopeType)<>LEN(@ScopeType) OR @ScopeType COLLATE Latin1_General_100_BIN2 NOT IN('LOCATION','PROJECT','PROJECT_LOCATION','INDIA')
            OR @Reason IS NULL OR DATALENGTH(@Reason)>600 OR LEN(LTRIM(RTRIM(@Reason)))=0 OR @CapabilitiesJson IS NULL OR DATALENGTH(@CapabilitiesJson)>2000
            OR ISJSON(@CapabilitiesJson)<>1 OR LEFT(LTRIM(@CapabilitiesJson),1)<>'[' THROW 52002,'Invalid role input.',1;
        IF CASE WHEN ((@RoleCode='INDIA_ADMIN' AND @ScopeType='INDIA' AND @LocationId IS NULL AND @ProjectId IS NULL AND @ProjectLocationId IS NULL)
            OR (@RoleCode IN('GUARD','RECEPTION','LOCATION_ADMIN') AND @ScopeType='LOCATION' AND @LocationId>0 AND @ProjectId IS NULL AND @ProjectLocationId IS NULL)
            OR (@RoleCode='PROJECT_ADMIN' AND @LocationId IS NULL AND ((@ScopeType='PROJECT' AND @ProjectId>0 AND @ProjectLocationId IS NULL)
                OR (@ScopeType='PROJECT_LOCATION' AND @ProjectLocationId>0 AND @ProjectId IS NULL)))) THEN 1 ELSE 0 END=0
            THROW 52002,'Role and scope do not match.',1;
        DECLARE @caps table(Code varchar(40) COLLATE Latin1_General_100_BIN2 PRIMARY KEY);
        IF (SELECT COUNT(*) FROM OPENJSON(@CapabilitiesJson)) NOT BETWEEN 1 AND 8
            OR EXISTS(SELECT 1 FROM OPENJSON(@CapabilitiesJson) WHERE type<>1 OR DATALENGTH(value)<>LEN(value)*2 OR DATALENGTH(value)>80 OR gp._RoleCapabilityAllowed(@RoleCode,CONVERT(varchar(40),value))=0)
            OR EXISTS(SELECT value COLLATE Latin1_General_100_BIN2 FROM OPENJSON(@CapabilitiesJson) GROUP BY value COLLATE Latin1_General_100_BIN2 HAVING COUNT(*)>1)
            THROW 52002,'Capabilities are not an explicit eligible unique set.',1;
        INSERT @caps SELECT CONVERT(varchar(40),value) FROM OPENJSON(@CapabilitiesJson);
        DECLARE @capsJson nvarchar(max)=(SELECT N'['+STRING_AGG(CONVERT(nvarchar(max),QUOTENAME(Code,'"')),N',') WITHIN GROUP(ORDER BY Code)+N']' FROM @caps);
        BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._RequireRoleAdministrator @actor,@now;
        IF @TargetUserId=@actor THROW 52001,'Self role changes are not authorized.',1;
        DECLARE @payload nvarchar(max)=(SELECT @TargetUserId targetUserId,@RoleCode roleCode,@ScopeType scopeType,@LocationId locationId,@ProjectId projectId,@ProjectLocationId projectLocationId,
            @ValidFromUtc validFromUtc,@ValidUntilUtc validUntilUtc,JSON_QUERY(@capsJson) capabilities,@Reason reason FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER);
        EXEC gp._BeginOperation @actor,'GRANT_STAFF_ROLE',@ClientKey,@payload,@op OUTPUT,@cached OUTPUT;
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._RequireRoleAdministrator @actor,@now;
        IF @cached IS NOT NULL BEGIN COMMIT;SELECT @cached;RETURN;END;
        DECLARE @start datetime2(3)=COALESCE(@ValidFromUtc,@now);
        IF @start<@now OR (@ValidUntilUtc IS NOT NULL AND @ValidUntilUtc<=@start) THROW 52002,'Role interval must start now or in the future.',1;
        IF NOT EXISTS(SELECT 1 FROM gp.Users WHERE UserId=@TargetUserId AND IsActive=1) THROW 52004,'Active target user required.',1;
        IF (@LocationId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@LocationId AND IsActive=1))
            OR (@ProjectId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gp.Projects WHERE ProjectId=@ProjectId AND IsActive=1))
            OR (@ProjectLocationId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId JOIN gp.Locations l ON l.LocationId=pl.LocationId
                WHERE pl.ProjectLocationId=@ProjectLocationId AND pl.IsActive=1 AND p.IsActive=1 AND l.IsActive=1)) THROW 52004,'Active scope required.',1;
        IF @RoleCode='PROJECT_ADMIN' AND NOT EXISTS(SELECT 1 FROM gp.Employees WHERE UserId=@TargetUserId AND IsActive=1) THROW 52004,'Project administrator requires an active employee identity.',1;
        IF EXISTS(SELECT 1 FROM gp.StaffRoleGrants g WHERE g.UserId=@TargetUserId AND g.RevokedAtUtc IS NULL
            AND (@ValidUntilUtc IS NULL OR g.ValidFromUtc<@ValidUntilUtc) AND (g.ValidUntilUtc IS NULL OR @start<g.ValidUntilUtc)
            AND ((g.RoleCode=@RoleCode AND g.ScopeType=@ScopeType AND COALESCE(g.LocationId,0)=COALESCE(@LocationId,0) AND COALESCE(g.ProjectId,0)=COALESCE(@ProjectId,0) AND COALESCE(g.ProjectLocationId,0)=COALESCE(@ProjectLocationId,0))
                OR (@RoleCode='GUARD' AND g.RoleCode NOT IN('GUARD','RECEPTION')) OR (@RoleCode NOT IN('GUARD','RECEPTION') AND g.RoleCode='GUARD')))
            THROW 52003,'Overlapping duplicate or mixed guard/staff role.',1;
        INSERT gp.StaffRoleGrants(UserId,RoleCode,ScopeType,LocationId,ProjectId,ProjectLocationId,GrantedByUserId,ValidFromUtc,ValidUntilUtc)
            VALUES(@TargetUserId,@RoleCode,@ScopeType,@LocationId,@ProjectId,@ProjectLocationId,@actor,@start,@ValidUntilUtc);
        DECLARE @id bigint=CONVERT(bigint,SCOPE_IDENTITY());
        INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT @id,Code FROM @caps;
        UPDATE gp.Users SET AuthorizationVersion=AuthorizationVersion+1 WHERE UserId=@TargetUserId;
        SET @result=(SELECT @op operationId,CONVERT(varchar(20),@id) roleGrantId,@TargetUserId targetUserId,@RoleCode roleCode,@ScopeType scopeType,'GRANTED' status FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode,MetadataJson)
            VALUES(@actor,'STAFF_ROLE_GRANTED','ROLE_GRANT',CONVERT(varchar(100),@id),@LocationId,@ProjectLocationId,'SUCCESS',JSON_MODIFY(JSON_MODIFY(@result,'$.reason',@Reason),'$.capabilities',JSON_QUERY(@capsJson)));
        EXEC gp._CompleteOperation @op,@result;COMMIT;SELECT @result;
    END TRY
    BEGIN CATCH
        DECLARE @error int=ERROR_NUMBER(),@target varchar(100)=CONVERT(varchar(100),@TargetUserId);IF @@TRANCOUNT>0 ROLLBACK;
        EXEC gp._AuditFailure @actor,'STAFF_ROLE_GRANT_FAILED',@target,@error;THROW;
    END CATCH;
END;
GO
ALTER PROCEDURE gp.AllocateGuard
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ClientKey uniqueidentifier,
    @GuardUserId uniqueidentifier,@ProjectLocationId bigint,@ValidFromUtc datetime2(3)=NULL,@ValidUntilUtc datetime2(3)=NULL,@Reason nvarchar(max)=NULL
AS
BEGIN
    SET NOCOUNT ON;SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@op uniqueidentifier,@cached nvarchar(max),@result nvarchar(max);
    BEGIN TRY
        IF @GuardUserId IS NULL OR @ProjectLocationId IS NULL OR @ProjectLocationId<=0 OR @Reason IS NULL OR DATALENGTH(@Reason)>600 OR LEN(LTRIM(RTRIM(@Reason)))=0
            OR (@ValidFromUtc IS NOT NULL AND @ValidUntilUtc IS NOT NULL AND @ValidUntilUtc<=@ValidFromUtc) THROW 52002,'Invalid allocation input.',1;
        BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        DECLARE @payload nvarchar(max)=(SELECT @GuardUserId guardUserId,@ProjectLocationId projectLocationId,@ValidFromUtc validFromUtc,@ValidUntilUtc validUntilUtc,@Reason reason FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER);
        EXEC gp._BeginOperation @actor,'ALLOCATE_GUARD',@ClientKey,@payload,@op OUTPUT,@cached OUTPUT;
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        DECLARE @location int,@project bigint,@start datetime2(3)=COALESCE(@ValidFromUtc,@now),@cutoff datetime2(3);
        SELECT @location=LocationId,@project=ProjectId FROM gp.ProjectLocations WHERE ProjectLocationId=@ProjectLocationId;
        IF @location IS NULL OR @GuardUserId=@actor OR gp._HasCapability(@actor,'GUARDS_MANAGE',@location,@ProjectLocationId,0,@now)=0 THROW 52001,'Not authorized.',1;
        IF @cached IS NOT NULL BEGIN COMMIT;SELECT @cached;RETURN;END;
        IF @start<@now OR (@ValidUntilUtc IS NOT NULL AND @ValidUntilUtc<=@start) THROW 52002,'Allocation must start now or in the future.',1;
        EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
        IF NOT EXISTS(SELECT 1 FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId JOIN gp.Locations l ON l.LocationId=pl.LocationId
            WHERE pl.ProjectLocationId=@ProjectLocationId AND pl.IsActive=1 AND p.IsActive=1 AND l.IsActive=1 AND p.LastSyncedAtUtc BETWEEN @cutoff AND @now)
            THROW 52004,'Current active project/location required.',1;
        IF NOT EXISTS(SELECT 1 FROM gp.Users WHERE UserId=@GuardUserId AND IsActive=1)
            OR NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants g WHERE g.UserId=@GuardUserId AND g.RoleCode='GUARD' AND g.ScopeType='LOCATION' AND g.LocationId=@location
                AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@start AND (g.ValidUntilUtc IS NULL OR @ValidUntilUtc IS NOT NULL AND @ValidUntilUtc<=g.ValidUntilUtc)
                AND EXISTS(SELECT 1 FROM gp.GrantCapabilities WHERE RoleGrantId=g.RoleGrantId AND CapabilityCode='PROJECT_MOVEMENT')
                AND EXISTS(SELECT 1 FROM gp.GrantCapabilities WHERE RoleGrantId=g.RoleGrantId AND CapabilityCode='VISITS_READ'))
            OR EXISTS(SELECT 1 FROM gp.StaffRoleGrants g WHERE g.UserId=@GuardUserId AND g.RoleCode NOT IN('GUARD','RECEPTION') AND g.RevokedAtUtc IS NULL
                AND (@ValidUntilUtc IS NULL OR g.ValidFromUtc<@ValidUntilUtc) AND (g.ValidUntilUtc IS NULL OR @start<g.ValidUntilUtc))
            THROW 52004,'One compatible guard role must cover the entire interval.',1;
        IF EXISTS(SELECT 1 FROM gp.GuardAssignments WHERE GuardUserId=@GuardUserId AND ProjectLocationId=@ProjectLocationId AND DeallocatedAtUtc IS NULL
            AND (@ValidUntilUtc IS NULL OR ValidFromUtc<@ValidUntilUtc) AND (ValidUntilUtc IS NULL OR @start<ValidUntilUtc))
            THROW 52003,'Guard already has an overlapping assignment for this project/location.',1;
        INSERT gp.GuardAssignments(GuardUserId,ProjectLocationId,AssignedByUserId,ValidFromUtc,ValidUntilUtc,Reason)
            VALUES(@GuardUserId,@ProjectLocationId,@actor,@start,@ValidUntilUtc,@Reason);
        DECLARE @id bigint=CONVERT(bigint,SCOPE_IDENTITY());
        UPDATE gp.Users SET AuthorizationVersion=AuthorizationVersion+1 WHERE UserId=@GuardUserId;
        SET @result=(SELECT @op operationId,CONVERT(varchar(20),@id) assignmentId,@GuardUserId guardUserId,CONVERT(varchar(20),@ProjectLocationId) projectLocationId,'ALLOCATED' status FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode,MetadataJson)
            VALUES(@actor,'GUARD_ALLOCATED','GUARD_ASSIGNMENT',CONVERT(varchar(100),@id),@location,@ProjectLocationId,'SUCCESS',JSON_MODIFY(@result,'$.reason',@Reason));
        EXEC gp._CompleteOperation @op,@result;COMMIT;SELECT @result;
    END TRY
    BEGIN CATCH
        DECLARE @error int=ERROR_NUMBER(),@target varchar(100)=CONVERT(varchar(100),@ProjectLocationId);IF @@TRANCOUNT>0 ROLLBACK;
        EXEC gp._AuditFailure @actor,'GUARD_ALLOCATION_FAILED',@target,@error;THROW;
    END CATCH;
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('032',N'Employee SSO project leads and guard/reception dual-role policy');
COMMIT;
