# 04. Data, state and transactions

> Maintained source handbook — **4 November 2026 · migrations 001–136**. [Current status and evidence](11_Readiness_Gaps_and_Roadmap.md) · [Terminology](../109_Visit_Owner_and_Host_Terminology_03_November_2026.md). Source review is not production acceptance.

## Source and naming

There are 136 immutable forward migration files. The [generated SQL catalogue](REFERENCE_SQL_Catalog.md) records declaration provenance and hashes, not a new live-database drift attestation. Existing local application and isolated-test migrations through 136 were recorded in the prior implementation evidence; this documentation refresh does not apply SQL.

| Domain | Main contract |
|---|---|
| Identity/directory | Users, employees, staff, managers, exact office/account membership and freshness |
| Authorization | Scoped grants, capabilities, current sessions and guard duties |
| Ordinary visits | Independent request snapshots, decisions, pass credentials, presence and movement history |
| Printing/return | Fenced print jobs/handoffs, final returns and reasoned corrections |
| Coordination | Projects, approved hosts/policies, versioned plans, approvals/tasks, scoped threads/events/replays |
| Preparation/groups | Versioned preparation, extra recipients/service tasks, reusable routing groups and selected snapshots |
| Delivery/audit | Independent registration/planning queues, worker leases/fences and append-only controlled audit |

Legacy `gp.Projects` / `gp.ProjectLocations` represent accounts and account-office pairs. Real projects live in `gp.SubProjects`. Legacy operational PROJECT enum/field names remain compatible. Coordination `HostUserId`/domain `hostId` and read/mail `hostName` mean Visit owner. Preparation `visitOwnerId` means additional FYI contact.

## Independent state dimensions

Approval, credential validity, account presence and printed-card return are separate. A returned request may still show APPROVED while its pass is REVOKED and the holder is outside. Verification does not create movement. A pending card is not entry permission. Common-area verification does not establish account presence or authoritative building occupancy.

Every state-changing operation locks/rechecks its authorized scope and uses an operation-specific stable replay key. Replacement/cancellation invalidates applicable credentials/render/outbox material while preserving unresolved actual presence for controlled exit/reconciliation. Return correction binds the current pass/return receipt and reason; replacement can fence correction.

Preview is a read. Print creates an audited job; live status, render fencing and final authorization are separate from an immutable request receipt. DISPATCHED means server handoff, not a physically printed card. Reprint is another job without arbitrarily rotating the pass QR.

## Coordination versions and privacy

- 122–128 introduce the project catalogue, scoped policies/hosts, versioned planning, private discussions and source-office sponsorship.
- 129–130 were an extension; 131 restores the coordination-only operational boundary. Their presence in history does not enable a current planned gate.
- 132 adds `gp.PlanningMailDispatch` with fenced worker claim/content/renew/complete contracts.
- 133–134 add preparation, extra people, service-task ownership, scoped routing/contact reads and stable draft round-trip.
- 135–136 add `gp.VisitRoutingGroups`, per-version selected group snapshots/reviewers and scoped catalogue/notification delivery.

Each destination approval is independent and additive to office requirements. Revisions snapshot new rules/people/groups and invalidate obsolete readiness as required. Editing/retiring a selected group can cause POLICY_CHANGED; removed approvers lose current authority and removed FYI recipients are suppressed before dispatch. Raw email members receive no identity, review link or project access.

Drafts do not enqueue planning invitation mail. New notice inserts enqueue delivery; old history is not backfilled. Planning readiness, including required support tasks, is a planning result only. It neither creates a pass nor changes existing movement/return authorization.
