-- GatePass DB-first v1.2 - NEW EMPTY DATABASE BASELINE. Never run against legacy v1.0/v1.1.

-- Database-first: reviewed SQL DDL defines the schema; no entity-model generator writes this file.
-- Documentation/manifest are derived from SQL until live-catalog verification is available.
-- No secrets, real employees or admin grants seeded.

-- SQL Server 2022+ target. UTF-8 source. UTC storage; half-open validity windows.

SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;

IF DB_NAME() IN (N'master',N'model',N'msdb',N'tempdb') THROW 51000, 'Select an empty dedicated GatePass test database.', 1;

IF EXISTS (SELECT 1 FROM sys.tables WHERE schema_id=SCHEMA_ID(N'gp')) THROW 51001, 'gp tables already exist; this is a new-database baseline, not an upgrade.', 1;

BEGIN TRY
BEGIN TRANSACTION;
IF SCHEMA_ID(N'gp') IS NULL EXEC(N'CREATE SCHEMA gp AUTHORIZATION dbo');

-- Applied migration history; no runtime mutation permissions.
CREATE TABLE gp.SchemaMigrations (
    Version varchar(16) NOT NULL,
    Description nvarchar(200) NOT NULL,
    AppliedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_SchemaMigrations_AppliedAtUtc DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_SchemaMigrations PRIMARY KEY (Version)
);

-- Trusted office locations; no physical floor/checkpoint inventory.
CREATE TABLE gp.Locations (
    LocationId int IDENTITY(1,1) NOT NULL,
    LocationCode varchar(16) NOT NULL,
    LocationName nvarchar(100) NOT NULL,
    IsActive bit NOT NULL CONSTRAINT DF_Locations_IsActive DEFAULT (1),
    CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_Locations_CreatedAtUtc DEFAULT (SYSUTCDATETIME()),
    RowVer rowversion NOT NULL,
    CONSTRAINT PK_Locations PRIMARY KEY (LocationId),
    CONSTRAINT UQ_Locations_01 UNIQUE (LocationCode)
);

-- Trusted project directory cache, not an approval grant.
CREATE TABLE gp.Projects (
    ProjectId bigint IDENTITY(1,1) NOT NULL,
    ExternalProjectCode nvarchar(80) NOT NULL,
    ProjectName nvarchar(200) NOT NULL,
    IsActive bit NOT NULL CONSTRAINT DF_Projects_IsActive DEFAULT (1),
    LastSyncedAtUtc datetime2(3) NULL,
    RowVer rowversion NOT NULL,
    CONSTRAINT PK_Projects PRIMARY KEY (ProjectId),
    CONSTRAINT UQ_Projects_01 UNIQUE (ExternalProjectCode)
);

-- Project availability in a specific office; guard scope anchor.
CREATE TABLE gp.ProjectLocations (
    ProjectLocationId bigint IDENTITY(1,1) NOT NULL,
    ProjectId bigint NOT NULL,
    LocationId int NOT NULL,
    IsActive bit NOT NULL CONSTRAINT DF_ProjectLocations_IsActive DEFAULT (1),
    RowVer rowversion NOT NULL,
    CONSTRAINT PK_ProjectLocations PRIMARY KEY (ProjectLocationId),
    CONSTRAINT UQ_ProjectLocations_01 UNIQUE (ProjectId, LocationId),
    CONSTRAINT UQ_ProjectLocations_02 UNIQUE (ProjectLocationId, LocationId)
);

