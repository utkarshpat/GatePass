# 05. Admin Console & Scoped Delegation Scenarios

## Surface
- **Routes**: `/admin`
- **APIs**: `/api/admin/context`, `/api/admin/scope`, `/api/admin/projects`, `/api/admin/leads`, `/api/admin/candidates`, `/api/admin/grant`, `/api/admin/revoke`, `/api/admin/common-duties`, `/api/admin/common-duty`, `/api/admin/assignments`, `/api/admin/guards`, `/api/admin/allocate`, `/api/admin/deallocate`, `/api/admin/subjects`, `/api/admin/roles`, `/api/admin/summary`, `/api/admin/visits`, `/api/admin/visit-detail`, `/api/admin/audit`, `/api/admin/office-qr`
- **SQL Procedures**: `gp.GetAdminWorkspaceContext`, `gp.GetAdminConsoleScope`, `gp.ListLeadProjects`, `gp.ListProjectHeads`, `gp.SearchProjectLeadCandidates`, `gp.GrantStaffRole`, `gp.RevokeStaffRole`, `gp.GetCommonDutyAdministration`, `gp.ManageCommonDuty`, `gp.ListAdminGuardAssignments`, `gp.ListAdminGuards`, `gp.AllocateGuard`, `gp.DeallocateGuard`, `gp.SearchStaffSubjects`, `gp.ListStaffRoles`, `gp.GetOperationalSummary`, `gp.ListVisits`, `gp.GetVisitDetail`, `gp.ListScopedAuditEvents`

---

## Test Cases

### TC-ADM-01: Overview Module & Scope Selector (`#admin-overview`)
- **Steps**:
  1. Sign in at `/` with `admin1@example.com` / `Sopra@123`.
  2. Verify `/admin` loads **Overview** with server-supplied `currentDate` in `#overview-date`.
  3. Inspect **Visit date summary** cards (`Registered`, `Pending`, `Approved`, `Denied`, `Cancelled`) and **Current recorded presence** cards (`Project visits inside`, `Employee project presence`).
  4. Change `#console-project` between `All authorized projects in office` and a specific project (`Project 1 · DEMO-PRJ-001`), then switch back to `All authorized projects in office`.
- **Expected Result**:
  - Summary and presence cards update to reflect the selected office or project scope.
  - Non-required `#console-project` select allows re-selecting the `""` (`All authorized projects in office`) option.

### TC-ADM-02: Projects & Leads Delegation (`#admin-projects`)
- **Steps**:
  1. Navigate to **Projects & leads** (`[data-admin-view="projects"]`).
  2. Click **Project leads** on `Project 1`.
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
  1. Navigate to **Guard assignments** (`[data-admin-view="assignments"]`).
  2. Verify that when `#console-project` is office-wide (`""`), status prompts `Select a project to manage its guards.`.
  3. Select a project in `#console-project`.
  4. Inspect current assigned guards in `#assignment-list`, select an eligible guard in `#allocation-guard`, enter Allocation reason, and click **Assign guard**.
  5. Click **Remove** on an assignment and confirm in `#admin-confirm-dialog`.
- **Expected Result**:
  - `gp.AllocateGuard` and `gp.DeallocateGuard` update the project guard roster and refresh `#allocation-guard` eligibility flags (`overlappingAssignment`, `canAllocate`).

### TC-ADM-05: Common Area Creation & Duty Allocation (`#common-dialog`)
- **Steps**:
  1. Click **Common areas** (`#common-duties-open`) in the page header.
  2. In Tab 1 (**Assigned Guards**), view existing common area assignments.
  3. Switch to Tab 2 (**Assign Duty**), select a Common area (`Lobby` / `Cafeteria`), search for a guard (`Guard`), select the guard, enter reason, and click **Assign guard**.
  4. Switch to Tab 3 (**New Area**), enter a unique Area name and Creation reason, and click **Create area**.
  5. Remove the test duty assignment from Tab 1.
- **Expected Result**:
  - Common areas and guard duties are managed within the office scope; self-assignment and non-guard role conflicts are blocked by Migration 074.

### TC-ADM-06: Offices & Registration QR Codes (`#admin-offices`)
- **Steps**:
  1. Navigate to **Offices & QR** (`[data-admin-view="offices"]`).
  2. Click **Registration QR** on an authorized office (`Noida`).
- **Expected Result**:
  - Displays QR preview (`data:image/png;base64,...`), target URL (`http://localhost:.../office/noida`), and downloadable link `GatePass-NOIDA-QR.png`.

### TC-ADM-07: Visits & Reports (`#admin-reports`)
- **Steps**:
  1. Navigate to **Visits & reports** (`[data-admin-view="reports"]`).
  2. Filter by date range (`From date` / `To date`, max 31 days) and optional pass/request reference, then click **Apply filters**.
  3. Click a visit row to open `#admin-visit-dialog`.
- **Expected Result**:
  - Displays visit details (Name, Status, Office, Project, Host, Purpose, Pass number, Validity window) and movement timeline.

### TC-ADM-08: Security Audit Log (`#admin-audit`)
- **Steps**:
  1. Navigate to **Audit log** (`[data-admin-view="audit"]`).
  2. Filter by date range and click **Filter log**.
- **Expected Result**:
  - Lists redacted audit events (action, actor display name, IST timestamp, target type, result code) within the admin's permitted scope without leaking raw `MetadataJson` or session material.
