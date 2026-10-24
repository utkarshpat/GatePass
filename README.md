# GatePass

## Current system documentation

For the latest 24 October browser run, final push and presentation walkthrough, start with [Final browser verification and retained presentation data](docs/67_Final_Browser_Verification_And_Presentation.md). The [count and edge-case report](docs/66_Final_E2E_Counts_And_Edge_Cases_24_October_2026.md) explains KPI/history definitions and remaining checks; the [browser exposure audit](docs/65_Browser_Data_Exposure_Audit_24_October_2026.md) records the security fixes. Use **23 October 2026** in History/Visit register for the original populated rehearsal, and **24 October 2026** for the newer workflows. Demo data, photos and timelines remain in local SQL/private storage and are not included in a source push.

For the 23 October 2026 presentation, use the [retained-data walkthrough and fresh verification](docs/55_Presentation_Rehearsal_23_October_2026.md). See also the [local bug fixes and requester receipt mapping](docs/61_Local_Bug_Fixes_And_Request_Receipts.md). The [email holder revocation option](docs/62_Email_Not_Requested_Pass_Revocation.md) is also available locally. The [23 October pre-push audit](docs/63_Pre_Push_Audit_23_October_2026.md) records the latest review and validation. Current source/database migrations are 001–090; the consolidated 22 October export below is a historical baseline.

Start with the [consolidated system handbook](docs/system/README.md), dated 22 October 2026. It covers current flows, role/scope rules, architecture, migrations 001-062, APIs, UI/PWA, setup, email, operations, CI and rollout gaps. Earlier phase notes and counts below are historical and must not be read as current readiness claims.

Unified visitor and temporary identity management for Noida, Bengaluru, Chennai and Pune.

**Approach:** DB-first with responsive UX and server-enforced scoped access. Source migrations 001–090 cover the current local implementation. Corporate SSO/directory remain development adapters; business workflows use local SQL and protected media. The 22 October [reception audit](docs/37_Reception_Audit.md) records 376 unit, 55 SQL printing, 23 HTTP/SQL and 12 browser/accessibility cases passed; these are prior local results, not production certification. Organization identity/mail onboarding, full production composition, Linux storage/key adaptation and physical printer acceptance remain pending. See the [current system handbook](docs/system/README.md).

**Deployment/budget:** one Ubuntu Server 24.04 LTS x86-64 private VM runs the frontend, API, worker, SQL Server 2025 Express (CU1 or later) and private photo storage. Ubuntu Server and Express do not require a paid runtime licence; application components will avoid mandatory paid services. VM hosting, optional commercial support and existing corporate identity/mail/gateway entitlements are organizational dependencies. Backups/audit export also require protected off-VM organization storage. Windows is not a runtime requirement.

**Build sequence:** develop and validate locally on this Windows laptop first, then move the application and versioned SQL migrations to the Linux VM. The user installed SQL Server 2025 Express; the local helper uses the existing .NET SQL client, so sqlcmd/SSMS are optional for this workflow. Run `./database/setup/Validate-LocalDatabase.ps1` against the dedicated test database. Local self-signed TLS needs the explicit local trust option described in the database guide. API/UI feature work follows the database transaction/security gate. Linux service setup, paths, TLS, key storage and restore validation remain a separate deployment gate.

## Start reading

1. [Database package index](docs/database/00_READ_ME_FIRST.md)
2. [Domain decisions and reasoning](docs/database/01_Domain_and_Design_Decisions.md)
3. [Data dictionary](docs/database/03_Data_Dictionary.md)
4. [Permissions](docs/database/04_Permissions_and_Data_Access.md)
5. [State and transaction contracts](docs/database/05_State_and_Transaction_Contracts.md)
6. [Validation evidence and pending checks](docs/database/06_Validation_and_Readiness.md)
7. [Database setup/execution](database/README.md)
8. [Implemented transaction/security boundary and remaining work](docs/database/07_Transaction_Core_Implementation.md)
9. [Worker leases, dispatch checks and retry implementation](docs/database/08_Notification_Worker_Implementation.md)
10. [Dummy directory, allocations and combination evidence](docs/database/09_Development_Directory_and_Combinations.md)
11. [Guard ID/password login contract](docs/database/10_Guard_Login_Contract.md)
12. [Registration and Digital ID implementation](docs/database/11_Registration_and_Digital_ID_Implementation.md)
13. [Scoped reads, guard verification and photo access](docs/database/12_Scoped_Reads_and_Photo_Access.md)
14. [Reissue, printing and landscape cards](docs/database/13_Reissue_Printing_and_Card_Rendering.md)
15. [Company and application branding policy](docs/branding/Branding_and_Printing.md)
16. [Current visitor card and shared-area guard policy](docs/database/14_Visitor_Identity_and_Multi_Project_Guards.md)

