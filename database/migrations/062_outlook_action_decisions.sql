/* Entra-verified Outlook actions: isolated execute-only identity, no browser sessions. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 54200,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='061') THROW 54200,'Migration 061 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='062') THROW 54200,'Migration 062 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
CREATE TABLE gp.EmployeeEntraIdentities(
 TenantId uniqueidentifier NOT NULL,ObjectId uniqueidentifier NOT NULL,
 EmployeeId nvarchar(64) NOT NULL,IsActive bit NOT NULL,VerifiedAtUtc datetime2(3) NOT NULL,
 CONSTRAINT PK_EmployeeEntraIdentities PRIMARY KEY(TenantId,ObjectId),
 CONSTRAINT UQ_EmployeeEntraIdentities UNIQUE(TenantId,EmployeeId),
 CONSTRAINT FK_EmployeeEntraIdentities FOREIGN KEY(EmployeeId) REFERENCES gp.Employees(EmployeeId)
);
CREATE ROLE gp_outlook_runtime AUTHORIZATION dbo;
GO
CREATE PROCEDURE gp._RequireOutlookActor
 @TenantId uniqueidentifier,@ObjectId uniqueidentifier,@ExpectedHostEmployeeId nvarchar(64),
 @Actor uniqueidentifier OUTPUT,@Now datetime2(3) OUTPUT
AS
BEGIN
 SET NOCOUNT ON;SET @Actor=NULL;SET @Now=SYSUTCDATETIME();
 DECLARE @cutoff datetime2(3);EXEC gp._DirectoryCutoff @Now,@cutoff OUTPUT;
 IF @TenantId IS NULL OR @ObjectId IS NULL OR @ExpectedHostEmployeeId IS NULL THROW 52001,'Not authorized.',1;
 SELECT @Actor=u.UserId FROM gp.EmployeeEntraIdentities i JOIN gp.Employees e ON e.EmployeeId=i.EmployeeId
 JOIN gp.Users u ON u.UserId=e.UserId
 WHERE i.TenantId=@TenantId AND i.ObjectId=@ObjectId AND i.EmployeeId=@ExpectedHostEmployeeId
 AND i.IsActive=1 AND e.IsActive=1 AND u.IsActive=1 AND i.VerifiedAtUtc BETWEEN @cutoff AND @Now;
 IF @Actor IS NULL THROW 52001,'Not authorized.',1;
END;
GO
CREATE PROCEDURE gp.DecideOutlookVisit
    @TenantId uniqueidentifier,@ObjectId uniqueidentifier,@ExpectedHostEmployeeId nvarchar(64),@ClientKey uniqueidentifier,
    @VisitRequestId uniqueidentifier,@SnapshotVersion int,@SnapshotHash varbinary(8000),
    @Decision varchar(20),@Comment nvarchar(1000)=NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 52000, 'Ambient transactions are not accepted.', 1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@op uniqueidentifier,@cached nvarchar(max),@result nvarchar(max);
    BEGIN TRY
        IF @VisitRequestId IS NULL OR @Decision IS NULL OR @Decision COLLATE Latin1_General_100_BIN2 NOT IN ('APPROVED','DENIED')
           OR @SnapshotHash IS NULL OR DATALENGTH(@SnapshotHash)<>32 OR @SnapshotVersion IS NULL OR @SnapshotVersion<>1
           OR DATALENGTH(@Comment)>1000
            THROW 52002, 'Invalid decision input.', 1;
        BEGIN TRANSACTION;
        EXEC gp._TakeLock N'gp:authorization','Shared';
        EXEC gp._RequireOutlookActor @TenantId,@ObjectId,@ExpectedHostEmployeeId,@actor OUTPUT,@now OUTPUT;
        DECLARE @payload nvarchar(max)=(SELECT @VisitRequestId AS visitId,@SnapshotVersion AS snapshotVersion,
            CONVERT(varchar(64),@SnapshotHash,2) AS snapshotHash,@Decision AS decision,@Comment AS comment
            FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER);
        EXEC gp._BeginOperation @actor,'DECIDE_VISIT',@ClientKey,@payload,@op OUTPUT,@cached OUTPUT;
        DECLARE @lock nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@VisitRequestId));
        EXEC gp._TakeLock @lock;
        EXEC gp._RequireOutlookActor @TenantId,@ObjectId,@ExpectedHostEmployeeId,@actor OUTPUT,@now OUTPUT;
        DECLARE @location int,@pair bigint,@host nvarchar(64),@employee nvarchar(64),@email nvarchar(320),
            @state varchar(12),@version int,@hash varbinary(32),@deadline datetime2(3),@project bigint,@cutoff datetime2(3);
        SELECT @location=LocationId,@pair=ProjectLocationId,@host=HostEmployeeId,@employee=EmployeeId,
            @email=PersonEmail,@state=Status,@version=SnapshotVersion,@hash=SnapshotHash,@deadline=ApprovalDeadlineUtc
        FROM gp.VisitRequests WITH(UPDLOCK) WHERE VisitRequestId=@VisitRequestId;
        EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
        SELECT @project=pl.ProjectId FROM gp.ProjectLocations pl JOIN gp.Projects p ON p.ProjectId=pl.ProjectId
            JOIN gp.Locations l ON l.LocationId=pl.LocationId
            WHERE pl.ProjectLocationId=@pair AND pl.IsActive=1 AND p.IsActive=1 AND l.IsActive=1;
        IF @project IS NULL OR @host<>@ExpectedHostEmployeeId OR NOT EXISTS(SELECT 1 FROM gp.Employees WHERE EmployeeId=@host AND UserId=@actor AND IsActive=1)
            THROW 52001, 'Not authorized.', 1;
        IF NOT EXISTS(SELECT 1 FROM gp.Employees WHERE EmployeeId=@host AND LastSyncedAtUtc BETWEEN @cutoff AND @now)
           OR gp._EmployeeProjectLocationEligible(@host,@pair,@cutoff,@now)=0
            THROW 52004, 'Current host membership must be verified.', 1;
        IF @version<>@SnapshotVersion OR @hash<>@SnapshotHash THROW 52003, 'Submitted snapshot differs.', 1;
        -- Reauthorize before returning a stored result; replay never reopens a decision.
        IF @cached IS NOT NULL
        BEGIN
            COMMIT;
            SELECT @cached AS ResultJson;
            RETURN;
        END;
        IF @state<>'PENDING' OR @deadline IS NULL OR @now>=@deadline
            THROW 52005, 'Visit cannot accept a decision.', 1;
        DECLARE @pass uniqueidentifier;
        SELECT @pass=AccessPassId FROM gp.AccessPasses WITH(UPDLOCK)
            WHERE VisitRequestId=@VisitRequestId AND IsCurrent=1 AND Status='PENDING';
        IF @pass IS NULL THROW 52005, 'Pending credential unavailable.', 1;
        INSERT gp.ApprovalDecisions(VisitRequestId,ApproverEmployeeId,SnapshotVersion,SnapshotHash,Decision,DecisionSource,OperationId,Comment,DecidedAtUtc)
        VALUES(@VisitRequestId,@host,@version,@hash,@Decision,'OUTLOOK',@op,@Comment,@now);
        UPDATE gp.VisitRequests SET Status=@Decision,DecisionAtUtc=@now WHERE VisitRequestId=@VisitRequestId;
        UPDATE gp.AccessPasses SET Status=CASE WHEN @Decision='APPROVED' THEN 'ACTIVE' ELSE 'DENIED' END WHERE AccessPassId=@pass;
        SET @result=(SELECT @op AS operationId,@VisitRequestId AS visitRequestId,@Decision AS decision FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        IF @employee IS NOT NULL OR @email IS NOT NULL
            INSERT gp.NotificationOutbox(VisitRequestId,RecipientKind,RecipientEmployeeId,RecipientEmail,TemplateCode,PayloadJson,DedupeHash)
            VALUES(@VisitRequestId,CASE WHEN @employee IS NULL THEN 'EMAIL' ELSE 'EMPLOYEE' END,@employee,@email,
                'VISIT_DECIDED',@result,HASHBYTES('SHA2_256',CONVERT(char(36),@op)+':VISIT_DECIDED'));
        INSERT gp.SecurityAuditEvents(ActorUserId,ActionCode,TargetType,TargetReference,LocationId,ProjectLocationId,ResultCode,MetadataJson)
        VALUES(@actor,'VISIT_DECIDED','VISIT',CONVERT(varchar(36),@VisitRequestId),@location,@pair,'SUCCESS',JSON_MODIFY(@result,'$.source','OUTLOOK'));
        EXEC gp._CompleteOperation @op,@result;
        COMMIT;
        SELECT @result AS ResultJson;
    END TRY
    BEGIN CATCH
        DECLARE @error int=ERROR_NUMBER(),@target varchar(100)=CONVERT(varchar(36),@VisitRequestId);
        IF @@TRANCOUNT>0 ROLLBACK;
        EXEC gp._AuditFailure @actor,'VISIT_DECISION_FAILED',@target,@error;
        THROW;
    END CATCH;
END;
GO
GRANT EXECUTE ON OBJECT::gp.DecideOutlookVisit TO gp_outlook_runtime;
INSERT gp.SchemaMigrations(Version,Description) VALUES('062','Entra-bound direct Outlook visit decisions');
COMMIT TRANSACTION;
