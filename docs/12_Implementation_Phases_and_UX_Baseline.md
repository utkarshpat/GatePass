# 12 - GatePass implementation phases and UX baseline

Date: 20 October 2026

Status: Working implementation plan based on the user's confirmed requirements. UX and security are the highest priorities in every phase. Local baseline constraints and the Phase 02A host/movement/deallocation core passed (40 restricted-user/security cases including four races). Remaining workflows, enterprise integrations and production security checks remain pending.

Confirmed delivery approach: DB-first. Business rules and user journeys inform the data model; the reviewed database model and transaction contracts then drive API contracts and UI implementation. Validate the database with executable migrations before building dependent feature modules. Subsequent changes remain versioned migrations, not an assumption that the first schema is immutable.

Phase 01 progress: the v1.2 database package is available at `docs/database/00_READ_ME_FIRST.md`. It includes the reasoned individual-visit model, dictionary, SQL baseline, explanatory Chen boards and permission/transaction contracts. Static/model and syntax checks passed. The user-installed local Express engine applied migrations 001/002; all 18 engine scenarios and 1,311 scoped live-catalog comparisons passed. Transaction work is tracked in Phase 02A below. ER diagrams are explanatory artifacts, not a source of truth.

Phase 02A progress: migration 003 is applied. The execute-only role and public DecideVisit/RecordMovement/DeallocateGuard procedures passed 40 restricted-user cases including races and rollback. API authentication and DB enforcement are complementary. Document 07 records precise limits. Intake/issuance and other credential/read/admin paths remain pending.

Phase 02B progress: migrations 004/005 implement fenced worker leases, preflight, renew/ack and bounded retry; 39 cases passed with no provider calls. The replaceable directory gateway has 18 passing contract tests. User-authorized dummy data includes 24 employees, 6 managers from that population, 6 projects and 12 guards across four locations; 10 seed cases and 1,584 combination checks passed. Documents 08/09 contain evidence and limits.

Phase 02C progress: guards use ID/password without SSO; employees/hosts retain corporate SSO. Migrations 006/007 implement credential storage, scoped setup/reset, failure throttling, fenced verification and sessions; the internal Node verifier follows the SQL contract. Thirty-nine suite cases, 15 backend unit cases and six nested real hashing/SQL scenarios passed. Current schema: 31 tables, 281 columns, 56 FKs; 1,480 scoped comparisons passed. HTTP/browser login, production SQL driver/identities and enrollment remain pending; no permanent sample passwords were created. The user will wire the real employee API later; development directory mocks are not an authentication bypass. See document 10.

## 01. Product priorities

The interface must be simple, clean, easy to understand and smooth to operate. Strong security is enforced primarily through correct backend identity, authorization, state transitions and data protection, while avoiding unnecessary user steps.

Every phase has two completion gates:

1. UX: the intended user can complete the task with clear status, minimal typing, useful feedback and a safe recovery path.
2. Security: the server enforces actor/resource scope, input validation, safe state changes and appropriate audit; unauthorized and failure cases are verified.

Security work starts in the foundation and continues with every feature. Phase 07 independently validates the completed application.

## 02. Confirmed scope to preserve

