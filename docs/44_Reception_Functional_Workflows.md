# Reception functional workflows

22 October 2026. Implements the reception follow-up to audit 43. Existing local visual changes were retained and repaired. No commit, push, production deployment, real approval or real email delivery is included.

## Product behavior

- The account icon opens Profile and Sign out, with keyboard navigation and outside-click dismissal. Profile rechecks the current context and shows the operator and assigned offices with view/print access. There is no language control.
- The main page uses the server's current India office date. History opens a separate date-browsing dialog with complete scoped pagination, within the existing 30-day past/90-day future operational window. History cannot change the main date. Midnight refresh preserves the selected history day.
- View pass has an eye SVG. The authorized card appears above person/request details and the entry/exit timeline. Actual host name, email and requested project come from validated scoped API fields. Temporary IDs display the employee's own assignment summary; no applicant ID is presented as a host.
- Expired, denied, cancelled and revoked passes, or accounts without printing permission, have no Print/Reprint action. These records retain a read-only summary without an entry credential and authorized details/history. Pending printing remains supported by the existing policy; a pending printed pass does not authorize entry.
- Row Print/Reprint directly validates the current pass and uses an isolated same-origin print document to invoke the browser's native print dialog. It does not open View pass or a new browser window. Renderer request/status/idempotency fencing and intentional reprint keys remain in use. Printer output/cancellation is not claimed as confirmed: counters represent handoffs.
- Registered/pending/inside/handoff metrics and matching count use the visible filtered registrations. Inside is deduplicated by employee for Temporary IDs and is explicitly labelled matching presence, not whole-building occupancy. Search wording now matches supported fields.
- Manual registration is a real visitor intake, not a success-toast placeholder: required country-aware phone, optional email, office-bound projects, matching host lookup, purpose/date, photo capture/upload, review and submission. Multiple visitors retain independent requests and approvals. The complete existing visitor wizard runs inside the manual dialog; it uses a separate intake capability and cookie namespace. Employee Temporary IDs still require employee authentication through the employee self-service flow; the operator cannot invent an employee identity.

## Security boundaries

ReceptionRegistrationRoutes validates the staff session/CSRF and current assigned office on every manual operation. Its API accepts only external visitor requests. The configured office comes from the authorized reception context; submitted JSON cannot override location or raw validity timestamps. The same RegistrationService, normalization/private photo store, host/project validation, idempotency and notification outbox are used as public registration.

Successful manual submission also records RECEPTION_MANUAL_REGISTER with the actual operator. The audit procedure requires both the current authorized receptionist and the signed intake's hashed token/CSRF proof. It validates submitted public intake/EXTERNAL visits and office scope, serializes by intake and avoids duplicate audit entries on retries. Submission can commit before its separate audit acknowledgement; an acknowledgement failure remains an error, and the same request key/intake must be retried. The frontend retains that retry instead of inventing success.

Public and reception intake cookies are isolated. A manual form cannot alter another public form's office/intake. The manual frame may send only close/refresh hints to its same-origin parent; messages confer no authorization. Closing it removes the frame/camera session. Logout and pagehide remove private details/images and scrub list content; a restored page reauthenticates and reloads its context. Live context refresh also updates office/print grants.

Forward migration 065 extends the reception list and reception-only detail projection with trusted host contact, adds assignment display metadata and the manual audit procedure. Migration 066 corrects that audit's intake-type check to the actual PUBLIC intake contract. Migration 067 adds a bounded, authorized employee-project timeline for reception: employee identity links replacement IDs, while project locations constrain all events/presence to the authorized office. Guard actions and movement authorization are unchanged. Earlier migrations were not rewritten.

Typed production/development SQL allowlists include only the two new reception procedures. Photos, private paths, ciphertext, QR keys and render claims remain behind their existing boundaries; API list/detail fields are explicitly projected. Authorized card images intentionally contain the pass credential. History/printing cannot be used to fetch another office's records.

## UX and implementation corrections

Corrected filtered counts, stale host mapping, date-heading mismatch, expired print affordances, invalid definition-list markup, KPI keyboard activation, text contrast and phone overflow. Reception styles are no longer injected into guard/admin/login pages: shared staff header/workspace rules now live in workspace-shell.css, and reception owns its content styles.

No administrative delegation, host decisions, guard movement actions or extra employee workspace was added. Organization SSO/mail setup and physical printer acceptance remain deployment dependencies.

## Verification

Executed evidence and final counts are recorded below after the final validation runs. Tests use synthetic people and exact owned-fixture cleanup. No real emails or physical prints are sent by these checks.

- Final full unit/contract coverage run: 425 tests, 424 passed, one platform-specific skip, zero failures; measured local TypeScript coverage 95.83% lines, 88.49% branches, 94.57% functions. Includes the two explicit new API procedure grants and their allowlist assertions.
- Actual manual reception HTTP/SQL journey: six groups passed, verifying operator/office restrictions, isolated intake, real normalized photo, actual pending submission, same-key reuse, real host/project/email, protected card output, one audit row and one approval notification. Owned records removed.
- Actual presence/timeline SQL suite: six groups passed, now also asserting employee project timeline visibility, denial to a guard using the reception procedure, replacement-ID history and current presence after exit. Owned fixtures removed.
- Actual broader public/employee/reception/email HTTP/SQL journey: 25 groups passed with SQL artifact verification and cleanup. Initial attempts reproduced the existing intermittent SQL_52001 development-session denial in employee/guard steps; a diagnostic rerun completed successfully without weakening authorization or retrying individual business mutations.
- Initial browser regression exposed contrast failures in shared admin/reception styling. These were fixed by separating the shared shell and correcting header contrast. The 15 affected browser cases then passed, including native-print invocation without popup, host details, profile/history, expired controls, manual-frame initialization and phone/laptop accessibility. Final full-suite status is appended below.

Final full Chromium suite: all 29 cases passed, including public/employee, guard, admin, reception, history/date rollover, real-form initialization and accessibility. Expired/read-only records display a summary without a QR credential. Native browser print invocation is verified without opening a new browser page; physical printer output/cancellation remains outside automated proof.

All 55 actual SQL print/replacement lifecycle cases passed with cleanup. One test initially assumed zero print jobs in the entire shared development database, which already contained two unrelated jobs. Its rollback assertion now checks zero jobs only for its exact owned fixture while retaining the original owned pass-count and injected-audit-failure assertions. Existing user jobs were not deleted. The final run passed.

Type-check, lint, JavaScript syntax checks, all 67 sequential migration hashes and diff whitespace checks passed. Localhost was restarted with the final code. No push was performed.

Ignored evidence is under tmp/reception-*.log; generated browser/test outputs are under output/. Physical printer, enterprise SSO and organization Graph mailbox delivery are not verified by this development suite. No bug-free claim is made.
