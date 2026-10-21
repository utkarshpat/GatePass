# 05 - State and transaction contracts

Version: 1.2 + Phases 02A/02B | Migration 003 implements the WEB host decision, movement/reconciliation and scoped guard deallocation subset (40 cases). Migrations 004/005 implement the worker database contract (39 cases). Intake, other credential/read/admin paths and real worker/API integrations remain pending. See documents 07/08 for precise boundaries.

## 01. State machines

| Entity | Allowed transition | Condition |
|---|---|---|
| Intake | DRAFT -> SUBMITTED | Owned/unexpired intake, valid people/photos and atomic individual-visit creation |
| Intake | DRAFT -> ABANDONED | TTL/explicit discard; no final access granted |
| Visit | New -> APPROVED | TEMP_ID only; active SSO employee and daily slot rule |
| Visit | New -> PENDING | Project/external individual submission |
| Visit | PENDING -> APPROVED / DENIED | One eligible assigned host, exact snapshot, before deadline |
| Visit | PENDING / APPROVED -> CANCELLED | Authorized requester/host workflow with audit; stop new entry and preserve occupant state |
| Pass | New -> ACTIVE | Auto-approved TEMP_ID |
| Pass | New -> PENDING | Pending individual project/external visit |
| Pass | PENDING -> ACTIVE / DENIED | Matching committed individual host decision |
| Pass | PENDING / ACTIVE / DENIED -> REVOKED | Cancellation, replacement or authorized revocation; reason required |
| Presence | OUTSIDE -> INSIDE | Committed authorized ENTRY |
| Presence | INSIDE -> OUTSIDE | Committed authorized EXIT or reasoned reconciliation |
| Print job | REQUESTED -> RENDERED -> DISPATCHED | Rendering and browser/device handoff; not paper-output proof |
| Print job | REQUESTED / RENDERED -> FAILED | Audited failure; explicit retry/reprint behavior |
| Outbox | PENDING -> PROCESSING -> SENT | Atomic claim then provider acceptance and owner-bound acknowledgement |
| Outbox | PROCESSING -> PENDING / DEAD | Retryable failure/lease recovery or exhausted budget |
| Outbox | PENDING / PROCESSING -> CANCELLED | Message no longer relevant; worker rechecks ownership/state before acknowledgement |

Expiry is derived, not a scheduled transition: now >= ValidUntilUtc denies new ENTRY. Pending approvals past ApprovalDeadlineUtc also cannot resolve; do not extend validity from an old email. A denied/cancelled visit cannot be revived by editing it. Material changes create a new request. No automatic midnight EXIT.

## 02. Common transaction and lock order

Use SET XACT_ABORT ON, short bounded transactions, parameterized queries, server time, bounded deadlock retry and durable actor-bound idempotency. Do not perform SSO/directory HTTP calls, encryption-key network calls, mail dispatch or browser printing while holding SQL locks. Fetch/validate fresh trusted upstream data before entering the transaction, then recheck stored freshness/version while locked.

Use transaction-owned SQL application locks as a simple explicit serialization policy on this single-VM design. Check every sp_getapplock return code; a negative value aborts the operation. Use fixed canonical key formatting and hashes for personal identifiers so lock resource names do not leak employee information.

Acquire only needed resources, in this global order:

1. `gp:authorization`: Shared for operational decisions/reads that depend on privileges; Exclusive for role/capability/allocation/account/membership/project-location state mutation. This gives revocation a definite commit boundary. Shared locks do not serialize unrelated visits with each other. Keep master-data refresh transactions brief.
2. `gp:operation:<binding-and-operation-key-hash>`: Exclusive for idempotent mutation. Re-authenticate before looking up a retry result; same key with different target/payload is a conflict.
3. `gp:intake:<id>` and then `gp:employee-day:<hash>`: Exclusive where needed. Acquire multiple employee/day keys in sorted order before discovering/reusing visit records.
4. `gp:visit:<canonical-guid>`: Exclusive for decision, cancellation, reissue and movement; Shared for a coherent verification read. Acquire multiple visit IDs in sorted order. All mutations of the same visit must follow this convention.
5. Read/update dependent rows consistently: VisitRequests -> AccessPasses -> VisitPresence -> delivery/print/outbox -> audit/idempotency outcome. Create the initial presence row in the submission transaction. Row locks such as UPDLOCK/HOLDLOCK complement, not replace, the common resource protocol.

Authorization/master mutation only uses the authorization lock before its own data updates; do not acquire these locks in reverse order. The backend/migration code is responsible for following the convention; DB schema alone cannot enforce application-lock participation.

If revocation commits first, an operation that starts its authorization transaction afterward observes it and is denied. An operation already holding the shared authorization lock can commit before revocation obtains its exclusive lock. Do not promise retroactive cancellation of an already committed event. Directory revocation visibility also depends on the trusted API freshness contract.

## 03. Intake submission

