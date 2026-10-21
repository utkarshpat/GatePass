# 01 - Domain and design decisions

Version: 1.2 | Date: 20 October 2026

## 01. Scope and source of truth

Design authority comes from the user's confirmed behavior and verified upstream identity/directory contracts. An old HLD, table layout or ER diagram can be incorrect or outdated. We reason from invariants and failure cases, implement them in schema plus transactions, and then draw the diagrams to explain the result. SQL is authored/reviewed directly; no Python/entity model generates the database. Once applied and verified, the actual SQL Server catalog is the authoritative implementation schema and backend models/repositories follow it. The manifest is derived from reviewed SQL and links scoped live-catalog verification; it does not replace the actual catalog. Keeping derived dictionary/diagrams consistent is an artifact-quality check, not proof that the underlying design is correct.

Local execution update: migrations 001/002 and 18 constraint scenarios passed on the user-installed Express engine. `database/validation/live-catalog.json` is the captured actual schema; `live-comparison-report.json` records 1,311 scoped comparisons against the SQL-derived documentation metadata. This does not prove service authorization, concurrency, CHECK expression equivalence or the other excluded comparison dimensions. Those remain explicit implementation/validation work.

Phase 02A separately adds applied migration 003 and 40 passing restricted-user transaction/security cases for host WEB decision, movement/reconciliation and scoped deallocation. The API will authenticate SSO/MFA and validate HTTP inputs; SQL resolves actors from validated session bindings and enforces supported mutations through individually granted procedures. No direct runtime table access is granted. This partial behavioral evidence does not expand the structural comparison's scope or certify the unimplemented flows; see document 07.

Current implementation update: 008/009 add registration/Digital ID SQL and internal backend contracts after the guard-auth block. Current physical structure is 32 tables, 286 columns and 57 FKs. Product/UI/API name is **Digital ID** (`DIGITAL_ID`); `TEMP_ID` and TemporaryIdSlots remain internal compatibility names. The current manifest is SQL-derived and links its fresh scoped live-catalog verification; diagrams remain explanatory baseline views. See [document 11](11_Registration_and_Digital_ID_Implementation.md).

India -> Location -> Project -> Assigned Guards. Chennai, Bengaluru, Noida and Pune are the reference offices. A project can operate at multiple offices. Physical floors, zones, checkpoints and access hardware are not part of this model.

The directory API owns employee code/name/corporate email/active state/manager and project membership, subject to its actual contract. Corporate SSO owns authenticated issuer/subject identity. The application owns requests, independent host decisions, passes, scoped role grants, guard allocations and movement history. Never infer corporate identity or membership from editable form/email-domain values.

EmployeeProjectMemberships is project-level because the agreed API's project assignments determine host eligibility. A guard's permissions are explicitly project-location-specific. These are separate relationships.

## 02. Registration grouping ends at submission

An intake is a short-lived, owned registration session. One form captures shared office/project/host/reason/time once and allows multiple individual photos/names/emails. The service copies the submitted common information into each independent VisitRequests snapshot in one transaction. IntakeId is retained only for traceability, ownership and retry correlation.

Example: a form registers A, B and C. It creates visits V-A, V-B and V-C, each with its own reference, decision, credential and presence row. Host approval of A does not approve B or C. Reception and guards see individual rows. No operational group status, group movement, group occupancy widget or group print unit is introduced.

VisitRequests now contains the person's snapshot directly. The old VisitParticipants table would become a mandatory 1:1 split after this clarification, so it is removed. The rule 'one person per final visit' is structural, not a mutable group-size setting. External visitor email and phone remain optional. Employee email must match the trusted directory at submission and cannot be changed by the user.

All submitted visits use an intake, including an employee's one-person form. A unique (IntakeId, ClientPersonKey) rejects duplicate person creation within the same submission; separate actor-bound idempotency handles HTTP retries. The intake submits only once. New people after submission use a fresh intake and independent approvals.

## 03. Three request types

| Type | Person identity | Scope | Decision |
|---|---|---|---|
| TEMP_ID | Corporate SSO + active trusted employee | One office; no project target | Automatic approval; manager notified |
| EMPLOYEE_PROJECT | Corporate SSO + active trusted employee | One active project-office pair | Assigned host's individual decision |
| EXTERNAL | Submitted name/photo; optional contact | One active project-office pair | Assigned host's individual decision |

Photos are captured at intake, normalized and held in private storage. No directory photo dependency, extra document-proofing, face recognition, lost-card integration or additional project-security approver is introduced.

## 04. Immutable approval content

Drafts live in intake/form ownership, not as partially authorized final visits. Final VisitRequests start PENDING, or APPROVED for TEMP_ID. Person, photo, host, purpose, destination and time are frozen on submission. In v1 SnapshotVersion is 1; material changes create a new individual request. Cancellation never silently removes an inside occupant.

