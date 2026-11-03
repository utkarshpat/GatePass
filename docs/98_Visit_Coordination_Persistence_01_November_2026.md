> Documentation status: historical implementation/design/evidence record, indexed 3 November 2026. Read the [current handbook](system/README.md) and [Visit owner/Host glossary](109_Visit_Owner_and_Host_Terminology_03_November_2026.md) for current behavior. Counts, setup examples and screenshots below describe their dated stage, not a fresh certification.

# Visit Coordination — persistence and React workspace

> Scope clarified on 2 November 2026: [host/facilities coordination only](101_Coordination_Only_Scope_02_November_2026.md). Existing QR card allocation, reception and guard workflows remain. The reception-linking/separate-gate extension in report 100 was withdrawn; its results below are historical.

> Hosting/destination rule update: [location-sponsored cross-account invitations](99_Location_Sponsored_Cross_Account_Invitations_01_November_2026.md) supersedes the original destination-host restriction and its historical one-account test expectations below. An approved source-office host can request other accounts/projects at that office; every destination still needs its assigned independent approvals.

Implementation milestone: 1 November 2026. This follows the [foundation milestone](97_Visit_Coordination_Foundation_01_November_2026.md); that report describes the earlier schema/domain-only state.

## Implemented now

- Seventh native React page at `/coordination`, reachable from the authorized staff workspace picker. Admin has a Switch workspace link. Host-only users can enter Coordination directly; existing single operational workspace routing is preserved.
- My visits, Assigned to me and Participating lists with search, office/date filters and pagination. Visit links survive reload. Existing content stays visible during refresh; session/access failure clears protected content. Pagehide synchronously clears the DOM before a back/forward-cache snapshot; a persisted restore rechecks current identity and scope, and obsolete requests cannot restore the old content.
- Future single-guest drafts, optional company/email, office/sub-project selection restricted to explicit host authority, visit window, stay request and leadership/VIP flag. Submission, reasoned revision/rescheduling and cancellation persist transactionally.
- Independent office and sub-project approval steps, ALL/ANY behavior, internal client confirmation/reference, separate arrangement owners and mandatory-readiness requirements. Hosts cannot independently approve their own invitation or confirm a facility booking merely because they created it.
- General/project/private-authority/arrangement threads, replies, scoped mentions and resolve/reopen. A selected thread loads 50 messages at a time through a thread-bound keyset cursor. Text is rendered through React as plain text, never HTML.
- Scoped planning settings: actual sub-project creation/update/activation, explicit host add/remove/restore and versioned office/project policies. Policy editors configure authorities, arrangements, reception/security participants, ordinary FYI and VIP FYI. Changes require a reason and are audited.
- Four execute-only API procedures and seven protected HTTP actions. Session/CSRF, live directory status, existing administrative capability, current host/assignee policy and row visibility are checked in SQL. Scope is filtered before list pagination and detail serialization; browser controls are not the authorization boundary.
- Actor-bound retry keys and expected revisions. A lost create response can be retried without creating another invitation. Policy/assignment changes block stale readiness; rescheduling resets current approvals/tasks/threads while preserving historical database records.

## Local setup and use

Migrations **122–127** were applied, in order, to the local `GatePass_DesignTest` database after isolated validation. All **121 previously published migration hashes are unchanged**. There were no schema/data changes to the separate NHS checkout/database. No retained invitation policies, sub-projects or host assignments were silently seeded.

1. Open the local staff portal and sign in with an existing scoped administrator. Choose Switch workspace, then Visit Coordination. A direct unsigned request to `/coordination` returns to sign-in with a fixed Coordination destination.
2. In Planning settings, create the actual sub-projects under the correct account-office. Existing account/client entities keep their meaning; these are their children.
3. Configure the office baseline policy: at least one independent internal approval, optional arrangements/owners, participants, normal/VIP FYI and date limits. Add an appropriate STAY arrangement if stay is offered.
4. Configure each selected sub-project's internal approval policy. Use CLIENT_CONFIRMATION when an internal responsible person must arrange client permission and supply its reference.
5. Add explicit approved sub-project hosts. They must also be currently eligible approved account-office hosts. For location-only visits, manage the separate office host list and office policy.
6. Authorized hosts sign in through the common staff entry and choose Visit Coordination. Draft → Submit creates assigned work. Approvers and arrangement owners use their scoped lists; people see only the threads and details their responsibility permits.

Corporate Entra SSO is still pending. Local employee sign-in remains the existing explicitly development-only adapter. An ordinary employee is not automatically an invitation host. Existing administrative scope/capability governs settings; a role name in a request cannot choose authority.

The planning module adds no new runtime secrets or `.env` keys. The actual private `.env`, media, signing keys and Outlook token cache were not modified. The existing local launcher refreshes its synthetic directory as before.

## API and SQL contract

All actions are authenticated JSON POSTs under `/api/coordination/`:

