# Direct Outlook visit approval

Hosts can approve or reject from an Outlook Actionable Message without opening a GatePass login page. Microsoft supplies a signed identity token with the button POST. An ordinary HTML email link still opens the authenticated detail page. Forwarding does not transfer approval authority: the current actor must match the individually assigned host through a trusted directory binding.

## Implemented path

- Optional Adaptive Card embedded in the host-approval email head as `application/adaptivecard+json`. Approve and Reject are `Action.Http` POSTs; View details is a fallback URL. Other notices and visitor receipts have no direct decision actions.
- `POST /api/outlook/decision` uses independent bearer authentication; other browser APIs retain their cookie, Origin and CSRF requirements. No GET, URL parameter, email scanner, callback email field or arbitrary employee ID can authorize a decision.
- Only RS256 Microsoft Entra **v2** access tokens for the configured organizational tenant and application are accepted. The issuer, signature, audience, expiry, not-before, issued-at, tenant, stable object ID, delegated scope and preauthorized Microsoft Actions client ID are checked. Legacy substrate/EAT tokens, Graph audience tokens, personal-account tokens and app-only/ID tokens are rejected. Keys are fetched only from that configured tenant's fixed Microsoft JWKS endpoint. JWT-supplied key URLs are ignored.
- A separate, expiring HMAC capability binds request UUID, assigned host employee ID, immutable snapshot, decision and idempotency key. Its key ring is separate from printed QR and visitor-status keys; its MAC is domain-separated and bound to provider, service origin, tenant, application and scope. A capability alone cannot authorize anything.
- Dedicated execute-only `gp_outlook_runtime` calls only `gp.DecideOutlookVisit`. `gp.EmployeeEntraIdentities` maps verified `(TenantId,ObjectId)` to employee, with active/fresh directory checks. Only a governed migration/directory-sync identity may maintain it. There is no runtime self-enrollment or email-based fallback. Neither the web API nor mail worker gets this procedure's authority.
- SQL preserves the existing authorization and decision invariants: active user/employee, exact assigned host, exact project-office eligibility, fresh membership, snapshot match, deadline, pending credential, serialized visit lock, idempotent replay, `DecisionSource=OUTLOOK`, audit and individual result notification. Retry also rechecks current identity and membership. Opposite or concurrent decisions cannot overwrite a committed decision.
- HTTP success returns `CARD-UPDATE-IN-BODY: true` and a replacement card without decision buttons. Errors use controlled `CARD-ACTION-STATUS` messages. Tokens, capabilities, personal provider errors and keys are not logged.

## Organization setup still required

The local code and SQL tests do **not** establish a live Outlook provider. Personal Graph-to-Gmail delivery is a separate verified transport test; Gmail cannot render Outlook Action.Http. Do not treat the preview as live email approval.

1. Deploy a publicly reachable HTTPS API origin. Localhost is not reachable by Microsoft's action service. Keep the direct TLS/Host admission contract or implement an explicitly trusted deployment proxy separately.
2. Create an organizational single-tenant Entra API registration for org/test scope and request v2 access tokens. Keep it distinct from the personal Outlook test sender registration unless the organization's identity administrators explicitly approve a combined registration.
3. Register an Actionable Messages provider using **Microsoft Entra authentication** in the [provider dashboard](https://aka.ms/publishoam). Configure approved sender address(es), target HTTPS service and recipient scope. Record its real originator/provider UUID.
4. In Entra **Expose an API**, use the provider dashboard's AppIdUri. Add a delegated scope such as `GatePass.Visit.Decide`, prefer admin consent, and preauthorize Microsoft's Actions client `48af08dc-f6d2-435f-b2a7-069abd99c086` for that scope. Complete applicable organization/provider approvals and consent. The backend accepts v2 tokens with `aud` equal to the API application's client UUID, not the Graph sendMail application or AppIdUri.
5. Configure sender verification with approved SPF/DKIM according to the provider registration. This implementation embeds an unsigned Adaptive Card and relies on those sender checks; if the mail route requires Microsoft signed-card payloads, add the registered RSA/certificate signing adapter before activation. HMAC action capabilities do not substitute for Microsoft signed-card sender verification.
6. Populate stable tenant/object-ID bindings from the approved corporate directory and refresh them within the database freshness policy. Disabling/reassigning an employee must update the binding under the existing authorization lock discipline. Do not infer object IDs from an email claim or user form input.
7. Provision a separate SQL service login in only `gp_outlook_runtime`, and a protected persistent capability key provider shared by API and worker. Do not reuse API/auth/worker SQL identities or printed-QR signing material.

The same Outlook-related settings must be supplied to the API and email worker:

| Setting | Value |
|---|---|
| `GATEPASS_OUTLOOK_ACTIONS_ENABLED` | `true` only after onboarding; absent/`false` leaves ordinary email links active |
| `GATEPASS_ORIGIN` | Approved public HTTPS origin |
| `GATEPASS_OUTLOOK_PROVIDER_ID` | Registered Actionable Messages provider UUID |
| `GATEPASS_OUTLOOK_TENANT_ID` | Approved organization tenant UUID |
| `GATEPASS_OUTLOOK_APPLICATION_ID` | Action API Entra application/client UUID |
| `GATEPASS_OUTLOOK_SCOPE` | Delegated scope value, e.g. `GatePass.Visit.Decide` |
| `GATEPASS_OUTLOOK_KEYS_MODULE` | Absolute trusted module exporting `createOutlookActionKeys()`, returning `active()` / `resolve(id)` with protected 32-byte keys |
| `GATEPASS_OUTLOOK_DB_USER` / `GATEPASS_OUTLOOK_DB_PASSWORD` | API process only: dedicated Outlook SQL credentials, stored securely |

`src/email/LocalOutlookActionKeys.ts` is a real DPAPI CurrentUser/restricted-ACL adapter for a single Windows service account. Multi-host deployment supplies an approved shared protected-key adapter. Do not enable production direct actions with ephemeral keys. Required key retention follows card lifetime; retiring a key invalidates its outstanding cards. Capabilities expire at the earlier of the visit's validity end or seven days after issuance; SQL independently enforces the actual approval deadline.

An organization can disable Actionable Messages, or a recipient can use an unsupported mail client. Those cases keep the normal View details/sign-in fallback. No employee or host dashboard is introduced.

## Validation

- `npm.cmd run mail:outlook-preview` writes a nonfunctional synthetic card JSON and `.eml` under `~/.gatepass/email-previews`. It makes no external call and uses an ephemeral key/reserved example origin.
- Unit tests use real RSA-signed JWTs/local JWKS to exercise all claim and capability checks, direct webhook response/update behavior, controlled errors, card escaping, worker rendering and SQL-role separation.
- `database/tests/Test-OutlookActions.ps1` uses actual restricted SQL principals to check assigned identity, tenant/object spoofing, stale/disabled bindings, project-office revocation, snapshot mismatch, replay, cross-participant isolation, rejection and one result notification. Fixtures and identity bindings are removed after the suite. Tests do not claim that a real Outlook client token was received.
- Migration 062 is forward-only. Web session decisions remain available through their original procedure and retain their authorization requirements.

Microsoft references: [current Entra-token onboarding](https://learn.microsoft.com/outlook/actionable-messages/enable-entra-token-for-actionable-messages), [Adaptive Card action contract](https://learn.microsoft.com/en-us/outlook/actionable-messages/adaptive-card), [sender verification requirements](https://learn.microsoft.com/outlook/actionable-messages/security-requirements), [supported recipients and provider registration](https://learn.microsoft.com/en-us/outlook/actionable-messages/get-started).
