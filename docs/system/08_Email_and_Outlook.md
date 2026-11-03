# 08. Email, Graph and Outlook

> Maintained source handbook — **3 November 2026 · migrations 001–136**. [Current status and evidence](11_Readiness_Gaps_and_Roadmap.md) · [Terminology](../109_Visit_Owner_and_Host_Terminology_03_November_2026.md). Source review is not production acceptance.

## Ordinary registration mail

New individual requests with an address queue receipts; external/account requests independently notify the assigned Host. Temporary IDs auto-approve and issue informational manager notices. Decisions queue individual results. Same-key replay/reuse must not duplicate business receipts.

Ordinary Host links open minimal authenticated detail and require explicit POST decision bound to current Host, account-office, snapshot and deadline. Internal holder links require authentication; external holder links use expiring individual capability/session authorization. Reference numbers alone are insufficient. GET/link scanners never approve.

## Planning mail — implemented

Migration 132 introduces the independent planning queue. Drafts do not notify. Submission, relevant updates/cancellation and permitted mentions generate scoped notifications; old history is not backfilled. Preparation/extra people and selected groups extend recipient routing through migrations 133–136.

Internal assigned reviewers, facilities/task owners, permitted discussion members and ordinary/VIP FYI contacts receive reduced projections. Raw group email/distribution-list recipients are notification-only, with no login, decision link or project details. Current group/role/directory changes are rechecked before dispatch.

Planning emails identify the invitation creator as **Visit owner**. Destination approval is a Host responsibility. The legacy `hostName` wire field still supplies the creator name; ordinary visitor emails' Host remains the actual selected Host. Additional contact/alternate recipients do not acquire ownership or approval authority.

The combined worker drains registration/planning queues independently, using bounded claims, lease renewal, relevance checks, transport and fenced completion. It does not keep a database transaction open during provider delivery. A provider acceptance followed by lost SQL acknowledgement can duplicate delivery, although business decisions remain idempotent. Planning retries are bounded; operators investigate controlled error codes rather than blindly resetting/draining queues.

## Provider and acceptance

Graph transport/application-mode configuration is implemented. Production needs an approved no-reply mailbox, restricted app sending authorization, tenant/client credentials and complete directory/key/origin configuration. HTTP 202/SENT means provider acceptance, not inbox delivery.

Personal Outlook-to-personal-mail delivery was previously confirmed in development. Company delivery was not confirmed and was deferred to organization setup. The latest planning tests use a mock Graph provider and send no network email. Organizational delivery, policy, Outlook-client and externally reachable link acceptance remain pending.

The private personal delegated cache is a development bridge; production uses approved organization application authentication. Never publish caches, secrets, real capability URLs or authenticated mail artifacts.

## Native Outlook actions — separate opt-in

The implemented action handler validates organizational Entra v2 bearer identity and a separate signed action capability bound to request/Host/snapshot/decision/retry. Personal, app-only, Graph-audience, ID or unsupported legacy tokens do not authorize it. Forwarding an email does not transfer authority. The ordinary authenticated detail page remains the fallback.

Before enabling: complete public HTTPS/composition, organization sender/Graph approval, Entra API/scope and Actionable Messages onboarding, trusted tenant/object mappings, isolated Outlook SQL identity and durable action keys. Accept real clients/tokens/repeated/opposite actions and delivery. Keep `GATEPASS_OUTLOOK_ACTIONS_ENABLED` off until this is done. Signed-card organization requirements need a separately accepted adapter if required. See [the detailed implementation contract](../36_Outlook_Direct_Approvals.md).

## Commands and operation

`mail:preview` produces local ordinary preview. `mail:planning -- <selected-plan-uuid>` previews only a selected plan into protected files. Its test send option requires an explicitly authorized recipient/action and does not drain ordinary/global mail. Do not run connect/test/scenario/send commands as part of documentation verification. See [planning command contract](../102_Coordination_Email_Notifications_02_November_2026.md) and [configuration](../86_Runtime_Environment_Configuration.md).

Emails do not allocate a pass, authorize entry or replace current SQL decisions. Reception/Guard reminders apply to their existing ordinary request flow; planning has its own notices and discussions.
