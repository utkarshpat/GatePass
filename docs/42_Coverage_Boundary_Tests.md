# Coverage boundary tests

22 October 2026. Follow-up to the Azure coverage screenshots after commit b7d46ad. Application behavior, authorization rules and coverage thresholds were preserved. This batch adds tests and labels the pipeline coverage publication more precisely.

## What the report measures

tools/ci/run-tests.mjs runs tests/*.test.ts under Node's TypeScript source coverage and writes output/coverage/lcov.info. Azure publishes that file from the Linux Quality job. The optional Windows SQL and browser job runs separately; its coverage is not merged into this LCOV. Frontend JavaScript and SQL procedure coverage are not measured by this report. A zero in this report does not establish that a route was never exercised by integration tests.

The new tests directly exercise previously uncovered HTTP adapters, while retaining their service dependencies as explicit test doubles. They verify routing and boundary contracts; the existing restricted SQL and browser suites remain responsible for end-to-end persistence and UI behavior.

## Added cases

- Admin and guard adapters: remote/unknown-route denial, revoked identities, authenticated actor forwarding, fixed guard read scope, limited grant roles/scopes, lookup results and input shape rejection.
- Guard photos: denied duties, pass replacement or revocation during a read, and private buffer clearing on both successful and rejected responses.
- Employee and email adapters: missing/mismatched CSRF, invalid or revoked sessions, OWN versus HOST scope, non-Digital-ID rejection, absent image provider, typed image denial, error redaction and photo reauthorization with buffer clearing.
- Staff sessions: absolute expiry even when the provider would still accept the token, logout for both providers, cookie clearing, old-session rejection, invalid password, remote callers and unknown paths.
- Reception: central-session verification, revoked-session rejection, CSRF, preview errors, two-render concurrency limit, cleanup after dispatch failure, released render capacity and returned buffer clearing.
- Outlook configuration: disabled mode, invalid tenant/application/scope, relative key paths, missing/malformed/failing provider factories, valid codec construction and cross-application capability rejection. Tests use synthetic local key modules; no Microsoft token request, mail or real approval is sent.
- Composition: separate API/auth/Outlook identities, database endpoint consistency and exact Outlook origin, rejected before any connection.
- Local storage bootstrap: test-root restrictions, non-Windows fail-closed behavior, and an actual Windows DPAPI-backed reopen/photo persistence test in an owned temporary directory. Platform-specific tests explicitly skip on the other operating system.

## Executed verification

The complete local Windows unit/contract suite passed: 419 tests, 418 passed, one non-Windows-only test skipped, zero failures. The earlier intermittent production-startup subprocess timeout did not recur in this run.

Measured local TypeScript coverage: 95.56% lines, 88.47% branches, 94.35% functions. Prior local coverage was 92.16%, 87.27%, 93.91% respectively. These Windows numbers should not be presented as the Linux Azure result; platform coverage and the LCOV report renderer can differ.

| Module | Local line coverage | Local branch coverage |
| --- | ---: | ---: |
| AdminRoutes | 100% | 91.67% |
| GuardRoutes | 100% | 95.24% |
| EmployeeDigitalIdRoutes | 100% | 96.15% |
| EmailWorkflowRoutes | 100% | 93.10% |
| StaffEntryRoutes | 100% | 83.72% |
| ReceptionRoutes | 97.96% | 86.15% |
| OutlookConfiguration | 100% | 80.95% |
| LocalPrivateStorage | 100% | 77.78% |
| Composition | 88.12% | 69.70% |

Type-check, lint and whitespace checks on this batch's tracked changes passed. A separate concurrent local edit to src/app/reception.html was preserved; its blank-line trailing whitespace is outside this batch. Ignored local evidence is in tmp/coverage-boundaries-full.log and tmp/coverage-targeted.log. SQL/browser suites were not rerun for this test-only batch; their earlier evidence is recorded in audit 41.

## Remaining limits

Full composition connection/cleanup paths, platform subprocess failure paths, local key-provider wrappers and additional provider/configuration branches remain partly uncovered. Linux intentionally cannot execute Windows DPAPI success paths. Coverage does not prove assertions are complete or establish bug-free behavior. Organization mail delivery, production identity/provider configuration and physical printer acceptance remain separate deployment checks.

No commit or push is included in this batch.