- India -> Location -> Project -> Assigned Guards. Chennai, Bengaluru, Noida and Pune; no floors, zones or checkpoints.
- Digital ID: corporate SSO/MFA, official employee details, form-captured photo and reason; automatic location-only pass with manager notification, without manager approval.
- Project visits: assigned host approval using current membership from the trusted directory API.
- Multi-person registration is only a form convenience. Common visit information is entered once; each submitted person's visit, decision, card, status, reception/guard row, entry/exit and reporting are individual.
- Reception printing is the standard workflow for each eligible person; digital delivery is supplementary. Corporate employee email is directory-controlled; external email is optional.
- Static QR, online verification, separate explicit entry/exit, multiple movements during the authorized window.
- English primary guard labels with short local-language text alongside.
- React/TypeScript PWA, Express/TypeScript, SQL Server, background worker and protected photos on one private VM behind the approved HTTPS gateway.
- Confirmed budget/deployment clarification: one Ubuntu Server 24.04 LTS x86-64 private VM hosts the full runtime stack and local private photo storage. Target SQL Server 2025 Express CU1 or later for both validation and free production database licensing. Ubuntu Server needs no paid OS licence. Use free/open-source application components and existing corporate SSO/Outlook/gateway services; VM hosting, optional commercial support and enterprise-service entitlements remain organization infrastructure costs. Windows is not required for the runtime.
- Build locally first on the current Windows laptop using SQL Server 2025 Express, validate migrations and transaction behavior, then implement backend and UI. Move the same versioned SQL/application sources to the Linux VM after local acceptance. Local evidence does not replace Linux deployment, TLS, filesystem, key recovery and integration checks.
- The accepted review directions are recorded in `11_Design_Review_and_Proposed_Improvements.md`; concrete contracts and migrations will incorporate them during phases 01 and 02.

## 03. Visual direction from the supplied logo

Original logo preserved without alteration at `assets/brand/gatepass-logo.png`.

| Token | Initial value | Use |
|---|---|---|
| Primary | #C9002B | Primary buttons, active navigation, focused brand elements |
| Brand accent | #FF7800 | Small accents and illustration details |
| Brand gradient | #E80035 -> #FF7800 | Limited decorative brand areas |
| Page background | #F7F8FA | Main application canvas |
| Surface | #FFFFFF | Forms, cards and dialogs |
| Main text | #182230 | Headings and body |
| Secondary text | #667085 | Supporting text |
| Border | #E4E7EC | Subtle separation |

These are proposed UI tokens inspired by the logo, not an assertion of exact source-image colors. Use solid crimson with white text for primary buttons. The orange end of the decorative gradient is unsuitable for ordinary small white text; verify actual rendered text/background contrast for all components.

Keep one consistent light theme across roles, with generous spacing, restrained shadows, readable typography and minimal decoration. Color supports meaning; text and icons always express status. Approved, pending, denied, expired and unavailable must remain distinguishable without color.

Do not put personal photos inside decorative or public assets. A printed badge uses the approved logo plus legible name/photo, reference, validity and QR; destination disclosure follows policy.

## 04. UX rules used throughout

- Public landing: clear Employee and Visitor choices; employee subflow distinguishes Digital ID from project visit.
- Autofill trusted employee information after SSO; official email is read-only. Do not ask users to retype known information.
- Use a short step sequence for intake: visit details -> people/photo -> review and submit. One-person visits should feel lightweight.
- Preserve valid draft input on validation/network errors. Never persist sensitive form/photo data in shared browser storage without a specific approved design.
- Prevent duplicate submissions while showing an explicit submitting state; server idempotency handles retries.
- Every submission ends on a clear individual status/reference screen and explains the next action. A reference alone cannot retrieve private data.
- After multi-person submission, there is no group occupancy widget or operational group card. Each person proceeds independently.
- Guard: Scan and Search are obvious, with photo, destination, approval, validity and INSIDE/OUTSIDE state together. Present the one appropriate next movement action and confirm success immediately after the server commits.
- Do not treat a successful scan as entry. Avoid repeated confirmation dialogs for routine actions; reserve confirmation for consequential actions such as reissue or permission changes.
- Use large touch targets, plain language, keyboard support and legible bilingual instructions. Put the same care into errors, empty/loading states and camera-permission fallback as into the happy path.
- Show connectivity and data freshness. A stale/offline screen cannot grant entry; reconnect refreshes current state before enabling actions.
- Manual lookup follows the same server authorization rules as scanning. Unavailable camera access must not force a security bypass.
- Validate print size and QR readability using actual reception printer/card equipment during the pilot.

## 05. Phase plan

