# 04 - Permissions and data access

Version: 1.2 | Rule: authenticated identity + explicit capability + matching resource scope + current state

## 01. Effective authorization

Employee/host identity comes from trusted SSO and directory resolution, not caller-supplied UserId/EmployeeId. Guards use individual ID/password without SSO; SQL/internal authentication is implemented in [document 10](10_Guard_Login_Contract.md), with HTTP/browser login pending. Staff operations require active user, live session, in-window unrevoked role, explicit capability and matching scope. Grant validity is [ValidFromUtc,ValidUntilUtc); a role name alone grants no permission.

| Grant scope | Resource match |
|---|---|
| INDIA | All four configured locations, only for specifically granted admin capabilities |
| LOCATION | Resource LocationId must equal grant LocationId |
| PROJECT | Resource's trusted ProjectLocation.ProjectId must equal grant ProjectId; covers that project's offices |
| PROJECT_LOCATION | Exact ProjectLocationId |

GUARD and RECEPTION grants are always location-scoped. Project admin may use PROJECT or PROJECT_LOCATION scope. Host eligibility requires the assigned host's current EmployeeOfficeMemberships and exact EmployeeProjectLocationMemberships at the destination, alongside current employee/project affiliation. Project-only membership never authorizes a different office. See migrations 048–052.

## 02. Role/capability allowlist

These are maximum eligible capabilities, not automatic grants. Actual provisioned rows must be a subset. The provisioning service validates this matrix; catalog foreign keys alone do not enforce role eligibility.

| Role | Eligible explicit capabilities | Extra conditions |
|---|---|---|
| GUARD | VISITS_READ, PROJECT_MOVEMENT, TEMP_ID_MOVEMENT, RECONCILE_EXIT | Project operations additionally require an active exact allocation. TEMP_ID_MOVEMENT and exceptional RECONCILE_EXIT are designated location permissions. |
| RECEPTION | VISITS_READ, PASS_PRINT, PASS_REISSUE | Reissue is separately delegated; no approval/movement override. |
| PROJECT_ADMIN | VISITS_READ, GUARDS_MANAGE, REPORTS_READ, REPORTS_EXPORT, AUDIT_READ | Project/project-location scope only. Cannot grant own role privileges. |
| LOCATION_ADMIN | VISITS_READ, GUARDS_MANAGE, GUARD_CREDENTIALS_MANAGE, REPORTS_READ, REPORTS_EXPORT, AUDIT_READ | One granted location; role administration remains separately controlled. |
| INDIA_ADMIN | VISITS_READ, GUARDS_MANAGE, GUARD_CREDENTIALS_MANAGE, REPORTS_READ, REPORTS_EXPORT, AUDIT_READ, ROLE_GRANTS_MANAGE | Explicit permissions only. ROLE_GRANTS_MANAGE does not allow self-escalation. |

User may hold multiple roles, but evaluate a complete qualifying grant for each action; do not combine the capability of one scope with the scope of an unrelated grant. No default 'admin bypass' branch. Higher admin visibility does not automatically authorize printing, approving or marking entry.

## 03. Per-action rules

