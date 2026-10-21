/* Operational admin project-lead workspace, with bounded reads and employee-only lead selection. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='034') THROW 53600,'Migration 034 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='035') THROW 53600,'Migration 035 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
CREATE FUNCTION gp._LeadWorkspaceScope(@Actor uniqueidentifier,@Location int,@Pair bigint,@Now datetime2(3)) RETURNS bit
AS BEGIN
 IF gp._AdminScopeAllowed(@Actor,'VISITS_READ',@Location,@Pair,@Now)=1 OR gp._AdminScopeAllowed(@Actor,'GUARDS_MANAGE',@Location,@Pair,@Now)=1 OR gp._AdminScopeAllowed(@Actor,'ROLE_GRANTS_MANAGE',@Location,@Pair,@Now)=1 OR gp._AdminScopeAllowed(@Actor,'REPORTS_READ',@Location,@Pair,@Now)=1 RETURN 1;
 RETURN 0;
END;
GO
CREATE PROCEDURE gp.GetAdminWorkspaceContext @SessionHash varbinary(8000),@CsrfHash varbinary(8000)
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@result nvarchar(max),@locations nvarchar(max),@name nvarchar(200);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 SELECT @name=DisplayName FROM gp.Users WHERE UserId=@actor;
 SET @locations=COALESCE((SELECT TOP(50) l.LocationId locationId,l.LocationName locationName,l.LocationCode locationCode FROM gp.Locations l WHERE l.IsActive=1 AND(gp._LeadWorkspaceScope(@actor,l.LocationId,NULL,@now)=1 OR EXISTS(SELECT 1 FROM gp.ProjectLocations pl WHERE pl.LocationId=l.LocationId AND pl.IsActive=1 AND gp._LeadWorkspaceScope(@actor,l.LocationId,pl.ProjectLocationId,@now)=1)) ORDER BY l.LocationName FOR JSON PATH),N'[]');
 IF @locations=N'[]' THROW 52001,'Not authorized.',1;
 SET @result=(SELECT @name displayName,JSON_QUERY(@locations) locations FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp.ListLeadProjects @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@AfterProjectLocationId bigint=NULL
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
 IF @LocationId IS NULL OR @LocationId<=0 OR @AfterProjectLocationId<=0 THROW 52002,'Invalid project page.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@more bit,@after bigint,@result nvarchar(max);
 DECLARE @page table(Pair bigint PRIMARY KEY);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@LocationId AND IsActive=1) OR(gp._LeadWorkspaceScope(@actor,@LocationId,NULL,@now)=0 AND NOT EXISTS(SELECT 1 FROM gp.ProjectLocations pl WHERE pl.LocationId=@LocationId AND pl.IsActive=1 AND gp._LeadWorkspaceScope(@actor,@LocationId,pl.ProjectLocationId,@now)=1)) THROW 52001,'Not authorized.',1;
 INSERT @page SELECT TOP(26) pl.ProjectLocationId FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId WHERE pl.LocationId=@LocationId AND pl.IsActive=1 AND p.IsActive=1 AND(@AfterProjectLocationId IS NULL OR pl.ProjectLocationId>@AfterProjectLocationId) AND gp._LeadWorkspaceScope(@actor,@LocationId,pl.ProjectLocationId,@now)=1 ORDER BY pl.ProjectLocationId;
 SET @more=CASE WHEN(SELECT COUNT(*) FROM @page)>25 THEN 1 ELSE 0 END;
 IF @more=1 BEGIN DELETE @page WHERE Pair=(SELECT MAX(Pair) FROM @page);SELECT @after=MAX(Pair) FROM @page;END;
 SET @result=(SELECT JSON_QUERY(COALESCE((SELECT CONVERT(varchar(20),pl.ProjectLocationId) projectLocationId,CONVERT(varchar(20),p.ProjectId) projectId,p.ProjectName projectName,p.ExternalProjectCode projectCode,
 CONVERT(bit,CASE WHEN p.LastSyncedAtUtc BETWEEN @cutoff AND @now THEN 1 ELSE 0 END) directoryCurrent,
 CONVERT(bit,gp._StaffRoleDelegationAllowed(@actor,'PROJECT_ADMIN','PROJECT',NULL,p.ProjectId,NULL,@now)) canAssignProject,
 CONVERT(bit,gp._StaffRoleDelegationAllowed(@actor,'PROJECT_ADMIN','PROJECT_LOCATION',NULL,NULL,pl.ProjectLocationId,@now)) canAssignLocation
 FROM @page pg JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=pg.Pair JOIN gp.Projects p ON p.ProjectId=pl.ProjectId ORDER BY pl.ProjectLocationId FOR JSON PATH),N'[]')) projects,@more hasMore,CONVERT(varchar(20),@after) afterProjectLocationId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp.SearchProjectLeadCandidates @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ProjectLocationId bigint,@Search nvarchar(80)
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
 SET @Search=LTRIM(RTRIM(@Search));IF @ProjectLocationId IS NULL OR @ProjectLocationId<=0 OR @Search IS NULL OR LEN(@Search)<2 THROW 52002,'Enter at least two search characters.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@project bigint,@location int,@result nvarchar(max);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 SELECT @project=pl.ProjectId,@location=pl.LocationId FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId JOIN gp.Locations l ON l.LocationId=pl.LocationId WHERE pl.ProjectLocationId=@ProjectLocationId AND pl.IsActive=1 AND p.IsActive=1 AND l.IsActive=1 AND p.LastSyncedAtUtc BETWEEN @cutoff AND @now;
 IF @project IS NULL OR(gp._StaffRoleDelegationAllowed(@actor,'PROJECT_ADMIN','PROJECT',NULL,@project,NULL,@now)=0 AND gp._StaffRoleDelegationAllowed(@actor,'PROJECT_ADMIN','PROJECT_LOCATION',NULL,NULL,@ProjectLocationId,@now)=0) THROW 52001,'Not authorized.',1;
 SET @result=(SELECT JSON_QUERY(COALESCE((SELECT TOP(20) u.UserId userId,e.EmployeeId employeeId,e.FullName displayName,e.OfficialEmail email FROM gp.Employees e JOIN gp.Users u ON u.UserId=e.UserId WHERE e.IsActive=1 AND u.IsActive=1 AND e.LastSyncedAtUtc BETWEEN @cutoff AND @now AND(CHARINDEX(@Search,e.FullName)>0 OR CHARINDEX(@Search,e.OfficialEmail)>0 OR CHARINDEX(@Search,e.EmployeeId)>0) ORDER BY e.FullName,e.EmployeeId FOR JSON PATH),N'[]')) employees FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode) VALUES(@actor,'LEAD_CANDIDATES_READ','PROJECT_LOCATION',CONVERT(varchar(20),@ProjectLocationId),@location,@ProjectLocationId,'SUCCESS');
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp.ListProjectHeads @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ProjectLocationId bigint,@AfterRoleGrantId bigint=NULL
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 53600,'Ambient transaction not accepted.',1;
 IF @ProjectLocationId IS NULL OR @ProjectLocationId<=0 OR @AfterRoleGrantId<=0 THROW 52002,'Invalid lead page.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@project bigint,@location int,@result nvarchar(max),@more bit,@after bigint;
 DECLARE @page table(Id bigint PRIMARY KEY);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 SELECT @project=ProjectId,@location=LocationId FROM gp.ProjectLocations WHERE ProjectLocationId=@ProjectLocationId;
 IF @project IS NULL OR gp._LeadWorkspaceScope(@actor,@location,@ProjectLocationId,@now)=0 THROW 52001,'Not authorized.',1;
 INSERT @page SELECT TOP(26) g.RoleGrantId FROM gp.StaffRoleGrants g WHERE g.RoleCode='PROJECT_ADMIN' AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@now AND(g.ValidUntilUtc IS NULL OR @now<g.ValidUntilUtc) AND((g.ScopeType='PROJECT' AND g.ProjectId=@project) OR(g.ScopeType='PROJECT_LOCATION' AND g.ProjectLocationId=@ProjectLocationId)) AND(@AfterRoleGrantId IS NULL OR g.RoleGrantId>@AfterRoleGrantId) ORDER BY g.RoleGrantId;
 SET @more=CASE WHEN(SELECT COUNT(*) FROM @page)>25 THEN 1 ELSE 0 END;
 IF @more=1 BEGIN DELETE @page WHERE Id=(SELECT MAX(Id) FROM @page);SELECT @after=MAX(Id) FROM @page;END;
 SET @result=(SELECT JSON_QUERY(COALESCE((SELECT CONVERT(varchar(20),g.RoleGrantId) roleGrantId,u.DisplayName displayName,e.EmployeeId employeeId,e.OfficialEmail email,g.ScopeType scopeType,
 CONVERT(bit,CASE WHEN u.UserId<>@actor AND gp._StaffRoleDelegationAllowed(@actor,g.RoleCode,g.ScopeType,g.LocationId,g.ProjectId,g.ProjectLocationId,@now)=1 THEN 1 ELSE 0 END) canRemove
 FROM @page pg JOIN gp.StaffRoleGrants g ON g.RoleGrantId=pg.Id JOIN gp.Users u ON u.UserId=g.UserId LEFT JOIN gp.Employees e ON e.UserId=u.UserId ORDER BY g.RoleGrantId FOR JSON PATH,INCLUDE_NULL_VALUES),N'[]')) leads,@more hasMore,CONVERT(varchar(20),@after) afterRoleGrantId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode) VALUES(@actor,'PROJECT_HEADS_READ','PROJECT_LOCATION',CONVERT(varchar(20),@ProjectLocationId),@location,@ProjectLocationId,'SUCCESS');
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
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
        IF @RoleCode='PROJECT_ADMIN' BEGIN
         DECLARE @leadCutoff datetime2(3);EXEC gp._DirectoryCutoff @now,@leadCutoff OUTPUT;
         IF NOT EXISTS(SELECT 1 FROM gp.Employees WHERE UserId=@TargetUserId AND IsActive=1 AND LastSyncedAtUtc BETWEEN @leadCutoff AND @now) THROW 52004,'Current employee identity required for project lead.',1;
         IF NOT EXISTS(SELECT 1 FROM gp.Projects p WHERE p.ProjectId=COALESCE(@ProjectId,(SELECT ProjectId FROM gp.ProjectLocations WHERE ProjectLocationId=@ProjectLocationId)) AND p.IsActive=1 AND p.LastSyncedAtUtc BETWEEN @leadCutoff AND @now) THROW 52004,'Current project required.',1;
        END;
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
    CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM @grants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='VISITS_READ' WHERE g.RoleCode='RECEPTION') THEN 1 ELSE 0 END) receptionAvailable,
    CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM @grants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId WHERE g.RoleCode IN('PLATFORM_ADMIN','INDIA_ADMIN','LOCATION_ADMIN','PROJECT_ADMIN') AND c.CapabilityCode IN('VISITS_READ','GUARDS_MANAGE','ROLE_GRANTS_MANAGE','REPORTS_READ')) THEN 1 ELSE 0 END) adminAvailable
    FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
  COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON gp.GetAdminWorkspaceContext TO gp_api_runtime;
GRANT EXECUTE ON gp.ListLeadProjects TO gp_api_runtime;
GRANT EXECUTE ON gp.SearchProjectLeadCandidates TO gp_api_runtime;
GRANT EXECUTE ON gp.ListProjectHeads TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('035',N'Operational project lead administration workspace and current employee boundaries');
COMMIT;
