-- Reference data only. No identities, project access, role grants or credentials.

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF NOT EXISTS (SELECT 1 FROM gp.SchemaMigrations WHERE Version='001') THROW 51002, 'Apply migration 001 first.', 1;

IF EXISTS (SELECT 1 FROM gp.SchemaMigrations WHERE Version='002') THROW 51003, 'Migration 002 is already applied.', 1;

BEGIN TRY
BEGIN TRANSACTION;

INSERT gp.Locations(LocationCode,LocationName) VALUES ('NOIDA',N'Noida'),('BENGALURU',N'Bengaluru'),('CHENNAI',N'Chennai'),('PUNE',N'Pune');

INSERT gp.Capabilities(CapabilityCode,Description) VALUES
('VISITS_READ',N'Read necessary individual visitor data within the granted scope.'),
('PROJECT_MOVEMENT',N'Guard verifies/records project visits; active exact GuardAssignment is also required.'),
('TEMP_ID_MOVEMENT',N'Designated location guard verifies/records location-only TEMP_ID visits.'),
('RECONCILE_EXIT',N'Authorized location guard records reasoned departure for an existing occupant.'),
('PASS_PRINT',N'Reception renders/dispatches an individual card in its location.'),
('PASS_REISSUE',N'Reception replaces a credential with revocation/audit; no approval override.'),
('GUARDS_MANAGE',N'Assign/deallocate guards only within delegated scope.'),
('REPORTS_READ',N'Read operational reports within scope.'),
('REPORTS_EXPORT',N'Export permitted scoped/masked reports with throttling and audit.'),
('AUDIT_READ',N'Read allowed scoped audit records; no edit/delete.'),
('ROLE_GRANTS_MANAGE',N'India admin capability for controlled role/capability delegation; no self-escalation.');

INSERT gp.SchemaMigrations(Version,Description) VALUES ('002','Reference offices and explicit capability catalogue');

COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
