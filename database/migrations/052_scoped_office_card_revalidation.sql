/* Preserve scope-first error behavior when validating employee office entitlement. */
SET NOCOUNT ON;SET XACT_ABORT ON;SET ANSI_NULLS ON;SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 53800,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='051') THROW 53800,'Migration 051 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='052') THROW 53800,'Migration 052 already applied.',1;
BEGIN TRANSACTION;EXEC gp._TakeLock N'gp:authorization','Exclusive';
GO
ALTER PROCEDURE gp._RequireReceptionPass
    @Actor uniqueidentifier,@Visit uniqueidentifier,@Now datetime2(3),@Reissue bit=0
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS(SELECT 1 FROM gp.VisitRequests v JOIN gp.StaffRoleGrants g ON g.LocationId=v.LocationId
        JOIN gp.GrantCapabilities c ON c.RoleGrantId=g.RoleGrantId AND c.CapabilityCode='PASS_PRINT'
        WHERE v.VisitRequestId=@Visit AND g.UserId=@Actor AND g.RoleCode='RECEPTION' AND g.ScopeType='LOCATION'
        AND g.RevokedAtUtc IS NULL AND g.ValidFromUtc<=@Now AND (g.ValidUntilUtc IS NULL OR @Now<g.ValidUntilUtc)
        AND (@Reissue=0 OR EXISTS(SELECT 1 FROM gp.GrantCapabilities x WHERE x.RoleGrantId=g.RoleGrantId AND x.CapabilityCode='PASS_REISSUE')))
        THROW 53101,'Not authorized.',1;
    -- Resolve role/scope first: an unrelated actor must not observe employee office state.
    DECLARE @officeCutoff datetime2(3);EXEC gp._DirectoryCutoff @Now,@officeCutoff OUTPUT;
    IF EXISTS(SELECT 1 FROM gp.VisitRequests WHERE VisitRequestId=@Visit AND RequestType='TEMP_ID' AND gp._EmployeeOfficeEligible(EmployeeId,LocationId,@officeCutoff,@Now)=0) THROW 53105,'Current employee office entitlement required.',1;
END;
GO
INSERT gp.SchemaMigrations(Version,Description) VALUES('052',N'Authorize reception scope before employee office revalidation');COMMIT;
