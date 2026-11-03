> Documentation status: historical implementation/design/evidence record, indexed 3 November 2026. Read the [current handbook](system/README.md) and [Visit owner/Host glossary](109_Visit_Owner_and_Host_Terminology_03_November_2026.md) for current behavior. Counts, setup examples and screenshots below describe their dated stage, not a fresh certification.

# External source audit validation aur acceptance — 26 October 2026

**Decision: teen implemented findings valid; targeted fixes accepted with refinements. Final verification PASS.** Supplied report ka limited source-audit scope accept hai; isse full application ya production certification nahi maana gaya. Input documents ki suggested commands ko task authorization nahi maana; reviewed changes current working tree mein merge hue, existing work reset/replace nahi hua. Commit/push nahi kiya gaya.

**Inputs aur archive integrity**

- User report: `C:/Users/utpatel/Downloads/GatePass_Source_Audit_Report.md`, 7,759 bytes, SHA-256 `e069751087056540362e00da7542303f2aa7be097692b5ead58be0ac7374eda6`.
- ZIP: `C:/Users/utpatel/Downloads/GatePass_Targeted_Fixes_only.zip`, 20,251 bytes, SHA-256 `03c1fa1289bd288a80580ac389e25724dfcf1e9410ba938e5472fcc4f901762`.
- Nine entries: seven source/test files, `AUDIT_REPORT.md` aur patch. Exact allowlist, duplicate-name rejection, per-entry size bound aur resolved path containment check ke baad invocation-owned staging folder mein extract kiya. Koi executable/script installer included nahi tha. Embedded report aur separate report byte-identical hain.
- Current saved source par `git apply --check` PASS. Patch apply karne ke turant baad all seven outputs ZIP copies se canonical LF text par exactly match hue. Original inputs/staging copies preserved hain; accepted refinements baad mein separately add hue.
- Base HEAD `4899a7cd7b054674425e539be19d5c57033c1eee`; incoming patch current prewarm code se match karti thi. Current dependencies already installed the; report ka suggested `npm ci` unnecessarily run nahi kiya.

**Findings independently verified**

| Finding | Before reproduction | ZIP fix result | Acceptance |
|---|---|---|---|
| F-01: wake-all worker queue | One worker / 40 calls: 39 initial wait timers; one completion par **38 redundant timers rearm** hue. | Same workload mein redundant rearming **zero**. | Accepted: normal capacity release par oldest queued waiter wake hota hai; shutdown par all queued callers wake/reject. Four-worker default, 64 waiting-call cap, deadlines aur no-replay behavior preserved. |
| F-02: malformed SQL calendar | `2026-99-99` typed date parameter ne **RangeError / Invalid time value** throw kiya. | Existing stable **INVALID_SQL_PARAMETER** error return hui; driver execute nahi hua. | Accepted, with SQL-year-range refinement described below. Yeh validation/error-contract defect hai; SQL injection ya confirmed authorization bypass claim nahi hai. |
| F-03: stale diagnostic latency samples | 10k fast + 10k slow RPCs ke baad p95 **10ms** raha: latest degradation omitted thi. | Rolling last-10k p95 **1,000ms** hua. | Accepted: bounded ring per metric. Counts/errors poore reset window ke hain; latency summaries latest valid 10k samples ki hain. |

ZIP ki exact provided regression suite **23/23 pass** hui on repository Node **26.8.2**. Auditor ke Node 22 environment ki broader 58-case run/311-entry original `src.zip` ko independently recreate nahi kiya, kyunki original archive/exact broader test selection supplied nahi tha. Is repository ka larger actual verification neeche separately recorded hai.

**Acceptance refinements**

1. Incoming date helper `0000-01-01` aur corresponding timestamp ko valid bol raha tha. SQL `date`/`datetime2` supported year range 0001–9999 hai. Year zero ab reject hota hai. Leap-day, invalid month/day/time, canonical UTC format, non-string values, null forwarding aur 0001/9999 boundaries ke helper + actual `SqlProcedureClient` binding-boundary tests add hue. Malformed values binding/execute se pehle stable error deti hain. Client tests installed driver types use karte hain, controlled pool double ke saath; ye real production TDS connection test nahi hai.
2. Incoming FIFO regression promise/output ordering check karti thi, dispatched `Sequence` parameter assert nahi karti thi. Actual dispatch order assertion add hui; extra tests normal completion par zero unrelated timer rearming, multiple available slots, crashed-helper queue advancement, 64-waiter cap aur all-caller shutdown rejection verify karte hain.
3. Rolling cursor ko modulo 10k bounded rakha. Independent sparse-metric wrapping, full-window error counts aur reset behavior test hue. Diagnostic snapshot mein explicit `latencySamplePolicy` add hui: `rolling`, maximum 10,000 per metric. Harness limitation text aur new source-helper fingerprint add hua. HTTP batch percentiles ka algorithm/sample set unchanged hai; RPC stage histogram semantics ab explicitly labeled hain. Earlier artifacts historical first-10k semantics retain karte hain.

