# 01. Public & Employee Registration Scenarios

## Surface
- **Routes**: `/office/noida`, `/office/bengaluru`, `/office/chennai`, `/office/pune`
- **APIs**: `/api/dev/sso/*`, `/api/registration/reset`, `/api/registration/start`, `/api/registration/options`, `/api/registration/photo`, `/api/registration/submit`, `/api/employee/digital-id/detail`, `/api/employee/digital-id/image`
- **SQL Procedures**: `gp.CreateRegistrationIntake`, `gp.GetRegistrationOptions`, `gp.RecordRegistrationPhoto`, `gp.SubmitRegistration`, `gp.GetOwnDigitalIdCard`

---

## Test Cases

### TC-REG-01: Office QR Context Binding
- **Precondition**: User opens `/office/noida`.
- **Steps**:
  1. Verify header displays `Noida` and `<meta name="gp-office" content="NOIDA">`.
  2. Verify two entry choices are visible: **SSI Employee** and **Visitor Check-in**.
- **Expected Result**: Server issues `gp-dev-office` signed cookie bound to `NOIDA`; user cannot manually tamper with office selection inside the form.

### TC-REG-02: Employee Sign-In & Directory Hydration
- **Steps**:
  1. Click **SSI Employee** on `/office/noida`.
  2. Sign in with `employee2@example.com` and `Sopra@123`.
- **Expected Result**:
  - Employee identity card displays `Employee 2`, `EMP002 · employee2@example.com`, `Primary Office: Noida`, and assigned project chips (`Project 1 · Noida`).
  - `+ Request access to another project` button is available.

### TC-REG-03: Employee Digital ID Issuance (Eligible Office)
- **Steps**:
  1. Select Reason (`Forgot my card`, `Lost my card`, or `Other` with mandatory details).
  2. Click **Continue** to proceed to Photo Verification.
  3. Upload a valid JPEG/PNG/WebP image or capture via camera; adjust zoom/pan/flip/reset controls.
  4. Click **Review**, verify details and 600×800 cropped portrait, and click **Submit Pass**.
- **Expected Result**:
  - `DIGITAL_ID` (`TEMP_ID` in SQL) is auto-approved (`status: APPROVED`, `passStatus: ACTIVE`).
  - Digital ID card PNG is rendered and displayed with a **Download Digital ID** action.
  - `TEMP_ID_MANAGER_NOTICE` and `REQUEST_RECEIVED` notifications are queued in `gp.NotificationOutbox`.

### TC-REG-04: Same-Day Digital ID Reuse (Idempotent / Repeat Request)
- **Steps**:
  1. While an active, unreturned Digital ID exists for `EMP002` in Noida today, submit another Digital ID request for `EMP002` in Noida.
- **Expected Result**:
  - `gp.SubmitRegistration` reuses the existing `VisitRequestId` and `AccessPassId` (`reused: true`) without minting a duplicate credential.

### TC-REG-05: Fresh Digital ID After Final Pass Return (Migration 073 & 074)
- **Steps**:
  1. Reception prints and later marks `EMP002`'s Digital ID pass as **Returned** (`gp.ReturnReceptionPass`).
  2. `EMP002` submits a new Digital ID request in Noida on the same day.
- **Expected Result**:
  - Returned pass is treated as closed history (not reusable/overlapping); a fresh `VisitRequestId` and active `AccessPassId` are issued, and `gp.TemporaryIdSlots` updates to the new visit.

### TC-REG-06: Employee Cross-Office Request (Ineligible for Auto Digital ID)
- **Steps**:
  1. Open `/office/bengaluru` and sign in as `employee1@example.com` (whose primary/eligible office is Noida, not Bengaluru).
  2. Select reason `Forgot my card` and click **Continue**.
- **Expected Result**:
  - Banner states `Access to this office requires host approval.`
  - Clicking **Continue** without adding a project/host shows error toast `Add a project and local host for approval.` and focuses `+ Request project access`.

### TC-REG-07: Employee Additional Project Access (`EMPLOYEE_PROJECT`)
- **Steps**:
  1. Sign in as `employee2@example.com` on `/office/noida`.
  2. Click `+ Request access to another project`.
  3. In the modal, select an unassigned project (`Project 2`), search for an eligible host assigned to `Project 2` at Noida, select Purpose, and click **Add project**.
  4. Complete Photo and Review steps and submit.
- **Expected Result**:
  - Submits both `DIGITAL_ID` (auto-approved) and `EMPLOYEE_PROJECT` (status `PENDING`, awaiting host approval) as separate visits.
  - Self-hosting (`HostEmployeeId = EmployeeId`) and hosts not eligible at that exact `ProjectLocationId` are rejected.

### TC-REG-08: Single External Visitor Check-in (`EXTERNAL`)
- **Steps**:
  1. Open `/office/noida` and click **Visitor Check-in**.
  2. Enter Name (`Arjun Mehta`), valid mobile (`9876543210` with `+91` country code), and optional Email (`visitor1@example.com`).
  3. Click **Continue** to Visit details.
  4. Select Project (`Project 1`), Visit date (within `[currentDate, maxVisitDate]`), search and select Host (`Employee 19`), and select Purpose (`Business meeting`, `Contractor`, `Support staff`, etc.).
  5. Upload/capture visitor photo, review details, and click **Submit Pass**.
- **Expected Result**:
  - Request is created with `status: PENDING`, `passStatus: PENDING`.
  - Success screen shows `Approval pending` badge, reference `V-...`, and pass number `GP-...`.

### TC-REG-09: Multi-Visitor Group Check-in & Independent Participant Binding
- **Steps**:
  1. In Visitor Check-in step 1, fill Visitor 1 details and click `+ Add visitor`.
  2. Verify Visitor 1 collapses into a summary card with `Edit` and `Remove` actions.
  3. Fill Visitor 2 details (`Priya Nair`, `9123456780`).
  4. Complete Visit details, upload photos for both Visitor 1 and Visitor 2 using the person switcher, review, and submit.
- **Expected Result**:
  - Each visitor receives an independent `VisitRequestId`, `AccessPassId`, and host approval notification, bound strictly by `clientPersonKey`.

### TC-REG-10: Validation Boundaries (Phone, Reason, Photo)
- **Steps**:
  1. Enter an invalid phone number (e.g., `12345`) or select country code via Country Picker dialog.
  2. Select `Other` in Reason/Purpose without filling Details textarea.
  3. Attempt to continue from Photo step without uploading/capturing a photo.
- **Expected Result**:
  - Inline validation and error toast block progression until all required inputs are valid.
