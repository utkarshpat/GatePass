> Documentation status: historical implementation/design/evidence record, indexed 3 November 2026. Read the [current handbook](system/README.md) and [Visit owner/Host glossary](109_Visit_Owner_and_Host_Terminology_03_November_2026.md) for current behavior. Counts, setup examples and screenshots below describe their dated stage, not a fresh certification.

# Visit approval and notification groups

Updated 2 November 2026. This is a coordination feature, separate from **Account groups**, which continue to serve account/guard assignment operations.

## Where to use it

Administrators can open **Accounts & areas → Visit groups**, or **Visit coordination → Planning settings → Visit groups**. The shortcut carries the selected office. The group manager provides **Create visit group**, edit, active/disabled status, office/sub-project scope, search, group name/description, a VIP-only flag and a mandatory change reason.

Location-authorized administrators manage office groups. Account administrators manage groups only under sub-projects within their own authorized scope. Hosts cannot create, amend or disable groups. SQL checks current authority independently of which controls the browser displays.

Each group supports internal employees selected by name/email, with either **Required approval** or **Notify only**. Administrators may also add an explicit email address or distribution-list address for **Notify only**. An email address does not create a user, login, approval capability or workspace access. Directory employees should be selected from the directory rather than entered again as a raw email address.

Groups are not limited to VIP visits. Examples include leadership briefings, client visits, facilities coordination and recruitment visits. Marking a group **VIP visits only** makes it available when the host selects Leadership/VIP. The host explicitly ticks the desired groups; the flag does not silently select or send them.

## Host experience and workflow

The invitation shows the relevant active office groups and groups belonging to selected destination sub-projects. Every visible group lists names/email addresses under separate **Approval required (all)** and **Notify only** columns. A host may select up to five groups, each with up to twenty members. Extra manually selected people and mandatory office/destination reviews remain available.

Saving a draft queues no mail. Submission adds internal group approval steps alongside existing mandatory reviews and queues FYI notifications. The same internal approver in multiple selected groups at the same scope has one group review; the original policy review is still independent. Duplicate FYI email destinations are deduplicated within the event.

Group decisions require an authenticated, current internal employee. A host cannot obtain self-approval through a group. Notify-only recipients receive minimal visitor, office, host and time information, with no review link, project list, private discussion, visitor email or private itinerary. Notifications use the existing claimed/leased mail worker and Graph transport. Cancellation and revisions include appropriate existing recipients without treating raw email destinations as identities.

Selections record a group revision and membership snapshot on the invitation version. Editing/disabling a group invalidates affected planning readiness; the host must revise and review the current members. Removed reviewers lose group-derived decision authority. Removed notification addresses are suppressed before queued mail dispatch. New members do not retroactively receive old queued messages. Historical group selections and event activity remain available to authorized readers.

## Storage, authorization and audit

Forward migrations **135–136** add scoped group definitions, version snapshots and group reviewer bindings. Group writes use the existing management RPC, scoped authorization, replay-safe operation keys, expected revisions and a required reason. Audit events record actor, time, scope, group ID/name, revision and member configuration. Runtime users receive no new direct table access.

The existing notification table supports either its original internal-user foreign key or an explicit notification email destination. Email destinations are constrained to FYI/update/cancellation notices. Existing pass issuance, printing, returned badges and guard movement operations remain unchanged.

## Account-card overflow

Account and common-area action buttons wrap within their own card. Grid/card minimum widths and shrink behavior are bounded; long button labels wrap instead of crossing into adjacent cards. This fixes the layout rather than hiding overflowing controls.

## Evidence and limits

- Full unit run: **723 cases, 722 passed, one platform skip**; coverage gates passed.
- Isolated SQL suite: **174 checks**, including 29 new group authorization, replay, member visibility, approval, privacy, revision, email and audit checks.
- Fourteen existing coordination browser cases passed, followed by two new phone/laptop group creation, host selection and submission cases. Accessibility and horizontal-fit checks are included.
- An explicit group notification email passed through the real SQL/worker/Graph adapter using a mock HTTP provider, once only and without a review link. No real email was sent in these tests.
- Typecheck, lint, architecture, frontend build and 136 migration hashes passed.

The catalogue is bounded to 200 groups per query; administrators can search by group name. No budget approval, travel booking, mailbox delivery guarantee, external approval identity or automatic client authorization is implied by selecting a group.

Local acceptance: migrations 135–136 applied after isolated validation; localhost restarted on port 8443. The Admin shortcut, office context, group form and employee search passed a read-only smoke check. Account-action geometry passed at 390, 1024, 1366 and 1920 pixels; screenshots were inspected. Secret scan reported no leaks. No actual group or invitation was saved by the localhost smoke check and no real mail was sent. Changes are local, with no commit or push.