Accepted code: [worker queue](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/src/development/LocalDevelopmentApiClient.ts>), [date helpers](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/src/transport/SqlDateValidation.ts>), [typed SQL boundary](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/src/transport/SqlProcedureClient.ts>), [rolling telemetry](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/src/development/LoadDiagnostics.ts>).

**Report ke remaining risk claims**

- Guard c16 p95 521.6ms aur mixed-write p95 233.8ms references earlier actual report-78 run se match karte hain. Ye measured follow-up candidates hain; source-only report ne isolated SQL/transport cause establish nahi kiya. Wake-one change ko automatically confirmed HTTP speedup nahi maana gaya.
- Public registration global four-active-request admission cap real hai. Repository ke full runtime mein both local/production HTTP request timeout **15 seconds**, header timeout **10 seconds**, JSON-body bound **64 KiB** configured hain. Source-only report ko outer runtime available nahi tha. Slow-request robustness/legitimate-burst capacity concern conditional risk hai; verified remote DoS exploit claim nahi. Cap/permissions is patch mein raise nahi hue.
- “Unbounded historical reception loop” wording overstates current UI: inputs current date −30 through +90 days inherit karte hain, so UI range at most **121 inclusive days** hai. Serial per-day/page round-trips aur potentially many rendered rows ka performance concern valid hai. Is patch mein history contract/UI rewrite nahi hui.
- Cross-location host approval, guard movement authorization aur production pool isolation integration-dependent areas hain. Report ne actual exploit demonstrate nahi kiya. Existing SQL authority checks bypass/relax nahi hue; real SQL lease/isolation aur full browser flows separately rerun hue.

**Verification**

- Exact incoming three-file test selection: **23 passed**, zero failures.
- Expanded focused suite before final queue-cap addition: **53 passed**, zero failures; full unit run includes the additional cap/shutdown case.
- Full unit/coverage: **617 passed, one platform-specific skip, zero failures**; **97.23% lines / 89.71% branches / 93.93% functions**. Coverage gates pass.
- Real SQL lease integration: **two cases pass**: identity reuse, separate roles, denied direct reads, worker crash, prewarm without SQL principal/business call, fresh actor denial aur EOF cleanup.
- Live SQL read-only calendar-boundary probe: **eight cases pass**. SQL `date` aur `datetime2(3)` dono year 0000 / malformed month reject karte hain aur 0001/9999 accept karte hain. Typed Node client binding checks separately controlled pool-double tests hain; live TDS client integration claim nahi hai.
- Typecheck, lint, 109 canonical migration hashes: PASS. Source release **229** allowlisted files; new production date helper included, development runtime excluded, deploymentReady false.
- Full Chromium browser rerun: **315/315 pass**, zero failures/skips/retries, 11.5 minutes.
- Browser run mein ek `DUMMY_DIRECTORY_REFRESH_FAILED` background warning observe hui. Subsequent read-only SQL probe mein all 24 development employees ki freshness age **5 seconds** thi, recovery verified. Exact transient cause suppressed bridge output se establish nahi hota; unchanged separate SSO worker path hai. Warning/probe raw artifacts preserved hain; zero test failures ko zero process warnings claim nahi maana gaya.
- Fresh local HTTP load/stress rerun: **PASS**, run `78ee990f-8bce-417b-a296-b983ee02a716`, 31 phases, 4,000 benchmark requests, 180-second soak 9,708 requests. Zero unexpected benchmark responses / observed instrumented SQL deadlocks / cleanup errors.

Database migrations is acceptance mein change nahi hui. Earlier 37-suite/fresh-schema result report 77 ka historical verification hai; current change ke liye real SQL lease cases separately rerun hain. Production SSO/directory/mail/printer integration certification is acceptance mein nahi hui.

**Fresh load/stress**

Run `78ee990f-8bce-417b-a296-b983ee02a716`: 200 samples/API/concurrency, default four workers, c1/c4/c8/c12/c16; fixture 1000 owned / 2110 office / 2111 database rows, schema 109. HTTP p95 milliseconds:

| API | c1 | c4 | c8 | c12 | c16 |
|---|---:|---:|---:|---:|---:|
| Summary | 53.3 | 54.7 | 75.3 | 81.8 | 160.5 |
| Guard queue | 94.1 | 262.9 | 509.1 | 247.6 | 243.4 |
| Action Centre | 41.4 | 39.8 | 105.5 | 178.7 | 107.1 |
| Reception | 53.0 | 65.3 | 128.5 | 173.6 | 236.2 |

