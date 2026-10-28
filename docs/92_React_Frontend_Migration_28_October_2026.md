# React frontend migration — 28 October 2026

The six main browser documents now render through React 19 and TypeScript/TSX. Existing URLs, CSS, form identifiers, server authorization, SQL procedures and business rules are preserved. This is an implementation migration, not a redesign or a change to account/approved-host policy.

## Page ownership

| Page | Authoritative view | State and interactions |
|---|---|---|
| Staff sign-in, password setup and workspace resolution | `src/frontend/pages/StaffPage.tsx` | Native React hooks in `staffModel.ts` |
| Office self-service and reception manual registration | `src/frontend/pages/SelfServicePage.tsx` | Native React model and components under `selfService/` |
| Guard workspace | `src/frontend/pages/GuardPage.tsx` | Native React model, cards and language/readings components under `guard/` |
| Reception workspace | `src/frontend/pages/ReceptionPage.tsx` | Native React model, history/cards and print coordinator under `reception/` |
| Administration, including its seven modules | `src/frontend/pages/AdminPage.tsx` | Native React scope, account, staff, roster, register and record modules under `admin/` |
| Email approval and request status | `src/frontend/pages/EmailPage.tsx` | Reactive model in `emailModel.ts`, rendered with React state subscriptions |

All six are real JSX page components with native React-owned state, lists, forms, dialogs and event handlers. No legacy DOM page controller is mounted. There is no page-wrapper iframe or runtime evaluation of source strings. Reception manual intake continues to use its existing isolated, staff-authorized registration frame; that embedded form itself is a native React self-service page.

`src/app/reception-print.html` and the PWA offline document remain HTML. Existing feature CSS remains authoritative for appearance. Old six-page HTML templates, page scripts and shared DOM-controller widgets remain reference/test material, not inputs to the React page build. The old compatibility lifecycle/DOM proxy and controller virtual modules have been removed. The fixed QR decoder and register-export worker remain independent browser assets.

## Development policy

- New page views and new UI features use TypeScript/TSX and React components under `src/frontend`.
- Prefer React state and event handlers for new interactions. Do not add new standalone HTML page templates or expand the old template-based page assembly.
- Keep backend/service/SQL authorization unchanged unless a separately reviewed business change requires it.
- Maintain native React state/components under `src/frontend`. Preserve request generations, scoped permission checks, idempotency keys and effect cleanup when changing interactions; do not reintroduce a legacy DOM controller on a React-owned subtree.
- Reuse existing CSS tokens/layout. CSS is still required with React; adopting React does not remove CSS or browser JavaScript.

## Build and runtime

`npm run build:frontend` bundles six independent production assets through `tools/frontend-build.mjs`. `src/app/ReactDocuments.ts` emits a minimal, nonced document and escaped non-secret JSON configuration. The local runner serves the matching immutable hashed asset. There is no runtime Babel/compiler, runtime `eval`, or weakened CSP requirement.

Native models own resource cleanup: unmount aborts outstanding requests, invalidates request generations, removes listeners/observers, closes SSE/poll timers and releases private image URLs and camera tracks. Shared React components own modal/select portals, image viewing, follow-ups and notification lifecycles. Page restoration starts a fresh authorized context. Production assets omit all test-only inspection/setter hooks. React PWA installation controls preserve the existing cache restrictions.

Production bundle builds omit the browser-test inspection hooks. Release packaging builds the current six assets explicitly rather than copying stale generated output. The release candidate remains marked `deploymentReady: false`: corporate providers, complete production web composition and organization/device acceptance are still pending.

## Verification scope

Backend Node coverage excludes browser-only `src/frontend/**`; frontend behavior is checked in Playwright rather than counted as backend coverage. Tests do not certify corporate SSO, Google station login, actual email delivery, physical printing or managed Android tablets.

### Native-interaction verification

