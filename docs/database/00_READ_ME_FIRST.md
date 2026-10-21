# 00 - GatePass DB-first architecture package

Version: 1.11 | Date: 20 October 2026 | Stage: Phase 02K scoped administration reads and reporting

This package turns the agreed visitor workflows into a database architecture. UX and security remain the highest priorities. It contains a concrete SQL Server baseline and runnable validation cases, with separate status for design, syntax checks and actual engine execution.

**Authority:** the user's confirmed business requirements and verified integration contracts determine behavior. The schema and transaction contracts implement those requirements and remain subject to reasoning, review and execution tests. ER diagrams are explanatory views, not a source of truth or a restriction on improving the model. The legacy 20-table design is a reference, not a required table count.

**Important change:** registration may collect several people once, but every submitted person becomes an independent visit. The old group decision and group occupancy behavior is superseded.

## 01. Read in this sequence

| No. | Artifact | Purpose |
|---|---|---|
| 01 | [Domain decisions](01_Domain_and_Design_Decisions.md) | What each record means and how v1.2 differs |
| 02A | [Organization/access Chen ER](diagrams/02A_Organization_and_Authorization.png) | Directory, scoped roles, capabilities and guard assignment |
| 02B | [Registration/visits Chen ER](diagrams/02B_Registration_and_Individual_Visits.png) | Registration-only correlation and individual decisions |
| 02C | [Pass/movement Chen ER](diagrams/02C_Credentials_and_Movements.png) | Credential versions, presence, entry/exit and printing |
| 02D | [Delivery/operations Chen ER](diagrams/02D_Delivery_and_Operations.png) | Sessions, retry ownership, outbox and audit |
| 03 | [Data dictionary](03_Data_Dictionary.md) | Every column, PK/FK, check, unique key and secondary index |
| 04 | [Permissions matrix](04_Permissions_and_Data_Access.md) | Actor capabilities, scope rules and database access boundary |
| 05 | [State/transaction contracts](05_State_and_Transaction_Contracts.md) | Legal transitions, locks, retries and failure recovery |
| 06 | [Validation and readiness](06_Validation_and_Readiness.md) | What has been checked and what requires a real SQL engine |
| 07 | [Database execution instructions](../../database/README.md) | Empty test database, ordered migrations and test scripts |
| 08 | [Transaction/security implementation](07_Transaction_Core_Implementation.md) | Applied Phase 02A procedures, runtime role, 40 cases and remaining scope |
| 09 | [Notification worker database implementation](08_Notification_Worker_Implementation.md) | Applied Phase 02B fenced leases, dispatch checks, isolated worker role and 39 cases |
| 10 | [Development directory and combinations](09_Development_Directory_and_Combinations.md) | Replaceable API boundary, seeded employees/managers/projects/guards and 1,584 checks |
| 11 | [Guard password authentication](10_Guard_Login_Contract.md) | Applied SQL/internal backend, 39 suite cases, 15 unit cases and six nested real hashing/SQL scenarios; browser/HTTP pending |
| 12 | [Registration and Digital ID](11_Registration_and_Digital_ID_Implementation.md) | Owned intakes, independent people, daily reuse, normalized photos and encrypted QR; SQL/internal service evidence and rollout gates |
| 13 | [Scoped reads and photo access](12_Scoped_Reads_and_Photo_Access.md) | Operational lists/details, guard verification, isolated photo authorization and current evidence |
| 14 | [Reissue, printing and cards](13_Reissue_Printing_and_Card_Rendering.md) | Replacement, isolated render/print handoff and historical Phase 02F card policy |
| 15 | [Current visitor identity and shared-area guards](14_Visitor_Identity_and_Multi_Project_Guards.md) | Neutral pending/approved QR cards; all assigned projects scanned together; exact project per action |

| 16 | [Trusted card details and layout](15_Trusted_Card_Details_and_Layout.md) | Applied 014, source binding and shared approved card renderer |

| 17 | [Individual cancellation and occupancy](16_Individual_Cancellation_and_Occupancy.md) | Applied 015/016: atomic cancellation and preserved exit/replacement behavior |

