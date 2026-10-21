# 08 - Notification worker database contract, Phase 02B

Date: 20 October 2026 | Baseline v1.2 + migrations 003-005

## Implemented and tested

Migrations 004/005 are applied on the local SQL Server 2025 Express instance. They add four worker entry points, one private relevance helper and an unassigned `gp_worker_runtime` role. No physical tables or columns changed. The latest database has 27 tables, 250 columns, 52 FKs, fourteen procedures and one function. No provider transport, email, directory network request, real login or production worker was started.

| Worker procedure | Database contract |
|---|---|
| `gp.ClaimNotifications` | Claim due PENDING work or recover expired PROCESSING leases in a committed bounded transaction; increment the attempt count and issue a fresh per-job claim token; terminalize expired exhausted work |
| `gp.GetNotificationDispatch` | Require the current unexpired lease, check individual visit/template/recipient/link relevance, return minimal dispatch data or cancel stale/unsupported work |
| `gp.RenewNotificationLease` | Extend only the current unexpired claim; never shorten an existing lease or revive an expired claim |
| `gp.CompleteNotification` | Require the current unexpired claim, commit SENT/PENDING/DEAD with an allowed error code, clear ownership and append audit atomically |

The worker role is denied gp schema SELECT/INSERT/UPDATE/DELETE/ALTER. Only those four procedures have EXECUTE grants. It cannot approve a visit, record movement, read sessions, fetch arbitrary encrypted QR material or invoke private helpers. The API role has no permission to claim/read/acknowledge worker jobs. Deployment must assign separate least-privilege service identities, without db_owner or broad table roles; no actual service identities have been provisioned here.

## Fencing and concurrency

`NotificationOutbox.LockedBy` stores a newly generated claim token for each claim attempt. It is a fencing handle, not a persistent WorkerId. Recovery replaces the token even when the same service instance reclaims the same job. Read/renew/complete require the matching token, PROCESSING state and server time strictly before LockedUntilUtc. An expired token fails even if another worker has not yet reclaimed the row. Claim tokens never enter audit metadata or ordinary diagnostics.

The worker performs claim -> dispatch preflight -> resolve/render/send outside SQL -> completion. A long operation renews before expiry. Lease expiry or ownership conflict requires abandoning the old handle; a stale callback may not report success against a newer claim. Repeating an already committed acknowledgement receives lease-unavailable and does not modify the completed row. Claims are not replayable network operations: a lost claim response is recovered through lease expiry.

Queue mutations use transaction-owned `gp:outbox:claim` with a checked five-second acquisition timeout. This serializes short queue transactions on the one-VM design; it deliberately avoids READPAST/isolation-dependent queue behavior. Claims are one UPDATE/OUTPUT operation under the lock, never an unlocked SELECT followed by UPDATE. Output is buffered and returned after commit. A forced audit error proved rolled-back claims return no usable claim batch.

The public worker procedures establish READ COMMITTED for their work and reject caller-owned ambient transactions. Claim/ack/renew do not read business visit rows while holding queue locks. Dispatch preflight first performs a statement-scoped immutable visit-reference lookup, then locks authorization Shared -> visit Shared -> outbox queue Exclusive and revalidates the lease after all waits. Future domain cancellation/reissue procedures must keep authorization -> visit -> outbox/dependent-row order. No network or crypto key access belongs inside these locks.

Pilot parameters are 1-20 jobs per batch (default 10), 15-300 seconds per lease (default 60). Exhausted-job cleanup is also bounded to the requested batch size. These are development defaults requiring measured workload validation, not production capacity claims. The existing outbox index is unchanged.

## Dispatch relevance and recipient privacy

The current template allowlist is:

| Template | Preflight policy |
|---|---|
| `HOST_APPROVAL_REQUEST` | Pending individual visit, future deadline/window, active destination, assigned host recipient, fresh active employee/project membership |
| `TEMP_ID_MANAGER_NOTICE` | TEMP_ID issuance fact, MANAGER kind and subject employee matching the request; expiry/cancellation does not retroactively erase an issuance fact |
| `VISIT_DECIDED` | Committed matching approval decision and payload reference/state; individual employee or external email recipient must match the visit |
| `PASS_DELIVERY` | Approved not-expired visit, active target, current ACTIVE pass, exact unrevoked/unexpired delivery link and matching holder recipient; fresh employee data for internal holders |

Unsupported templates, stale permanent state, wrong recipient or unavailable link are cancelled without returning payload or recipient content. A transient directory freshness problem raises a retryable failure and retains the lease; the service reports an allowed retry code. EMPLOYEE/MANAGER dispatch returns the trusted employee reference and intentionally omits cached RecipientEmail. The worker must resolve corporate/manager recipients through the approved directory API. Missing manager contact remains retryable and cannot retract an issued TEMP_ID or add an approval requirement.

Delivery preflight returns a specific delivery-link reference, not arbitrary token ciphertext, QR material or decryption keys. The protected render/delivery component and real key-management path remain future implementation work. Payloads are limited by their producing workflow contracts to references/outcomes; no raw bearer secrets belong in queue JSON or logs.

