/* Scoped local account onboarding with one-use setup tickets and explicit audit snapshots. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54600,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='080') THROW 54600,'Migration 080 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='081') THROW 54600,'Migration 081 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
CREATE FUNCTION gp._CanProvisionStaff(@Actor uniqueidentifier,@Role varchar(24),@Location int,@Now datetime2(3)) RETURNS bit
AS BEGIN
 DECLARE @scope varchar(24)=CASE WHEN @Role='PLATFORM_ADMIN' THEN 'PLATFORM' WHEN @Role='INDIA_ADMIN' THEN 'INDIA' ELSE 'LOCATION' END,@targetLocation int=CASE WHEN @Role NOT IN('PLATFORM_ADMIN','INDIA_ADMIN') THEN @Location END;
 IF @Role NOT IN('GUARD','RECEPTION','LOCATION_ADMIN','INDIA_ADMIN','PLATFORM_ADMIN') RETURN 0;
 IF gp._StaffRoleDelegationAllowed(@Actor,@Role,@scope,@targetLocation,NULL,NULL,@Now)=0 RETURN 0;
 IF gp._AdminScopeAllowed(@Actor,'STAFF_CREDENTIALS_MANAGE',@targetLocation,NULL,@Now)=1 RETURN 1;
 IF @Role='GUARD' AND gp._AdminScopeAllowed(@Actor,'GUARD_CREDENTIALS_MANAGE',@Location,NULL,@Now)=1 RETURN 1;
 RETURN 0;
END;
GO
CREATE PROCEDURE gp.CreateLocalStaffAccount @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ClientKey uniqueidentifier,@DisplayName nvarchar(max),@LoginId nvarchar(max),@RoleCode varchar(8000),@LocationId int,@CapabilitiesJson nvarchar(max),@SetupTokenHash varbinary(8000),@Reason nvarchar(max),@ProjectLocationId bigint=NULL
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 54600,'Ambient transaction not accepted.',1;
 IF @ClientKey IS NULL OR @LocationId IS NULL OR @LocationId<=0 OR @ProjectLocationId<=0 OR @RoleCode IS NULL OR @RoleCode COLLATE Latin1_General_100_BIN2 NOT IN('GUARD','RECEPTION','LOCATION_ADMIN','INDIA_ADMIN','PLATFORM_ADMIN') OR DATALENGTH(@RoleCode)<>LEN(@RoleCode)
 OR @DisplayName IS NULL OR DATALENGTH(@DisplayName)>400 OR LEN(LTRIM(RTRIM(@DisplayName)))=0 OR @LoginId IS NULL OR DATALENGTH(@LoginId) NOT BETWEEN 6 AND 128 OR @LoginId COLLATE Latin1_General_100_BIN2 LIKE N'%[^a-z0-9@._-]%' OR @LoginId COLLATE Latin1_General_100_BIN2 LIKE N'[^a-z0-9]%' OR DATALENGTH(@LoginId)<>DATALENGTH(LTRIM(RTRIM(@LoginId)))
 OR @SetupTokenHash IS NULL OR DATALENGTH(@SetupTokenHash)<>32 OR @Reason IS NULL OR LEN(LTRIM(RTRIM(@Reason)))=0 OR DATALENGTH(@Reason)>600 OR @CapabilitiesJson IS NULL OR ISJSON(@CapabilitiesJson)<>1 OR LEFT(LTRIM(@CapabilitiesJson),1)<>N'[' OR DATALENGTH(@CapabilitiesJson)>2000 THROW 52002,'Invalid account input.',1;
 DECLARE @caps table(Code varchar(40) PRIMARY KEY);
 IF EXISTS(SELECT 1 FROM OPENJSON(@CapabilitiesJson) WHERE type<>1 OR DATALENGTH(value)>80 OR gp._RoleCapabilityAllowed(@RoleCode,value)=0) OR EXISTS(SELECT 1 FROM OPENJSON(@CapabilitiesJson) GROUP BY value COLLATE Latin1_General_100_BIN2 HAVING COUNT(*)>1) THROW 52002,'Invalid account permissions.',1;
 INSERT @caps SELECT value FROM OPENJSON(@CapabilitiesJson);
 IF (SELECT COUNT(*) FROM @caps) NOT BETWEEN 1 AND 8 OR (@RoleCode IN('GUARD','RECEPTION') AND NOT EXISTS(SELECT 1 FROM @caps WHERE Code='VISITS_READ')) OR(@RoleCode NOT IN('GUARD','RECEPTION') AND NOT EXISTS(SELECT 1 FROM @caps WHERE Code IN('VISITS_READ','REPORTS_READ','GUARDS_MANAGE','ROLE_GRANTS_MANAGE'))) THROW 52002,'Workspace permissions required.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@op uniqueidentifier,@cached nvarchar(max),@result nvarchar(max),@user uniqueidentifier=NEWID(),@grant bigint,@assignment bigint,@scope varchar(24)=CASE @RoleCode WHEN 'INDIA_ADMIN' THEN 'INDIA' WHEN 'PLATFORM_ADMIN' THEN 'PLATFORM' ELSE 'LOCATION' END,@targetLocation int=CASE WHEN @RoleCode NOT IN('INDIA_ADMIN','PLATFORM_ADMIN') THEN @LocationId END,@scopeName nvarchar(150),@metadata nvarchar(max);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 IF gp._CanProvisionStaff(@actor,@RoleCode,@LocationId,@now)=0 OR NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@LocationId AND IsActive=1) THROW 52001,'Not authorized.',1;
 IF @ProjectLocationId IS NOT NULL AND(@RoleCode<>'GUARD' OR gp._AdminScopeAllowed(@actor,'GUARDS_MANAGE',@LocationId,@ProjectLocationId,@now)=0 OR NOT EXISTS(SELECT 1 FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId WHERE pl.ProjectLocationId=@ProjectLocationId AND pl.LocationId=@LocationId AND pl.IsActive=1 AND p.IsActive=1)) THROW 52001,'Not authorized for project assignment.',1;
 DECLARE @payload nvarchar(max)=(SELECT @DisplayName displayName,@LoginId loginId,@RoleCode roleCode,@LocationId locationId,@ProjectLocationId projectLocationId,JSON_QUERY((SELECT Code code FROM @caps ORDER BY Code FOR JSON PATH)) capabilities,CONVERT(varchar(64),@SetupTokenHash,2) setupHash,@Reason reason FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER);
 EXEC gp._BeginOperation @actor,'CREATE_LOCAL_STAFF',@ClientKey,@payload,@op OUTPUT,@cached OUTPUT;
 IF @cached IS NOT NULL BEGIN COMMIT;SELECT @cached;RETURN;END;
 IF EXISTS(SELECT 1 FROM gp.GuardCredentials WHERE LoginId=@LoginId COLLATE Latin1_General_100_BIN2) OR EXISTS(SELECT 1 FROM gp.StaffProfiles WHERE StaffCode=@LoginId COLLATE Latin1_General_100_BIN2) OR EXISTS(SELECT 1 FROM gp.Employees WHERE OfficialEmail=@LoginId OR EmployeeId=@LoginId) OR EXISTS(SELECT 1 FROM gp.Users WHERE IdentityIssuer='gatepass-local-staff' AND IdentitySubject=@LoginId) THROW 52003,'Login ID already exists.',1;
 INSERT gp.Users(UserId,IdentityIssuer,IdentitySubject,DisplayName,IsActive) VALUES(@user,'gatepass-local-staff',@LoginId,@DisplayName,1);
 INSERT gp.StaffProfiles(UserId,StaffCode) VALUES(@user,@LoginId);
 INSERT gp.StaffRoleGrants(UserId,RoleCode,ScopeType,LocationId,GrantedByUserId,ValidFromUtc) VALUES(@user,@RoleCode,@scope,@targetLocation,@actor,@now);SET @grant=SCOPE_IDENTITY();
 INSERT gp.GrantCapabilities(RoleGrantId,CapabilityCode) SELECT @grant,Code FROM @caps;
 INSERT gp.GuardCredentials(UserId,LoginId) VALUES(@user,@LoginId);
 INSERT gp.GuardSetupTickets(TokenHash,UserId,CredentialVersion,CreatedByUserId,CreatedAtUtc,ExpiresAtUtc) VALUES(@SetupTokenHash,@user,1,@actor,@now,DATEADD(minute,15,@now));
 IF @ProjectLocationId IS NOT NULL BEGIN INSERT gp.GuardAssignments(GuardUserId,ProjectLocationId,AssignedByUserId,ValidFromUtc) VALUES(@user,@ProjectLocationId,@actor,@now);SET @assignment=SCOPE_IDENTITY();END;
 SET @scopeName=CASE @scope WHEN 'PLATFORM' THEN N'Platform' WHEN 'INDIA' THEN N'India' ELSE (SELECT LocationName FROM gp.Locations WHERE LocationId=@LocationId) END;
 SET @metadata=(SELECT @DisplayName targetDisplayName,@LoginId staffCode,@RoleCode roleCode,@scopeName scopeName,@Reason reason FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ResultCode,MetadataJson) VALUES(@actor,'STAFF_ACCOUNT_CREATED','USER',CONVERT(varchar(36),@user),@targetLocation,'SUCCESS',@metadata),(@actor,'STAFF_SETUP_ISSUED','USER',CONVERT(varchar(36),@user),@targetLocation,'SUCCESS',@metadata);
 IF @ProjectLocationId IS NOT NULL INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode,MetadataJson) VALUES(@actor,'GUARD_ALLOCATED','GUARD_ASSIGNMENT',CONVERT(varchar(20),@assignment),@LocationId,@ProjectLocationId,'SUCCESS',@metadata);
 SET @result=(SELECT @user userId,@DisplayName displayName,@LoginId loginId,@RoleCode roleCode,@scope scopeType,REPLACE(CONVERT(char(23),DATEADD(minute,15,@now),121),' ','T')+'Z' setupExpiresAtUtc,CONVERT(varchar(20),@assignment) assignmentId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 EXEC gp._CompleteOperation @op,@result;COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp.ReissueLocalStaffSetup @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@TargetUserId uniqueidentifier,@SetupTokenHash varbinary(8000),@ClientKey uniqueidentifier,@Reason nvarchar(max)
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 54600,'Ambient transaction not accepted.',1;
 IF @TargetUserId IS NULL OR @ClientKey IS NULL OR @SetupTokenHash IS NULL OR DATALENGTH(@SetupTokenHash)<>32 OR @Reason IS NULL OR LEN(LTRIM(RTRIM(@Reason)))=0 OR DATALENGTH(@Reason)>600 THROW 52002,'Invalid setup input.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@op uniqueidentifier,@cached nvarchar(max),@result nvarchar(max),@version bigint,@name nvarchar(200),@login varchar(64),@location int,@role varchar(24),@scopeName nvarchar(150),@metadata nvarchar(max);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 EXEC gp._RequireStaffCredentialAdmin @actor,@TargetUserId,@now;
 DECLARE @payload nvarchar(max)=(SELECT @TargetUserId targetUserId,CONVERT(varchar(64),@SetupTokenHash,2) setupHash,@Reason reason FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 EXEC gp._BeginOperation @actor,'REISSUE_STAFF_SETUP',@ClientKey,@payload,@op OUTPUT,@cached OUTPUT;
 IF @cached IS NOT NULL BEGIN COMMIT;SELECT @cached;RETURN;END;
 SELECT @name=u.DisplayName,@login=c.LoginId FROM gp.Users u JOIN gp.GuardCredentials c ON c.UserId=u.UserId WHERE u.UserId=@TargetUserId;
 IF @login IS NULL THROW 52003,'Local account unavailable.',1;
 SELECT TOP(1) @location=LocationId,@role=RoleCode,@scopeName=CASE ScopeType WHEN 'PLATFORM' THEN N'Platform' WHEN 'INDIA' THEN N'India' ELSE (SELECT LocationName FROM gp.Locations WHERE LocationId=g.LocationId) END FROM gp.StaffRoleGrants g WHERE UserId=@TargetUserId AND RevokedAtUtc IS NULL AND ValidFromUtc<=@now AND(ValidUntilUtc IS NULL OR @now<ValidUntilUtc) ORDER BY CASE WHEN ScopeType IN('PLATFORM','INDIA') THEN 0 ELSE 1 END,RoleGrantId;
 UPDATE gp.GuardCredentials SET CredentialVersion=CredentialVersion+1,IsEnabled=1,EncodedPasswordHash=NULL,MustChangePassword=1,PasswordChangedAtUtc=NULL,FailedCount=0,FailureWindowStartUtc=NULL,LockedUntilUtc=NULL WHERE UserId=@TargetUserId;
 SELECT @version=CredentialVersion FROM gp.GuardCredentials WHERE UserId=@TargetUserId;
 UPDATE gp.Users SET AuthorizationVersion=AuthorizationVersion+1 WHERE UserId=@TargetUserId;UPDATE gp.Sessions SET RevokedAtUtc=@now WHERE UserId=@TargetUserId AND RevokedAtUtc IS NULL;UPDATE gp.GuardSetupTickets SET UsedAtUtc=@now WHERE UserId=@TargetUserId AND UsedAtUtc IS NULL;
 INSERT gp.GuardSetupTickets(TokenHash,UserId,CredentialVersion,CreatedByUserId,CreatedAtUtc,ExpiresAtUtc) VALUES(@SetupTokenHash,@TargetUserId,@version,@actor,@now,DATEADD(minute,15,@now));
 SET @metadata=(SELECT @name targetDisplayName,@login staffCode,@role roleCode,@scopeName scopeName,@Reason reason FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ResultCode,MetadataJson) VALUES(@actor,'STAFF_SETUP_REISSUED','USER',CONVERT(varchar(36),@TargetUserId),@location,'SUCCESS',@metadata);
 SET @result=(SELECT @TargetUserId userId,@name displayName,@login loginId,@role roleCode,REPLACE(CONVERT(char(23),DATEADD(minute,15,@now),121),' ','T')+'Z' setupExpiresAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 EXEC gp._CompleteOperation @op,@result;COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
ALTER PROCEDURE gp.GetAdminConsoleScope @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@ProjectLocationId bigint=NULL
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 54600,'Ambient transaction not accepted.',1;
 IF @LocationId IS NULL OR @LocationId<=0 OR @ProjectLocationId<=0 THROW 52002,'Invalid scope.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@result nvarchar(max);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 IF @ProjectLocationId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gp.ProjectLocations WHERE ProjectLocationId=@ProjectLocationId AND LocationId=@LocationId AND IsActive=1) THROW 52001,'Not authorized.',1;
 IF NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@LocationId AND IsActive=1) OR gp._LeadWorkspaceScope(@actor,@LocationId,@ProjectLocationId,@now)=0 THROW 52001,'Not authorized.',1;
 SET @result=(SELECT @actor userId,CONVERT(date,DATEADD(minute,330,@now)) currentDate,
 gp._AdminScopeAllowed(@actor,'REPORTS_READ',@LocationId,@ProjectLocationId,@now) canReport,
 gp._AdminScopeAllowed(@actor,'VISITS_READ',@LocationId,@ProjectLocationId,@now) canReadVisits,
 gp._AdminScopeAllowed(@actor,'AUDIT_READ',@LocationId,@ProjectLocationId,@now) canAudit,
 gp._AdminScopeAllowed(@actor,'GUARDS_MANAGE',@LocationId,@ProjectLocationId,@now) canAssignGuards,
 gp._AdminScopeAllowed(@actor,'ROLE_GRANTS_MANAGE',@LocationId,@ProjectLocationId,@now) canManageRoles,
 JSON_QUERY(COALESCE((SELECT code roleCode FROM(VALUES('GUARD'),('RECEPTION'),('LOCATION_ADMIN'),('INDIA_ADMIN'),('PLATFORM_ADMIN')) available(code) WHERE gp._CanProvisionStaff(@actor,code,@LocationId,@now)=1 FOR JSON PATH),N'[]')) provisionableRoles,
 gp._AdminScopeAllowed(@actor,'STAFF_CREDENTIALS_MANAGE',@LocationId,NULL,@now) canResetLocalStaff,
 JSON_QUERY(COALESCE((SELECT r.RoleCode roleCode,r.ScopeType scopeType,CASE WHEN r.ScopeType='PROJECT' THEN 'PROJECT' WHEN r.ScopeType='PROJECT_LOCATION' THEN 'PROJECT_LOCATION' ELSE r.ScopeType END label
 FROM gp.StaffRoleGrants r WHERE r.UserId=@actor AND r.RevokedAtUtc IS NULL AND r.ValidFromUtc<=@now AND(r.ValidUntilUtc IS NULL OR @now<r.ValidUntilUtc) FOR JSON PATH),N'[]')) roles,
 JSON_QUERY(COALESCE((SELECT code roleCode,scope scopeType FROM (VALUES('GUARD','LOCATION'),('RECEPTION','LOCATION'),('LOCATION_ADMIN','LOCATION'),('PROJECT_ADMIN','PROJECT_LOCATION'),('PROJECT_ADMIN','PROJECT'),('INDIA_ADMIN','INDIA'),('PLATFORM_ADMIN','PLATFORM')) x(code,scope)
 WHERE gp._StaffRoleDelegationAllowed(@actor,code,scope,CASE WHEN scope='LOCATION' THEN @LocationId END,CASE WHEN scope='PROJECT' THEN (SELECT ProjectId FROM gp.ProjectLocations WHERE ProjectLocationId=@ProjectLocationId) END,CASE WHEN scope='PROJECT_LOCATION' THEN @ProjectLocationId END,@now)=1
 AND(scope NOT IN('PROJECT','PROJECT_LOCATION') OR @ProjectLocationId IS NOT NULL) FOR JSON PATH),N'[]')) delegations
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
        INSERT @page SELECT TOP(@PageSize+1) UserId FROM gp.Users WHERE (gp._AdminScopeAllowed(@actor,'ROLE_GRANTS_MANAGE',NULL,NULL,@now)=1 OR UserId=@actor OR EXISTS(SELECT 1 FROM gp.Employees e WHERE e.UserId=gp.Users.UserId AND e.IsActive=1) OR EXISTS(SELECT 1 FROM gp.StaffRoleGrants t WHERE t.UserId=gp.Users.UserId AND gp._StaffRoleDelegationAllowed(@actor,t.RoleCode,t.ScopeType,t.LocationId,t.ProjectId,t.ProjectLocationId,@now)=1)) AND (@AfterUserId IS NULL OR UserId>@AfterUserId) AND DisplayName LIKE @pattern ESCAPE N'~' ORDER BY UserId;
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._RequireRoleAdministrator @actor,@now;
        SET @more=CASE WHEN (SELECT COUNT(*) FROM @page)>@PageSize THEN 1 ELSE 0 END;
        IF @more=1 DELETE @page WHERE Id=(SELECT TOP(1) Id FROM @page ORDER BY Id DESC);
        IF @more=1 SELECT TOP(1) @after=Id FROM @page ORDER BY Id DESC;
        SET @result=(SELECT JSON_QUERY(COALESCE((SELECT u.UserId userId,u.DisplayName displayName,u.IsActive active,CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM gp.StaffProfiles sp JOIN gp.GuardCredentials c ON c.UserId=sp.UserId WHERE sp.UserId=u.UserId) AND NOT EXISTS(SELECT 1 FROM gp.Employees e WHERE e.UserId=u.UserId) THEN 1 ELSE 0 END) localAccount FROM @page pg JOIN gp.Users u ON u.UserId=pg.Id ORDER BY u.UserId FOR JSON PATH),N'[]')) users,
            @more hasMore,@after afterUserId,REPLACE(CONVERT(char(23),@now,121),' ','T')+'Z' checkedAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,ResultCode) VALUES(@actor,'STAFF_SUBJECTS_READ','ADMIN_QUERY','SUCCESS');
        COMMIT;SELECT @result;
    END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
ALTER PROCEDURE gp.ListScopedAuditEvents
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
        SET @result=(SELECT JSON_QUERY(COALESCE((SELECT CONVERT(varchar(20),a.AuditEventId) auditEventId,a.ActionCode actionCode,a.TargetType targetType,a.ResultCode resultCode,CASE WHEN a.ActionCode IN('STAFF_ACCOUNT_CREATED','STAFF_SETUP_ISSUED','STAFF_SETUP_REISSUED','GUARD_ALLOCATED') THEN JSON_VALUE(a.MetadataJson,'$.targetDisplayName') END targetDisplayName,CASE WHEN a.ActionCode IN('STAFF_ACCOUNT_CREATED','STAFF_SETUP_ISSUED','STAFF_SETUP_REISSUED','GUARD_ALLOCATED') THEN JSON_VALUE(a.MetadataJson,'$.staffCode') END staffCode,CASE WHEN a.ActionCode IN('STAFF_ACCOUNT_CREATED','STAFF_SETUP_ISSUED','STAFF_SETUP_REISSUED','GUARD_ALLOCATED') THEN JSON_VALUE(a.MetadataJson,'$.roleCode') END roleCode,CASE WHEN a.ActionCode IN('STAFF_ACCOUNT_CREATED','STAFF_SETUP_ISSUED','STAFF_SETUP_REISSUED','GUARD_ALLOCATED') THEN JSON_VALUE(a.MetadataJson,'$.scopeName') END scopeName,CASE WHEN a.ActionCode IN('STAFF_ACCOUNT_CREATED','STAFF_SETUP_ISSUED','STAFF_SETUP_REISSUED','GUARD_ALLOCATED') THEN JSON_VALUE(a.MetadataJson,'$.reason') END reason,
            a.LocationId locationId,CONVERT(varchar(20),a.ProjectLocationId) projectLocationId,COALESCE(u.DisplayName,N'System') actorDisplayName,
            REPLACE(CONVERT(char(23),a.OccurredAtUtc,121),' ','T')+'Z' occurredAtUtc
            FROM @page pg JOIN gp.SecurityAuditEvents a ON a.AuditEventId=pg.Id LEFT JOIN gp.Users u ON u.UserId=a.ActorUserId ORDER BY a.AuditEventId DESC FOR JSON PATH,INCLUDE_NULL_VALUES),N'[]')) events,
            @more hasMore,CONVERT(varchar(20),@after) afterAuditEventId,REPLACE(CONVERT(char(23),@now,121),' ','T')+'Z' checkedAtUtc FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,LocationId,ProjectLocationId,ResultCode) VALUES(@actor,'SCOPED_AUDIT_READ','AUDIT_QUERY',@LocationId,@ProjectLocationId,'SUCCESS');
        COMMIT;SELECT @result;
    END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON gp.CreateLocalStaffAccount TO gp_api_runtime;GRANT EXECUTE ON gp.ReissueLocalStaffSetup TO gp_api_runtime;INSERT gp.SchemaMigrations(Version,Description) VALUES('081',N'Scoped local guard/staff creation, one-use password setup and actor-target audit');COMMIT;
