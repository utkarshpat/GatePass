# Registration HTTP and SSO boundary

Historical registration-transport increment (185 tests). The [local dummy employee SSO increment](21_Local_Dummy_Employee_SSO.md) records the current 200-test state and development-only authentication now authorized by the user. Real corporate SSO integration is deferred to the final integration stage.

This increment binds existing registration services to HTTPS. It adds no database migration and does not change the individual-person registration/approval model. Existing migrations 001–020 remain authoritative.

## Routes and browser contract

All routes require the existing exact HTTPS Origin/Host checks and POST. Responses, including failures, prohibit caching. These four routes are present only when real registration dependencies are supplied to `composeApi`; the CLI does not currently enable them because private storage and QR key provisioning are still pending.

| Route | Request | Result |
|---|---|---|
| `/api/registration/start` | JSON `{requestType: "EXTERNAL"}`, `DIGITAL_ID` or `EMPLOYEE_PROJECT` | Safe intake ID, request type and expiry; capability goes into cookies |
| `/api/registration/photo` | Raw JPEG/PNG/WebP body, maximum 5 MiB | `photoAssetId` from existing service |
| `/api/registration/submit` | Existing registration JSON contract and stable `clientKey` | Existing individual visit receipts |
| `/api/registration/reset` | Empty JSON object | Discard this browser's intake cookies; never delete visits/photos |

The browser holds one active intake. `__Host-gp-intake` contains a signed transport context in a Secure, HttpOnly, SameSite=Strict, Path=/ cookie. Its signing key is separate deployment configuration; use at least 32 random bytes. The cookie is signed, not encrypted; do not log request Cookie headers. It contains only the random intake capability, request type, ID, CSRF binding and expiry, never personal details or an employee login token.

`__Host-gp-intake-csrf` is a separate Secure, SameSite=Strict cookie readable by the same-origin frontend. Send its value as `X-Intake-CSRF-Token` for upload/submit/reset and when deliberately replacing an active form. The header must match both this cookie and the signed context. Cookies expire with SQL's intake lifetime. Public JSON never returns either intake secret. SQL independently checks hashes, expiry, owner and submission idempotency.

Starting another form replaces the browser's active context only after its CSRF proof. A submitted form retains its context so the same body and client key can safely retry after a lost response; existing SQL returns the original individual receipts. Use reset for an explicit new flow. Expired or corrupt contexts can be discarded through reset; valid contexts require their CSRF proof. Reset does not delete committed records or revoke the login session. Staged-file cleanup remains a separate reference-aware policy.

Photo content type is an admission check. The existing service performs image magic/decode validation, single-frame and pixel limits, metadata stripping, orientation correction, normalization to JPEG and private storage before recording SQL metadata. The HTTP adapter does not accept multipart paths, filenames or storage keys from the browser. It caps the raw stream at 5 MiB and clears the assembled upload buffer after the service finishes.

## Employee authentication

Employee start/upload/submit require the existing session and session-CSRF cookies/header **plus** a deployment-provided `EmployeeSsoGate`. Missing SSO integration returns unavailable before creating an employee intake; a gate denial returns unauthorized. A guard cookie alone cannot open this flow. SSO provenance is checked again on each employee photo and submit operation; SQL independently revalidates the current session, authorization version, owner and fresh employee directory mapping.

The gate is a trusted integration port, not a boolean environment flag or request claim. Its production implementation must verify the database session's actual corporate SSO provenance against the chosen provider's issuer/tenant, immutable subject, lifetime and required authentication policy. No provider, token verifier, callback or SSO session issuer is implemented without the organization's real configuration. Dummy directory rows cannot satisfy this port. No fake SSO cookies or sessions are issued by this increment.

## Composition and admission limits

The optional `registration` composition argument requires a `QrKeySource`, `PhotoNormalizer`, `PrivatePhotoStore` and cookie signing key. The real `RegistrationService` and `SqlRegistrationRepository` are constructed over the existing restricted API SQL client. The optional SSO gate enables only the employee authentication check; SQL still owns authorization. No mock/in-memory photo store is supplied by production composition.

Admission is bounded to four concurrent registration operations per process. Per direct-peer keyed source, fixed one-hour windows allow up to 120 starts, 600 photo attempts and 240 submit attempts. The map retains at most 4,096 live source buckets; expired buckets are removed, capacity exhaustion fails closed with HTTP 429. Forwarded addresses are ignored. These are initial single-process limits, not durable quotas: a restart resets them and shared corporate NAT capacity needs deployment tuning. Do not expose public registration until persistent storage quotas, reference-aware staged-file cleanup and appropriate network-level admission limits are in place.

## Evidence and next work

Sixteen new tests exercise real loopback HTTPS with mocked registration service responses and targeted SSO-port checks. They cover cookie confidentiality from JSON, signature tampering, CSRF, source limits, unsupported/empty/oversized photos, expired capabilities, reset, preserved retry context and SSO revalidation. The existing 17 registration units and prior actual SQL registration integration remain separate evidence. These HTTP tests do not claim photo normalization or production SQL connection end to end.

Current full regression: **185/185 Node tests pass**. `npm run test:transport` now includes **50** transport tests. Current evidence and hashes: `database/validation/registration-http-unit-report.json` and `registration-http-full-unit-tests.txt`. The previous 169-test transport report is a historical snapshot.

Remaining rollout dependencies: protected private filesystem implementation, QR key storage/rotation, staged-file quota/cleanup, actual SSO provider/session issuance, production SQL identities and trusted certificates, live HTTP-to-SQL integration, frontend/mobile acceptance and Linux deployment. Physical printer testing stays deferred to final acceptance.
