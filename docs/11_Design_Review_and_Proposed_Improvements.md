# 11 - GatePass design review and proposed improvements

Date: 20 October 2026

Status: Improvement proposals with the user's confirmed registration-only grouping clarification below. Existing HLD and SQL source files have not been changed. This is a design review, not execution testing or a security certification.

## 01. Sources and agreed scope

Reviewed the shared conversation, including the user's clarifications, the complete local v1.1 HLD, architecture and workflow PNGs, four Chen ER diagrams, the 20-table SQL script, ER-to-SQL mapping and all eight PDF pages. Compared the local v1.0 ZIP with v1.1: the SQL scripts are byte-for-byte identical; the HLD revision reorganizes presentation and diagrams.

Source documents are in `C:/Users/utpatel/Downloads/`: `01_GatePass_HLD.md`, diagrams `02` through `07`, `08_SQL_Server_Schema.sql`, `09_ER_to_SQL_Mapping.md`, `10_GatePass_Visual_Walkthrough.pdf` and `gatepass_gatepass_hld_schema_v1.zip`.

Agreed behavior:

- India -> Location -> Project -> Assigned Guards; four locations; projects can span locations.
- TEMP_ID: corporate SSO/MFA, captured photo, location scope, manager notification without approval.
- Employee project visits and external visitors: the assigned host approves each person's visit, based on current project membership from the trusted API.
- Confirmed clarification on 20 October 2026: grouping exists only during registration so one submitter can enter shared visit details once and add multiple people. After submission, each person's approval/status, pass, reception row, guard row, movements and reporting are individual. Do not show group occupancy/progress or couple visitors' entry/exit.
- Corporate email only for employees; optional email for external visitors.
- Reception printing for every participant is the standard workflow; digital delivery is supplementary.
- Static QR, online verification, separate explicit movement action, repeated entry/exit during the allowed window.
- English primary labels with regional text alongside on guard screens.
- React/TypeScript PWA, Express/TypeScript, SQL Server, worker and private photos on one private VM behind the approved gateway.
- Extra identity-proofing, directory photos, additional approvers, lost-card integration, floors, zones, checkpoints and mandatory Redis are outside the agreed v1 scope.

## 02. Resolve credential recovery for reprint and delivery - before implementation

Evidence: HLD sections 02/08 require hash-only credential storage and later reprint. SQL `AccessPasses` stores `CredentialHash`; `PassDeliveryLinks` stores `TokenHash`. No recoverable credential or protected card artifact is specified.

A one-way hash cannot reconstruct the original random QR credential. This affects reception reprints, subsequent digital views and asynchronous delivery after the creation response is gone.

Proposal: keep the hash for verification and retain a separately protected, encrypted credential or encrypted card-render payload for authorized printing/viewing. Use authenticated encryption from a maintained library, a key version and an enterprise-approved key store separate from the stored ciphertext. Decryption is limited to authorized rendering; plaintext credentials must not enter logs or ordinary outbox JSON. This explicitly revises the existing hash-only-at-rest rule, so it must be documented as a design change. If hash-only storage is an absolute requirement, choose a different reviewed credential/rendering design before development.

Reprint preserves the existing QR. Reissue revokes the old credential and delivery links and creates a fresh QR in one transaction. Card PDFs containing the QR are also sensitive credentials.

Verification scenario: restart API/worker, print the existing pass again, confirm identical QR; reissue, confirm the old QR and delivery links no longer authorize retrieval/entry.

## 03. Keep registration convenient and subsequent visits individual - confirmed direction

Existing design: approval belongs to `VisitRequests`, with one decision shared by its participants. This predates the user's clarification that grouping is registration-only. `VisitRequests.RowVer` exists, but modifying participants does not automatically change the parent's rowversion.

Proposal: one registration form captures common location/project/host/reason/window once and uses Add Person for individual name/photo/optional email. Submission creates independent per-person visits; approval or denial of one visitor does not decide another visitor's access. A simple implementation is one VisitRequest with one VisitParticipant per person, preserving the existing one-decision-per-request schema. The registration batch may be correlated internally for submission retries and audit, without appearing as an operational group.

Freeze each person's submitted approval-relevant details. Material changes require a new individual request in v1. Bind decisions to that request's submitted version; simultaneous approve/deny actions commit only one result. Batch submission retries return the same individual request results rather than creating duplicate visitors.

Verification scenario: register A, B and C in one form; approve A, deny B and leave C pending. Reception and guards see three independent records with those statuses. Adding D requires a new individual request and approval. An old email cannot approve a revised destination/time window.

## 04. Specify distinct ENTRY and EXIT policies - before implementation

Evidence: HLD permits exit after expiry, but the shared ENTRY/EXIT pseudocode validates the time window/current pass before branching. Reissue revokes the old pass, and handling an already-inside person's revoked card is not fully described.

Proposal: ENTRY checks current approval, active/current pass, time, active participant, active organization scope and current staff permission. EXIT checks the recorded INSIDE state and authorized staff/location, with an explicit audited reconciliation path when the pass has expired, been revoked or been replaced. Rejected old credentials never regain entry permission. A guard can locate the existing occupant through an authorized manual lookup to record the departure. A removed/cancelled participant who is still inside remains on the occupancy list until departure is recorded.

Record movement time and recording time separately for supervised downtime reconciliation; do not silently backdate ordinary events. Data updates and audit remain atomic.

## 05. Handle duplicate employee requests - before implementation

Evidence: `ParticipantPresence` is keyed by ParticipantId. It survives QR reissue for the same participant, but two requests for one employee create two independent ParticipantIds. Thus it is visit-participant state, not a globally unique person's presence.