17. [Trusted card fields and approved production-renderer layout](docs/database/15_Trusted_Card_Details_and_Layout.md)

18. [Individual cancellation and preserved occupancy](docs/database/16_Individual_Cancellation_and_Occupancy.md)

19. [Scoped staff administration](docs/database/17_Scoped_Staff_Administration.md)

20. [Administration reads, reports and audit](docs/database/18_Administration_Reads_Reports_and_Audit.md)

The numbered index links four editable Chen ER boards and PNG previews. ER diagrams explain the design; confirmed business requirements, trusted integration contracts and reasoned/tested invariants determine it. SQL schema is authored first, then applied/inspected on SQL Server; backend models follow the database. No entity-model generator writes DDL.

## Confirmed behavior

- India -> Location -> Project -> Assigned Guards.
- Digital ID via employee SSO/MFA, with manager notification and no manager approval.
- Guards use individual application ID/password without SSO; SQL/internal password authentication is implemented. Common staff login verifies guard passwords; controlled production enrollment remains pending.
- Individual host approval for project/external visits.
- Multi-person registration is a form convenience only; each submitted visit/decision/pass/movement is independent.
- Reception printing is standard; digital links are supplementary.
- Static QR with mandatory online checks; scan does not itself record entry.
- Simple light theme; prominent Sopra Steria organisation branding throughout, small subtle GatePass branding at the bottom. Landscape 85.6 × 54 mm passes; pending and approved QR includes the company icon. English with regional guard helper text.

No floors, zones, checkpoint inventory, face recognition, extra identity-proofing, lost-card portal integration or mandatory Redis in v1.

## Source layout

| Path | Contents |
|---|---|
| `database/migrations` | SQL baseline, reference seeds, transaction/worker/auth and registration migrations 001–090 |
| `database/tests` | Rollback constraints and restricted-user/concurrent transaction tests with owned fixture cleanup |
| `database/validation` | Static/parser checks, actual engine/constraint results, live catalog and scoped comparison evidence |
| `database/setup` | Local Express schema/constraint validation helper; optional private LocalDB setup |
| `docs/database` | Reasoned design, dictionary, permissions, transactions and diagrams |
| `tools` | Read-only SQL metadata extraction, derived documentation/diagram rendering and validation |
| `assets/brand` | Supplied company horizontal/stacked/icon and GatePass logos, unmodified |
| `src/administration` | Scoped mutations/selectors, role history, operational summary and redacted audit with exact typed SQL contracts |
| `src/printing` | Scoped reissue/print service, isolated renderer, landscape SVG and fixed version 5/H QR encoder |
| `src/integrations/directory` | Replaceable mock/API gateway; not an authentication provider |
| `database/development` | Synthetic data: 24 employees, 6 managers, 6 projects, 12 guards across four locations |
| `tests/directory.test.ts` | 18 directory contract tests using Node native TypeScript execution |
| `src/visits` | Scoped operational list/detail, non-moving QR verification, isolated photo service and typed SQL port |
| `src/registration` | Database-derived intake service, typed RPC port, actual photo normalization and AES-GCM credential envelopes |
| `src/security` | Argon2id password verifier, guard auth service and allowlisted typed SQL port |
| `database/tests/Test-GuardAuthentication.ps1` | Guard lifecycle/race/permission checks plus actual Node-to-SQL integration via a test-only RPC bridge |

Historical review and phased roadmap are in `docs/11_Design_Review_and_Proposed_Improvements.md` and `docs/12_Implementation_Phases_and_UX_Baseline.md`. The v1.2 database package supersedes earlier structural details where the individual-visit clarification changed the model.

Real database files, photos, credentials, exports and backups belong outside this OneDrive-synchronized source folder. Synthetic guard scopes are seeded only locally; explicit local guard test enrollment is available; no production integration is created. Ten seed checks and 1,584 combination checks passed. Documents 09-18 describe reproduction, authentication/registration state and remaining rollout gates.

## HTTPS/API boundary

See [HTTP and SQL adapter](docs/database/19_HTTP_and_SQL_Adapter.md) for routes, protected runtime configuration and exact evidence limits. Run `npm run test:transport` for 50 transport cases. See [registration HTTP and SSO boundary](docs/database/20_Registration_HTTP_and_SSO_Boundary.md) for the latest increment and rollout limits. Production credentials/listener were not created. A separate explicit local dummy-SSO entry point now creates synthetic employee sessions for development. Physical printer testing remains deferred to final acceptance.

## Local dummy employee sign-in

Run `npm.cmd run dev:sso` from a Windows terminal (the launcher discovers existing PowerShell 7 automatically), then open `http://localhost:8443`. This uses the existing dummy employees, assigned projects and manager ID/name/email without corporate SSO keys. This explicit local-only development runner uses HTTP and separate development cookies; production HTTPS remains required. See [local dummy SSO](docs/database/21_Local_Dummy_Employee_SSO.md) for scope, isolation, evidence and startup behavior. The standard production API entry point rejects dummy mode. The employee Digital ID form now saves normalized private photos and submits to actual SQL with stable idempotency keys, daily reuse and an OWN receipt. Real corporate SSO/mail integration is deferred.

