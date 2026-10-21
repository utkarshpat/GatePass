# 03 - Data dictionary - GatePass v1.11

Derived from the reviewed SQL DDL through Microsoft ScriptDom; descriptive notes do not define schema. Live database verification is tracked separately.

33 tables including migration history. Each VisitRequests row is one submitted person. No VisitParticipants table or operational Group table.

UTC datetime2(3); validity is [start,end). GUID/public references are not authorization. Sensitive means restricted handling, not automatically encrypted. All encrypted-material keys remain outside this database.

No ON DELETE CASCADE. Lifecycle cleanup is explicit, audited and ordered; metadata may outlive private photo bytes. Employee email equality, immutable submitted content, permission matrices and cross-row legal transitions require the documented service transactions.

## 01. gp.SchemaMigrations

Applied migration history; no runtime mutation permissions.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| Version | `varchar(16)` | No | - | Unique version recorded by the migration transaction. |
| Description | `nvarchar(200)` | No | - | Human-readable migration description. |
| AppliedAtUtc | `datetime2(3)` | No | `(SYSUTCDATETIME())` | UTC migration completion time. |

**Primary key:** Version.


## 02. gp.Locations

Trusted office locations; no physical floor/checkpoint inventory.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| LocationId | `int IDENTITY(1,1)` | No | - | Internal location primary key. |
| LocationCode | `varchar(16)` | No | - | Stable office code, e.g. NOIDA. |
| LocationName | `nvarchar(100)` | No | - | Display name. |
| IsActive | `bit` | No | `(1)` | Whether new visits may use this location. |
| CreatedAtUtc | `datetime2(3)` | No | `(SYSUTCDATETIME())` | Server creation timestamp in UTC. |
| RowVer | `rowversion` | No | - | Database concurrency token, never a timestamp or authorization proof. |

**Primary key:** LocationId.

- Unique: LocationCode.

## 03. gp.Projects

Trusted project directory cache, not an approval grant.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| ProjectId | `bigint IDENTITY(1,1)` | No | - | Internal project primary key. |
| ExternalProjectCode | `nvarchar(80)` | No | - | Stable project code from trusted internal API. |
| ProjectName | `nvarchar(200)` | No | - | Restricted display name; not exposed as a public directory. |
| IsActive | `bit` | No | `(1)` | Whether the project accepts new visits. |
| LastSyncedAtUtc | `datetime2(3)` | Yes | - | Last successful trusted refresh. |
| RowVer | `rowversion` | No | - | Database concurrency token, never a timestamp or authorization proof. |

**Primary key:** ProjectId.

- Unique: ExternalProjectCode.

## 04. gp.ProjectLocations

Project availability in a specific office; guard scope anchor.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| ProjectLocationId | `bigint IDENTITY(1,1)` | No | - | Internal project-office pair identifier. |
| ProjectId | `bigint` | No | - | Trusted project. |
| LocationId | `int` | No | - | Office location. |
| IsActive | `bit` | No | `(1)` | Whether new visits may target this pair. |
| RowVer | `rowversion` | No | - | Database concurrency token, never a timestamp or authorization proof. |

**Primary key:** ProjectLocationId.

- Unique: ProjectId, LocationId.
- Unique: ProjectLocationId, LocationId.
- FK: (ProjectId) -> Projects (ProjectId).
- FK: (LocationId) -> Locations (LocationId).

## 05. gp.Users

Immutable issuer/subject mapping for authenticated staff and employees.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| UserId | `uniqueidentifier` | No | `(NEWSEQUENTIALID())` | Internal authenticated principal ID. |
| IdentityIssuer | `nvarchar(200)` | No | - | Configured trusted issuer; exact binary comparison. |
| IdentitySubject | `nvarchar(200)` | No | - | Immutable provider subject/object mapping; exact comparison. |
| DisplayName | `nvarchar(200)` | No | - | Display-only name. **Restricted.** |
| IsActive | `bit` | No | `(1)` | Application account enabled flag. |
| AuthorizationVersion | `bigint` | No | `(1)` | Increment on role, capability, assignment or account changes. |
| CreatedAtUtc | `datetime2(3)` | No | `(SYSUTCDATETIME())` | Server creation timestamp in UTC. |
| LastLoginAtUtc | `datetime2(3)` | Yes | - | Most recent successful sign-in. |
| RowVer | `rowversion` | No | - | Database concurrency token, never a timestamp or authorization proof. |

**Primary key:** UserId.

- Unique: IdentityIssuer, IdentitySubject.
- Check: `AuthorizationVersion > 0`.

## 06. gp.Employees

Trusted employee cache; corporate email and manager come only from directory.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| EmployeeId | `nvarchar(64)` | No | - | Immutable trusted organization employee code. |
| UserId | `uniqueidentifier` | Yes | - | Linked issuer/subject principal after trusted resolution. |
| FullName | `nvarchar(200)` | No | - | Trusted employee full name. **Restricted.** |
| OfficialEmail | `nvarchar(320)` | No | - | Authoritative corporate delivery address. **Restricted.** |
| ManagerEmployeeId | `nvarchar(64)` | Yes | - | Directory manager code; may precede local manager synchronization. |
| IsActive | `bit` | No | - | Trusted employee employment/access enabled flag. |
| LastSyncedAtUtc | `datetime2(3)` | No | - | Last successful directory verification, not last attempted refresh. |
| RowVer | `rowversion` | No | - | Database concurrency token, never a timestamp or authorization proof. |

**Primary key:** EmployeeId.

- FK: (UserId) -> Users (UserId).
- Index: `CREATE UNIQUE INDEX UX_Employees_User ON gp.Employees(UserId) WHERE UserId IS NOT NULL;`

## 07. gp.EmployeeProjectMemberships

Project affiliation cache. Exact office and project-location entitlement is additionally required for host eligibility after migration 048; this table alone does not authorize access.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| EmployeeId | `nvarchar(64)` | No | - | Employee belonging to project. |
| ProjectId | `bigint` | No | - | Project from internal API. |
| IsActive | `bit` | No | - | Trusted membership enabled flag. |
| VerifiedAtUtc | `datetime2(3)` | No | - | Last successful membership verification; freshness policy applies. |
| SourceUpdatedAtUtc | `datetime2(3)` | Yes | - | Upstream update timestamp when supplied. |
| RowVer | `rowversion` | No | - | Database concurrency token, never a timestamp or authorization proof. |

**Primary key:** EmployeeId, ProjectId.

- FK: (EmployeeId) -> Employees (EmployeeId).
- FK: (ProjectId) -> Projects (ProjectId).
- Index: `CREATE INDEX IX_Membership_Project ON gp.EmployeeProjectMemberships(ProjectId, IsActive, EmployeeId);`

## 08. gp.Capabilities

Application-controlled capability catalogue; no implicit admin superuser.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| CapabilityCode | `varchar(40)` | No | - | Explicit permission identifier. |
| Description | `nvarchar(250)` | No | - | Operational meaning; scope restrictions are documented in permission matrix. |

**Primary key:** CapabilityCode.


## 09. gp.StaffRoleGrants