| Action | Responsibility |
|---|---|
| options | Authorized office/account/project choices; manager-only policies, host roster and bounded internal-contact search |
| list | Scoped MY / ASSIGNED / PARTICIPATING list; at most 50 records per page |
| detail | Current visible process, projects, decisions, tasks, thread metadata and activity |
| thread | Selected authorized thread, at most 50 messages and bounded mention choices; cursor must belong to that thread |
| create | Validated draft + stable client key; returns plan ID and revision |
| change | Exact plan, expected revision, client key and validated command |
| manage | Scoped PROJECT / HOST / POLICY payload, current revision, reason and client key |

SQL procedures: `gp.ReadVisitCoordination`, `gp.ManageVisitPlanning`, `gp.CreatePlannedVisit`, `gp.ChangePlannedVisit`. Only these four new procedures are added to the API allowlist/grants. Private helpers and all planning tables remain inaccessible directly to the API role. Production composition binds the service actions; the complete production UI/identity host is still an existing deployment prerequisite.

The database transaction serializes one plan's changes; management holds the authorization lock. Records include immutable versioned assignments/decisions/messages, current statuses, event sequence, operation receipt and notice intents. A changed policy requires a revised/resubmitted plan; an old approval cannot silently clear a new requirement.

FYI is notification intent only. It creates no workspace membership, blocking approval, private discussion access or entry grant. Facilities receive their assigned arrangement details, not unrelated project/purpose/email fields. Private authority discussion is not automatically visible to the host.

## Verification

- Full unit/contract CI: **683 total, 682 passed, one platform skip, zero failures**. Included-source coverage: **97.83% lines, 90.87% branches, 94.55% functions**. These numbers do not measure the React UI or SQL engine; separate acceptance checks cover those boundaries.
- Typecheck, ESLint, seven production React bundles and **127 sequential migration hashes** passed.
- Fresh disposable SQL: every migration parsed/applied; **33 schema/permission checks** and **35 execute-only persistence/scope/replay/workflow checks** passed. Invalid optional filters are rejected rather than silently broadening a query.
- Dedicated real-SQL browser suite: **8 passed**. Covers phone/laptop invite submission, private projections/decisions, facilities updates, XSS plaintext, accessibility, real policy save/host add-remove-restore controls, thread history pagination, ambiguous-response retry and page lifecycle with a changed identity.
- Existing browser regression suite: **358 passed, one explicitly opt-in retained-presentation test skipped, zero failures**. Includes real SQL workflows on the local development database; owned fixtures are cleaned by those tests. Corporate identity/MFA, physical devices, actual planning mail and independent penetration testing are not represented by these tests.
- Retained local smoke: actual common staff login → Admin → workspace picker → Coordination → authorized settings passed; no planning configuration/data was created or changed by that smoke.
- Production dependency audit reported zero vulnerabilities. Redacted Gitleaks scans found no credentials in `src`, `tools`, migrations or docs. A test-directory scan flagged the existing static unknown `keyVersion` fixture at `tests/registration.test.ts:42`; it was reviewed as a non-credential test value, and that unrelated test file was not modified. This is not a claim that every private runtime file was scanned.

Repeat isolated planning acceptance with `npm run test:coordination`. It requires local Windows SQL, PowerShell 7, the approved ScriptDom parser and pinned Chromium. Every invocation creates a unique marked database, impersonates the API role, uses synthetic identities/cookies, and removes only its owned database. It refuses to overwrite an existing fixture pointer. It does not exercise real corporate sign-in or contact Outlook. Cleanup uses the database ownership marker and exact generated name.

The Azure integration job runs this suite only when its existing **runIntegration** parameter is enabled; the normal Quality job remains the unit/type/lint/build/migration gate. CI uses only its strictly constrained private LocalDB override. No new paid service or always-on job was added.

Ignored evidence: `tmp/coordination-unit-final.log`, `tmp/coordination-acceptance-final.log`, `tmp/coordination-existing-browser.log`, `tmp/coordination-local-smoke.log`, `output/test-results/coordination-browser.xml` and synthetic phone/laptop screenshots under `output/`.

## Still pending — do not treat readiness as gate permission

1. **Planning mail dispatcher:** approval, facilities, VIP/FYI, mention and update intents are persisted, but the existing Graph worker does not send them. Dispatch needs current audience/relevance checks, scoped content, retry/lease outcomes and deployed authenticated deep links. Real company delivery requires the organization's existing mailbox/Graph/SSO configuration.
2. **Invitation-to-registration binding:** signed invitation, visitor completion/photo, current registration/pass issue, expiry/revocation and cancellation handling are not implemented for these plans.
3. **Sub-project gate cutover:** exact sub-project guard/reception duties, pass grants and movement enforcement are not switched over. Current account-wide legacy pass behavior remains. Walk-ins must gain the same required policy enforcement before this is advertised as protection of a restricted sub-project.
4. **Production acceptance:** actual Entra/directory freshness/lifecycle, corporate mail, deployment/web composition, device/printer operations, recovery/retention and independent security review remain required.
5. **Historical-version viewer:** prior decisions/tasks/threads remain in versioned SQL history; the current UI shows current-version details and bounded activity, not a browser for all previous private thread versions.

