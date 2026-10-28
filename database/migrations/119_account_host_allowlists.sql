/* Existing Project/ProjectLocation identifiers now represent Account/Account-office.
   Hosts are explicit, fail-closed account-office approvals, not inferred from membership. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='118') THROW 52000,'Migration 118 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='119') THROW 52000,'Migration 119 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
CREATE TABLE gp.AccountHosts(
 ProjectLocationId bigint NOT NULL REFERENCES gp.ProjectLocations(ProjectLocationId),
 EmployeeId nvarchar(64) NOT NULL REFERENCES gp.Employees(EmployeeId),
 IsActive bit NOT NULL,Revision int NOT NULL DEFAULT(1),
 ChangedByUserId uniqueidentifier NOT NULL REFERENCES gp.Users(UserId),ChangedAtUtc datetime2(3) NOT NULL,
 Reason nvarchar(300) NOT NULL,
 CONSTRAINT PK_AccountHosts PRIMARY KEY(ProjectLocationId,EmployeeId),
 CONSTRAINT CK_AccountHosts_Revision CHECK(Revision>0));
GO
CREATE FUNCTION gp._AccountHostEligible(@Employee nvarchar(64),@Pair bigint,@Cutoff datetime2(3),@Now datetime2(3)) RETURNS bit WITH INLINE=OFF AS BEGIN
 IF NOT EXISTS(SELECT 1 FROM gp.AccountHosts WHERE ProjectLocationId=@Pair AND EmployeeId=@Employee AND IsActive=1) RETURN 0;
 RETURN gp._EmployeeProjectLocationEligible(@Employee,@Pair,@Cutoff,@Now);
END;
GO
CREATE PROCEDURE gp.ReadAccountHosts @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ProjectLocationId bigint,@Search nvarchar(max)=NULL AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF @ProjectLocationId IS NULL OR @ProjectLocationId<=0 OR (@Search IS NOT NULL AND(DATALENGTH(@Search)>160 OR LEN(LTRIM(RTRIM(@Search)))<2)) THROW 52002,'Invalid host query.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@location int,@result nvarchar(max);
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Shared';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 SELECT @location=LocationId FROM gp.ProjectLocations WHERE ProjectLocationId=@ProjectLocationId AND IsActive=1;
 IF @location IS NULL OR gp._AdminScopeAllowed(@actor,'ROLE_GRANTS_MANAGE',@location,@ProjectLocationId,@now)=0 THROW 52001,'Account host management required.',1;
 EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 SET @result=(SELECT JSON_QUERY(COALESCE((SELECT h.EmployeeId employeeId,e.FullName displayName,e.OfficialEmail email,h.Revision revision,
 CONVERT(bit,gp._AccountHostEligible(h.EmployeeId,h.ProjectLocationId,@cutoff,@now)) eligible,
 REPLACE(CONVERT(char(23),h.ChangedAtUtc,121),' ','T')+'Z' changedAtUtc,u.DisplayName changedBy
 FROM gp.AccountHosts h JOIN gp.Employees e ON e.EmployeeId=h.EmployeeId JOIN gp.Users u ON u.UserId=h.ChangedByUserId
 WHERE h.ProjectLocationId=@ProjectLocationId AND h.IsActive=1 ORDER BY e.FullName,h.EmployeeId FOR JSON PATH),N'[]')) hosts,
 JSON_QUERY(COALESCE((SELECT TOP(20) e.EmployeeId employeeId,e.FullName displayName,e.OfficialEmail email,
 COALESCE(h.Revision,0) revision
 FROM gp.Employees e LEFT JOIN gp.AccountHosts h ON h.ProjectLocationId=@ProjectLocationId AND h.EmployeeId=e.EmployeeId
 WHERE @Search IS NOT NULL AND (h.IsActive IS NULL OR h.IsActive=0)
 AND gp._EmployeeProjectLocationEligible(e.EmployeeId,@ProjectLocationId,@cutoff,@now)=1
 AND(CHARINDEX(@Search,e.FullName)>0 OR CHARINDEX(@Search,e.OfficialEmail)>0)
 ORDER BY e.FullName,e.EmployeeId FOR JSON PATH),N'[]')) candidates FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
CREATE PROCEDURE gp.ManageAccountHost @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@ClientKey uniqueidentifier,
 @ProjectLocationId bigint,@EmployeeId nvarchar(max),@Action varchar(20),@ExpectedRevision int,@Reason nvarchar(max) AS BEGIN
 SET NOCOUNT ON;SET XACT_ABORT ON;
 IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
 IF @ProjectLocationId IS NULL OR @ProjectLocationId<=0 OR @EmployeeId IS NULL OR DATALENGTH(@EmployeeId) NOT BETWEEN 2 AND 128
 OR @ExpectedRevision IS NULL OR @ExpectedRevision<0 OR @Action IS NULL OR @Action COLLATE Latin1_General_100_BIN2 NOT IN('ADD','REMOVE')
 OR @Reason IS NULL OR DATALENGTH(@Reason) NOT BETWEEN 2 AND 600 OR LEN(LTRIM(RTRIM(@Reason)))=0 THROW 52002,'Invalid host change.',1;
 DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@location int,@op uniqueidentifier,@cached nvarchar(max),@result nvarchar(max),@revision int,@active bit;
 BEGIN TRY
 BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
 SELECT @location=LocationId FROM gp.ProjectLocations WHERE ProjectLocationId=@ProjectLocationId AND IsActive=1;
 IF @location IS NULL OR gp._AdminScopeAllowed(@actor,'ROLE_GRANTS_MANAGE',@location,@ProjectLocationId,@now)=0 THROW 52001,'Account host management required.',1;
 DECLARE @payload nvarchar(max)=(SELECT @ProjectLocationId pair,@EmployeeId employeeId,@Action action,@ExpectedRevision revision,@Reason reason FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 EXEC gp._BeginOperation @actor,'ACCOUNT_HOST',@ClientKey,@payload,@op OUTPUT,@cached OUTPUT;
 IF @cached IS NOT NULL BEGIN COMMIT;SELECT @cached;RETURN;END;
 SELECT @revision=Revision,@active=IsActive FROM gp.AccountHosts WHERE ProjectLocationId=@ProjectLocationId AND EmployeeId=@EmployeeId;
 IF COALESCE(@revision,0)<>@ExpectedRevision OR(@Action='REMOVE' AND COALESCE(@active,0)=0) OR(@Action='ADD' AND @active=1) THROW 52003,'Host list changed. Refresh.',1;
 EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
 IF @Action='ADD' AND gp._EmployeeProjectLocationEligible(@EmployeeId,@ProjectLocationId,@cutoff,@now)=0 THROW 52001,'Current account-office membership required.',1;
 IF @Action='ADD' AND(SELECT COUNT(*) FROM gp.AccountHosts WHERE ProjectLocationId=@ProjectLocationId AND IsActive=1)>=500 THROW 52003,'Account host limit reached.',1;
 SET @revision=COALESCE(@revision,0)+1;
 IF @ExpectedRevision=0 INSERT gp.AccountHosts(ProjectLocationId,EmployeeId,IsActive,Revision,ChangedByUserId,ChangedAtUtc,Reason) VALUES(@ProjectLocationId,@EmployeeId,1,@revision,@actor,@now,@Reason);
 ELSE UPDATE gp.AccountHosts SET IsActive=CASE WHEN @Action='ADD' THEN 1 ELSE 0 END,Revision=@revision,ChangedByUserId=@actor,ChangedAtUtc=@now,Reason=@Reason WHERE ProjectLocationId=@ProjectLocationId AND EmployeeId=@EmployeeId;
 INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode,MetadataJson)
 VALUES(@actor,CASE WHEN @Action='ADD' THEN 'ACCOUNT_HOST_ADDED' ELSE 'ACCOUNT_HOST_REMOVED' END,'EMPLOYEE',@EmployeeId,@location,@ProjectLocationId,'SUCCESS',JSON_MODIFY(@payload,'$.result',JSON_QUERY((SELECT @revision revision FOR JSON PATH,WITHOUT_ARRAY_WRAPPER))));
 SET @result=(SELECT @op operationId,@EmployeeId employeeId,@Action action,@revision revision FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
 EXEC gp._CompleteOperation @op,@result;COMMIT;SELECT @result;
 END TRY BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK;THROW;END CATCH;
END;
GO
/* Tighten only host checks. Employee entry entitlement is deliberately unchanged. */
DECLARE @name sysname,@definition nvarchar(max),@updated nvarchar(max);
DECLARE host_modules CURSOR LOCAL FAST_FORWARD FOR
 SELECT o.name FROM sys.objects o JOIN sys.sql_modules m ON m.object_id=o.object_id
 WHERE o.schema_id=SCHEMA_ID('gp') AND o.name NOT IN('_AccountHostEligible','ReadAccountHosts','ManageAccountHost')
 AND(m.definition LIKE '%_EmployeeProjectLocationEligible(@host,%' OR m.definition LIKE '%_EmployeeProjectLocationEligible(@HostEmployeeId,%' OR o.name IN('GetRegistrationOptions','_VisitReadAllowed'));
