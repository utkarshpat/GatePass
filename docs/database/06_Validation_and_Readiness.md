# 06 - Validation and readiness

Version: 1.11 | Date: 20 October 2026

## 01. Evidence produced locally through Phase 02K visitor identity and multi-project guards

| Check | Result | Evidence / limit |
|---|---|---|
| Model PK/FK target/key/type compatibility and structural invariants | PASS: 88 static checks | `database/validation/model-report.json`; SQL 001/006/008/011/014 -> 33 tables, 297 columns, 58 FKs; not engine semantics |
| Microsoft T-SQL syntax parser | PASS: 0 errors in all 28 SQL files | `database/validation/sql-syntax-report.json`; TSql160Parser, official ScriptDom package |
| Python source compile | PASS | SQL-derived documentation renderer and structural validator compile; no Python-to-SQL generator remains |
| PowerShell syntax parse | PASS | SQL metadata exporter, parser preparation, syntax validator and LocalDB setup scripts |
| Local Express validation helper | PASS on the installed engine | Default SqlClient driver uses the existing .NET library; SQL errors stop execution; recorded migrations skipped on the successful resumed run |
| Node renderer syntax | PASS | Diagram renderer parses |
| Diagram rendering / visual inspection | PASS | Four SVG/PNG boards; left-to-right layout, separate real-attribute ovals and underlined key components |
| SQL Server migration execution | PASS: 001-020 applied | User-installed Express 17.0.1000.7; dedicated GatePass_DesignTest; engine report and separate 003-020 apply reports |
| 18 engine constraint scenarios | PASS: 18/18 | `database/validation/constraint-results.txt`; synthetic fixtures rolled back |
| Captured actual catalog comparison | PASS: 1,568/1,568 scoped checks | `live-catalog.json` and `live-comparison-report.json`; scope/exclusions stated; initial 27-table baseline previously had 1,311 checks |
| Persisted fixture cleanup | PASS | `development-inventory-report.json`; requested dummy master data retained, business workflow tables empty; older `fixture-rollback-report.json` is historical, before permanent dummy data |
| Phase 02A transaction/security core | PASS: 40/40 cases | `transaction-core-report.json`; isolated execute-only role; four independent-connection races; exact supported scope in document 07 |
| Migrations 003-020 and deployed security inventory | PASS | Current inventory: 59 procedures, eight private functions; twenty-four API, five worker, six auth, one media and four renderer public EXECUTE grants; direct schema read/DML/ALTER denied; no real role members |
| Notification worker contracts | PASS: 39/39 | Fenced claim/preflight/renew/ack, retry, fault rollback and four observed concurrent races; zero provider calls |
| Replaceable directory gateway | PASS: 18/18 | `directory-tests.txt` and `directory-test-report.json`; Node native TypeScript execution, not compiler/typecheck validation |
| Persistent dummy directory seed | PASS: 10/10 | `development-seed-tests.json`; scoped guard allocations, preserved disabled/revoked state, no passwords/logins/sessions |
| Directory/guard combination matrices | PASS: 1,584/1,584 | `development-combination-report.json` and CSV; present fixture population, not all workflow states |
| Guard password SQL and internal service | PASS: 39 suite cases, 15 unit cases | `guard-auth-report.json`, `guard-auth-unit-report.json`; lifecycle/permissions, four observed races, scoped movement with password-issued session |
| Actual Argon2 and restricted SQL integration | PASS: six nested scenarios | `guard-auth-backend-integration.json`; included as one of the 39 suite cases; test-only .NET RPC bridge, no production driver or HTTP/browser |
| Registration / Digital ID SQL and internal backend | PASS: 45 suite cases, 17 unit cases | `registration-report.json`, `registration-unit-report.json`; ownership/CSRF, atomic individual visits, reuse/overlap, rollback and four observed SQL races |
| Actual photo / AES / restricted SQL integration | PASS: six nested scenarios | `registration-backend-integration.json`; included in the 45 suite cases, not six additional SQL suite cases; in-memory keys/storage, test-only RPC bridge |
| Scoped reads / guard verification / photo authorization | PASS: 47 suite cases, 19 unit cases | `visit-reads-report.json`, `visit-reads-unit-report.json`; two observed lock waits; four nested actual restricted SQL/backend scenarios included in suite count |
| Reissue / print / isolated renderer | PASS: 55 suite cases, 23 unit cases | `pass-print-report.json`, `pass-print-backend-integration.json`, `pass-print-unit-report.json`; five observed SQL races; six actual backend/SQL scenarios nested in the suite; company-branded landscape cards |
| Branded QR raster decode | PASS: 96 decodes | 24 synthetic payloads at three crop sizes plus 24 full-card detections; up to four orientations; not physical printer/camera acceptance |
| Shared-area guards and exact project target | PASS: 20 SQL cases, 6 movement unit cases | `guard-project-context-report.json`, `guard-movement-unit-report.json`; four simultaneous assigned projects, no fixed mode, one observed authorization wait |
| Full Node unit regression | PASS: 135/135 | `all-unit-test-report.json`; directory 18 + guard 15 + registration 17 + read/photo 19 + printing 23 + movement 6 + cancellation 8 + administration 13 + admin reads 16; native TypeScript execution, not compiler/typecheck |
| Individual cancellation and occupancy | PASS: 30 SQL cases, 8 unit cases | Five nested actual SQL/service scenarios, four observed races and preserved occupant exit/replacement; document 16 |
| Scoped staff administration | PASS: 37 SQL cases, 13 unit cases | Seven nested actual SQL/service cases; four observed races; eligible role matrix, exact scopes and no self-escalation; document 17 |
| Administration selectors / summary / audit | PASS: 38 SQL cases, 16 unit cases | Seven nested actual SQL/service scenarios, two authorization waits and one guard-row wait; no raw audit payloads; document 18 |
| Remaining concurrent/service contracts | PENDING | HTTP/browser login, production authentication identities/policy/driver/storage, physical printer/device acceptance, real SSO identity sync and other actions |
| Production identities/complete permission boundary | PENDING | Runtime role tested for the core; no real app/worker/login provisioning, scoped read routes or full integration yet |
| Real SSO / directory / Outlook / protected key-store integration | NOT RUN | Actual AES-GCM and image processing are tested locally; approved tenant/API/key-store/transport/storage integration remains required |