This milestone changes local code/schema/UI. It does not claim production readiness, real notification delivery or completed sub-project access enforcement. Nothing was committed or pushed as part of this milestone.

## Subsequent requested local host grants

On the user's explicit request, existing currently eligible account hosts EMP001, EMP002 and EMP004 (`employee1@example.com`, `employee2@example.com`, `employee4@example.com`) received Noida-only location-planning host permission through the authenticated `ManageVisitPlanning` API. All three changes have their acting admin, reason and revision in the security audit. Each actual local employee login was checked for the Coordination workspace and Noida host option; foreign-office options remained empty. No administrative roles, account host lists, sub-project authority or approval policies were changed. At this follow-up the retained catalogue still has zero sub-projects and zero planning policies: submitting invitations requires the actual office/project approval configuration first. The grants enable the workspace/host role; they do not bypass that configuration or gate approval.

## Subsequent requested local demo policy/account configuration

The user then requested approval-policy setup and numbered accounts. Only the six existing `DEMO-PRJ-001` through `DEMO-PRJ-006` directory fixtures were renamed to **Accounts 1** through **Accounts 6**, preserving their stable IDs/codes, account-office links, memberships, host lists and guard allocations. The fixture source was updated and passed through the normal validated development directory seed so names survive refresh/restart. Other existing/custom/synthetic accounts were not renamed.

Three Noida sub-projects were added through authenticated scoped administration, each named `Project 1` under its own account. The invitation choices and planning settings scope labels now include the parent account (and settings office), avoiding ambiguity when projects under different accounts have the same name.

| Account / Noida sub-project | Existing approved invitation host | Internal project approver |
|---|---|---|
| Accounts 1 / Project 1 | employee1@example.com | employee19@example.com |
| Accounts 2 / Project 1 | employee2@example.com | employee24@example.com |
| Accounts 3 / Project 1 | employee4@example.com | employee20@example.com |

The Noida office review uses ANY of employee19@example.com and employee20@example.com; a project review remains a separate required decision by the corresponding existing internal account lead. No self-approval was introduced. Employee21@example.com, which already has the local Noida reception grant, is the reception participant and owner of the optional `Stay coordination (Noida reception)` arrangement. This is coordination, not a real accommodation booking. Demo date limits are 90 days advance and 30 days duration, matching the editor defaults. VIP/ordinary FYI lists remain empty until actual recipients are supplied; no organizational head/CTO identity was invented.

These are explicit **local demo defaults**, not an assertion that the organization approved a production security/facilities policy. The existing local external admin accounts can manage configuration but cannot act as the required internal approvers. All new policy/project/host changes carry the acting admin, scope and reason in the security audit.

Live local HTTP/SQL rehearsal passed for all three hosts: own sub-project selection, submit, independent office + project decisions and READY planning status. The employee1 rehearsal also confirmed the stay task through the assigned reception actor. A foreign-account create attempt was rejected for each host. All three synthetic verification visits were cancelled with an explicit completion reason; no real visitor, gate movement, booking or email dispatch occurred. Evidence is in ignored `tmp/noida-planning-demo-result.json`; naming/directory contract tests passed 45/45 in `tmp/demo-account-names-tests.log`.

## Coordination UI redesign — 1 November 2026

The workspace was redesigned around a compact visitor/schedule summary, account-qualified destinations, numbered approval steps and progress, separate closed/draft notices, readable state badges, SVG controls, and scoped host/access information beside the desktop process view. Phone layout stacks the same content with accessible compact navigation. The visits list, discussion, arrangements, history, settings surfaces and invitation dialog use the same visual system. Existing scope projection and command APIs were retained.

Visual verification uses synthetic desktop/phone screenshots under ignored `output/coordination-approvals-*`, `output/coordination-redesign-closed-*`, `output/coordination-redesign-list-*` and `output/coordination-redesign-form-*`. Accessibility checks include contrast and page overflow, and cancelled views expose no edit/submit actions.

Testing also reproduced a late-evening form defect: arrival could default to the following office date while stay check-out still defaulted to that same date. Check-out now defaults to the day after check-in; default stay dates follow an edited arrival, an invalidated departure moves forward, and the native checkout minimum is exclusive. A dedicated late-evening/future-arrival browser regression exercises successful draft persistence. This is a frontend form correction; backend authorization and date limits are unchanged.

Redesign verification: **11/11 isolated real-SQL browser tests passed**, including phone/laptop list, detail, cancelled state and modal screenshots; contrast, overflow, compact heading/progress layout, preserved permissions/actions, retry, private discussions and lifecycle privacy; and the new late-evening stay/date regression. The harness again passed 33 schema checks and 35 persistence checks and removed its owned database. Typecheck, ESLint and seven production React bundles passed. The updated local runner was restarted; employee1/2/4 each signed in and saw only their respective Accounts 1/2/3 project choice. No retained policies/roles or original visit records were changed by the redesign. The earlier full unit/browser suite counts above are earlier milestone evidence, not a claim that those full suites were rerun for this visual change. No commit or push was performed.