| 18 | [Scoped staff administration](17_Scoped_Staff_Administration.md) | 017/018: scoped allocation and explicit role/capability grant/revocation |

| 19 | [Administration reads/report/audit](18_Administration_Reads_Reports_and_Audit.md) | 019/020: scoped selectors, role history, bounded summary and redacted audit |

Diagrams read left to right. Rectangles are entities, diamonds are relationships, ovals are attributes and underlined attributes are primary keys. Repeated rectangles reference the same actual table. Diagrams show significant conceptual relationships; the dictionary and SQL enumerate all physical FKs. A displayed 1/N represents maximum cardinality; mandatory minimum rows such as initial presence are also enforced by service transactions.

## 02. Package inventory

- 33 physical tables including migration history, 297 columns and 58 foreign keys. The original 27-table Chen boards remain explanatory baseline views; the current dictionary includes the four guard authentication tables RegistrationIntakeAccess and PassPrintRenderState.
- Four editable SVG diagrams and matching PNG previews.
- Two versioned SQL migrations: new empty-database baseline and reference seeds.
- Phase 02A adds migration 003: host WEB decision, explicit movement and scoped deallocation, plus private helpers and an execute-only DB role; physical baseline tables remain unchanged.
- Phase 02B adds applied migrations 004/005: worker claim/preflight/renew/complete, fresh fencing tokens, bounded retries and a separate execute-only role; 39 cases passed with no provider calls. Physical tables remain unchanged.
- Phase 02C adds migrations 006/007: four guard authentication tables, fenced ID/password login/setup, scoped credential administration and an isolated auth role. Internal backend verification uses the installed Node crypto runtime.
- Phase 02D adds migrations 008/009: intake ownership/CSRF, atomic individual registration, daily Digital ID reuse, initial encrypted credentials and canonical snapshots; actual image/crypto/SQL integration is exercised.
- Phase 02E adds migration 010 without physical table changes: scoped reads, non-moving QR verification and a separate execute-only media photo role.
- Phase 02F adds migration 011: replacement and reception printing with an isolated renderer role, leased render state and company-branded landscape cards.
- Phase 02G adds 012/013 without table changes: immediate identity QR for pending cards and shared-area guards handling several assigned projects concurrently, with exact per-action targets.
- Phase 02H adds 014: trusted printed employee/host fields, assignment summaries and a digest checked through final dispatch; shared compact renderer and preview.
- Phase 02I adds 015/016: individual cancellation, credential/render/outbox invalidation and preserved occupant overlap until actual exit.
- Phase 02J adds 017/018: scoped guard allocation and explicit immutable role/capability administration with session-generation fencing.
- Phase 02K adds 019/020: scoped administration selectors, explicit role history, separated recorded presence and redacted audit pagination with wait-time rechecks.
- SQL constraint scenarios, static model validation and Microsoft ScriptDom syntax report.
- Schema definition: reviewed SQL in `database/migrations`; no entity-model generator writes DDL.
- `tools/export_sql_schema.ps1` reads the SQL draft using Microsoft ScriptDom; `tools/render_database_docs.py` renders its derived dictionary/diagram views. Descriptive annotations do not define database structure.
- After installation, `database/inspection/001_live_catalog.sql` captures the actual database schema for verification and later model/repository derivation.

## 03. Delivery state

Local GatePass_DesignTest has migrations 001-020. The baseline, core, worker, guard-auth and registration reports record exact current test evidence and cleanup. Development master data persists; disposable workflow/authentication rows do not. Actual DB schema drives backend contracts. HTTP/browser transport, production driver/identities/storage, real SSO/directory and Outlook remain pending.

The migrations target an empty dedicated database. **They are not an upgrade script for a populated v1.0/v1.1 database.** No legacy source document or existing database has been overwritten.

## 04. Current start point

