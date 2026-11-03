> Documentation status: historical implementation/design/evidence record, indexed 3 November 2026. Read the [current handbook](system/README.md) and [Visit owner/Host glossary](109_Visit_Owner_and_Host_Terminology_03_November_2026.md) for current behavior. Counts, setup examples and screenshots below describe their dated stage, not a fresh certification.

# Invitations and Visit Coordination — foundation

> Scope clarified on 2 November 2026: [host/facilities coordination only](101_Coordination_Only_Scope_02_November_2026.md). Existing QR card allocation, reception and guard workflows remain. The reception-linking/separate-gate extension in report 100 was withdrawn; its results below are historical.

> Hosting/destination rule update: [location-sponsored cross-account invitations](99_Location_Sponsored_Cross_Account_Invitations_01_November_2026.md) supersedes the original destination-host restriction and its historical one-account test expectations below. An approved source-office host can request other accounts/projects at that office; every destination still needs its assigned independent approvals.

Agreed feature scope and first implementation milestone, 1 November 2026.

## What is implemented at this milestone

- Separate sub-project catalogue under the existing account-office entity. Existing `Projects`/`ProjectLocations` still mean Account/Client and Account-office; they are not renamed or repurposed again.
- Explicit sub-project host lists, with existing eligible account-host authority also required. Location-only invitations have their own explicit location-host authority.
- Additive migrations 122–123: 19 tables for the catalogue, policies, versioned plans, selected projects, approvals, arrangements, participants, threads/replies/mentions, audit, operation receipts and notice intents.
- Pure TypeScript policy and workflow implementation in `src/planning`. It validates trusted directory/policy inputs separately from bounded client draft/command inputs, and returns a new aggregate without mutating the previous version.
- Role/scope-based read projection, not just hidden buttons. FYI recipients do not become participants. A project authority does not receive another project's private discussions or approval decisions. Facilities receive their assigned arrangements rather than visitor email, purpose and unrelated account/project details.
- Optimistic revision checks, actor-bound idempotency, immutable decision/message history, explicit task corrections and versioned rescheduling. Live identity/assignment checks also apply to retries.

**This is not yet a usable invitation screen or an enabled production workflow.** The schema has been exercised on a disposable database only. No new execute-only persistence procedures, HTTP endpoints, React page, invite credential, worker dispatch or movement authorization have been activated. Existing registration, account passes and guard behavior are unchanged.

## Business and permission contract

| Actor | Allowed responsibility | Does not gain |
|---|---|---|
| Approved internal host | Create, submit, revise/cancel own plans; request/coordinate arrangements; participate in accessible threads | Independent approval of own invitation; confirmation of somebody else's facility booking |
| Assigned internal authority | Decide the assigned office/project approval; participate in its restricted review | Authority over another project or arbitrary host-selected approvers |
| Internal client coordinator | Arrange client-side permission and record its reference | External client sign-in or approval link |
| Assigned facilities owner | Update its arrangement status and discuss it | Security/project approval or unrestricted visitor records |
| Configured reception/security | Relevant office visit coordination | Implicit authority to approve every project |
| Account administrator | Visibility for selected projects inside its account-office scope | Other selected accounts or another office |
| Location administrator | Visibility inside the location scope | Cross-location access |
| VIP/leadership FYI recipient | Notice intent for the visit and material updates | A blocking approval step, discussion access or entry authority |

Administrative scope in the trusted context represents a verified management capability, not a caller-supplied role name. Policy management must use current scoped authorization when its SQL/API adapter is implemented. Participants must currently be active internal identities; external-client approval is explicitly excluded. Contacts must resolve through a trusted internal directory, never an arbitrary public email list supplied by the host.

## Reference workflows

| Scenario | Required planning behavior |
|---|---|
| One sub-project | Office baseline plus explicit sub-project approval |
| Multiple projects | Office baseline shared; project A may be ready while B remains pending/rejected |
| Location-only | Explicit location host and location approval; no restricted project access |
| Stay | Provisional arrangement request on submission; confirmation is separate from approval |
| Mandatory stay/arrangement | Blocks readiness until assigned owner confirms; unavailable/removed ownership blocks it |
| VIP | Configured normal and VIP FYI recipients are deduplicated; no security bypass |
| Client permission | Internal responsible authority records the client reference before approving |

Policy rules are additive: project approval cannot remove an office security requirement. A missing/ambiguous policy, external/inactive authority, impossible self-only approval, foreign-office project or missing stay owner fails closed. Invitation planning dates may be in the future within configured bounds. This does not change today's walk-in start-date rule. Hotel check-out is exclusive and uses the office calendar; visit timestamps are canonical UTC with an exclusive end.

For `ALL`, all assigned authorities must approve; any recorded rejection ends that step. For `ANY`, the first serialized assigned decision closes the step, whether approval or rejection; another authority cannot overwrite it afterward. A host's request records host consent and is not an independent authority decision. If a host is one of several ANY authorities, another eligible authority must decide. Client confirmation approval requires a non-empty internal reference.

