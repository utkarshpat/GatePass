# Local dummy employee SSO and manager profile

Real corporate SSO is deferred until the organization's configuration is available, as requested. The local simulator lets the existing synthetic employees sign in without provider keys and exercise actual SQL sessions and authorization. It is a development identity selector, not an implementation of an OpenID Connect provider.

“Employee registration” means an existing employee making a **Digital ID request** or a **project visit request**. Their employee account/profile comes from the directory. It is not a separate account-signup step.

## Start locally

From the repository in PowerShell 7, run:

```powershell
npm.cmd run dev:sso
```

Then open `http://localhost:8443`. This separate entry point sets explicit dummy/development flags, refreshes the existing synthetic directory and starts a listener bound only to `127.0.0.1`. Local development now uses plain HTTP on loopback only, as explicitly requested. No local HTTPS certificate is required. Production HTTPS is unchanged. No SQL authentication-mode change, server restart, firewall opening or system installation is needed. Ctrl+C stops the local listener and attempts to revoke its own issued sessions.

The startup directory refresh increments the existing synthetic users' authorization versions through the reviewed seed, invalidating their old sessions. It preserves revoked grants/allocations. During the running demo, a development-only namespace refresh updates directory/project-membership freshness once a minute without altering roles, authorization versions or activity flags. If refresh/SQL fails, existing freshness/session checks still fail closed.

Choose one of the **23 active employees** out of the 24 seeded records. `EMP015` is intentionally inactive and cannot sign in. Guards remain outside this selector and keep their separate ID/password flow. The screen uses the original company wordmark, a compact profile and subtle GatePass footer; it is a local test page, not the final employee dashboard.

## Employee and manager data

The profile comes from the actual local SQL dummy directory and includes:

- Employee ID, name and email.
- Their own current assigned projects, as affiliations.
- Manager employee ID, name, email and activity flag, or null when unmapped/unavailable.

For example, `EMP001` maps to manager `EMP019` and `employee19@example.invalid`. The integration test verifies that this matches `DirectoryGateway.getManager('EMP001')`, the directory lookup used for manager-recipient resolution. The browser cannot submit an arbitrary manager, corporate identity, email recipient or project affiliation during login.

Digital ID creation already queues a `TEMP_ID_MANAGER_NOTICE` with a MANAGER recipient binding to the requesting employee; resolution uses that employee's current active manager mapping. Profile display is not a mail send. The local demo uses only `example.invalid` addresses, and this increment sends no emails. A missing/inactive manager must not be replaced by a guessed recipient. Real mail transport and corporate directory/SSO integration remain later work.

## Isolation and session behavior

`src/development` and `tools/start-dummy-sso.ts` are separate from production composition. Every provider/helper operation requires `NODE_ENV=development|test`, `GATEPASS_SSO_MODE=dummy` and `GATEPASS_DIRECTORY_MODE=mock`. Production's normal API entry point rejects dummy mode and never imports this provider.

The development-only .NET bridge uses Windows integrated authentication against the dedicated `GatePass_DesignTest` database. The SQL adapter additionally requires its synthetic-directory ownership marker and accepts only the known development issuer/subject and synthetic employee/email namespace. It is a privileged local development helper, not the production TDS driver or a production service identity. Its fixed SQL file is not installed as a production migration; all 20 migrations and 33 core tables remain unchanged.

Login creates a real random session/CSRF pair; SQL stores only their digests with the current authorization version and normal 15-minute idle/eight-hour absolute lifetimes. A process-local bounded provenance map records which sessions this dummy provider issued. Unknown/guard sessions cannot satisfy its employee SSO gate. Gate checks revalidate current SQL session, employee activity, directory freshness and authorization version. Logout revokes the session. Restarting the provider discards its provenance; sign in again. Abrupt termination may leave unusable-to-the-new-provider SQL rows until expiry/cleanup; production retention remains a separate policy.

Local endpoints, all POST JSON through exact HTTP localhost Origin/Host checks:

| Endpoint | Purpose |
|---|---|
| `/api/dev/sso/employees` | List current active synthetic profiles |
| `/api/dev/sso/login` | Select `{employeeId: "EMP001"}` and issue a local session |
| `/api/dev/sso/me` | Current session/profile |
| `/api/dev/sso/touch` | Refresh idle lifetime |
| `/api/dev/sso/logout` | Revoke and clear session cookies |