Time-bounded role at one India/location/project/project-location scope.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| RoleGrantId | `bigint IDENTITY(1,1)` | No | - | Historical role grant identifier. |
| UserId | `uniqueidentifier` | No | - | Authenticated user holding the grant. |
| RoleCode | `varchar(24)` | No | - | INDIA_ADMIN, LOCATION_ADMIN, PROJECT_ADMIN, RECEPTION or GUARD. |
| ScopeType | `varchar(24)` | No | - | INDIA, LOCATION, PROJECT or PROJECT_LOCATION. |
| LocationId | `int` | Yes | - | Only for LOCATION scope. |
| ProjectId | `bigint` | Yes | - | Only for PROJECT scope. |
| ProjectLocationId | `bigint` | Yes | - | Only for PROJECT_LOCATION scope. |
| GrantedByUserId | `uniqueidentifier` | No | - | Authorized grant issuer; bootstrap handled separately. |
| ValidFromUtc | `datetime2(3)` | No | `(SYSUTCDATETIME())` | Inclusive grant start. |
| ValidUntilUtc | `datetime2(3)` | Yes | - | Exclusive grant end; null means no configured end. |
| RevokedAtUtc | `datetime2(3)` | Yes | - | Explicit revocation time. |
| RevokedByUserId | `uniqueidentifier` | Yes | - | Revoking administrator. |
| CreatedAtUtc | `datetime2(3)` | No | `(SYSUTCDATETIME())` | Server creation timestamp in UTC. |
| RowVer | `rowversion` | No | - | Database concurrency token, never a timestamp or authorization proof. |

**Primary key:** RoleGrantId.

- FK: (UserId) -> Users (UserId).
- FK: (GrantedByUserId) -> Users (UserId).
- FK: (RevokedByUserId) -> Users (UserId).
- FK: (LocationId) -> Locations (LocationId).
- FK: (ProjectId) -> Projects (ProjectId).
- FK: (ProjectLocationId) -> ProjectLocations (ProjectLocationId).
- Check: `(RoleCode='INDIA_ADMIN' AND ScopeType='INDIA') OR (RoleCode='LOCATION_ADMIN' AND ScopeType='LOCATION') OR (RoleCode='PROJECT_ADMIN' AND ScopeType IN ('PROJECT','PROJECT_LOCATION')) OR (RoleCode IN ('GUARD','RECEPTION') AND ScopeType='LOCATION')`.
- Check: `(ScopeType='INDIA' AND LocationId IS NULL AND ProjectId IS NULL AND ProjectLocationId IS NULL) OR (ScopeType='LOCATION' AND LocationId IS NOT NULL AND ProjectId IS NULL AND ProjectLocationId IS NULL) OR (ScopeType='PROJECT' AND LocationId IS NULL AND ProjectId IS NOT NULL AND ProjectLocationId IS NULL) OR (ScopeType='PROJECT_LOCATION' AND LocationId IS NULL AND ProjectId IS NULL AND ProjectLocationId IS NOT NULL)`.
- Check: `ValidUntilUtc IS NULL OR ValidUntilUtc > ValidFromUtc`.
- Check: `(RevokedAtUtc IS NULL AND RevokedByUserId IS NULL) OR (RevokedAtUtc IS NOT NULL AND RevokedByUserId IS NOT NULL AND RevokedAtUtc >= CreatedAtUtc)`.
- Index: `CREATE INDEX IX_Grants_User ON gp.StaffRoleGrants(UserId, RoleCode, RevokedAtUtc, ValidUntilUtc);`

## 10. gp.GrantCapabilities

Explicit permission on a scoped role grant; role label alone grants nothing.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| RoleGrantId | `bigint` | No | - | Grant carrying this permission. |
| CapabilityCode | `varchar(40)` | No | - | Permission allowed by the role/capability matrix. |

**Primary key:** RoleGrantId, CapabilityCode.

- FK: (RoleGrantId) -> StaffRoleGrants (RoleGrantId).
- FK: (CapabilityCode) -> Capabilities (CapabilityCode).

## 11. gp.GuardAssignments

Many-to-many guard to project-office allocations with retained history.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| GuardAssignmentId | `bigint IDENTITY(1,1)` | No | - | Historical allocation identifier. |
| GuardUserId | `uniqueidentifier` | No | - | Guard must separately hold effective GUARD capability in this office. |
| ProjectLocationId | `bigint` | No | - | Exact project-office allocation. |
| AssignedByUserId | `uniqueidentifier` | No | - | Authorized allocating administrator. |
| ValidFromUtc | `datetime2(3)` | No | `(SYSUTCDATETIME())` | Inclusive allocation start. |
| ValidUntilUtc | `datetime2(3)` | Yes | - | Exclusive allocation end; null for open ended. |
| DeallocatedAtUtc | `datetime2(3)` | Yes | - | Explicit allocation withdrawal. |
| DeallocatedByUserId | `uniqueidentifier` | Yes | - | Administrator withdrawing allocation. |
| Reason | `nvarchar(300)` | Yes | - | Allocation/change justification. |
| CreatedAtUtc | `datetime2(3)` | No | `(SYSUTCDATETIME())` | Server creation timestamp in UTC. |
| RowVer | `rowversion` | No | - | Database concurrency token, never a timestamp or authorization proof. |

**Primary key:** GuardAssignmentId.

- FK: (GuardUserId) -> Users (UserId).
- FK: (AssignedByUserId) -> Users (UserId).
- FK: (DeallocatedByUserId) -> Users (UserId).
- FK: (ProjectLocationId) -> ProjectLocations (ProjectLocationId).
- Check: `ValidUntilUtc IS NULL OR ValidUntilUtc > ValidFromUtc`.
- Check: `(DeallocatedAtUtc IS NULL AND DeallocatedByUserId IS NULL) OR (DeallocatedAtUtc IS NOT NULL AND DeallocatedByUserId IS NOT NULL AND DeallocatedAtUtc >= CreatedAtUtc)`.
- Index: `CREATE INDEX IX_Assignment_Actor ON gp.GuardAssignments(GuardUserId, ProjectLocationId, ValidFromUtc, ValidUntilUtc) INCLUDE (DeallocatedAtUtc);`

## 12. gp.RegistrationIntakes

Short-lived registration ownership and submission correlation, not an operational group.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| IntakeId | `uniqueidentifier` | No | `(NEWSEQUENTIALID())` | Private intake/session correlation identifier; never sufficient authorization. |
| TokenHash | `varbinary(32)` | No | - | SHA-256 digest of random intake bearer credential. **Restricted.** |
| IntakeType | `varchar(12)` | No | - | EMPLOYEE or PUBLIC. |
| OwnerUserId | `uniqueidentifier` | Yes | - | Required for employee intake; null for anonymous visitor intake. |
| Status | `varchar(12)` | No | `('DRAFT')` | DRAFT, SUBMITTED or ABANDONED. |
| ExpiresAtUtc | `datetime2(3)` | No | - | Intake credential expiry, independent from visit validity. |
| SubmittedAtUtc | `datetime2(3)` | Yes | - | One successful batch submission time. |
| CreatedAtUtc | `datetime2(3)` | No | `(SYSUTCDATETIME())` | Server creation timestamp in UTC. |
| RowVer | `rowversion` | No | - | Database concurrency token, never a timestamp or authorization proof. |

**Primary key:** IntakeId.

- Unique: TokenHash.
- FK: (OwnerUserId) -> Users (UserId).
- Check: `(IntakeType='EMPLOYEE' AND OwnerUserId IS NOT NULL) OR (IntakeType='PUBLIC' AND OwnerUserId IS NULL)`.
- Check: `(Status='SUBMITTED' AND SubmittedAtUtc IS NOT NULL) OR (Status IN ('DRAFT','ABANDONED') AND SubmittedAtUtc IS NULL)`.
- Check: `ExpiresAtUtc > CreatedAtUtc`.
- Check: `TokenHash IS NULL OR DATALENGTH(TokenHash) = 32`.

## 13. gp.PhotoAssets

