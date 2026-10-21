# 16 - Individual cancellation and preserved occupancy

Version: 1.9 | Date: 20 October 2026 | Phase 02I

Physical printer testing is deferred to final acceptance, as requested. It does not block database, service, HTTP or UI implementation.

## Implemented contract

Migration 015 adds gp.CancelVisit, individually granted to the API role. A live session/CSRF and trusted OWN employee or assigned HOST authorization are required. Directory identity must be current; host project membership must be fresh. Reception, guards and administrators receive no role-name bypass. Anonymous external cancellation is not exposed.

Input is ClientKey, VisitRequestId, ExpectedPassId and a required reason of at most 300 UTF-16 code units. The expected pass rejects a stale action after reissue. PENDING and APPROVED visits may become CANCELLED. DENIED/already CANCELLED visits reject a fresh action. Submitted identity, host, purpose, window and snapshot remain immutable.

The transaction takes the shared authorization gate, actor/payload-bound operation lock and exclusive visit lock. It rechecks authentication and ownership after waits. Same-key replay returns the same bounded receipt after current authorization; changed payload conflicts. Approval, entry, reissue and print dispatch serialize through the same visit lock.

Cancellation atomically revokes remaining credential versions and delivery links, invalidates REQUESTED/RENDERED print jobs, fences their claims, cancels PENDING/PROCESSING outbox work and records success audit/reason. DISPATCHED print history remains. Previously revoked reasons are preserved. No new cancellation message/template/provider is introduced.

Presence, access history, approval decisions, daily Digital ID pointer and encrypted credentials are retained. No synthetic EXIT is created. The receipt's wasInsideAtCancellation is explicitly historical; applications refresh protected detail for current presence. Failure to append success audit rolls back every business mutation.

## Exit and replacement

Cancelled/expired/revoked INSIDE people remain actionable through designated location guards with RECONCILE_EXIT and a required actual-departure reason. Cancellation never grants normal entry or silently marks departure. Project presence is not building/lobby headcount.

Migration 016 blocks a fresh overlapping employee project request at the same project/location while a cancelled request for that employee remains INSIDE. Existing employee/day serialization is retained. After actual exit, a fresh independent request may be submitted and requires fresh approval. Digital ID already retains its daily pointer and blocks replacement while INSIDE; it remains location-scoped.

## Internal service and UX

VisitCancellationService and its exact typed SQL port accept only the four action fields. Session/CSRF reach SQL as hashes. Caller identity, role, scope, status, credential and presence overrides are rejected. Backend errors are redacted. Receipt fields are operation ID, visit ID, pass ID, CANCELLED and historical occupancy.

Protected detail includes canCancel for eligible OWN/HOST views of pending/approved requests. This is advisory; SQL reauthorizes the action. No public HTTP route or finished UI is claimed here.

## Validation

- 30 restricted SQL cancellation cases, including four observed two-connection races and five nested actual internal service/SQL cases.
- 45 registration cases, including actual cancellation, blocked overlap while inside and successful new request after reconciliation; scoped read/print/core/guard regressions have separate evidence.
- 106 full Node unit tests, including eight cancellation cases. Native TypeScript execution is not compiler/typecheck validation.
- Migrations 001-016 applied locally: 33 tables, 297 columns, 58 FKs, 48 procedures and four private functions. Individual EXECUTE grants: API 15, worker 5, auth 6, media 1, renderer 4. No permanent runtime members or real messages.

The local .NET validation helper disables pooling because it impersonates disposable SQL users. The SQL error log confirmed error 18059 when a pooled impersonated session was reset after testing. This fixes local validation isolation; production driver/authentication remains a separate gate. Disposable fixture cleanup and retained dummy masters are checked independently.

## Continue

Remaining DB work includes scoped guard allocation, role/capability administration and governed report/audit contracts, followed by HTTP and reception/guard/employee UI integration. Real SSO/directory/mail, private key/storage rollout and Linux deployment remain separate work. Physical printer/device acceptance belongs to the final stage.


Subsequent guard allocation and immutable role/capability mutations are implemented in [document 17](17_Scoped_Staff_Administration.md). Scoped reads/reports and HTTP/UI integration remain separate work; physical printer testing stays at final acceptance.
