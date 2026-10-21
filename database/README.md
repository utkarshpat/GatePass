# GatePass database - v1.11, DB-first through Phase 02K

Start with [the numbered design guide](../docs/database/00_READ_ME_FIRST.md).

## 01. What is ready

- `migrations/001_individual_visit_baseline.sql`: complete new-database schema.
- `migrations/002_reference_data.sql`: four offices and capability catalogue; no real users, projects or privileges.
- `migrations/003_transaction_security_core.sql`: applied Phase 02A procedures and execute-only runtime role; no logins or business users.
- `migrations/004_notification_worker_leases.sql` and `005_worker_contract_hardening.sql`: applied Phase 02B fenced leases, dispatch preflight, retry/acknowledgement and a separate execute-only worker role.
- `migrations/006_guard_password_authentication.sql` and `007_guard_challenge_generation.sql`: applied Phase 02C guard credentials, scoped enrollment/reset, source/account throttles and generation-bound session issuance. No permanent guard passwords are seeded.
- `migrations/008_registration_and_digital_id.sql` and `009_registration_snapshot_canonicalization.sql`: owned intake/photo submission, atomic independent visits, Digital ID reuse, encrypted initial passes and canonical snapshots. See [document 11](../docs/database/11_Registration_and_Digital_ID_Implementation.md).
- `tests/Test-Registration.ps1`: 45 suite cases, including four observed SQL races and six nested actual photo/AES/SQL scenarios; 17 additional Node unit cases.
- `migrations/010_scoped_visit_reads.sql`: scoped list/detail, redacted non-moving guard verification and isolated media photo authorization; 47 suite cases (including four nested actual SQL/backend checks), 19 read unit cases. See [document 12](../docs/database/12_Scoped_Reads_and_Photo_Access.md).
- `migrations/011_reissue_and_print_lifecycle.sql`: atomic replacement, owned print jobs, isolated fenced renderer and landscape 85.6 × 54 mm cards; 55 current suite cases, six nested actual backend/SQL scenarios and 23 Node unit cases. See [document 13](../docs/database/13_Reissue_Printing_and_Card_Rendering.md).
- `migrations/012_visitor_cards_and_guard_project_context.sql` and `013_multi_project_guard_scan.sql`: pending identity QR, neutral cards, all assigned projects available to a shared-area guard, and explicit per-movement project targets. Run Test-GuardProjectContext.ps1; see [document 14](../docs/database/14_Visitor_Identity_and_Multi_Project_Guards.md).
- `migrations/014_trusted_card_details.sql`: trusted card fields and a print-source digest, with the approved layout shared by preview and backend. See [document 15](../docs/database/15_Trusted_Card_Details_and_Layout.md).
- Migrations 015/016 implement owned cancellation and preserved project occupancy. Run Test-VisitCancellation.ps1; see [document 16](../docs/database/16_Individual_Cancellation_and_Occupancy.md).
- Migrations 017/018 implement scoped guard allocation and explicit immutable staff role grant/revocation. Run Test-StaffAdministration.ps1 and node --test tests/staff-administration.test.ts; see [document 17](../docs/database/17_Scoped_Staff_Administration.md).
- Migrations 019/020 implement scoped administration selectors, role history, operational summary and redacted audit pages. Run Test-AdministrationReads.ps1 and node --test tests/administration-reads.test.ts; see [document 18](../docs/database/18_Administration_Reads_Reports_and_Audit.md).
- `schema-manifest.json`: metadata extracted FROM the reviewed SQL, with source checksum and scoped live-verification evidence references; not a replacement for the actual catalog.
- `inspection/001_live_catalog.sql`: read-only actual database catalog capture for later DB-first model/repository derivation.
- `tests/001_schema_constraints.sql`: 18 synthetic engine constraint scenarios, transactionally rolled back.
- `validation/model-report.json`: static model/artifact checks.
- `validation/sql-syntax-report.json`: Microsoft ScriptDom parsing of the SQL files.
- `validation/engine-report.json`, `constraint-results.txt`, `live-catalog.json`, `live-comparison-report.json` and `fixture-rollback-report.json`: actual local execution and scoped comparison evidence.
- `tests/Test-TransactionCore.ps1`: 40 restricted-role and concurrent-session scenarios; evidence in `validation/transaction-core-report.json`, migration and deployed security inventory reports.
- `tests/Test-NotificationWorker.ps1`: 39 worker/security/concurrent cases; `notification-worker-report.json` records source hashes, cleanup and zero provider calls. Worker migration reports and the refreshed role inventory are separate evidence.
- `tests/Test-GuardAuthentication.ps1`: 39 suite cases including four observed races and six nested actual Node Argon2/SQL scenarios; 15 additional Node unit cases. The PowerShell RPC adapter is test-only, not a production SQL driver.