Normalized private photo metadata; content is outside public web directories.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| PhotoAssetId | `uniqueidentifier` | No | `(NEWSEQUENTIALID())` | Photo identifier, not an access credential. |
| IntakeId | `uniqueidentifier` | No | - | Owner intake; request must use a photo from the same intake. |
| StorageKey | `nvarchar(400)` | Yes | - | Opaque private storage locator; cleared after purge. **Restricted.** |
| ContentHash | `varbinary(32)` | No | - | SHA-256 digest of normalized content. **Restricted.** |
| MimeType | `varchar(32)` | No | - | Normalized supported image format. |
| ByteLength | `int` | No | - | Processed image size in bytes. |
| PixelWidth | `int` | No | - | Normalized pixel width. |
| PixelHeight | `int` | No | - | Normalized pixel height. |
| CapturedAtUtc | `datetime2(3)` | No | - | Trusted server intake/capture timestamp. |
| PurgedAtUtc | `datetime2(3)` | Yes | - | Actual private content purge timestamp. |
| CreatedAtUtc | `datetime2(3)` | No | `(SYSUTCDATETIME())` | Server creation timestamp in UTC. |

**Primary key:** PhotoAssetId.

- Unique: PhotoAssetId, IntakeId.
- FK: (IntakeId) -> RegistrationIntakes (IntakeId).
- Check: `MimeType IN ('image/jpeg','image/png','image/webp')`.
- Check: `ByteLength BETWEEN 1 AND 5242880`.
- Check: `PixelWidth BETWEEN 1 AND 4096 AND PixelHeight BETWEEN 1 AND 4096 AND CONVERT(bigint,PixelWidth)*PixelHeight <= 16000000`.
- Check: `(PurgedAtUtc IS NULL AND StorageKey IS NOT NULL) OR (PurgedAtUtc IS NOT NULL AND StorageKey IS NULL)`.
- Check: `ContentHash IS NULL OR DATALENGTH(ContentHash) = 32`.
- Index: `CREATE UNIQUE INDEX UX_Photo_Key ON gp.PhotoAssets(StorageKey) WHERE StorageKey IS NOT NULL;`

## 14. gp.VisitRequests

One submitted person per visit; frozen person/scope snapshot drives independent approval.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| VisitRequestId | `uniqueidentifier` | No | `(NEWSEQUENTIALID())` | Individual visit identifier. |
| PublicReference | `varchar(40)` | No | - | Opaque human-friendly reference, not authorization. |
| IntakeId | `uniqueidentifier` | No | - | Registration-only correlation; not exposed as a group in operations. |
| ClientPersonKey | `uniqueidentifier` | No | - | Stable per-person input key within an idempotent intake submission. |
| RequestType | `varchar(24)` | No | - | TEMP_ID, EMPLOYEE_PROJECT or EXTERNAL. |
| EmployeeId | `nvarchar(64)` | Yes | - | The requester/person for internal visits; absent for external people. |
| PersonName | `nvarchar(200)` | No | - | Submitted display snapshot; directory-sourced for employees. **Restricted.** |
| PersonEmail | `nvarchar(320)` | Yes | - | Corporate-only for employees; optional for external visitors. **Restricted.** |
| PersonPhone | `nvarchar(30)` | Yes | - | Optional external contact; do not require identity-document data. **Restricted.** |
| PhotoAssetId | `uniqueidentifier` | No | - | Captured photo from this intake, never another intake. |
| LocationId | `int` | No | - | Authorized office. |
| ProjectLocationId | `bigint` | Yes | - | Required for project/external visits; absent for TEMP_ID. |
| HostEmployeeId | `nvarchar(64)` | Yes | - | Assigned individual approver, absent for TEMP_ID. |
| Reason | `nvarchar(1000)` | No | - | Submitted purpose snapshot. **Restricted.** |
| TemporaryIdReason | `varchar(16)` | Yes | - | FORGOT, LOST or OTHER for TEMP_ID. |
| Status | `varchar(12)` | No | - | PENDING, APPROVED, DENIED or CANCELLED; no final-record draft. |
| LocalVisitDate | `date` | No | - | India local visit day; UTC bounds must lie within that day. |
| ValidFromUtc | `datetime2(3)` | No | - | Inclusive visit start. |
| ValidUntilUtc | `datetime2(3)` | No | - | Exclusive visit end. |
| ApprovalDeadlineUtc | `datetime2(3)` | Yes | - | Last allowed host decision time, exclusive; absent for TEMP_ID. |
| SnapshotVersion | `int` | No | `(1)` | Immutable submitted content revision; one in v1. |
| SnapshotHash | `varbinary(32)` | No | - | Digest of canonical approval-relevant content, not raw secrets. |
| DecisionAtUtc | `datetime2(3)` | Yes | - | Automatic TEMP_ID approval or final host decision time. |
| CancelledAtUtc | `datetime2(3)` | Yes | - | Cancellation time; does not silently remove recorded presence. |
| SubmittedAtUtc | `datetime2(3)` | No | `(SYSUTCDATETIME())` | Server submission time. |
| PersonalDataPurgedAtUtc | `datetime2(3)` | Yes | - | Policy-driven deidentification; permitted only after active use. |
| RowVer | `rowversion` | No | - | Database concurrency token, never a timestamp or authorization proof. |

**Primary key:** VisitRequestId.

- Unique: PublicReference.
- Unique: IntakeId, ClientPersonKey.
- Unique: PhotoAssetId.
- Unique: VisitRequestId, LocationId.
- Unique: VisitRequestId, SnapshotVersion, SnapshotHash.
- Unique: VisitRequestId, EmployeeId, LocationId, RequestType, LocalVisitDate.
- FK: (IntakeId) -> RegistrationIntakes (IntakeId).
- FK: (PhotoAssetId, IntakeId) -> PhotoAssets (PhotoAssetId, IntakeId).
- FK: (EmployeeId) -> Employees (EmployeeId).
- FK: (HostEmployeeId) -> Employees (EmployeeId).
- FK: (LocationId) -> Locations (LocationId).
- FK: (ProjectLocationId, LocationId) -> ProjectLocations (ProjectLocationId, LocationId).
- Check: `Status IN ('PENDING','APPROVED','DENIED','CANCELLED')`.
- Check: `ValidUntilUtc > ValidFromUtc`.
- Check: `SnapshotVersion = 1`.
- Check: `LEN(LTRIM(RTRIM(PersonName))) > 0 AND LEN(LTRIM(RTRIM(Reason))) > 0`.
- Check: `(RequestType='TEMP_ID' AND EmployeeId IS NOT NULL AND PersonEmail IS NOT NULL AND ProjectLocationId IS NULL AND HostEmployeeId IS NULL AND TemporaryIdReason IN ('FORGOT','LOST','OTHER') AND TemporaryIdReason IS NOT NULL AND ApprovalDeadlineUtc IS NULL AND Status IN ('APPROVED','CANCELLED')) OR (RequestType='EMPLOYEE_PROJECT' AND EmployeeId IS NOT NULL AND PersonEmail IS NOT NULL AND ProjectLocationId IS NOT NULL AND HostEmployeeId IS NOT NULL AND TemporaryIdReason IS NULL AND ApprovalDeadlineUtc IS NOT NULL) OR (RequestType='EXTERNAL' AND EmployeeId IS NULL AND ProjectLocationId IS NOT NULL AND HostEmployeeId IS NOT NULL AND TemporaryIdReason IS NULL AND ApprovalDeadlineUtc IS NOT NULL)`.
- Check: `ApprovalDeadlineUtc IS NULL OR (ApprovalDeadlineUtc > SubmittedAtUtc AND ApprovalDeadlineUtc <= ValidUntilUtc)`.
- Check: `((Status IN ('APPROVED','DENIED')) AND DecisionAtUtc IS NOT NULL) OR (Status='PENDING' AND DecisionAtUtc IS NULL) OR Status='CANCELLED'`.
- Check: `(Status='CANCELLED' AND CancelledAtUtc IS NOT NULL) OR (Status<>'CANCELLED' AND CancelledAtUtc IS NULL)`.
- Check: `CONVERT(date,DATEADD(minute,330,ValidFromUtc)) = LocalVisitDate AND ValidUntilUtc <= DATEADD(minute,-330,DATEADD(day,1,CONVERT(datetime2(3),LocalVisitDate)))`.
- Check: `SnapshotHash IS NULL OR DATALENGTH(SnapshotHash) = 32`.
- Index: `CREATE INDEX IX_Visit_Project_Status ON gp.VisitRequests(ProjectLocationId, Status, LocalVisitDate) INCLUDE (LocationId, ValidFromUtc, ValidUntilUtc);`
- Index: `CREATE INDEX IX_Visit_Host ON gp.VisitRequests(HostEmployeeId, Status, SubmittedAtUtc DESC);`
- Index: `CREATE INDEX IX_Visit_Location ON gp.VisitRequests(LocationId, LocalVisitDate, Status);`
- Index: `CREATE INDEX IX_Visit_Employee ON gp.VisitRequests(EmployeeId, LocationId, LocalVisitDate) INCLUDE (RequestType, ProjectLocationId, Status, ValidFromUtc, ValidUntilUtc);`

