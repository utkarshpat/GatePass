/* Named office project groups. Group-sourced assignments retain independent provenance;
   existing duty authorization continues to use GuardAssignments without cached access. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='109') THROW 52000,'Migration 109 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='110') THROW 52000,'Migration 110 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
CREATE TABLE gp.ProjectGroups(
 ProjectGroupId bigint IDENTITY PRIMARY KEY,LocationId int NOT NULL REFERENCES gp.Locations(LocationId),
 GroupName nvarchar(100) NOT NULL,Revision int NOT NULL DEFAULT(1),IsActive bit NOT NULL DEFAULT(1),
 CreatedByUserId uniqueidentifier NOT NULL REFERENCES gp.Users(UserId),CreatedAtUtc datetime2(3) NOT NULL DEFAULT(SYSUTCDATETIME()),
 CONSTRAINT CK_ProjectGroups_Name CHECK(LEN(LTRIM(RTRIM(GroupName)))>0));
CREATE UNIQUE INDEX UX_ProjectGroups_Name ON gp.ProjectGroups(LocationId,GroupName) WHERE IsActive=1;
CREATE TABLE gp.ProjectGroupMembers(
 ProjectGroupId bigint NOT NULL REFERENCES gp.ProjectGroups(ProjectGroupId),ProjectLocationId bigint NOT NULL REFERENCES gp.ProjectLocations(ProjectLocationId),
 PRIMARY KEY(ProjectGroupId,ProjectLocationId));
CREATE TABLE gp.ProjectGroupGuardAssignments(
 GroupAssignmentId bigint IDENTITY PRIMARY KEY,ProjectGroupId bigint NOT NULL REFERENCES gp.ProjectGroups(ProjectGroupId),
 GuardUserId uniqueidentifier NOT NULL REFERENCES gp.Users(UserId),AssignedByUserId uniqueidentifier NOT NULL REFERENCES gp.Users(UserId),
 ValidFromUtc datetime2(3) NOT NULL,ValidUntilUtc datetime2(3) NULL,DeallocatedAtUtc datetime2(3) NULL,Reason nvarchar(300) NOT NULL,
 CONSTRAINT CK_ProjectGroupGuard_Window CHECK(ValidUntilUtc IS NULL OR ValidFromUtc<ValidUntilUtc));
CREATE INDEX IX_ProjectGroupGuard_Current ON gp.ProjectGroupGuardAssignments(ProjectGroupId,GuardUserId,DeallocatedAtUtc,ValidUntilUtc);
ALTER TABLE gp.GuardAssignments ADD GroupAssignmentId bigint NULL REFERENCES gp.ProjectGroupGuardAssignments(GroupAssignmentId);
GO
CREATE UNIQUE INDEX UX_GuardAssignment_GroupProject ON gp.GuardAssignments(GroupAssignmentId,ProjectLocationId) WHERE GroupAssignmentId IS NOT NULL AND DeallocatedAtUtc IS NULL;
GO
CREATE FUNCTION gp._ProjectGroupGuardEligible(@Guard uniqueidentifier,@Location int,@Start datetime2(3),@End datetime2(3)) RETURNS bit WITH INLINE=OFF AS BEGIN
 IF NOT EXISTS(SELECT 1 FROM gp.Users WHERE UserId=@Guard AND IsActive=1) RETURN 0;
 IF NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants g WHERE g.UserId=@Guard AND g.RoleCode='GUARD' AND g.ScopeType='LOCATION' AND g.LocationId=@Location
 AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@Start AND(g.ValidUntilUtc IS NULL OR @End IS NOT NULL AND @End<=g.ValidUntilUtc)
 AND EXISTS(SELECT 1 FROM gp.GrantCapabilities WHERE RoleGrantId=g.RoleGrantId AND CapabilityCode='PROJECT_MOVEMENT')
 AND EXISTS(SELECT 1 FROM gp.GrantCapabilities WHERE RoleGrantId=g.RoleGrantId AND CapabilityCode='VISITS_READ')) RETURN 0;
 IF EXISTS(SELECT 1 FROM gp.StaffRoleGrants g WHERE g.UserId=@Guard AND g.RoleCode NOT IN('GUARD','RECEPTION') AND g.RevokedAtUtc IS NULL
 AND(@End IS NULL OR g.ValidFromUtc<@End) AND(g.ValidUntilUtc IS NULL OR @Start<g.ValidUntilUtc)) RETURN 0;
 RETURN 1;
END;
GO
CREATE PROCEDURE gp.GetAdminProjectGroups @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@result nvarchar(max);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 IF @LocationId IS NULL OR NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@LocationId AND IsActive=1)
 OR gp._AdminScopeAllowed(@actor,'GUARDS_MANAGE',@LocationId,NULL,@now)=0 THROW 52001,'Office guard administration required.',1;
 SET @result=(SELECT JSON_QUERY(COALESCE((SELECT CONVERT(varchar(20),g.ProjectGroupId) groupId,g.GroupName name,g.Revision revision,
 JSON_QUERY(COALESCE((SELECT CONVERT(varchar(20),m.ProjectLocationId) projectLocationId,p.ProjectName projectName,p.ExternalProjectCode projectCode
 FROM gp.ProjectGroupMembers m JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=m.ProjectLocationId JOIN gp.Projects p ON p.ProjectId=pl.ProjectId
 WHERE m.ProjectGroupId=g.ProjectGroupId ORDER BY m.ProjectLocationId FOR JSON PATH),N'[]')) projects,
 JSON_QUERY(COALESCE((SELECT CONVERT(varchar(20),a.GroupAssignmentId) groupAssignmentId,a.GuardUserId userId,u.DisplayName guardName,
 REPLACE(CONVERT(char(23),a.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),a.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc
 FROM gp.ProjectGroupGuardAssignments a JOIN gp.Users u ON u.UserId=a.GuardUserId WHERE a.ProjectGroupId=g.ProjectGroupId
 AND a.DeallocatedAtUtc IS NULL AND(a.ValidUntilUtc IS NULL OR @now<a.ValidUntilUtc) ORDER BY a.GroupAssignmentId FOR JSON PATH),N'[]')) assignments
 FROM gp.ProjectGroups g WHERE g.LocationId=@LocationId AND g.IsActive=1 ORDER BY g.GroupName,g.ProjectGroupId FOR JSON PATH),N'[]')) groups FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp.ManageProjectGroup
 @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ClientKey uniqueidentifier,@LocationId int,
 @Action varchar(20),@ProjectGroupId bigint=NULL,@ExpectedRevision int=NULL,@GroupName nvarchar(max)=NULL,@ProjectLocationIdsJson nvarchar(max)=NULL,@Reason nvarchar(max)=NULL AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@op uniqueidentifier,@cached nvarchar(max),@result nvarchar(max);
 BEGIN TRY
 IF @Action IS NULL OR @Action COLLATE Latin1_General_100_BIN2 NOT IN('SAVE','ARCHIVE') OR @LocationId IS NULL OR @LocationId<=0
 OR @Reason IS NULL OR DATALENGTH(@Reason)>600 OR LEN(LTRIM(RTRIM(@Reason)))=0
 OR (@ProjectGroupId IS NULL AND(@Action<>'SAVE' OR @ExpectedRevision IS NOT NULL))
 OR (@ProjectGroupId IS NOT NULL AND(@ProjectGroupId<=0 OR @ExpectedRevision IS NULL OR @ExpectedRevision<=0)) THROW 52002,'Invalid group input.',1;
 DECLARE @members table(Id bigint PRIMARY KEY);
 IF @Action='SAVE' BEGIN
 IF @GroupName IS NULL OR DATALENGTH(@GroupName)>200 OR LEN(LTRIM(RTRIM(@GroupName)))=0 OR @ProjectLocationIdsJson IS NULL OR DATALENGTH(@ProjectLocationIdsJson)>4000
 OR ISJSON(@ProjectLocationIdsJson)<>1 OR LEFT(LTRIM(@ProjectLocationIdsJson),1)<>'[' THROW 52002,'Invalid group projects.',1;
 IF (SELECT COUNT(*) FROM OPENJSON(@ProjectLocationIdsJson)) NOT BETWEEN 1 AND 50
 OR EXISTS(SELECT 1 FROM OPENJSON(@ProjectLocationIdsJson) WHERE type<>1 OR TRY_CONVERT(bigint,value) IS NULL OR TRY_CONVERT(bigint,value)<=0 OR value<>CONVERT(varchar(20),TRY_CONVERT(bigint,value)))
 OR EXISTS(SELECT value FROM OPENJSON(@ProjectLocationIdsJson) GROUP BY value HAVING COUNT(*)>1) THROW 52002,'Unique project IDs required.',1;
 INSERT @members SELECT CONVERT(bigint,value) FROM OPENJSON(@ProjectLocationIdsJson);
 END;
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 IF NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@LocationId AND IsActive=1)
 OR gp._AdminScopeAllowed(@actor,'GUARDS_MANAGE',@LocationId,NULL,@now)=0 THROW 52001,'Office guard administration required.',1;
 DECLARE @payload nvarchar(max)=(SELECT @LocationId locationId,@Action action,@ProjectGroupId groupId,@ExpectedRevision revision,@GroupName name,JSON_QUERY(@ProjectLocationIdsJson) projects,@Reason reason FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER);
 EXEC gp._BeginOperation @actor,'MANAGE_PROJECT_GROUP',@ClientKey,@payload,@op OUTPUT,@cached OUTPUT;
 EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 IF gp._AdminScopeAllowed(@actor,'GUARDS_MANAGE',@LocationId,NULL,@now)=0 THROW 52001,'Not authorized.',1;
 IF @cached IS NOT NULL BEGIN COMMIT;SELECT @cached;RETURN;END;
 IF @ProjectGroupId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gp.ProjectGroups WHERE ProjectGroupId=@ProjectGroupId AND LocationId=@LocationId AND IsActive=1) THROW 52001,'Group not available in office.',1;
 IF @ProjectGroupId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gp.ProjectGroups WHERE ProjectGroupId=@ProjectGroupId AND Revision=@ExpectedRevision) THROW 52003,'Group changed. Refresh before saving.',1;
 DECLARE @cutoff datetime2(3);EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF @Action='SAVE' BEGIN
 IF EXISTS(SELECT 1 FROM @members m WHERE NOT EXISTS(SELECT 1 FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId
 WHERE pl.ProjectLocationId=m.Id AND pl.LocationId=@LocationId AND pl.IsActive=1 AND p.IsActive=1
 AND gp._ProjectCurrent(p.ProjectId,@cutoff,@now)=1)) THROW 52004,'Active current projects in this office required.',1;
 IF EXISTS(SELECT 1 FROM gp.ProjectGroups WHERE LocationId=@LocationId AND IsActive=1 AND GroupName=LTRIM(RTRIM(@GroupName)) AND(@ProjectGroupId IS NULL OR ProjectGroupId<>@ProjectGroupId)) THROW 52003,'Group name already exists.',1;
 IF @ProjectGroupId IS NULL BEGIN
 IF (SELECT COUNT(*) FROM gp.ProjectGroups WHERE LocationId=@LocationId AND IsActive=1)>=100 THROW 52003,'Office group limit reached.',1;
 INSERT gp.ProjectGroups(LocationId,GroupName,CreatedByUserId) VALUES(@LocationId,LTRIM(RTRIM(@GroupName)),@actor);SET @ProjectGroupId=CONVERT(bigint,SCOPE_IDENTITY());
 END ELSE UPDATE gp.ProjectGroups SET GroupName=LTRIM(RTRIM(@GroupName)),Revision=Revision+1 WHERE ProjectGroupId=@ProjectGroupId;
 /* Adding projects must never revive an ineligible/revoked guard's authority. */
 IF EXISTS(SELECT 1 FROM @members m WHERE NOT EXISTS(SELECT 1 FROM gp.ProjectGroupMembers WHERE ProjectGroupId=@ProjectGroupId AND ProjectLocationId=m.Id))
 AND EXISTS(SELECT 1 FROM gp.ProjectGroupGuardAssignments a WHERE a.ProjectGroupId=@ProjectGroupId AND a.DeallocatedAtUtc IS NULL AND(a.ValidUntilUtc IS NULL OR @now<a.ValidUntilUtc)
 AND gp._ProjectGroupGuardEligible(a.GuardUserId,@LocationId,CASE WHEN a.ValidFromUtc>@now THEN a.ValidFromUtc ELSE @now END,a.ValidUntilUtc)=0) THROW 52004,'Remove ineligible group guards before adding projects.',1;
 UPDATE a SET DeallocatedAtUtc=@now,DeallocatedByUserId=@actor FROM gp.GuardAssignments a JOIN gp.ProjectGroupGuardAssignments b ON b.GroupAssignmentId=a.GroupAssignmentId
 WHERE b.ProjectGroupId=@ProjectGroupId AND a.DeallocatedAtUtc IS NULL AND NOT EXISTS(SELECT 1 FROM @members WHERE Id=a.ProjectLocationId);
 DELETE FROM gp.ProjectGroupMembers WHERE ProjectGroupId=@ProjectGroupId AND ProjectLocationId NOT IN(SELECT Id FROM @members);
 INSERT gp.ProjectGroupMembers SELECT @ProjectGroupId,Id FROM @members m WHERE NOT EXISTS(SELECT 1 FROM gp.ProjectGroupMembers WHERE ProjectGroupId=@ProjectGroupId AND ProjectLocationId=m.Id);
 INSERT gp.GuardAssignments(GuardUserId,ProjectLocationId,AssignedByUserId,ValidFromUtc,ValidUntilUtc,Reason,GroupAssignmentId)
 SELECT a.GuardUserId,m.Id,@actor,CASE WHEN a.ValidFromUtc>@now THEN a.ValidFromUtc ELSE @now END,a.ValidUntilUtc,@Reason,a.GroupAssignmentId
 FROM gp.ProjectGroupGuardAssignments a CROSS JOIN @members m WHERE a.ProjectGroupId=@ProjectGroupId AND a.DeallocatedAtUtc IS NULL AND(a.ValidUntilUtc IS NULL OR @now<a.ValidUntilUtc)
 AND NOT EXISTS(SELECT 1 FROM gp.GuardAssignments x WHERE x.GroupAssignmentId=a.GroupAssignmentId AND x.ProjectLocationId=m.Id AND x.DeallocatedAtUtc IS NULL);
 END ELSE BEGIN
 UPDATE gp.ProjectGroups SET IsActive=0,Revision=Revision+1 WHERE ProjectGroupId=@ProjectGroupId;
 UPDATE a SET DeallocatedAtUtc=@now,DeallocatedByUserId=@actor FROM gp.GuardAssignments a JOIN gp.ProjectGroupGuardAssignments b ON b.GroupAssignmentId=a.GroupAssignmentId WHERE b.ProjectGroupId=@ProjectGroupId AND a.DeallocatedAtUtc IS NULL;
 UPDATE gp.ProjectGroupGuardAssignments SET DeallocatedAtUtc=@now WHERE ProjectGroupId=@ProjectGroupId AND DeallocatedAtUtc IS NULL;
 END;
 /* Duty access is checked fresh in SQL on every call. Keep valid sessions live for group edits. */
 SET @result=(SELECT @op operationId,CONVERT(varchar(20),@ProjectGroupId) groupId,Revision revision,@Action action FROM gp.ProjectGroups WHERE ProjectGroupId=@ProjectGroupId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ResultCode,MetadataJson)
 VALUES(@actor,'PROJECT_GROUP_CHANGED','PROJECT_GROUP',CONVERT(varchar(100),@ProjectGroupId),@LocationId,'SUCCESS',JSON_MODIFY(@payload,'$.result',JSON_QUERY(@result)));
 EXEC gp._CompleteOperation @op,@result;COMMIT;SELECT @result;
 END TRY BEGIN CATCH DECLARE @error int=ERROR_NUMBER();IF @@TRANCOUNT>0 ROLLBACK;EXEC gp._AuditFailure @actor,'PROJECT_GROUP_CHANGE_FAILED',NULL,@error;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp.ManageProjectGroupGuard
 @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ClientKey uniqueidentifier,@LocationId int,@ProjectGroupId bigint,@ExpectedRevision int,
 @Action varchar(20),@GuardUserId uniqueidentifier=NULL,@GroupAssignmentId bigint=NULL,@ValidUntilUtc datetime2(3)=NULL,@Reason nvarchar(max)=NULL AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@op uniqueidentifier,@cached nvarchar(max),@result nvarchar(max);
 BEGIN TRY
 IF @Action IS NULL OR @Action COLLATE Latin1_General_100_BIN2 NOT IN('ASSIGN','REMOVE') OR @LocationId IS NULL OR @LocationId<=0 OR @ProjectGroupId IS NULL OR @ProjectGroupId<=0 OR @ExpectedRevision IS NULL OR @ExpectedRevision<=0
 OR @Reason IS NULL OR DATALENGTH(@Reason)>600 OR LEN(LTRIM(RTRIM(@Reason)))=0
 OR(@Action='ASSIGN' AND(@GuardUserId IS NULL OR @GroupAssignmentId IS NOT NULL)) OR(@Action='REMOVE' AND(@GroupAssignmentId IS NULL OR @GroupAssignmentId<=0 OR @GuardUserId IS NOT NULL OR @ValidUntilUtc IS NOT NULL)) THROW 52002,'Invalid group assignment.',1;
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 IF gp._AdminScopeAllowed(@actor,'GUARDS_MANAGE',@LocationId,NULL,@now)=0 OR NOT EXISTS(SELECT 1 FROM gp.ProjectGroups g JOIN gp.Locations l ON l.LocationId=g.LocationId WHERE g.ProjectGroupId=@ProjectGroupId AND g.LocationId=@LocationId AND g.IsActive=1 AND l.IsActive=1) THROW 52001,'Not authorized.',1;
 DECLARE @payload nvarchar(max)=(SELECT @LocationId locationId,@ProjectGroupId groupId,@ExpectedRevision revision,@Action action,@GuardUserId guardUserId,@GroupAssignmentId groupAssignmentId,@ValidUntilUtc validUntilUtc,@Reason reason FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER);
 EXEC gp._BeginOperation @actor,'MANAGE_GROUP_GUARD',@ClientKey,@payload,@op OUTPUT,@cached OUTPUT;
 EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 IF gp._AdminScopeAllowed(@actor,'GUARDS_MANAGE',@LocationId,NULL,@now)=0 THROW 52001,'Not authorized.',1;
 IF @cached IS NOT NULL BEGIN COMMIT;SELECT @cached;RETURN;END;
 IF NOT EXISTS(SELECT 1 FROM gp.ProjectGroups WHERE ProjectGroupId=@ProjectGroupId AND Revision=@ExpectedRevision) THROW 52003,'Group changed. Refresh before assigning.',1;
 IF @Action='ASSIGN' BEGIN
 IF @GuardUserId=@actor THROW 52001,'Self assignment not authorized.',1;
 IF @ValidUntilUtc<=@now THROW 52002,'Future end date required.',1;
 IF gp._ProjectGroupGuardEligible(@GuardUserId,@LocationId,@now,@ValidUntilUtc)=0 THROW 52004,'Compatible guard role must cover the duty interval.',1;
 DECLARE @cutoff datetime2(3);EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF NOT EXISTS(SELECT 1 FROM gp.ProjectGroupMembers WHERE ProjectGroupId=@ProjectGroupId) OR EXISTS(
 SELECT 1 FROM gp.ProjectGroupMembers m JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=m.ProjectLocationId JOIN gp.Projects p ON p.ProjectId=pl.ProjectId
 WHERE m.ProjectGroupId=@ProjectGroupId AND(pl.LocationId<>@LocationId OR pl.IsActive=0 OR p.IsActive=0 OR gp._ProjectCurrent(p.ProjectId,@cutoff,@now)=0)) THROW 52004,'Current active group projects required.',1;
 IF EXISTS(SELECT 1 FROM gp.ProjectGroupGuardAssignments WHERE ProjectGroupId=@ProjectGroupId AND GuardUserId=@GuardUserId AND DeallocatedAtUtc IS NULL AND(ValidUntilUtc IS NULL OR @now<ValidUntilUtc)) THROW 52003,'Guard already assigned to group.',1;
 IF (SELECT COUNT(*) FROM gp.ProjectGroupGuardAssignments WHERE ProjectGroupId=@ProjectGroupId AND DeallocatedAtUtc IS NULL AND(ValidUntilUtc IS NULL OR @now<ValidUntilUtc))>=50 THROW 52003,'Group guard limit reached.',1;
 INSERT gp.ProjectGroupGuardAssignments(ProjectGroupId,GuardUserId,AssignedByUserId,ValidFromUtc,ValidUntilUtc,Reason) VALUES(@ProjectGroupId,@GuardUserId,@actor,@now,@ValidUntilUtc,@Reason);SET @GroupAssignmentId=CONVERT(bigint,SCOPE_IDENTITY());
 INSERT gp.GuardAssignments(GuardUserId,ProjectLocationId,AssignedByUserId,ValidFromUtc,ValidUntilUtc,Reason,GroupAssignmentId)
 SELECT @GuardUserId,ProjectLocationId,@actor,@now,@ValidUntilUtc,@Reason,@GroupAssignmentId FROM gp.ProjectGroupMembers WHERE ProjectGroupId=@ProjectGroupId;
 END ELSE BEGIN
 SELECT @GuardUserId=GuardUserId FROM gp.ProjectGroupGuardAssignments WHERE GroupAssignmentId=@GroupAssignmentId AND ProjectGroupId=@ProjectGroupId AND DeallocatedAtUtc IS NULL;
 IF @GuardUserId IS NULL THROW 52003,'Group assignment already removed or unavailable.',1;
 UPDATE gp.ProjectGroupGuardAssignments SET DeallocatedAtUtc=@now WHERE GroupAssignmentId=@GroupAssignmentId;
 UPDATE gp.GuardAssignments SET DeallocatedAtUtc=@now,DeallocatedByUserId=@actor WHERE GroupAssignmentId=@GroupAssignmentId AND DeallocatedAtUtc IS NULL;
 END;
 UPDATE gp.ProjectGroups SET Revision=Revision+1 WHERE ProjectGroupId=@ProjectGroupId;
 /* Existing valid guard sessions observe the new duty set on their next read. */
 SET @result=(SELECT @op operationId,CONVERT(varchar(20),@ProjectGroupId) groupId,Revision revision,CONVERT(varchar(20),@GroupAssignmentId) groupAssignmentId,@Action action FROM gp.ProjectGroups WHERE ProjectGroupId=@ProjectGroupId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ResultCode,MetadataJson) VALUES(@actor,'PROJECT_GROUP_GUARD_CHANGED','PROJECT_GROUP',CONVERT(varchar(100),@ProjectGroupId),@LocationId,'SUCCESS',JSON_MODIFY(@payload,'$.result',JSON_QUERY(@result)));
 EXEC gp._CompleteOperation @op,@result;COMMIT;SELECT @result;
 END TRY BEGIN CATCH DECLARE @error int=ERROR_NUMBER();IF @@TRANCOUNT>0 ROLLBACK;EXEC gp._AuditFailure @actor,'GROUP_GUARD_CHANGE_FAILED',NULL,@error;THROW;END CATCH;
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
        IF EXISTS(SELECT 1 FROM gp.GuardAssignments WHERE GuardUserId=@GuardUserId AND ProjectLocationId=@ProjectLocationId AND GroupAssignmentId IS NULL AND DeallocatedAtUtc IS NULL
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
ALTER PROCEDURE gp.DeallocateGuard
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ClientKey uniqueidentifier,
    @GuardAssignmentId bigint,@Reason nvarchar(600)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 52000, 'Ambient transactions are not accepted.', 1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@op uniqueidentifier,@cached nvarchar(max),@result nvarchar(max);
    BEGIN TRY
        IF @GuardAssignmentId IS NULL OR @Reason IS NULL OR LEN(LTRIM(RTRIM(@Reason)))=0 OR DATALENGTH(@Reason)>600
            THROW 52002, 'Invalid deallocation input.', 1;
        BEGIN TRANSACTION;
        EXEC gp._TakeLock N'gp:authorization','Exclusive';
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        DECLARE @payload nvarchar(max)=(SELECT @GuardAssignmentId AS assignmentId,@Reason AS reason FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        EXEC gp._BeginOperation @actor,'DEALLOCATE_GUARD',@ClientKey,@payload,@op OUTPUT,@cached OUTPUT;
        EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        DECLARE @guard uniqueidentifier,@pair bigint,@location int,@revoked datetime2(3);
        SELECT @guard=a.GuardUserId,@pair=a.ProjectLocationId,@location=pl.LocationId,@revoked=a.DeallocatedAtUtc
        FROM gp.GuardAssignments a JOIN gp.ProjectLocations pl ON pl.ProjectLocationId=a.ProjectLocationId
        WHERE a.GuardAssignmentId=@GuardAssignmentId;
        IF @guard IS NULL OR gp._HasCapability(@actor,'GUARDS_MANAGE',@location,@pair,0,@now)=0
            THROW 52001, 'Not authorized.', 1;
        IF @cached IS NOT NULL
        BEGIN
            COMMIT;
            SELECT @cached AS ResultJson;
            RETURN;
        END;
        IF EXISTS(SELECT 1 FROM gp.GuardAssignments WHERE GuardAssignmentId=@GuardAssignmentId AND GroupAssignmentId IS NOT NULL) THROW 52003,'Remove the group assignment instead.',1;
        IF @revoked IS NOT NULL THROW 52005, 'Allocation already deallocated.', 1;
        UPDATE gp.GuardAssignments SET DeallocatedAtUtc=@now,DeallocatedByUserId=@actor,Reason=@Reason WHERE GuardAssignmentId=@GuardAssignmentId;
        UPDATE gp.Users SET AuthorizationVersion=AuthorizationVersion+1 WHERE UserId=@guard;
        SET @result=(SELECT @op AS operationId,@GuardAssignmentId AS assignmentId,CONVERT(bit,1) AS deallocated FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode,MetadataJson)
        VALUES(@actor,'GUARD_DEALLOCATED','GUARD_ASSIGNMENT',CONVERT(varchar(100),@GuardAssignmentId),@location,@pair,'SUCCESS',@result);
        EXEC gp._CompleteOperation @op,@result;
        COMMIT;
        SELECT @result AS ResultJson;
    END TRY
    BEGIN CATCH
        DECLARE @error int=ERROR_NUMBER(),@target varchar(100)=CONVERT(varchar(100),@GuardAssignmentId);
        IF @@TRANCOUNT>0 ROLLBACK;
        EXEC gp._AuditFailure @actor,'GUARD_DEALLOCATION_FAILED',@target,@error;
        THROW;
    END CATCH;
END;
GO
ALTER PROCEDURE gp.ListAdminGuardAssignments @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ProjectLocationId bigint,@AfterAssignmentId bigint=NULL
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 54600,'Ambient transaction not accepted.',1;
 IF @ProjectLocationId IS NULL OR @ProjectLocationId<=0 OR @AfterAssignmentId<=0 THROW 52002,'Invalid assignment page.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@location int,@result nvarchar(max),@more bit,@after bigint;
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 SELECT @location=LocationId FROM gp.ProjectLocations WHERE ProjectLocationId=@ProjectLocationId;
 IF @location IS NULL OR gp._AdminScopeAllowed(@actor,'GUARDS_MANAGE',@location,@ProjectLocationId,@now)=0 THROW 52001,'Not authorized.',1;
 DECLARE @page table(Id bigint PRIMARY KEY);
 INSERT @page SELECT TOP(51) GuardAssignmentId FROM gp.GuardAssignments WHERE ProjectLocationId=@ProjectLocationId AND DeallocatedAtUtc IS NULL AND(ValidUntilUtc IS NULL OR @now<ValidUntilUtc) AND(@AfterAssignmentId IS NULL OR GuardAssignmentId>@AfterAssignmentId) ORDER BY GuardAssignmentId;
 SET @more=CASE WHEN(SELECT COUNT(*) FROM @page)>50 THEN 1 ELSE 0 END;IF @more=1 DELETE @page WHERE Id=(SELECT MAX(Id) FROM @page);SELECT @after=CASE WHEN @more=1 THEN MAX(Id) END FROM @page;
 SET @result=(SELECT JSON_QUERY(COALESCE((SELECT CONVERT(varchar(20),a.GuardAssignmentId) assignmentId,u.DisplayName guardName,a.GuardUserId userId,CONVERT(varchar(20),a.GroupAssignmentId) groupAssignmentId,CONVERT(varchar(20),b.ProjectGroupId) groupId,g.GroupName groupName,REPLACE(CONVERT(char(23),a.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),a.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc FROM @page p JOIN gp.GuardAssignments a ON a.GuardAssignmentId=p.Id JOIN gp.Users u ON u.UserId=a.GuardUserId LEFT JOIN gp.ProjectGroupGuardAssignments b ON b.GroupAssignmentId=a.GroupAssignmentId LEFT JOIN gp.ProjectGroups g ON g.ProjectGroupId=b.ProjectGroupId ORDER BY p.Id FOR JSON PATH),N'[]')) assignments,@more hasMore,CONVERT(varchar(20),@after) afterAssignmentId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,LocationId,ProjectLocationId,ResultCode) VALUES(@actor,'ADMIN_ASSIGNMENTS_READ','ADMIN_QUERY',@location,@ProjectLocationId,'SUCCESS');
 COMMIT;SELECT @result;
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
 gp._AdminScopeAllowed(@actor,'REPORTS_EXPORT',@LocationId,@ProjectLocationId,@now) canExport,
 gp._AdminScopeAllowed(@actor,'AUDIT_READ',@LocationId,@ProjectLocationId,@now) canAudit,
 gp._AdminScopeAllowed(@actor,'GUARDS_MANAGE',@LocationId,@ProjectLocationId,@now) canAssignGuards,
 gp._AdminScopeAllowed(@actor,'GUARDS_MANAGE',@LocationId,NULL,@now) canManageProjectGroups,
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
GRANT EXECUTE ON gp.GetAdminProjectGroups TO gp_api_runtime;
GRANT EXECUTE ON gp.ManageProjectGroup TO gp_api_runtime;
GRANT EXECUTE ON gp.ManageProjectGroupGuard TO gp_api_runtime;
DENY SELECT,INSERT,UPDATE,DELETE,ALTER ON gp.ProjectGroups TO gp_api_runtime;
DENY SELECT,INSERT,UPDATE,DELETE,ALTER ON gp.ProjectGroupMembers TO gp_api_runtime;
DENY SELECT,INSERT,UPDATE,DELETE,ALTER ON gp.ProjectGroupGuardAssignments TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('110',N'Office project groups and live independent guard assignment sources');COMMIT;
