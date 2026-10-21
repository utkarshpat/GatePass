# 07. Development setup and configuration

## Prerequisites
Use pinned Node range >=26.8.0 and <27 (CI selects 26.8.2), locked npm dependencies, an approved dedicated SQL test instance and PowerShell 7 for the existing Windows SQL/storage adapters. Development is on Windows; planned Ubuntu deployment requires separate platform acceptance. Private SQL/media/key files stay outside source/OneDrive.

## Existing configured laptop
From repository root, run npm.cmd ci, then npm.cmd run storage:init, then npm.cmd run dev:sso. The first installs locked dependencies, the second checks/opens protected storage and the third starts the explicit local development host. None provisions a complete fresh production environment.

Open http://localhost:8443/ for staff, or /office/noida for public intake. Despite port 8443, this runner uses HTTP. HTTPS against it produces SSL protocol errors. Stop its owning process cleanly and restart after asset/source changes; do not terminate unrelated listeners by guessed process/port. Ordinary startup must not reset passwords or reinstate revoked grants.

## Fresh development database
1. Select the dedicated synthetic test database and approved migration identity.
2. Read database/README.md and helper parameters. Validate-LocalDatabase.ps1 handles the historical baseline, not the complete current 062 installation.
3. Apply missing reviewed migrations ascending through the baseline setup and Apply-LocalTransactionCore.ps1 path. Check ledger/compatibility; do not reapply recorded files or drop databases to hide failures.
4. Run approved synthetic directory/staff enrollment only with explicit development/mock flags. Credential seeding and test-password override are deliberate local operations, not boot behavior.
5. Initialize protected storage, start loopback host and verify staff/public flows.

CI uses tools/ci/Initialize-TestDatabase.ps1 with strict CI/test guards to create disposable private LocalDB. Do not weaken guards for organization SQL. Explicit local self-signed certificate bypass is only a test option; production requires trusted TLS.

## Configuration groups
The generated exact-name inventory extracts names, never values. Every process does not require every variable.

| Group | Examples | Boundary |
|---|---|---|
| Database | GATEPASS_DB_SERVER, GATEPASS_DB_PORT, GATEPASS_DB_NAME | Private SQL target and trusted TLS |
| Principals | GATEPASS_API_DB_USER/PASSWORD; AUTH, WORKER and OUTLOOK equivalents | Independent execute-only identities |
| HTTPS | GATEPASS_ORIGIN, TLS_KEY_FILE, TLS_CERT_FILE, BIND_ADDRESS, SOURCE_KEY | Exact origin and protected key material |
| Development | NODE_ENV, GATEPASS_SSO_MODE, DIRECTORY_MODE, PWSH_PATH | Loopback dummy/mock only |
| Rendering/tests | GATEPASS_SHARP_PATH, TEST_SQL_SERVER | Existing approved package/test target |
| Graph | GATEPASS_GRAPH_TENANT_ID, CLIENT_ID, CLIENT_SECRET; MAIL_SENDER | Approved sender/application |
| Mail adapters | GATEPASS_MAIL_DIRECTORY_MODULE, EMAIL_LINKS_MODULE | Trusted absolute modules/factories |
| Outlook | GATEPASS_OUTLOOK_ACTIONS_ENABLED, PROVIDER_ID, TENANT_ID, APPLICATION_ID, SCOPE, KEYS_MODULE | Disabled until onboarding |

Abbreviated names within grouped rows share the indicated prefix; use exact generated names and source for deployment. Never commit live environment values. Inject secrets through the approved OS/deployment mechanism. Passwords, signing keys, token caches and full capability URLs do not belong in logs/documentation.

## Commands
| Command | Purpose |
|---|---|
| npm.cmd run dev | Explicit local dummy runner |
| npm.cmd run typecheck / lint | Static checks |
| npm.cmd run test:ci | Unit/contract coverage and JUnit |
| npm.cmd run test:browser | Browser/accessibility suite; inspect configured target |
| npm.cmd run check:migrations | Source migration integrity |
| npm.cmd run scan:secrets | Redacted source/history checks |
| npm.cmd run release:prepare | Source candidate, not deployment |
| npm.cmd run mail:preview | Local email preview |
| npm.cmd run mail:status | Protected personal test connector status |
| npm.cmd run start:api | API skeleton, not complete UI hosting |
| npm.cmd run start:email | Approved Graph/directory/link-key worker |

Mail connect/test/scenario/dev commands can connect an identity, enqueue data or send email. Run them only deliberately for the authorized environment/recipient. They are not documentation-generation commands.

Sources: package.json; tools/Start-DummySso.ps1; tools/start-api.ts; tools/start-email-worker.ts; database setup helpers.