## 15. gp.TemporaryIdSlots

One reusable TEMP_ID slot per employee/office/local day; retain visit history separately.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| EmployeeId | `nvarchar(64)` | No | - | Employee using this daily temporary-ID slot. |
| LocationId | `int` | No | - | Office of the temporary pass. |
| LocalVisitDate | `date` | No | - | Local day of entitlement. |
| RequestType | `varchar(24)` | No | `('TEMP_ID')` | Constant discriminator to enforce TEMP_ID target. |
| VisitRequestId | `uniqueidentifier` | No | - | Current request; replacement only under duplicate/reissue contract. |
| RowVer | `rowversion` | No | - | Database concurrency token, never a timestamp or authorization proof. |

**Primary key:** EmployeeId, LocationId, LocalVisitDate.

- Unique: VisitRequestId.
- FK: (VisitRequestId, EmployeeId, LocationId, RequestType, LocalVisitDate) -> VisitRequests (VisitRequestId, EmployeeId, LocationId, RequestType, LocalVisitDate).
- Check: `RequestType='TEMP_ID'`.

## 16. gp.IdempotencyRequests

Durable actor/operation/payload-bound retries; no bearer secrets in results.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| OperationId | `uniqueidentifier` | No | `(NEWSEQUENTIALID())` | Server idempotent operation identifier. |
| ActorBindingHash | `varbinary(32)` | No | - | Digest of trusted principal/intake identity and binding type. |
| OperationCode | `varchar(40)` | No | - | SUBMIT_INTAKE, DECIDE_VISIT, RECORD_MOVEMENT, REISSUE_PASS or PRINT_CARD. |
| ClientKey | `uniqueidentifier` | No | - | Client-generated stable retry key for this operation. |
| PayloadHash | `varbinary(32)` | No | - | Canonical resource/payload digest; mismatch is a conflict. |
| Status | `varchar(12)` | No | - | PROCESSING exists only inside a transaction; COMPLETED is durable. |
| ResultJson | `nvarchar(max)` | Yes | - | Authorized resource references and outcome only; never QR/link/session secrets. |
| CompletedAtUtc | `datetime2(3)` | Yes | - | Committed outcome time. |
| ExpiresAtUtc | `datetime2(3)` | No | - | Minimum retry retention deadline; business uniqueness survives cleanup. |
| CreatedAtUtc | `datetime2(3)` | No | `(SYSUTCDATETIME())` | Server creation timestamp in UTC. |

**Primary key:** OperationId.

- Unique: ActorBindingHash, OperationCode, ClientKey.
- Check: `(Status='PROCESSING' AND CompletedAtUtc IS NULL AND ResultJson IS NULL) OR (Status='COMPLETED' AND CompletedAtUtc IS NOT NULL AND ResultJson IS NOT NULL)`.
- Check: `ResultJson IS NULL OR ISJSON(ResultJson)=1`.
- Check: `ExpiresAtUtc > CreatedAtUtc`.
- Check: `ActorBindingHash IS NULL OR DATALENGTH(ActorBindingHash) = 32`.
- Check: `PayloadHash IS NULL OR DATALENGTH(PayloadHash) = 32`.

## 17. gp.ApprovalDecisions

One immutable host decision for one exact individual submitted snapshot.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| VisitRequestId | `uniqueidentifier` | No | - | Individual request; unique decision per request. |
| ApproverEmployeeId | `nvarchar(64)` | No | - | Verified assigned host; membership checked transactionally. |
| SnapshotVersion | `int` | No | - | Exact submitted content revision approved/denied. |
| SnapshotHash | `varbinary(32)` | No | - | Exact submitted content digest. |
| Decision | `varchar(12)` | No | - | APPROVED or DENIED. |
| DecisionSource | `varchar(12)` | No | - | OUTLOOK or WEB; both identify the real host. |
| OperationId | `uniqueidentifier` | No | - | Actor/operation-bound retry record. |
| Comment | `nvarchar(500)` | Yes | - | Optional host explanation. **Restricted.** |
| DecidedAtUtc | `datetime2(3)` | No | `(SYSUTCDATETIME())` | UTC decision time. |

**Primary key:** VisitRequestId.

- Unique: OperationId.
- FK: (VisitRequestId, SnapshotVersion, SnapshotHash) -> VisitRequests (VisitRequestId, SnapshotVersion, SnapshotHash).
- FK: (ApproverEmployeeId) -> Employees (EmployeeId).
- FK: (OperationId) -> IdempotencyRequests (OperationId).
- Check: `Decision IN ('APPROVED','DENIED')`.
- Check: `DecisionSource IN ('OUTLOOK','WEB')`.
- Check: `SnapshotHash IS NULL OR DATALENGTH(SnapshotHash) = 32`.

## 18. gp.AccessPasses

Versioned credential for one visit; validity/scope inherited from immutable visit.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| AccessPassId | `uniqueidentifier` | No | `(NEWSEQUENTIALID())` | Internal credential record identifier. |
| VisitRequestId | `uniqueidentifier` | No | - | Individual visit whose approval/scope is checked online. |
| PassVersion | `int` | No | - | Monotonic credential version within the visit. |
| PublicPassNumber | `varchar(50)` | No | - | Display reference, never the QR secret. |
| CredentialHash | `varbinary(32)` | No | - | Unique SHA-256 digest of 256-bit random QR credential. **Restricted.** |
| Status | `varchar(12)` | No | - | PENDING, ACTIVE, DENIED or REVOKED. |
| IsCurrent | `bit` | No | `(1)` | At most one current credential per visit. |
| RevokedAtUtc | `datetime2(3)` | Yes | - | Revocation time. |
| RevocationReason | `nvarchar(300)` | Yes | - | Audited revocation/reissue reason. |
| CreatedAtUtc | `datetime2(3)` | No | `(SYSUTCDATETIME())` | Server creation timestamp in UTC. |
| RowVer | `rowversion` | No | - | Database concurrency token, never a timestamp or authorization proof. |

**Primary key:** AccessPassId.