HTTP development uses separate host-only `gp-dev-session` (HttpOnly, SameSite=Strict) and `gp-dev-csrf` (SameSite=Strict) cookies, with the existing `X-CSRF-Token` proof. They do not use the Secure attribute or the production `__Host-` cookie names; production cookies remain Secure. Remote peers are rejected even if forwarded headers claim localhost. Secrets never appear in JSON, URLs or logs. Switching a signed-in employee requires the current session CSRF proof. Manager/project DTOs are projected and validated; extra database fields are not exposed.

## Evidence and next work

- **200/200 Node unit tests**, including 15 new dummy-auth cases.
- **10 actual local HTTP/SQL integration cases**: active employee picker, protected original-brand page/script syntax, session issuance/profile/touch/logout, inactive employee rejection, actual SSO-gate checks, manager mapping agreement and opening a Digital ID intake through the restricted API SQL role.
- Test-owned sessions, intake, audit entries and temporary principal are removed. No employees/managers/guards or role assignments are deleted.

Run `npm run test:dummy-sso` for units and `./database/tests/Test-DummySso.ps1` for local integration. Do not overlap SQL fixture suites. The current integration uses ordinary loopback HTTP with no TLS-verification override; production TLS verification is unchanged. It uses the development integrated/.NET path, not production TDS. Browser interaction/rendering, real SSO and actual mail delivery are not claimed.

The standalone page currently verifies sign-in/profile; the main application still needs the protected photo/key stores, complete employee request screens, notification-preview worker and full flow wiring. Dummy SSO can be injected into the registration composition's existing SSO port while that work proceeds. Real corporate SSO keys do not block these development steps. Physical printer testing remains at final acceptance.

## Windows launcher compatibility

On an organization-managed Windows terminal, use `npm.cmd run dev:sso` to invoke the Windows npm launcher. The Node bootstrap discovers an existing PowerShell 7 from PATH, a standard installation or the existing Codex bundled runtime. Its resolved path is passed to the SQL/certificate helpers through child-process configuration. `GATEPASS_PWSH_PATH` may explicitly select an existing approved runtime. No installation, persistent PATH edit or execution-policy override is performed. If organization policy blocks the PowerShell helper files themselves, IT-approved script signing/policy is still required.

Validation for this increment: 19 focused runtime/dummy-auth tests; runtime discovery and version invocation verified with an empty PATH. Prior 200-test full regression remains historical; the new runtime cases are additional.


## Local HTTP increment

Per the user request, `npm.cmd run dev:sso` now serves **http://localhost:8443** bound exclusively to `127.0.0.1`. The local-only HTTP adapter requires explicit development/test + dummy-SSO + mock-directory flags and rejects remote peers, wrong Origin/Host, unknown routes and non-POST API requests. It sends no HSTS. Old local HTTPS certificate configuration is not used by this runner. The normal production API remains HTTPS-only and is not routed through this adapter. The original TLS loader remains available as an unused helper for future approved TLS configuration; browser/OS trust is untouched.

Current validation is recorded in `database/validation/local-http-unit-report.json`. Ten actual HTTP/SQL cases pass, including login, profile/manager data, touch/logout and Digital ID intake. No browser interaction acceptance is claimed. Physical printer testing remains deferred.

## Login navigation correction

The public GET `/` login shell now permits normal navigation from another site, while retaining loopback peer/Host checks, no-store and frame protection. It contains no personalized data; its profile APIs still require same-origin POST and session/CSRF proofs. The earlier Fetch Metadata rule incorrectly rejected clicks from external pages and returned NOT_AUTHORIZED for the login page. Regression coverage now sends an actual `Sec-Fetch-Site: cross-site` navigation and verifies that it receives HTML, while cross-site API POSTs and invalid Host remain denied. Eleven actual HTTP/SQL cases pass; evidence is `database/validation/local-http-navigation-report.json`. The current development address is explicitly `http://localhost:8443/`; the former HTTPS address does not speak the current development protocol.