Proposal: a repeated TEMP_ID submission for the same employee/location/local day returns the existing usable request; an intentional replacement uses reissue. Enforce under a transaction so simultaneous submissions cannot bypass it. Define a comparable overlap rule for the same employee/project-location. Do not prevent legitimate visits to different projects by applying an indiscriminate global employee lock.

Report project occupancy separately from a deduplicated location headcount. Do not add mandatory identity-document collection merely to deduplicate external visitors; document that external headcount depends on submitted records and guard discipline.

## 06. Make TEMP_ID movement permission explicit - before implementation

Evidence: project guards require a matching GuardAssignment. TEMP_ID has no ProjectLocationId; HLD refers to a permitted reception/temp-pass workflow without a complete capability matrix.

Proposal: define an explicit location-scoped capability for designated guards to verify and record TEMP_ID movement. Reception's print capability does not automatically grant movement or approval powers. This can be implemented as a permission on the existing location role model; it does not require checkpoint inventory. Audit capability changes.

## 07. Recover the notification worker after interruption - before pilot

Evidence: `NotificationOutbox` has PROCESSING status, attempts and next-attempt time, but no claim owner, expiring lease or diagnostic failure field.

Proposal: atomically claim work with an expiring lease, recover abandoned claims, use bounded backoff, deduplicate jobs and expose terminal failures for controlled retry. Suggested fields: LockedBy, LockedUntilUtc, LastErrorCode and a unique business deduplication key. Recheck whether a notification remains relevant before sending an old approval card.

Email dispatch may be repeated if the provider accepted a message before a worker crash. Avoid an exactly-once email promise; make the associated decisions/pass actions idempotent and use provider deduplication when available.

## 08. Enforce revocation for live connections and cached screens - before pilot

Evidence: HLD requires next-attempt permission revocation and authenticated Socket.IO rooms, but does not specify live-room removal or protected PWA cache behavior.

Proposal: authorization checks apply to room subscriptions and every sensitive action. Assignment/role revocation removes live subscriptions or disconnects the affected connection; subsequent outbound data is also authorized. Reconnection rebuilds scope from current grants. Cache only the static PWA shell; protected photos, passes and reports use no-store responses and are excluded from service-worker caches. Clear visible sensitive state on logout/permission loss. Previously observed information cannot be retroactively erased from a person's knowledge.

## 09. Finish persistence and concurrency contracts - before implementation

The 20 tables are business tables, not a fixed maximum table count. Choose supported SQL-backed session storage, short-lived public intake ownership and durable idempotency storage as needed. Do not rely on an in-memory production session store on the single VM.

An idempotency record must bind actor, operation, resource and payload fingerprint; the same key with a different operation/payload must be rejected. Apply it to submission, decision, movement and reissue. A recorded print job means a render/dispatch attempt, not proof that paper physically emerged from an ordinary browser printer.

Use one documented transaction/lock ordering across entry, exit, cancellation, reissue and approval. A presence-row lock alone does not serialize a concurrent update to pass/request permission if those rows are read before locking and never rechecked. Define when concurrent revocation takes effect and test both commit orders. Directory freshness can only be as current as the trusted source and synchronization contract.

Additional SQL consistency candidates: ensure LastAccessEventId belongs to the same participant, scan location agrees with its project-location, pass validity is within request validity, pass version is positive, revocation/deallocation metadata agrees with state, and active assignments that have expired do not permanently block replacement scheduling. Some rules belong in transactions; use constraints for suitable local invariants.

## 10. Small operational and UX additions - before pilot

- Show photo, destination, approval, validity and current INSIDE/OUTSIDE state together. Enable only the appropriate Entry or Exit action, with server enforcement.
- Include a freshness indicator and connection status; after reconnect, refresh server state before enabling movement actions. Do not queue offline entries for silent replay.
- After multi-person registration, show individual visitor records throughout host approval, reception, guard operations and reporting. No group progress/count such as '2 of 5 inside'.
- Provide overdue occupancy and failed-notification queues, with actionable reasons and audited manual reconciliation.
- Give pending requests an approval deadline; late clicks cannot activate an elapsed visit. Any edited/rescheduled visit follows the submitted-content rule in section 03.
- Define retention cleanup for photos, encrypted card artifacts, abandoned intake uploads, delivery links, exports and their references; exact periods remain an organizational policy decision.
- Support QR/manual lookup with identical authorization, and show bilingual status text as well as color.

## 11. Integration order and evidence

Run a small tenant-level Outlook Actionable Messages proof of concept before polishing the host UI: current Entra authentication, registration, sender requirements, actual supported client behavior, callback reachability through the gateway and SSO review fallback. This validates an existing dependency, not a new approval step.

Then verify request snapshots, credential reprint/reissue, concurrent actions, duplicate TEMP_ID prevention, revoked/expired occupant departure, scope revocation on HTTP and sockets, worker recovery and restore on a clean environment. SQL execution and these integration tests have not been run during this read-only design review.

Primary references checked on 20 October 2026:

- [Microsoft: current Entra authentication for Actionable Messages](https://learn.microsoft.com/en-us/outlook/actionable-messages/enable-entra-token-for-actionable-messages)
- [Microsoft: SQL Server table hints and transaction locks](https://learn.microsoft.com/en-us/sql/t-sql/queries/hints-transact-sql-table?view=sql-server-ver17)
- [OWASP: cryptographic storage and key management](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
- [OWASP: session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP: WebSocket security](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)
- [Microsoft: transactional outbox design principles](https://learn.microsoft.com/en-us/azure/architecture/databases/guide/transactional-out-box-cosmos) - reference for messaging semantics, not a proposal to adopt Azure Cosmos DB.