SnapshotHash is SHA-256 of an explicitly versioned canonical representation containing request type, employee identity where applicable, person/contact snapshot, photo identifier/content digest, office/project target, host, reason and UTC bounds. No raw token belongs in that content. Its canonicalization will be implemented in the backend contract. ApprovalDecisions uses a composite FK to the exact request/version/hash, with one decision per individual visit. Ordinary rowversion is only an optimistic-concurrency token.

Approval authority is evaluated at decision time. Removing a host from a project blocks pending decisions; it does not rewrite historical approvals. Project deactivation or explicit visit/pass cancellation/revocation blocks new entry. Disabling an internal employee also blocks their new entry. Document any future change to those policies explicitly.

## 05. Time and presence semantics

Store datetime2(3) in UTC. Use [ValidFromUtc, ValidUntilUtc): entry at exactly the end time is expired. V1 requests fit one Asia/Kolkata calendar day; a midnight end bound may equal the next local day's start. The SQL check uses India's fixed +05:30 offset for this four-office scope. A future multi-time-zone or multi-day policy requires a reviewed migration/contract change.

Presence belongs to the individual visit, survives credential reissue and is not a global biometric/person identity. Two different visits for one employee do not automatically become one physical-person presence. TemporaryIdSlots prevents parallel daily TEMP_ID requests at an office; employee project overlap prevention is a serialized service rule. Valid visits to different projects remain possible.

Project occupancy counts visitor visits in that project. A location-wide employee headcount must deduplicate known EmployeeId where appropriate and remain distinct from project totals. External headcount accuracy depends on submitted identities and guard discipline; do not add identity-document collection solely for deduplication.

Scan verification is an observation, not a movement. ENTRY and EXIT are explicit, separately authorized transactions. Exit remains recordable after expiry/revocation/reissue through a reasoned, authorized reconciliation path. No automatic offline entry, silent backdating, bulk group entry/exit or automatic midnight checkout.

## 06. QR, reprint and delivery material

QR credentials are static, independent 256-bit random values generated by a maintained CSPRNG. Public display references are not QR secrets and cannot authorize retrieval or entry. Online verification uses CredentialHash. AccessPasses has one current version per visit; revocation and derived expiry are independent checks.

Reprinting requires recovery of the same random credential. PassSecrets therefore stores authenticated encrypted credential bytes with nonce, tag and external KeyVersion, separate from verification metadata. Use maintained AES-256-GCM implementation, unique nonce per key, and associated data binding record ID, purpose and envelope version. The database stores neither the encryption key nor a plaintext fallback. Decryption permission belongs only to authorized render/delivery operations. SQL/TDE/disk encryption do not replace this boundary.

This explicitly changes the old hash-only-at-rest rule. PassDeliveryLinks similarly uses a separate random bearer token, hash and protected recovery material so a worker can dispatch/retry later. QR and delivery encryption use separate purpose-specific keys/versions; do not reuse nonces under a key. Application key management and recovery must be verified in Phase 02/03.

Reprint preserves the QR; reissue atomically revokes the old credential and its delivery links, creates a new current version and preserves VisitPresence. A rendered card contains a credential and is restricted data. Do not save it in a public static path, ordinary logs or unauthenticated shared browser storage.

## 07. Authorization data and history

A StaffRoleGrant identifies one role and one scope. GrantCapabilities explicitly states what that grant allows: an INDIA_ADMIN role label alone is not write access. Project guards need both an effective location GUARD capability and an active exact GuardAssignment. TEMP_ID_MOVEMENT is an explicit location capability for designated guards.

Allocations use effective intervals plus deallocation history, without a time-dependent IsActive filtered unique index. Authorized allocation transactions reject overlapping non-deallocated intervals. An expired interval does not block a later assignment. Permission mutation increments Users.AuthorizationVersion and invalidates relevant live subscriptions; all later operations recheck current data.

Approval responsibility, printing, denied scans, role changes and movements are auditable. Normal application roles cannot edit or delete audit/movement/decision history. DBA/sysadmin control cannot be made tamper-proof inside one VM, so protected off-VM audit export remains required.

## 08. Outbox, sessions and retries

Workflow state and NotificationOutbox enqueue commit together. Each job has business dedupe, bounded retry and an expiring worker lease. Provider acceptance is not a guarantee of inbox delivery; after a crash duplicate email remains possible. Decision and pass/movement operations remain idempotent.

Outbox recipients may be direct EMAIL, trusted EMPLOYEE or MANAGER of a subject employee. A manager-contact resolution job can be queued without RecipientEmail; the worker resolves it through the trusted directory before sending. Missing manager contact produces visible retries/failure and never adds a manager approval or blocks a valid TEMP_ID issuance.

Sessions are server-side, opaque and revocable, with idle and absolute expiry. No corporate password or provider token is stored in this initial session model. If the final IAM library requires protected provider-token persistence, that is an explicit future migration, not plaintext ResultJson/PayloadJson.

