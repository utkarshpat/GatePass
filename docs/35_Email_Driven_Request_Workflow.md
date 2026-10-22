# Email-driven requests — GatePass v1

Employee and host identities remain in the authorization model. They do not have separate dashboards, inboxes, profiles or navigation. Office QR self-service remains the place to request a Digital ID or project visit. Same-day Digital ID reuse is preserved by the existing backend.

## Connected flow

- Submission queues one `REQUEST_RECEIVED` receipt per newly issued individual request with an email recipient. Same-key retry/reused Digital ID does not duplicate receipts.
- External/project requests also queue their own assigned-host approval message. A group is still separate individual requests; one person's approval or rejection never decides the others.
- Digital ID is auto-approved. `TEMP_ID_MANAGER_NOTICE` is informational and has no approve/reject links. Missing manager contact is retryable and does not undo issuance.
- Email Approve, Reject and View Request links open the same minimal authenticated request page. A GET, mail previewer or link scanner never records a decision. The assigned host explicitly confirms via authenticated JSON POST. SQL rechecks the host's current exact project/office assignment, immutable snapshot, pending state, deadline and idempotency key.
- Each decision queues its own result notification. Guard screens already read current SQL state; email delivery is not a condition for access authorization.
- Internal holders reopen `/request/{visitId}` through corporate authentication. External recipients get a signed, expiring capability in the URL fragment. Only the signed holder/snapshot can read that individual request and render its current neutral landscape card. There is no public reference-only lookup. The capability is not an approval or project entry permission.
- The request page displays the current PNG and offers download. Rendering reauthorizes after private storage work. Cancelled/revoked/expired credentials cannot be exported as a valid pass; a receipt link may still display the cancellation/denial status until its expiry. Purged data is unavailable.
- Photos for host review remain behind authenticated scoped access. Email contains reference, person, office, project, host, purpose and validity. Corporate branding is a CID PNG attachment supported by the Graph transport.

The approval/status page is a detail/action destination for email, not a workspace. No employee/host dashboard has been added. Standard email links use authenticated confirmation. The optional native Outlook `Action.Http` flow is implemented separately in [Direct Outlook Approvals](36_Outlook_Direct_Approvals.md), with Entra token validation and an isolated SQL decision identity. It remains disabled until organization onboarding and public HTTPS deployment. Real browser SSO/MFA remains the separately planned identity adapter.

## Queue and provider boundaries

`NotificationEmailWorker` uses a dedicated `gp_worker_runtime` identity: bounded claim, fenced content, directory resolution, lease renewal, relevance recheck, provider send, then acknowledgement. Network/HTML work occurs outside SQL transactions. The worker cannot approve, read arbitrary photos/QR material or modify business tables. The API cannot claim notifications; encrypted card material remains render-role only.

Manager/employee addresses come from the approved directory adapter, not request JSON or stale outbox email caches. External addresses are bound to the submitted individual request. An unusable manager contact retries through the existing SQL failure policy.

The Graph transport calls fixed Microsoft HTTPS endpoints, uses an explicit sender mailbox, saves sent items and accepts only HTTP 202 as provider acceptance. Provider bodies, tokens and raw exceptions are not logged. Provider acceptance is not inbox delivery. A crash after provider acceptance and before SQL acknowledgement can produce duplicate email; decisions remain idempotent. The custom notification header is correlation metadata, not an exactly-once guarantee.

## Live configuration — pending from organization

The user selected Microsoft Graph but does not yet have app/mailbox configuration. No real email has been sent or Graph account changes made. Configure these through the deployment environment/secret store, not source control or chat:

| Variable | Meaning |
|---|---|
| `GATEPASS_GRAPH_TENANT_ID` | Approved tenant UUID |
| `GATEPASS_GRAPH_CLIENT_ID` | Approved app registration UUID |
| `GATEPASS_GRAPH_CLIENT_SECRET` | Credential from the secret store; the token-provider interface can be replaced by a certificate/managed identity provider |
| `GATEPASS_MAIL_SENDER` | Approved sending mailbox |
| `GATEPASS_ORIGIN` | HTTPS application origin reachable by email recipients |
| `GATEPASS_DB_SERVER`, `GATEPASS_DB_PORT`, `GATEPASS_DB_NAME` | Application SQL target |
| `GATEPASS_WORKER_DB_USER`, `GATEPASS_WORKER_DB_PASSWORD` | Dedicated execute-only worker login |
| `GATEPASS_MAIL_DIRECTORY_MODULE` | Absolute trusted module path exporting `createMailDirectory()` with `getEmployee(id)` / `getManager(id)`; returns active status and official email |
| `GATEPASS_EMAIL_LINKS_MODULE` | Absolute trusted module path exporting `createEmailLinks()`; API and worker must share the same persistent protected signing-key ring |

