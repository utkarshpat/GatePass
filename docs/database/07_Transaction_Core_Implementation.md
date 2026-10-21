# 07 - Transaction security core, Phase 02A

Date: 20 October 2026 | Baseline v1.2 + migration 003

## Implemented boundary

The user confirmed hybrid security: the API authenticates SSO/MFA, validates the HTTP/CSRF/input boundary and controls responses; SQL independently enforces current session identity, role/capability/scope, valid state and atomic mutations. SQL does not validate an Entra JWT or invent a directory identity from an editable UserId.

Migration `003_transaction_security_core.sql` has been applied on the local SQL Server 2025 Express instance. It adds nine procedures, one private capability function, a database freshness policy and an execute-only runtime role. The existing 27 tables remain unchanged. SQL source was authored first and applied directly; no entity model generated it.

The runtime role `gp_api_runtime` has explicit EXECUTE grants only on:

| Procedure | Enforced behavior |
|---|---|
| `gp.DecideVisit` | One assigned host's WEB approval/denial for one exact individual snapshot, fresh active host membership, active scope, pending state/deadline; visit/pass/decision/outbox/audit/idempotency commit together |
| `gp.RecordMovement` | Explicit ENTRY/EXIT, exact guard capability/allocation, current credential for normal movement, entry validity and employee/photo state, atomic event/presence, separate reasoned reconciliation for an existing occupant |
| `gp.DeallocateGuard` | A current scoped admin with GUARDS_MANAGE deallocates an exact allocation; authorization version increments and the operation/audit are atomic |

The role is denied SELECT/INSERT/UPDATE/DELETE and ALTER on the gp schema. Private helpers are not granted EXECUTE. All referenced application objects share the schema owner; static ownership chains allow the reviewed procedures to operate without table permissions. Public procedures contain no dynamic SQL and use no EXECUTE AS OWNER elevation. No server login, production app user, privileged business user or actual SSO session has been provisioned.

An identity with db_owner/sysadmin or other privileged memberships bypasses this application-role design. The production API must use a distinct least-privilege identity and must not reuse the developer's administrative Windows connection. The current tests use an isolated user WITHOUT LOGIN impersonated by the test administrator, then remove that user.

## Session, scope and retry handling

Public procedures accept session and CSRF digests, not an ActorUserId. The database resolves the actor from an active unrevoked session and active user, checks idle/absolute deadlines and the session's authorization version. Hash lengths are checked before use. Session issuance/rotation, trusted SSO binding, secure cookies and HTTP-origin checks still require the authentication backend; the operational API role cannot write sessions.

Changing a principal's authorization version invalidates old sessions. A fresh trusted session still receives live grant/allocation checks. This intentionally fails closed; the future API must handle authorization-refresh/reauthentication clearly. Database roles/capabilities never freeze at login.

Each qualifying capability and scope must belong to the same effective grant. A GUARD operation requires GUARD, not a different role with an incorrectly provisioned capability. Project movement additionally requires the exact in-window non-deallocated assignment. TEMP_ID needs its own location capability. Reconciliation needs GUARD + RECONCILE_EXIT at the occupant location; it does not grant entry or broaden project access.

The pilot database extended property `GatePass.DirectoryMaxAgeSeconds` is 300 seconds. Host employee/membership and internal visitor employee state fail closed when stale. This is a provisional development policy, not a verified directory SLA. The approved directory sync/freshness contract must be reconciled with it before production. Only a governed privileged sync/migration identity may update that cache/policy; runtime API table writes remain denied.

All operations acquire transaction-owned application locks in the established order: authorization, actor/operation retry key, then individual visit where applicable. Operational work uses Shared authorization; deallocation uses Exclusive authorization. Every lock result is checked with a five-second timeout. The API must implement bounded retry for lock/deadlock failures using the same key; automatic backend retries have not been built yet. No HTTP, crypto key lookup, mail send or rendering happens inside the transaction.

Idempotency binds the database-resolved actor, operation code, client key and a server-built canonical JSON payload digest. Digests and reference/outcome JSON are persisted, never raw session/QR secrets. Cached outcomes are returned only after fresh authentication and current resource authorization. A replay reports a previous committed event; it is not a fresh entry authorization. A changed payload with an old key conflicts. Seven-day operation expiry is a provisional retention value; no cleanup worker is implemented here.

All public procedures reject ambient transactions so an API caller cannot prolong their business transaction after return. Success audit is in the business transaction. Failures roll back then append a redacted diagnostic containing only the error number and target reference; diagnostic insertion is best-effort so its own failure does not mask the original error. External protected audit export/monitoring is still required.

## Exit and immutable history

