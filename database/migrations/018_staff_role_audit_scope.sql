/* Forward audit-scope correction. Project/location role scope stores only the pair;
   derive the audit location from that trusted pair for both grant and revocation. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='017') THROW 52000,'Migration 017 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='018') THROW 52000,'Migration 018 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
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
        IF (SELECT COUNT(*) FROM OPENJSON(@CapabilitiesJson)) NOT BETWEEN 1 AND 7
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
        IF EXISTS(SELECT 1 FROM gp.StaffRoleGrants g WHERE g.UserId=@TargetUserId AND g.RevokedAtUtc IS NULL
            AND (@ValidUntilUtc IS NULL OR g.ValidFromUtc<@ValidUntilUtc) AND (g.ValidUntilUtc IS NULL OR @start<g.ValidUntilUtc)
            AND ((g.RoleCode=@RoleCode AND g.ScopeType=@ScopeType AND COALESCE(g.LocationId,0)=COALESCE(@LocationId,0) AND COALESCE(g.ProjectId,0)=COALESCE(@ProjectId,0) AND COALESCE(g.ProjectLocationId,0)=COALESCE(@ProjectLocationId,0))
                OR (@RoleCode='GUARD' AND g.RoleCode<>'GUARD') OR (@RoleCode<>'GUARD' AND g.RoleCode='GUARD')))
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
        DECLARE @target uniqueidentifier,@location int,@pair bigint,@revoked datetime2(3);
        SELECT @target=UserId,@location=LocationId,@pair=ProjectLocationId,@revoked=RevokedAtUtc FROM gp.StaffRoleGrants WHERE RoleGrantId=@RoleGrantId;
        IF @pair IS NOT NULL SELECT @location=LocationId FROM gp.ProjectLocations WHERE ProjectLocationId=@pair;
        IF @target IS NULL OR @target=@actor THROW 52001,'Not authorized for this target.',1;
        DECLARE @payload nvarchar(max)=(SELECT @RoleGrantId roleGrantId,@Reason reason FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        EXEC gp._BeginOperation @actor,'REVOKE_STAFF_ROLE',@ClientKey,@payload,@op OUTPUT,@cached OUTPUT;
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;EXEC gp._RequireRoleAdministrator @actor,@now;
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
INSERT gp.SchemaMigrations(Version,Description) VALUES('018',N'Derive project-location role audit scope from the trusted target pair');
COMMIT;
