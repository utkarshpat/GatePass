# Secure HTTP boundary and SQL adapter

Historical first transport increment (169 tests). The [registration HTTP increment](20_Registration_HTTP_and_SSO_Boundary.md) records the current 185-test/50-transport-test state and optional registration bindings.

This phase adds transport over the existing DB-first services. Migrations 001–020 remain unchanged. It is an implemented and tested API boundary, not a deployed production system or browser acceptance result.

## Implemented

- Native Node HTTPS listener, direct TLS only; defaults to loopback binding. Same-origin POST JSON operations, 64 KiB body limit, 16 KiB headers, bounded connection counts and request/header timeouts. JSON responses, including failures, use `Cache-Control: no-store`, no CORS, no framing and redacted errors.
- Guard login/setup/touch/logout use the existing password service. Raw session tokens go only into a `__Host-gp-session` Secure, HttpOnly, SameSite=Strict, Path=/ cookie. A separate `__Host-gp-csrf` Secure, SameSite cookie is readable by the same-origin frontend; it must match `X-CSRF-Token`, and SQL independently validates its hash against the session. Login and setup also require the exact configured Origin and Host. All cookies are session cookies; SQL remains authoritative for expiry and revocation.
- Source throttling uses HMAC-SHA256 of the direct socket address and a deployment secret of at least 32 bytes. Forwarded headers never affect identity, source buckets or TLS trust. A proxy is intentionally unsupported until a separate explicit trust design is implemented.
- Twenty-four protected route bindings select fixed service methods and views. Route names confer no role: every SQL operation rechecks the session and scope. Request JSON cannot supply an actor, a procedure name or a replacement view.
- `mssql` 12.7.10 uses separate explicit pools for API and guard authentication. Stored-procedure RPC, explicit parameter types, canonical bigint strings and UTC dates preserve existing contracts. There is no caller-controlled SQL or mutation retry. Default TLS is encrypted with certificate verification; there is no trust-all switch or elevated fallback.
- Startup checks actual database membership before admitting either pool. Identities must belong to their expected runtime role and no other database role except public; sysadmin and broad database permissions are rejected. SQL Server's default public column-key metadata permissions are allowed. The fixed admission SQL is the only startup query; runtime services receive only a procedure client.

The driver API is based on the [official node-mssql documentation](https://tediousjs.github.io/node-mssql/). Existing repositories still validate exact procedure parameter contracts before transport.

## Routes

All routes use POST with `Content-Type: application/json`. Protected routes also need the session/CSRF cookies and `X-CSRF-Token`. Same-origin browser fetches supply Origin automatically for POST. Do not put tokens in URLs or localStorage.

| Route | Service action |
|---|---|
| `/api/auth/login` | Guard login; body `login`, `password`, optional `newPassword` |
| `/api/auth/setup` | Complete setup; body `token`, `password`; does not log in |
| `/api/auth/touch`, `/api/auth/logout` | Existing SQL session action; empty object body |
| `/api/{own,host,guard,reception,admin}/visits/list` | Scoped visit list, fixed view from route |
| `/api/{own,host,guard,reception,admin}/visits/detail` | Scoped detail; body `visitRequestId` |
| `/api/guard/contexts` | Current multi-project contexts; body `locationId` |
| `/api/guard/verify` | Live QR verification; does not record entry |
| `/api/guard/movement` | Entry/exit with exact project selection |
| `/api/visits/cancel` | Individual cancellation preserving INSIDE state |
| `/api/admin/{projects,guards,subjects,roles,summary,audit}` | Existing scoped administration reads |
| `/api/admin/staff/{allocate,deallocate,grant,revoke}` | Existing scoped administration mutations |

Service input contracts remain in the linked implementation docs [12](12_Scoped_Reads_and_Photo_Access.md), [14](14_Visitor_Identity_and_Multi_Project_Guards.md), [16](16_Individual_Cancellation_and_Occupancy.md), [17](17_Scoped_Staff_Administration.md) and [18](18_Administration_Reads_Reports_and_Audit.md). Non-POST requests, query-string URLs and unlisted endpoints are rejected. Successful bodies are the existing service DTOs; errors expose only stable error codes.

## Configuration and startup

Use Node 26.8.x, install locked dependencies with `npm ci`, then run `npm run start:api` after supplying configuration through protected process/service environment. No secret values belong in source control, screenshots or chat.

| Variable | Required value |
|---|---|
| `GATEPASS_ORIGIN` | Exact HTTPS origin, e.g. `https://gatepass.company.example:8443`, without a trailing slash |
| `GATEPASS_TLS_KEY_FILE`, `GATEPASS_TLS_CERT_FILE` | Protected private key and certificate chain files for that host |
| `GATEPASS_SOURCE_KEY` | Cryptographically random secret, at least 32 bytes encoded as base64url |
| `GATEPASS_DB_SERVER`, `GATEPASS_DB_PORT`, `GATEPASS_DB_NAME` | SQL TCP host, explicit port, application database |
| `GATEPASS_API_DB_USER`, `GATEPASS_API_DB_PASSWORD` | Restricted SQL identity in `gp_api_runtime` only |
| `GATEPASS_AUTH_DB_USER`, `GATEPASS_AUTH_DB_PASSWORD` | Different restricted SQL identity in `gp_guard_auth_runtime` only |
| `GATEPASS_BIND_ADDRESS` | Optional listener interface; default `127.0.0.1` |

The SQL certificate must be trusted by Node and match the configured server name. The HTTPS certificate must be trusted by the browser. No Windows service, SQL login, authentication mode change, firewall rule or certificate-store modification is performed by this phase. The currently installed local Windows-integrated validation connection is separate from this SQL-authenticated production adapter; production TDS connectivity is still unverified until restricted identities, TCP and trusted certificates are configured.

## Evidence and remaining work

`npm run test:transport` covers 34 tests: 18 real loopback HTTPS requests/configuration cases with mocked services, ten driver RPC/type/error cases with a fake pool, and six real-service route composition cases with a fake SQL client. Test TLS certificates are generated in memory for one hour through PowerShell/.NET and are never installed in the certificate store. Test-client certificate verification is disabled only inside that test; production verification stays enabled. These tests currently run on the Windows development host with PowerShell 7.

`database/setup/Test-TransportIdentity.ps1 -TrustLocalServerCertificate` tests six admission cases on the actual dedicated SQL test database through the existing integrated .NET helper. Its disposable user and role changes are rolled back. It tests the same admission SQL used at startup; it does **not** test a production TDS connection or HTTP-to-live-SQL end to end.

Current full regression: **169/169 Node tests pass**, including the previous 135. Machine-readable current source hashes and exact evidence limits are in `database/validation/transport-unit-report.json`; identity evidence is in `transport-identity-report.json`. Prior phase archives/reports remain historical snapshots.

Still pending: real SSO session issuance and tenant/issuer checks; registration intake cookies/photo upload routing; private photo/render storage and binary HTTP delivery; host-decision/reconciliation HTTP services; credential administration UI; notification provider; production identity provisioning and live driver/HTTP-to-SQL validation; frontend screens and browser acceptance; Linux rollout. Unimplemented endpoints return 404; dummy directory entries never issue sessions. Physical printer testing remains deferred to final acceptance as requested.
