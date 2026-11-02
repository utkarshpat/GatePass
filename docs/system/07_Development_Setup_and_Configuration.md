# 07. Development setup and configuration

> Current source documentation: **2 November 2026**, migrations **001–132**. See [current release/configuration evidence](../88_Documentation_And_Release_28_October_2026.md), [individual visitor flow](../85_Individual_Visitor_Registration_27_October_2026.md), [runtime .env configuration](../86_Runtime_Environment_Configuration.md) and [organization requirements](../87_Organization_Production_Requirements.md). Earlier exported PDFs, screenshots and dated reports are historical.

Apply missing forward migrations in order using `database/setup/Apply-LocalTransactionCore.ps1`; never rewrite/reapply an existing ledger version. Current source migrations end at 127; the local GatePass development database was advanced from 121 to 127 on 1 November 2026. Use `Apply-LocalForwardMigration.ps1 -Version NNN` for later versions beyond the older fixed-list setup helper. Before Node decoder tests, set `GATEPASS_SHARP_PATH` to the installed `node_modules/sharp` package and `GATEPASS_PWSH_PATH` to PowerShell 7. `npm.cmd run dev` serves port 8443. The opt-in retained browser rehearsal is documented separately and uses port 18448 by default. Run SQL fault/locking suites separately from browser rehearsals.

## .env configuration
Copy `.env.example` to root `.env`; the existing local file retains development/dummy/mock mode. API/email worker and Node dev launcher load it before startup. Populate production SQL identities, HTTPS origin/TLS paths, source key, Graph sender/app credentials and approved adapter/storage paths only on the production VM. Keep `.env` out of Git, public hosting and personal sync; restrict filesystem access.

Run `npm run check:config -- api` and `npm run check:config -- email`. Errors list setting names only. A successful shape check does not prove provider connectivity or full production composition. Existing environment variables take precedence; restart services after edits. Reserved Entra/Google/directory keys are commented until adapters are implemented. See [report 86](../86_Runtime_Environment_Configuration.md).

Local SQL currently uses Windows Integrated Security against `localhost\SQLEXPRESS` / `GatePass_DesignTest` through the restricted PowerShell bridge. Production uses the configured separate SQL logins. Personal Outlook settings/token cache remain separate development-only protected storage; production email uses Graph app credentials from `.env`.

## Prerequisites
Use pinned Node range >=26.8.0 and <27 (CI selects 26.8.2), locked npm dependencies, an approved dedicated SQL test instance and PowerShell 7 for the existing Windows SQL/storage adapters. Development is on Windows; planned Ubuntu deployment requires separate platform acceptance. Private SQL/media/key files stay outside source/OneDrive.

## Existing configured laptop

The local runner builds seven React/TSX page bundles at startup. Use `npm run build:frontend` to verify a production frontend build independently; restart the runner after source changes. CI also runs this build. Print/offline HTML and existing CSS remain in use. See [frontend policy and migration](../92_React_Frontend_Migration_28_October_2026.md).
From repository root, run npm.cmd ci, then npm.cmd run storage:init, then npm.cmd run dev:sso. The first installs locked dependencies, the second checks/opens protected storage and the third starts the explicit local development host. None provisions a complete fresh production environment.

Open http://localhost:8443/ for staff, or /office/noida for public intake. Despite port 8443, this runner uses HTTP. HTTPS against it produces SSL protocol errors. Stop its owning process cleanly and restart after asset/source changes; do not terminate unrelated listeners by guessed process/port. Ordinary startup must not reset passwords or reinstate revoked grants.

The local UI host includes [cost-aware SSE invalidations](../Performance_Optimization_Phase_8.md) for visible staff workspaces. Four total streams/two per session share the existing sixteen-connection budget; excess viewers use polling. No broker, dependency or migration is required. The production API entry point does not automatically host this development stream. Reconnect/fresh safety reads cover process-local delivery gaps; review the documented limits before configuring multiple instances or a proxy.

## Fresh development database

For an existing synthetic `GatePass_DesignTest`, run `./database/setup/Optimize-LocalTestDatabase.ps1 -TrustLocalServerCertificate` from the repository root to verify/set `AUTO_CLOSE OFF`. Omit the certificate switch when the local certificate is trusted. This explicit local maintenance command preserves all records; ordinary server startup does not change database options. Fresh development/CI setup also sets this option. See [the measured performance result](../Performance_Optimization_Phase_3.md).

1. Select the dedicated synthetic test database and approved migration identity.
2. Read database/README.md and helper parameters. Validate-LocalDatabase.ps1 handles the historical baseline, not the complete current 121 installation.
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

## Account host policy update

See [accounts and approved hosts](../89_Accounts_And_Approved_Hosts_28_October_2026.md). Account-office host lists are explicit and administered within scope; membership alone does not enable hosting. Legacy API/schema names remain compatible.

`npm run test:coordination` creates its own marked SQL database, applies every migration, runs persistence/browser checks and removes only its owned database. Requires Windows SQL, PowerShell 7, the approved ScriptDom parser and pinned Playwright Chromium. It refuses an existing owned-fixture pointer. It never seeds the retained application database or connects to Outlook.

Planning mail has a selected-plan read-only preview: `npm run mail:planning -- <selected-plan-uuid>`. It writes protected files without opening Outlook or Graph. The separate `--send-to` test option requires an explicit test-recipient request and consumes only the selected synthetic plan queue; it never drains global or normal visitor notifications. See [full commands and limits](../102_Coordination_Email_Notifications_02_November_2026.md).