A01 Validate request limits, valid owned intake and each individual's signed intake/photo ownership. Resolve trusted host/project/employee data without exposing a directory. Bound group size and body/photo work before expensive DB operations.

A02 Begin transaction and locks. Check idempotency binding/hash. Revalidate intake DRAFT/unexpired, trusted cached source freshness and active scope. For an internal request, derive person identity/email from SSO/directory, never caller fields.

A03 For TEMP_ID, inspect the employee/location/local-day slot under the employee-day lock. Return its existing usable request on a retry/new duplicate intake; never create a parallel credential just because the user rescanned reception QR. Mark the newly consumed intake as submitted and clean up unused photos according to policy. Reissue is explicit. If the slot points to a cancelled, outside, unusable request, a controlled new request may replace the slot pointer while history remains.

A04 For employee project requests, check overlapping active visits for the same employee/project-location with interval intersection: existing.Start < new.End and new.Start < existing.End. Return an equivalent existing request or reject the conflicting overlap; visits to other projects are evaluated independently. This overlap rule needs execution/concurrency tests, not just a unique index.

A05 For each new person create one immutable visit, one current pending/active pass plus protected credential material and one OUTSIDE presence. Use pre-generated random secrets/encryption envelopes; do not fetch keys under SQL lock. Batch form submission commits all valid individual records together or returns validation errors without a partial registration. Initial pilot group maximum is configurable, not a hardcoded database person count.

A06 Queue individual manager/host/delivery notifications, audit, complete the idempotency result with authorized resource references and mark intake SUBMITTED in the same transaction. Commit. Return each person's independent status. Post-commit delivery failure cannot grant entry or erase registration.

## 04. Host decision

B01 Validate actual Outlook Entra token or SSO session outside SQL; link possession is insufficient. Bind the intended individual visit/version/hash and action. GET never commits a decision.

B02 Lock authorization, idempotency and visit. Recheck active caller, assigned HostEmployeeId, current fresh active project membership, active target pair, PENDING state, version/hash and deadline. A different action/key after an existing decision returns a conflict with only authorized outcome details.

B03 Insert one immutable ApprovalDecisions row; update VisitRequests status/time and that visit's pending current pass. Enqueue individual notification and audit, complete idempotency and commit. No other visit from the same original intake is mutated.

## 05. Verification and movement

C01 Scan: bound credential input length/format, resolve by hash and check current actor/scope/state. Log PassScanAttempts using redacted outcomes. For wrong-location scans the attempt.LocationId intentionally records the scanner's location; it need not equal the pass location. Do not record raw unknown tokens, or reveal unrelated photos on a denied-scope response. A verification result is not permission to later write entry.

C02 ENTRY: take fresh transaction locks. Recheck user/session/capability, exact active guard allocation where applicable, active location/project, internal employee state, approved individual visit, current ACTIVE pass, non-purged photo/person policy, start <= now < end and OUTSIDE state. Insert AccessEvents and update VisitPresence.LastAccessEventId/IsInside atomically. The unique OperationId rejects duplicate movement retries; a different new key while INSIDE is still a duplicate ENTRY error.

C03 Normal EXIT: verify current staff movement scope and INSIDE state. Do not require an unexpired entry window. If a revoked/replaced card or inactive target makes ordinary lookup invalid, use the explicit reconciliation path; never make the old card enterable again.

C04 Reconciled EXIT: staff must hold GUARD + RECONCILE_EXIT at the recorded occupant location. Locate the existing visit with authorized search, require INSIDE, use the appropriate historical pass reference, record actual OccurredAtUtc plus server RecordedAtUtc and a reason. No arbitrary new ENTRY or auto-generated past movement. The service must validate chronology relative to the last movement and cannot use reconciliation to silently overwrite history.

C05 Scan/manual both use the same movement policy. Cancellation, deactivation or personal-data cleanup cannot delete an INSIDE presence; keep the occupant actionable until departure/reconciliation.

## 06. Reprint and reissue

D01 Reprint: authorize reception location + PASS_PRINT, lock visit/idempotency, ensure pass/version is printable and protected material exists. Create a distinct print job and audit, commit, then recover/decrypt only for authorized render. Pending is visibly PENDING and entry remains blocked. Retry returns the same job; it does not silently dispatch more paper.

D02 Reissue: reception must additionally hold PASS_REISSUE. Under the same visit lock, recheck request state/window, revoke old credential and links, clear its IsCurrent, create a new incremented current version and encrypted secret, audit/enqueue and commit. Do not change VisitPresence, host approval, requested date or visit validity. In v1 reissue is allowed for pending/approved non-cancelled visits, preserving pending/active state respectively; denied/expired visits require a new valid workflow.

## 07. Role and allocation mutation

E01 Authenticate admin and acquire Exclusive authorization lock. Verify the admin's current capability and full target scope before reading sensitive target details. An admin cannot increase their own privileges or grant permissions outside the eligible role matrix.