Local HTTP update: the running development URL is `http://localhost:8443`. Do not use the old HTTPS URL for this local runner. Production TLS and secure cookie behavior are unchanged.

## Private photo and QR key storage

The Windows storage implementation is ready and initialized outside the workspace/OneDrive under `%USERPROFILE%/.gatepass/private-v1`. Run `npm.cmd run storage:init` to verify/reopen it. Photos use private ACLs, immutable bounded writes and quotas; QR keys use DPAPI CurrentUser and retain old versions during rotation. See [private photo/key storage](docs/database/22_Private_Photos_and_QR_Key_Storage.md) for evidence and remaining retention/Linux/backup gates. Current regression: 233/233 tests, including 17 storage cases. See [local employee Digital ID](docs/database/23_Local_Employee_Digital_ID.md) for the connected request flow and ten actual HTTP/SQL checks, including concurrent same-key submission. Employee card and reception surfaces are described below.

## Employee application frontend

Run `npm.cmd run dev` and open `http://localhost:8443`. The employee application now has a separate sign-in screen, company-branded public entry, employee/visitor registration, and Digital ID image download. Source lives in `src/app`; temporary authentication remains a separate adapter. Connected business operations use actual SQL and private storage. See [employee application UX](docs/database/24_Employee_Application_UX.md) for implemented scope and remaining role screens.

## Global CSS baseline

Shared tokens and components live in `src/app/global.css`; `src/app/employee-portal.css` contains screen layout only. See [global design system](docs/14_Global_Design_System.md) for the fixed typography, spacing, controls, responsive and state rules. Future agreed screens reuse this foundation.

## Office entry and employee/visitor registration

Open `http://localhost:8443/office/noida` after `npm.cmd run dev`. The shared Noida campus image accompanies SSI Employee and Visitor entry paths. Office context is server-bound, employee date input is rejected, visitors can choose an allowed date, and project-scoped host name/email search reads SQL. Photo capture/upload, review, individual group submissions and independent extra employee project requests are connected. See [office entry and registration UI](docs/database/25_Office_Entry_and_Registration_UI.md). Latest evidence: 239 Node tests and ten actual public/employee HTTP/SQL cases pass.


## Reception dashboard

Sign in at `http://localhost:8443/` after `npm.cmd run dev`. Authorized reception staff open `/reception`. The location-scoped workspace supports date/status filters, server-side name/employee/pass-ID search, bounded pagination, private photo/detail/card preview, and audited browser print/reprint handoff, including pending visitor cards. Preview does not create a print job; a print request has a stable retry key and reprint creates a separate audited job. The browser print window uses an 85.6 × 54 mm card layout. Printer acceptance remains deferred.

Reception now uses independent local staff accounts `reception1@example.com` (Noida), `reception2@example.com` (Bengaluru), `reception3@example.com` (Chennai), and `reception4@example.com` (Pune), with unique passwords in the protected local staff inventory. The former employee/reception workaround is revoked. See [current staff identity and delegation](docs/database/29_Staff_Identity_and_Delegation.md) for Platform/India/location administration, employee SSO project leads, credentials and validated scope boundaries.


Local guard test IDs are `gaurd1@example.com` through `gaurd12@example.com`. Run `tools/seed-development-guard-logins.ts` only with explicit development/mock flags after migration 028. It enrolls only the existing synthetic guards with unique random Argon2id passwords, saved under the current user’s protected `%USERPROFILE%\.gatepass\development-logins\guards.json`, outside this source folder. Reruns do not reset passwords, re-enable disabled credentials or restore grants. Guards authenticate through the common staff entry and open `/guard` for assigned projects, QR verification, exact pass/request ID lookup, protected photos, entry/exit and recent scans. See `docs/database/30_Guard_Workspace.md` for SQL boundaries and pending physical camera/reconciliation acceptance. For the current user-authorised manual test run, all active local fixture passwords are `Sopra@123`; the protected inventory reflects this override. Employee fixture emails use `employeeN@example.com`; employee dummy password remains `Sopra@123`. External admin/reception accounts use the separate local staff inventory.


Scoped project creation: [Add project and office authorization](docs/56_Scoped_Project_Creation.md), migrations 086–087.

Unified admin creation and assignment cards: [Projects and common areas](docs/57_Unified_Projects_And_Common_Areas.md).

Visit register loading/sorting and platform scrollbar theme: [behaviour and verification](docs/58_Visit_Register_Loading_And_Theme_Scrollbars.md).

Email design, person photos and approval sign-in: [current behaviour and verification](docs/60_Email_Design_Person_Photos_And_Approvals.md).