| Phase | Focus | Concrete deliverables | Completion gate |
|---|---|---|---|
| 01 | Database architecture and domain rules | Updated Chen ER, data dictionary, physical schema design, permission matrix, lifecycle/transaction rules, indexes and retention/storage boundaries | All three journeys and failure paths map to the data model; registration-only grouping creates independent visits |
| 02 | Database implementation, then secure backend foundation | Execute versioned SQL migrations and database checks first; then build API contracts, sessions, SSO/directory adapters, authorization, photo/audit/outbox infrastructure | Schema, constraints and critical transaction tests pass on test SQL Server before dependent feature modules; backend negative tests verify scope and input boundaries |
| 03 | First complete journey: employee Digital ID | SSO -> capture photo/reason -> location pass -> manager notification -> reception print -> guard verify/entry/exit | Duplicate submissions, reprint/reissue, expiry, recovery and concurrent movement scenarios pass end to end |
| 04 | Individual host approvals and visitor intake | Employee project request, external single/multi-person intake, independent visits/approvals, Outlook action integration and SSO fallback | Pending/denied cannot enter; wrong host/stale request is rejected; each submitted person's outcome remains independent |
| 05 | Guard PWA and reception usability | Mobile scanner/search, individual expected/inside lists, bilingual labels, live updates, printer workflows, refresh/reconnect handling | Scoped live data and deallocation work; guard/reception walkthroughs are fast and understandable on target devices |
| 06 | Administration, reporting and operations | Scoped guard allocation, role capabilities, individual visit reports, occupancy, exports, retention jobs, notification failure queue, monitoring | No scope leakage; changes and exports are audited; failures are actionable and cleanup preserves required history |
| 07 | Independent validation, pilot and rollout | Security/concurrency/load checks, restore drill, Outlook/device/printer verification, trained users, supervised site pilot and staged rollout | Required acceptance evidence and operational sign-offs exist; pilot issues are resolved before expanding |

### Phase 01 - database architecture first

Prepare the database design package before creating dependent API/UI feature modules. Keep diagrams left-to-right and numbered, with Chen notation for conceptual ER:

1. Domain/entity catalogue and updated Chen ER: organization, trusted identity, role/scope, individual visit, approval, credential, movement, delivery and audit relationships.
2. Table-by-table data dictionary: column meaning, type, nullability, defaults, PK/FK/unique/check rules, data origin and sensitive-field handling.
3. Permission matrix for employee, host, guard, reception, project admin, location admin and India admin; define Digital ID movement capability explicitly.
4. State and transaction contracts for individual request/approval/pass/presence, cancellation, reissue and expired/revoked occupant exit. Specify lock order and duplicate-request behavior.
5. Resolve QR reprint recovery and encrypted material/key lifecycle. Document the deliberate change from the prior hash-only storage rule and the private storage boundary for photos/card material.
6. Freeze approval-relevant submitted details and bind decisions to their exact version. Translate registration-only grouping into independent visit records and an idempotent submission contract.
7. Physical SQL schema/migration plan including worker leases, required session/intake/idempotency persistence, indexes, consistency checks and retention behavior. Table count is not a fixed limit.
8. Database validation scenarios covering uniqueness, invalid scope, invalid state, concurrent movement/reissue/decision, worker recovery and individual visitor independence. User journeys serve as acceptance inputs; UI implementation follows the database/backend foundation.

Begin the Outlook tenant/gateway proof of concept as soon as the required approved access is available. It must validate current Entra authentication and actual supported client behavior before phase 04 integration is considered complete. SSO and directory contracts are also investigated early. Use explicit local development adapters while access is pending; they never become a production authentication bypass.

### Phase 02 - execute and validate the database, then build the backend foundation

First turn the phase 01 model into versioned SQL Server migrations and reference seeds. Run them on an empty test database and check upgrade behavior, constraints, representative scoped queries and critical transaction/concurrency cases. Maintain a migration history and a documented recovery strategy; do not claim SQL validation until executed successfully on SQL Server.

