# Development worker prewarm aur burst latency — 26 October 2026

Follow-up: external source-audit validation aur accepted queue/date/telemetry fixes [report 79](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/docs/79_External_Source_Audit_Validation_And_Acceptance_26_October_2026.md>) mein recorded hain. Neeche ke source fingerprints/measurements is earlier prewarm run ke historical evidence hain.

**Final status: PASS — implemented, controlled comparison, full unit/browser suites aur HTTP load/stress verified.** Ye report previous audit ke first-burst latency candidate ko implement karti hai. Default capacity four helpers hi hai; production typed SQL client is change ka scope nahi hai.

**Implemented behavior**

- Local HTTP server `client.warmUp()` await karke configured helpers ki readiness acknowledge hone ke baad listen karta hai. Default four, existing allowed range 1–8 unchanged hai.
- Private stdio readiness control PowerShell/provider load karta hai. Koi SQL connection/principal, business stored procedure, session cache ya authorization cache create nahi hoti.
- Prewarmed server healthy helpers ko server lifetime tak retain karta hai. Five-second burst retirement se normal idle pauses ke baad process churn eliminate hua. Ad-hoc CLI clients ka existing lazy/idle behavior preserve hai.
- Startup failure par partial pool close hota hai; waiting calls reject hoti hain. Startup/request deadlines, queue capacity, SQL role isolation, exact procedure allowlist aur graceful EOF/fallback cleanup preserve hain. Uncertain business writes replay nahi hote. Crashed helpers ki existing on-demand recovery retained hai.

Source: [development client](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/src/development/LocalDevelopmentApiClient.ts>), [private bridge](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/tools/GatePass.DevelopmentApiBridge.ps1>), [HTTP startup](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/tools/start-dummy-sso.ts>).

**Controlled cold-vs-prewarmed comparison: PASS**

Run `b4de2bf7-bf9e-4581-bf7e-7b0f4b637df4`, 1,000 owned rows, schema 109. Same adapter/bridge/procedures aur identical response hashes, current timestamp field excluded. Har API/mode mein one serial SQL warm read, phir two four-request concurrent bursts; repeated burst ke pehle 6.5-second idle gap. API order mein mode order alternate kiya. Neeche four-request burst ke **maximum** milliseconds hain; ye population p99 nahi hai.

| API | Lazy first burst max | Prewarmed first burst max | Lazy after idle max | Prewarmed after idle max |
|---|---:|---:|---:|---:|
| Summary | 1,250 | 356 | 1,262 | 107 |
| Guard queue | 1,249 | 441 | 1,474 | 150 |
| Action Centre | 1,247 | 392 | 1,367 | 99 |
| Reception | 1,291 | 498 | 1,408 | 683 |

Lazy mode mein har API ke two bursts ke dauran seven helpers spawn hue, idle par one helper bacha. Prewarmed mode mein four helpers spawn hue aur idle par same four alive rahe. Pool prewarm cost **1.06–1.17s** startup mein record hui, HTTP readiness se pehle. SQL role connections ab bhi first authorized call par initialize hoti hain; all first-use costs zero hone ka claim nahi hai. Reception mein residual latency variation visible hai.

Helper memory tradeoff: lazy idle private memory **51.3–51.9 MiB total**, prewarmed **174.1–181.6 MiB total**; roughly **123–130 MiB additional private memory**. Summed working set ~119–121 MiB vs ~454–463 MiB tha; shared pages sum mein repeat count ho sakti hain, isliye working-set difference ko incremental physical RAM estimate nahi maana gaya. SQL Server aur parent Node memory alag hain. One idle observation memory-leak conclusion nahi hai.

Initial probe `7db555d8-7eea-4d74-a517-f1dd49805914` fixture-count assumption par FAIL retained hai: authorized Digital IDs ki wajah se queue total 1,023 tha, sirf 1,000 fixture rows nahi. Corrected probe same content fingerprint aur at-least-owned-row count validate karta hai. Application scope checks change nahi hue; both runs ka owned cleanup complete hua.

Tool aur artifact: [matched-burst profiler](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/tools/profile-worker-bursts.ts>), [raw comparison](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/output/worker-bursts/b4de2bf7-bf9e-4581-bf7e-7b0f4b637df4/report.json>).

**Verification**

- Full unit/coverage: **607 pass, one platform-specific skip, zero failures**. Coverage **97.21% lines / 89.66% branches / 93.82% functions**.
- Nineteen lifecycle cases pass: every helper readiness, bounded capacity, long idle reuse, startup/timeout/close failure, partial spawn failure, no observer/business event on warmup, post-wait dummy-mode recheck, no write replay aur existing lazy retirement.
- Real SQL lease integration: **two cases pass**. Existing identity reuse/role isolation/crash/EOF checks plus prewarmed two-helper case: readiness ke baad zero SQL principals, authorized reads work, invalid actor session reject, direct table access denied aur EOF par principals zero.
- Typecheck, lint, 109 migration hashes aur 228-file source release packaging pass. Database migrations unchanged hain. Previous 37-suite SQL/fresh-schema result report 77 ka historical evidence hai; is focused change mein lease integration separately rerun hui.
- Full Chromium rerun: **315/315 pass, zero failures/skips**, 13.6 minutes, zero retries. Real SQL workflows, auth boundaries, worker exports, media, live SSE aur recovery cases included hain. Total suite runtime browser/API speed benchmark nahi hai.
- Fresh HTTP load/stress run **PASS**, `db276ead-89f1-45e0-96ae-0d4dbf20ade8`: 31 checks, 4,000 benchmark responses, zero unexpected responses, zero instrumented SQL deadlocks aur cleanup errors zero.

