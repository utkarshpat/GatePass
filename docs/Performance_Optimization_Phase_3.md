# Digital-card performance: prevent repeated database shutdown

Implemented locally on 23 October 2026 after [phase 2](Performance_Optimization_Phase_2.md). This batch changes the dedicated local database's `AUTO_CLOSE` option and makes development/CI setup reproduce it. No application code, authorization query, schema migration, index or connection-pooling behavior changes.

## Finding

The live `GatePass_DesignTest` database had `is_auto_close_on = 1`. With the existing deliberately unpooled development SQL connections, gaps between calls can leave no open connection. SQL Server can then close the database and discard cached procedure plans. Microsoft recommends `AUTO_CLOSE OFF` for frequently accessed databases because reopening and procedure-cache flushing can degrade performance. [Microsoft guidance](https://learn.microsoft.com/en-us/sql/relational-databases/policy-based-management/set-the-auto-close-database-option-to-off?view=sql-server-ver17).

An instrumented, otherwise unchanged development API bridge measured eight authorized card-source reads before the setting change. Calls 4 and 8 took 500 ms and 452 ms: their SQL execution alone took 303 ms and 320 ms, compared with roughly 7–12 ms for the other warm calls. Connection-open/marker stages also spiked. The database setting and documented behavior explain a plausible source of this recurring cold work; the small benchmark is not an isolated proof of every individual cache flush.

## Change

- Added `database/setup/Optimize-LocalTestDatabase.ps1`, an explicit, idempotent maintenance command. It uses the existing local-only SQL adapter, requires the exact dedicated database and synthetic-directory marker, sets only `AUTO_CLOSE OFF`, and verifies the result.
- LocalDB initialization, historical baseline validation and private CI initialization now explicitly set the option OFF. Setup validates its existing database boundary before maintenance; runtime HTTP requests do not alter database options.
- Applied the command to the current local database: `true → false`. A second application returned `false → false`, confirming idempotence. The SQL service and application did not need restarting.

Run from the repository root on the configured local laptop:

```powershell
./database/setup/Optimize-LocalTestDatabase.ps1 -TrustLocalServerCertificate
```

The certificate switch is the existing explicit local-development bypass; omit it when the local SQL certificate is trusted. The command changes neither application identities nor grants. It does not enable connection pooling, retain authenticated SQL sessions or skip either card authorization/source read. The setting persists across later database use. Keeping the database open trades repeated shutdown work for retained database resources between requests; no additional service, API or dependency is introduced. Production configuration remains a separate deployment decision.

## Measurements

The same retained employee Digital ID was fetched five times over the existing localhost server before and after the setting change, with a fresh owned login per run. The benchmark logs out its own login afterward. PNG dimensions and content byte counts were unchanged.

| Complete card-image HTTP response | Before | After |
| --- | ---: | ---: |
| Median, five samples | 779 ms | 207 ms |
| First image request in run | 2,871 ms | 1,424 ms |
| Other four samples, range | 721–813 ms | 198–213 ms |
| PNG bytes | 135,397 | 135,397 |
| JSON response bytes | 180,638 | 180,638 |

Observed median reduction: approximately **73%**. First image requests include helper/key/font warm-up and follow sign-in; neither run is a controlled cold-machine test. Background activity and cache state vary. These local samples are not a production guarantee or load test.

In a separate eight-call bridge profile after the change, calls 2–8 took **22–40 ms**, with SQL execution **6–10 ms**. The first helper invocation still took 945 ms, including PowerShell/.NET startup and first-use overhead. No query or index change is responsible for these measurements.

## Query and plan evidence

Read-only Query Store summaries were collected for `GetOwnDigitalIdCard` and its authorization/print-detail helpers. They contain aggregate runtime, compile and logical-read statistics over an existing two-hour window; those historical aggregates mix different invocations and are not a clean before/after comparison.

An actual authorized card-source execution was also collected using `STATISTICS XML` and `STATISTICS IO`. Only sanitized summaries are retained: 17 plan statements, **zero spills, zero missing-index groups**, and **93 total reported logical reads** across 39 table IO entries. Full XML plans, bound parameter values and the returned card source are not saved. Collection uses the local maintenance identity with the procedure's normal session authorization; it does not benchmark the execute-only principal setup.

This small presentation dataset does not justify adding an index for this path. Absence of an optimizer hint is not proof that every query is optimal. Larger register/history/export workloads still need their own representative execution plans and IO measurements.

Duration/status/size-only evidence is retained under ignored `output/card-optimization-3/`: `http-before.json`, `http-after.json`, `bridge-stages-before.json`, `bridge-stages-after.json`, `database-options-change.json`, the Query Store summaries and `actual-card-plan-summary.json`.

## Verification and remaining delay

Follow-up: [phase 4](Performance_Optimization_Phase_4.md) measures and reduces repeated helper startup after ordinary browsing pauses, while keeping one bounded helper warm and retiring burst capacity quickly.

The four changed/new PowerShell scripts parse successfully. The maintenance command succeeds twice and rejects a remote target before opening a connection. All 90 existing migration hashes remain valid. Actual SQL checks pass for concurrent directory reads, isolated employee sessions, CSRF rejection, touch/logout and direct SQL revocation observed by the next inspection. The focused seven browser cases cover card loading/retry, participant binding and employee/guard workflows.

No presentation records, passes, photos, audit history or outbox messages are removed. Normal authorized card reads retain their existing audit events. No email is sent and no email worker is started. Changes remain local, without a commit or push.

The first image response still takes around 1.4 seconds in this run. Helper startup, cold protected-key recovery and rasterization now deserve the next measurement; the final fresh card authorization/source check remains necessary.