-- Immutable issuer/subject mapping for authenticated staff and employees.
CREATE TABLE gp.Users (
    UserId uniqueidentifier NOT NULL CONSTRAINT DF_Users_UserId DEFAULT (NEWSEQUENTIALID()),
    IdentityIssuer nvarchar(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    IdentitySubject nvarchar(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    DisplayName nvarchar(200) NOT NULL,
    IsActive bit NOT NULL CONSTRAINT DF_Users_IsActive DEFAULT (1),
    AuthorizationVersion bigint NOT NULL CONSTRAINT DF_Users_AuthorizationVersion DEFAULT (1),
    CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_Users_CreatedAtUtc DEFAULT (SYSUTCDATETIME()),
    LastLoginAtUtc datetime2(3) NULL,
    RowVer rowversion NOT NULL,
    CONSTRAINT PK_Users PRIMARY KEY (UserId),
    CONSTRAINT UQ_Users_01 UNIQUE (IdentityIssuer, IdentitySubject),
    CONSTRAINT CK_Users_01 CHECK (AuthorizationVersion > 0)
);

-- Trusted employee cache; corporate email and manager come only from directory.
CREATE TABLE gp.Employees (
    EmployeeId nvarchar(64) NOT NULL,
    UserId uniqueidentifier NULL,
    FullName nvarchar(200) NOT NULL,
    OfficialEmail nvarchar(320) NOT NULL,
    ManagerEmployeeId nvarchar(64) NULL,
    IsActive bit NOT NULL,
    LastSyncedAtUtc datetime2(3) NOT NULL,
    RowVer rowversion NOT NULL,
    CONSTRAINT PK_Employees PRIMARY KEY (EmployeeId)
);

CREATE UNIQUE INDEX UX_Employees_User ON gp.Employees(UserId) WHERE UserId IS NOT NULL;

-- Authoritative host eligibility cache at project level.
CREATE TABLE gp.EmployeeProjectMemberships (
    EmployeeId nvarchar(64) NOT NULL,
    ProjectId bigint NOT NULL,
    IsActive bit NOT NULL,
    VerifiedAtUtc datetime2(3) NOT NULL,
    SourceUpdatedAtUtc datetime2(3) NULL,
    RowVer rowversion NOT NULL,
    CONSTRAINT PK_EmployeeProjectMemberships PRIMARY KEY (EmployeeId, ProjectId)
);

CREATE INDEX IX_Membership_Project ON gp.EmployeeProjectMemberships(ProjectId, IsActive, EmployeeId);

-- Application-controlled capability catalogue; no implicit admin superuser.
CREATE TABLE gp.Capabilities (
    CapabilityCode varchar(40) NOT NULL,
    Description nvarchar(250) NOT NULL,
    CONSTRAINT PK_Capabilities PRIMARY KEY (CapabilityCode)
);

-- Time-bounded role at one India/location/project/project-location scope.
CREATE TABLE gp.StaffRoleGrants (
    RoleGrantId bigint IDENTITY(1,1) NOT NULL,
    UserId uniqueidentifier NOT NULL,
    RoleCode varchar(24) NOT NULL,
    ScopeType varchar(24) NOT NULL,
    LocationId int NULL,
    ProjectId bigint NULL,
    ProjectLocationId bigint NULL,
    GrantedByUserId uniqueidentifier NOT NULL,
    ValidFromUtc datetime2(3) NOT NULL CONSTRAINT DF_StaffRoleGrants_ValidFromUtc DEFAULT (SYSUTCDATETIME()),
    ValidUntilUtc datetime2(3) NULL,
    RevokedAtUtc datetime2(3) NULL,
    RevokedByUserId uniqueidentifier NULL,
    CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_StaffRoleGrants_CreatedAtUtc DEFAULT (SYSUTCDATETIME()),
    RowVer rowversion NOT NULL,
    CONSTRAINT PK_StaffRoleGrants PRIMARY KEY (RoleGrantId),
    CONSTRAINT CK_StaffRoleGrants_01 CHECK ((RoleCode='INDIA_ADMIN' AND ScopeType='INDIA') OR (RoleCode='LOCATION_ADMIN' AND ScopeType='LOCATION') OR (RoleCode='PROJECT_ADMIN' AND ScopeType IN ('PROJECT','PROJECT_LOCATION')) OR (RoleCode IN ('GUARD','RECEPTION') AND ScopeType='LOCATION')),
    CONSTRAINT CK_StaffRoleGrants_02 CHECK ((ScopeType='INDIA' AND LocationId IS NULL AND ProjectId IS NULL AND ProjectLocationId IS NULL) OR (ScopeType='LOCATION' AND LocationId IS NOT NULL AND ProjectId IS NULL AND ProjectLocationId IS NULL) OR (ScopeType='PROJECT' AND LocationId IS NULL AND ProjectId IS NOT NULL AND ProjectLocationId IS NULL) OR (ScopeType='PROJECT_LOCATION' AND LocationId IS NULL AND ProjectId IS NULL AND ProjectLocationId IS NOT NULL)),
    CONSTRAINT CK_StaffRoleGrants_03 CHECK (ValidUntilUtc IS NULL OR ValidUntilUtc > ValidFromUtc),
    CONSTRAINT CK_StaffRoleGrants_04 CHECK ((RevokedAtUtc IS NULL AND RevokedByUserId IS NULL) OR (RevokedAtUtc IS NOT NULL AND RevokedByUserId IS NOT NULL AND RevokedAtUtc >= CreatedAtUtc))
);

CREATE INDEX IX_Grants_User ON gp.StaffRoleGrants(UserId, RoleCode, RevokedAtUtc, ValidUntilUtc);

-- Explicit permission on a scoped role grant; role label alone grants nothing.
CREATE TABLE gp.GrantCapabilities (
    RoleGrantId bigint NOT NULL,
    CapabilityCode varchar(40) NOT NULL,
    CONSTRAINT PK_GrantCapabilities PRIMARY KEY (RoleGrantId, CapabilityCode)
);

-- Many-to-many guard to project-office allocations with retained history.
CREATE TABLE gp.GuardAssignments (
    GuardAssignmentId bigint IDENTITY(1,1) NOT NULL,
    GuardUserId uniqueidentifier NOT NULL,
    ProjectLocationId bigint NOT NULL,
    AssignedByUserId uniqueidentifier NOT NULL,
    ValidFromUtc datetime2(3) NOT NULL CONSTRAINT DF_GuardAssignments_ValidFromUtc DEFAULT (SYSUTCDATETIME()),
    ValidUntilUtc datetime2(3) NULL,
    DeallocatedAtUtc datetime2(3) NULL,
    DeallocatedByUserId uniqueidentifier NULL,
    Reason nvarchar(300) NULL,
    CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_GuardAssignments_CreatedAtUtc DEFAULT (SYSUTCDATETIME()),
    RowVer rowversion NOT NULL,
    CONSTRAINT PK_GuardAssignments PRIMARY KEY (GuardAssignmentId),
    CONSTRAINT CK_GuardAssignments_01 CHECK (ValidUntilUtc IS NULL OR ValidUntilUtc > ValidFromUtc),
    CONSTRAINT CK_GuardAssignments_02 CHECK ((DeallocatedAtUtc IS NULL AND DeallocatedByUserId IS NULL) OR (DeallocatedAtUtc IS NOT NULL AND DeallocatedByUserId IS NOT NULL AND DeallocatedAtUtc >= CreatedAtUtc))
);

CREATE INDEX IX_Assignment_Actor ON gp.GuardAssignments(GuardUserId, ProjectLocationId, ValidFromUtc, ValidUntilUtc) INCLUDE (DeallocatedAtUtc);

-- Short-lived registration ownership and submission correlation, not an operational group.
CREATE TABLE gp.RegistrationIntakes (
    IntakeId uniqueidentifier NOT NULL CONSTRAINT DF_RegistrationIntakes_IntakeId DEFAULT (NEWSEQUENTIALID()),
    TokenHash varbinary(32) NOT NULL,
    IntakeType varchar(12) NOT NULL,
    OwnerUserId uniqueidentifier NULL,
    Status varchar(12) NOT NULL CONSTRAINT DF_RegistrationIntakes_Status DEFAULT ('DRAFT'),
    ExpiresAtUtc datetime2(3) NOT NULL,
    SubmittedAtUtc datetime2(3) NULL,
    CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_RegistrationIntakes_CreatedAtUtc DEFAULT (SYSUTCDATETIME()),
    RowVer rowversion NOT NULL,
    CONSTRAINT PK_RegistrationIntakes PRIMARY KEY (IntakeId),
    CONSTRAINT UQ_RegistrationIntakes_01 UNIQUE (TokenHash),
    CONSTRAINT CK_RegistrationIntakes_01 CHECK ((IntakeType='EMPLOYEE' AND OwnerUserId IS NOT NULL) OR (IntakeType='PUBLIC' AND OwnerUserId IS NULL)),
    CONSTRAINT CK_RegistrationIntakes_02 CHECK ((Status='SUBMITTED' AND SubmittedAtUtc IS NOT NULL) OR (Status IN ('DRAFT','ABANDONED') AND SubmittedAtUtc IS NULL)),
    CONSTRAINT CK_RegistrationIntakes_03 CHECK (ExpiresAtUtc > CreatedAtUtc),
    CONSTRAINT CK_RegistrationIntakes_04 CHECK (TokenHash IS NULL OR DATALENGTH(TokenHash) = 32)
);

-- Normalized private photo metadata; content is outside public web directories.
CREATE TABLE gp.PhotoAssets (
    PhotoAssetId uniqueidentifier NOT NULL CONSTRAINT DF_PhotoAssets_PhotoAssetId DEFAULT (NEWSEQUENTIALID()),
    IntakeId uniqueidentifier NOT NULL,
    StorageKey nvarchar(400) NULL,
    ContentHash varbinary(32) NOT NULL,
    MimeType varchar(32) NOT NULL,
    ByteLength int NOT NULL,
    PixelWidth int NOT NULL,
    PixelHeight int NOT NULL,
    CapturedAtUtc datetime2(3) NOT NULL,
    PurgedAtUtc datetime2(3) NULL,
    CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_PhotoAssets_CreatedAtUtc DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_PhotoAssets PRIMARY KEY (PhotoAssetId),
    CONSTRAINT UQ_PhotoAssets_01 UNIQUE (PhotoAssetId, IntakeId),
    CONSTRAINT CK_PhotoAssets_01 CHECK (MimeType IN ('image/jpeg','image/png','image/webp')),
    CONSTRAINT CK_PhotoAssets_02 CHECK (ByteLength BETWEEN 1 AND 5242880),
    CONSTRAINT CK_PhotoAssets_03 CHECK (PixelWidth BETWEEN 1 AND 4096 AND PixelHeight BETWEEN 1 AND 4096 AND CONVERT(bigint,PixelWidth)*PixelHeight <= 16000000),
    CONSTRAINT CK_PhotoAssets_04 CHECK ((PurgedAtUtc IS NULL AND StorageKey IS NOT NULL) OR (PurgedAtUtc IS NOT NULL AND StorageKey IS NULL)),
    CONSTRAINT CK_PhotoAssets_05 CHECK (ContentHash IS NULL OR DATALENGTH(ContentHash) = 32)
);

CREATE UNIQUE INDEX UX_Photo_Key ON gp.PhotoAssets(StorageKey) WHERE StorageKey IS NOT NULL;

-- One submitted person per visit; frozen person/scope snapshot drives independent approval.
CREATE TABLE gp.VisitRequests (
    VisitRequestId uniqueidentifier NOT NULL CONSTRAINT DF_VisitRequests_VisitRequestId DEFAULT (NEWSEQUENTIALID()),
    PublicReference varchar(40) NOT NULL,
    IntakeId uniqueidentifier NOT NULL,
    ClientPersonKey uniqueidentifier NOT NULL,
    RequestType varchar(24) NOT NULL,
    EmployeeId nvarchar(64) NULL,
    PersonName nvarchar(200) NOT NULL,
    PersonEmail nvarchar(320) NULL,
    PersonPhone nvarchar(30) NULL,
    PhotoAssetId uniqueidentifier NOT NULL,
    LocationId int NOT NULL,
    ProjectLocationId bigint NULL,
    HostEmployeeId nvarchar(64) NULL,
    Reason nvarchar(1000) NOT NULL,
    TemporaryIdReason varchar(16) NULL,
    Status varchar(12) NOT NULL,
    LocalVisitDate date NOT NULL,
    ValidFromUtc datetime2(3) NOT NULL,
    ValidUntilUtc datetime2(3) NOT NULL,
    ApprovalDeadlineUtc datetime2(3) NULL,
    SnapshotVersion int NOT NULL CONSTRAINT DF_VisitRequests_SnapshotVersion DEFAULT (1),
    SnapshotHash varbinary(32) NOT NULL,
    DecisionAtUtc datetime2(3) NULL,
    CancelledAtUtc datetime2(3) NULL,
    SubmittedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_VisitRequests_SubmittedAtUtc DEFAULT (SYSUTCDATETIME()),
    PersonalDataPurgedAtUtc datetime2(3) NULL,
    RowVer rowversion NOT NULL,
    CONSTRAINT PK_VisitRequests PRIMARY KEY (VisitRequestId),
    CONSTRAINT UQ_VisitRequests_01 UNIQUE (PublicReference),
    CONSTRAINT UQ_VisitRequests_02 UNIQUE (IntakeId, ClientPersonKey),
    CONSTRAINT UQ_VisitRequests_03 UNIQUE (PhotoAssetId),
    CONSTRAINT UQ_VisitRequests_04 UNIQUE (VisitRequestId, LocationId),
    CONSTRAINT UQ_VisitRequests_05 UNIQUE (VisitRequestId, SnapshotVersion, SnapshotHash),
    CONSTRAINT UQ_VisitRequests_06 UNIQUE (VisitRequestId, EmployeeId, LocationId, RequestType, LocalVisitDate),
    CONSTRAINT CK_VisitRequests_01 CHECK (Status IN ('PENDING','APPROVED','DENIED','CANCELLED')),
    CONSTRAINT CK_VisitRequests_02 CHECK (ValidUntilUtc > ValidFromUtc),
    CONSTRAINT CK_VisitRequests_03 CHECK (SnapshotVersion = 1),
    CONSTRAINT CK_VisitRequests_04 CHECK (LEN(LTRIM(RTRIM(PersonName))) > 0 AND LEN(LTRIM(RTRIM(Reason))) > 0),
    CONSTRAINT CK_VisitRequests_05 CHECK ((RequestType='TEMP_ID' AND EmployeeId IS NOT NULL AND PersonEmail IS NOT NULL AND ProjectLocationId IS NULL AND HostEmployeeId IS NULL AND TemporaryIdReason IN ('FORGOT','LOST','OTHER') AND TemporaryIdReason IS NOT NULL AND ApprovalDeadlineUtc IS NULL AND Status IN ('APPROVED','CANCELLED')) OR (RequestType='EMPLOYEE_PROJECT' AND EmployeeId IS NOT NULL AND PersonEmail IS NOT NULL AND ProjectLocationId IS NOT NULL AND HostEmployeeId IS NOT NULL AND TemporaryIdReason IS NULL AND ApprovalDeadlineUtc IS NOT NULL) OR (RequestType='EXTERNAL' AND EmployeeId IS NULL AND ProjectLocationId IS NOT NULL AND HostEmployeeId IS NOT NULL AND TemporaryIdReason IS NULL AND ApprovalDeadlineUtc IS NOT NULL)),
    CONSTRAINT CK_VisitRequests_06 CHECK (ApprovalDeadlineUtc IS NULL OR (ApprovalDeadlineUtc > SubmittedAtUtc AND ApprovalDeadlineUtc <= ValidUntilUtc)),
    CONSTRAINT CK_VisitRequests_07 CHECK (((Status IN ('APPROVED','DENIED')) AND DecisionAtUtc IS NOT NULL) OR (Status='PENDING' AND DecisionAtUtc IS NULL) OR Status='CANCELLED'),
    CONSTRAINT CK_VisitRequests_08 CHECK ((Status='CANCELLED' AND CancelledAtUtc IS NOT NULL) OR (Status<>'CANCELLED' AND CancelledAtUtc IS NULL)),
    CONSTRAINT CK_VisitRequests_09 CHECK (CONVERT(date,DATEADD(minute,330,ValidFromUtc)) = LocalVisitDate AND ValidUntilUtc <= DATEADD(minute,-330,DATEADD(day,1,CONVERT(datetime2(3),LocalVisitDate)))),
    CONSTRAINT CK_VisitRequests_10 CHECK (SnapshotHash IS NULL OR DATALENGTH(SnapshotHash) = 32)
);

CREATE INDEX IX_Visit_Project_Status ON gp.VisitRequests(ProjectLocationId, Status, LocalVisitDate) INCLUDE (LocationId, ValidFromUtc, ValidUntilUtc);

CREATE INDEX IX_Visit_Host ON gp.VisitRequests(HostEmployeeId, Status, SubmittedAtUtc DESC);

CREATE INDEX IX_Visit_Location ON gp.VisitRequests(LocationId, LocalVisitDate, Status);

CREATE INDEX IX_Visit_Employee ON gp.VisitRequests(EmployeeId, LocationId, LocalVisitDate) INCLUDE (RequestType, ProjectLocationId, Status, ValidFromUtc, ValidUntilUtc);

-- One reusable TEMP_ID slot per employee/office/local day; retain visit history separately.
CREATE TABLE gp.TemporaryIdSlots (
    EmployeeId nvarchar(64) NOT NULL,
    LocationId int NOT NULL,
    LocalVisitDate date NOT NULL,
    RequestType varchar(24) NOT NULL CONSTRAINT DF_TemporaryIdSlots_RequestType DEFAULT ('TEMP_ID'),
    VisitRequestId uniqueidentifier NOT NULL,
    RowVer rowversion NOT NULL,
    CONSTRAINT PK_TemporaryIdSlots PRIMARY KEY (EmployeeId, LocationId, LocalVisitDate),
    CONSTRAINT UQ_TemporaryIdSlots_01 UNIQUE (VisitRequestId),
    CONSTRAINT CK_TemporaryIdSlots_01 CHECK (RequestType='TEMP_ID')
);

-- Durable actor/operation/payload-bound retries; no bearer secrets in results.
CREATE TABLE gp.IdempotencyRequests (
    OperationId uniqueidentifier NOT NULL CONSTRAINT DF_IdempotencyRequests_OperationId DEFAULT (NEWSEQUENTIALID()),
    ActorBindingHash varbinary(32) NOT NULL,
    OperationCode varchar(40) NOT NULL,
    ClientKey uniqueidentifier NOT NULL,
    PayloadHash varbinary(32) NOT NULL,
    Status varchar(12) NOT NULL,
    ResultJson nvarchar(max) NULL,
    CompletedAtUtc datetime2(3) NULL,
    ExpiresAtUtc datetime2(3) NOT NULL,
    CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_IdempotencyRequests_CreatedAtUtc DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_IdempotencyRequests PRIMARY KEY (OperationId),
    CONSTRAINT UQ_IdempotencyRequests_01 UNIQUE (ActorBindingHash, OperationCode, ClientKey),
    CONSTRAINT CK_IdempotencyRequests_01 CHECK ((Status='PROCESSING' AND CompletedAtUtc IS NULL AND ResultJson IS NULL) OR (Status='COMPLETED' AND CompletedAtUtc IS NOT NULL AND ResultJson IS NOT NULL)),
    CONSTRAINT CK_IdempotencyRequests_02 CHECK (ResultJson IS NULL OR ISJSON(ResultJson)=1),
    CONSTRAINT CK_IdempotencyRequests_03 CHECK (ExpiresAtUtc > CreatedAtUtc),
    CONSTRAINT CK_IdempotencyRequests_04 CHECK (ActorBindingHash IS NULL OR DATALENGTH(ActorBindingHash) = 32),
    CONSTRAINT CK_IdempotencyRequests_05 CHECK (PayloadHash IS NULL OR DATALENGTH(PayloadHash) = 32)
);

-- One immutable host decision for one exact individual submitted snapshot.
CREATE TABLE gp.ApprovalDecisions (
    VisitRequestId uniqueidentifier NOT NULL,
    ApproverEmployeeId nvarchar(64) NOT NULL,
    SnapshotVersion int NOT NULL,
    SnapshotHash varbinary(32) NOT NULL,
    Decision varchar(12) NOT NULL,
    DecisionSource varchar(12) NOT NULL,
    OperationId uniqueidentifier NOT NULL,
    Comment nvarchar(500) NULL,
    DecidedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_ApprovalDecisions_DecidedAtUtc DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_ApprovalDecisions PRIMARY KEY (VisitRequestId),
    CONSTRAINT UQ_ApprovalDecisions_01 UNIQUE (OperationId),
    CONSTRAINT CK_ApprovalDecisions_01 CHECK (Decision IN ('APPROVED','DENIED')),
    CONSTRAINT CK_ApprovalDecisions_02 CHECK (DecisionSource IN ('OUTLOOK','WEB')),
    CONSTRAINT CK_ApprovalDecisions_03 CHECK (SnapshotHash IS NULL OR DATALENGTH(SnapshotHash) = 32)
);

-- Versioned credential for one visit; validity/scope inherited from immutable visit.
CREATE TABLE gp.AccessPasses (
    AccessPassId uniqueidentifier NOT NULL CONSTRAINT DF_AccessPasses_AccessPassId DEFAULT (NEWSEQUENTIALID()),
    VisitRequestId uniqueidentifier NOT NULL,
    PassVersion int NOT NULL,
    PublicPassNumber varchar(50) NOT NULL,
    CredentialHash varbinary(32) NOT NULL,
    Status varchar(12) NOT NULL,
    IsCurrent bit NOT NULL CONSTRAINT DF_AccessPasses_IsCurrent DEFAULT (1),
    RevokedAtUtc datetime2(3) NULL,
    RevocationReason nvarchar(300) NULL,
    CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_AccessPasses_CreatedAtUtc DEFAULT (SYSUTCDATETIME()),
    RowVer rowversion NOT NULL,
    CONSTRAINT PK_AccessPasses PRIMARY KEY (AccessPassId),
    CONSTRAINT UQ_AccessPasses_01 UNIQUE (VisitRequestId, PassVersion),
    CONSTRAINT UQ_AccessPasses_02 UNIQUE (PublicPassNumber),
    CONSTRAINT UQ_AccessPasses_03 UNIQUE (CredentialHash),
    CONSTRAINT UQ_AccessPasses_04 UNIQUE (AccessPassId, VisitRequestId),
    CONSTRAINT CK_AccessPasses_01 CHECK (PassVersion > 0),
    CONSTRAINT CK_AccessPasses_02 CHECK (Status IN ('PENDING','ACTIVE','DENIED','REVOKED')),
    CONSTRAINT CK_AccessPasses_03 CHECK ((Status='REVOKED' AND RevokedAtUtc IS NOT NULL AND RevocationReason IS NOT NULL) OR (Status<>'REVOKED' AND RevokedAtUtc IS NULL AND RevocationReason IS NULL)),
    CONSTRAINT CK_AccessPasses_04 CHECK (IsCurrent=1 OR Status='REVOKED'),
    CONSTRAINT CK_AccessPasses_05 CHECK (CredentialHash IS NULL OR DATALENGTH(CredentialHash) = 32)
);

CREATE UNIQUE INDEX UX_Pass_Current ON gp.AccessPasses(VisitRequestId) WHERE IsCurrent=1;

-- Separately permissioned encrypted QR credential for authorized reprint/render only.
CREATE TABLE gp.PassSecrets (
    AccessPassId uniqueidentifier NOT NULL,
    Ciphertext varbinary(max) NOT NULL,
    Nonce binary(12) NOT NULL,
    AuthenticationTag binary(16) NOT NULL,
    KeyVersion varchar(100) NOT NULL,
    CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_PassSecrets_CreatedAtUtc DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_PassSecrets PRIMARY KEY (AccessPassId),
    CONSTRAINT UQ_PassSecrets_01 UNIQUE (KeyVersion, Nonce),
    CONSTRAINT CK_PassSecrets_01 CHECK (DATALENGTH(Ciphertext) BETWEEN 1 AND 4096)
);

-- Current INSIDE/OUTSIDE state of one individual visit, preserved across pass versions.
CREATE TABLE gp.VisitPresence (
    VisitRequestId uniqueidentifier NOT NULL,
    IsInside bit NOT NULL CONSTRAINT DF_VisitPresence_IsInside DEFAULT (0),
    LastAccessEventId bigint NULL,
    LastMovementAtUtc datetime2(3) NULL,
    RowVer rowversion NOT NULL,
    CONSTRAINT PK_VisitPresence PRIMARY KEY (VisitRequestId),
    CONSTRAINT CK_VisitPresence_01 CHECK ((LastAccessEventId IS NULL AND LastMovementAtUtc IS NULL AND IsInside=0) OR (LastAccessEventId IS NOT NULL AND LastMovementAtUtc IS NOT NULL))
);

CREATE INDEX IX_Presence_Inside ON gp.VisitPresence(VisitRequestId) INCLUDE (LastMovementAtUtc) WHERE IsInside=1;

-- Immutable committed individual ENTRY/EXIT; scan verification is recorded separately.
CREATE TABLE gp.AccessEvents (
    AccessEventId bigint IDENTITY(1,1) NOT NULL,
    VisitRequestId uniqueidentifier NOT NULL,
    AccessPassId uniqueidentifier NOT NULL,
    ActorUserId uniqueidentifier NOT NULL,
    LocationId int NOT NULL,
    EventType varchar(8) NOT NULL,
    EntryMethod varchar(12) NOT NULL,
    OperationId uniqueidentifier NOT NULL,
    OccurredAtUtc datetime2(3) NOT NULL,
    RecordedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_AccessEvents_RecordedAtUtc DEFAULT (SYSUTCDATETIME()),
    ReconciliationReason nvarchar(500) NULL,
    CorrelationId uniqueidentifier NULL,
    CONSTRAINT PK_AccessEvents PRIMARY KEY (AccessEventId),
    CONSTRAINT UQ_AccessEvents_01 UNIQUE (AccessEventId, VisitRequestId),
    CONSTRAINT UQ_AccessEvents_02 UNIQUE (OperationId),
    CONSTRAINT CK_AccessEvents_01 CHECK (EventType IN ('ENTRY','EXIT')),
    CONSTRAINT CK_AccessEvents_02 CHECK (OccurredAtUtc <= RecordedAtUtc),
    CONSTRAINT CK_AccessEvents_03 CHECK ((EntryMethod IN ('SCAN','MANUAL') AND ReconciliationReason IS NULL) OR (EntryMethod='RECONCILE' AND ReconciliationReason IS NOT NULL AND EventType='EXIT'))
);

CREATE INDEX IX_Movement_Visit ON gp.AccessEvents(VisitRequestId, AccessEventId DESC);

CREATE INDEX IX_Movement_Location ON gp.AccessEvents(LocationId, RecordedAtUtc DESC);

-- Verification outcomes; no implicit physical entry and no raw unknown credentials.
CREATE TABLE gp.PassScanAttempts (
    ScanAttemptId bigint IDENTITY(1,1) NOT NULL,
    AccessPassId uniqueidentifier NULL,
    VisitRequestId uniqueidentifier NULL,
    ActorUserId uniqueidentifier NOT NULL,
    LocationId int NOT NULL,
    OutcomeCode varchar(32) NOT NULL,
    OccurredAtUtc datetime2(3) NOT NULL CONSTRAINT DF_PassScanAttempts_OccurredAtUtc DEFAULT (SYSUTCDATETIME()),
    CorrelationId uniqueidentifier NULL,
    CONSTRAINT PK_PassScanAttempts PRIMARY KEY (ScanAttemptId),
    CONSTRAINT CK_PassScanAttempts_01 CHECK ((AccessPassId IS NULL AND VisitRequestId IS NULL) OR (AccessPassId IS NOT NULL AND VisitRequestId IS NOT NULL)),
    CONSTRAINT CK_PassScanAttempts_02 CHECK (OutcomeCode IN ('VALID','PENDING','DENIED','EXPIRED','REVOKED','NOT_FOUND','WRONG_PROJECT','WRONG_LOCATION','NOT_YET_VALID','NOT_AUTHORIZED','CANCELLED','ERROR'))
);

CREATE INDEX IX_Scan_Actor ON gp.PassScanAttempts(ActorUserId, OccurredAtUtc DESC);

-- Separate revocable bearer token for holder-specific viewing; encrypted recovery for dispatch.
CREATE TABLE gp.PassDeliveryLinks (
    DeliveryLinkId uniqueidentifier NOT NULL CONSTRAINT DF_PassDeliveryLinks_DeliveryLinkId DEFAULT (NEWSEQUENTIALID()),
    AccessPassId uniqueidentifier NOT NULL,
    VisitRequestId uniqueidentifier NOT NULL,
    TokenHash varbinary(32) NOT NULL,
    TokenCiphertext varbinary(max) NOT NULL,
    Nonce binary(12) NOT NULL,
    AuthenticationTag binary(16) NOT NULL,
    KeyVersion varchar(100) NOT NULL,
    RecipientEmail nvarchar(320) NOT NULL,
    ExpiresAtUtc datetime2(3) NOT NULL,
    RevokedAtUtc datetime2(3) NULL,
    LastUsedAtUtc datetime2(3) NULL,
    CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_PassDeliveryLinks_CreatedAtUtc DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_PassDeliveryLinks PRIMARY KEY (DeliveryLinkId),
    CONSTRAINT UQ_PassDeliveryLinks_01 UNIQUE (TokenHash),
    CONSTRAINT UQ_PassDeliveryLinks_02 UNIQUE (KeyVersion, Nonce),
    CONSTRAINT UQ_PassDeliveryLinks_03 UNIQUE (DeliveryLinkId, VisitRequestId),
    CONSTRAINT CK_PassDeliveryLinks_01 CHECK (ExpiresAtUtc > CreatedAtUtc),
    CONSTRAINT CK_PassDeliveryLinks_02 CHECK (DATALENGTH(TokenCiphertext) BETWEEN 1 AND 4096),
    CONSTRAINT CK_PassDeliveryLinks_03 CHECK (TokenHash IS NULL OR DATALENGTH(TokenHash) = 32)
);

-- Individual card rendering/dispatch audit; not proof that paper physically printed.
CREATE TABLE gp.PassPrintJobs (
    PrintJobId uniqueidentifier NOT NULL CONSTRAINT DF_PassPrintJobs_PrintJobId DEFAULT (NEWSEQUENTIALID()),
    AccessPassId uniqueidentifier NOT NULL,
    VisitRequestId uniqueidentifier NOT NULL,
    LocationId int NOT NULL,
    RequestedByUserId uniqueidentifier NOT NULL,
    OperationId uniqueidentifier NOT NULL,
    PrintReason varchar(12) NOT NULL,
    Status varchar(12) NOT NULL,
    PrinterLabel nvarchar(100) NULL,
    UpdatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_PassPrintJobs_UpdatedAtUtc DEFAULT (SYSUTCDATETIME()),
    CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_PassPrintJobs_CreatedAtUtc DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_PassPrintJobs PRIMARY KEY (PrintJobId),
    CONSTRAINT UQ_PassPrintJobs_01 UNIQUE (OperationId),
    CONSTRAINT CK_PassPrintJobs_01 CHECK (PrintReason IN ('FIRST','REPRINT','REISSUE')),
    CONSTRAINT CK_PassPrintJobs_02 CHECK (Status IN ('REQUESTED','RENDERED','DISPATCHED','FAILED')),
    CONSTRAINT CK_PassPrintJobs_03 CHECK (UpdatedAtUtc >= CreatedAtUtc)
);

-- Transactional, leased and retryable dispatch with encrypted secrets referenced by ID.
CREATE TABLE gp.NotificationOutbox (
    NotificationId bigint IDENTITY(1,1) NOT NULL,
    VisitRequestId uniqueidentifier NULL,
    DeliveryLinkId uniqueidentifier NULL,
    RecipientKind varchar(12) NOT NULL,
    RecipientEmployeeId nvarchar(64) NULL,
    RecipientEmail nvarchar(320) NULL,
    TemplateCode varchar(40) NOT NULL,
    PayloadJson nvarchar(max) NOT NULL,
    DedupeHash varbinary(32) NOT NULL,
    Status varchar(12) NOT NULL CONSTRAINT DF_NotificationOutbox_Status DEFAULT ('PENDING'),
    AttemptCount int NOT NULL CONSTRAINT DF_NotificationOutbox_AttemptCount DEFAULT (0),
    MaxAttempts int NOT NULL CONSTRAINT DF_NotificationOutbox_MaxAttempts DEFAULT (8),
    NextAttemptAtUtc datetime2(3) NOT NULL CONSTRAINT DF_NotificationOutbox_NextAttemptAtUtc DEFAULT (SYSUTCDATETIME()),
    LockedBy uniqueidentifier NULL,
    LockedUntilUtc datetime2(3) NULL,
    LastErrorCode varchar(100) NULL,
    SentAtUtc datetime2(3) NULL,
    ProviderMessageId nvarchar(200) NULL,
    CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_NotificationOutbox_CreatedAtUtc DEFAULT (SYSUTCDATETIME()),
    RowVer rowversion NOT NULL,
    CONSTRAINT PK_NotificationOutbox PRIMARY KEY (NotificationId),
    CONSTRAINT UQ_NotificationOutbox_01 UNIQUE (DedupeHash),
    CONSTRAINT CK_NotificationOutbox_01 CHECK (Status IN ('PENDING','PROCESSING','SENT','DEAD','CANCELLED')),
    CONSTRAINT CK_NotificationOutbox_02 CHECK (AttemptCount >= 0 AND MaxAttempts BETWEEN 1 AND 100),
    CONSTRAINT CK_NotificationOutbox_03 CHECK ((Status='PROCESSING' AND LockedBy IS NOT NULL AND LockedUntilUtc IS NOT NULL) OR (Status<>'PROCESSING' AND LockedBy IS NULL AND LockedUntilUtc IS NULL)),
    CONSTRAINT CK_NotificationOutbox_04 CHECK ((Status='SENT' AND SentAtUtc IS NOT NULL) OR (Status<>'SENT' AND SentAtUtc IS NULL)),
    CONSTRAINT CK_NotificationOutbox_05 CHECK (ISJSON(PayloadJson)=1),
    CONSTRAINT CK_NotificationOutbox_06 CHECK (DeliveryLinkId IS NULL OR VisitRequestId IS NOT NULL),
    CONSTRAINT CK_NotificationOutbox_07 CHECK ((RecipientKind='EMAIL' AND RecipientEmail IS NOT NULL AND RecipientEmployeeId IS NULL) OR (RecipientKind IN ('EMPLOYEE','MANAGER') AND RecipientEmployeeId IS NOT NULL)),
    CONSTRAINT CK_NotificationOutbox_08 CHECK (DedupeHash IS NULL OR DATALENGTH(DedupeHash) = 32)
);

CREATE INDEX IX_Outbox_Due ON gp.NotificationOutbox(Status, NextAttemptAtUtc) INCLUDE (AttemptCount, MaxAttempts, LockedUntilUtc);

-- Append-only application audit; independent protected export required for tamper resistance.
CREATE TABLE gp.SecurityAuditEvents (
    AuditEventId bigint IDENTITY(1,1) NOT NULL,
    ActorUserId uniqueidentifier NULL,
    ActionCode varchar(80) NOT NULL,
    TargetType varchar(50) NOT NULL,
    TargetReference varchar(100) NULL,
    LocationId int NULL,
    ProjectLocationId bigint NULL,
    ResultCode varchar(12) NOT NULL,
    MetadataJson nvarchar(max) NULL,
    CorrelationId uniqueidentifier NULL,
    OccurredAtUtc datetime2(3) NOT NULL CONSTRAINT DF_SecurityAuditEvents_OccurredAtUtc DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_SecurityAuditEvents PRIMARY KEY (AuditEventId),
    CONSTRAINT CK_SecurityAuditEvents_01 CHECK (ResultCode IN ('SUCCESS','DENIED','ERROR')),
    CONSTRAINT CK_SecurityAuditEvents_02 CHECK (MetadataJson IS NULL OR ISJSON(MetadataJson)=1),
    CONSTRAINT CK_SecurityAuditEvents_03 CHECK (ProjectLocationId IS NULL OR LocationId IS NOT NULL)
);

CREATE INDEX IX_Audit_Time ON gp.SecurityAuditEvents(OccurredAtUtc DESC);

CREATE INDEX IX_Audit_Scope ON gp.SecurityAuditEvents(LocationId, ProjectLocationId, OccurredAtUtc DESC);

-- Revocable server-side staff sessions; browser holds only opaque secure-cookie ID.
CREATE TABLE gp.Sessions (
    SessionHash varbinary(32) NOT NULL,
    UserId uniqueidentifier NOT NULL,
    CsrfHash varbinary(32) NOT NULL,
    AuthorizationVersionAtIssue bigint NOT NULL,
    LastSeenAtUtc datetime2(3) NOT NULL,
    IdleExpiresAtUtc datetime2(3) NOT NULL,
    AbsoluteExpiresAtUtc datetime2(3) NOT NULL,
    RevokedAtUtc datetime2(3) NULL,
    CreatedAtUtc datetime2(3) NOT NULL CONSTRAINT DF_Sessions_CreatedAtUtc DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_Sessions PRIMARY KEY (SessionHash),
    CONSTRAINT CK_Sessions_01 CHECK (AuthorizationVersionAtIssue > 0),
    CONSTRAINT CK_Sessions_02 CHECK (LastSeenAtUtc >= CreatedAtUtc AND IdleExpiresAtUtc > LastSeenAtUtc AND AbsoluteExpiresAtUtc >= IdleExpiresAtUtc),
    CONSTRAINT CK_Sessions_03 CHECK (SessionHash IS NULL OR DATALENGTH(SessionHash) = 32),
    CONSTRAINT CK_Sessions_04 CHECK (CsrfHash IS NULL OR DATALENGTH(CsrfHash) = 32)
);

CREATE INDEX IX_Session_User ON gp.Sessions(UserId, RevokedAtUtc, AbsoluteExpiresAtUtc);

ALTER TABLE gp.ProjectLocations WITH CHECK ADD CONSTRAINT FK_ProjectLocations_01 FOREIGN KEY (ProjectId) REFERENCES gp.Projects (ProjectId);

ALTER TABLE gp.ProjectLocations WITH CHECK ADD CONSTRAINT FK_ProjectLocations_02 FOREIGN KEY (LocationId) REFERENCES gp.Locations (LocationId);

ALTER TABLE gp.Employees WITH CHECK ADD CONSTRAINT FK_Employees_01 FOREIGN KEY (UserId) REFERENCES gp.Users (UserId);

ALTER TABLE gp.EmployeeProjectMemberships WITH CHECK ADD CONSTRAINT FK_EmployeeProjectMemberships_01 FOREIGN KEY (EmployeeId) REFERENCES gp.Employees (EmployeeId);

ALTER TABLE gp.EmployeeProjectMemberships WITH CHECK ADD CONSTRAINT FK_EmployeeProjectMemberships_02 FOREIGN KEY (ProjectId) REFERENCES gp.Projects (ProjectId);

ALTER TABLE gp.StaffRoleGrants WITH CHECK ADD CONSTRAINT FK_StaffRoleGrants_01 FOREIGN KEY (UserId) REFERENCES gp.Users (UserId);

ALTER TABLE gp.StaffRoleGrants WITH CHECK ADD CONSTRAINT FK_StaffRoleGrants_02 FOREIGN KEY (GrantedByUserId) REFERENCES gp.Users (UserId);

ALTER TABLE gp.StaffRoleGrants WITH CHECK ADD CONSTRAINT FK_StaffRoleGrants_03 FOREIGN KEY (RevokedByUserId) REFERENCES gp.Users (UserId);

ALTER TABLE gp.StaffRoleGrants WITH CHECK ADD CONSTRAINT FK_StaffRoleGrants_04 FOREIGN KEY (LocationId) REFERENCES gp.Locations (LocationId);

ALTER TABLE gp.StaffRoleGrants WITH CHECK ADD CONSTRAINT FK_StaffRoleGrants_05 FOREIGN KEY (ProjectId) REFERENCES gp.Projects (ProjectId);

ALTER TABLE gp.StaffRoleGrants WITH CHECK ADD CONSTRAINT FK_StaffRoleGrants_06 FOREIGN KEY (ProjectLocationId) REFERENCES gp.ProjectLocations (ProjectLocationId);

ALTER TABLE gp.GrantCapabilities WITH CHECK ADD CONSTRAINT FK_GrantCapabilities_01 FOREIGN KEY (RoleGrantId) REFERENCES gp.StaffRoleGrants (RoleGrantId);

ALTER TABLE gp.GrantCapabilities WITH CHECK ADD CONSTRAINT FK_GrantCapabilities_02 FOREIGN KEY (CapabilityCode) REFERENCES gp.Capabilities (CapabilityCode);

ALTER TABLE gp.GuardAssignments WITH CHECK ADD CONSTRAINT FK_GuardAssignments_01 FOREIGN KEY (GuardUserId) REFERENCES gp.Users (UserId);

ALTER TABLE gp.GuardAssignments WITH CHECK ADD CONSTRAINT FK_GuardAssignments_02 FOREIGN KEY (AssignedByUserId) REFERENCES gp.Users (UserId);

ALTER TABLE gp.GuardAssignments WITH CHECK ADD CONSTRAINT FK_GuardAssignments_03 FOREIGN KEY (DeallocatedByUserId) REFERENCES gp.Users (UserId);

ALTER TABLE gp.GuardAssignments WITH CHECK ADD CONSTRAINT FK_GuardAssignments_04 FOREIGN KEY (ProjectLocationId) REFERENCES gp.ProjectLocations (ProjectLocationId);

ALTER TABLE gp.RegistrationIntakes WITH CHECK ADD CONSTRAINT FK_RegistrationIntakes_01 FOREIGN KEY (OwnerUserId) REFERENCES gp.Users (UserId);

ALTER TABLE gp.PhotoAssets WITH CHECK ADD CONSTRAINT FK_PhotoAssets_01 FOREIGN KEY (IntakeId) REFERENCES gp.RegistrationIntakes (IntakeId);

ALTER TABLE gp.VisitRequests WITH CHECK ADD CONSTRAINT FK_VisitRequests_01 FOREIGN KEY (IntakeId) REFERENCES gp.RegistrationIntakes (IntakeId);

ALTER TABLE gp.VisitRequests WITH CHECK ADD CONSTRAINT FK_VisitRequests_02 FOREIGN KEY (PhotoAssetId, IntakeId) REFERENCES gp.PhotoAssets (PhotoAssetId, IntakeId);

ALTER TABLE gp.VisitRequests WITH CHECK ADD CONSTRAINT FK_VisitRequests_03 FOREIGN KEY (EmployeeId) REFERENCES gp.Employees (EmployeeId);

ALTER TABLE gp.VisitRequests WITH CHECK ADD CONSTRAINT FK_VisitRequests_04 FOREIGN KEY (HostEmployeeId) REFERENCES gp.Employees (EmployeeId);

ALTER TABLE gp.VisitRequests WITH CHECK ADD CONSTRAINT FK_VisitRequests_05 FOREIGN KEY (LocationId) REFERENCES gp.Locations (LocationId);

ALTER TABLE gp.VisitRequests WITH CHECK ADD CONSTRAINT FK_VisitRequests_06 FOREIGN KEY (ProjectLocationId, LocationId) REFERENCES gp.ProjectLocations (ProjectLocationId, LocationId);

ALTER TABLE gp.TemporaryIdSlots WITH CHECK ADD CONSTRAINT FK_TemporaryIdSlots_01 FOREIGN KEY (VisitRequestId, EmployeeId, LocationId, RequestType, LocalVisitDate) REFERENCES gp.VisitRequests (VisitRequestId, EmployeeId, LocationId, RequestType, LocalVisitDate);

ALTER TABLE gp.ApprovalDecisions WITH CHECK ADD CONSTRAINT FK_ApprovalDecisions_01 FOREIGN KEY (VisitRequestId, SnapshotVersion, SnapshotHash) REFERENCES gp.VisitRequests (VisitRequestId, SnapshotVersion, SnapshotHash);

ALTER TABLE gp.ApprovalDecisions WITH CHECK ADD CONSTRAINT FK_ApprovalDecisions_02 FOREIGN KEY (ApproverEmployeeId) REFERENCES gp.Employees (EmployeeId);

ALTER TABLE gp.ApprovalDecisions WITH CHECK ADD CONSTRAINT FK_ApprovalDecisions_03 FOREIGN KEY (OperationId) REFERENCES gp.IdempotencyRequests (OperationId);

ALTER TABLE gp.AccessPasses WITH CHECK ADD CONSTRAINT FK_AccessPasses_01 FOREIGN KEY (VisitRequestId) REFERENCES gp.VisitRequests (VisitRequestId);

ALTER TABLE gp.PassSecrets WITH CHECK ADD CONSTRAINT FK_PassSecrets_01 FOREIGN KEY (AccessPassId) REFERENCES gp.AccessPasses (AccessPassId);

ALTER TABLE gp.VisitPresence WITH CHECK ADD CONSTRAINT FK_VisitPresence_01 FOREIGN KEY (VisitRequestId) REFERENCES gp.VisitRequests (VisitRequestId);

ALTER TABLE gp.VisitPresence WITH CHECK ADD CONSTRAINT FK_VisitPresence_02 FOREIGN KEY (LastAccessEventId, VisitRequestId) REFERENCES gp.AccessEvents (AccessEventId, VisitRequestId);

ALTER TABLE gp.AccessEvents WITH CHECK ADD CONSTRAINT FK_AccessEvents_01 FOREIGN KEY (AccessPassId, VisitRequestId) REFERENCES gp.AccessPasses (AccessPassId, VisitRequestId);

ALTER TABLE gp.AccessEvents WITH CHECK ADD CONSTRAINT FK_AccessEvents_02 FOREIGN KEY (VisitRequestId, LocationId) REFERENCES gp.VisitRequests (VisitRequestId, LocationId);

ALTER TABLE gp.AccessEvents WITH CHECK ADD CONSTRAINT FK_AccessEvents_03 FOREIGN KEY (ActorUserId) REFERENCES gp.Users (UserId);

ALTER TABLE gp.AccessEvents WITH CHECK ADD CONSTRAINT FK_AccessEvents_04 FOREIGN KEY (OperationId) REFERENCES gp.IdempotencyRequests (OperationId);

ALTER TABLE gp.PassScanAttempts WITH CHECK ADD CONSTRAINT FK_PassScanAttempts_01 FOREIGN KEY (AccessPassId, VisitRequestId) REFERENCES gp.AccessPasses (AccessPassId, VisitRequestId);

ALTER TABLE gp.PassScanAttempts WITH CHECK ADD CONSTRAINT FK_PassScanAttempts_02 FOREIGN KEY (ActorUserId) REFERENCES gp.Users (UserId);

ALTER TABLE gp.PassScanAttempts WITH CHECK ADD CONSTRAINT FK_PassScanAttempts_03 FOREIGN KEY (LocationId) REFERENCES gp.Locations (LocationId);

ALTER TABLE gp.PassDeliveryLinks WITH CHECK ADD CONSTRAINT FK_PassDeliveryLinks_01 FOREIGN KEY (AccessPassId, VisitRequestId) REFERENCES gp.AccessPasses (AccessPassId, VisitRequestId);

ALTER TABLE gp.PassPrintJobs WITH CHECK ADD CONSTRAINT FK_PassPrintJobs_01 FOREIGN KEY (AccessPassId, VisitRequestId) REFERENCES gp.AccessPasses (AccessPassId, VisitRequestId);

ALTER TABLE gp.PassPrintJobs WITH CHECK ADD CONSTRAINT FK_PassPrintJobs_02 FOREIGN KEY (VisitRequestId, LocationId) REFERENCES gp.VisitRequests (VisitRequestId, LocationId);

ALTER TABLE gp.PassPrintJobs WITH CHECK ADD CONSTRAINT FK_PassPrintJobs_03 FOREIGN KEY (RequestedByUserId) REFERENCES gp.Users (UserId);

ALTER TABLE gp.PassPrintJobs WITH CHECK ADD CONSTRAINT FK_PassPrintJobs_04 FOREIGN KEY (OperationId) REFERENCES gp.IdempotencyRequests (OperationId);

ALTER TABLE gp.NotificationOutbox WITH CHECK ADD CONSTRAINT FK_NotificationOutbox_01 FOREIGN KEY (VisitRequestId) REFERENCES gp.VisitRequests (VisitRequestId);

ALTER TABLE gp.NotificationOutbox WITH CHECK ADD CONSTRAINT FK_NotificationOutbox_02 FOREIGN KEY (DeliveryLinkId, VisitRequestId) REFERENCES gp.PassDeliveryLinks (DeliveryLinkId, VisitRequestId);

ALTER TABLE gp.NotificationOutbox WITH CHECK ADD CONSTRAINT FK_NotificationOutbox_03 FOREIGN KEY (RecipientEmployeeId) REFERENCES gp.Employees (EmployeeId);

ALTER TABLE gp.SecurityAuditEvents WITH CHECK ADD CONSTRAINT FK_SecurityAuditEvents_01 FOREIGN KEY (ActorUserId) REFERENCES gp.Users (UserId);

ALTER TABLE gp.SecurityAuditEvents WITH CHECK ADD CONSTRAINT FK_SecurityAuditEvents_02 FOREIGN KEY (LocationId) REFERENCES gp.Locations (LocationId);

ALTER TABLE gp.SecurityAuditEvents WITH CHECK ADD CONSTRAINT FK_SecurityAuditEvents_03 FOREIGN KEY (ProjectLocationId, LocationId) REFERENCES gp.ProjectLocations (ProjectLocationId, LocationId);

ALTER TABLE gp.Sessions WITH CHECK ADD CONSTRAINT FK_Sessions_01 FOREIGN KEY (UserId) REFERENCES gp.Users (UserId);

INSERT gp.SchemaMigrations(Version,Description) VALUES ('001','Individual visits and secure persistence baseline v1.2');

COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
