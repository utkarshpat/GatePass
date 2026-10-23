# Visitor company, devices and camera capture

Implemented 22 October 2026.

- Company Name is optional for every external visitor, including contractor/support-staff purposes.
- A visitor can select multiple device types: Laptop, Tablet/iPad, Pen Drive, Camera, Other. No make/model, serial number, quantity, document number or ID-proof verification field was introduced.
- Group participants keep independent company/device values through edit, review, submission and database persistence. Reception's manual registration reuses the same form.
- Internal employees continue to use the existing authenticated employee flow; no separate on-shore checkbox was added.
- Authorized reception, guard, admin, authenticated request/approval details, external signed-link status pages (`/request/<id>#link=...`), HTML notification emails and Outlook Actionable Adaptive Cards show the declared company/device information.
- Reception's final printed-pass return presents a required checkbox for each declared device. Without devices, the existing direct return behavior remains. SQL independently refuses a device-bearing return without explicit confirmation; all-projects-outside checks still apply.
- Return verification is stored against the return receipt together with its existing actor, time and operation. Confirmation does not override project exits, current-pass binding, printing prerequisites, location permissions or retry protections.
- The gallery/file picker, its change handler and picker styling were removed from employee/visitor self-service. Camera capture, crop, retake and normalized photo transfer remain. Camera errors ask for camera access; there is no gallery fallback. This is a camera-only UI, not a biometric liveness or client-provenance claim.

## Persistence and compatibility

Forward migration 076 adds optional CompanyName, DeviceTypesJson (default empty array) and PassReturns.DevicesVerified, and forward migration 079 extends `gp.ReadEmailRequest` and `gp.GetNotificationEmail` to project `companyName` and `deviceTypes` for external signed-link status reads and notification/approval emails. Existing applied migrations are not rewritten, and existing records default to no declared devices. Optional details are included in new approval snapshots; submission retries without details retain their prior canonical payload. Device arrays are sorted for stable equivalent retries, and metadata cannot move between participant keys.

TypeScript boundaries validate lengths, controls, Unicode, unique allowlisted device types and explicit boolean return confirmation. Unknown properties, ID-proof fields and device identifiers are rejected. UI values are rendered as text. Guard labels include all four existing regional language combinations.

## Verification

- 57 live SQL registration cases pass, including independent group metadata, optional company, canonical reordered device retries, changed-payload rejection and invalid-device/unknown-field rejection. Actual photo normalization, encryption recovery and independent snapshot serialization checks pass.
- Live SQL return checks pass, including refusal before device verification, persisted confirmation, repeat-request stability, project-inside fencing and return/entry concurrency.
- 51 browser tests pass, including phone/laptop visitor details, per-person preservation, camera capture/crop with synthetic live frames, required device checklists and the existing role/workspace regressions.
- 446 unit tests pass, one platform-specific skip; targeted visitor-details, return and language checks also pass after final label updates.
- TypeScript, ESLint, whitespace checks and all 76 migration hashes pass. Migration 076 is applied locally.

An early browser run overlapped deliberately blocking SQL concurrency tests and hit a workspace timeout. The final browser run was isolated from those SQL tests and passed all 51 cases. No real camera, real email or physical printer was used in automated verification. Existing unrelated local changes were preserved. No commit or push was performed.
