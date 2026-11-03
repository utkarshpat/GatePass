> Documentation status: historical implementation/design/evidence record, indexed 3 November 2026. Read the [current handbook](system/README.md) and [Visit owner/Host glossary](109_Visit_Owner_and_Host_Terminology_03_November_2026.md) for current behavior. Counts, setup examples and screenshots below describe their dated stage, not a fresh certification.

> The separate manual planned-pass linking and planned-gate extension below is **withdrawn**. Existing registration, Reception and Guard operational gates remain in use; see the current handbook.

# Reception-assisted planned passes and exact destination gates

> Scope clarified on 2 November 2026: [host/facilities coordination only](101_Coordination_Only_Scope_02_November_2026.md). Existing QR card allocation, reception and guard workflows remain. The reception-linking/separate-gate extension in report 100 was withdrawn; its results below are historical.

Implementation milestone: 2 November 2026. Extends [source-office sponsorship](99_Location_Sponsored_Cross_Account_Invitations_01_November_2026.md). This is the reception-assisted bridge to an existing visitor registration, not public invitation redemption or an organization-wide walk-in cutover.

## Working operator flow

1. An approved host submits a single-guest plan. Office and selected project authorities decide independently as before.
2. The guest completes the existing individual visitor registration/photo, or reception performs manual registration with the same host. Reception opens that registered visitor's details and uses **Planned invitation**.
3. Matches are limited to reception's current office, the same visitor name, email when the plan supplies one, the same host employee, an overlapping validity window and a current submitted invitation. Reception enters linking remarks. The server requires at least one independently READY selected destination, a current usable photo/pass, no return and no existing occupancy. This is a receptionist-assisted match, not identity-document verification.
4. One current registration/pass is bound to one immutable invitation version. The existing credential/photo/validity are reused; linkage does not widen their validity window. Existing normal printing remains available for the active registered card. A pending sibling destination remains pending.
5. Guard opens **Planned visitor access**, chooses an exact assigned destination, searches the expected/inside queue or scans the current pass, and records entry/exit. The panel is within the native Guard page; reception linking is within its existing pass detail.
6. Movement keeps separate presence for each selected sub-project and immutable destination-linked access events. Reception timelines identify the actual account/project. The existing building-return check sees aggregate presence and stays blocked while any destination is still inside.

Guard destination scope currently inherits the existing account-office guard allocation. No additional per-sub-project guard-assignment editor or new staff grant is introduced. This does not permit a guard allocated only to Account A to read or operate Account B.

## Enforced server boundaries

- `gp.PlannedAccess` is the only new public SQL RPC, added to the fixed API allowlist and API role. New tables and helpers are not directly granted. HTTP actions are `/api/coordination/access-{options,link,duties,queue,detail,move}`, with existing session/CSRF verification before parsing and live SQL authorization.
- Office/destination/actor/authority are never accepted from arbitrary client fields. Responses project bounded DTOs. SQL identifiers normalize without rewriting names. Unknown fields and resources are rejected. Raw scanned QR values are hashed before SQL; no plaintext QR is stored in these tables or audits.
- Entry requires the exact selected destination on the bound current version, live office/project approvals, current source sponsor/policy, both plan and registration time windows, current active credential/photo and no badge return. Approval of a sibling project does not substitute.
- Bound passes cannot use legacy account-wide `RecordMovement`, `RecordGuardDutyMovement` or old host `DecideVisit`. Legacy guard detail disables those movement controls. Write checks remain authoritative even if an old UI is open.
- Plan changes serialize before destination movement using plan-then-visit locks. Binding and movement have actor/payload-bound retry keys. Unknown-result retries do not create a second link/entry. Replays recheck current session, guard duty and current presented credential.
- Cancellation/revision atomically cancels the old registered visit, revokes its credentials/delivery links, fails queued/rendered print work and cancels pending registration notifications. Occupancy/events remain. An already-inside visitor retains a currently authorized destination departure path, including after cancellation/revision or sub-project deactivation. An occupied inactive destination remains selectable for exit. Expired/revoked/cancelled state never grants a new entry.
- Binding cannot be silently removed to restore account-wide access. A revised invitation requires a new registration/version binding; the old pass does not inherit new approvals or dates. A mistaken assisted match must be closed and replaced, not silently edited into another guest.

## Schema and evidence

Forward migration **129** adds binding/presence/event provenance, scoped API, legacy bypass denial and scoped destination timeline labels. Forward migration **130** closes registered pass/printing lifecycle on plan cancellation/revision. Earlier applied migrations remain unchanged. Both applied locally to `GatePass_DesignTest`; the separate NHS checkout/database was untouched.

Verification:

- Full unit/contract CI: **691 tests total, 690 passed, one platform skip, zero failures**. Included-source coverage: **97.90% lines, 91.02% branches, 94.55% functions**. These figures do not measure SQL execution or browser coverage.
- Typecheck, ESLint, seven production React bundles and **130 sequential migration hashes** passed. Earlier published hashes are unchanged.
- Fresh disposable SQL applied/parsed every migration; **33 schema checks**, **47 planning persistence/scope checks** and **28 planned-pass gate checks** passed. Cases include independent approvals, match/office isolation, actual hashed-QR lookup/audit, denial of legacy movement, retry, stale versions, cancelled/revoked-card departure, inactive sub-project departure and aggregate return occupancy.
- **13/13 real-SQL Coordination browser tests passed**, including actual native reception linking and guard destination components at 390/1366px, pending sibling rejection, entry/exit, lost-link-response retry, accessibility and existing planning regressions. The owned test database was removed.
- Local real guard sign-in and the native Guard page showed its two configured assigned Noida destinations. No retained visitor, plan binding or gate movement was created by this smoke. The local server runs on port 8443.

Evidence: ignored `tmp/planned-access-units-final.log`, `tmp/planned-access-lifecycle-acceptance.log`, `tmp/planned-access-sql-reviewed.log`, `tmp/planned-access-typecheck-reviewed.log`, `tmp/planned-access-lint-reviewed.log`, `tmp/planned-access-build-final.log`, `tmp/planned-access-local-smoke.log`, and synthetic `output/planned-guard-destination-{390,1366}.png` / `output/planned-reception-link-1366.png`.

The dedicated acceptance harness creates and removes its own marked database. It uses actual native shared React components and real SQL with synthetic sessions, not corporate sign-in or physical QR/camera/printer hardware. Its extra component host is test-only and is not exposed by the local/production application server.

## Still pending

- Signed public invitation/completion links, automatic visitor redemption/binding, invitation-specific pass/card presentation and complete location-only/employee invitation handling. Current binding supports registered EXTERNAL guests with selected sub-project destinations.
- Planning Graph dispatch: approval, facilities, VIP/FYI, mentions and update/cancellation notice intents still are not sent by the existing worker.
- Mandatory equivalent policy enforcement for ordinary unlinked walk-ins/account-wide legacy passes. Exact gates here protect linked planned passes; do not advertise this milestone as organization-wide sub-project isolation while the old unlinked walk-in path remains.
- Dedicated sub-project guard allocations, a browser for prior private versions, polished/bilingual planned-operator UI, and invitation-specific camera/photo projection. The current gate panel can scan/search the registered card; operators use its existing printed/photo identity for checking the person.
- Real Entra/directory/mail, production web/deployment composition, device/printer acceptance, retention/recovery and independent security testing remain organization/deployment work.

No planning emails were sent and no real visitor movements or retained plan bindings were created by verification. No commit or push is included.
