# Local bug fixes and request receipts — 23 October 2026

These changes were initially verified locally under the user's no-push instruction. The subsequent [pre-push audit](63_Pre_Push_Audit_23_October_2026.md) records their new authorization to audit and publish. Migration 089 was applied to the local `GatePass_DesignTest` database. Retained presentation requests, photos, users, assignments and history were preserved.

## Fixed issues

1. **Register export consistency.** Export pages request a SHA-256 fingerprint of the complete authorized, filtered business projection. The browser checks the fingerprint, fresh total, expected page lengths and unique visit IDs before creating the Excel file. An insertion, removal or changed field during export stops the download and asks the user to refresh/retry. This detects concurrent changes; it does not freeze a historical snapshot. Normal list reads do not calculate a fingerprint. Exports are limited to 10,000 rows.
2. **Approval/status timeout recovery.** Each request has a 30-second deadline covering both response headers and JSON body reading. A timeout releases controls and tells the user to refresh before retrying. Decision retries retain the original key for the same snapshot/decision, so a lost response cannot become a second decision.
3. **Office-switch isolation.** An export belongs to its originating console version and attempt. A late denied response from the previous office cannot clear the current office or change a newer export's loading state.
4. **Optional Outlook action-card photo visibility.** A message containing the person's inline photo retains its HTML body beside the native card. Messages without a photo retain the previous compact card behaviour. This does not enable direct Outlook actions in the localhost setup.
5. **Digital ID employee label.** Request type determines whether the email identifies the person as EMPLOYEE or VISITOR. The requester receipt is no longer labelled VISITOR just because its recipient is an employee rather than a manager.

Long names in the updated notification introduction also wrap at mobile and desktop widths.

## Recipient and message mapping

| Submission | Recipient | Message |
| --- | --- | --- |
| Employee Digital ID | Employee's current directory email | “You have requested a new Digital ID.” The automatically issued ID is ready to use; authenticated status/pass link. |
| Employee Digital ID | Employee's manager, resolved through the directory | Employee requested a new Digital ID; information only, no approval required and no holder link. |
| External visitor with an email address | That visitor's submitted email | Visitor pass request received; host approval pending; individually bound status link. |
| External visitor | Assigned host's current directory email | Approval request for that individual visitor, with the existing assigned-host verification. |
| Employee project visit | Requesting employee and assigned host, separately | Employee request receipt and host approval request. |

Person photos remain inline MIME images where available. No generated card or QR attachment was introduced. Visitor email is optional; without an address, the host notification still exists but an email receipt cannot be sent to the visitor. Atomic SQL submission already queued both recipient-specific notifications; the new tests verify the actual recipients and deduplication. Replaying a submission or reusing an existing daily Digital ID does not queue another initial receipt/notice.

## Verification

- 471 unit tests passed; one platform-specific test skipped.
- 58 actual restricted-SQL registration cases passed, including manager/employee receipt mapping, visitor/host mapping and replay deduplication.
- 12 actual SQL email cases passed, including person-photo permission checks and a TypeScript worker sending through a capture transport. No external email was sent by these checks.
- Register SQL checks passed: execute-only scope enforcement, sorting, pagination, movement fields, stable fingerprints across pages and detection of a changed field with the same row count.
- 23 browser tests passed, covering 30-second header/body timeouts, decision retry keys, stable multi-page exports, changed/duplicate records, stale-office denials, inline photos, narrow layouts and the retained presentation register/history. A separate smoke check verified the restarted main listener on port 8443 serves the updated script and downloads the retained register.
- TypeScript, ESLint, migration hash and whitespace checks are recorded with the local validation output under `output/`.

`npm.cmd run mail:preview` generates four synthetic HTML and Outlook `.eml` examples under `~/.gatepass/email-previews`: `host-approval`, `manager-notice`, `employee-receipt` and `visitor-receipt`. It cannot claim SQL notifications or send messages. Real delivery requires the configured mail worker and directory/provider connection; queue/capture evidence is not an inbox-delivery claim. The earlier user-confirmed sample deliveries remain documented in [email design and photos](60_Email_Design_Person_Photos_And_Approvals.md).