| Check | Observed local result |
|---|---|
| Node unit/contract suite | 639 total: 638 passed, one platform skip, zero failures |
| Included backend coverage | 97.39% lines, 89.96% branches, 94.05% functions; excludes browser-only React source |
| Complete native React browser run | 355 cases: 353 passed, one opt-in skip, one initial-sign-in failure in the group-authority test; the corrected four-case authority file passed, followed by 12/12 repeated authority cases including an observed saturated-window wait |
| Public/employee actual HTTP + SQL | 25 passed; SQL artifacts verified and owned fixtures cleaned |
| Reception manual actual HTTP + SQL | 7 passed; SQL artifacts verified and owned fixtures cleaned |
| Phone/laptop baseline comparison | All 12 images at 390/1366 CSS pixels have identical dimensions; 11 have no pixels differing by more than 12 RGB levels. Desktop Admin has 12 such pixels (0.00097%); no layout difference |
| Static/build checks | Typecheck, ESLint, six production bundles, 121 migration hashes and release packaging passed |
| Production packaging | 311 allowlisted files; generated test inspection/setter hooks and actual `.env` absent; deployment readiness remains false |
| Dependency/history checks | npm audit: zero known vulnerabilities; pinned Gitleaks history scan: no leaks |
| Release content scan | Earlier candidate scan found no credentials after independently verifying and narrowly excluding SHA-256 values in the two generated integrity manifests. The final repeat could not download the pinned scanner because of network connection timeouts; it is not reported as passed |

Native conversion regression fixes include viewport-lazy account lead requests with a concurrency limit of three, superseded office/profile/search responses, authorization loss clearing private state, registration retry payload/key preservation, camera/crop cleanup, modal close-event races, nested select focus, thumbnail generations, Action Centre focus/timer restoration, follow-up detail hydration and print receipt/retry behaviour. The Reception outline button hover now uses the existing darker red token to meet contrast requirements. Existing return/correction, host/reminder, account-group, status/expiry, language and export consistency rules are preserved.

The first full native-interaction sweep recorded 340 passes, 14 failures and one opt-in skip. Findings included real interaction regressions, retired test-only inspection names and two browser-page setup timeouts. Corrective runs resolved those findings; this earlier sweep is not reported as a clean run. The later complete sweep above reduced this to one initial-sign-in failure, with all other enabled cases passing. The remaining failure occurred before the group-entry assertion: the owned identity was eligible, but the harness only paced the second login against the shared source budget. The harness now conservatively waits out a measured saturated source window before either login, without resetting or disabling security limits or retrying unexplained credential failures. The focused authority file passed all four cases after this correction. A further three repetitions passed 12/12 cases and exercised the measured saturated-window wait before completing the revoked-group ENTRY denial. This is a combined full-run and focused-retest result, not a claim that the complete 355-case run itself was green. The earlier six-document migration had its own 352-case checkpoint and authentication-budget correction; it is historical rather than evidence for the completed native implementation.

The test harness retains the real authentication source budget. Successful sign-ins and password-setup inspection/completion share that budget. It reads only numeric budget state and waits before a login when a saturated window is measured, including before the first owned login has an attempt row; it neither disables limits nor resets shared security state. Owned SQL fixtures are isolated and cleaned. Presentation data and unrelated local artifacts are preserved; no real mail is sent by these integration checks.

Evidence is local and ignored by Git: `tmp/native-react-unit-2.log`, `tmp/native-react-full-final.log`, `tmp/native-authority-auth-final.log`, `tmp/native-authority-auth-stress.log`, `tmp/native-public-http-sql.log`, `tmp/native-manual-http-sql.log`, `tmp/native-final-typecheck.log`, `tmp/native-final-lint.log`, `tmp/native-final-release.log`, `tmp/native-final-migrations.log`, `tmp/native-final-secrets.log`, `tmp/native-release-secret-scan-verified.log`, `tmp/native-release-hashes.log` and `output/react-parity/native-comparison.json`. Screenshot baselines cover six primary page states; browser tests and additional inspected screenshots cover populated dialogs and interactions. Dependency/security results are point-in-time checks. The final `tmp/native-release-secret-scan-verified.log` records the failed scanner download, superseding the earlier successful candidate-scan log; the release integrity check was rerun successfully.

## Publication

This migration is local until explicitly published. It does not update the separate NHS working copy or perform a deployment. Actual `.env`, private media, tokens and screenshots stay outside source publication.

## Later secret-scan resolution

The subsequent [pre-pentest audit](93_Pre_Pentest_Security_Audit_28_October_2026.md) resolved the scanner-download blockage by verifying the retained official Gitleaks archive checksum and extracting a fresh scanner executable. Reachable Git history, an isolated snapshot of current publication sources and the final release candidate are scanned separately there. This supersedes the download-pending status above; that earlier failed attempt is retained as historical evidence.
