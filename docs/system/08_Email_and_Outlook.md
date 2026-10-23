# 08. Email, Graph and Outlook

> Current local changes and presentation evidence (23 October 2026): [retained browser rehearsal](../55_Presentation_Rehearsal_23_October_2026.md). Source migrations are 001–085. The original 22 October export and snapshot remain historical.

Current request/approval details and notification rendering include optional visitor company and declared device types. Host Approve/Reject stays disabled while sign-in details/photo loading is still in progress, preventing an ignored early click. The retained rehearsal verifies real host decisions in the browser; queued notifications do not establish mailbox delivery. It sends no real messages.

## Notifications
New individual requests with a recipient queue REQUEST_RECEIVED. External/project requests separately notify the assigned host. Temporary IDs auto-approve and queue informational TEMP_ID_MANAGER_NOTICE. Decisions independently queue results. Reused IDs/same-key replay must not duplicate receipt records.

Worker uses dedicated SQL identity, bounded claims and lease/fence ownership. It resolves current directory contacts, obtains authorized content, rechecks relevance near dispatch, sends outside the transaction and acknowledges. Missing manager contact may retry without undoing issuance. Guard authorization reads SQL, not email delivery status.

## Delivery and test status
Graph calls fixed Microsoft HTTPS endpoints with explicit sender and saved sent items. Application mode uses the approved mailbox; personal testing uses the delegated signed-in mailbox. HTTP 202 means provider acceptance, not inbox delivery. A crash before SQL acknowledgement may duplicate mail while business decisions remain idempotent.

Personal Outlook-to-personal-mail delivery was confirmed during development. Company delivery was not confirmed and was deferred until organization sender setup. An empty user-visible quarantine view is not proof of acceptance. Do not claim company mail acceptance or repeatedly resend without diagnostics.

Live addresses, tenant-specific credentials, secrets and personal token caches are excluded. Personal connector is a testing bridge, not final organization sender/identity architecture.

## Ordinary review links
Normal Approve/Reject/View links open minimal authenticated request detail. Assigned host confirms explicitly; GET/link scanners never decide. SQL checks identity, exact host/project-office, freshness, snapshot, pending state and deadline. Internal status requires ownership. External receipt uses an individually signed expiring fragment capability; public reference is not an access token.

## Native Outlook actions
Optional Action.Http Approve/Reject has View details fallback. The endpoint validates organizational Entra v2 token and separate capability: configured issuer/audience/tenant, object ID, delegated scope, permitted Actions client, signature and time bounds. Personal, app-only, Graph-audience, ID and unsupported legacy tokens do not authorize it.

Capability binds individual request/host/snapshot/decision/idempotency. Trusted maintained tenant/object mappings identify the actual host. Forwarding does not transfer authority. A client-supplied email is not a trusted identity binding.

## Activation sequence
1. Approve public HTTPS origin and complete production composition.
2. Provision organization sender and approved Graph permissions/authentication.
3. Register organizational Entra API/scope and Actionable Messages provider; complete consent/sender verification.
4. Populate trusted current employee tenant/object mappings.
5. Provision isolated Outlook SQL identity and durable protected action keys for API/worker.
6. Accept compatible clients, actual tokens, delivery, scope denial, repeated/opposite actions and fallback.
7. Only then enable GATEPASS_OUTLOOK_ACTIONS_ENABLED.

Implementation expects Entra v2 authentication and embedded unsigned Adaptive Card on the approved sender-verification route. If organizational policy requires signed cards, add/accept the certificate-signing adapter before activation. Local preview/Gmail delivery is not native Outlook approval acceptance. Document 36 contains the detailed contract.

Sources: docs/35_Email_Driven_Request_Workflow.md; docs/36_Outlook_Direct_Approvals.md; src/email; migrations 061-062.