- Unique: VisitRequestId, PassVersion.
- Unique: PublicPassNumber.
- Unique: CredentialHash.
- Unique: AccessPassId, VisitRequestId.
- FK: (VisitRequestId) -> VisitRequests (VisitRequestId).
- Check: `PassVersion > 0`.
- Check: `Status IN ('PENDING','ACTIVE','DENIED','REVOKED')`.
- Check: `(Status='REVOKED' AND RevokedAtUtc IS NOT NULL AND RevocationReason IS NOT NULL) OR (Status<>'REVOKED' AND RevokedAtUtc IS NULL AND RevocationReason IS NULL)`.
- Check: `IsCurrent=1 OR Status='REVOKED'`.
- Check: `CredentialHash IS NULL OR DATALENGTH(CredentialHash) = 32`.
- Index: `CREATE UNIQUE INDEX UX_Pass_Current ON gp.AccessPasses(VisitRequestId) WHERE IsCurrent=1;`

## 19. gp.PassSecrets

Separately permissioned encrypted QR credential for authorized reprint/render only.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| AccessPassId | `uniqueidentifier` | No | - | Credential whose random secret is encrypted. |
| Ciphertext | `varbinary(max)` | No | - | Authenticated encrypted credential; no plaintext fallback. **Restricted.** |
| Nonce | `binary(12)` | No | - | Unique AES-GCM nonce for this key/encryption. |
| AuthenticationTag | `binary(16)` | No | - | AES-GCM authentication tag. |
| KeyVersion | `varchar(100)` | No | - | External key-store version identifier, never the key. |
| CreatedAtUtc | `datetime2(3)` | No | `(SYSUTCDATETIME())` | Server creation timestamp in UTC. |

**Primary key:** AccessPassId.

- Unique: KeyVersion, Nonce.
- FK: (AccessPassId) -> AccessPasses (AccessPassId).
- Check: `DATALENGTH(Ciphertext) BETWEEN 1 AND 4096`.

## 20. gp.VisitPresence

Current INSIDE/OUTSIDE state of one individual visit, preserved across pass versions.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| VisitRequestId | `uniqueidentifier` | No | - | Individual visit; state is not globally unique person identity. |
| IsInside | `bit` | No | `(0)` | Current recorded occupancy state. |
| LastAccessEventId | `bigint` | Yes | - | Last event for this same visit; composite FK prevents cross-visitor linkage. |
| LastMovementAtUtc | `datetime2(3)` | Yes | - | Effective time of last movement. |
| RowVer | `rowversion` | No | - | Database concurrency token, never a timestamp or authorization proof. |

**Primary key:** VisitRequestId.

- FK: (VisitRequestId) -> VisitRequests (VisitRequestId).
- FK: (LastAccessEventId, VisitRequestId) -> AccessEvents (AccessEventId, VisitRequestId).
- Check: `(LastAccessEventId IS NULL AND LastMovementAtUtc IS NULL AND IsInside=0) OR (LastAccessEventId IS NOT NULL AND LastMovementAtUtc IS NOT NULL)`.
- Index: `CREATE INDEX IX_Presence_Inside ON gp.VisitPresence(VisitRequestId) INCLUDE (LastMovementAtUtc) WHERE IsInside=1;`

## 21. gp.AccessEvents

Immutable committed individual ENTRY/EXIT; scan verification is recorded separately.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| AccessEventId | `bigint IDENTITY(1,1)` | No | - | Append-only movement sequence. |
| VisitRequestId | `uniqueidentifier` | No | - | Individual visit whose presence changes. |
| AccessPassId | `uniqueidentifier` | No | - | Credential associated with this same visit; may be historical on reconciled EXIT. |
| ActorUserId | `uniqueidentifier` | No | - | Authorized staff recording movement; never an arbitrary client-provided identity. |
| LocationId | `int` | No | - | Must equal the visit location; project scope derived from visit. |
| EventType | `varchar(8)` | No | - | ENTRY or EXIT. |
| EntryMethod | `varchar(12)` | No | - | SCAN, MANUAL or RECONCILE. |
| OperationId | `uniqueidentifier` | No | - | Unique durable idempotent movement operation. |
| OccurredAtUtc | `datetime2(3)` | No | - | Effective departure/entry time; normally server now. |
| RecordedAtUtc | `datetime2(3)` | No | `(SYSUTCDATETIME())` | Server recording time; never silently backdated. |
| ReconciliationReason | `nvarchar(500)` | Yes | - | Required for supervised reconciliation only. |
| CorrelationId | `uniqueidentifier` | Yes | - | Trace correlation, not authorization. |

**Primary key:** AccessEventId.

- Unique: AccessEventId, VisitRequestId.
- Unique: OperationId.
- FK: (AccessPassId, VisitRequestId) -> AccessPasses (AccessPassId, VisitRequestId).
- FK: (VisitRequestId, LocationId) -> VisitRequests (VisitRequestId, LocationId).
- FK: (ActorUserId) -> Users (UserId).
- FK: (OperationId) -> IdempotencyRequests (OperationId).
- Check: `EventType IN ('ENTRY','EXIT')`.
- Check: `OccurredAtUtc <= RecordedAtUtc`.
- Check: `(EntryMethod IN ('SCAN','MANUAL') AND ReconciliationReason IS NULL) OR (EntryMethod='RECONCILE' AND ReconciliationReason IS NOT NULL AND EventType='EXIT')`.
- Index: `CREATE INDEX IX_Movement_Visit ON gp.AccessEvents(VisitRequestId, AccessEventId DESC);`
- Index: `CREATE INDEX IX_Movement_Location ON gp.AccessEvents(LocationId, RecordedAtUtc DESC);`

## 22. gp.PassScanAttempts

Verification outcomes; no implicit physical entry and no raw unknown credentials.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| ScanAttemptId | `bigint IDENTITY(1,1)` | No | - | Verification attempt sequence. |
| AccessPassId | `uniqueidentifier` | Yes | - | Known credential, or null for an unknown QR. |
| VisitRequestId | `uniqueidentifier` | Yes | - | Known credential owner; must pair with AccessPassId. |
| ActorUserId | `uniqueidentifier` | No | - | Authenticated authorized scanner. |
| LocationId | `int` | No | - | Scanner operating location, which may differ from the scanned pass location. |
| OutcomeCode | `varchar(32)` | No | - | Allowlisted verification result; does not authorize a later movement. |
| OccurredAtUtc | `datetime2(3)` | No | `(SYSUTCDATETIME())` | Server verification timestamp. |
| CorrelationId | `uniqueidentifier` | Yes | - | Trace identifier. |

**Primary key:** ScanAttemptId.

- FK: (AccessPassId, VisitRequestId) -> AccessPasses (AccessPassId, VisitRequestId).
- FK: (ActorUserId) -> Users (UserId).
- FK: (LocationId) -> Locations (LocationId).
- Check: `(AccessPassId IS NULL AND VisitRequestId IS NULL) OR (AccessPassId IS NOT NULL AND VisitRequestId IS NOT NULL)`.
- Check: `OutcomeCode IN ('VALID','PENDING','DENIED','EXPIRED','REVOKED','NOT_FOUND','WRONG_PROJECT','WRONG_LOCATION','NOT_YET_VALID','NOT_AUTHORIZED','CANCELLED','ERROR')`.
- Index: `CREATE INDEX IX_Scan_Actor ON gp.PassScanAttempts(ActorUserId, OccurredAtUtc DESC);`

## 23. gp.PassDeliveryLinks