Migration 001 is not an in-place upgrade for the old 20-table schema. Migration 003 adds the explicitly documented transaction core to the applied 001/002 baseline. Its runtime role remains unassigned to any real identity. Remaining procedures, provisioning, IAM and Outlook integration are subsequent work; see the [implementation boundary](../docs/database/07_Transaction_Core_Implementation.md).

Migrations 004/005 added worker leases without physical table changes. Phase 02C migrations 006/007 then add four tables; current structure after 020 is 33 tables, 297 columns, 58 FKs and twenty history rows. API, worker, auth, media and renderer remain separate execute-only roles. Current inventory includes scoped credential management on API and bounded auth cleanup on worker. See [worker limits](../docs/database/08_Notification_Worker_Implementation.md) and [guard authentication behavior](../docs/database/10_Guard_Login_Contract.md).

## 02. Test engine setup

The user installed SQL Server 2025 Express `17.0.1000.7` on this laptop. `MSSQL$SQLEXPRESS` is running and Windows authentication to `localhost\SQLEXPRESS` succeeded. Migrations 001/002 and all 18 scenarios passed on `GatePass_DesignTest`; the live catalog was exported and compared. The earlier automated installer attempt had been rejected and did not run; this workflow did not install software. sqlcmd/SSMS are not required for the default helper because the existing .NET SQL client is available.

The user confirmed local development first, followed by migration to the Linux VM. The local test engine is SQL Server 2025 Express on Windows. The later deployment target is the same edition, CU1 or later, on Ubuntu Server 24.04 LTS x86-64. Keep database access private and use a development/migration identity; application identities must have fewer privileges. No Linux deployment has occurred.

On PowerShell 7, the local command using a trusted SQL Server certificate is:

```powershell
./database/setup/Validate-LocalDatabase.ps1 -Server '.\SQLEXPRESS'
```

The helper uses Windows authentication, accepts local instances only, creates only the fixed `GatePass_DesignTest` database when absent, applies missing migrations 001/002, runs the 18 rollback scenarios and exports the actual catalog. It stops on SQL failure and never resets/drops a database. An unrecognized existing schema/history is rejected. It does not install software or grant access. If installation used a different local instance name, provide it with `-Server`.

The default `-Driver SqlClient` uses the available .NET client and executes these single-batch T-SQL files directly, capturing result rows, PRINT messages and SQL errors. No SQL schema is generated. `-Driver Sqlcmd` is an optional alternative requiring SQL Server 2025 sqlcmd (ODBC); that driver supports the ODBC UTF-8 input flag. Scripts with GO/sqlcmd directives are rejected by SqlClient mode rather than split heuristically.

SQL data/log files use engine defaults outside OneDrive. Evidence goes to `%LOCALAPPDATA%\GatePass\validation\<run-id>`. The helper checks baseline totals (27/250/52), guard-auth totals (31/281/56) registration totals (32/286/57) or printing totals (33/296/58) according to recorded migrations, plus enabled/trusted constraints. This is not complete drift proof. Recorded migrations are skipped, never reapplied; history alone does not prove historical checksums. Each run records current source hashes.

TLS encryption and certificate validation are explicitly enabled by default in both drivers. The installed local Express instance has an untrusted installation-generated certificate; the successful local run used the explicit `-TrustLocalServerCertificate` switch. This bypasses certificate verification for the locally restricted test connection while retaining encryption. A trusted certificate remains the production configuration. Never connect the application as the administrator used for schema setup.

```powershell
./database/setup/Validate-LocalDatabase.ps1 -Server 'localhost\SQLEXPRESS' -TrustLocalServerCertificate
```

