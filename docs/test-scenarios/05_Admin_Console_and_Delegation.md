# 05. Admin Console & Scoped Delegation Scenarios

> 23 October presentation run: [current evidence and retained demo data](../55_Presentation_Rehearsal_23_October_2026.md). Earlier execution counts/cleanup statements in this catalog describe their dated runs; this presentation dataset is retained.

## Surface
- **Routes**: `/admin`
- **APIs**: `/api/admin/context`, `/api/admin/scope`, `/api/admin/projects`, `/api/admin/leads`, `/api/admin/candidates`, `/api/admin/grant`, `/api/admin/revoke`, `/api/admin/common-duties`, `/api/admin/common-duty`, `/api/admin/assignments`, `/api/admin/guards`, `/api/admin/allocate`, `/api/admin/deallocate`, `/api/admin/subjects`, `/api/admin/roles`, `/api/admin/summary`, `/api/admin/register`, `/api/admin/visits`, `/api/admin/visit-detail`, `/api/admin/audit`, `/api/admin/office-qr`
- **SQL Procedures**: `gp.GetAdminWorkspaceContext`, `gp.CreateScopedProject`, `gp.GetAdminConsoleScope`, `gp.ListLeadProjects`, `gp.ListProjectHeads`, `gp.SearchProjectLeadCandidates`, `gp.GrantStaffRole`, `gp.RevokeStaffRole`, `gp.GetCommonDutyAdministration`, `gp.ManageCommonDuty`, `gp.ListAdminGuardAssignments`, `gp.ListAdminGuards`, `gp.AllocateGuard`, `gp.DeallocateGuard`, `gp.SearchStaffSubjects`, `gp.ListStaffRoles`, `gp.GetOperationalSummary`, `gp.ReadAdminVisitRegister`, `gp.ListVisits`, `gp.GetVisitDetail`, `gp.ListScopedAuditEvents`

---

## Test Cases

### TC-ADM-01: Overview Module & Scope Selector (`#admin-overview`)
- **Steps**:
  1. Sign in at `/` with `admin1@example.com` / `Sopra@123`.
  2. Verify `/admin` loads **Overview**; the header shows no "Admin Console" tag and the active office sits beside the profile icon as a circular pill (static for a single office, dropdown for several). There is no empty band above the first block.
  3. In the scope bar, pick the Project scope (the selector is hidden when only one project is authorized) and a date range (`#overview-from` / `#overview-to`, max 31 days, or the Today / 7 days / 30 days chips). Changes apply automatically — there is no Apply button. The scope bar appears only on Overview, Staff & access, Visit register and Audit log; Projects & areas, Guard assignments and Offices & QR do not depend on it, and **Refresh** moves into their page header.
  4. Inspect the KPI cards (`Registered`, `Pending`, `Approved`, `Denied`; cancelled visits are not shown, so Registered = Pending + Approved + Denied), the Approval status donut, the Daily registrations column chart (single-day ranges show a status comparison bar chart) and the Current recorded presence cards.
- **Expected Result**:
  - KPIs, charts and presence update for the selected project scope and date range; presence always reflects the latest recorded state.

### TC-ADM-02: Projects & Leads Delegation (`#admin-projects`)
- **Steps**:
  1. Navigate to **Projects & areas** (`[data-admin-view="projects"]`); each project is a card with its current leads (or a "No project lead assigned" warning). Use the search box to filter by name or code.
  2. Click **Project leads** (manage) or **Add lead** (opens the dialog with the search focused) on `Project 1`.
  3. Search for an employee (`Employee 18` / `EMP018`), select them from `#employee-results`, choose Access Scope (`Noida only` or `All offices in this project`), enter Assignment Reason, and click **Assign Lead**.
  4. Click **Remove** on the newly assigned lead, enter Revocation Reason, and click **Confirm Removal**.
- **Expected Result**:
  - `PROJECT_ADMIN` role grant is created and then revoked with idempotent `clientKey` and audit logging; target user's `AuthorizationVersion` increments.

### TC-ADM-03: Staff & Access Role Management (`#admin-staff`)
- **Steps**:
  1. Navigate to **Staff & access** (`[data-admin-view="staff"]`).
  2. Search for a staff/employee name (e.g., `Employee` or `Guard`) and click **Manage access**.
  3. Toggle Role history between `Current active roles` and `All roles history`.
  4. Select a role/scope in `#staff-role`, select workspace capabilities, enter justification in `#staff-reason`, and click **Assign role**.
  5. Click **Revoke** on an active grant, enter reason in `#admin-confirm-dialog`, and confirm.
- **Expected Result**:
  - Role capabilities are validated (e.g., `VISITS_READ` required for `GUARD`/`RECEPTION`), self-grant/self-revoke is prevented, and office-wide admins can revoke delegable `PROJECT` / `PROJECT_LOCATION` grants.

### TC-ADM-04: Guard Project Assignments (`#admin-assignments`)
- **Steps**:
  1. Navigate to **Guard assignments** (`[data-admin-view="assignments"]`). The page does not use the project scope selector; it loads every authorized project in the office.
  2. Check the summary cards (`Total guards`, `Assigned`, `Free`, `Projects without a guard`) and the roster in `#assignment-list` (**By guard**: duty chips per guard, `Free` badge when unassigned). Use **All / Assigned / Free** and the search box; switch to **By project** to see each project's guards.
  3. Click **Assign guard** (or **Assign** on a guard row / **Assign guard** on a project card) to open `#assign-dialog`. Choose Project and Guard (free guards are listed first; a guard already on that project is disabled), pick a duty period chip (`Until removed`, `Today only`, `7 days`, `30 days`, `Pick date`), enter or click a Reason, and click **Assign guard**.
  4. Click the × on a duty chip (`Remove <guard> from <project>`) and confirm in `#admin-confirm-dialog`.
