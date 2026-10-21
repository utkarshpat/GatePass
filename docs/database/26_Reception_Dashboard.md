# Reception dashboard

Current authentication update: reception now uses independent local staff accounts through the common `/` entry. Employee-only sign-in details below describe the earlier implementation snapshot. See [staff identity and delegation](29_Staff_Identity_and_Delegation.md).
Entry: `/reception` on the existing local development server. Real corporate SSO remains an adapter integration; all authorization, reads, photo access, card rendering and print job transitions use the actual SQL database and protected storage.

## Screens and behavior

- Staff sign-in: email/password, icon visibility toggle, isolated reception session and CSRF cookies. Existing public employee sessions cannot substitute for a reception session. An ordinary employee has no implicit reception permissions.
- Workspace: authorized office, SQL office date, date/status filters, bounded server-side name/employee/pass-ID search, empty/error/loading states and 50-row cursor pagination. Desktop table becomes compact rows on mobile. No sample metrics or fabricated operational records are displayed.
- Details dialog: fresh pass details, person photo, purpose, validity, current status and card preview. Stale asynchronous results are discarded. Expired, revoked, denied and cancelled passes cannot be printed. Pending visitor identity cards remain printable according to the existing policy; project entry stays a separate live authorization.
- Print window: opened by an explicit user action. It receives only the authenticated rendering through exact-origin/source postMessage checks. The card is 85.6 × 54 mm in print CSS; the native browser print button opens the printer chooser. Physical printing/copies are not inferred from browser handoff.

Preview uses a separate read-only rendering path, with current-role/source checks before and after I/O, and does not request or dispatch a print job. Print uses the existing RequestPassPrint → BeginPassRender → FinishPassRender → DispatchPassPrint services. The artifact digest remains bound to the exact SVG delivered to the browser, not an unrelated converted file. A repeated client key reuses its job. A known dispatched job is not silently dispatched again; reprint is a fresh explicit action. The same QR remains subject to online guard authorization.

## Database and security

Migration 025 adds private `_RequireReceptionLocation`, API-only `GetReceptionContext` and `ListReceptionVisits`, and render-only `GetReceptionCardSource`. Migration 026 fixes the null scalar JSON empty-list case without changing an applied migration. There are 66 procedures; no new business tables or identity columns are introduced. Capability grants remain scoped to a reception role and active location. The list validates date/status/cursor/search bounds and never returns private paths, contacts, credential envelopes or unrestricted totals.

The development bridge selects an execute-only API, media or renderer principal from exact procedure names. Private photo bytes are resolved/revalidated by VisitPhotoService. Shared PassCardRenderer and private QR keys produce the actual individual cards. Source envelopes do not cross HTTP. Local staff-cookie authentication is loopback-only and checks exact Origin/Host, SameSite, CSRF and current SSO provenance. Production TLS/identity behavior is unchanged.

`database/development/002_seed_reception.sql` explicitly assigns synthetic employees 21/22/23/24 to Noida/Bengaluru/Chennai/Pune, with VISITS_READ and PASS_PRINT only. It neither grants admin/reissue permissions nor restores revoked grants/capabilities. No production users are created.

## Validation and remaining acceptance

Targeted service/route tests exercise scoped context, exact filter contracts, role denial, isolated cookies, failed-login session revocation, fixed read view and preview without dispatch. The existing public/employee HTTP/SQL suite also exercises the reception office filters, no-result search, pending preview/photo, duplicate print request, one-shot dispatch, distinct reprint, and logout. Owned print render state, jobs and request fixtures are removed by the test cleanup.

Evidence: `database/validation/reception-unit-tests.txt`, the reception migration reports, and `public-registration-integration-report.json`. These do not certify browser screenshot acceptance or a physical printer. Native print output, hardware, copies and enterprise SSO are the agreed later acceptance gates.