The application's composition supports the signed public request endpoints and injection of the isolated external card renderer. The local server wires the full detail/photo/decision/card flow with the existing dummy identity adapter. Production deployment must supply the corresponding protected renderer/media and corporate identity adapters; the mail worker will not fall back to mock directory data or elevated SQL credentials.

Use Microsoft Graph application `Mail.Send` with organization-approved admin consent and sender mailbox restrictions. Never put a client secret into browser code. Keep the worker off until these permissions, origin and adapters are configured. Start one bounded batch with `npm run start:email -- --once`, or omit `--once` for polling. The CLI rejects dummy/mock mode for live sending.

Local signing keys use their own protected directory (`email-link-keys`) under private storage; QR encryption keys are not reused. The local implementation is DPAPI CurrentUser, persists across restart and retains versioned keys. Deployment must use its approved protected key provider. Signing-key retirement invalidates links using that version. Signed external status capabilities expire at most 24 hours after the visit window; they identify the request holder independently of the current printed credential. Cancelling a visit blocks card rendering and project authorization.

## Review and verification

### Personal Outlook connection for testing

The separate Windows sender setup uses MSAL Node's consumer device-code login and delegated `Mail.Send`. It does not replace employee SSO or enable sending the dummy SQL queue. The application permission/client-credentials worker remains the default for company deployment.

In the **test** Entra registration, enable personal Microsoft accounts (token version 2), add **Microsoft Graph → Delegated permissions → Mail.Send**, then set **Authentication → Advanced settings → Allow public client flows → Yes**. No client secret or redirect URI is used by this device-code connector. Sign in at Microsoft's displayed verification URL with the displayed short-lived code; never paste the code, tokens or password into chat. A delegated sender cannot impersonate a company mailbox.

In PowerShell, set the non-secret client ID and exact Microsoft account sign-in email, then connect:

```powershell
$env:GATEPASS_GRAPH_CLIENT_ID = '<application-client-id>'
$env:GATEPASS_MAIL_SENDER = '<personal-outlook-sign-in-email>'
npm.cmd run mail:connect
npm.cmd run mail:status
```

Only after choosing a test recipient, send one synthetic connection test (this does not claim or complete a visit notification):

```powershell
npm.cmd run mail:test -- colleague@example.com
```

`mail:connect` and `mail:status` never send email. A successful test reports Graph acceptance, not confirmed inbox delivery. The test has no approval links or real visitor data. Company spam policies can affect delivery. A real approval link needs an application URL reachable by its recipient; another person's localhost is not this machine.

MSAL silently refreshes credentials until user interaction is required again. Its serialized cache is encrypted with AES-256-GCM, authenticated to the selected app and sender, with a dedicated Windows DPAPI CurrentUser-protected key. Files live outside the checkout at `~/.gatepass/outlook-personal-v1`, under restricted OS ACLs. Wrong/ambiguous signed-in accounts are rejected. No tokens or provider response bodies are printed. `npm.cmd run mail:disconnect` clears the local encrypted cache; Microsoft account consent can also be removed separately.

An explicitly configured worker can select `GATEPASS_MAIL_AUTH_MODE=personal` to use that connection and `/me/sendMail`; its sender must match the connected account. The approved directory, shared email-link key adapter, HTTPS origin and dedicated worker SQL identity are still required. The worker's dummy/mock rejection is preserved. Merely connecting Outlook does not establish those deployment dependencies or start automatic notification delivery.

