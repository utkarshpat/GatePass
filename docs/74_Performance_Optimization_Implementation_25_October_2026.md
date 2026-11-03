> Documentation status: historical implementation/design/evidence record, indexed 3 November 2026. Read the [current handbook](system/README.md) and [Visit owner/Host glossary](109_Visit_Owner_and_Host_Terminology_03_November_2026.md) for current behavior. Counts, setup examples and screenshots below describe their dated stage, not a fresh certification.

# Performance optimization implementation and verification — 25 October 2026

Second implementation pass: [report 76](76_Remaining_Performance_Candidates_Implementation_25_October_2026.md), including schema 107, Reception/media/export/catalogue changes and the four-versus-six worker comparison. Neeche first-pass record preserved hai.

Migration **100** aur application changes locally implement/apply hue hain. Base commit `4899a7cd7b054674425e539be19d5c57033c1eee`; working tree modified aur uncommitted hai. Is report ka scope local synthetic SQL Express database aur development HTTP host hai.

Historical [baseline report 72](72_Corrected_Load_Stress_And_Bottleneck_Findings_25_October_2026.md) ka FAIL result preserved hai. [Candidate report 73](73_Performance_Optimization_Candidates_25_October_2026.md) ke predicate experiments ki jagah neeche actual optimized HTTP measurements hain.

## Implemented changes

1. **Guard queue:** date/status/search/project restrictions early materialize hote hain. Duty authorization request mein resolve/recheck hoti hai; employee/project eligibility distinct employee-duty pairs par evaluate hoti hai. Har unrelated visit ke liye nested duty helper repeat nahi hota. ALL allocations, common-duty verification, substring search, current entry owner aur stale-directory exit visibility preserve hain.
2. **Summary:** visit count ke bajay distinct office/project scopes authorize hote hain. Full 31-day range, zero days aur distinct recorded employee occupancy preserve hain. NULL/project scopes aur response se pehle fresh actor/capability/scope checks covered hain.
3. **Action Centre:** authorized candidate set reuse hota hai; guard/reception/admin per-row policy calls relational scope checks se replace hue. Counters poore authorized set ke hain aur projection selected category/page ki hai. Empty selected category dusre counters ko zero nahi karti. All follow-up flags ka full candidate scan abhi bhi hota hai.
4. **Reception:** office admission check ke baad redundant per-visit authorization repeat nahi hoti. Presence/purge restrictions, office-wide pending returns aur authoritative counts preserve hain.
5. **Loaded-window refresh:** first page/load-more defaults unchanged: guard/actions 24, reception 50. Quiet refresh server ko currently loaded window request karti hai: guard/actions maximum 240, reception 500. Cap ke aage cursor continuation remains bounded. Browser checks mein 48 guard cards, 48 action items aur 100 reception rows one refresh request mein reconcile hue; old paths ko two requests chahiye the.
6. **Register/export:** exact office/project admission ke baad redundant per-row read policy remove hui. Ordinary register pages 50; explicitly authorized export chunks 200. 1,022 rows ke export ko 21 ki jagah 6 requests chahiye; 10,000 maximum par 200 ki jagah 50. Yeh request-count calculation hai, full export duration measurement nahi. Full-content `datasetVersion`, each-page authority checks, duplicate/length/total checks, cancellation and 10,000-row bound remain. Har chunk matching dataset ko materialize/hash karta hai; persistent snapshot aur late projection abhi implement nahi hue.
7. **Development SQL transport:** per-request CREATE/DROP USER ki jagah per-worker/per-role leased execute-only identity reuse hoti hai. Four-worker cap unchanged; six allowed roles ke saath maximum 24 cached connections. Role identities separate hain, actor/session data cache nahi hota. Every RPC checks synthetic database mode, impersonates its exact role, reverts and verifies transaction cleanup. Session application-lock lease active identities ko collection se protect karti hai. Crash recovery sirf protocol-tagged, lease-free, expected one-role principals collect karti hai; unrelated/legacy principals preserved hain. EOF shutdown graceful cleanup await karta hai, bounded forced fallback hai; uncertain writes automatically replay nahi hote. Production SQL identity pools unchanged hain.
8. **Load harness:** eleven parallel authenticated readers ke beech one ordered movement writer ka phase add hua. It verifies 100 write responses, 50 committed entries, final outside state, read payload invariants, deadlocks and cleanup. Failed/uncertain write par phase stops; requests drain before DB inspection. Two concurrency/failure regressions added hain.

Migration 100 canonical SHA-256: `e60442bac3d7049303d22b10776602a09b063fd1d571e3ea393ddeea02d82f26`. Existing 99 migration manifest entries unchanged hain. `database/setup/Apply-LocalForwardMigration.ps1` manifest, predecessor and no-reapply guards ke saath local development migration apply karta hai. Deployment/production migration approval is report se implied nahi hai.

