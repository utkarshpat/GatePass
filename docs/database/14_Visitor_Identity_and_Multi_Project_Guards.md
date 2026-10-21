# 14 - Visitor identity cards and shared-area project guards

Version: 1.7 | Date: 20 October 2026 | Current policy: Phase 02G

## Confirmed flow

Reception can print an individual visitor card immediately after registration and its reception verification. A guest may wait in the designated common lobby while the requested host considers project access. Host approval controls entry to that requested project. No new floor, zone or checkpoint inventory is introduced in this block; common-area admission remains the reception/security operating process.

The visitor's printed card presents identity: company branding, name, photo, QR, office, validity and references, plus the small GatePass signature. It has no permanent pending/approved label, project/host details, approval explanation or access instruction. Printed status would become stale after a host decision. The existing 85.6 × 54 mm landscape format and central company QR icon remain.

Both eligible pending and approved cards carry their existing opaque credential. Approval changes live state without changing that credential or requiring another card. Printing or scanning never records ENTRY. Pending, denied, cancelled, expired or revoked requests cannot create normal project ENTRY.

One guard may cover four projects in the same shared area at the same time. **There is no mandatory single-project duty mode.** The guard can scan visitors for all current assigned projects. A scan identifies this individual request's destination and live approval; the UI action names that exact project, for example Entry — Project B. Guard assignments define the guard's working scope; they do not confer those projects on a visitor.

Each individual project request still has one destination and its own approval, pass and presence history. This change does not merge people or grant a visitor every project covered by a shared guard. Digital ID remains location-only and is not a project entitlement.

## Database-first changes

012 and 013 are applied forward migrations; previously applied 003/010/011 are unchanged. 012 initially added explicit selected-project scan context. The user's shared-area clarification is implemented by 013: scan defaults to all currently authorized assignments, with an optional narrowing filter. Every project movement still explicitly names its action target.

Phase 02G itself did not change physical tables. After the subsequent card-detail migration 014, current totals are 33 tables, 297 columns, 58 FKs, 14 migration history rows, 47 procedures and four private functions. API has 14 individual EXECUTE grants; worker 5, guard-auth 6, media 1 and renderer 4 remain separate. Runtime roles have no permanent members and retain direct schema read/DML/ALTER denial.

| Contract | Current behavior |
|---|---|
| ListGuardWorkContexts | Authenticated guard at an active office receives all active, in-window assigned projects for which movement capability exists, plus its Digital ID capability. This is a live advisory list, not a cached permission token. |
| VerifyGuardPass | With no selected-project filter, resolves any currently visible assigned project request. An explicit filter only narrows visibility. Unknown/out-of-scope/mismatching results stay redacted. Live approval and eligible actions are returned; no movement is created. |
| RecordMovement | SelectedProjectLocationId is mandatory for ordinary project movement and must equal the visit destination. Normal location-only Digital ID movement uses NULL. SQL rechecks actor/session, role/capability, current assignment, pass, approval, validity and presence under the existing locks. |
| Movement retries | The exact action target is included in canonical idempotency payloads and the committed receipt. Changing projects with the same key conflicts; a four-project guard cannot substitute B for an A request. |
| BeginPassRender | Only the isolated renderer obtains the owned eligible pending/approved credential envelope. Existing current-pass/source binding, bounded claims and final handoff authorization remain. |

The selected project in a movement is the named target of that one action, **not a persistent guard duty selection**. A client-supplied target is never sufficient authority; it must match trusted visit state and current guard assignment. The existing reconciliation path remains available to authorized staff for historical INSIDE occupants and never grants entry. Protected list/detail eligibility hints remain advisory until the exact mutation succeeds.

012 invalidates any outstanding REQUESTED/RENDERED artifacts from the earlier card policy; they must be rendered afresh. Existing dispatched history remains. Approval racing an unfinished render still invalidates its bound source state; a safe new print request can retry. Once a pending card has been handed off, later approval needs no reprint.

## Internal services and evidence

VisitReadService exposes all simultaneous work contexts and optional scan filtering through typed allowlisted RPCs. GuardMovementService accepts only the visible action's exact visit, pass, office and project target, hashes scan credentials before SQL, projects a bounded receipt and redacts backend errors. Reconciliation has no new ordinary public-service shortcut. Production HTTP routes/driver and guard UI remain unimplemented.

20 restricted SQL cases passed, including one observed independent-connection authorization wait. Cases cover a four-project guard, A/B scanning without mode switching, project substitution, missing context, current deallocation/expiry, office-only Digital ID, idempotency, exit and role separation. Six movement unit cases and 19 read/photo cases cover internal boundaries. The full Node run now passes 98 cases: directory 18, guard auth 15, registration 17, reads 19, printing 23, movement 6.

The current 55-case printing suite includes six nested actual restricted SQL/backend scenarios. The updated pending journey reissues its synthetic encrypted fixture, prints its QR without approval labels, scans it as PENDING with entry disabled, obtains the host decision and verifies the **same printed QR** as VALID without another render. 23 printing unit cases include byte-identical cards before/after approval and independent decoding of 24 synthetic credentials at three raster sizes, plus full-card detection. These are not real printer/camera or browser acceptance results.

Current source hashes, cleanup and exact scope are recorded in database/validation/guard-project-context-report.json, pass-print-report.json, pass-print-backend-integration.json, guard-movement-unit-report.json, visit-reads-unit-report.json, pass-print-unit-report.json and all-unit-test-report.json. Existing core 40, guard-auth 39, registration 43 and scoped-read 47 suites pass on the updated contract. Disposable projects/assignments/visits/sessions/audits are removed; only the requested dummy master data and seed audit persist.

```powershell
# Apply only missing migrations, in order; recorded versions are refused.
./database/setup/Apply-LocalTransactionCore.ps1 -Migration 012 -TrustLocalServerCertificate
./database/setup/Apply-LocalTransactionCore.ps1 -Migration 013 -TrustLocalServerCertificate
./database/tests/Test-GuardProjectContext.ps1 -TrustLocalServerCertificate
./database/tests/Test-PassPrinting.ps1 -TrustLocalServerCertificate
```

Guard presentation must show project, host approval, photo, validity and the exact named action without forcing a project switch before every scan. An optional project filter can help a guard's list; it never expands scope. Card print remains abstracted from this workflow.

Project presence is not building occupancy: a pending guest can be physically in the lobby while OUTSIDE the project. Do not label an aggregation of project presence as total building headcount. Separate reception arrival/departure tracking has not been requested or implemented. Actual guard UI, common-area operating process, HTTP/SSO/private storage, physical printer/device pilot and Linux deployment remain application/rollout gates.


Card field/layout refinement is now implemented in [document 15](15_Trusted_Card_Details_and_Layout.md), including employee assigned projects and visitor host identity. This supersedes earlier mockup-only/field omissions; approval and guard policy above remains unchanged.


Subsequent cancellation/occupancy is implemented in [document 16](16_Individual_Cancellation_and_Occupancy.md). Physical printer testing is deferred to final acceptance and does not block other development.