OPEN host_modules;FETCH NEXT FROM host_modules INTO @name;
WHILE @@FETCH_STATUS=0 BEGIN
 SET @definition=OBJECT_DEFINITION(OBJECT_ID('gp.'+@name));SET @updated=@definition;
 SET @updated=REPLACE(@updated,'gp._EmployeeProjectLocationEligible(@host,','gp._AccountHostEligible(@host,');
 SET @updated=REPLACE(@updated,'gp._EmployeeProjectLocationEligible(@HostEmployeeId,','gp._AccountHostEligible(@HostEmployeeId,');
 IF @name='_VisitReadAllowed' SET @updated=REPLACE(@updated,'gp._EmployeeProjectLocationEligible(e.EmployeeId,v.ProjectLocationId,','gp._AccountHostEligible(e.EmployeeId,v.ProjectLocationId,');
 IF @name='GetRegistrationOptions' BEGIN
 SET @updated=REPLACE(@updated,'(@type=''PUBLIC'' AND gp._EmployeeOfficeEligible(e.EmployeeId,@location,@cutoff,@now)=1)',
 '(@type=''PUBLIC'' AND EXISTS(SELECT 1 FROM gp.AccountHosts ah JOIN gp.ProjectLocations hp ON hp.ProjectLocationId=ah.ProjectLocationId WHERE hp.LocationId=@location AND gp._AccountHostEligible(e.EmployeeId,ah.ProjectLocationId,@cutoff,@now)=1 AND ah.EmployeeId=e.EmployeeId))');
 SET @updated=REPLACE(@updated,'gp._EmployeeProjectLocationEligible(e.EmployeeId,@ProjectLocationId,','gp._AccountHostEligible(e.EmployeeId,@ProjectLocationId,');
 END;
 IF @updated=@definition THROW 52000,'Expected host definition not found.',1;
 SET @updated=STUFF(@updated,1,CHARINDEX(' ',@updated)-1,'ALTER');EXEC sys.sp_executesql @updated;
 FETCH NEXT FROM host_modules INTO @name;
END;
CLOSE host_modules;DEALLOCATE host_modules;
GO
GRANT EXECUTE ON gp.ReadAccountHosts TO gp_api_runtime;
GRANT EXECUTE ON gp.ManageAccountHost TO gp_api_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('119',N'Explicit account-office host lists, scoped audited management and live host authorization');
COMMIT;
