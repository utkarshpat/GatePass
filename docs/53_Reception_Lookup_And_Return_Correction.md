# Reception lookup and return correction

The heading now provides an office-scoped search between Reception and History, with live matching as you type (no separate Search button). The QR scanner is an icon-only floating button at the bottom right; Manual registration sits below it. This search covers all retained registrations rather than only the dashboard's selected day. The existing table search still filters that day's list.

Search supports name, employee ID, mobile, email, request reference and pass number. Enter opens a single matching entry directly; otherwise choose a matching row. Results page in batches of 20. Returned passes can also be looked up using their current printed QR: lookup is a read operation and does not mark movement or grant entry. Unknown, foreign-office and purged records are not disclosed. Scanned credentials are hashed at the service boundary; audit events do not contain the QR or search text.

The scanner reuses the application's camera lifecycle and QR decoder. Closing the scanner, changing office, losing authorization, hiding the page or navigating away stops camera tracks. Camera failures leave the typed lookup available. Search request generations prevent stale responses from replacing a newer query or office's results.

All results open the existing visit detail view, including host/project information, movement timeline, current print status, print/reprint and host reminder when allowed. Print and return actions continue to recheck live state in SQL.

## Status dropdown

- An unprinted pass remains **Not printed**.
- A printed pass has a **Printed → Mark returned…** dropdown. Selecting it opens a confirmation; no write occurs until confirmation. Every declared device must be checked when devices exist. Any recorded project presence blocks return.
- A returned pass has **Returned → Correct mistaken return…**. A reason of 5–300 characters is required. A correction is a separate audited action, not deletion of the original evidence.
- The same status control is available in the visit detail dialog, including records opened from search or history.

## Correction boundaries

`gp.CorrectReceptionReturn` requires an active reception role and PASS_PRINT for that office, plus read access to the visit. It binds the current pass ID and exact expected return timestamp, so a changed pass or a later return cannot be corrected using stale data.

Correction applies to pending/approved visits whose current pass was revoked specifically by final return. It rejects changed/closed passes, project presence, and a newer unreturned overlapping registration for the same employee or matching external email/mobile in the office. It does not extend validity, change the visit's office/project, bypass host approval or authorize entry by itself. Existing guard checks remain authoritative.

On success, the original return's actor/time/operation/device confirmation, correction actor/time and mandatory reason are copied into `gp.PassReturnCorrections`; the active return marker is removed. Approved visits restore ACTIVE and pending visits restore PENDING. A still-pending host approval receives a fresh notification when an original approval notification exists and the approval deadline remains open. Old bearer links and cancelled render leases are not resurrected. Normal print/reprint can create a new print job.

Both operations use idempotency keys. Replaying an original return after its correction is rejected instead of reasserting the obsolete returned status. Pending-return counts and admin register results read the current active return marker, while the original and correction remain auditable.

## Files and verification

Migration 080 adds the lookup and correction procedures/table, updates the return replay fence and grants only procedure execution to the existing API role. Apply after 079. The service, local adapter and production/development RPC allowlists are updated; no new direct table access is granted.

- `Test-ReceptionLookupCorrection.ps1`: actual execute-only SQL, all-date pagination, returned QR lookup, office/role boundaries, replacement/stale-receipt rejection, idempotent correction, original audit retention and unchanged pending approval. Included in SQL CI.
- Existing `Test-PassReturns.ps1`: return/entry races, device checks, old pending returns and person-level presence still enforced.
- Unit contracts: canonical QR hashing, exact correction inputs, public output projection and safe error mapping.
- Browser checks: phone/laptop lookup and detail actions, confirmation/cancellation, required correction reason, restored print availability, scanner cleanup, viewport overflow/accessibility and live authenticated SQL lookup of owned synthetic records.

The reason and correction audit are new personal/operational data and must be included when the organization's retention policy is finalized. There is no new retention policy or external mail send as part of the local checks.
