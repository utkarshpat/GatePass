# 01. Product and workflows

> Maintained source handbook — **4 November 2026 · migrations 001–136**. [Current status and evidence](11_Readiness_Gaps_and_Roadmap.md) · [Terminology](../109_Visit_Owner_and_Host_Terminology_03_November_2026.md). Source review is not production acceptance.

## Application surfaces

GatePass serves Self-service, Reception, Guard, Admin and the additive Visit coordination workspace. These are business surfaces, not a count of routes or React bundles. Seven primary page bundles include staff entry and email detail. The ordinary employee/pass/Host-review flows do not require a separate employee dashboard or Host inbox.

Offices are Noida, Bengaluru, Chennai and Pune. Public `/office/<code>` entry binds office context on the server. An office QR is not proof of an employee's entitlement.

## Ordinary requests

| Request | Flow | Decision and scope |
|---|---|---|
| Temporary employee Digital ID | Employee signs in, reason, camera photo, review, current card | Auto-approved only when currently eligible; same office day, explicit entitlement and reuse checks |
| Employee account access | Authenticated employee chooses an account-office, eligible Host and purpose | Independent Host approval for that exact pair; same-day request |
| External visitor | One person's details, Valid until, office Host lookup, purpose, camera photo, review | Independent approval; starts today through the inclusive selected final day |

Company and device **types** are optional. No gallery upload, device make/model, ID-proof collection or signature requirement is implemented. Contractor/support-staff purposes are supported. Every visitor registers separately; grouped submissions and public account filters are rejected.

Public Host lookup searches the QR office by name/email without returning account/project assignments. SQL privately resolves an eligible route; its deterministic routing is not a public account selector. Employee account requests retain their authenticated selector.

Submission can show/download an intake-authorized visitor card without email. A pending card stays pending. After the intake expires, applicable signed email links or authorized reception lookup are the retrieval paths; a visible reference number is never authorization.

Calendar-day pass labels show **23:59 on the final included date**. Authorization still uses the stored exclusive next-midnight boundary. Current queues retain still-valid multi-day visitors. A Noida employee does not gain Bengaluru access merely because the same account exists there.

## Operational handling

Reception performs scoped lookup, manual individual intake, card viewing/printing and final-return/correction. A return requires the holder to be outside every relevant account and declared devices to be confirmed. Return/correction retain both audit records. Guard verification is separate from explicit account entry/exit. Common-area verification creates no account movement or building-occupancy guarantee.

Ordinary Host approval/status links use the existing minimal authenticated/capability pages. GET and mail scanning do not approve. Temporary ID manager notices are informational. These flows are unchanged by coordination.

## Pre-planning and coordination

1. An eligible internal person creates an invitation and becomes its **Visit owner**. Existing approved-host eligibility controls who may initiate it.
2. Choose one visitor, an eligible source office, dates, purpose and zero or more configured destination projects at that office. No projects means a location-only plan.
3. Review each destination's Hosts/approval routing and people to notify. Add authorized internal approval/notification recipients or select visible admin-managed groups.
4. Record preparation, optional services/stay, coordinator, additional FYI contact and alternate receiver. The additional contact cannot become the Visit owner.
5. Review and save a draft. Explicit submission starts configured approvals, tasks and scoped notifications. A draft sends no invitation email.
6. Hosts decide their assigned destination approvals; facilities/task owners coordinate support. Authorized participants use scoped threads, remarks/replies/mentions and activity. Revision/rescheduling can require fresh approval.

An approved source-office host may request other accounts/projects at that office without destination membership. Each project and office baseline still applies independently. Location/VIP notifications and selected groups add recipients/reviews; they do not replace mandatory rules.

Planning readiness is not a credential. QR allocation, ordinary registration, reception, guard checks, entry/exit and returns keep their current flow. The separate manual-link/planned-gate extension from report 100 was withdrawn. Automatic data transfer into the existing registration flow is not implemented and is not a new entry-control requirement.
