# 10. Testing, CI and evidence

> Current React migration execution and its explicit verification limits are recorded in [28 October native React migration evidence](../92_React_Frontend_Migration_28_October_2026.md). The [24 October browser/presentation report](../67_Final_Browser_Verification_And_Presentation.md) and the 23 October counts below are historical. Current migration integrity covers **131** files.

> Current source documentation: **2 November 2026**, migrations **001â€“131**. See [current release/configuration evidence](../88_Documentation_And_Release_28_October_2026.md), [individual visitor flow](../85_Individual_Visitor_Registration_27_October_2026.md), [runtime .env configuration](../86_Runtime_Environment_Configuration.md) and [organization requirements](../87_Organization_Production_Requirements.md). Earlier exported PDFs, screenshots and dated reports are historical.

Fresh 23 October evidence: all 65 Chromium/Axe browser tests passed on the final full rerun. 458 unit tests passed with one skip; coverage is 95.42% lines / 88.87% branches / 94.12% functions. All 15 selected live SQL/HTTP suites pass, including registration (57), guard duty (19), admin reads (38), printing (55), public/employee HTTP/SQL (25) and manual reception HTTP/SQL (7). The retained browser runner separately persists realistic synthetic records and verifies decisions, movement/return/correction, real rendered QR decoding, new staff setup/login and Excel export. Signed holder-cookie exchange/reload and employee status/card checks use actual local SQL and signing keys without sending mail. See the linked report for final browser counts and artifact paths.

## Confidence layers
| Layer | Proves within scope | Does not prove |
|---|---|---|
| Typecheck/lint | Static contracts/quality | SQL or deployed identity correctness |
| Unit/contract | Input, adapters, retry, rendering, security cases | Actual provider/client acceptance |
| Restricted SQL | Permissions, constraints, scope, transaction races | Full deployment/network/browser correctness |
| Real HTTP + SQL | Connected authorization/persistence/rendering | Corporate SSO/physical printing |
| Browser + Axe | Selected workflows, overflow, dialogs/accessibility rules | Complete usability/translation/device/accessibility certification |
| Organization acceptance | Real identity/mail/Outlook/printer behavior | Not established by local previews |
| Restore/load/soak | Measured operational resilience/capacity | Still rollout work |

## Recorded baseline
The 22 October reception audit records 376 unit tests with coverage, 55 actual SQL print/replacement cases, 23 registration/reception/email HTTP+SQL cases and 12 browser/accessibility cases passed. The two reception popup cases were repeated after final counter changes. These are previously recorded local results, not rerun or recertified during documentation authoring. Older documents have smaller phase-specific counts.

The screenshot package mixes actual UI with some intercepted synthetic responses. Populated cards/approval buttons prove rendering only; its source index distinguishes fixtures from live reads/test-account screens.

## Default pipeline