The baseline, transaction core, worker and internal guard authentication gates passed. Registration/Digital ID SQL and internal services now follow in document 11. Scoped reads/verification/photo access now follow in document 12. Reissue/printing/rendering follow in document 13; current visitor card and multi-project guard policy is in document 14. Trusted card fields and the approved compact layout are implemented in document 15. Cancellation/occupancy is implemented in document 16. Staff mutation contracts are implemented in document 17. Admin read/report/audit contracts are implemented in document 18. Continue with production SQL adapter and HTTP/API/UI integration, then dependent HTTP/API/UI and real worker integrations. Guard browser login/enrollment and production policy/driver setup remain explicit gates in document 10. Local development precedes Linux deployment.


## HTTP transport increment

[Secure HTTP boundary and SQL adapter](19_HTTP_and_SQL_Adapter.md): 24 protected route bindings; 169 total Node tests; six actual SQL identity admission cases. Existing 20 migrations are unchanged. Production TDS connectivity and browser acceptance remain pending.

## Registration HTTP increment (20 October 2026)

[Registration HTTP and SSO boundary](20_Registration_HTTP_and_SSO_Boundary.md): current full regression 185/185 Node tests, including 50 transport cases and 16 new registration HTTP/SSO-port cases. No migrations changed. Registration composition requires real photo/key dependencies; employee flows additionally require a real SSO gate. The CLI does not enable public registration yet. Live TDS/HTTP-to-SQL, private storage, real SSO, browser acceptance and Linux rollout remain pending. Physical printer testing stays at final acceptance.

## Local dummy SSO increment (20 October 2026)

[Local dummy employee SSO and manager profile](21_Local_Dummy_Employee_SSO.md): 200/200 Node tests, including 15 new dummy-auth units; 10 actual local HTTPS/SQL checks with owned fixtures cleaned. Existing employee, assigned project and manager ID/name/email data drive the local login. Corporate SSO keys are not required for development; real SSO/mail integration is deferred. Core migrations/tables are unchanged. Production TDS, main browser flow, private photo/key storage and Linux rollout remain pending. Physical printer testing remains at final acceptance.

## Local HTTP development update

User requested HTTP for local development. The separate dummy runner now uses `http://localhost:8443`, loopback binding and isolated development cookies with CSRF. Production HTTPS is unchanged. Current full regression: 215/215 tests; 10 actual HTTP/SQL dummy SSO cases pass. Evidence: `database/validation/local-http-unit-report.json`. Browser acceptance is not claimed.

## Private storage increment

[Private photos and QR key storage](22_Private_Photos_and_QR_Key_Storage.md): 232/232 Node tests; 17 storage cases cover actual Windows ACL/DPAPI, quotas/path attacks and real file-vault rotation/recovery. Local store initialized outside workspace/OneDrive. No core schema change. Employee request screens and private photo HTTP wiring are next; reference-aware retention, Linux key migration and backup/restore remain rollout gates.

## Connected employee Digital ID increment

[Local employee Digital ID](23_Local_Employee_Digital_ID.md): 233/233 Node tests, ten actual Digital ID HTTP/SQL cases (including concurrent idempotency and daily reuse) and eleven dummy SSO HTTP/SQL cases pass. Migrations 021–022 add a scoped office selector and correct the QR key identifier character check. Photos and protected persistent QR keys are connected to the local employee form. SQL retains metadata and encrypted QR credentials. Receipt access is limited to its signed-in owner. No real mail or physical printer testing. Card/reception/project UI and production integration/rollout gates remain.

## Employee application frontend

[Employee application UX](24_Employee_Application_UX.md) describes the company-branded application shell, separate employee sign-in, profile navigation, connected Digital ID form and receipt states. Only the connected employee screens are exposed. Temporary SSO remains an adapter; request persistence and authorization continue through real backend services and SQL.

## Office entry and registration UI

[Office entry and registration UI](25_Office_Entry_and_Registration_UI.md) covers the shared Noida background, SSI Employee/Visitor landing, email adapter, QR office context, host search, date rules, photo/review flow and actual SQL submissions. Migration 023 adds the scoped selector. Current evidence: 239 Node tests and ten actual public/employee HTTP/SQL cases pass; no browser visual or physical camera/printer acceptance is claimed.
