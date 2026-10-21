/* A guard may cover several projects in one shared area concurrently.
   Scan all currently authorized assignments unless an explicit optional filter
   is supplied. Each movement still names its exact target project. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53200,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='012') THROW 53200,'Migration 012 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='013') THROW 53200,'Migration 013 already applied.',1;
BEGIN TRANSACTION;
EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
ALTER PROCEDURE gp.VerifyGuardPass
    @SessionHash varbinary(8000),@CsrfHash varbinary(8000),@LocationId int,@CredentialHash varbinary(8000),@CorrelationId uniqueidentifier,@SelectedProjectLocationId bigint=NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF @@TRANCOUNT<>0 THROW 52800,'Ambient transaction not accepted.',1;
    IF (@SelectedProjectLocationId IS NOT NULL AND @SelectedProjectLocationId<=0) OR @LocationId IS NULL OR @LocationId<=0 OR @CredentialHash IS NULL OR DATALENGTH(@CredentialHash)<>32 OR @CorrelationId IS NULL THROW 52802,'Invalid scan input.',1;
    DECLARE @actor uniqueidentifier,@now datetime2(3),@cutoff datetime2(3),@visit uniqueidentifier,@pass uniqueidentifier,@location int,@passState varchar(12),@current bit,
        @state varchar(12),@from datetime2(3),@until datetime2(3),@outcome varchar(32),@detail nvarchar(max),@result nvarchar(max);
    BEGIN TRY
        BEGIN TRANSACTION; EXEC gp._TakeLock N'gp:authorization','Shared'; EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT;
        IF NOT EXISTS(SELECT 1 FROM gp.StaffRoleGrants g JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='VISITS_READ'
            WHERE g.UserId=@actor AND g.RoleCode='GUARD' AND g.ScopeType='LOCATION' AND g.LocationId=@LocationId AND g.RevokedAtUtc IS NULL
            AND g.ValidFromUtc<=@now AND (g.ValidUntilUtc IS NULL OR @now<g.ValidUntilUtc)) THROW 52801,'Not authorized.',1;
        SELECT @visit=VisitRequestId,@pass=AccessPassId FROM gp.AccessPasses WHERE CredentialHash=@CredentialHash;
        IF @visit IS NOT NULL
        BEGIN
            DECLARE @lock nvarchar(255)=N'gp:visit:'+LOWER(CONVERT(char(36),@visit)); EXEC gp._TakeLock @lock,'Shared';
            EXEC gp._RequireActor @SessionHash,@CsrfHash,@actor OUTPUT,@now OUTPUT; EXEC gp._DirectoryCutoff @now,@cutoff OUTPUT;
            SELECT @location=LocationId FROM gp.VisitRequests WHERE VisitRequestId=@visit
                AND (@SelectedProjectLocationId IS NULL OR ProjectLocationId=@SelectedProjectLocationId);
            IF @location IS NULL OR @location<>@LocationId OR gp._VisitReadAllowed(@actor,'GUARD',@visit,@now,@cutoff)=0 SET @visit=NULL;
        END;
        IF @visit IS NULL
        BEGIN
            -- Unknown and known-out-of-scope credentials have identical responses
            -- and unlinked logs. Correlation is tracing only, never a replay receipt.
            INSERT gp.PassScanAttempts(ActorUserId,LocationId,OutcomeCode,CorrelationId) VALUES(@actor,@LocationId,'NOT_AUTHORIZED',@CorrelationId);
            SET @result=N'{"outcome":"NOT_AVAILABLE"}';
        END
        ELSE
        BEGIN
            EXEC gp._VisitReadJson @actor,'GUARD',@visit,@now,@detail OUTPUT;
            SELECT @passState=p.Status,@current=p.IsCurrent,@state=v.Status,@from=v.ValidFromUtc,@until=v.ValidUntilUtc
                FROM gp.AccessPasses p JOIN gp.VisitRequests v ON v.VisitRequestId=p.VisitRequestId WHERE p.AccessPassId=@pass;
            SET @outcome=CASE WHEN @current=0 OR @passState='REVOKED' THEN 'REVOKED' WHEN @state='CANCELLED' THEN 'CANCELLED'
                WHEN @state='DENIED' OR @passState='DENIED' THEN 'DENIED' WHEN @state='PENDING' OR @passState='PENDING' THEN 'PENDING'
                WHEN @now>=@until THEN 'EXPIRED' WHEN @now<@from THEN 'NOT_YET_VALID'
                WHEN JSON_VALUE(@detail,'$.canEnter')='true' OR JSON_VALUE(@detail,'$.canExit')='true' THEN 'VALID' ELSE 'NOT_AUTHORIZED' END;
            -- A stale printed QR never suggests a normal action on its replacement.
            IF @current=0 OR @passState='REVOKED' SET @detail=JSON_MODIFY(JSON_MODIFY(@detail,'$.canEnter',CONVERT(bit,0)),'$.canExit',CONVERT(bit,0));
            INSERT gp.PassScanAttempts(AccessPassId,VisitRequestId,ActorUserId,LocationId,OutcomeCode,CorrelationId)
                VALUES(@pass,@visit,@actor,@LocationId,@outcome,@CorrelationId);
            SET @result=(SELECT @outcome outcome,JSON_QUERY(@detail) visit FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        END;
        COMMIT; SELECT @result;
    END TRY
    BEGIN CATCH IF @@TRANCOUNT>0 ROLLBACK; THROW; END CATCH;
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('013',N'Concurrent multi-project guard scanning with explicit per-movement target');
COMMIT;
