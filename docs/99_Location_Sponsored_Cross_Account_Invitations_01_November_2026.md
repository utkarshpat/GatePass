> Documentation status: historical implementation/design/evidence record, indexed 3 November 2026. Read the [current handbook](system/README.md) and [Visit owner/Host glossary](109_Visit_Owner_and_Host_Terminology_03_November_2026.md) for current behavior. Counts, setup examples and screenshots below describe their dated stage, not a fresh certification.

# Location-sponsored cross-account invitations

> Scope clarified on 2 November 2026: [host/facilities coordination only](101_Coordination_Only_Scope_02_November_2026.md). Existing QR card allocation, reception and guard workflows remain. The reception-linking/separate-gate extension in report 100 was withdrawn; its results below are historical.

Correction requested and implemented on 1 November 2026. This supersedes the destination-host prerequisite in reports 97/98; the original one-destination demo and foreign-account rejection results describe the earlier implementation.

## Business rule

An active internal employee with at least one current eligible approved account-host grant in an office, or an explicitly approved location-planning host grant there, may sponsor a visit request for any active configured sub-project in that office. Destination account membership or a destination host roster entry is not required. Ordinary employee membership alone does not make an invitation sponsor. An account sponsor can also request a location-only visit, subject to that office's configured process.

Example: employee1 is an approved Accounts 1 host in Noida. They may select Noida's Accounts 2 / Project 1 and Accounts 3 / Project 1. Noida baseline approval and each selected destination's internal authority are separate required steps. Clearing Accounts 2 does not clear Accounts 3. The host cannot approve their own invitation. CLIENT_CONFIRMATION steps still require an assigned internal coordinator and recorded reference.

This allows requests across account boundaries, not entry across them. The office context, parent account-office, destination activation and directory freshness are checked on the server. Other offices remain unavailable unless the employee has eligible sponsorship there. Unconfigured projects need actual project/policy setup before a valid submission; this change does not invent organizational destinations or approval rules.

## Implementation and boundaries

- Forward migration 128 introduces `_PlanningSponsor`, updates the existing `_PlanningHost` request helper and extends workspace discovery for approved account hosts without a child roster. No applied migration 001–127 is edited.
- The same helper is used by protected OPTIONS, create/version building, live workflow checks and readiness. Its legacy name means sponsorship only; the response fields `canHost`/`canHostLocation` remain compatible.
- An office-wide authenticated destination catalogue is intentional for approved invitation sponsors. People, approver policy definitions and host rosters in OPTIONS remain management-scoped. Public visitor host discovery and walk-in registration are unchanged.
- Account/sub-project host-list administration still checks the exact account scope and eligibility. No administrative role, destination membership, visitor-record access, private discussion access or gate grant is created by destination selection.
- Revoking all eligible source account/location grants blocks new requests and readiness, including create retries. Historical owner access remains for accountability. Another still-current same-office source grant can continue sponsorship. Destination policy/authority checks remain live.
- Invitation UI explains independent destination approval. Existing host-roster settings clarify that those rosters are not a destination-selection allowlist.

## Verification

- Full unit/contract CI: **684 total, 683 passed, one platform skip, zero failures**. Included-source coverage: 97.83% lines, 90.87% branches and 94.55% functions. This does not measure SQL/React execution.
- Fresh owned SQL database: all 128 migrations parsed/applied; **33 schema/permission checks** and **47 execute-only workflow/scope/replay checks** passed. Source-only sponsorship works before child host assignment. Destination membership is absent; stale source/destination directory data and inactive destination parent/binding fail closed. Sole source revocation blocks readiness/create retry/decisions while historical reads remain scoped.
- **12/12 real-SQL Coordination browser tests passed**, including phone/laptop UI, accessibility, private discussions, replay/lifecycle, stay dates, and the new cross-account selection with independent destination decisions and foreign-office rejection. The disposable database was removed by its ownership-checked harness.
- Typecheck, ESLint, seven production React bundles and 128 sequential migration hashes passed. All 121 previously published migration hashes remain unchanged; migrations 122–127 also remain unedited by this correction.
- Migration 128 applied to local `GatePass_DesignTest`; the local server restarted. Actual employee1/2/4 sign-in each showed all three configured Noida destinations (Accounts 1/2/3, each Project 1), with all three simultaneously selectable. No retained visits were submitted, no destination membership/host grant or policy was changed, and no email was sent by this smoke. The separate NHS checkout/database was untouched.

Ignored evidence: `tmp/cross-account-units.log`, `tmp/cross-account-coordination-final.log`, `tmp/cross-account-typecheck.log`, `tmp/cross-account-lint.log`, `tmp/cross-account-build.log`, `tmp/cross-account-local-smoke.log` and synthetic screenshot `output/coordination-cross-account-selection-1366.png`.

## Remaining integration

Planning notices remain persisted intents, not dispatched Graph emails. Invitation-to-pass binding and exact sub-project enforcement in guard/reception are still pending. READY is planning readiness, not a newly issued visitor credential. This correction does not claim those integrations or production sign-in are complete. No push is included.

Subsequent integration: [2 November reception-assisted binding and exact planned destination gates](100_Planned_Pass_Binding_And_Destination_Gates_02_November_2026.md) supersedes the blanket pending statement for linked registered EXTERNAL guests. Public redemption, planning email and unlinked walk-in parity remain pending.
