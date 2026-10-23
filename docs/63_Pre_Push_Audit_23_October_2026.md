# Pre-push audit — 23 October 2026

The user authorized auditing all pending changes, fixing findings and then pushing. This supersedes the earlier hold on commits/pushes. The reviewed baseline is `daf679801b0524af51f3bb979773bbf8267c84b3` on `main`.

## Scope and findings

Reviewed the complete pending source/test/documentation diff, new SQL migrations 089/090, API/development procedure allowlists and routes, email capability purpose/expiry/binding, holder cookies, owner permissions, confirmation/idempotency, cancellation side effects, notification recipient mapping, Outlook photo fallback, register fingerprints and stale-office responses.

One additional application bug was reproduced and fixed:

- **[P2] Approved request pages could retain revoked status/media until pass expiry.** The existing polling delay used the full remaining validity for an approved pass. With an approved one-hour pass, a controlled remote revocation followed by 30 seconds of browser time still showed “Approved”, retained the download action and had made only one detail read. The page now refreshes every 30 seconds while pending/active, also respecting the earlier validity deadline. The backend already checked current state; this fixes the stale display. A regression checks a second detail read, “Revoked” status and removal of card/download without manual refresh or focus changes. Hidden tabs refresh on becoming visible.

One verification gap was closed:

- **SQL CI omitted the new revocation suite and the existing cancellation suite.** Both are now explicitly included in `tools/ci/Run-SqlChecks.ps1`, with the expected trusted-local-certificate argument. This preserves coverage of purpose-bound holder revocation and its shared credential/print/presence lifecycle on future integration runs.

The prior five fixes remain included: changed-data export detection, request deadlines, stale-office export isolation, optional Outlook photo-body visibility and correct employee receipt labelling. The subsequent confirmed holder-revocation flow remains purpose-separated from read-only email links. Migration files already applied locally were not rewritten.

## Validation

- Coverage-gated unit suite: **475 passed**, one platform-specific skip; **95.54% lines, 89.57% branches, 94.25% functions**, above the configured gates.
- Actual SQL register checks passed for scope, paging/sorting, movement fields and complete-projection fingerprints, including a changed field with unchanged row count.
- Actual SQL suites: **58 registration**, **9 holder revocation**, **30 cancellation** and **12 email workflow** cases passed in this audit.
- TypeScript, ESLint, **90 sequential migration hashes**, PowerShell CI-runner parsing, whitespace and credential scans passed. Both the full existing Git history and the complete staged diff were scanned. Dependency audit reported **zero vulnerabilities**.
- **94 distinct browser cases verified across the broad run and focused reruns.** The original broad run passed 89 of 93; all four initially failing live cases then passed in a separate four-case rerun. The final 11-case email-status run passed, including the additional remote-revocation regression. These are combined verified cases, not a claim that the initial broad attempt was entirely green.
- The updated main listener on `localhost:8443` passed a retained-register/XLSX smoke check. Its remote-revocation check made two detail reads after 30 seconds, showed “Revoked” and hid Download, confirming the audited script is actually served.

The initial broad browser run overlapped SQL fixtures on the shared local instance and encountered SQL memory waits, command/lock timeouts and a deadlock. These failures remain in ignored logs. Their separate rerun after the SQL suites finished passed: project-admin scope, retained presentation register/export/history, scoped project creation/assignments and signed visitor revocation. Cleanup for the two interrupted fixture runs was retried using only their exact recorded run IDs. No production resources or paid infrastructure were created.

## Data and delivery boundaries

Retained presentation requests, photos, staff, assignments and visit/access history are preserved. Disposable test fixtures are scoped by unique run IDs. No real email was sent by this audit, and no mail worker was started. Email rendering, capture-provider tests and the earlier user-confirmed delivered examples are distinct evidence. Direct native Outlook actions and production SSO/directory/mail onboarding retain their documented configuration requirements.
