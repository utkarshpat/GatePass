# 04. Data, state and transactions

## Baseline and domains
Source contains forward migrations 001-062. The generated SQL catalog records hashes/object declarations, not a fresh live-database drift attestation. Compare deployment ledger and approved artifacts before startup. Never rewrite an applied migration to change behavior.

| Domain | Records/relationships |
|---|---|
| Identity/directory | Users, Employees, staff, managers, projects, locations, exact employee project-location membership |
| Authorization | Scoped grants/capabilities, guard allocations/common duties, sessions/credential versions |
| Intake/visits | Intake context, photo assets, independent VisitRequests and immutable approval snapshots |
| Passes | Access pass lifecycle, credential hash/envelope and replaced lineage |
| Movement | VisitPresence for requested project visits; separate employee-project Digital ID presence; immutable events |
| Printing | Requested/dispatched jobs, retry receipts, explicit reprints |
| Notifications | Outbox, leases/fences, attempts, current relevance and acknowledgement |
| Audit | Role/credential history, operation correlations and idempotency receipts |
| Outlook | EmployeeEntraIdentities maps verified tenant/object ID to employee |

Historical data dictionary explains columns but later ALTER migrations supersede old counts. The source catalog gives provenance; inspect the deployed catalog for actual latest columns, indexes, constraints and permissions.

## Independent lifecycles
Decision, credential validity, presence, print job and notification are separate. APPROVED is not Inside. QR verification does not write entry. Printed pending cards do not grant project access. Revocation/cancellation does not silently erase occupancy.

Decision states include PENDING, APPROVED, DENIED and CANCELLED. Credential contracts separately distinguish pending/active/revoked/replacement; expiry also follows validity timestamps. Permission cannot be derived from badge color or display text.

## Idempotency and concurrency
Retain a stable client key for the same uncertain operation. SQL serializes relevant entities and binds replay to actor, payload and snapshot. Retry must not duplicate a request, movement, grant or render dispatch. Deliberate reprint/new operations use new keys. Replay still checks current scope/membership.

A lost response is an unknown outcome, not proof of rollback. Reconcile live state. External email cannot inherit exactly-once SQL semantics: a crash after provider acceptance and before acknowledgement may duplicate mail while business decisions remain idempotent.

## Project presence
Digital ID entry requires exact current employee project-office membership. Each selected project has independent presence. A later valid daily card can close an earlier entry using retained employee/project identity, recording original entry and presented visits.

Inside lists current entries recorded by that guard for the selected duty. Another assigned guard may process departure without inheriting roster ownership. Revocation blocks new entry; current occupants retain an authorized departure/reconciliation path. Invalid/cancelled credentials are not silently replaced while their project occupancy remains unresolved.

Common areas are office-scoped verification duties, not fake projects/campus checkpoints. They have no entry/exit/global occupancy. Pending or approved visitor identity may be verified there according to SQL policy; project entry remains approval-gated.

## Print lifecycle
Preview is a read. A keyed print request creates an audited job. Its immutable replay receipt may still say REQUESTED after dispatch, so the UI checks live status. Render is fenced and reauthorizes material; DISPATCHED means server handoff. Popup acknowledges successful image decoding with the exact job ID, origin and opener. Browser display and physical printing are distinct. Explicit reprint creates a separate job without rotating the current pass QR.

Sources: migrations 003-020, 048-062; docs/database/05_State_and_Transaction_Contracts.md; docs/34_Guard_Duties_and_Project_Presence.md; docs/37_Reception_Audit.md.