Normal EXIT does not require an unexpired visit window. Revoked/replaced credentials or inactive targets use the explicitly authorized reconciliation path. Reconciliation requires an INSIDE visit, related historical pass, nonempty reason and an occurrence between the last movement and server record time. Presence remains attached to the visit, not a credential version. No procedure infers entry from a scan or performs group movement.

Application-role callers cannot directly edit submitted details, decisions, movement or audit rows. Material request changes, cancellation and reissue must later receive their own reviewed procedures; the role currently has no write route for them. Manager notification and TEMP_ID issuance are not changed by this migration.

## Reproducible evidence

```powershell
./database/setup/Apply-LocalTransactionCore.ps1 -TrustLocalServerCertificate
./database/tests/Test-TransactionCore.ps1 -TrustLocalServerCertificate
```

The apply command is local-only, fixed to GatePass_DesignTest and refuses an already recorded 003. It parses trusted SQL using Microsoft ScriptDom's batch boundaries, executes all batches on one connection and rolls back any open migration transaction on failure. It performs no software installation, port changes or database reset. Production needs a governed migration runner; do not run selected migration batches independently in SSMS.

The self-signed certificate trust option is only for the local development instance and retains TLS encryption. Production must validate a trusted certificate. The default .NET SQL client already exists on this laptop; no extra installer was needed.

`transaction-core-report.json` records 40 passing behavioral/security cases, source hashes and fixture cleanup. The races use independent SQL connections and verify through server wait metadata that both contenders actually blocked at controlled locks before release. They cover different-key concurrent ENTRY, concurrent identical retries, concurrent APPROVE/DENY, and a deallocation waiting behind an already authorized movement. After deallocation commits, old-session retries fail; even after a trusted session-version refresh, the removed assignment still denies movement.

Other cases cover direct table/helper access denial; wrong location/project/role/capability and split-scope grants; stale/inactive/expired sessions; wrong CSRF and oversized hashes; forwarded approvals; snapshot/deadline checks; active/expired/revoked presence; reconciliation chronology; stale directory state; and forced audit failure rolling back decision/pass/outbox/idempotency together. Fixture cleanup tracks actor, visit and assignment targets, including pre-authentication failure audits.

The initial harness run exposed client-side NULL parameter typing and a parameterized transaction-gate issue; those test-tool bugs were fixed. Final SQL migration 003 did not require alteration or a reset. Synthetic fixtures are committed only so separate test connections can see them, then removed by exact random run ownership. No real visitors, messages or photo files are created. The temporary principal is removed after test connections close.

Read-only deployed inventory is in `transaction-security-inventory.json`; migration source/engine evidence is in `transaction-migration-report.json`. These complement, rather than replace, the baseline's 18 constraint cases and live catalog comparison. No test results certify the entire application.

## Remaining work

- Trusted SSO/session issuance and directory sync identities/contracts; real Outlook token validation and a separately controlled mail-action identity path. Current decision source is WEB only.
- Atomic multi-person intake, daily Digital ID reuse, employee project overlap, initial encrypted credentials and notifications were subsequently implemented in Phase 02D; see [document 11](11_Registration_and_Digital_ID_Implementation.md).
- Scoped list/detail/photo authorization and scan-verification logging were subsequently implemented in Phase 02E; see [document 12](12_Scoped_Reads_and_Photo_Access.md). Phase 02F implements print recovery and reissue/reprint (document 13). Cancellation and guarded allocation/role provisioning remain pending.
- Worker claim/lease/retry/acknowledgement procedures and tests were subsequently completed in Phase 02B (document 08). Actual provider dispatch, directory/manager resolution and worker process code remain pending.
- Connection-role provisioning, complete read/exfiltration testing, API rate limits, subscriptions/cache cleanup, key storage/recovery, protected audit export and Linux deployment/restore checks.

References: [SQL procedure permissions](https://learn.microsoft.com/en-us/sql/relational-databases/stored-procedures/grant-permissions-on-a-stored-procedure), [ownership chains](https://learn.microsoft.com/en-us/sql/relational-databases/tutorial-ownership-chains-and-context-switching), [transaction application locks](https://learn.microsoft.com/en-us/sql/relational-databases/system-stored-procedures/sp-getapplock-transact-sql).

## Subsequent Phase 02F boundary

Migration 011 implements explicit reissue and audited reception print/render handoff; cancellation and remaining administration remain pending. The current total after Phase 02H is 47 procedures plus four private functions, with API 14, worker 5, auth 6, media 1 and renderer 4 public grants. The 40 core cases pass on this migration set. See [document 13](13_Reissue_Printing_and_Card_Rendering.md).
