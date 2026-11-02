/* Additive foundation. Legacy Projects/ProjectLocations remain Account/Account-office.
   No automatic subdivision access, host seeding, runtime DML or entry cutover. */
SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
IF @@TRANCOUNT<>0 THROW 52000,'Ambient transaction not accepted.',1;
IF NOT EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='121') THROW 52000,'Migration 121 required.',1;
IF EXISTS(SELECT 1 FROM gp.SchemaMigrations WHERE Version='122') THROW 52000,'Migration 122 already applied.',1;
BEGIN TRANSACTION; EXEC gp._TakeLock N'gp:authorization','Exclusive';

CREATE TABLE gp.SubProjects(
 SubProjectId uniqueidentifier NOT NULL DEFAULT(NEWSEQUENTIALID()),
 AccountOfficeId bigint NOT NULL, LocationId int NOT NULL, Name nvarchar(200) NOT NULL,
 IsActive bit NOT NULL DEFAULT(1), Revision int NOT NULL DEFAULT(1),
 ChangedByUserId uniqueidentifier NOT NULL REFERENCES gp.Users(UserId), ChangedAtUtc datetime2(3) NOT NULL DEFAULT(SYSUTCDATETIME()),
 CONSTRAINT PK_SubProjects PRIMARY KEY(SubProjectId),
 CONSTRAINT UQ_SubProjects_Scope UNIQUE(SubProjectId,AccountOfficeId,LocationId),
 CONSTRAINT UQ_SubProjects_Office UNIQUE(SubProjectId,LocationId),
 CONSTRAINT UQ_SubProjects_Name UNIQUE(AccountOfficeId,Name),
 CONSTRAINT FK_SubProjects_AccountOffice FOREIGN KEY(AccountOfficeId,LocationId) REFERENCES gp.ProjectLocations(ProjectLocationId,LocationId),
 CONSTRAINT CK_SubProjects_Value CHECK(Revision>0 AND LEN(LTRIM(RTRIM(Name)))>0));

CREATE TABLE gp.SubProjectHosts(
 SubProjectId uniqueidentifier NOT NULL REFERENCES gp.SubProjects(SubProjectId),
 EmployeeId nvarchar(64) NOT NULL REFERENCES gp.Employees(EmployeeId), IsActive bit NOT NULL,
 Revision int NOT NULL, ChangedByUserId uniqueidentifier NOT NULL REFERENCES gp.Users(UserId),
 ChangedAtUtc datetime2(3) NOT NULL, Reason nvarchar(500) NOT NULL,
 CONSTRAINT PK_SubProjectHosts PRIMARY KEY(SubProjectId,EmployeeId),
 CONSTRAINT CK_SubProjectHosts_Value CHECK(Revision>0 AND LEN(LTRIM(RTRIM(Reason)))>0));

CREATE TABLE gp.LocationPlanningHosts(
 LocationId int NOT NULL REFERENCES gp.Locations(LocationId),
 EmployeeId nvarchar(64) NOT NULL REFERENCES gp.Employees(EmployeeId), IsActive bit NOT NULL,
 Revision int NOT NULL, ChangedByUserId uniqueidentifier NOT NULL REFERENCES gp.Users(UserId),
 ChangedAtUtc datetime2(3) NOT NULL, Reason nvarchar(500) NOT NULL,
 CONSTRAINT PK_LocationPlanningHosts PRIMARY KEY(LocationId,EmployeeId),
 CONSTRAINT CK_LocationPlanningHosts_Value CHECK(Revision>0 AND LEN(LTRIM(RTRIM(Reason)))>0));

/* Immutable plan snapshots retain the evaluated policy revision. Future scoped
   execute-only procedures must validate this JSON and increment revisions. */
CREATE TABLE gp.VisitPlanningPolicies(
 PolicyId uniqueidentifier NOT NULL, LocationId int NOT NULL REFERENCES gp.Locations(LocationId),
 ScopeKind varchar(12) COLLATE Latin1_General_100_BIN2 NOT NULL,
 AccountOfficeId bigint NULL, SubProjectId uniqueidentifier NULL,
 Revision int NOT NULL, IsActive bit NOT NULL, DefinitionJson nvarchar(max) NOT NULL,
 ChangedByUserId uniqueidentifier NOT NULL REFERENCES gp.Users(UserId), ChangedAtUtc datetime2(3) NOT NULL,
 Reason nvarchar(500) NOT NULL,
 CONSTRAINT PK_VisitPlanningPolicies PRIMARY KEY(PolicyId),
 CONSTRAINT FK_VisitPlanningPolicies_Account FOREIGN KEY(AccountOfficeId,LocationId) REFERENCES gp.ProjectLocations(ProjectLocationId,LocationId),
 CONSTRAINT FK_VisitPlanningPolicies_Project FOREIGN KEY(SubProjectId,AccountOfficeId,LocationId) REFERENCES gp.SubProjects(SubProjectId,AccountOfficeId,LocationId),
 CONSTRAINT CK_VisitPlanningPolicies_Value CHECK(Revision>0 AND ISJSON(DefinitionJson)=1 AND LEN(LTRIM(RTRIM(Reason)))>0),
 CONSTRAINT CK_VisitPlanningPolicies_Scope CHECK(
  (ScopeKind='LOCATION' AND AccountOfficeId IS NULL AND SubProjectId IS NULL) OR
  (ScopeKind='SUBPROJECT' AND AccountOfficeId IS NOT NULL AND SubProjectId IS NOT NULL)));
CREATE UNIQUE INDEX UX_VisitPlanningPolicies_Location ON gp.VisitPlanningPolicies(LocationId) WHERE ScopeKind='LOCATION';
CREATE UNIQUE INDEX UX_VisitPlanningPolicies_Project ON gp.VisitPlanningPolicies(SubProjectId) WHERE ScopeKind='SUBPROJECT';

INSERT gp.SchemaMigrations(Version,Description) VALUES('122',N'Explicit sub-projects, scoped planning hosts and versioned office/project policy foundation');
COMMIT;