E02 For allocations, validate target guard role/location and reject overlapping non-deallocated intervals under this same serialization. Expired intervals do not prevent later allocation. Write allocation/deallocation history and audit; increment affected user's AuthorizationVersion.

E03 Commit, remove/refresh affected live subscriptions and ensure subsequent outbound data/actions recheck current grants. API lock correctness does not by itself remove data already visible in a client; clear visible state on permission loss and exclude protected data from caches.

## 08. Worker leases and acknowledgement

F01 In a short transaction, atomically claim eligible PENDING work or recover an expired PROCESSING lease, increment AttemptCount and set owner/lease deadline. Respect MaxAttempts, NextAttemptAtUtc and job state. Do not use a non-atomic SELECT-then-UPDATE claim. A production SQL claim query and multi-worker tests are Phase 02 work; avoid unreviewed READPAST/isolation assumptions.

Phase 02B implementation: migrations 004/005 serialize short queue transactions through the checked `gp:outbox:claim` lock, use atomic UPDATE/OUTPUT and buffer results until commit. Each job receives a fresh claim token stored in LockedBy. This is not a persistent worker ID. Read/renew/ack require both the matching token and an unexpired lease; renewal cannot shorten or revive an expired claim. Dispatch preflight orders authorization -> visit -> outbox locks; queue-only mutations do not read business visit state while holding the queue lock. Four real two-connection races and audit rollback tests are included in the 39-case report.

F02 Commit the claim, then render/send outside the DB transaction. Before a stale approval/delivery dispatch, re-evaluate relevance. Recover delivery material using only the specific authorized link ID; no raw secrets in PayloadJson or diagnostics. Mail links need the same credential handling at proxies/providers as at the application.

Resolve EMPLOYEE/MANAGER recipients from the trusted directory before dispatch; a MANAGER job identifies the subject employee, not an arbitrary submitted address. An unresolved contact remains retryable and then visible as DEAD if exhausted. This must not roll back an otherwise valid TEMP_ID pass.

F03 Acknowledge success/failure only where NotificationId, Status=PROCESSING and LockedBy match this worker claim. A late old worker cannot overwrite another worker's lease. Clear lease fields when leaving PROCESSING. Retry with bounded backoff/jitter; exhausted work becomes DEAD with a redacted code and audited controlled retry.

Provider accepted message plus crash before acknowledgement may send duplicate email on recovery. Never claim exactly-once email. Approval/movement results remain idempotent; manager notification failures are visible without adding an approval requirement.

The DB contract is implemented; actual worker/provider/directory execution is not. SENT records the trusted service's report of provider acceptance, not proof of inbox delivery. Dispatch preflight cannot make an external network side effect atomic with later cancellation; links/actions must always recheck live state. See document 08 for template/recipient policy, retry codes and limits.

## 09. Database versus service enforcement

SQL enforces keys, same-visit/pass/event links, photo intake ownership, one current pass, one decision per snapshot, daily TEMP_ID slot, nonempty required fields, valid discriminator/scope combinations, bounded same-day windows and outbox lease-shape rules.

Trusted SSO/email/HTTP and actual crypto correctness require the backend. Reviewed SQL procedures enforce the supported mutation paths' session actor, fresh membership, scope/capability, exact snapshots, legal transitions, presence alternation, shared lock participation, retry binding and audit/outbox atomicity. Migration 003 implements/tests host WEB decisions, movement/reconciliation and scoped deallocation only. Interval overlap, intake/daily issuance, remaining credential/admin actions and worker leases remain mandatory Phase 02/03 implementation/tests; no CHECK constraint alone proves them.

Phase 02D implementation update: 008/009 now implement and test atomic registration, employee daily Digital ID reuse and employee project overlap, initial pass/photo binding and transactional notices. Real photo decoding and QR encryption run outside SQL locks. See [document 11](11_Registration_and_Digital_ID_Implementation.md) for exact contracts and application gates.

Phase 02E update: 010 implements scoped operational reads, shared-lock coherent detail/verification, redacted scan attempts without movement, and isolated audited photo authorization. Lists are advisory live keyset pages; current action state is always rechecked. Photo delivery reauthorizes after storage I/O. See [document 12](12_Scoped_Reads_and_Photo_Access.md). Phase 02F subsequently implements reissue/card printing; see [document 13](13_Reissue_Printing_and_Card_Rendering.md).

Phase 02G current policy: reception printing of pending identity cards does not grant project entry or record arrival. Approval changes live state for the same QR. Guard scan may span all current assignments in one shared area; ordinary movement explicitly names and revalidates the exact project target, included in the retry digest. Building occupancy is distinct from project presence. See [document 14](14_Visitor_Identity_and_Multi_Project_Guards.md).


Subsequent guard allocation and immutable role/capability mutations are implemented in [document 17](17_Scoped_Staff_Administration.md). Scoped reads/reports and HTTP/UI integration remain separate work; physical printer testing stays at final acceptance.
