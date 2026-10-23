# “Didn't request this? Revoke pass” — 23 October 2026

New requester receipt, approved decision and pass-delivery emails include a **Revoke pass** link while the request is pending/approved and its validity has not ended. Manager information notices and assigned-host approval emails do not receive this requester action. Existing delivered emails are not modified.

Opening the link only displays the request. The holder must click **Didn't request this? Revoke pass** and accept a confirmation explaining that entry will stop and the action cannot be undone. Dismissing confirmation leaves the request unchanged. An email scanner or GET request cannot revoke a pass.

Employees sign in with the request owner's account. The server checks the OWN view before calling the existing scoped `gp.CancelVisit`; a host-only or unrelated account cannot use this self-service route.

Visitors receive a separate, purpose-bound signed revocation capability in the URL fragment. Its HMAC domain differs from the read-only email-status capability. A status link alone cannot revoke, and a revocation link cannot be used as a status proof. Both proofs bind the exact visit, recipient email digest, immutable snapshot and expiry. They are exchanged for individual-path HttpOnly/SameSite=Strict cookies (Secure in production) and removed from the address bar. Reopening a new email link in a tab already showing the same request exchanges the new capability again. No raw capability is put in local/session storage or query parameters.

Mutation requires a same-origin JSON POST, the dedicated capability, explicit `confirm:true`, a stable retry key and the currently displayed pass ID. SQL rechecks the individual binding after locking the request. A changed pass returns a conflict. Wrong/expired/tampered tokens, changed recipients/snapshots, purged requests and other request IDs cannot revoke. Cancelled/denied/returned/expired requests cannot become active again.

Forward migration **090** adds `gp.RevokeEmailRequest`, executable only by the API runtime. It uses the existing idempotency ledger, revokes all credentials/delivery links for the individual visit, fails pending print work, cancels pending/claimed notifications and appends an `EMAIL_PASS_REVOKED` audit event with the holder-report reason. It preserves approval/access history, encrypted pass material and current presence. An occupant still needs a recorded exit; revocation does not pretend they have left. Employee revocations use the existing `VISIT_CANCELLED` audit event with the same reason.

The status page removes pass media immediately when confirmed revocation begins and ignores an older in-flight image response. A timeout releases Refresh; refreshing then retrying retains the same key for the displayed pass. Active/approved pages also refresh every 30 seconds to notice revocation from another session, as verified in the [pre-push audit](63_Pre_Push_Audit_23_October_2026.md).

## Local verification

- **475 unit tests passed**, one platform-specific skip. New tests cover token-purpose separation, exact cookie/request scope, confirmation, OWN checks and email action placement.
- **9 actual SQL revocation cases passed**, including wrong bindings, stale passes, purged/expired requests, pending/occupied passes, stable retries and the actual employee service through the restricted development bridge.
- **12 existing actual SQL email workflow cases passed**, including captured worker delivery without sending external email.
- **15 browser cases passed**, including real signed visitor links through the local HTTP adapter to SQL, confirmation accept/dismiss, page reload/cookie isolation, employee login, timeout recovery and stale media; email layouts fit 390/1366 px.
- **30 existing SQL cancellation cases passed**, including revoked entry, presence preservation, printing invalidation, authorization and concurrent decisions/movement. Its stale duplicate-capability setup and global-queue claim were corrected to use only its own synthetic notification.
- TypeScript, ESLint and **90 sequential migration hashes** passed.

All synthetic fixtures are cleaned by their unique run ID. Retained presentation requests, assignments, photos and history remain available. Initial verification sent no real email and held the change locally; subsequent publication is covered by the [pre-push audit](63_Pre_Push_Audit_23_October_2026.md). `npm.cmd run mail:preview` regenerates the four synthetic HTML/EML previews; employee and visitor self-receipts now show this option.