| Action | Required actor/rule |
|---|---|
| Create TEMP_ID | Employee SSO identity, active trusted directory entry, current official email, owned intake and daily slot rule |
| Create employee project visit | Same identity rules plus valid active target pair and resolvable eligible host |
| Submit external people | Valid unexpired owned public intake, quotas, valid per-person photos, verified target/host through non-enumerating lookup |
| Own employee pass view | Current session, request.EmployeeId equals trusted caller employee; current pass/data policy |
| External pass view | Delivery token hash match, unexpired/unrevoked link for that exact current pass, permitted view fields only |
| Host detail/decision | Assigned host identity and fresh active project membership; submitted content/version; decision still pending and before deadline |
| Guard expected list/photo | VISITS_READ for location and active exact assignment for project visits; TEMP_ID views require designated TEMP_ID capability |
| Project scan/ENTRY/normal EXIT | GUARD role + PROJECT_MOVEMENT at request location + exact valid GuardAssignment; movement state rules also apply |
| TEMP_ID scan/ENTRY/normal EXIT | GUARD role + TEMP_ID_MOVEMENT at that location; never project access |
| Exceptional reconciled EXIT | GUARD role + RECONCILE_EXIT for occupant location, existing INSIDE state, explicit reason; no new entry privilege |
| Print/reprint | RECEPTION + PASS_PRINT at visit location; pending may render as PENDING, never as authorized entry |
| Cancel individual | Current trusted OWN employee or assigned HOST; exact pass and reason; preserve INSIDE until reasoned exit; no role-name bypass |
| Reissue | RECEPTION + PASS_REISSUE at visit location; no approval/time extension, all credential versions audited |
| Allocate/deallocate guard | Admin + GUARDS_MANAGE within target project/location; target guard must have a compatible location role; interval overlap check |
| Grant role/capability | India admin with ROLE_GRANTS_MANAGE; validated allowlist, no self-grant/escalation; controlled bootstrap separately |
| Read/export report | Matching explicit capability and data-level scope; export masking/throttling/audit; possession of a file ID is insufficient |
| Read audit | AUDIT_READ with matching target scope; system-wide unscoped audit only through specifically governed India-level access |

An actor can never choose another person's email for an employee pass. Merely knowing a host employee code, public reference, SQL ID, intake ID or QR display number does not grant directory/photo/approval access.

## 04. Permission revocation and concurrency

Grant/allocation/account/scope/membership mutations use the authorization lock protocol in document 05. Increment AuthorizationVersion for affected principals, commit the change and revoke/refresh affected live subscriptions. Session authentication does not freeze privileges. Subsequent outbound Socket.IO messages and every mutation are checked against current authorization.

Static PWA assets may be cached. Protected API/photo/card/export responses are no-store and excluded from service-worker caches. Logout/permission loss clears visible sensitive state; previously displayed information cannot be recalled from a user who saw it.

## 05. Database identities and privileges

Production provisioning will use distinct approved identities. Migrations 001/002 create no logins/bootstrap users. Migration 003 creates the unassigned `gp_api_runtime` role: schema SELECT/INSERT/UPDATE/DELETE/ALTER denied, EXECUTE individually granted only on DecideVisit, RecordMovement and DeallocateGuard. Private helpers have no runtime EXECUTE grant. Forty restricted-user cases verify this subset; remaining workflow/read/authentication boundaries are pending. See document 07. Worker boundaries were subsequently added by 004/005 below.

Phase 02B adds the unassigned `gp_worker_runtime` role with the same schema read/DML/ALTER denial and only four worker EXECUTE grants. It cannot approve, record movement, read sessions/QR material or invoke private helpers; the API role cannot claim worker jobs. Thirty-nine worker cases verify the lease/dispatch/retry subset. Actual worker identity/transport/key access and other read/render/retention roles remain pending; see document 08.

| Identity | Intended boundary |
|---|---|
| Migration identity | Versioned DDL/reference seeds under controlled release; not used by app |
| API identity | Only individually granted reviewed public procedures; no direct gp table reads/writes; no arbitrary ActorUserId authority |
| Worker identity | Only ClaimNotifications/GetNotificationDispatch/RenewNotificationLease/CompleteNotification; specific delivery-link references only; no direct table/QR secret access or approval/movement |
| Guard authentication verifier | Six auth/session procedures only under gp_guard_auth_runtime; trusted password attestation; no direct table access or movement/approval/admin capability |
| Render component identity | Recover credential material only for already-authorized rendering; use separately constrained service/identity if infrastructure supports it |
| Audit exporter | Append/export to independent protected sink; no privilege to rewrite application audit |
| Retention job identity | Specifically governed cleanup/deidentification operations; no arbitrary user-facing API |