After that database gate, derive API contracts and service/repository boundaries from the reviewed model and workflows. Keep API responses task-oriented and scoped: DB-first does not mean exposing raw tables or a generic unrestricted CRUD API. Backend authorization is still mandatory alongside database constraints.

Create `apps/web`, `apps/api`, `apps/worker`, `packages/shared`, `database/migrations`, `tests` and `docs`. Use one shared validation/contract layer and one server authorization policy layer. Feature modules reuse these rather than duplicating permission logic.

Use least-privilege runtime identities and separate migration privileges. Implement transactional audit/outbox writes, recoverable worker claims, protected secret handling and structured logs that redact credentials and unnecessary personal data.

### Phase 03 - why Digital ID is the first complete feature

Digital ID exercises identity, directory lookup, photo intake, credential generation, notification delivery, printing, guard authorization and atomic movement without waiting for the host approval integration. It provides an early working path through the core system and reveals cross-module issues before external visitor workflows are added.

### Phases 04-06 - build on the same core

Project visits and externally registered people use the same individual visit/pass/movement infrastructure. Add host authorization and independent decisions, then complete the guard/reception experience and administrative operations. Each feature includes its failure states and negative authorization tests when introduced.

### Phase 07 - acceptance evidence

Required scenarios include: cross-location/project access denial; forwarded/stale approval handling; simultaneous approve/deny; duplicate registration; reprint and reissue after restart; concurrent entry/exit and revocation; expired/revoked visitor departure; live scope revocation; worker interruption/recovery; upload and submission abuse; protected cache behavior; scoped exports; restore with encryption keys; and real-device/printer usability.

Pilot one agreed location, observe actual guard/reception use, resolve issues and then expand to the remaining three locations. Exact dates and sizing follow integration readiness and measured load rather than an unverified fixed promise.

## 06. Enterprise inputs to track

| Input | Needed for |
|---|---|
| Corporate SSO issuer/tenant and test application | Real login/logout and identity mapping |
| Directory API contract, test access, manager reference and update semantics | Verified employee, host membership and notifications |
| Outlook Actionable Messages registration and tenant support | Real authenticated mail actions |
| Approved gateway route/network matrix | Public intake, callbacks and restricted staff access |
| Test SQL Server edition/version and approved secret/key storage | Executable migrations, transactions and protected credential recovery |
| Guard device/browser and reception printer/card details | Scanner, PWA, bilingual usability and printing verification |
| Retention/export/backup and downtime policy | Operational behavior and acceptance |

Track these dependencies without blocking independent design and local development work. Do not assume credentials, tenant permissions or production deployment authorization have been supplied.

## 07. Immediate starting point

Theme direction and the user's logo are captured. Start with the updated database architecture package: Chen ER, data dictionary, physical schema, permission matrix and transaction/state rules. Execute and validate SQL migrations next, then build API contracts and the secure backend foundation. Phase 03 delivers the first working end-to-end Digital ID journey; UI remains simple and task-oriented while following the validated data/workflow contracts.

## 08. Express edition and single-VM operations

Use the full SQL Server Express Linux service for the Ubuntu VM runtime; Ubuntu 24.04 requires SQL Server 2025 CU1 or later. Select x86-64, not ARM. Developer edition is non-production only; Windows LocalDB is only an optional laptop test path. SQL Server 2025 Express is free for production, with a 50 GB relational database limit, up to four cores (lesser of one socket/four cores), and 1,410 MB buffer-pool memory. Actual GatePass suitability remains subject to load/retention testing.

Run the API and worker under separate restricted Linux service identities managed by systemd. The approved HTTPS gateway/reverse proxy is the user-facing endpoint; keep SQL and internal application ports private. Keep photo files outside the web root and serve them through authorized application operations. Use systemd timers or the worker for scheduled maintenance. Use Ubuntu's standard security updates; optional Ubuntu Pro/commercial support is a separate organizational choice. The existing PowerShell LocalDB helper does not provision Linux. No VM provisioning or installation has been performed.