The first live run applied both migrations; a subsequent successful run confirmed recorded migrations are skipped. The helper's catalog totals are only a sanity check. `tools/compare_live_catalog.py` separately passed 1,311 checks of columns/types/nullability/defaults, keys, FK mappings, constraint trust/counts and index names. See that report's explicit limits: CHECK expression, collation, index filter/order/include, identity seed and runtime security semantics are not proven by this comparison. Fixture rollback was separately verified: only 2 migration, 4 location and 11 capability rows persisted; all other 24 tables were empty.

Phase 02A subsequently applied migration 003, bringing history to three rows at that stage; 004/005 later bring the total to five at that stage. To reproduce the core on a new local 001/002 test database, apply 003 once using its dedicated runner, then run the behavioral tests:

```powershell
./database/setup/Apply-LocalTransactionCore.ps1 -TrustLocalServerCertificate
./database/tests/Test-TransactionCore.ps1 -TrustLocalServerCertificate
```

The runner parses GO batches with the existing ScriptDom package and uses one SQL connection for the complete atomic migration; it refuses reapplication. The behavioral harness provisions a temporary database user WITHOUT LOGIN, invokes the public procedures as that restricted user and inspects outcomes through a separate test admin connection. It uses unique synthetic run ownership, removes fixtures and drops the test user afterward. Four deliberate race cases observe both independent contenders waiting at SQL locks. The base validation helper recognizes 003 but does not auto-apply it.

For the worker block, apply 004 then 005 once on that baseline, and run the separate worker suite:

```powershell
./database/setup/Apply-LocalTransactionCore.ps1 -Migration 004 -TrustLocalServerCertificate
./database/setup/Apply-LocalTransactionCore.ps1 -Migration 005 -TrustLocalServerCertificate
./database/tests/Test-NotificationWorker.ps1 -TrustLocalServerCertificate
```

The apply helper accepts only reviewed 003-020 versions. Already recorded versions are refused. The baseline validator recognizes all thirteen versions but applies only missing 001/002 automatically. Worker tests require an initially empty dedicated outbox and do not send email. Claim handles are fresh per lease. The empty-queue contract was corrected by forward migration 005; applied 004 was not rewritten.

