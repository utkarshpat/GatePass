# Corrected load/stress run and bottleneck findings — 25 October 2026

Final measured run: **FAIL**. 1200 benchmark requests mein **0 unexpected HTTP/transport failures**, owned-server SQL 1205 observations **0**. **2 p95 guard breaches** hain. Performance guard FAIL hai. Raw report ki exact status aur phase results authoritative hain.

Run `82fd9007-8994-4573-b009-94eb9f9118de`: 2026-10-25T09:28:44.588Z → 2026-10-25T09:38:37.961Z. Base commit `4899a7cd7b054674425e539be19d5c57033c1eee`; modified working tree ke source hashes aur diff fingerprint report mein hain. Yeh uncommitted implementation verification hai.

Environment: Node v26.8.2, AMD Ryzen 5 230 w/ Radeon 760M Graphics        , 12 logical CPUs; SQL 17.0.1145.4 (Express Edition (64-bit)); 99 migrations. Invocation-owned 1000 rows: 800 approved, 200 aged pending. Total database rows 2111, office rows 2110. Background rows other scopes mein preserved hain.

## Measured API latency

Closed-loop concurrency, 100 requests per point, 5 warm-ups per scenario. Values milliseconds mein hain. New loopback socket per request; no idle generator sockets retained.

| API | Concurrency | Requests | RPS | p50 ms | p95 ms | Errors |
|---|---:|---:|---:|---:|---:|---:|
| summary | 1 | 100 | 4.75 | 201.3 | 286.0 | 0 |
| summary | 4 | 100 | 8.09 | 469.9 | 563.6 | 0 |
| summary | 8 | 100 | 7.93 | 1000.1 | 1167.5 | 0 |
| summary | 12 | 100 | 7.88 | 1369.9 | 1825.9 | 0 |
| queue | 1 | 100 | 1.65 | 580.9 | 838.2 | 0 |
| queue | 4 | 100 | 2.86 | 1341.8 | 1781.2 | 0 |
| queue | 8 | 100 | 2.90 | 2666.3 | 3500.1 | 0 |
| queue | 12 | 100 | 2.65 | 4375.3 | 5580.6 | 0 |
| actions | 1 | 100 | 1.50 | 635.6 | 896.0 | 0 |
| actions | 4 | 100 | 2.35 | 1576.4 | 2313.8 | 0 |
| actions | 8 | 100 | 2.45 | 3031.8 | 4613.1 | 0 |
| actions | 12 | 100 | 2.69 | 4354.6 | 5219.2 | 0 |

Local p95 guard 5,000 ms hai. Violations: queue concurrency 12 5580.6 ms; actions concurrency 12 5219.2 ms. Latency failures final command ko exit 1 deti hain; functional phases separately execute hote hain. Previous long run 8f753444-e447-4733-a236-108b9a31442e had 1,200 successful timed responses but overall FAIL due to stale synthetic directory before the race. Final harness refreshes only owned synthetic directory rows before phases; global freshness rules unchanged hain. Local point-to-point variation means a single below-guard result spare capacity establish nahi karta.

## Bottlenecks and mitigations

1. **Development bridge principal churn and coordination — confirmed.** Pre-fix concurrency 8 par 2 SQL deadlocks/100 summary requests mile. System-health graph mein permission-cache, ALTER ROLE membership aur DROP USER cycle tha. Session-owned shared/exclusive coordination se metadata DDL active bridge calls se separate hai; no write retry/replay aur no permission expansion. Is correctness fix ka cost setup/cleanup waiting hai. Next optimization: existing production typed TDS adapter ke execute-only pooled connections par representative staging profile. Local bridge redesign mein bounded, role-specific principal lifecycle aur crash cleanup pehle required hain; sirf workers badhana safe capacity fix nahi hai.