Express does not supply SQL Server Agent, TDE or native encrypted backup creation. Use the existing Node worker/approved OS scheduler for maintenance, approved host/volume protection plus application encryption for sensitive credential material, and an approved encrypted backup workflow with restore testing. Do not assume paid-edition features exist. Photos remain files outside database data pages, with restricted access and lifecycle cleanup.

All active app services run on the one VM, but a backup kept only on that VM cannot survive its loss. Keep protected backup copies and audit export in existing approved organization storage; this does not require a second application VM or a mandatory paid cloud service. The single VM remains one failure domain.

Verified sources: [Microsoft downloads and free production Express edition](https://www.microsoft.com/en-us/sql-server/sql-server-downloads), [SQL Server 2025 edition limits/features](https://learn.microsoft.com/en-us/sql/sql-server/editions-and-components-of-sql-server-2025?view=sql-server-ver17).

Linux references: [Microsoft Ubuntu installation and CU1 requirement](https://learn.microsoft.com/en-us/sql/linux/quickstart-install-connect-ubuntu?view=sql-server-ver17), [Linux supported platforms and x64 requirements](https://learn.microsoft.com/en-us/sql/linux/install-upgrade/setup?view=sql-server-ver17), [Ubuntu Server downloads](https://ubuntu.com/download/server).

Current Phase 02D status (20 October 2026): registration/Digital ID SQL and internal backend are implemented in migrations 008/009; HTTP/UI is still pending. Continue the DB-first sequence with scoped reads/rendering and credential/print operations before the first browser journey. See [registration implementation](database/11_Registration_and_Digital_ID_Implementation.md). Database internal code TEMP_ID remains unchanged.

Current Phase 02E status (20 October 2026): scoped operational list/detail, non-moving guard QR verification and isolated photo authorization are implemented after migration 010. Continue with credential reissue and audited reception print/render SQL before browser journeys. See [scoped reads and photo access](database/12_Scoped_Reads_and_Photo_Access.md).

## Current Phase 02F progress and confirmed branding

Migrations 001-011 are applied locally: 33 tables, 296 columns and 58 FKs. Registration/Digital ID, scoped reads/photo authorization, explicit reissue and reception print/render handoff are implemented internally. Printing has 42 SQL suite cases (five nested actual backend/SQL scenarios) and 17 unit cases; the complete Node unit run has 84 cases. Browser/HTTP, production identities/storage and real integrations remain pending. Next database block is cancellation and remaining scoped administration before dependent UI rollout.

The user confirmed prominent Sopra Steria branding throughout all application surfaces. Both company and GatePass brands remain: GatePass is small/subtle at the bottom. Use the supplied horizontal, stacked and icon assets according to available space; the approved QR uses the company icon. Printed passes are landscape ID-card size, **85.6 × 54 mm**, actual-size printing. The implemented landscape renderer follows this hierarchy; the future shared UI shell must do the same. Details: docs/branding/Branding_and_Printing.md and docs/database/13_Reissue_Printing_and_Card_Rendering.md.

## Current Phase 02G clarification: lobby, identity card and shared-area guards

Reception prints a neutral identity card with QR immediately; project host approval may follow while a guest waits in designated common areas. No approval label, project/host detail or access explanation is printed. The same QR is checked online before and after approval. One shared-area guard may handle four projects simultaneously: scan all currently assigned projects without a compulsory fixed-project duty mode, then show the visitor request’s destination/approval and a named Entry — Project B action. Every project mutation includes and revalidates that exact target. This supersedes the earlier pending-card layout. Migrations 001-013 are applied; physical schema is unchanged at 33 tables/296 columns/58 FKs. Current evidence: 20 project-context SQL cases, 42 print cases and 93 full Node unit cases. Details: [document 14](database/14_Visitor_Identity_and_Multi_Project_Guards.md).
