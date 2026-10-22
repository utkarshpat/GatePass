/* Scoped console capabilities and guard assignments. No broad table authority. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54600,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='069') THROW 54600,'Migration 069 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='070') THROW 54600,'Migration 070 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
CREATE PROCEDURE gp.GetAdminConsoleScope @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@ProjectLocationId bigint=NULL
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
CREATE PROCEDURE gp.ListAdminGuardAssignments @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ProjectLocationId bigint,@AfterAssignmentId bigint=NULL
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
 SET @result=(SELECT JSON_QUERY(COALESCE((SELECT CONVERT(varchar(20),a.GuardAssignmentId) assignmentId,u.DisplayName guardName,a.GuardUserId userId,REPLACE(CONVERT(char(23),a.ValidFromUtc,121),' ','T')+'Z' validFromUtc,REPLACE(CONVERT(char(23),a.ValidUntilUtc,121),' ','T')+'Z' validUntilUtc FROM @page p JOIN gp.GuardAssignments a ON a.GuardAssignmentId=p.Id JOIN gp.Users u ON u.UserId=a.GuardUserId ORDER BY p.Id FOR JSON PATH),N'[]')) assignments,@more hasMore,CONVERT(varchar(20),@after) afterAssignmentId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,LocationId,ProjectLocationId,ResultCode) VALUES(@actor,'ADMIN_ASSIGNMENTS_READ','ADMIN_QUERY',@location,@ProjectLocationId,'SUCCESS');
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
GRANT EXECUTE ON gp.GetAdminConsoleScope TO gp_api_runtime;
GRANT EXECUTE ON gp.ListAdminGuardAssignments TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('070',N'Scoped admin console permissions and project guard assignment reads');
COMMIT;