Static consistency, parsing and diagrams are not a security certification or proof that the database runs correctly. The SQL design itself is reviewed against business rules; diagrams are not the design authority.

Local evidence was captured on 20 October 2026 IST (UTC timestamps are in the files). The first live helper run applied both migrations and passed the constraints, then stopped on an optional-field handling bug in the PowerShell catalog reader. After fixing that reader, the resumed run passed without reapplying migrations. A prior connection-builder property-adapter error was also fixed before migrations ran. Neither issue required a schema change or database reset. SQL scripts are unchanged from the reviewed baseline.

The installed local certificate is self-signed/untrusted. This local-only Windows-authenticated validation used TLS encryption with explicit TrustServerCertificate. That does not establish production certificate trust. SQL data/log paths are outside OneDrive. SSMS/sqlcmd have not been installed by this workflow; the existing .NET SQL client was sufficient.

Catalog comparison checks table and ordered column sets, SQL type/size, nullability, identity presence, simple defaults, PK/unique columns, FK mappings, CHECK counts, trusted/enabled constraints and explicit index names. It does not prove CHECK-expression semantics, collations, index filter/order/include details, identity seeds, grants or transaction correctness. The actual catalog remains available for these later checks and DB-first backend derivation.

## 02. Engine scenarios ready to run

1. Three people submitted together retain independent approved/denied/pending status records.
2. Visit project-office cannot disagree with visit location.
3. Photo cannot be borrowed from another intake.
4. External visit cannot omit its host.
5. TEMP_ID cannot carry project/host fields.
6. Visit time interval cannot be empty/reversed.
7. Initial single-day request cannot silently cross another local day.
8. Two current pass versions cannot exist for one visit.
9. Truncated credential hashes are rejected.
10. Noncurrent pass must be revoked.
11. Presence cannot use another visit's last movement event.
12. Movement cannot substitute another visitor's pass.
13. Movement office cannot differ from visit office.
14. Approval snapshot must match its individual visit.
15. One photo asset cannot represent two final visitors.
16. Unknown scan cannot pretend it belongs to a known visit.
17. PROCESSING notification requires its owner/lease fields.
18. Role/scope discriminator combinations must be compatible.

Synthetic fixtures are rolled back; identity counter gaps are possible. These tests deliberately inspect relational constraints and do not prove a host/guard was actually authorized by an application service.

## 03. Transaction acceptance matrix (implemented subset is recorded in reports)

