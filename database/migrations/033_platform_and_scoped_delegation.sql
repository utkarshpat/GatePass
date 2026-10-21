/* Platform ownership and bounded staff-role delegation. No implicit permission from a role label. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='032') THROW 53600,'Migration 032 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='033') THROW 53600,'Migration 033 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
ALTER TABLE gp.StaffRoleGrants DROP CONSTRAINT CK_StaffRoleGrants_01,CK_StaffRoleGrants_02;
ALTER TABLE gp.StaffRoleGrants WITH CHECK ADD CONSTRAINT CK_StaffRoleGrants_01 CHECK((RoleCode='PLATFORM_ADMIN' AND ScopeType='PLATFORM') OR(RoleCode='INDIA_ADMIN' AND ScopeType='INDIA') OR(RoleCode='LOCATION_ADMIN' AND ScopeType='LOCATION') OR(RoleCode='PROJECT_ADMIN' AND ScopeType IN('PROJECT','PROJECT_LOCATION')) OR(RoleCode IN('GUARD','RECEPTION') AND ScopeType='LOCATION'));
ALTER TABLE gp.StaffRoleGrants WITH CHECK ADD CONSTRAINT CK_StaffRoleGrants_02 CHECK((ScopeType IN('PLATFORM','INDIA') AND LocationId IS NULL AND ProjectId IS NULL AND ProjectLocationId IS NULL) OR(ScopeType='LOCATION' AND LocationId IS NOT NULL AND ProjectId IS NULL AND ProjectLocationId IS NULL) OR(ScopeType='PROJECT' AND LocationId IS NULL AND ProjectId IS NOT NULL AND ProjectLocationId IS NULL) OR(ScopeType='PROJECT_LOCATION' AND LocationId IS NULL AND ProjectId IS NULL AND ProjectLocationId IS NOT NULL));
GO
ALTER FUNCTION gp._RoleCapabilityAllowed(@Role varchar(24),@Capability varchar(40)) RETURNS bit
AS
BEGIN
    RETURN CASE
      WHEN @Role COLLATE Latin1_General_100_BIN2='GUARD' AND @Capability COLLATE Latin1_General_100_BIN2 IN('VISITS_READ','PROJECT_MOVEMENT','TEMP_ID_MOVEMENT','RECONCILE_EXIT') THEN 1
      WHEN @Role COLLATE Latin1_General_100_BIN2='RECEPTION' AND @Capability COLLATE Latin1_General_100_BIN2 IN('VISITS_READ','PASS_PRINT','PASS_REISSUE') THEN 1
      WHEN @Role COLLATE Latin1_General_100_BIN2='PROJECT_ADMIN' AND @Capability COLLATE Latin1_General_100_BIN2 IN('VISITS_READ','GUARDS_MANAGE','REPORTS_READ','REPORTS_EXPORT','AUDIT_READ','ROLE_GRANTS_MANAGE') THEN 1
      WHEN @Role COLLATE Latin1_General_100_BIN2='LOCATION_ADMIN' AND @Capability COLLATE Latin1_General_100_BIN2 IN('VISITS_READ','GUARDS_MANAGE','REPORTS_READ','REPORTS_EXPORT','AUDIT_READ','GUARD_CREDENTIALS_MANAGE','STAFF_CREDENTIALS_MANAGE','ROLE_GRANTS_MANAGE') THEN 1
      WHEN @Role COLLATE Latin1_General_100_BIN2='INDIA_ADMIN' AND @Capability COLLATE Latin1_General_100_BIN2 IN('VISITS_READ','GUARDS_MANAGE','REPORTS_READ','REPORTS_EXPORT','AUDIT_READ','GUARD_CREDENTIALS_MANAGE','STAFF_CREDENTIALS_MANAGE','ROLE_GRANTS_MANAGE') THEN 1
      WHEN @Role COLLATE Latin1_General_100_BIN2='PLATFORM_ADMIN' AND @Capability COLLATE Latin1_General_100_BIN2 IN('VISITS_READ','GUARDS_MANAGE','REPORTS_READ','REPORTS_EXPORT','AUDIT_READ','GUARD_CREDENTIALS_MANAGE','STAFF_CREDENTIALS_MANAGE','ROLE_GRANTS_MANAGE') THEN 1
      ELSE 0 END;
END;
GO
CREATE FUNCTION gp._StaffRoleDelegationAllowed(@Actor uniqueidentifier,@Role varchar(24),@Scope varchar(24),@Location int,@Project bigint,@Pair bigint,@Now datetime2(3)) RETURNS bit
AS BEGIN
 DECLARE @pairLocation int,@pairProject bigint;
 IF @Pair IS NOT NULL SELECT @pairLocation=LocationId,@pairProject=ProjectId FROM gp.ProjectLocations WHERE ProjectLocationId=@Pair;
 IF EXISTS(SELECT 1 FROM gp.StaffRoleGrants a JOIN gp.GrantCapabilities c ON c.RoleGrantId=a.RoleGrantId AND c.CapabilityCode='ROLE_GRANTS_MANAGE'
 LEFT JOIN gp.Locations l ON l.LocationId=a.LocationId LEFT JOIN gp.Projects p ON p.ProjectId=a.ProjectId LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=a.ProjectLocationId LEFT JOIN gp.Locations ll ON ll.LocationId=pl.LocationId LEFT JOIN gp.Projects pp ON pp.ProjectId=pl.ProjectId
 WHERE a.UserId=@Actor AND a.RevokedAtUtc IS NULL AND a.ValidFromUtc<=@Now AND(a.ValidUntilUtc IS NULL OR @Now<a.ValidUntilUtc) AND gp._RoleCapabilityAllowed(a.RoleCode,'ROLE_GRANTS_MANAGE')=1
 AND((a.RoleCode='PLATFORM_ADMIN' AND a.ScopeType='PLATFORM')
 OR(a.RoleCode='INDIA_ADMIN' AND a.ScopeType='INDIA' AND @Role NOT IN('PLATFORM_ADMIN','INDIA_ADMIN'))
 OR(a.RoleCode='LOCATION_ADMIN' AND a.ScopeType='LOCATION' AND l.IsActive=1 AND((@Role IN('GUARD','RECEPTION') AND @Scope='LOCATION' AND @Location=a.LocationId) OR(@Role='PROJECT_ADMIN' AND @Scope='PROJECT_LOCATION' AND @pairLocation=a.LocationId)))
 OR(a.RoleCode='PROJECT_ADMIN' AND @Role='PROJECT_ADMIN' AND((a.ScopeType='PROJECT' AND p.IsActive=1 AND((@Scope='PROJECT' AND @Project=a.ProjectId) OR(@Scope='PROJECT_LOCATION' AND @pairProject=a.ProjectId))) OR(a.ScopeType='PROJECT_LOCATION' AND pl.IsActive=1 AND pp.IsActive=1 AND ll.IsActive=1 AND @Scope='PROJECT_LOCATION' AND @Pair=a.ProjectLocationId))))) RETURN 1;
 RETURN 0;
END;
GO
ALTER PROCEDURE gp._RequireRoleAdministrator @Actor uniqueidentifier,@Now datetime2(3)
AS BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='ROLE_GRANTS_MANAGE' LEFT JOIN gp.Locations l ON l.LocationId=g.LocationId LEFT JOIN gp.Projects p ON p.ProjectId=g.ProjectId LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=g.ProjectLocationId LEFT JOIN gp.Projects pp ON pp.ProjectId=pl.ProjectId LEFT JOIN gp.Locations ll ON ll.LocationId=pl.LocationId
 WHERE g.UserId=@Actor AND gp._RoleCapabilityAllowed(g.RoleCode,'ROLE_GRANTS_MANAGE')=1 AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@Now AND(g.ValidUntilUtc IS NULL OR @Now<g.ValidUntilUtc)
 AND((g.RoleCode='PLATFORM_ADMIN' AND g.ScopeType='PLATFORM') OR(g.RoleCode='INDIA_ADMIN' AND g.ScopeType='INDIA') OR(g.RoleCode='LOCATION_ADMIN' AND g.ScopeType='LOCATION' AND l.IsActive=1) OR(g.RoleCode='PROJECT_ADMIN' AND((g.ScopeType='PROJECT' AND p.IsActive=1) OR(g.ScopeType='PROJECT_LOCATION' AND pl.IsActive=1 AND pp.IsActive=1 AND ll.IsActive=1))))) THROW 52001,'Not authorized.',1;
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
        IF @TargetUserId IS NULL OR @RoleCode IS NULL OR DATALENGTH(@RoleCode)<>LEN(@RoleCode) OR @RoleCode COLLATE Latin1_General_100_BIN2 NOT IN('GUARD','RECEPTION','PROJECT_ADMIN','LOCATION_ADMIN','INDIA_ADMIN','PLATFORM_ADMIN')
            OR @ScopeType IS NULL OR DATALENGTH(@ScopeType)<>LEN(@ScopeType) OR @ScopeType COLLATE Latin1_General_100_BIN2 NOT IN('LOCATION','PROJECT','PROJECT_LOCATION','INDIA','PLATFORM')
            OR @Reason IS NULL OR DATALENGTH(@Reason)>600 OR LEN(LTRIM(RTRIM(@Reason)))=0 OR @CapabilitiesJson IS NULL OR DATALENGTH(@CapabilitiesJson)>2000
            OR ISJSON(@CapabilitiesJson)<>1 OR LEFT(LTRIM(@CapabilitiesJson),1)<>'[' THROW 52002,'Invalid role input.',1;
        IF CASE WHEN ((@RoleCode='PLATFORM_ADMIN' AND @ScopeType='PLATFORM' AND @LocationId IS NULL AND @ProjectId IS NULL AND @ProjectLocationId IS NULL) OR (@RoleCode='INDIA_ADMIN' AND @ScopeType='INDIA' AND @LocationId IS NULL AND @ProjectId IS NULL AND @ProjectLocationId IS NULL)
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
        IF gp._StaffRoleDelegationAllowed(@actor,@RoleCode,@ScopeType,@LocationId,@ProjectId,@ProjectLocationId,@now)=0 THROW 52001,'Not authorized for requested role scope.',1;
        IF @TargetUserId=@actor THROW 52001,'Self role changes are not authorized.',1;
        DECLARE @payload nvarchar(max)=(SELECT @TargetUserId targetUserId,@RoleCode roleCode,@ScopeType scopeType,@LocationId locationId,@ProjectId projectId,@ProjectLocationId projectLocationId,
            @ValidFromUtc validFromUtc,@ValidUntilUtc validUntilUtc,JSON_QUERY(@capsJson) capabilities,@Reason reason FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER);
        EXEC gp._BeginOperation @actor,'GRANT_STAFF_ROLE',@ClientKey,@payload,@op OUTPUT,@cached OUTPUT;
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._RequireRoleAdministrator @actor,@now;
        IF gp._StaffRoleDelegationAllowed(@actor,@RoleCode,@ScopeType,@LocationId,@ProjectId,@ProjectLocationId,@now)=0 THROW 52001,'Not authorized for requested role scope.',1;
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
        DECLARE @auditLocation int=COALESCE(@LocationId,(SELECT LocationId FROM gp.ProjectLocations WHERE ProjectLocationId=@ProjectLocationId));
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode,MetadataJson)
            VALUES(@actor,'STAFF_ROLE_GRANTED','ROLE_GRANT',CONVERT(varchar(100),@id),@auditLocation,@ProjectLocationId,'SUCCESS',JSON_MODIFY(JSON_MODIFY(@result,'$.reason',@Reason),'$.capabilities',JSON_QUERY(@capsJson)));
        EXEC gp._CompleteOperation @op,@result;COMMIT;SELECT @result;
    END TRY
    BEGIN CATCH
        DECLARE @error int=ERROR_NUMBER(),@target varchar(100)=CONVERT(varchar(100),@TargetUserId);IF @@TRANCOUNT>0 ROLLBACK;
        EXEC gp._AuditFailure @actor,'STAFF_ROLE_GRANT_FAILED',@target,@error;THROW;
    END CATCH;
END;
GO
ALTER PROCEDURE gp.RevokeStaffRole
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ClientKey uniqueidentifier,@RoleGrantId bigint,@Reason nvarchar(max)
AS
BEGIN
    SET NOCOUNT ON;SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@op uniqueidentifier,@cached nvarchar(max),@result nvarchar(max);
    BEGIN TRY
        IF @RoleGrantId IS NULL OR @RoleGrantId<=0 OR @Reason IS NULL OR DATALENGTH(@Reason)>600 OR LEN(LTRIM(RTRIM(@Reason)))=0 THROW 52002,'Invalid role revocation input.',1;
        BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._RequireRoleAdministrator @actor,@now;
        DECLARE @target uniqueidentifier,@location int,@pair bigint,@revoked datetime2(3),@role varchar(24),@scope varchar(24),@project bigint;
        SELECT @target=UserId,@location=LocationId,@pair=ProjectLocationId,@revoked=RevokedAtUtc,@role=RoleCode,@scope=ScopeType,@project=ProjectId FROM gp.StaffRoleGrants WHERE RoleGrantId=@RoleGrantId;
        IF @pair IS NOT NULL SELECT @location=LocationId FROM gp.ProjectLocations WHERE ProjectLocationId=@pair;
        IF @target IS NULL OR @target=@actor THROW 52001,'Not authorized for this target.',1;
        IF gp._StaffRoleDelegationAllowed(@actor,@role,@scope,CASE WHEN @scope='LOCATION' THEN @location END,@project,@pair,@now)=0 THROW 52001,'Not authorized for role scope.',1;
        DECLARE @payload nvarchar(max)=(SELECT @RoleGrantId roleGrantId,@Reason reason FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        EXEC gp._BeginOperation @actor,'REVOKE_STAFF_ROLE',@ClientKey,@payload,@op OUTPUT,@cached OUTPUT;
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._RequireRoleAdministrator @actor,@now;
        IF gp._StaffRoleDelegationAllowed(@actor,@role,@scope,CASE WHEN @scope='LOCATION' THEN @location END,@project,@pair,@now)=0 THROW 52001,'Not authorized for role scope.',1;
        IF @cached IS NOT NULL BEGIN COMMIT;SELECT @cached;RETURN;END;
        IF @revoked IS NOT NULL THROW 52005,'Role already revoked.',1;
        UPDATE gp.StaffRoleGrants SET RevokedAtUtc=@now,RevokedByUserId=@actor WHERE RoleGrantId=@RoleGrantId;
        UPDATE gp.Users SET AuthorizationVersion=AuthorizationVersion+1 WHERE UserId=@target;
        SET @result=(SELECT @op operationId,CONVERT(varchar(20),@RoleGrantId) roleGrantId,@target targetUserId,CONVERT(bit,1) revoked FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode,MetadataJson)
            VALUES(@actor,'STAFF_ROLE_REVOKED','ROLE_GRANT',CONVERT(varchar(100),@RoleGrantId),@location,@pair,'SUCCESS',JSON_MODIFY(@result,'$.reason',@Reason));
        EXEC gp._CompleteOperation @op,@result;COMMIT;SELECT @result;
    END TRY
    BEGIN CATCH
        DECLARE @error int=ERROR_NUMBER(),@reference varchar(100)=CONVERT(varchar(100),@RoleGrantId);IF @@TRANCOUNT>0 ROLLBACK;
        EXEC gp._AuditFailure @actor,'STAFF_ROLE_REVOCATION_FAILED',@reference,@error;THROW;
    END CATCH;
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
            OR (@GuardOnly=0 AND g.RoleCode IN ('INDIA_ADMIN','LOCATION_ADMIN','PROJECT_ADMIN','PLATFORM_ADMIN','PLATFORM_ADMIN')
                AND @Capability='GUARDS_MANAGE'))
          AND ((g.ScopeType='INDIA' AND g.RoleCode='INDIA_ADMIN') OR (g.ScopeType='PLATFORM' AND g.RoleCode='PLATFORM_ADMIN')
            OR (g.ScopeType='LOCATION' AND g.LocationId=@LocationId)
            OR (g.ScopeType='PROJECT' AND g.ProjectId=target.ProjectId)
            OR (g.ScopeType='PROJECT_LOCATION' AND g.ProjectLocationId=@ProjectLocationId))
    ) SET @allowed=1;
    RETURN @allowed;
END;
GO
ALTER FUNCTION gp._VisitReadAllowed(@Actor uniqueidentifier,@View varchar(20),@Visit uniqueidentifier,@Now datetime2(3),@Cutoff datetime2(3))
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
            OR (@View='ADMIN' AND ((g.RoleCode='INDIA_ADMIN' AND g.ScopeType='INDIA') OR (g.RoleCode='PLATFORM_ADMIN' AND g.ScopeType='PLATFORM')
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
        WHERE g.UserId=@Actor AND c.CapabilityCode=@Capability AND g.RoleCode IN('INDIA_ADMIN','LOCATION_ADMIN','PROJECT_ADMIN','PLATFORM_ADMIN','PLATFORM_ADMIN')
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
        WHERE g.UserId=@Actor AND c.CapabilityCode=@Capability AND g.RoleCode IN('INDIA_ADMIN','LOCATION_ADMIN','PROJECT_ADMIN','PLATFORM_ADMIN','PLATFORM_ADMIN')
        AND gp._RoleCapabilityAllowed(g.RoleCode,@Capability)=1 AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@Now AND (g.ValidUntilUtc IS NULL OR @Now<g.ValidUntilUtc))
        THROW 52001,'Not authorized.',1;
END;
GO
ALTER FUNCTION gp._GuardAllocationEligible(@User uniqueidentifier,@Location int,@Start datetime2(3),@End datetime2(3))
RETURNS bit
AS
BEGIN
    IF NOT EXISTS(SELECT 1 FROM gp.Users WHERE UserId=@User AND IsActive=1) RETURN 0;
    IF EXISTS(SELECT 1 FROM gp.StaffRoleGrants WHERE UserId=@User AND RoleCode NOT IN('GUARD','RECEPTION') AND RevokedAtUtc IS NULL
        AND (@End IS NULL OR ValidFromUtc<@End) AND (ValidUntilUtc IS NULL OR @Start<ValidUntilUtc)) RETURN 0;
    IF EXISTS(SELECT 1 FROM gp.StaffRoleGrants g WHERE g.UserId=@User AND g.RoleCode='GUARD' AND g.ScopeType='LOCATION' AND g.LocationId=@Location
        AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@Start AND (g.ValidUntilUtc IS NULL OR @End IS NOT NULL AND @End<=g.ValidUntilUtc)
        AND EXISTS(SELECT 1 FROM gp.GrantCapabilities WHERE RoleGrantId=g.RoleGrantId AND CapabilityCode='PROJECT_MOVEMENT')
        AND EXISTS(SELECT 1 FROM gp.GrantCapabilities WHERE RoleGrantId=g.RoleGrantId AND CapabilityCode='VISITS_READ')) RETURN 1;
    RETURN 0;
END;
GO
ALTER FUNCTION gp._StaffLocalIdentityEligible(@UserId uniqueidentifier,@Now datetime2(3)) RETURNS bit
AS BEGIN
 IF NOT EXISTS(SELECT 1 FROM gp.Users u JOIN gp.StaffProfiles s ON s.UserId=u.UserId WHERE u.UserId=@UserId AND u.IsActive=1 AND s.IsActive=1) RETURN 0;
 IF EXISTS(SELECT 1 FROM gp.Employees WHERE UserId=@UserId) RETURN 0;
 IF EXISTS(SELECT 1 FROM gp.StaffRoleGrants WHERE UserId=@UserId AND RoleCode='PROJECT_ADMIN' AND RevokedAtUtc IS NULL AND ValidFromUtc<=@Now AND (ValidUntilUtc IS NULL OR @Now<ValidUntilUtc)) RETURN 0;
 IF NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants g LEFT JOIN gp.Locations l ON l.LocationId=g.LocationId LEFT JOIN gp.Projects p ON p.ProjectId=g.ProjectId LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=g.ProjectLocationId LEFT JOIN gp.Locations ll ON ll.LocationId=pl.LocationId LEFT JOIN gp.Projects pp ON pp.ProjectId=pl.ProjectId
 WHERE g.UserId=@UserId AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@Now AND (g.ValidUntilUtc IS NULL OR @Now<g.ValidUntilUtc)
 AND ((g.RoleCode='INDIA_ADMIN' AND g.ScopeType='INDIA') OR(g.RoleCode='PLATFORM_ADMIN' AND g.ScopeType='PLATFORM') OR (g.RoleCode IN('GUARD','RECEPTION','LOCATION_ADMIN') AND g.ScopeType='LOCATION' AND l.IsActive=1) OR(g.RoleCode='PROJECT_ADMIN' AND ((g.ScopeType='PROJECT' AND p.IsActive=1) OR(g.ScopeType='PROJECT_LOCATION' AND pl.IsActive=1 AND ll.IsActive=1 AND pp.IsActive=1))))) RETURN 0;
 RETURN 1;
END;
GO
ALTER PROCEDURE gp._RequireStaffCredentialAdmin @Actor uniqueidentifier,@Target uniqueidentifier,@Now datetime2(3)
AS BEGIN
 SET NOCOUNT ON;
 IF @Actor=@Target OR gp._StaffLocalIdentityEligible(@Target,@Now)=0 THROW 52601,'Not authorized.',1;
 IF EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId WHERE g.UserId=@Actor AND g.RoleCode='PLATFORM_ADMIN' AND g.ScopeType='PLATFORM' AND c.CapabilityCode='STAFF_CREDENTIALS_MANAGE' AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@Now AND(g.ValidUntilUtc IS NULL OR @Now<g.ValidUntilUtc)) RETURN;
 IF EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId WHERE g.UserId=@Actor AND g.RoleCode='INDIA_ADMIN' AND g.ScopeType='INDIA' AND c.CapabilityCode='STAFF_CREDENTIALS_MANAGE' AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@Now AND(g.ValidUntilUtc IS NULL OR @Now<g.ValidUntilUtc)) AND NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants t WHERE t.UserId=@Target AND t.RoleCode IN('PLATFORM_ADMIN','INDIA_ADMIN') AND t.RevokedAtUtc IS NULL AND t.ValidFromUtc<=@Now AND(t.ValidUntilUtc IS NULL OR @Now<t.ValidUntilUtc)) RETURN;
 IF EXISTS(SELECT 1 FROM gp.StaffRoleGrants t LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=t.ProjectLocationId WHERE t.UserId=@Target AND t.RevokedAtUtc IS NULL AND t.ValidFromUtc<=@Now AND(t.ValidUntilUtc IS NULL OR @Now<t.ValidUntilUtc)
 AND (t.RoleCode NOT IN('GUARD','RECEPTION') OR t.ScopeType NOT IN('LOCATION','PROJECT_LOCATION') OR NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants a JOIN gp.GrantCapabilities c ON c.RoleGrantId=a.RoleGrantId JOIN gp.Locations l ON l.LocationId=a.LocationId WHERE a.UserId=@Actor AND a.RoleCode='LOCATION_ADMIN' AND a.ScopeType='LOCATION' AND l.IsActive=1 AND c.CapabilityCode='STAFF_CREDENTIALS_MANAGE' AND a.LocationId=COALESCE(t.LocationId,pl.LocationId) AND a.RevokedAtUtc IS NULL AND a.ValidFromUtc<=@Now AND(a.ValidUntilUtc IS NULL OR @Now<a.ValidUntilUtc)))) THROW 52601,'Not authorized.',1;
END;
GO
ALTER PROCEDURE gp.GetStaffAccessContext @SessionHash varbinary(8000),@CsrfHash varbinary(8000)
AS
BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@result nvarchar(max),@name nvarchar(200);
 BEGIN TRY
  BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
  EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
  IF EXISTS(SELECT 1 FROM gp.Employees WHERE UserId=@actor) AND NOT EXISTS(SELECT 1 FROM gp.Employees WHERE UserId=@actor AND IsActive=1 AND LastSyncedAtUtc BETWEEN @cutoff AND @now) THROW 53601,'Current employee data required.',1;
  SELECT @name=DisplayName FROM gp.Users WHERE UserId=@actor;
  DECLARE @grants table(RoleGrantId bigint,RoleCode varchar(24),ScopeType varchar(24),ScopeName nvarchar(403));
  INSERT @grants SELECT g.RoleGrantId,g.RoleCode,g.ScopeType,CASE g.ScopeType WHEN 'PLATFORM' THEN N'Platform' WHEN 'INDIA' THEN N'India' WHEN 'LOCATION' THEN l.LocationName WHEN 'PROJECT' THEN p.ProjectName ELSE lp.ProjectName+N' · '+ll.LocationName END
   FROM gp.StaffRoleGrants g LEFT JOIN gp.Locations l ON l.LocationId=g.LocationId LEFT JOIN gp.Projects p ON p.ProjectId=g.ProjectId
   LEFT JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=g.ProjectLocationId LEFT JOIN gp.Projects lp ON lp.ProjectId=pl.ProjectId LEFT JOIN gp.Locations ll ON ll.LocationId=pl.LocationId
   WHERE g.UserId=@actor AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@now AND (g.ValidUntilUtc IS NULL OR @now<g.ValidUntilUtc)
    AND (g.ScopeType IN('INDIA','PLATFORM') OR g.ScopeType='LOCATION' AND l.IsActive=1 OR g.ScopeType='PROJECT' AND p.IsActive=1 AND p.LastSyncedAtUtc BETWEEN @cutoff AND @now
      OR g.ScopeType='PROJECT_LOCATION' AND pl.IsActive=1 AND lp.IsActive=1 AND ll.IsActive=1 AND lp.LastSyncedAtUtc BETWEEN @cutoff AND @now);
  SET @result=(SELECT @name displayName,JSON_QUERY(COALESCE((SELECT TOP(100) g.RoleCode roleCode,g.ScopeType scopeType,g.ScopeName scopeName,
    JSON_QUERY(COALESCE((SELECT c.CapabilityCode code FROM gp.GrantCapabilities c WHERE c.RoleGrantId=g.RoleGrantId ORDER BY c.CapabilityCode FOR JSON PATH),N'[]')) capabilities
    FROM @grants g ORDER BY g.RoleCode,g.ScopeName,g.RoleGrantId FOR JSON PATH),N'[]')) grants,
    CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM @grants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='VISITS_READ' WHERE g.RoleCode='RECEPTION') THEN 1 ELSE 0 END) receptionAvailable
    FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
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
        INSERT @page SELECT TOP(@PageSize+1) UserId FROM gp.Users WHERE (UserId=@actor OR EXISTS(SELECT 1 FROM gp.Employees e WHERE e.UserId=gp.Users.UserId AND e.IsActive=1) OR EXISTS(SELECT 1 FROM gp.StaffRoleGrants t WHERE t.UserId=gp.Users.UserId AND gp._StaffRoleDelegationAllowed(@actor,t.RoleCode,t.ScopeType,t.LocationId,t.ProjectId,t.ProjectLocationId,@now)=1)) AND (@AfterUserId IS NULL OR UserId>@AfterUserId) AND DisplayName LIKE @pattern ESCAPE N'~' ORDER BY UserId;
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
        INSERT @page SELECT TOP(@PageSize+1) RoleGrantId FROM gp.StaffRoleGrants WHERE UserId=@TargetUserId AND (UserId=@actor OR gp._StaffRoleDelegationAllowed(@actor,RoleCode,ScopeType,LocationId,ProjectId,ProjectLocationId,@now)=1) AND (@AfterRoleGrantId IS NULL OR RoleGrantId>@AfterRoleGrantId)
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
INSERT gp.SchemaMigrations(Version,Description) VALUES('033',N'Platform administration and scope-bounded role delegation with trusted audit scope');
COMMIT;