Runtime cannot be db_owner, alter tables/constraints, impersonate users, change capability catalogs or update/delete immutable decision/movement/audit history. API permissions must exclude arbitrary PassSecrets reads/decryption paths. A database credential with unrestricted DML would bypass state rules. The Phase 02A role is implemented/tested for the three public procedures; provisioning actual identities and completing all other operational grants are still Phase 02 acceptance work. FK/CHECK constraints alone do not provide this boundary.

The corporate/private network boundary also restricts staff functions. Public gateway routes do not include generic guard/reception/admin access, direct SQL, directory listing or private storage. Network controls complement server authorization.

Phase 02C adds ManageGuardCredential to the API role, guarded by a current admin session/CSRF and GUARD_CREDENTIALS_MANAGE over every affected guard location. It adds bounded PurgeGuardAuthTransient to the worker role. The auth role has BeginGuardLogin/CompleteGuardLogin/InspectGuardSetup/CompleteGuardSetup/TouchGuardSession/RevokeGuardSession only. Direct reads/DML/ALTER remain denied. These additions supersede the earlier three/four public-operation counts above; the deployed inventory records current grants. No real role memberships are provisioned.

Phase 02D adds CreateRegistrationIntake, RecordRegistrationPhoto and SubmitRegistration to API, bringing its public grants to seven. Worker remains at five and guard-auth at six. Intake capability plus separate CSRF is required; employee ownership additionally requires the active SSO/MFA session and fresh directory identity. Public intake cannot create employee requests. No arbitrary actor assertion or direct table/QR secret read is introduced. The three registration helpers remain private. See [document 11](11_Registration_and_Digital_ID_Implementation.md).

Phase 02E adds ListVisits/GetVisitDetail/VerifyGuardPass to API, bringing its public grants to ten. ResolveVisitPhoto is available only to the new isolated gp_media_runtime role (one grant). No QR recovery/card-render grant is introduced. Read contexts enforce current individual ownership/host/staff scope, and designated reconciliation visibility includes existing INSIDE occupants beyond project allocation. See [document 12](12_Scoped_Reads_and_Photo_Access.md).

## 06. Required negative cases

Wrong-office guard, wrong-project guard, revoked grant, expired allocation, capability-only wrong role, role-only missing capability, unrelated reception printer request, forwarded approval, substituted photo/intake ID, employee using personal email, admin role without export capability, attempted self-escalation and stale live subscription must all fail without disclosing unrelated visitor data.

## Phase 02F implemented print boundary

Migration 011 adds ReissuePass, RequestPassPrint and GetPassPrintJob to API (13 public grants total). The isolated gp_render_runtime role has four renderer grants and direct schema read/DML/ALTER denied. Reception needs a current office-scoped PASS_PRINT grant; reissue additionally requires PASS_REISSUE on that same qualifying grant. Job ownership, current pass/source, actor and lease are checked again before handoff. No other runtime role can recover print QR material. See [document 13](13_Reissue_Printing_and_Card_Rendering.md).

## Current Phase 02G guard and card boundary

012/013 add ListGuardWorkContexts (API now 14 grants), identity QR printing before approval and an exact project target on ordinary movement. A shared-area guard can scan every current assigned project concurrently without selecting a fixed duty project; an optional scan filter only narrows visibility. A project ENTRY still requires that visitor request’s live host approval, valid pass, matching action target and current guard assignment. See [document 14](14_Visitor_Identity_and_Multi_Project_Guards.md).


Migration 015 individually grants CancelVisit to the API role (15 API operations total); eligible OWN/HOST detail exposes canCancel. See [document 16](16_Individual_Cancellation_and_Occupancy.md).


Migrations 017/018 implement AllocateGuard, GrantStaffRole and RevokeStaffRole. The API now has 18 individually granted operations. Guard/staff role overlaps are rejected, grants are immutable, and target session generations advance. See [document 17](17_Scoped_Staff_Administration.md).


Migrations 019/020 now implement scoped selectors, role history, operational summary and redacted audit pages. The API has 24 individually granted operations. See [document 18](18_Administration_Reads_Reports_and_Audit.md). Printer testing remains final acceptance.
