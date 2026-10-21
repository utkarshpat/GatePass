# 10 - Guard ID/password authentication implementation

Date: 20 October 2026. **SQL and internal backend implemented/tested. HTTP routes, browser login and deployment identity provisioning remain pending.** No permanent guard passwords or default login accounts were seeded.

## Identity and database boundary

Employees/hosts use corporate SSO. Guards use their own application login ID/password without SSO or a corporate mailbox. Both resolve to `gp.Users`; live sessions, capabilities, locations and project allocations authorize operations afterward. A guard account is not a SQL login.

Migration 006 adds GuardCredentials, GuardSetupTickets, GuardLoginAttempts and GuardAuthSources, four FKs, two private predicates and ten procedures. Migration 007 fixes the reservation cap to count only the current credential/authorization generation: abandoned pre-reset attempts cannot delay a newly set password. Applied migration 006 was not edited after execution. The current database has 31 tables, 281 columns and 56 FKs; all seven migrations are recorded.

| Entry point | SQL role / purpose |
|---|---|
| ManageGuardCredential | API role; live administrator session + CSRF + GUARD_CREDENTIALS_MANAGE; ISSUE_SETUP or DISABLE |
| BeginGuardLogin | Auth role; bounded source admission and a server-only verification reservation |
| CompleteGuardLogin | Auth role; consume reservation, recheck current generations/state, record failure or issue session; optional verified password change |
| InspectGuardSetup / CompleteGuardSetup | Auth role; rate-bound preflight and single-use version-bound setup/reset |
| TouchGuardSession / RevokeGuardSession | Auth role; CSRF-bound idle refresh/logout |
| PurgeGuardAuthTransient | Worker role; bounded cleanup of transient rows older than 24 hours |

The new `gp_guard_auth_runtime` role has six individually granted public procedures and schema SELECT/INSERT/UPDATE/DELETE/ALTER denied. It cannot provision credentials, approve visits or record movements. API/worker roles cannot invoke the password verifier procedures. Private helpers have no runtime grant. All three roles remain unassigned to real identities after disposable test users are removed.

The authentication verifier is explicitly trusted: SQL cannot verify an Argon2 password from a boolean. Only this isolated server component may receive stored hashes and attest PasswordVerified. Compromise of its connection/code can impersonate eligible guards. General API/browser access must never share its SQL permissions. No ordinary API receives an arbitrary actor UserId as authority.

Credential administration requires India/location-admin authority over **every current guard location**, plus the separate capability. Project-only administrators and partial-location administrators cannot reset a multi-location guard. Employee identities and users with another active staff role cannot receive/use the guard password path. Provision/reset never grants a role, capability or allocation. There is no seeded administrator or self-registration bypass.

## Transaction and lifecycle behavior

The service generates random 32-byte setup/session/CSRF/verification handles. SQL stores only their SHA-256 digests; password storage uses Argon2id separately. Setup/reset clears the old password immediately, increments generations, revokes sessions and invalidates outstanding setup handles in one audited transaction. Completing setup updates the password and invalidates the handle without automatically signing in. Password change requires successful old-password verification and revokes previous sessions before issuing a replacement.

Login reservations bind user, source, credential version, authorization version and expiry. Completion rechecks enabled account, active guard-only identity, temporary lockout and both versions **after the account lock wait**. A reset/disable racing verification cannot leave an old credential's session usable. One reservation cannot create two sessions. Failed counters commit with denied outcomes and serialize per account. Audit failure rolls back session creation and reservation consumption together.

Lock order is authorization -> source budget where used -> guard account. Reset, password change, setup completion and auth cleanup take Exclusive authorization locks; normal verification/session actions take Shared. Initial lookups end before waiting for account locks. Auth procedures establish READ COMMITTED and reject ambient transactions. Login session expiry uses existing gp.Sessions, so existing movement procedures enforce the same CSRF/current authorization boundary.

## Explicit development policy

| Policy | Current value |
|---|---|
| Login ID | 3–64 lowercase ASCII letters/digits/dot/underscore/hyphen, starts with letter/digit; backend normalizes ID only |
| New password | 15–128 Unicode code points, at most 512 UTF-8 bytes, valid Unicode; preserved exactly without trimming/truncation |
| Password hash | Argon2id v19, m=19456 KiB, t=2, p=1, random 16-byte salt, 32-byte tag; canonical PHC encoding |
| Verification concurrency | At most two in-flight service operations/hash jobs per service instance, no unbounded queue |
| Account failures | Five completed failures within 15 minutes -> five-minute temporary lockout |
| Source admission | Twenty requests per 60-second source window, including unknown accounts; setup preflight/completion also consume budget |
| Login reservation | Sixty seconds; at most two current-generation outstanding reservations per guard |
| Setup/reset handle | Fifteen minutes, single use |
| Session | Fifteen-minute idle, eight-hour absolute expiry; touch never extends absolute expiry |
| Transient cleanup | At most 1,000 of each transient row type per invocation, default 500; expired/unused data past 24 hours only |