Ordinary mixed readers + **100 ordered writes**: 862 reads, write p95 **98.9ms**; separate export-pressure phase **100 writes**, 864 read/export operations, write p95 **136.1ms**. Export phase ke 7 HTTP 409 content invalidations expected aur retained hain; 8 snapshots create / 8 cancel hue. Mutating export-pressure workload mein completed exports 0; stable success browser suite separately validates. Race/movement cases exactly one committed entry per race aur final inside zero verify karte hain. Dono mixed phases alag workloads hain; isolated export-overhead subtraction nahi hai.

Configured 180-second soak: **9,708 requests**, 4 post-GC Node-child samples, RSS delta **-2.8 MiB**. Child memory PowerShell/SQL ko include nahi karti; short soak leak absence establish nahi karta. RPC diagnostic samples rolling-last-10k labeled hain, HTTP batch p95 all batch responses par hai. Is run se wake-one ka isolated HTTP speedup establish nahi hota; directly measured coordination improvement zero redundant rearming hai.

**Soak variability disclosed:** three windows mein **3,984 / 4,440 / 1,284** requests hue. Last window mein throughput lower aur Guard SQL-command elapsed p95 **539.2ms** tha; worker-queue p95 **0.0085ms** negligible tha, Node event-loop p95 **32.1ms** raha. SQL-command elapsed ko SQL CPU ya specific lock-wait cause nahi maana gaya; exact contention/root cause is acceptance mein establish nahi hua. Local guards pass hue, lekin steady-throughput stability remaining performance candidate hai. Load child log mein directory-refresh warnings zero thi; browser ki one recovered warning separately recorded hai.

**Concurrent local process limitation:** final inspection mein normal port8443 app ka startup time **03:14:13 IST** tha; diagnostic load run **03:14:52–03:20:22 IST** chala. Isliye same local SQL instance par normal app/background directory refresh bhi active tha. Load target alag owned server aur four-worker pool tha, lekin ye host-isolated benchmark nahi tha. Normal app ko finish par kill/restart nahi kiya: affected source files uske startup se pehle save hui thi, freshness/smoke verify karke reuse kiya. Is concurrent activity ko observed SQL-time variation ka proven cause nahi maana gaya.

All **41 runtime/harness source hashes** saved source se match verify hue. Cleanup proof: owned load/probe users/visits, snapshots, leased/diagnostic principals, temporary baseline procedures aur mixed occupancy conflicts zero. **26 retained presentation visits aur 13 preexisting development principals preserve hain.** Port8443 ka existing official-launcher app process saare affected source edits ke baad start hua tha; current-source app reuse karke root200 / unauthenticated guard303 smoke PASS verify hua.

Artifacts: [full browser JUnit](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/output/source-audit-validation/6bf21dd8a471467b8c7251ee426c000c/browser.xml>), [unit coverage log](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/output/source-audit-validation/6bf21dd8a471467b8c7251ee426c000c/unit.log>), [real SQL lease integration](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/output/source-audit-validation/6bf21dd8a471467b8c7251ee426c000c/sql-leases.log>), [live SQL date boundaries](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/output/source-audit-validation/6bf21dd8a471467b8c7251ee426c000c/sql-date-boundaries.json>), [fresh HTTP load JSON](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/output/load-stress/78ee990f-8bce-417b-a296-b983ee02a716/report.json>), [database cleanup proof](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/output/source-audit-validation/6bf21dd8a471467b8c7251ee426c000c/database.json>), [app smoke](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/output/source-audit-validation/6bf21dd8a471467b8c7251ee426c000c/app-smoke.json>), [consolidated acceptance result](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/output/source-audit-validation/6bf21dd8a471467b8c7251ee426c000c/summary.json>).

Current changes local/uncommitted hain. External report ka limited-scope caveat retained hai; baaki risks ko independent confirmed vulnerabilities ya resolved bottlenecks label nahi kiya gaya.

**Evidence**

Input manifest, original archive outputs, before/after source reproduction, exact ZIP test result, accepted-code test logs aur upcoming browser/load artifacts [validation folder](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/output/source-audit-validation/6bf21dd8a471467b8c7251ee426c000c>) mein preserve hain. Inputs Downloads mein unchanged hain. Before-source backups aur exact incoming files separately saved hain. Earlier [worker report 78](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/docs/78_Development_Worker_Prewarm_And_Burst_Latency_26_October_2026.md>) aur [full audit 77](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/docs/77_Final_Bug_Review_E2E_And_Load_Verification_26_October_2026.md>) historical records hain.
