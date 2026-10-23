/* Office-scoped project creation. Local catalogue entries do not expire with the directory cache;
   employee identity, office and membership freshness remain independently enforced. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54600,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='085') THROW 54600,'Migration 085 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='086') THROW 54600,'Migration 086 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
ALTER TABLE gp.Projects ADD IsLocallyManaged bit NOT NULL CONSTRAINT DF_Projects_IsLocallyManaged DEFAULT(0);
GO
CREATE FUNCTION gp._ProjectCurrent(@Project bigint,@Cutoff datetime2(3),@Now datetime2(3)) RETURNS bit
AS BEGIN
 RETURN CASE WHEN EXISTS(SELECT 1 FROM gp.Projects WHERE ProjectId=@Project AND IsActive=1 AND(IsLocallyManaged=1 OR LastSyncedAtUtc BETWEEN @Cutoff AND @Now)) THEN 1 ELSE 0 END;
END;
GO
CREATE PROCEDURE gp.CreateScopedProject @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ClientKey uniqueidentifier,@LocationId int,@ProjectName nvarchar(max),@ProjectCode nvarchar(max),@Reason nvarchar(max)
AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 54600,'Ambient transaction not accepted.',1;
 IF @ClientKey IS NULL OR @LocationId IS NULL OR @LocationId<=0 OR @ProjectName IS NULL OR DATALENGTH(@ProjectName)>400 OR LEN(LTRIM(RTRIM(@ProjectName)))=0
 OR @ProjectCode IS NULL OR DATALENGTH(@ProjectCode) NOT BETWEEN 6 AND 128 OR @ProjectCode COLLATE Latin1_General_100_BIN2 LIKE N'%[^A-Z0-9._-]%' OR @ProjectCode COLLATE Latin1_General_100_BIN2 LIKE N'[^A-Z0-9]%'
 OR @Reason IS NULL OR DATALENGTH(@Reason)>600 OR LEN(LTRIM(RTRIM(@Reason)))=0 THROW 52002,'Invalid project input.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@op uniqueidentifier,@cached nvarchar(max),@result nvarchar(max),@project bigint,@pair bigint,@metadata nvarchar(max);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 -- A project-scoped grant never authorizes creation of a new sibling project.
 IF gp._AdminScopeAllowed(@actor,'ROLE_GRANTS_MANAGE',@LocationId,NULL,@now)=0 OR NOT EXISTS(SELECT 1 FROM gp.Locations WHERE LocationId=@LocationId AND IsActive=1) THROW 52001,'Not authorized.',1;
 DECLARE @payload nvarchar(max)=(SELECT @LocationId locationId,@ProjectName projectName,@ProjectCode projectCode,@Reason reason FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 EXEC gp._BeginOperation @actor,'CREATE_SCOPED_PROJECT',@ClientKey,@payload,@op OUTPUT,@cached OUTPUT;
 IF @cached IS NOT NULL BEGIN COMMIT;SELECT @cached;RETURN;END;
 IF EXISTS(SELECT 1 FROM gp.Projects WHERE ExternalProjectCode=@ProjectCode) THROW 52003,'Project code unavailable.',1;
 INSERT gp.Projects(ExternalProjectCode,ProjectName,IsLocallyManaged) VALUES(@ProjectCode,LTRIM(RTRIM(@ProjectName)),1);SET @project=SCOPE_IDENTITY();
 INSERT gp.ProjectLocations(ProjectId,LocationId) VALUES(@project,@LocationId);SET @pair=SCOPE_IDENTITY();
 SET @metadata=(SELECT @ProjectName projectName,@ProjectCode projectCode,@Reason reason FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode,MetadataJson) VALUES(@actor,'PROJECT_CREATED','PROJECT_LOCATION',CONVERT(varchar(20),@pair),@LocationId,@pair,'SUCCESS',@metadata);
 SET @result=(SELECT CONVERT(varchar(20),@project) projectId,CONVERT(varchar(20),@pair) projectLocationId,@LocationId locationId FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 EXEC gp._CompleteOperation @op,@result;COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
-- Advertise precisely the permission enforced again by the mutation.
DECLARE @context nvarchar(max)=OBJECT_DEFINITION(OBJECT_ID('gp.GetAdminWorkspaceContext'));
IF @context IS NULL OR CHARINDEX('l.LocationCode locationCode,',@context)=0 THROW 54600,'Workspace contract changed.',1;
SET @context=REPLACE(@context,'l.LocationCode locationCode,','l.LocationCode locationCode,gp._AdminScopeAllowed(@actor,''ROLE_GRANTS_MANAGE'',l.LocationId,NULL,@now) canCreateProject,');
SET @context=STUFF(@context,1,6,'ALTER');EXEC sys.sp_executesql @context;
GO
-- Keep every existing project consumer consistent; no employee freshness or membership policy changes.
DECLARE @name sysname,@definition nvarchar(max),@before nvarchar(max);
DECLARE consumers CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM (VALUES
(N'gp.ListAdminProjectLocations'),
(N'gp.ListAdminGuards'),
(N'gp.GetStaffAccessContext'),
(N'gp.SubmitRegistration'),
(N'gp._VisitReadAllowed'),
(N'gp.ListLeadProjects'),
(N'gp.SearchProjectLeadCandidates'),
(N'gp.GetRegistrationOptions'),
(N'gp._ReadPrintCardDetails'),
(N'gp.AllocateGuard'),
(N'gp.GrantStaffRole'),
(N'gp._EmployeeProjectLocationEligible')) x(name);
OPEN consumers;FETCH NEXT FROM consumers INTO @name;
WHILE @@FETCH_STATUS=0 BEGIN
 SET @definition=OBJECT_DEFINITION(OBJECT_ID(@name));SET @before=@definition;
 SET @definition=REPLACE(@definition,N'lp.LastSyncedAtUtc BETWEEN @cutoff AND @now',N'gp._ProjectCurrent(lp.ProjectId,@cutoff,@now)=1');
 SET @definition=REPLACE(@definition,N'p.LastSyncedAtUtc BETWEEN @cutoff AND @now',N'gp._ProjectCurrent(p.ProjectId,@cutoff,@now)=1');
 SET @definition=REPLACE(@definition,N'p.LastSyncedAtUtc BETWEEN @Cutoff AND @Now',N'gp._ProjectCurrent(p.ProjectId,@Cutoff,@Now)=1');
 SET @definition=REPLACE(@definition,N'p.LastSyncedAtUtc BETWEEN @leadCutoff AND @now',N'gp._ProjectCurrent(p.ProjectId,@leadCutoff,@now)=1');
 SET @definition=REPLACE(@definition,N'ProjectId=@project AND LastSyncedAtUtc BETWEEN @cutoff AND @now',N'ProjectId=@project AND gp._ProjectCurrent(ProjectId,@cutoff,@now)=1');
 SET @definition=REPLACE(@definition,N'p.LastSyncedAtUtc IS NULL OR p.LastSyncedAtUtc<@cutoff OR p.LastSyncedAtUtc>@Now',N'gp._ProjectCurrent(p.ProjectId,@cutoff,@Now)=0');
 IF @definition IS NULL OR @definition=@before THROW 54600,'Project consumer contract changed.',1;
 SET @definition=STUFF(@definition,1,6,'ALTER');EXEC sys.sp_executesql @definition;
 FETCH NEXT FROM consumers INTO @name;
END;CLOSE consumers;DEALLOCATE consumers;
GRANT EXECUTE ON gp.CreateScopedProject TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('086',N'Office-scoped audited project creation and persistent local catalogue');COMMIT;