These are tested pilot values, not approved enterprise policy. SQL policy changes use reviewed migrations; the hash cost/encoding contract must stay aligned with the verifier. Common/breached-password screening, target-VM benchmarking and enterprise policy review are rollout gates. No guard MFA availability is assumed.

The source digest must come from a trusted transport/proxy-derived, keyed and canonical source bucket. It is not accepted from request JSON or an arbitrary forwarded-IP header. Raw addresses are not stored in SQL. Per-source rules need gateway/global abuse limits before public exposure and can affect shared-NAT users; pilot tuning is required.

The hashing choice follows [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html); lengths, generic failures and throttling follow [OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html). The existing Node v26.8.2 runtime supplies async `node:crypto` Argon2; no crypto package or machine software was installed. [Node documents the API and its stability](https://nodejs.org/download/release/v25.7.0/docs/api/crypto.html#cryptoargon2algorithm-parameters-callback). Deployment must pin and validate the selected runtime/library on Linux; laptop results are not Linux approval.

## Backend and evidence

`src/security/GuardPasswordHasher.ts` derives/verifies with Node crypto, bounds accepted cost/encoding before allocating memory and compares tags with timingSafeEqual. `GuardAuthService.ts` supplies dummy hash work for unknown/locked/disabled accounts, generic public failures, fresh opaque handles, setup, password change, touch and logout. Source throttling avoids expensive hashing after the source budget is exhausted. `SqlGuardAuthRepository.ts` allows only six static auth procedure contracts with typed parameters and validates returned data.

The SQL driver is an explicit `GuardAuthSqlClient` port; a production pool has not been provisioned. The integration test uses a **test-only PowerShell/.NET RPC bridge** with temporary users WITHOUT LOGIN on the installed SQL Server. Production must use an appropriate SQL driver and a separately provisioned auth identity, never this administrator-backed test bridge.

- 39 SQL suite cases passed, including four races with both independent SQL sessions observed waiting, role denials, lifecycle/reset/disable, audit rollback and a password-issued session's allowed/denied project movement.
- 15 Node unit/security cases passed; native TypeScript execution, not a TypeScript compiler/typecheck result.
- Six nested actual Argon2 + restricted SQL integration scenarios passed: setup/replay, wrong/unknown, correct login, password change, logout and administrator disable. They are included as one case within the 39-case SQL harness, not an extra 39 independent SQL cases.
- Existing 40 transaction and 39 notification-worker cases passed after 006/007.

Reports: `guard-auth-report.json`, `guard-auth-backend-integration.json`, `guard-auth-unit-report.json` and `guard-auth-unit-tests.txt` under database/validation; source hashes and exact limits are recorded. All generated test credentials/sessions and test principals are removed; requested dummy master data remains.

```powershell
./database/setup/Apply-LocalTransactionCore.ps1 -Migration 006 -TrustLocalServerCertificate
./database/setup/Apply-LocalTransactionCore.ps1 -Migration 007 -TrustLocalServerCertificate
./database/tests/Test-GuardAuthentication.ps1 -TrustLocalServerCertificate
npm run test:guard-auth
```

Apply only missing migrations, in order; recorded migrations are refused. SQL unit cases deliberately use a synthetic PHC and trusted verifier boolean. The six integration scenarios exercise actual password hashing. Neither suite certifies an unimplemented HTTP/browser login.

## Remaining application gate

Add trusted source extraction, HTTPS routing, body limits, blocked-password policy, secure cookie issuance, CSRF handling and safe redirect/logout semantics. The internal service's sessionToken must go only to its trusted HTTP adapter, which sets Secure/HttpOnly/SameSite cookies; never return it in public JSON/localStorage/logs. Provider/SQL errors never reach the browser. Set up controlled administrator-assisted guard enrollment/reset without assuming email access. Require protected setup-handle delivery, redacted logs, monitoring, source-state scheduling and expiry cleanup under production identities.

Guard UI remains simple: Login ID, Password, show/hide, sign-in and controlled administrator reset help, with password-manager/paste support. Browser guards, actual cookies, mobile-device UX, SSO, printer and Linux deployment are pending acceptance. GRD001-GRD012 remain sample profiles without permanent working passwords; do not introduce shared/default passwords to bypass enrollment.