Separate revocable bearer token for holder-specific viewing; encrypted recovery for dispatch.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| DeliveryLinkId | `uniqueidentifier` | No | `(NEWSEQUENTIALID())` | Private delivery-link record ID. |
| AccessPassId | `uniqueidentifier` | No | - | One specific pass version; reissue revokes its old links. |
| VisitRequestId | `uniqueidentifier` | No | - | Same individual visit as the linked pass; prevents cross-visitor mail linkage. |
| TokenHash | `varbinary(32)` | No | - | Digest of random delivery bearer token; distinct from QR. **Restricted.** |
| TokenCiphertext | `varbinary(max)` | No | - | Encrypted random delivery token for retryable mail dispatch. **Restricted.** |
| Nonce | `binary(12)` | No | - | Unique nonce under the delivery-token key. |
| AuthenticationTag | `binary(16)` | No | - | Authenticated encryption tag. |
| KeyVersion | `varchar(100)` | No | - | External delivery-token key version; separate purpose from QR encryption. |
| RecipientEmail | `nvarchar(320)` | No | - | Approved individual recipient; corporate address for employees. **Restricted.** |
| ExpiresAtUtc | `datetime2(3)` | No | - | Exclusive link expiry; service limits to pass/visit policy. |
| RevokedAtUtc | `datetime2(3)` | Yes | - | Explicit invalidation time. |
| LastUsedAtUtc | `datetime2(3)` | Yes | - | Last authorized holder-view use. |
| CreatedAtUtc | `datetime2(3)` | No | `(SYSUTCDATETIME())` | Server creation timestamp in UTC. |

**Primary key:** DeliveryLinkId.

- Unique: TokenHash.
- Unique: KeyVersion, Nonce.
- Unique: DeliveryLinkId, VisitRequestId.
- FK: (AccessPassId, VisitRequestId) -> AccessPasses (AccessPassId, VisitRequestId).
- Check: `ExpiresAtUtc > CreatedAtUtc`.
- Check: `DATALENGTH(TokenCiphertext) BETWEEN 1 AND 4096`.
- Check: `TokenHash IS NULL OR DATALENGTH(TokenHash) = 32`.

## 24. gp.PassPrintJobs

Individual card rendering/dispatch audit; not proof that paper physically printed.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| PrintJobId | `uniqueidentifier` | No | `(NEWSEQUENTIALID())` | Unique card-render/print request. |
| AccessPassId | `uniqueidentifier` | No | - | Credential printed; reprint preserves QR. |
| VisitRequestId | `uniqueidentifier` | No | - | Credential visit for relational consistency. |
| LocationId | `int` | No | - | Must equal visit location; reception scope checked server-side. |
| RequestedByUserId | `uniqueidentifier` | No | - | Authorized reception principal. |
| OperationId | `uniqueidentifier` | No | - | Durable retry key; retries return same job, not an automatic extra dispatch. |
| PrintReason | `varchar(12)` | No | - | FIRST, REPRINT or REISSUE. |
| Status | `varchar(12)` | No | - | REQUESTED, RENDERED, DISPATCHED or FAILED. |
| PrinterLabel | `nvarchar(100)` | Yes | - | Configured reception printer label. |
| UpdatedAtUtc | `datetime2(3)` | No | `(SYSUTCDATETIME())` | Latest job-state change. |
| CreatedAtUtc | `datetime2(3)` | No | `(SYSUTCDATETIME())` | Server creation timestamp in UTC. |

**Primary key:** PrintJobId.

- Unique: OperationId.
- FK: (AccessPassId, VisitRequestId) -> AccessPasses (AccessPassId, VisitRequestId).
- FK: (VisitRequestId, LocationId) -> VisitRequests (VisitRequestId, LocationId).
- FK: (RequestedByUserId) -> Users (UserId).
- FK: (OperationId) -> IdempotencyRequests (OperationId).
- Check: `PrintReason IN ('FIRST','REPRINT','REISSUE')`.
- Check: `Status IN ('REQUESTED','RENDERED','DISPATCHED','FAILED')`.
- Check: `UpdatedAtUtc >= CreatedAtUtc`.

## 25. gp.NotificationOutbox

Transactional, leased and retryable dispatch with encrypted secrets referenced by ID.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| NotificationId | `bigint IDENTITY(1,1)` | No | - | Worker job identifier. |
| VisitRequestId | `uniqueidentifier` | Yes | - | Individual visit; optional for system-only notifications. |
| DeliveryLinkId | `uniqueidentifier` | Yes | - | Optional protected link reference; no plaintext token in JSON. |
| RecipientKind | `varchar(12)` | No | - | EMAIL, EMPLOYEE or MANAGER; manager resolution must not block temporary pass issuance. |
| RecipientEmployeeId | `nvarchar(64)` | Yes | - | Employee recipient, or subject employee whose manager must be resolved. |
| RecipientEmail | `nvarchar(320)` | Yes | - | Direct/resolved trusted recipient; nullable while directory contact resolution is pending. **Restricted.** |
| TemplateCode | `varchar(40)` | No | - | Allowlisted template identifier. |
| PayloadJson | `nvarchar(max)` | No | - | Minimal template data/references; no raw bearer/session secrets. **Restricted.** |
| DedupeHash | `varbinary(32)` | No | - | Unique business-event/template/recipient digest. |
| Status | `varchar(12)` | No | `('PENDING')` | PENDING, PROCESSING, SENT, DEAD or CANCELLED. |
| AttemptCount | `int` | No | `(0)` | Dispatch attempts so far. |
| MaxAttempts | `int` | No | `(8)` | Configured finite retry ceiling. |
| NextAttemptAtUtc | `datetime2(3)` | No | `(SYSUTCDATETIME())` | Earliest retry time. |
| LockedBy | `uniqueidentifier` | Yes | - | Worker lease owner while PROCESSING. |
| LockedUntilUtc | `datetime2(3)` | Yes | - | Lease expiry; abandoned work is reclaimable. |
| LastErrorCode | `varchar(100)` | Yes | - | Redacted diagnostic code, not a provider response with secrets. |
| SentAtUtc | `datetime2(3)` | Yes | - | Provider accepted dispatch time; not guaranteed inbox delivery. |
| ProviderMessageId | `nvarchar(200)` | Yes | - | Provider receipt identifier if available. |
| CreatedAtUtc | `datetime2(3)` | No | `(SYSUTCDATETIME())` | Server creation timestamp in UTC. |
| RowVer | `rowversion` | No | - | Database concurrency token, never a timestamp or authorization proof. |

**Primary key:** NotificationId.

- Unique: DedupeHash.
- FK: (VisitRequestId) -> VisitRequests (VisitRequestId).
- FK: (DeliveryLinkId, VisitRequestId) -> PassDeliveryLinks (DeliveryLinkId, VisitRequestId).
- FK: (RecipientEmployeeId) -> Employees (EmployeeId).
- Check: `Status IN ('PENDING','PROCESSING','SENT','DEAD','CANCELLED')`.
- Check: `AttemptCount >= 0 AND MaxAttempts BETWEEN 1 AND 100`.
- Check: `(Status='PROCESSING' AND LockedBy IS NOT NULL AND LockedUntilUtc IS NOT NULL) OR (Status<>'PROCESSING' AND LockedBy IS NULL AND LockedUntilUtc IS NULL)`.
- Check: `(Status='SENT' AND SentAtUtc IS NOT NULL) OR (Status<>'SENT' AND SentAtUtc IS NULL)`.
- Check: `ISJSON(PayloadJson)=1`.
- Check: `DeliveryLinkId IS NULL OR VisitRequestId IS NOT NULL`.
- Check: `(RecipientKind='EMAIL' AND RecipientEmail IS NOT NULL AND RecipientEmployeeId IS NULL) OR (RecipientKind IN ('EMPLOYEE','MANAGER') AND RecipientEmployeeId IS NOT NULL)`.
- Check: `DedupeHash IS NULL OR DATALENGTH(DedupeHash) = 32`.
- Index: `CREATE INDEX IX_Outbox_Due ON gp.NotificationOutbox(Status, NextAttemptAtUtc) INCLUDE (AttemptCount, MaxAttempts, LockedUntilUtc);`

