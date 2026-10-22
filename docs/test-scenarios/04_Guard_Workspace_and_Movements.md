# 04. Guard Workspace & Movement Scenarios

## Surface
- **Routes**: `/guard`
- **APIs**: `/api/guard/context`, `/api/guard/duties`, `/api/guard/visitors`, `/api/guard/verify`, `/api/guard/detail`, `/api/guard/photo`, `/api/guard/movement`, `/api/guard/remind-host`
- **SQL Procedures**: `gp.GetGuardWorkspaceContext`, `gp.ListGuardDuties`, `gp.ListGuardDutyVisitors`, `gp.ReadGuardDutyPass`, `gp.RecordGuardDutyMovement`, `gp.RecordMovement`, `gp.RemindVisitHost`

---

## Test Cases

### TC-GRD-01: Guard Sign-In, Duty Roster & Profile
- **Steps**:
  1. Sign in at `/` with `gaurd1@example.com` / `Sopra@123`.
  2. Verify redirect to `/guard`, current office badge, and duty selector (`#project-filter`) listing assigned Project and Common area duties (`Project 1 · Project`, `Cafeteria · Common area`).
  3. Open Account menu -> **Profile**, verify assigned duties per office.
- **Expected Result**:
  - Guard sees only active, unrevoked project and common-area duties in their authorized office.

### TC-GRD-02: Expected vs Inside Visitor Queues (Project Duty)
- **Steps**:
  1. Select a Project duty (`Project 1 · Project`).
  2. View **Expected** tab (`[data-queue="EXPECTED"]`) and search by visitor name, request reference (`V-...`), or pass number (`GP-...`).
  3. Switch to **Inside** tab (`[data-queue="INSIDE"]`).
- **Expected Result**:
  - **Expected** lists today's `PENDING` and `APPROVED` visitors/employees not currently inside the project.
  - **Inside** lists occupants currently checked into the project.

### TC-GRD-03: Pass Detail & Host Reminder from Guard View
- **Steps**:
  1. Click a `PENDING` visitor card in the Expected queue.
  2. Inspect `#pass-dialog`: status `Approval pending`, photo, host, project, validity window, and movement timeline.
  3. Click **Remind host** (`#remind-host`).
- **Expected Result**:
  - Guard cannot check in a `PENDING` pass (`#mark-entry` is hidden).
  - `#remind-host` queues a host reminder (respecting the 5-minute cooldown).

### TC-GRD-04: Project Entry (`ENTRY`) & Presence Update
- **Steps**:
  1. Open an `APPROVED` visitor or eligible employee `DIGITAL_ID` card in a Project duty (or scan its QR via `#scan-fab`).
  2. Verify status `Access allowed` (`data-allowed="true"`) and click **Mark entry** (`#mark-entry`).
- **Expected Result**:
  - Records `ENTRY` movement with idempotent `clientKey`.
  - Pass detail refreshes to show `Presence: Inside`, timeline adds `First Entry`, `#mark-entry` hides, and `#mark-exit` becomes visible.
  - Card moves from **Expected** queue to **Inside** queue.

### TC-GRD-05: Project Exit (`EXIT`)
- **Steps**:
  1. Open an occupant's card from the **Inside** queue.
  2. Click **Mark exit** (`#mark-exit`).
- **Expected Result**:
  - Records `EXIT` movement, updates `Presence: Outside`, adds `Exit` to the timeline, and removes the occupant from the **Inside** queue.

### TC-GRD-06: Common Area Verification Only (Non-Movement Boundary)
- **Steps**:
  1. Switch `#project-filter` to `Cafeteria · Common area`.
  2. Verify `.guard-queue-tabs` (Expected/Inside toggle) is hidden.
  3. Open a pass card (either `PENDING` or `APPROVED` within valid window).
- **Expected Result**:
  - Status displays `Identity verified` (`commonAccessAllowed: true`, `verificationOnly: true`).
  - Presence and movement timeline are hidden, and `#mark-entry`, `#mark-exit`, and `#reconcile-exit` are all hidden (`canEnter: false`, `canExit: false`).
  - Attempting to call `/api/guard/movement` with `dutyKind: 'COMMON'` is rejected with `400 INVALID_INPUT` (`52002`).

### TC-GRD-07: Reconcile Exit for Cancelled / Revoked Occupant
- **Steps**:
  1. Check a visitor/employee into a project (`ENTRY`).
  2. Host/owner cancels the visit (or pass is revoked) while the person is still inside.
  3. Guard opens the occupant's pass in `#pass-dialog`.
  4. Click **Reconcile exit** (`#reconcile-exit`), enter a mandatory reason in `#reconcile-dialog`, and submit.
- **Expected Result**:
  - Normal `#mark-exit` is hidden, but `#reconcile-exit` is visible for guards with `RECONCILE_EXIT` capability.
  - Submitting reconciliation records an audited `EXIT` with `EntryMethod = 'RECONCILE'` and clears inside presence.

### TC-GRD-08: Bilingual Interface (`English` / `English + हिन्दी`)
- **Steps**:
  1. Open Account menu -> **Language** (`#language-menu`).
  2. Select `English + हिन्दी`.
- **Expected Result**:
  - All guard labels, search placeholders, buttons, and pass dialog fields render bilingual English + Hindi labels without horizontal overflow.