Preflight is a final database check before an external send, not an atomic transaction with the mail provider. State may change after preflight. A delivered action/link must still pass current authorization and state checks when used. SENT means the trusted worker reports provider acceptance; SQL cannot prove an SMTP/provider side effect or inbox delivery. A provider acceptance followed by worker crash can produce duplicate email on recovery. There is no exactly-once email claim.

## Failure and retry policy

Completion accepts SENT or FAILED. Failure codes are an explicit allowlist: DIRECTORY_UNAVAILABLE, PROVIDER_TIMEOUT, PROVIDER_UNAVAILABLE, PROVIDER_REJECTED, RENDER_FAILED, INVALID_RECIPIENT and INTERNAL_ERROR. Arbitrary provider response/error text is rejected before persistence. Provider message ID is optional restricted metadata on successful acceptance and is not copied into audit.

Transient retry is 30 seconds times a bounded power of two plus 0-15 seconds of jitter, capped at one hour. The exponent is bounded before arithmetic. INVALID_RECIPIENT and PROVIDER_REJECTED terminate immediately; other failures terminate when the attempt budget is exhausted. Expired final-attempt leases become DEAD rather than staying PROCESSING forever. A live final attempt may still acknowledge successful acceptance. Dead/cancelled/sent work is never automatically claimed again. Controlled operational retry and monitoring are not implemented yet.

Success/cancel/claim/dead audits contain job IDs, counts, status and allowed codes, without claim tokens or message contents. State and corresponding audit commit together. SQL failures roll back and propagate; the future worker must emit redacted operational telemetry and use bounded same-operation retry where appropriate.

## Evidence and replay

```powershell
./database/setup/Apply-LocalTransactionCore.ps1 -Migration 004 -TrustLocalServerCertificate
./database/setup/Apply-LocalTransactionCore.ps1 -Migration 005 -TrustLocalServerCertificate
./database/tests/Test-NotificationWorker.ps1 -TrustLocalServerCertificate
```

Applied migration versions are refused rather than edited/reapplied. Trusted SQL batches are parsed using the existing ScriptDom library and applied on one connection; failure rolls back the open migration transaction. The test helper is fixed to the dedicated local test database and does not install software, alter networking or create real logins. Local certificate trust retains encryption and is not a production certificate policy.

`notification-worker-report.json` records 39 passing cases, source hashes, cleanup and zero provider calls. Tests use separate users WITHOUT LOGIN for worker/API roles; admin is used only for synthetic fixtures, controlled fault injection, observing SQL waits and inspection. Four races observe both independent worker connections waiting at the queue gate before release: one-job claim, disjoint claims, stale acknowledgement versus recovery, and conflicting acknowledgements. Other tests cover role separation, future jobs, batch limits, retries/exhaustion, wrong/expired tokens, manager failure, template/recipient/link relevance and forced audit rollback.

The first live run exposed SQL NULL for empty FOR JSON claim results and an empty-array enumeration problem in the PowerShell harness. Migration 005 fixes the database response to literal `[]` and hardens renewal against shortening; the harness preserves empty arrays explicitly. Applied 004 was not rewritten. The final suite ran against both migrations.

Fixture notifications, actor/visit rows and machine-audit references are removed by exact random run/notification ownership. Temporary principals and injected triggers are removed. The tests require an initially empty dedicated outbox to avoid claiming unrelated jobs. No real photographs, encrypted production tokens, employees or outbound messages are used. `worker-migration-report.json`, `worker-hardening-migration-report.json` and the refreshed security inventory preserve deployed evidence.

## Next implementation boundary

Registration/TEMP_ID submission remains next: owned intake/photo binding, trusted employee/host lookup, independent individual visits, daily TEMP_ID reuse, employee-project overlap prevention, initial credential envelopes and atomic initial outbox/audit. Actual directory field mapping is an integration input, not invented from editable form fields.

Real worker code, mail transport, protected rendering, authentication/session issuance, remaining scoped reads/admin/credential procedures, deployment identities, monitoring, retention, key recovery and Linux deployment remain pending. The replaceable directory gateway now exists with a mock source (document 09); the live directory resolver/API is still pending integration. Guards use ID/password, not SSO (document 10). Database worker tests do not certify those unimplemented components.

References: [SQL application locks](https://learn.microsoft.com/en-us/sql/relational-databases/system-stored-procedures/sp-getapplock-transact-sql), [UPDATE/OUTPUT semantics](https://learn.microsoft.com/en-us/sql/t-sql/queries/output-clause-transact-sql).

## Subsequent Phase 02F notice support

Migration 011 extends private notification relevance to historical PASS_REISSUED security notices with reference-only payloads and verified employee/optional external recipient mapping. Replacement cancels old linked outstanding deliveries. It grants no access or approval and does not send real messages. The existing 39 worker cases pass; new notice/recipient tests are in the 42-case print suite. See [document 13](13_Reissue_Printing_and_Card_Rendering.md).