## 26. gp.SecurityAuditEvents

Append-only application audit; independent protected export required for tamper resistance.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| AuditEventId | `bigint IDENTITY(1,1)` | No | - | Immutable audit sequence. |
| ActorUserId | `uniqueidentifier` | Yes | - | Authenticated actor, null for system/public actor. |
| ActionCode | `varchar(80)` | No | - | Allowlisted security/business action. |
| TargetType | `varchar(50)` | No | - | Target entity kind. |
| TargetReference | `varchar(100)` | Yes | - | Non-secret internal target reference. |
| LocationId | `int` | Yes | - | Location scope when known. |
| ProjectLocationId | `bigint` | Yes | - | Project-office scope; requires matching LocationId. |
| ResultCode | `varchar(12)` | No | - | SUCCESS, DENIED or ERROR. |
| MetadataJson | `nvarchar(max)` | Yes | - | Allowlisted minimal audit metadata; no raw tokens/photo content. **Restricted.** |
| CorrelationId | `uniqueidentifier` | Yes | - | Operation trace identifier. |
| OccurredAtUtc | `datetime2(3)` | No | `(SYSUTCDATETIME())` | Server recording time. |

**Primary key:** AuditEventId.

- FK: (ActorUserId) -> Users (UserId).
- FK: (LocationId) -> Locations (LocationId).
- FK: (ProjectLocationId, LocationId) -> ProjectLocations (ProjectLocationId, LocationId).
- Check: `ResultCode IN ('SUCCESS','DENIED','ERROR')`.
- Check: `MetadataJson IS NULL OR ISJSON(MetadataJson)=1`.
- Check: `ProjectLocationId IS NULL OR LocationId IS NOT NULL`.
- Index: `CREATE INDEX IX_Audit_Time ON gp.SecurityAuditEvents(OccurredAtUtc DESC);`
- Index: `CREATE INDEX IX_Audit_Scope ON gp.SecurityAuditEvents(LocationId, ProjectLocationId, OccurredAtUtc DESC);`

## 27. gp.Sessions

Revocable server-side staff sessions; browser holds only opaque secure-cookie ID.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| SessionHash | `varbinary(32)` | No | - | SHA-256 digest of random session credential. **Restricted.** |
| UserId | `uniqueidentifier` | No | - | Authenticated owner. |
| CsrfHash | `varbinary(32)` | No | - | Digest used to validate session-bound mutation protection. **Restricted.** |
| AuthorizationVersionAtIssue | `bigint` | No | - | Reference version; current authorization is always re-evaluated. |
| LastSeenAtUtc | `datetime2(3)` | No | - | Most recent accepted activity. |
| IdleExpiresAtUtc | `datetime2(3)` | No | - | Server-enforced idle deadline. |
| AbsoluteExpiresAtUtc | `datetime2(3)` | No | - | Non-extendable session deadline. |
| RevokedAtUtc | `datetime2(3)` | Yes | - | Explicit logout/account/session invalidation. |
| CreatedAtUtc | `datetime2(3)` | No | `(SYSUTCDATETIME())` | Server creation timestamp in UTC. |

**Primary key:** SessionHash.

- FK: (UserId) -> Users (UserId).
- Check: `AuthorizationVersionAtIssue > 0`.
- Check: `LastSeenAtUtc >= CreatedAtUtc AND IdleExpiresAtUtc > LastSeenAtUtc AND AbsoluteExpiresAtUtc >= IdleExpiresAtUtc`.
- Check: `SessionHash IS NULL OR DATALENGTH(SessionHash) = 32`.
- Check: `CsrfHash IS NULL OR DATALENGTH(CsrfHash) = 32`.
- Index: `CREATE INDEX IX_Session_User ON gp.Sessions(UserId, RevokedAtUtc, AbsoluteExpiresAtUtc);`

## 28. gp.GuardCredentials

Individual local guard login identity and adaptive password hash, separate from employee SSO/directory.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| UserId | `uniqueidentifier` | No | - | One guard application user; credential provisioning grants no roles. |
| LoginId | `varchar(64)` | No | - | Unique lowercase ASCII login ID; password normalization is never inferred from this. **Restricted.** |
| EncodedPasswordHash | `varchar(128)` | Yes | - | Salted Argon2id PHC string; NULL while awaiting controlled setup/reset. Auth service only. **Restricted.** |
| CredentialVersion | `bigint` | No | `(1)` | Generation fencing for verification/reset; increment on credential mutation. |
| IsEnabled | `bit` | No | `(1)` | Credential enabled independently of global user state; both must permit authentication. |
| MustChangePassword | `bit` | No | `(1)` | Setup/reset required; no ordinary login until password setup completes. |
| FailedCount | `int` | No | `(0)` | Completed failed checks in the current window; five triggers temporary lockout. |
| FailureWindowStartUtc | `datetime2(3)` | Yes | - | Start of the provisional 15-minute failure window. |
| LockedUntilUtc | `datetime2(3)` | Yes | - | Temporary lockout; checked again at login completion. |
| PasswordChangedAtUtc | `datetime2(3)` | Yes | - | Last password setup/change time; NULL when the password is cleared for setup. |
| CreatedAtUtc | `datetime2(3)` | No | `(SYSUTCDATETIME())` | Credential record creation timestamp. |
| RowVer | `rowversion` | No | - | Database concurrency version. |

**Primary key:** UserId.

- Unique: LoginId.
- FK: (UserId) -> Users (UserId).
- Check: `DATALENGTH(LoginId) BETWEEN 3 AND 64 AND DATALENGTH(LoginId)=LEN(LoginId) AND LoginId NOT LIKE '%[^a-z0-9._-]%' AND LoginId NOT LIKE '[^a-z0-9]%'`.
- Check: `CredentialVersion>0`.
- Check: `FailedCount BETWEEN 0 AND 5`.
- Check: `(EncodedPasswordHash IS NULL AND MustChangePassword=1 AND PasswordChangedAtUtc IS NULL) OR (EncodedPasswordHash IS NOT NULL AND MustChangePassword=0 AND PasswordChangedAtUtc IS NOT NULL)`.

## 29. gp.GuardSetupTickets

Single-use expiring setup/reset handles; raw handles remain outside SQL/logs.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| TokenHash | `varbinary(32)` | No | - | SHA-256 of the random 32-byte setup handle; not a password hash. **Restricted.** |
| UserId | `uniqueidentifier` | No | - | Target guard credential. |
| CredentialVersion | `bigint` | No | - | Credential generation to which this setup handle is bound. |
| CreatedByUserId | `uniqueidentifier` | No | - | Scoped administrator that issued setup/reset. |
| CreatedAtUtc | `datetime2(3)` | No | - | Handle issue timestamp. |
| ExpiresAtUtc | `datetime2(3)` | No | - | Exclusive 15-minute expiry. |
| UsedAtUtc | `datetime2(3)` | Yes | - | Consumed or invalidated timestamp. |

**Primary key:** TokenHash.

