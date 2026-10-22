# 02. Email & Host Approval Workflows

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

### TC-EMAIL-03: Authorized Host Approval & Pass Activation
- **Steps**:
  1. Open `/approval/<visitRequestId>` and sign in as the assigned host (`employee19@example.com` / `Sopra@123`).
  2. Verify visitor details (Name, Request ref, Office, Project, Host, Purpose, Valid window) and visitor photo (`#photo`) load.
  3. Click **Approve**.
- **Expected Result**:
  - `POST /api/email/host/decide` succeeds with `snapshotVersion: 1`, `snapshotHash`, and idempotent `clientKey`.
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

### TC-EMAIL-06: External Visitor Signed Capability Exchange (`#link=...`)
- **Steps**:
  1. Open `/request/<visitRequestId>#link=<signedToken>` for an external visitor with an email address.
- **Expected Result**:
  - Client exchanges `#link` via `POST /api/email/external/session`, which sets a path-scoped `HttpOnly; SameSite=Strict` cookie (`Path=/api/email/external/<visitRequestId>/`) and strips the URL hash.
  - Subsequent refreshes load `/api/email/external/<visitRequestId>/detail` and `/image` using the path-scoped cookie without exposing the token in URL history.

### TC-EMAIL-07: Post-Return Cancellation & Decision Fence (Migration 074)
- **Steps**:
  1. Reception prints a pending pass and later marks it **Returned** (`gp.ReturnReceptionPass`).
  2. Host opens `/approval/<visitRequestId>` or requester calls `/api/visits/cancel`.
- **Expected Result**:
  - `gp._VisitReadJson` returns `canDecide: false` and `canCancel: false`.
  - `gp.CancelVisit` throws `52005` (`409 CONFLICT`), preventing post-return mutation of a closed visit.
  - `gp._NotificationRelevance` marks any pending outbox rows for the returned visit as `STATE_CHANGED` (`CANCELLED`).