| ID | Concurrent/failure scenario | Required result |
|---|---|---|
| TX01 | Two guards submit ENTRY with different keys for the same outside visit | Exactly one success, one inside state, no duplicate successful event |
| TX02 | Same movement key retries after successful commit/response loss | Same authorized outcome; no second event; mismatched payload rejected |
| TX03 | Approve and deny race for one pending individual visit | One final decision; no mixed request/pass state |
| TX04 | Entry races credential reissue/cancellation | Common visit lock defines one commit order; no stale pass entry after revocation wins |
| TX05 | Role/guard allocation revocation races movement | Authorization-lock commit boundary enforced; later request denied |
| TX06 | Two TEMP_ID intakes submit simultaneously for one employee/office/day | One usable slot/current visit returned; no parallel issued daily passes |
| TX07 | Overlapping same-employee/project requests arrive together | Serialized overlap rule; no duplicate conflicting entitlement |
| TX08 | Worker dies after claim, before send | Lease expires/reclaims within retry policy; job is not permanently stuck |
| TX09 | Worker dies after provider acceptance, before acknowledgement | Possible duplicate email understood; no duplicate business mutation |
| TX10 | Old worker acknowledges after a different worker reclaimed | Owner-bound update fails; no overwrite of newer lease |
| TX11 | Expired/revoked/reissued visitor remains INSIDE | Authorized normal/reconciled EXIT closes presence with audit, never grants new entry |
| TX12 | Manager contact cannot resolve | Pass still issued; visible retry/dead notification and support action |
| TX13 | Batch submission response lost, then retried | Same independent visit results, no partial or duplicate registration |
| TX14 | Submitted identity/photo/target/window is changed afterward | Ordinary mutation rejected; fresh material change requires new individual request |
| TX15 | Allocation revoked while Socket.IO is connected | Future unrelated data stops; refreshed scope and no-store protected resources |

## 04. Phase status and next gate

Phase 01 design deliverables are present: reasoned domain model, four Chen explanatory boards, full dictionary, concrete schema/reference migrations, permissions and transaction contracts, and validation sources/results. No application feature or production deployment is implied.

The baseline and Phase 02A/02B database gates passed; documents 07/08 state exact transaction/worker scope. Phase 02C implements SQL and internal guard ID/password verification, setup/reset, throttling and fenced sessions; document 10 distinguishes actual hashing/SQL checks from pending HTTP/browser and rollout gates. No permanent sample passwords or real service identities are provisioned. Phase 02D implemented atomic independent registration, daily Digital ID issuance/reuse, employee project overlap and actual photo/QR internal services; see document 11. Phase 02E adds scoped operational list/detail, guard verification and photo authorization; document 12 states limits. Phase 02F adds reissue/print and branded landscape card rendering (document 13). Phase 02G changes cards to neutral identity QR before approval and supports all projects assigned to a shared-area guard with explicit per-action targets (document 14). Phase 02H implements trusted card details, source binding and the shared approved renderer (document 15), with 55 print SQL cases and 98 full unit tests. Phase 02I adds individual cancellation and preserved occupancy (document 16). Phase 02J implements scoped allocation and role mutations (document 17). Phase 02K implements scoped admin reads/report/audit (document 18). Production SQL adapter, HTTP/UI, real directory/SSO/mail, HTTP/UI, sockets and physical printer/device acceptance remain pending. All tests use disposable synthetic identities; no real visitors/messages/deployment occurred.

## 05. Remaining integration/policy inputs

The user authorized a replaceable mock directory API boundary and will integrate the real API later; missing API access no longer blocks local development. Real response mapping/authentication, immutable employee SSO identity, freshness/revocation semantics and manager contact behavior still require integration verification. Guards explicitly use ID/password, not SSO. Other inputs are M365 tenant support, gateway routes, Linux validation on the selected Express edition, key-store/restore, printers, retention and downtime governance. Pilot limits are provisional, not enterprise approval.

## HTTP transport increment (20 October 2026)

The current transport regression is 169/169 passing Node tests (34 new transport cases). Six startup identity-admission cases pass on actual SQL using disposable users rolled back after testing. See [HTTP and SQL adapter](19_HTTP_and_SQL_Adapter.md) and `database/validation/transport-unit-report.json`. Production TDS connectivity, HTTP-to-live-SQL end-to-end validation, browser acceptance and Linux rollout are not claimed. Previous phase evidence/archives remain historical. Physical printer testing stays deferred to final acceptance.

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
