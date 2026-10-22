# 03. Reception Desk & Printed Pass Returns

## Surface
- **Routes**: `/reception`, `/reception/print`, `/reception/register/<office-code>`
- **APIs**: `/api/reception/me`, `/api/reception/list`, `/api/reception/detail`, `/api/reception/photo`, `/api/reception/preview`, `/api/reception/print/request`, `/api/reception/print/status`, `/api/reception/print/render`, `/api/reception/remind-host`, `/api/reception/return`, `/api/reception/manual/*`
- **SQL Procedures**: `gp.GetReceptionContext`, `gp.ListReceptionVisits`, `gp.GetVisitDetail`, `gp.GetReceptionEmployeeTimeline`, `gp.GetReceptionCardSource`, `gp.RequestPassPrint`, `gp.GetPassPrintJob`, `gp.BeginPassRender`, `gp.FinishPassRender`, `gp.DispatchPassPrint`, `gp.RemindVisitHost`, `gp.ReturnReceptionPass`, `gp.AuditReceptionRegistration`

---

## Test Cases

### TC-REC-01: Reception Sign-In, Profile & Office Switching
- **Steps**:
  1. Sign in at `/` with `reception1@example.com` / `Sopra@123`.
  2. Verify redirect to `/reception` and office badge showing `Noida`.
  3. Open Account menu -> **Profile**, verify operator name and assigned office capabilities (`View and print` or `View only`).
  4. Switch office selector (`#reception-location`) if multiple offices are granted.
- **Expected Result**:
  - Switching offices resets search/approval/print/type filters, clears previous office rows/KPIs immediately, and loads the selected office's visits.

### TC-REC-02: Interactive KPI Cards & Toolbar Filters
- **Steps**:
  1. Verify KPI cards: **Registered** (`#kpi-total`), **Approval pending** (`#kpi-pending`), **Inside (matching)** (`#kpi-inside`), and **Pending return** (`#kpi-returns`).
  2. Click **Approval pending** KPI -> table filters to live pending requests (`!returnedAtUtc && passStatus === 'PENDING' && validUntilUtc > now`).
  3. Click **Inside (matching)** KPI -> resets approval filter to `ALL`, toggles `insideOnly`, and shows deduplicated employee/visitor presence.
  4. Click **Pending return** KPI -> loads office-wide unreturned printed passes (`pendingReturns: true`) across all dates.
  5. Filter by Print status (`Not printed`, `Printed`, `Pending return`, `Returned`), Type (`Employee`, `Visitor`), Search box, and **Clear** button.
- **Expected Result**:
  - All filters and `[data-status]` `aria-pressed` states remain synchronized.

### TC-REC-03: View Pass Details, Card Preview & Movement Timeline
- **Steps**:
  1. Click a visitor/employee row or the eye icon button (`View pass for ...`).
  2. Inspect `#visit-dialog`: Pass ID, Office, Project / Assigned projects, Host name & email, Purpose, Valid from/until, Print count, Card status, and Entry/exit timeline.
- **Expected Result**:
  - Printable passes (`PENDING` or `APPROVED`, active/pending pass, unreturned, not expired, `canPrint: true`) render the high-res card preview image (`#reception-card img`) and enable `#detail-print`.
  - Non-printable passes (expired, denied, cancelled, revoked, returned, or view-only operator) render a read-only pass summary without QR credentials and hide `#detail-print`.
  - Opening a stale row refreshes `status`, `isInside`, `passStatus`, `returnedAtUtc`, and `printCount` on the underlying table row.

### TC-REC-04: Direct Print & Intentional Reprint Handoff
- **Steps**:
  1. Click **Print** on a printable row (or **Print pass** inside `#visit-dialog`).
- **Expected Result**:
  - Hidden iframe `/reception/print` loads, `ReceptionPrintCoordinator` requests a print job (`gp.RequestPassPrint`), verifies live status (`gp.GetPassPrintJob`), renders and dispatches the card (`gp.BeginPassRender` -> `gp.FinishPassRender` -> `gp.DispatchPassPrint`), and invokes the browser print dialog.
  - Row badge updates to `Printed`, action button changes to `Reprint`, `#detail-print-count` increments, `#detail-card-status` updates to `Printed — awaiting return`, and **Pending return** KPI increments.

### TC-REC-05: Scoped Host Reminder & 5-Minute Cooldown
- **Steps**:
  1. Open `#visit-dialog` for a `PENDING` visitor or `EMPLOYEE_PROJECT` request.
  2. Verify `#remind-host` button and `#reminder-status` text.
  3. Click **Remind host**.
- **Expected Result**:
  - Calls `gp.RemindVisitHost` with an idempotent `clientKey`.
  - Enqueues a `HOST_APPROVAL_REQUEST` outbox row (if not already queued or within the 5-minute cooldown), disables `#remind-host`, and displays `Host reminder queued.`.

### TC-REC-06: Manual Visitor Registration (Isolated Iframe Intake)
- **Steps**:
  1. Click the floating **Manual registration** button (`#assistedFab`).
  2. Verify `#assisted-dialog` opens an iframe `/reception/register/<office-code>`.
  3. Complete Visitor details (Name, Mobile, Email), Project, Host, Purpose (`Contractor` / `Support staff` / `Business meeting`), Photo, Review, and Submit.
  4. Close the manual dialog.
- **Expected Result**:
  - Uses `/api/reception/manual/*` with `gp-reception-intake` cookies (isolated from public `/api/registration/*`).
  - Records `RECEPTION_MANUAL_REGISTER` in `gp.SecurityAuditEvents` attributed to the reception operator.
  - Parent reception table automatically refreshes to show the new visitor registration.

### TC-REC-07: Registration History Dialog (Multi-Day Range)
- **Steps**:
  1. Click **History** (`#open-history`).
  2. Select a `From` and `To` date range (within -30 to +90 days) and click **Refresh history**.
  3. Verify `From > To` validation message (`From date must be on or before To date.`).
- **Expected Result**:
  - History dialog paginates through all visits in the range without altering the main dashboard's `#reception-date`.

### TC-REC-08: Final Printed Pass Return (`gp.ReturnReceptionPass`)
- **Steps**:
  1. Locate a row with `printCount > 0` and `returnedAtUtc === null`.
  2. Verify that if `isInside === true`, the **Printed** button is disabled (`Project exit is required before return`).
  3. When `isInside === false`, click the **Printed** (`Mark printed pass returned for ...`) button.
- **Expected Result**:
  - Calls `/api/reception/return` with `visitRequestId`, `expectedPassId`, and idempotent `clientKey`.
  - Pass status becomes `REVOKED`, delivery links are revoked, in-flight print jobs/notifications are cancelled, badge changes to `Returned`, Print/Reprint buttons hide, and **Pending return** KPI decrements.