- **Expected Result**:
  - `gp.AllocateGuard` and `gp.DeallocateGuard` update the roster; the page re-reads each project's assignments and the guard list, so counts and Free/Assigned status stay consistent. Projects the admin is not authorized to read are skipped.

### TC-ADM-05: Common Area Creation & Duty Allocation (`#common-dialog`)
- **Steps**:
  1. Open **Projects & areas → Add**, select **Common area**, enter a unique name and reason, and click **Create area**.
  2. Confirm the new common-area card appears beside project cards and can be found through the shared search.
  3. On that card, click **Assign guard**. Confirm its area is fixed and only that area's guards appear under **Assigned Guards**.
  4. Search an authorized office guard, select it, give a reason and assign. Verify the guard appears in both the dialog and area card.
  5. Remove the duty with a reason; both views must refresh. Other areas' duties must remain unchanged.
  6. Check one Add button, type choices restricted by permission, project-only admins cannot see areas, pagination includes later-page assignments, and fresh 403 closes the dialog and clears cards.

### TC-ADM-06: Offices & Registration QR Standee Poster (`#admin-offices`, `#qr-dialog`)
- **Steps**:
  1. Navigate to **Offices & QR** (`[data-admin-view="offices"]`).
  2. Click **Registration QR** on an authorized office (`Noida`).
  3. Inspect `#qr-dialog` standee preview (Sopra Steria logo, location name, branded QR with center icon badge, and fallback URL).
  4. Click **Download Poster (PNG)** (`#qr-download-poster`), **Print / Save as PDF** (`#qr-print-pdf`), or raw QR download (`#qr-download`).
- **Expected Result**:
  - Displays QR preview (`data:image/png;base64,...`) with per-request ordering token (`requestToken('qr')`), target URL (`http://localhost:.../office/noida`), downloadable standee poster (`GatePass-NOIDA-Welcome-Poster.png`), and raw QR (`GatePass-NOIDA-QR.png`).
  - If badge compositing fails, `#generateOfficeQr` safely falls back to the decodable base QR PNG.

### TC-ADM-07: Scoped Visit Register (`#admin-reports`, Migrations 077 & 078)
- **Steps**:
  1. Navigate to **Visit register** (`[data-admin-view="reports"]`).
  2. Pick a date range with the Today / 7 days / 30 days chips or `From date` / `To date` (max 31 days). Narrow with Request reference, Visitor name, Approval, Presence and Visit type, and optional dynamic field filters (`Add field filter` across 26 whitelisted fields including `status`, `passStatus`, `requestType`, `presence`, `printStatus`, `deviceTypes`, `companyName`, movement timestamps), then click **Apply filters**. The quick dropdowns and Sort by / Order apply immediately.
  3. Click any column header (e.g., `Name`) or use **Sort by** / **Order** to sort the entire SQL result set (`ASC` / `DESC`) with `visitRequestId ASC` tie-breaking, and navigate pages (`Previous` / `Next`, 50 rows/page).
  4. Open **Columns** chooser to toggle visible columns (at least one column remains visible), or click **Reset filters**.
  5. Click anywhere on a visit row to open `#admin-visit-dialog`.
  6. Click **Export Excel** to download every visit matching the applied filters (not just the current page) as an `.xlsx` file.
- **Expected Result**:
  - Calls `gp.ReadAdminVisitRegister` via `/api/admin/register`, recording `ADMIN_REGISTER_READ` in `gp.SecurityAuditEvents` without leaking filter values into audit metadata.
  - Project-visit presence reflects that visit's own `VisitPresence.IsInside` (unaffected by sibling requests), while `DIGITAL_ID` summarizes office-wide presence.
  - `#admin-visit-dialog` displays full visit details (including `Company` and `Devices`), status chips and a visit timeline (registered, pass validity, every guard entry/exit with guard and method, pass returned).
  - `Export Excel` pages through the whole result (50 rows per request, up to 200 pages) and builds the workbook in the browser; nothing is sent to a third party.
  - Any `403` denial invokes `clearConsole()`, closing all open modals and wiping `#report-list` and all protected lists.

### TC-ADM-08: Security Audit Log (`#admin-audit`)
- **Steps**:
  1. Navigate to **Audit log** (`[data-admin-view="audit"]`).
  2. Filter by date range and click **Filter log**; narrow the loaded events with **Result** (Success / Denied / Error) and the search box.
- **Expected Result**:
  - Lists redacted audit events as log lines grouped by day: IST time, result level, action, actor, target and reason, within the admin's permitted scope without leaking raw `MetadataJson` or session material.

### TC-ADM-10: Add project within the authorized office

Open **Projects & areas → Add → Project** as a location admin. Confirm the fixed office, enter a realistic name/code/reason and create. Verify the card and project selectors refresh, reload persists it and lead/guard assignment works. A duplicate code must conflict; a failed transport retry must reuse its key. A forged foreign-office request and a project admin must receive 403; permission loss must close the modal and clear its data. See [implementation and tests](../56_Scoped_Project_Creation.md).