The React migration adds `npm run build:frontend` to quality checks. Browser-only `src/frontend/**` is excluded from backend Node coverage; Playwright covers its behavior, resource cleanup and existing workflow parity separately. Backend coverage percentages must not be presented as full frontend coverage. See [migration evidence](../92_React_Frontend_Migration_28_October_2026.md).
azure-pipelines.yml runs Quality on main pushes/PRs, excluding docs/** and root README.md. Ubuntu 24.04/UseNode@1 26.8.2 runs redacted history secret scan, cached npm ci, npm audit high/critical threshold, typecheck, lint, migration integrity, unit/JUnit/coverage and allowlisted release-candidate packaging. Gates are 90% lines, 80% branches, 90% functions over included TypeScript source.

Dependency vulnerability results change; an old green run is not a current npm audit guarantee. Documentation makes no dependency upgrades/purchases.

## Opt-in integration
runIntegration defaults false. Windows 2025 creates isolated private LocalDB, then sequentially runs TransactionCore, Registration, GuardDuties, PassPrinting, EmailWorkflow, OutlookActions and PublicRegistration, followed by Chromium workflows. Do not concurrently mutate shared fixtures in one local database.

runStagingSmoke defaults false and probes an existing configured HTTPS origin/security properties. It does not deploy or prove authenticated end-to-end readiness. Heavy checks remain opt-in for hosted-minute control. Actual organization entitlements determine billing. Required branch checks/review/bypass policy must be configured separately in GitHub; YAML cannot prevent administrator bypass.

## Known limits
Earlier intermittent SQL 547 in reception print has no confirmed root cause. Final SQL/HTTP runs did not reproduce it; it remains tracked, not declared fixed. A separate SQL 1205 arose from concurrent fixture mutation. Sequential CI avoids that collision but does not prove all application deadlocks are solved.

Publish appropriate JUnit/coverage/sanitized logs. Do not automatically publish authenticated screenshots/traces/videos, private photos, credential inventories, SQL dumps or secrets. The user's synthetic screenshot export is a separate explicit artifact.

## Acceptance matrix
Cover same-day reuse, cross-office denial, membership revocation/replay, independent decisions for separate visitor registrations, host mismatch/stale snapshot, expected/inside queues, alternate-guard departure, common-duty non-movement, cancelled-occupant reconciliation, print retry/live status/reprint, media scope, signed-link expiry/revocation, worker fence loss and opposite/repeated Outlook decisions. Add corporate identity, supported cameras/PWA/languages, printers, measured load and recovery before production approval.

Sources: azure-pipelines.yml; tools/ci; tests; docs/31_CI_Checks_and_Limits.md; docs/37_Reception_Audit.md.

## 27 October evidence
The final configuration/validity unit run has 633 tests: 632 pass, one platform skip, zero failures; coverage 97.34% lines, 89.94% branches, 94.17% functions. Registration SQL has 58 passing cases; public/employee actual HTTP+SQL has 25; reception manual actual HTTP+SQL has 7. Two focused six-case browser runs cover individual visitors/accessibility and card/employee regressions. Full pre-push browser results are recorded in report 88. These local checks do not establish corporate SSO/Google/mail/printer/restore acceptance.

## Account host policy update

See [accounts and approved hosts](../89_Accounts_And_Approved_Hosts_28_October_2026.md). Account-office host lists are explicit and administered within scope; membership alone does not enable hosting. Legacy API/schema names remain compatible.

## 28 October native React completion evidence

All six primary pages now use native React state/components. The latest unit/contract run has 639 tests: 638 passed, one platform skip and zero failures. Included backend coverage is 97.39% lines / 89.96% branches / 94.05% functions; browser-only React files are not included in those percentages. The complete 355-case browser sweep recorded 353 passes, one opt-in skip and one initial-sign-in failure in the group-authority harness. After correcting source-budget pacing before either owned login, its four-case file passed, and three further repetitions passed 12/12 cases including an observed saturated-window wait. This combined evidence must not be described as a clean 355-case full-run result.

Actual public/employee HTTP+SQL passed 25 cases and Reception manual HTTP+SQL passed seven, with SQL artifacts verified and owned fixtures cleaned. Typecheck, ESLint, 121 migration hashes, production bundle/release checks, zero-vulnerability dependency audit and the earlier redacted history/candidate secret scans passed. The final candidate-scan repeat was blocked by a scanner-download network timeout and is not counted as passed; final integrity hashes were verified. All 12 phone/laptop baseline screenshots retain the same dimensions; 11 have no changes above a 12 RGB-level threshold and desktop Admin has 12 minor pixels above that threshold. Baselines cover primary states, not every possible page state. Detailed limits and local evidence paths are in [report 92](../92_React_Frontend_Migration_28_October_2026.md). Corporate provider, managed-device and physical-printer acceptance remain pending.

## Pre-pentest audit â€” 28 October

[Report 93](../93_Pre_Pentest_Security_Audit_28_October_2026.md) records the current source/local security review, final publication-source/history/release secret scans and staging blockers. An actual SQL reproduction found that extra direct object permissions could pass runtime identity admission. The probe is hardened and 18 SQL admission cases pass, including all seven intended clean runtime roles. Staff authentication passes 29 SQL cases; scoped host/group SQL suites and the corrected 15-case browser security selection pass. Four browser cases explicitly verify hostile HTML/event-handler input remains text at phone/laptop widths; workbook tests verify formula-looking values remain inline strings. These are selected regressions, not independent pentest certification or deployed infrastructure acceptance.

## Pentest risk hardening â€” 28 October

[Report 94](../94_Pentest_Risk_Hardening_28_October_2026.md) supersedes the earlier local audit counts. Final Node verification has 654 cases: 653 passed and one platform skip, with included backend coverage 97.44% / 90.20% / 94.11% (lines/branches/functions). A full 359-case browser run passed 358 and skipped one; the later login/setup admission classification follow-up has focused transport/auth/config and fresh HTTP+SQL verification, rather than a second full browser run. SQL identity admission passes 21 actual cases. Public/employee and manual Reception HTTP+SQL pass 25 and seven. The report distinguishes fixed SQL/admission/config/password gaps from unimplemented production composition/identities and staging/infrastructure acceptance.

## Visit Coordination â€” 1 November 2026

[Report 98](../98_Visit_Coordination_Persistence_01_November_2026.md) records 683 unit/contract tests (682 pass, one platform skip), 127 migration hashes, 33 isolated schema/permission checks, 35 execute-only persistence/workflow checks, eight real-SQL Coordination browser tests, and the existing browser suite (358 pass, one opt-in presentation skip). Phone/laptop accessibility, private thread boundaries, settings persistence, retry and page-cache privacy are covered. Actual local sign-in/workspace navigation also passed. Corporate identity/mail and automatic handoff to the existing card workflow remain pending; this evidence is not production or pentest certification.

[Report 99](../99_Location_Sponsored_Cross_Account_Invitations_01_November_2026.md) supersedes destination-host selection restrictions: 684 unit tests (683 pass, one skip), 128 migration hashes, 33 isolated schema checks, 47 persistence/scope checks and 12/12 real-SQL planning browser tests passed. Retained employee1/2/4 sign-in confirmed all three configured Noida destinations without new destination host grants.

[2 November planned-pass evidence](../100_Planned_Pass_Binding_And_Destination_Gates_02_November_2026.md): 691 unit tests (690 pass, one platform skip), 130 migration hashes, 33 schema checks, 47 planning workflow checks, 28 planned-pass checks and 13/13 real-SQL browser tests. This is historical evidence for the withdrawn report-100 extension. It is not an active operator workflow; see the current coordination-only scope correction.

Current [coordination-only correction](../101_Coordination_Only_Scope_02_November_2026.md): 685 unit tests (684 pass, one skip), 131 migrations, 40 schema/permission checks, 47 planning checks and 12/12 real-SQL browser tests passed. Existing operational procedure definitions and guard/reception UI were restored; local guard/reception/host smoke passed.

[Coordination mail implementation](../102_Coordination_Email_Notifications_02_November_2026.md): 701 unit/contract cases (700 passed, one platform skip), scoped SQL outbox/recipient/privacy checks, six mocked Graph sends and 12/12 real-SQL Coordination browser cases. No actual network mail is sent by these tests. Automatic existing-card handoff and corporate delivery acceptance remain pending.

[OOP/SOLID architecture review](../103_OOP_SOLID_Architecture_Audit_02_November_2026.md): 205 source modules satisfy the dependency policy with no runtime cycles. The final 710-case unit run passes 709 with one platform skip; scoped SQL and 12/12 Coordination regressions passed. The full browser sweep had 356 passes, one opt-in skip and two stale account-label expectations; after correcting those test expectations the complete 10-case workflows file passed. This is combined evidence, not a repeated clean full-run result. Release packaging and static checks are recorded in that report.