**Final HTTP p95/p99 aur stress**

Final run `db276ead-89f1-45e0-96ae-0d4dbf20ade8`: same **200 samples/cell, four workers, concurrency 1/4/8/12/16 aur 180-second soak**. Latest fixture 1000 owned / 2110 office / 2111 database rows; schema 109. HTTP p95 milliseconds:

| API | c1 | c4 | c8 | c12 | c16 |
|---|---:|---:|---:|---:|---:|
| Summary | 24.4 | 41.4 | 57.0 | 80.0 | 94.5 |
| Guard queue | 65.8 | 93.8 | 144.2 | 229.1 | 521.6 |
| Action Centre | 38.8 | 50.2 | 77.6 | 130.9 | 159.3 |
| Reception | 72.2 | 73.5 | 125.9 | 183.3 | 234.4 |

First concurrent expansion, **c4 HTTP sample p99**, previous report-77 run versus this run (milliseconds):

| API | Previous p99 | Prewarmed p99 | Prewarmed maximum |
|---|---:|---:|---:|
| Summary | 1274.0 | 395.3 | 402.8 |
| Guard queue | 1107.5 | 107.7 | 112.4 |
| Action Centre | 1189.7 | 55.1 | 55.4 |
| Reception | 1146.5 | 85.3 | 100.4 |

Same configured workload ka historical comparison hai, randomized controlled HTTP A/B nahi; 200 samples/cell ka p99 descriptive hai. Matched real-SQL probe independent evidence deta hai ki idle retirement se helper restart hota tha aur prewarmed mode mein same four workers reuse hue. Har API/concurrency improve hone ka claim nahi: **Guard c16 p95 313.1→521.6ms**, c12 215.9→229.1ms; ordinary mixed-write p95 167.8→233.8ms. Single-run variability/SQL-worker queueing ko prewarming ke isolated causal effect ke roop mein attribute nahi kiya gaya. Performance acceptance current unchanged local guards ke against pass hui; default worker cap raise nahi hua.

Mixed eleven readers + 100 ordered movements: **892 reads**, read p95 **434.0ms**, write p95 **233.8ms**, unexpected errors zero; 50 committed entries / 50 exits, final inside zero. Separate export lane + ten readers + 100 writes: **856 read/export operations**, write p95 **126.4ms**, 8 snapshots create, 8 expected HTTP 409 content invalidations, 8 explicit cancellations. Is intentionally mutating workload mein completed exports 0; stable successful download full browser run mein separately verified hai. Dono movement phases alag workloads hain; isolated export-overhead subtraction nahi ki gayi.

Race checks exactly one committed entry per race aur final inside zero verify karte hain. SSE per-session/global limits, malformed/oversized body rejection aur stream cleanup pass. Configured 180-second soak **13,728 requests**, 4 post-GC Node-child samples, RSS delta **-10.1 MiB**. Child memory separate hai; helper memory tradeoff upar collect hua. Short soak leak absence establish nahi karta.

All **40 load source hashes** aur **5 matched-probe source hashes** saved source se match hain. Normal app restart se pehle owned load/probe fixture users/visits, export snapshots, temporary leased/diagnostic principals, baseline procedures aur mixed occupancy conflicts zero verify hue. **26 retained demo visits aur 13 preexisting principals preserve hain.** App official launcher se fresh restart hui: port 8443 root HTTP 200 / unauthenticated guard 303 redirect.

Artifacts: [HTTP load JSON](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/output/load-stress/db276ead-89f1-45e0-96ae-0d4dbf20ade8/report.json>), [browser JUnit](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/output/worker-prewarm/browser.xml>), [unit/coverage log](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/output/worker-prewarm/unit.log>), [real SQL lease log](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/output/worker-prewarm/sql-leases.log>), [database cleanup proof](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/output/worker-prewarm/database.json>), [app smoke](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/output/worker-prewarm/app-smoke.json>), [consolidated result](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/output/worker-prewarm/summary.json>). Earlier FAIL probe, historical audit/load results aur current results alag artifacts mein preserved hain.

Remaining limits: cold SQL role initialization aur unexpected crashed-helper replacement ka first request ab bhi warm nahi hota; pool readiness provider/process startup cover karti hai. Guard high-concurrency queueing aur large-export collection costs previous candidates bane hue hain. Is change ne startup cost readiness se pehle move ki aur warm helpers ko retain kiya; production SQL pooling change nahi hui.

**Reproduction aur scope**

Required local Node 26 / PowerShell / Sharp runtime environment mein `node tools/profile-worker-bursts.ts`; complete unit coverage ke liye `npm.cmd run test:ci`, aur existing retained demo available ho tab `GATEPASS_RETAIN_DEMO=true` ke saath `npm.cmd run test:browser`. Full HTTP run: `node tools/run-load-stress-test.ts --requests 200 --concurrency 1,4,8,12,16 --soak-seconds 180 --workers 4`.

Ye local Windows / PowerShell / SQL Express development composition ka result hai. Controlled small bursts full HTTP p99 nahi hain; full load sample p99 bhi descriptive hai. Startup prewarming time aur extra resident helper memory ko request-latency gain ke saath assess karein. External production capacity/SSO/mail/printer certification is change mein nahi hui.