Idempotency binds trusted actor/intake, operation code, client key and canonical target/payload digest. ResultJson contains resource references/outcomes only. Re-authenticate and re-authorize before returning a retry result. Expiry of an idempotency row cannot remove business uniqueness such as one daily TEMP_ID slot or one final decision.

## 09. Retention and physical separation

No cascading delete is defined. Photo bytes can be purged while a restricted metadata tombstone remains for referential integrity. Exact retention periods, any retained content digest and deidentification rules require organization policy. PersonalDataPurgedAtUtc records an exceptional retention transaction after outside/expiry checks; it is not permission for ordinary edits to approved content.

Remove expired delivery material in dependency order, clearing completed outbox link references when permitted. Purge PassSecrets when their defined reprint/recovery period ends. Export files, unfinished photos and backup retention follow explicit policy. SQL data files, backups, real photographs and secrets must not be stored in this OneDrive-synchronized source workspace.

## 10. Baseline and integration boundary

Migration 001 is a new-database v1.2 baseline, not an automatic upgrade from the old 20-table model. A populated legacy database would require a separately designed data migration; none has been performed.

Target SQL Server 2022+ syntax for the initial package. Actual production version/edition, gateway rules, directory contract, SSO identity mapping, manager resolution, encryption key store and Outlook tenant support remain integration inputs. The schema does not invent those values or seed privileged accounts.

Budget clarification: production target is SQL Server 2025 Express CU1 or later on one Ubuntu Server 24.04 LTS x86-64 private VM with the app, worker and private photo files. Windows is not required. The SQL source currently uses a 2022-compatible syntax subset; the actual validation target is the chosen Linux Express engine. Do not depend on SQL Server Agent, TDE or native backup encryption, which Express does not provide. Linux service/timer scheduling, protected volume/application material and encrypted off-VM backups need the Express-compatible operational implementation described in the phase plan.

Primary implementation references: [SQL application locks](https://learn.microsoft.com/en-us/sql/relational-databases/system-stored-procedures/sp-getapplock-transact-sql?view=sql-server-ver17), [unique indexes](https://learn.microsoft.com/en-us/sql/relational-databases/indexes/create-unique-indexes?view=sql-server-ver17), [cryptographic storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html).

## 11. Reasoning and alternatives

| Decision | Business invariant / failure case | Alternative considered |
|---|---|---|
| One person inside VisitRequests | Registration must not couple approval or movements afterward | Keeping an operational group request plus participant decisions adds an unnecessary second lifecycle for this scope |
| Separate intake correlation | One form can submit many independent visitors exactly once | Removing intake identity makes ownership, photo binding and batch retries harder |
| One current pass + retained versions | Lost-card replacement must invalidate old QR without losing occupancy/history | Overwriting one pass row loses credential/version traceability |
| VisitPresence separate from credential | Reissue while inside must not reset presence | Presence stored on a pass creates parallel inside states after replacement |
| Daily TEMP_ID slot | Employee rescan/double submission must not create parallel usable daily IDs | A participant-only unique pass rule does not detect two independent requests for the same employee |
| Interval-based guard allocation | Future/expired assignments should not create stale IsActive uniqueness blocks | One filtered active flag cannot express time overlap correctly without maintenance |
| Explicit scoped capabilities | Report visibility must not imply all administrative/movement powers | Role-name superuser checks grant more access than the business task requires |
| Protected recoverable credential | Reception must reprint the exact static QR after restart | A random token's one-way hash cannot reconstruct it; generating a new token is reissue, not reprint |
| Manager recipient resolution in outbox | Missing manager email must not add an approval gate or block issuance | Requiring a ready email string before recording notification work loses failed-resolution work |
| Separate entry and exit policy | Expired/revoked visitors already inside must be able to have departure recorded | Applying new-entry conditions to every exit strands occupancy records |

These choices are design decisions for the current scope, not fixed truths imposed by the ER diagrams. Revise with new requirements and measured database behavior using versioned migrations and updated contracts.

## 12. Development directory and guard authentication clarification

The user authorized an interchangeable mock/API directory boundary and synthetic employees/managers/projects/guards; real API mapping will be integrated later. The gateway follows the applied SQL model and does not generate schema or authenticate identities. Synthetic master data and its tested scope matrices are documented in [document 09](09_Development_Directory_and_Combinations.md).

Employees/hosts retain corporate SSO. Guards have individual application ID/password without SSO; credentials are not corporate directory records or SQL logins. Fixture issuer/subject strings express seed ownership only. Applied migrations 006/007 and the internal verifier implement password setup/reset, throttling and fenced sessions; [document 10](10_Guard_Login_Contract.md) records behavior/evidence and pending HTTP/browser gates. Schema is now 31 tables, 281 columns, 56 FKs, with 1,480 scoped comparisons passed. Session/movement authorization remains independent of authentication method.