References: [MSAL device-code flow](https://learn.microsoft.com/en-us/entra/msal/msal-authentication-flows), [MSAL Node token cache](https://learn.microsoft.com/en-us/entra/msal/javascript/node/caching).

### Selected-request local email sandbox

Company delivery is deferred until organization mailbox setup. Personal Outlook-to-Gmail delivery has been confirmed by the user. The development sandbox is an explicit alternative to the production worker's mock-directory prohibition; it never enables automatic global queue delivery.

```powershell
# Creates one synthetic visitor using the real local registration/photo/SQL APIs.
npm.cmd run mail:scenario -- create <test-recipient-email>
# Use the returned visit UUID; every host/visitor/manager recipient is redirected.
npm.cmd run mail:dev -- <visit-uuid> <test-recipient-email>
# Synthetic scenario only: exercises assigned-host login, decision and same-key replay.
npm.cmd run mail:scenario -- approve <visit-uuid> <host-employee-id>
npm.cmd run mail:dev -- <visit-uuid> <test-recipient-email>
# Checks signed external status, actual landscape PNG, tampering and wrong-host denial.
npm.cmd run mail:scenario -- verify <visit-uuid> <host-employee-id>
```

`mail:dev` refuses production, claims only the explicit visit in the local synthetic database, and sends through the existing fenced worker/relevance/acknowledgement pipeline. It does not call `ClaimNotifications` or drain older unrelated jobs. The helper's Windows integrated SQL identity is development-only, guarded by the synthetic database marker; production keeps its dedicated execute-only worker identity. Test sends retain their original template content, use a `[GatePass TEST]` subject prefix and redirect **every** recipient to the explicit test mailbox. Source employee emails and authorization assignments are not changed. `SENT` in this synthetic database means provider acceptance to the redirected test recipient, not delivery to the original directory address. Existing acknowledgement/crash duplicate limitations still apply. `--watch` polls the selected visit for at most 20 minutes; Ctrl+C stops it.

Approval links use `http://localhost:8443` and work only on the developer's laptop. They still require the assigned dummy host and an explicit POST decision. Clicking an email link never approves automatically. A scenario-generated manifest under `~/.gatepass/email-tests` binds the synthetic name/visit/host for scripted test approval; it contains no session or email capability token. Download verification writes the synthetic PNG beside that manifest. Real company SSO, reachable HTTPS origin and production transport setup remain separate deployment work.

`npm run mail:preview` writes three **synthetic** HTML and Outlook `.eml` samples into `~/.gatepass/email-previews`. It does not read/claim SQL notifications or call Graph. Preview links refer to synthetic requests. These previews are not evidence of inbox delivery.

- Unit cases: tampering, expiry, escaping, recipient resolution, manager notice, exact host snapshot, lease/relevance order, provider failures/202, token cache and CID branding.
- `database/tests/Test-EmailWorkflow.ps1`: restricted role boundaries, actual fenced dispatch content, expired/wrong claims, real TypeScript worker with a capture provider and SQL acknowledgement, wrong host/snapshot, independent decisions, retry and external holder binding.
- The public HTTP/SQL suite checks receipt deduplication, real host actions, result notifications, signed external status, actual PNG rendering and email-linked browser authentication/download.
- Mobile/desktop browser checks cover the isolated email sign-in destination, accessibility and absence of automatic approval calls.

Migration 061 is forward-only and has been applied locally. Previous migrations and user UI changes were preserved. No Git commit or push is part of this work.

Microsoft references: [sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0), [actionable message security](https://learn.microsoft.com/en-us/outlook/actionable-messages/security-requirements).

Final local evidence: 351 unit tests with coverage gates, 52 registration SQL cases, 9 dedicated email SQL/capture-provider cases, 23 actual HTTP/SQL cases including browser card/download/host authentication, and 10 standalone mobile/desktop browser cases passed. Type-check, lint, migration hashes and fresh replay through 061 passed. No external email was sent.

## Refresh-safe external holder session (22 October follow-up)

The browser exchanges the signed fragment through POST /api/email/external/session only after signature and current SQL visibility checks. The result installs a session cookie scoped to /api/email/external/{visitId}/ (HttpOnly, SameSite=Strict and Secure in production). Scoped detail/image POSTs use this cookie and revalidate the signed proof and request/snapshot every time. Different visitors use different cookie paths; the cookie cannot authorize a host decision. The clean history entry stores only a non-secret external-view hint; localStorage/sessionStorage never store the proof. Exchange failure retains the original fragment for explicit retry rather than discarding the only proof.

The external-link maximum lifetime is 92 days, matching the supported 90-day future booking horizon plus remaining visit day and one-day status grace. SQL still independently enforces current holder, snapshot, purge/validity and image eligibility. Existing short-lived links remain valid until their original expiry; key retention must cover outstanding link lifetimes. Pending statuses refresh while visible; authorization loss, revocation, expiry or newer detail responses invalidate old media and actions.