2. **SQL row-by-row authorization work — measured below.** Queue/action queries materialize full matching counts before returning 24 items; small pages full-filter work remove nahi karti hain. Scalar authorization helpers repeat hote hain. Next change: authorized scopes/candidates ko request ke andar set-based materialize/join karo, selective scope/date/status predicates apply karo, actual plans aur logical reads compare karo. End-of-read revocation, directory freshness, TEMP_ID/employee-project occupancy aur actor checks preserve hone chahiye. Cross-request authorization cache ya checks remove karna mitigation nahi hai.

3. **Four-worker queue and fixed socket budget — confirmed configuration, waiting measured.** Concurrency 8/12 four RPC workers se upar hai; queue wait response time mein add hoti hai, throughput plateau hota hai. Local host has 16 total sockets, SSE global 4 and per-session 2. Next step: SQL/principal costs reduce karke mixed read/write + SSE profile repeat karo; uske baad CPU/DB wait/connection budgets ke saath worker counts tune karo.

Concurrency 12 ke **mean RPC stages**; setup includes principal creation and coordination wait, cleanup includes coordination wait/REVERT/DROP. Yeh independent p95 values ka sum nahi hai.

| API | Worker queue ms | SQL execute ms | Setup ms | Cleanup ms |
|---|---:|---:|---:|---:|
| summary | 854.2 | 210.6 | 218.8 | 53.7 |
| queue | 2813.9 | 675.9 | 709.7 | 97.1 |
| actions | 2793.8 | 721.0 | 662.1 | 89.6 |

Direct baseline: same authenticated RPCs, one reused execute-only SQL connection, three warm-ups; connection/principal setup measured interval ke bahar. API comparisons mein connection/plan-cache differences bhi contribute kar sakte hain.

| RPC | Samples | Direct p50 ms | Direct p95 ms |
|---|---:|---:|---:|
| summary | 40 | 166.1 | 257.9 |
| queue | 40 | 616.8 | 828.7 |
| actions | 40 | 693.8 | 839.2 |

Function counters plan-cache deltas hain, per-call averages below. Other database activity contribute kar sakti hai; nested helpers overlap, isliye CPU values sum karke exclusive cost claim nahi karna chahiye. Inlined functions cache DMV mein absent ho sakti hain.

| RPC | Function | Calls/RPC | CPU ms/RPC | Logical reads/RPC |
|---|---|---:|---:|---:|
| summary | `gp._AdminScopeAllowed` | 2048.0 | 157.5 | 16384.0 |
| summary | `gp._RoleCapabilityAllowed` | 2050.0 | 6.3 | 0.0 |
| queue | `gp._GuardDutyVisitAllowed` | 2110.0 | 576.3 | 59212.0 |
| queue | `gp._GuardDutyAssigned` | 2112.0 | 459.2 | 54912.0 |
| queue | `gp._HasCapability` | 4224.0 | 255.1 | 33792.0 |
| queue | `gp._EmployeeProjectLocationEligible` | 9.0 | 1.1 | 116.0 |
| actions | `gp._GuardDutyVisitAllowed` | 2319.0 | 660.2 | 65064.0 |
| actions | `gp._GuardDutyAssigned` | 2321.0 | 530.3 | 60346.0 |
| actions | `gp._HasCapability` | 4642.0 | 295.3 | 37136.0 |
| actions | `gp._OperationsScopeAllowed` | 2.0 | 0.9 | 56.0 |

## Functional, memory and browser evidence