## Measured HTTP verification

Final run **PASS**: `d2e64e10-e2d3-4398-be72-bf332db9812c`. Same configured 1/4/8/12 client matrix, **100 samples per API/client point**, **1,200 benchmark responses**, **0 unexpected responses**, unchanged **5,000ms p95 guard**. Fixture: 1,000 owned visits (800 approved/200 pending), 2,110 office / 2,111 database visit rows; SQL Express 17.0.1145.4, migration 100. Old run uses migration 99 and the same visit-volume shape; unique fixture IDs and background execution conditions differ. This is a local before/after observation, not a controlled production experiment.

| API, 12 clients | Before p95 ms | After p95 ms | Observed reduction | After requests/s |
|---|---:|---:|---:|---:|
| Summary | 1825.9 | 115.8 | 93.7% | 126.0 |
| Guard queue | 5580.6 | 261.2 | 95.3% | 56.1 |
| Action Centre | 5219.2 | 141.5 | 97.3% | 104.2 |

| API | c1 p95 ms | c4 p95 ms | c8 p95 ms | c12 p95 ms |
|---|---:|---:|---:|---:|
| Summary | 31.2 | 66.8 | 96.3 | 115.8 |
| Guard queue | 60.0 | 113.0 | 207.4 | 261.2 |
| Action Centre | 39.6 | 62.1 | 103.3 | 141.5 |

**Mixed workload:** 11 concurrent authenticated readers + one sequential writer. **899 reads / 100 writes**, zero unexpected responses; read p95 **134.3ms**, write p95 **98.6ms**. Fifty ENTRY + fifty EXIT responses, 50 committed entries and final inside count 0. Visitor and mixed employee races separately preserve one success + eleven HTTP 409 conflicts. SSE capacity and malformed/oversized requests pass. Observed SQL 1205 deadlocks: **0** in instrumented owned-server phases.

**Soak:** configured 60 seconds, **5796 authenticated requests**, four post-GC Node-child samples, RSS growth **31.1 MiB** against unchanged 128 MiB growth guard. PowerShell/SQL Server memory excluded. Short soak does not establish leak absence; workload throughput differs from baseline.

**Cleanup/provenance:** owned fixture users/visits/direct principals zero; leased development principals zero; diagnostic principals/procedures zero; mixed occupancy conflicts zero. **26 retained presentation visits and 13 preexisting development principals preserved.** All **19 runtime/harness source fingerprints match** after final verification. Exact read-only DB proof: `output/performance-implementation/database-verification.json`.

Raw final artifact: `output/load-stress/d2e64e10-e2d3-4398-be72-bf332db9812c/report.json`; baseline `output/load-stress/82fd9007-8994-4573-b009-94eb9f9118de/report.json` remains FAIL. Earlier optimized full confirmation `d07acf9a-a16d-49ae-b90f-1911a9069d3e` also passed; final run additionally includes mixed reads/writes. All run artifacts retain their original results.

## Correctness and quality evidence

- **587 unit tests passed, 1 skipped, 0 failed**; same CI suite coverage gates pass: **97.16% lines / 89.69% branches / 93.62% functions**.
- **20 browser checks passed**, including actual SQL guard/reception paging, independent Chromium–Edge entry/exit synchronization, 31-day summary parity, scoped SSE and export mutation/revocation protections. Browser export chunk response is mocked; live SQL export shape/fingerprint/authority is covered separately.
- **41 new live SQL equivalence/boundary cases passed**. Temporary baseline procedures use original pre-100 definitions; complete payloads (except checkedAtUtc) or exact denials compare against new procedures. Search, denied/expired/blocked actors, ALL/COMMON duties, pagination, stale-directory entry ownership, every Action Centre workspace/category, reception filters/counts, office/project summary, export fingerprint and revocation covered hain.
- Existing **8 SQL regression suites passed**: guard duties, presence read models, digital-ID follow-ups, employee presence/export, administration reads, admin console, admin register and Action Centre/reminders.
- Real development lease test passed: one SQL identity reused across four reads, separate render role, direct table SELECT denied, killed worker sessions release, replacement collects orphan identities, no replay and graceful close leaves zero owned identities. Expected negative SQL 53401 response is asserted, not a successful render claim.
- Typecheck, lint and **100 sequential migration hashes passed**. Release preparation packages **217 allowlisted files**, excludes development runtime and keeps deploymentReady false. npm audit: **0 vulnerabilities**. Git-history secret scan: **37 commits, 0 leaks**; this scope does not scan every uncommitted file.

Raw quality evidence: `output/performance-implementation/`. SQL equivalence artifact: `output/read-optimization/e57eb8e2-d544-41b4-accb-25cfb3b266d8/report.json`. Browser metrics: `output/queue-performance/b8f1a500-2050-498d-9406-1fb138b80e6d/queue-performance.json`. Generated raw outputs local/ignored hain.

