# 02. Email & Host Approval Workflows

> 23 October presentation run: [current evidence and retained demo data](../55_Presentation_Rehearsal_23_October_2026.md). Earlier execution counts/cleanup statements in this catalog describe their dated runs; this presentation dataset is retained.

## Surface
- **Routes**: `/approval/<visitRequestId>`, `/request/<visitRequestId>`, `/request/<visitRequestId>#link=<signedToken>`
- **APIs**: `/api/email/host/detail`, `/api/email/host/photo`, `/api/email/host/decide`, `/api/email/request/detail`, `/api/email/request/image`, `/api/email/external/session`, `/api/email/external/<id>/detail`, `/api/email/external/<id>/image`, `/api/outlook/decision`
- **SQL Procedures**: `gp.DecideVisit`, `gp.DecideOutlookVisit`, `gp.GetEmployeeRequestCard`, `gp.GetEmailRequestCard`, `gp.ReadEmailRequest`, `gp.RemindVisitHost`

---

## Test Cases

### TC-EMAIL-01: Safe GET / Scanner Prefetch Immunity
- **Steps**:
  1. Open `/approval/<visitRequestId>#decision=APPROVED` in a browser without an active host session.
- **Expected Result**:
  - URL hash is stripped via `history.replaceState`.
  - No `POST /api/email/host/decide` request is fired automatically.
  - Sign-in form (`#login`) is displayed; `#actions` (Approve/Reject) remain hidden.

### TC-EMAIL-02: Wrong Host / Non-Owner Access Denial
- **Steps**:
  1. Open `/approval/<visitRequestId>` and sign in as an employee who is **not** the assigned `HostEmployeeId` for that visit.
- **Expected Result**:
  - API returns `403 NOT_AUTHORIZED`.
  - UI keeps `#login` visible with message `Sign in with the assigned host’s email.` and does not leak visitor details or photo.

### TC-EMAIL-03: Authorized Host Approval, Visitor Company/Devices & Pass Activation (Migrations 076 & 079)
- **Steps**:
  1. Open `/approval/<visitRequestId>` and sign in as the assigned host (`employee19@example.com` / `Sopra@123`).
  2. Verify visitor details (Name, Company, Devices, Request ref, Office, Project, Host, Purpose, Valid window) and visitor photo (`#photo`) load.
  3. Verify that HTML notification emails (`NotificationEmailWorker`) and Outlook Actionable Adaptive Cards (`OutlookApprovalCard`) also render escaped `Company` and formatted `Devices` (`Laptop`, `Tablet / iPad`, `Pen Drive`, `Camera`, `Other`).
  4. Click **Approve**.
- **Expected Result**:
  - `POST /api/email/host/decide` succeeds with `snapshotVersion: 1`, `snapshotHash` (which binds `companyName` and `deviceTypes`), and idempotent `clientKey`.
  - `gp.VisitRequests.Status` transitions to `APPROVED` and `gp.AccessPasses.Status` transitions to `ACTIVE`.
  - Status text updates to `Approved`, and Approve/Reject buttons hide (`canDecide: false`).
  - `VISIT_DECIDED` notification is queued in `gp.NotificationOutbox`.

### TC-EMAIL-04: Authorized Host Rejection
- **Steps**:
  1. Open `/approval/<visitRequestId>` for a pending visit as the assigned host.
  2. Click **Reject**.
- **Expected Result**:
  - Visit status transitions to `DENIED`, pass status to `DENIED`, and status message shows `Declined`.

### TC-EMAIL-05: Employee Request Status & Pass Download (`/request/<id>`)
- **Steps**:
  1. Open `/request/<visitRequestId>` and sign in as the requesting employee.
  2. View status (`Approval pending` or `Approved`) and click **Download pass PNG**.
- **Expected Result**:
  - Card preview image (`#card`) renders via `gp.GetEmployeeRequestCard`, and clicking Download saves `GatePass-<visitRequestId>.png`.

### TC-EMAIL-06: External Visitor Signed Capability Exchange (`#link=...`) & Visitor Metadata (Migration 079)
- **Steps**:
  1. Open `/request/<visitRequestId>#link=<signedToken>` for an external visitor with an email address, optional company, and declared devices.
- **Expected Result**:
  - Client exchanges `#link` via `POST /api/email/external/session`, which sets a path-scoped `HttpOnly; SameSite=Strict` cookie (`Path=/api/email/external/<visitRequestId>/`) and strips the URL hash.
  - Subsequent refreshes load `/api/email/external/<visitRequestId>/detail` (`gp.ReadEmailRequest` -> `EmailWorkflowService.external()`) and `/image` using the path-scoped cookie without exposing the token in URL history.
  - `#fields` displays `Company` and formatted `Devices` (`Laptop, Tablet / iPad`, etc.) when present on the visit.

### TC-EMAIL-07: Post-Return Cancellation & Decision Fence (Migration 074)
- **Steps**:
  1. Reception prints a pending pass and later marks it **Returned** (`gp.ReturnReceptionPass`).
  2. Host opens `/approval/<visitRequestId>`; the backend cancellation test invokes `VisitCancellationService` / `gp.CancelVisit`. A public cancellation route or finished browser Cancel visit button is not currently wired.
- **Expected Result**:
  - `gp._VisitReadJson` returns `canDecide: false` and `canCancel: false`.
  - `gp.CancelVisit` throws `52005` (`409 CONFLICT`), preventing post-return mutation of a closed visit.
  - `gp._NotificationRelevance` marks any pending outbox rows for the returned visit as `STATE_CHANGED` (`CANCELLED`).

### TC-EMAIL-08: Person Photos and Outlook-Compatible Notification Layout (Migration 088)
- Generate the host, manager and visitor notification samples with `npm.cmd run mail:preview`. Check explicit status, person/company, inline person photo, office/project/devices, purpose, validity and actions at desktop/mobile widths. The subject uses the person's name and office; the full request reference remains visible in the footer.
- Verify the Graph capture contains `gatepass-company-logo` and `gatepass-person-photo` inline MIME parts, with no pass/QR attachment or public storage URL. Manager notices have no approval or private-holder link; pass-replacement notices have no person photo.
- Under a restricted worker identity, resolve only a current relevant notification claim with `gp.ResolveNotificationPhoto`. API-role access, wrong/expired claims and changed recipients are denied. A purged photo has no storage metadata. The service rejects wrong visits, path traversal, bad length/hash and metadata/permission loss during file reads. The final relevance check prevents stale dispatch.
- Ordinary HTML links still require the assigned host's active browser session or sign-in; no GET or mail scanner automatically decides. Direct Outlook actions require the separately configured Microsoft Entra actor-token flow. See [design, configuration and validation](../60_Email_Design_Person_Photos_And_Approvals.md).