- FK: (UserId) -> GuardCredentials (UserId).
- FK: (CreatedByUserId) -> Users (UserId).
- Check: `DATALENGTH(TokenHash) = 32`.
- Check: `CredentialVersion>0`.
- Check: `ExpiresAtUtc>CreatedAtUtc AND (UsedAtUtc IS NULL OR UsedAtUtc>=CreatedAtUtc)`.
- Index: `CREATE INDEX IX_GuardSetup_User ON gp.GuardSetupTickets(UserId,ExpiresAtUtc);`

## 30. gp.GuardLoginAttempts

Short-lived server-only password verification reservations, fenced to account and authorization generations.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| AttemptHash | `varbinary(32)` | No | - | SHA-256 of a random server-only verification handle. **Restricted.** |
| UserId | `uniqueidentifier` | No | - | Target guard identity. |
| SourceHash | `varbinary(32)` | No | - | Trusted server-derived keyed source bucket; never a browser-provided identity. **Restricted.** |
| CredentialVersion | `bigint` | No | - | Password generation captured before expensive verification. |
| AuthorizationVersion | `bigint` | No | - | Authorization generation captured before expensive verification. |
| CreatedAtUtc | `datetime2(3)` | No | - | Verification reservation timestamp. |
| ExpiresAtUtc | `datetime2(3)` | No | - | Exclusive 60-second completion deadline. |
| UsedAtUtc | `datetime2(3)` | Yes | - | Single-use completion timestamp, including denied completion. |

**Primary key:** AttemptHash.

- FK: (UserId) -> GuardCredentials (UserId).
- Check: `DATALENGTH(AttemptHash) = 32 AND DATALENGTH(SourceHash) = 32`.
- Check: `CredentialVersion>0 AND AuthorizationVersion>0`.
- Check: `ExpiresAtUtc>CreatedAtUtc AND (UsedAtUtc IS NULL OR UsedAtUtc>=CreatedAtUtc)`.
- Index: `CREATE INDEX IX_GuardLogin_User ON gp.GuardLoginAttempts(UserId,ExpiresAtUtc) INCLUDE (UsedAtUtc);`
- Index: `CREATE INDEX IX_GuardLogin_Expiry ON gp.GuardLoginAttempts(ExpiresAtUtc);`

## 31. gp.GuardAuthSources

Short-lived source throttling buckets, including unknown account attempts; no raw network address or login identifier.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| SourceHash | `varbinary(32)` | No | - | Trusted server-derived keyed source bucket digest. **Restricted.** |
| WindowStartUtc | `datetime2(3)` | No | - | Current 60-second admission window. |
| RequestCount | `int` | No | - | Admitted attempts, bounded to twenty per window. |
| LastSeenAtUtc | `datetime2(3)` | No | - | Last admitted request; transient cleanup anchor. |

**Primary key:** SourceHash.

- Check: `DATALENGTH(SourceHash) = 32`.
- Check: `RequestCount BETWEEN 1 AND 20`.
- Check: `LastSeenAtUtc>=WindowStartUtc`.
- Index: `CREATE INDEX IX_GuardAuthSources_Seen ON gp.GuardAuthSources(LastSeenAtUtc);`

## 32. gp.RegistrationIntakeAccess

Owned intake CSRF binding and immutable submission receipt; registration correlation only, no operational group state.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| IntakeId | `uniqueidentifier` | No | - | One intake capability/receipt record linked to RegistrationIntakes. |
| CsrfHash | `varbinary(32)` | No | - | SHA-256 of a separate random intake CSRF value; both it and the intake token are required. **Restricted.** |
| SubmittedPayloadHash | `varbinary(32)` | Yes | - | Versioned canonical business payload digest; immutable once the intake submits, independent of encryption retries. **Restricted.** |
| SubmissionResultJson | `nvarchar(max)` | Yes | - | Resource references and initial outcomes only; no QR/password/key/contact material. Supports retries after idempotency retention. **Restricted.** |
| CreatedAtUtc | `datetime2(3)` | No | `(SYSUTCDATETIME())` | UTC creation time of this intake binding. |

**Primary key:** IntakeId.

- FK: (IntakeId) -> RegistrationIntakes (IntakeId).
- Check: `DATALENGTH(CsrfHash) = 32 AND (SubmittedPayloadHash IS NULL OR DATALENGTH(SubmittedPayloadHash) = 32)`.
- Check: `(SubmittedPayloadHash IS NULL AND SubmissionResultJson IS NULL) OR (SubmittedPayloadHash IS NOT NULL AND SubmissionResultJson IS NOT NULL AND ISJSON(SubmissionResultJson)=1)`.

## 33. gp.PassPrintRenderState

Restricted render fencing, source binding and artifact digest for one reception print job; no rendered card or plaintext credential storage.

| Column | SQL type | Nullable | Default | Meaning |
|---|---|---|---|---|
| PrintJobId | `uniqueidentifier` | No | - | One-to-one link to the existing individual print job. |
| ClaimToken | `uniqueidentifier` | Yes | - | Fresh internal renderer fencing token; never returned by the general API. **Restricted.** |
| LeaseUntilUtc | `datetime2(3)` | Yes | - | UTC exclusive upper bound on the current claim and handoff; 60 seconds per attempt. |
| AttemptCount | `int` | No | `(0)` | Bounded render claims, at most three; retries of one live claim do not increment. |
| SourceVisitStatus | `varchar(12)` | Yes | - | Pending/approved status bound to the claim so decisions during rendering invalidate stale content. |
| SourceSnapshotHash | `varbinary(32)` | Yes | - | Exact immutable visit snapshot digest bound to the render claim. **Restricted.** |
| SourcePhotoHash | `varbinary(32)` | Yes | - | Exact photo content digest bound to the render claim. **Restricted.** |
| ArtifactDigest | `varbinary(32)` | Yes | - | SHA-256 of renderer-produced SVG bytes; does not prove paper output. **Restricted.** |
| FailureCode | `varchar(40)` | Yes | - | Controlled redacted failure category; no provider text, credentials or private paths. |
| CreatedAtUtc | `datetime2(3)` | No | `(SYSUTCDATETIME())` | UTC creation time of this print-render state. |
| SourceCardDataHash | `varbinary(32)` | Yes | - | SHA-256 binding of trusted printable employee/host identity, purpose and current assigned-project summary. Rechecked at render completion and dispatch; not an authorization token. **Restricted.** |

**Primary key:** PrintJobId.

- FK: (PrintJobId) -> PassPrintJobs (PrintJobId).
- Check: `(ClaimToken IS NULL AND LeaseUntilUtc IS NULL) OR (ClaimToken IS NOT NULL AND LeaseUntilUtc IS NOT NULL)`.
- Check: `AttemptCount BETWEEN 0 AND 3`.
- Check: `(SourceVisitStatus IS NULL AND SourceSnapshotHash IS NULL AND SourcePhotoHash IS NULL) OR
        (SourceVisitStatus IS NOT NULL AND SourceVisitStatus IN('PENDING','APPROVED') AND SourceSnapshotHash IS NOT NULL AND DATALENGTH(SourceSnapshotHash)=32 AND SourcePhotoHash IS NOT NULL AND DATALENGTH(SourcePhotoHash)=32)`.
- Check: `ArtifactDigest IS NULL OR DATALENGTH(ArtifactDigest)=32`.
- Check: `FailureCode IS NULL OR FailureCode IN('RENDER_FAILED','STORAGE_UNAVAILABLE','KEY_UNAVAILABLE','STALE_CREDENTIAL','ATTEMPTS_EXHAUSTED')`.
- Check: `SourceCardDataHash IS NULL OR DATALENGTH(SourceCardDataHash)=32`.