## Remaining measured or conditional candidates

Post-change diagnostic **PASS**: `output/performance-candidates/c8bc1ebe-fef0-47ec-be30-2c4ebec1e73a/report.json`; 12 direct SQL scenarios × 5 measured calls, plus 60 exact predicate-set comparisons. These are sequential **five-sample means**, not HTTP p95. Explicit export SQL retains its default 50-row pages in this profiler; the application requests 200-row chunks separately.

| Direct SQL scenario after optimization | Mean ms |
|---|---:|
| Guard first page | 43.5 |
| Guard specific search | 26.1 |
| Action Centre empty category | 22.0 |
| Reception first page | 195.9 |
| Office one-day summary | 24.6 |
| Register first page | 72.7 |
| Export first page, legacy 50 rows | 124.7 |

**Next concrete query target: Reception presence aggregation.** Authorization repetition removed, but `gp._PersonInsideOffice` still runs **2,150 times/RPC** in the measured 50-row first-page case. Office/employee presence ko request-local relational set mein resolve karke counts and page projection reuse kar sakte hain. Multi-project employee deduplication, TEMP_ID/employee-project occupancy, returned passes and office-wide pending-return counts ko exact parity tests chahiye. This second presence rewrite is not part of migration 100.

**Register/export remaining cost:** full matching projection and full-content fingerprint each chunk par repeat hota hai. Authorized 200-row chunks reduce passes; late projection or a bounded, owner/scope-bound consistent snapshot is further work. A snapshot needs expiry, revocation/audit handling and protected storage; count-only revisions are insufficient.

**Remaining local queueing:** 12-client timing observations below are mean stages per RPC; do not add stage percentiles or interpret them as production waits.

| API | Worker queue mean ms | SQL execute mean ms | Setup mean ms |
|---|---:|---:|---:|
| Summary | 55.2 | 23.8 | 2.9 |
| Guard queue | 129.7 | 63.9 | 2.8 |
| Action Centre | 69.0 | 32.9 | 2.0 |

Guard now invokes `_GuardDutyAssigned` twice/RPC in this scenario, compared with 2,112 baseline calls; summary project scope invokes `_AdminScopeAllowed` four times instead of 2,048 in the 31-day direct phase. Scalar counters are plan-cache deltas; nested costs overlap and unrelated database activity can contribute. More workers may move pressure into SQL; worker-count changes need a separate controlled matrix.

Admin project/common-area catalogue abhi eager pages drain karti hai; guard search debounce stale responses discard karta hai, dispatched SQL coalesce nahi karta. Yeh candidate 9 ke known code paths hain. Inko 1k/10k projects/assignments aur rapid scope/search changes ke dedicated fixture par profile karna baaki hai. Current visit-heavy test catalogue fleet-size performance establish nahi karta. Safe paging needs selected project retention, scope metadata and server-side search together; merely first catalogue page dikhana authorization/navigation completeness break karega.

Worker/socket/SSE caps aur indexes is change mein tune nahi hue. Remaining worker queue delay ko representative staging mein mixed scan/render/export load, arrival-rate tests, actual plans/waits/spills/logical reads aur larger retained datasets ke saath measure karna chahiye. Thumbnail/render/mail workflows is load matrix mein comprehensively exercise nahi hue. Synthetic local improvements production capacity, all-application correctness ya zero memory leaks ka certification nahi hain.

## Reproduce

```powershell
$env:GATEPASS_SHARP_PATH = "$HOME\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\sharp"
$env:GATEPASS_PWSH_PATH = "$HOME\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe"
$env:PATH = "$HOME\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell;$env:PATH"
node tools/run-load-stress-test.ts --requests 100 --concurrency 1,4,8,12 --soak-seconds 60
& $env:GATEPASS_PWSH_PATH -NoProfile -File database/tests/Test-ReadOptimization.ps1 -TrustLocalServerCertificate
& $env:GATEPASS_PWSH_PATH -NoProfile -File database/tests/Test-DevelopmentLeases.ps1 -TrustLocalServerCertificate
```

Existing synthetic `GatePass_DesignTest` database par migration 100 required hai. Harness free owned port 18449 check karta hai, exact owned fixtures create/refresh karta hai, owned child stop karta hai aur finally cleanup validates karta hai. Regular app **8443 fresh managed terminal session** mein restart hua, official `npm.cmd run dev` launcher se. Anonymous root HTTP 200 aur protected guard route HTTP 303 verify hue. Previous baseline report ka background-start approval rejection historical hai; this controlled-session startup succeeded. Final zero-lease DB snapshot regular app startup se pehle liya gaya tha; ordinary browsing can legitimately create new live leased users.
