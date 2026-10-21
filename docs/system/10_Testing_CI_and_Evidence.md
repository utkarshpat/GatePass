# 10. Testing, CI and evidence

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
azure-pipelines.yml runs Quality on main pushes/PRs, excluding docs/** and root README.md. Ubuntu 24.04/UseNode@1 26.8.2 runs redacted history secret scan, cached npm ci, npm audit high/critical threshold, typecheck, lint, migration integrity, unit/JUnit/coverage and allowlisted release-candidate packaging. Gates are 90% lines, 80% branches, 90% functions over included TypeScript source.

Dependency vulnerability results change; an old green run is not a current npm audit guarantee. Documentation makes no dependency upgrades/purchases.

## Opt-in integration
runIntegration defaults false. Windows 2025 creates isolated private LocalDB, then sequentially runs TransactionCore, Registration, GuardDuties, PassPrinting, EmailWorkflow, OutlookActions and PublicRegistration, followed by Chromium workflows. Do not concurrently mutate shared fixtures in one local database.

runStagingSmoke defaults false and probes an existing configured HTTPS origin/security properties. It does not deploy or prove authenticated end-to-end readiness. Heavy checks remain opt-in for hosted-minute control. Actual organization entitlements determine billing. Required branch checks/review/bypass policy must be configured separately in GitHub; YAML cannot prevent administrator bypass.

## Known limits
Earlier intermittent SQL 547 in reception print has no confirmed root cause. Final SQL/HTTP runs did not reproduce it; it remains tracked, not declared fixed. A separate SQL 1205 arose from concurrent fixture mutation. Sequential CI avoids that collision but does not prove all application deadlocks are solved.

Publish appropriate JUnit/coverage/sanitized logs. Do not automatically publish authenticated screenshots/traces/videos, private photos, credential inventories, SQL dumps or secrets. The user's synthetic screenshot export is a separate explicit artifact.

## Acceptance matrix
Cover same-day reuse, cross-office denial, membership revocation/replay, independent group decisions, host mismatch/stale snapshot, expected/inside queues, alternate-guard departure, common-duty non-movement, cancelled-occupant reconciliation, print retry/live status/reprint, media scope, signed-link expiry/revocation, worker fence loss and opposite/repeated Outlook decisions. Add corporate identity, supported cameras/PWA/languages, printers, measured load and recovery before production approval.

Sources: azure-pipelines.yml; tools/ci; tests; docs/31_CI_Checks_and_Limits.md; docs/37_Reception_Audit.md.
