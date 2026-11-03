> Documentation status: historical implementation/design/evidence record, indexed 3 November 2026. Read the [current handbook](system/README.md) and [Visit owner/Host glossary](109_Visit_Owner_and_Host_Terminology_03_November_2026.md) for current behavior. Counts, setup examples and screenshots below describe their dated stage, not a fresh certification.

# OOP / SOLID architecture audit — 2 November 2026

The review covers the application's source dependency graph, service/adapter boundaries, state ownership, SQL authorization boundary and the largest presentation/orchestration modules. It is an architecture and regression review, not an independent security certification. The current source contains 205 TypeScript/JavaScript modules; all are included in the static dependency check.

## Findings and fixes

| Finding | Change and practical effect |
|---|---|
| Several use cases imported SQL parameter types from the concrete `mssql` adapter. | Added application-owned `contracts/Sql.ts`; affected business modules now depend on that contract. The driver, procedure admission and pool remain in the adapter. |
| Guard, Admin, planning and operations imported session hashing from `ReceptionService`. Other use cases duplicated canonical token hashing. | Added `security/SessionProof.ts`; shared hashing/validation is feature-independent. Existing reception/email/domain error contracts are retained by compatibility wrappers/factories. Registration, visit reads and printing reuse the same canonical digest helper. |
| Host reminders threw HTTP errors inside a business service. | Added controlled `HostReminderError` codes; HTTP adapters translate them. A regression verifies unchanged 400/403/409/503 responses and private SQL error redaction. |
| Graph transport obtained its interface/error from the registration email worker. The daemon loop also depended on that concrete worker type. | Added independent mail message/transport/directory/renderer/batch contracts. Graph, combined batches and daemon scheduling depend on those small contracts. Old worker exports remain compatible. |
| Planning mail combined validation, HTML layout and dispatch/lease orchestration. | Separated `PlanningMailContent`, `PlanningMailRenderer` and the injected-port worker. The worker is now 153 lines; rendering and provider dispatch can be tested independently. |
| Planning service combined settings validation, command construction, projection normalization and RPC orchestration. | Separated pure `PlanningRequest` and `PlanningProjection`; service orchestration is now 40 lines. Unknown action names fail closed before selecting an RPC. |
| Admin page held 3,924 lines of sections and dialogs. | Extracted 17 presentation components. The page shell is now 732 lines, retaining the same model/actions, IDs, scope conditions and markup without added DOM wrappers. |
| Browser views imported pure expiry formatting from a server printing area. | Moved the implementation to browser/server-safe `shared/ValidityDisplay.ts`; retained the old printing export for compatibility. Formatting semantics remain unchanged. |
| Architectural intent was documented but not enforced across future imports. | Added `check:architecture` to CI and unit regression coverage for outward/type-only imports, browser/server boundaries, driver isolation and runtime cycles. Added explicit override, casing and switch-fallthrough compiler checks plus stricter lint rules for refactored modules. |

The existing use of injected repositories, private state, explicit procedure contracts, source adapters, pure planning policies and React model composition was retained. No artificial inheritance hierarchy or ORM/entity rewrite was introduced.

## Preserved behavior and work

No SQL migration or role grant changed in this refactor; migrations 001–132 remain the same. The authoritative permissions, pass issuance, approvals, return correction, movements and outbox transactions stay in SQL.

The actual Guard page, Reception page and global stylesheet are byte-identical to this task's starting state. Admin's shell/components preserve the operational controls, including its profile, reports, audit, account/guard management and QR poster. Existing unrelated local changes and the separate NHS checkout are preserved. No real mail, commit or push is included.

## Verification

- Unit/contract run: **710 tests, 709 passed, one platform skip, zero failures**. Included backend coverage: **97.99% lines, 91.03% branches, 94.61% functions** for the final source. Frontend-only rendering is not included in these percentages.
- Fresh isolated SQL: **40 schema/permission checks, 47 planning workflow/privacy checks and 27 mail queue/lease/recipient checks** passed. Six planning messages passed the real SQL/worker/Graph adapter using mock HTTP, with no network mail and no duplicate second-pass send.
- **12/12 real-SQL Coordination browser tests** passed; the owned disposable database was removed.
- Full 359-case browser sweep: **356 passed, one existing opt-in skip and two stale fixture-label expectations failed**. Both expected the old `Project 1` account name; actual UI and the agreed live demo fixture correctly use `Accounts 1`. After correcting those expectations, **all 10 workflow cases passed**, including both failed cases, role navigation, language/profile, employee host selection and phone/laptop accessibility. This combined evidence is not described as a second clean full 359-case run.
- A one-off AST comparison expands the 17 extracted Admin components into the page shell and confirms the original JSX and expressions are identical, ignoring indentation only. The full browser sweep passed the Admin scope, controls, dialogs, reports, QR poster, refresh and small-screen cases.
- Typecheck, ESLint, architecture, seven frontend bundles, all 132 migration hashes and release packaging passed. The package contains 363 allowlisted source files and explicitly retains its existing production-readiness limitations. Focused regressions cover canonical session hashing, renderer substitution, unknown planning commands and reminder HTTP status/redaction.

Evidence is private ignored output under `tmp/solid-*`, `tmp/verify-admin-extraction.mjs`, and `output/test-results/`. The original full-run log and corrected workflow log are separate. It does not contain a claim that every line was manually proven correct. The lasting rules and required review checks are in [the architecture maintenance guide](ARCHITECTURE.md).

## Continued maintenance

Some mature frontend models and legacy service projections still use dynamic record shapes and remain larger than newer modules. Their current regression coverage does not remove that technical debt; split/type them when their responsibility or behavior changes. Production composition, organization SSO/directory/mail acceptance and automatic planning-to-existing-card handoff remain the previously documented separate work, not completed by an OOP refactor.