Later, use the [official Ubuntu SQL Server installation guide](https://learn.microsoft.com/en-us/sql/linux/quickstart-install-connect-ubuntu?view=sql-server-ver17), select Express and install sqlcmd. Linux needs its own service identities, filesystem paths, trusted TLS, protected keys, backup/restore checks and connection configuration; the same SQL migrations apply. The Windows helpers do not provision Linux.

The following LocalDB instructions are an optional path for this Windows development laptop only. LocalDB is a development engine, not the shared production service. Linux validation on the selected Express edition remains required.

Install the engine and sqlcmd from Microsoft-approved sources under the machine's software policy. LocalDB installation may require installation rights/license steps; the supplied setup script only creates an instance/database after tools are installed. It does not install software, grant remote access, change firewall rules or drop existing data.

Official references: [SQL Server Express LocalDB](https://learn.microsoft.com/en-us/sql/database-engine/configure-windows/sql-server-express-localdb?view=sql-server-ver17), [sqlcmd](https://learn.microsoft.com/en-us/sql/tools/sqlcmd/sqlcmd-utility?view=sql-server-ver17).

Run from the workspace root in PowerShell after installation:

```powershell
./database/setup/Initialize-LocalTestDatabase.ps1
```

This uses Windows authentication and private `(localdb)\GatePassDev`, creates only `GatePass_DesignTest`, and stores MDF/LDF under `%LOCALAPPDATA%\GatePass\sql-data`, outside this OneDrive-synchronized source directory. It does not share the instance or create SQL logins. Do not put real photos, credentials or production data in this test database.

## 03. Apply to a dedicated empty test database

Commands below use SQLCMD input files so any engine error produces a nonzero exit. Run each command separately and inspect its exit code; do not continue after failure.

On Linux, first create the dedicated empty `GatePass_DesignTest` database through the approved administrator workflow. Run the same migration/test files with sqlcmd against that Linux instance using the approved migration identity and a trusted TLS certificate. The following connection examples apply only to optional Windows LocalDB; replace connection/authentication options for Linux. Do not put passwords into commands or source files.

```powershell
sqlcmd -S '(localdb)\GatePassDev' -E -b -d GatePass_DesignTest -i './database/migrations/001_individual_visit_baseline.sql'
sqlcmd -S '(localdb)\GatePassDev' -E -b -d GatePass_DesignTest -i './database/migrations/002_reference_data.sql'
sqlcmd -S '(localdb)\GatePassDev' -E -b -d GatePass_DesignTest -i './database/tests/001_schema_constraints.sql'
```

Migration history is committed atomically with each script. Migration 001 deliberately rejects an existing gp-table baseline; migration 002 rejects repeat application. A future migration runner must track applied versions and artifact digests, serialize migrations and verify compatibility. There is no destructive automatic reset/down migration here. Use an approved backup/recovery or roll-forward process for persistent environments.

Constraint fixtures create only synthetic `TEST-*` data under an outer transaction and roll it back. Identity counters may still advance, which is normal. The test requires the exact dedicated database name; never relax that guard to run against a live database. It tests relational constraints, not complete authorization, legal service transitions or concurrent sessions.

## 04. Database-first source direction and static validation

The reviewed SQL scripts define the intended schema. Apply and verify them on SQL Server, inspect the actual catalog, and derive backend models/repositories from the database. Schema changes use SQL migrations. No Python/entity model generates DDL.

To refresh documentation metadata from reviewed SQL, use Microsoft ScriptDom, then render documentation. Re-extraction resets the live-verification annotation; recapture/compare the actual catalog before reasserting verification:

```powershell
./tools/export_sql_schema.ps1
python ./tools/render_database_docs.py
```

For PNG previews, run the Node renderer with GATEPASS_SHARP_PATH pointing to the existing bundled `sharp` package. No image-generation service or logo modification is involved.

Microsoft's parser is pinned to NuGet `Microsoft.SqlServer.TransactSql.ScriptDom` 180.140.0 and invoked with SQL Server 2022 grammar (TSql160Parser). On PowerShell 7 with .NET 8+:

```powershell
./tools/prepare_sql_parser.ps1
./tools/validate_sql_syntax.ps1
python ./tools/validate_database_model.py
```

The preparation script downloads only from official NuGet, checks the package SHA-512 against the NuGet catalog and caches the package under ignored `.tools/`. Syntax validation does not connect to SQL Server and cannot detect every engine-level semantic problem or prove concurrency behavior. The static checker verifies SQL-derived FK key/type compatibility, individual ownership links and structural invariants. The previous Python-to-SQL generator has been removed.

## 05. Next implementation gate

The baseline, Phase 02A core and Phase 02B worker DB gates passed: 18 constraints, 40 core cases and 39 worker cases. A replaceable directory adapter and persistent synthetic master data are now available: 18 adapter tests, 10 seed tests and 1,584 combination checks passed. See [document 09](../docs/database/09_Development_Directory_and_Combinations.md) for seed/test commands and SSMS inspection queries. The earlier empty-table cleanup report is historical; current inventory preserves requested dummy master rows.

Guards use individual ID/password without SSO; employees/hosts use SSO. The [implemented guard SQL/internal backend](../docs/database/10_Guard_Login_Contract.md) passed local checks; HTTP/browser login, production identities/driver/policy and enrollment remain pending. Apply missing 006 then 007 using the same reviewed runner and run `Test-GuardAuthentication.ps1`; `npm run test:guard-auth` runs the Node unit checks. Registration/Digital ID SQL and the internal backend subsequently follow in 008/009; apply missing versions in order and run `Test-Registration.ps1` with an existing approved sharp package. Migration 010 subsequently implements scoped reads/guard verification and isolated photo authorization; run Test-VisitReads.ps1 and npm run test:visit-reads. Migration 011 subsequently implements reissue/print/render; apply it once and run Test-PassPrinting.ps1, then npm run test:printing with the existing sharp path. Current card layout is landscape 85.6 × 54 mm with company branding. Apply missing 012/013 in order for the current identity-card/shared-area guard policy; there is no mandatory single-project guard mode. Apply missing 014 for trusted printed employee/host details and source binding. Cancellation is implemented in 015/016. Allocation/role mutations are implemented in 017/018. Admin read/report/audit contracts are implemented in 019/020. Continue with production SQL adapter and HTTP/API/UI integration and dependent HTTP/API/UI. No real SSO/Outlook integration or complete security certification is implied.