## Process, tasks and discussion

- Plan lifecycle: draft → submitted → cancelled, with rescheduling/revision creating a fresh draft version and requiring resubmission. Previous decisions, tasks, threads and messages remain in version history.
- Approval readiness is evaluated independently for each selected project. It is not a pass, arrival window, visitor registration or guard movement grant.
- Task lifecycle: requested → in progress/confirmed/unavailable. An assigned owner can correct a result with a required remark; both transitions remain in audit events. Host/admin scope alone does not allow booking confirmation.
- Threads are general, project-scoped, private approval, or arrangement-specific. Restricted threads are not exposed merely because somebody can open the overall visit.
- Replies must reference a message in the same thread. Mentions can notify only currently authorized thread readers and cannot add a participant. Resolving/reopening a thread does not approve a visit or complete a task.
- Messages and decisions are append-only in the domain contract. Mutable task/thread status changes retain the actor and event history. Cancellation and revision retain the required reason. Rescheduling does not carry prior approval forward.
- Current policy/assignment revisions and host eligibility are rechecked. A policy revision invalidates the existing planning snapshot until revision/resubmission; removal of an authority also removes that actor's private-thread visibility.
- Notification records here are intents, not email delivery. Submit creates approval/arrangement/FYI intents; mentions create discussion intents; decisions/task results inform the host; revisions/cancellation update prior involved parties. The future dispatch adapter must recheck relevance and audience before rendering/sending.

The first domain implementation bounds a plan to 10 projects, 50 approval steps, 20 arrangements, 100 threads, 500 messages per version and 20 historical revisions. Messages are bounded plain text; no HTML rendering or attachment support is introduced. General-purpose workflow builders, unrestricted chats, hotel booking/payment integrations and external client identities are outside the agreed first version.

## Persistence and release boundary

The new tables have constraints for account/office/project binding, plan-version binding, assigned decision makers, required client references, one current version, cross-thread replies and logical notice uniqueness. Existing runtime roles have no direct table access. DDL constraints are not a substitute for business authorization: inactive identities, policy validity, visibility, current host eligibility, ANY/ALL behavior and command transitions must be rechecked by the future execute-only persistence procedures.

The persistence adapter must lock/CAS one plan, check the authenticated actor/current scope and operation key, then atomically commit version data, decision/task/message changes, event, receipt and notice intents. It must not persist caller-supplied aggregate state or return raw aggregate/history JSON. Read authorization must filter rows before pagination/serialization; `readVisitPlan` is the domain projection contract, not permission to fetch every visit from SQL.

Only a later, separately verified registration/movement integration can bind a planned visitor to an actual registration/pass. It must require the current approved project, active visit window, completed registration/photo, current host/policy eligibility and existing entry checks. It must also apply required project policies to walk-ins so that normal registration cannot bypass planning approvals. Old account-wide passes must not automatically become grants for all newly created sub-projects. Until that cutover is implemented and accepted, existing pass workflows remain legacy behavior.

## Verification

- 19 focused planning tests cover explicit hosts/office boundaries, configuration failure, independent approval, ALL/ANY, client references, task ownership/mandatory gates, VIP privacy, private threads, mentions/replies, revision/replay, cancellation and live revocation.
- Full unit/contract CI: **677 total, 676 passed, one platform skip, zero failures**. Included-source coverage: **97.68% lines, 90.85% branches, 94.64% functions**. New planning sources have 100% measured line coverage; this is not a claim of exhaustive correctness.
- Typecheck and ESLint pass; 123 migration hashes verified. Previously recorded migration hashes 001–121 are unchanged.
- `database/tests/Test-VisitPlanningFoundation.ps1` parsed and applied all 123 migrations on its own newly created, marked local database and passed **33 schema/permission checks**. Checks include cross-office project links, wrong decision assignee, missing client reference, duplicate current versions, cross-plan task links, cross-thread replies, invalid FYI membership and denial of SELECT to the existing API role on every new table. All foreign keys remained enabled/trusted. The owned database was removed afterward.
- Retained GatePass/NHS databases, private media and Outlook connection were not opened or modified. No real mail, production configuration, commit or push is part of this milestone. Browser tests were not rerun because no UI/runtime route changed.

Ignored evidence: `tmp/planning-foundation-unit.log` and `tmp/planning-sql-foundation.log`.

## Next implementation sequence

1. Scoped SQL management/read/command procedures and trusted context loader; transaction, replay, privacy and current-authority integration tests.
2. Protected HTTP routes and invitation lookup/issuance contracts. Corporate SSO/session composition remains a production prerequisite.
3. Native React Visit Coordination page: My visits, assigned approvals/tasks, participating visits, filters, details, process, threads and activity; scoped administration for projects/policies/contacts.
4. Graph notification adapter, signed invitation → individual visitor registration, expiry/revoke and cancellation handling.
5. Exact sub-project guard/reception duties and movement gates, walk-in policy parity, legacy migration strategy and complete device/browser/SQL acceptance.