- Visitor race: [200,409,409,409,409,409,409,409,409,409,409,409], 1 committed ENTRY, 0 remaining inside. Mixed employee race: [200,409,409,409,409,409,409,409,409,409,409,409], 1 committed ENTRY, 0 remaining inside. Synthetic employee directory age before the races: 1s / 0s.
- SSE: third-session authorization control [200]; per-session [200,200,429]; global [200,200,200,200,429,429,429,429]. Global rejection uses an independently authorized third session with unused personal stream capacity.
- Input checks: malformed JSON = HTTP 400 (7 bytes); wrong type = HTTP 400 (92 bytes); over 64 KiB = HTTP 413 (70091 bytes); own prototype key = HTTP 400 (108 bytes); negative office = HTTP 400 (82 bytes); extra expression = HTTP 400 (110 bytes). A normal authenticated read succeeds afterwards.
- Soak: configured 60s across three windows; 216 authenticated requests; 4 post-GC Node-child samples. RSS delta -7.1 MiB against explicit 128 MiB growth guard. PowerShell/SQL memory excluded; leak absence is **not established**. Window duration can exceed target while the last bounded batch finishes.
- Browser suite: **6/6 pass**, including independent Chromium–Edge movement sync **2383 ms**, entry/exit count parity; 24 guard cards and 50 reception rows initially. Summary 31 calls 6997 ms vs one range call 392 ms, 31 days and counts matched. This is one local observation, not an approved timeliness SLO.
- Unit suite and CI coverage suite: **580 passed, 1 skipped, 0 failed** (581 total). Coverage **97.16% lines, 89.63% branches, 93.58% functions**; enforced CI gates passed. Twelve load/diagnostics/lifecycle regressions added; eight pre-existing proposed audit tests preserved.
- Typecheck, lint and 99 migration hash validation passed. No migration changed.
- Owned child shutdown and fixture cleanup completed; cleanup errors zero. Run-owned users remaining zero. Existing background fixtures were preserved.

Port 8443 app initially stopped tha. Automatic approval review ne persistent background startup block kiya (reason: "blocked by policy"). Verification isolated owned server par hui; regular development app restart pending hai.

Final read-only database check: **26 retained presentation visits**, **0 owned fixture users/visits**, **0 owned direct principals**, **0 new API principals left since the final run started**, **0 mixed occupancy conflicts**. One unassigned principal left by our pre-fix deadlock reproduction was identified by exact name/time window and safely removed after live-session/ownership checks. 13 older development principals predate that failed reproduction and were preserved; no blanket all-principals-clean claim. Current source hashes match all **8** instrumented runtime/harness files recorded at run start.

Fresh quality checks: npm audit mein **0 vulnerabilities**; Git-history secret scan mein **37 commits, 0 leaks** (history scope only); release preparation mein **216 allowlisted files**, development instrumentation excluded aur deploymentReady false.

## Evidence and reproducibility

- `output/load-stress/82fd9007-8994-4573-b009-94eb9f9118de/report.json` and `output/load-stress/82fd9007-8994-4573-b009-94eb9f9118de/report.md`; exact options, source fingerprints, timestamps, statuses, stage histograms, sampled server memory and cleanup evidence. Raw output is local/ignored.
- `output/queue-performance/4b24bf8c-7f28-4887-8139-eee203c0185e/queue-performance.json`: immutable browser metrics.
- `output/load-stress/82fd9007-8994-4573-b009-94eb9f9118de/unit.xml`, `output/load-stress/82fd9007-8994-4573-b009-94eb9f9118de/browser.xml`, `output/load-stress/82fd9007-8994-4573-b009-94eb9f9118de/coverage.log`, `output/load-stress/82fd9007-8994-4573-b009-94eb9f9118de/lint.log`, `output/load-stress/82fd9007-8994-4573-b009-94eb9f9118de/typecheck.log`, `output/load-stress/82fd9007-8994-4573-b009-94eb9f9118de/migrations.log`: snapshots copied after verification.
- `output/load-stress/d1a03ba3-9512-46ec-a1fa-d7e1afa8bff0/report.json` and `output/load-stress/deadlock-summary.jsonl`: pre-fix failure and sanitized lock graph.

Reproduction commands and corrected harness behavior: [document 71](71_Audit_E2E_Load_And_Stress_Verification_25_October_2026.md). Before declaring production readiness, repeat a longer open-arrival-rate run in representative staging with mixed actors/writes, multiple projects, larger retained datasets, SQL wait/CPU/IO monitoring and all server process memory. This run exercises three APIs and selected correctness boundaries; it does not certify every application workflow.
