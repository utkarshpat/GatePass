# 04. Data, state and transactions

> Current source documentation: **28 October 2026**, migrations **001–121**. See [current release/configuration evidence](../88_Documentation_And_Release_28_October_2026.md), [individual visitor flow](../85_Individual_Visitor_Registration_27_October_2026.md), [runtime .env configuration](../86_Runtime_Environment_Configuration.md) and [organization requirements](../87_Organization_Production_Requirements.md). Earlier exported PDFs, screenshots and dated reports are historical.

Approval, current pass validity, account presence and printed-card return are separate dimensions. A returned visit may retain `APPROVED` while its pass is `REVOKED`, the holder is outside and the printed-card control shows Returned. Return correction is receipt/pass-bound and audited; a replacement request/pass may fence correction. Optional `CompanyName` and canonical `DeviceTypesJson` belong to each individual visit snapshot. Migration 084 keeps the same five-code canonical order without an unbounded LOB sort. Migration 085 compares audit-window duration without overflowing far-future datetime values.

## Baseline and domains
Source contains forward migrations 001–121. The generated SQL catalog records hashes/object declarations, not a fresh live-database drift attestation. Compare deployment ledger and approved artifacts before startup. Never rewrite an applied migration to change behavior.

| Domain | Records/relationships |
|---|---|
| Identity/directory | Users, Employees, staff, managers, accounts, locations, exact employee account-location membership |
| Authorization | Scoped grants/capabilities, guard allocations/common duties, sessions/credential versions |
| Intake/visits | Intake context, photo assets, independent VisitRequests and immutable approval snapshots |
| Passes | Access pass lifecycle, credential hash/envelope and replaced lineage |
| Movement | VisitPresence for requested account visits; separate employee-account Digital ID presence; immutable events |
| Printing | Requested/dispatched jobs, retry receipts, explicit reprints |
| Notifications | Outbox, leases/fences, attempts, current relevance and acknowledgement |
| Audit | Role/credential history, operation correlations and idempotency receipts |
| Outlook | EmployeeEntraIdentities maps verified tenant/object ID to employee |

Historical data dictionary explains columns but later ALTER migrations supersede old counts. The source catalog gives provenance; inspect the deployed catalog for actual latest columns, indexes, constraints and permissions.

## Visitor stay and routing contracts
Migration 116 accepts exactly one visitor, rejects a public account selection, resolves the eligible host route server-side and permits a today-started stay through the selected final day within policy. SQL stores the end as exclusive next midnight. Display labels subtract one minute only at India calendar-day boundaries; non-midnight ends and authorization comparisons remain unchanged. Migration 117 keeps active multi-day visitors in current operational queues. Migration 118 retains bounded device canonicalization. Historical grouped visits are not deleted or rewritten.

## Independent lifecycles
Decision, credential validity, presence, print job and notification are separate. APPROVED is not Inside. QR verification does not write entry. Printed pending cards do not grant account access. Revocation/cancellation does not silently erase occupancy.

Decision states include PENDING, APPROVED, DENIED and CANCELLED. Credential contracts separately distinguish pending/active/revoked/replacement; expiry also follows validity timestamps. Permission cannot be derived from badge color or display text.

## Idempotency and concurrency
Retain a stable client key for the same uncertain operation. SQL serializes relevant entities and binds replay to actor, payload and snapshot. Retry must not duplicate a request, movement, grant or render dispatch. Deliberate reprint/new operations use new keys. Replay still checks current scope/membership.

A lost response is an unknown outcome, not proof of rollback. Reconcile live state. External email cannot inherit exactly-once SQL semantics: a crash after provider acceptance and before acknowledgement may duplicate mail while business decisions remain idempotent.

## Account presence
Digital ID entry requires exact current employee account-office membership. Each selected account has independent presence. A later valid daily card can close an earlier entry using retained employee/account identity, recording original entry and presented visits.

Inside lists current entries recorded by that guard for the selected duty. Another assigned guard may process departure without inheriting roster ownership. Revocation blocks new entry; current occupants retain an authorized departure/reconciliation path. Invalid/cancelled credentials are not silently replaced while their account occupancy remains unresolved.

Common areas are office-scoped verification duties, not fake accounts/campus checkpoints. They have no entry/exit/global occupancy. Pending or approved visitor identity may be verified there according to SQL policy; account entry remains approval-gated.

Migration 064 updates reception/report read models: current Temporary ID occupants come from employee/account presence, including replacement IDs and unclosed overnight entries. Office reports count distinct employee IDs across authorized account duties; a account report counts only its authorized scope. Reception's matching-list Inside metric deduplicates replacement employee IDs. These current presence counts are separate from selected-day request totals and do not represent building occupancy.

## Print lifecycle
Preview is a read. A keyed print request creates an audited job. Its immutable replay receipt may still say REQUESTED after dispatch, so the UI checks live status. Render is fenced and reauthorizes material; DISPATCHED means server handoff. Popup acknowledges successful image decoding with the exact job ID, origin and opener. Browser display and physical printing are distinct. Explicit reprint creates a separate job without rotating the current pass QR.

Sources: migrations 003-020, 048-062; docs/database/05_State_and_Transaction_Contracts.md; docs/34_Guard_Duties_and_Project_Presence.md; docs/37_Reception_Audit.md.

## Account host policy update

See [accounts and approved hosts](../89_Accounts_And_Approved_Hosts_28_October_2026.md). Account-office host lists are explicit and administered within scope; membership alone does not enable hosting. Legacy API/schema names remain compatible.
