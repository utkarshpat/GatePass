# Final bug review, E2E aur load verification — 26 October 2026

Follow-up: first-burst worker lifecycle candidate ka implementation aur newer verification [report 78](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/docs/78_Development_Worker_Prewarm_And_Burst_Latency_26_October_2026.md>) mein hai. Neeche ke measurements is earlier audit ke historical records hain.

**Final status: PASS. Seven application bugs fixed; 37 SQL suites, 597 unit tests, 315 browser tests aur final load/stress verification pass.** Ek platform-specific unit case skip hai; browser skips zero hain. Base HEAD `4899a7cd7b054674425e539be19d5c57033c1eee`; tested changes working tree mein saved, uncommitted hain. Historical reports 71–76 aur failed artifacts preserve kiye gaye hain.

**Application findings aur implemented mitigations**

| # | Priority | Bug aur impact | Implemented mitigation |
|---|---|---|---|
| 1 | P1 | Excel workbook worker chalne ke dauran data ya permission change ho sakti thi; final validation worker ke pehle ho rahi thi. | Full-content aur authority validation ko workbook generation ke baad, download ke immediately pehle move kiya. Worker ke dauran mutation/revocation par download block hota hai; snapshot cancellation retained hai. |
| 2 | P2 | Searchable project catalogue ne local-project freshness rule lose kiya tha; valid locally created project stale dikh sakta tha. | Forward migration 108 uses `gp._ProjectCurrent`; actor aur materialized project scopes response se pehle recheck hote hain. Applied migrations edit nahi hui. |
| 3 | P2 | Empty guard queue aur Action Centre pages mein row-array property omit ho sakti thi. Strict API validation HTTP 503 deti thi, including empty All allocations. | Forward migration 109 explicitly emits `visitors: []` / `items: []`. Empty searches aur terminal pages par counts/paging preserve hote hain. SQL boundary par fix kiya; API validation strict hai. |
| 4 | P2 | Background catalogue refresh ka late success newer search overwrite kar sakta tha; late 403 newer authorized scope clear kar sakta tha. | Catalogue generation, query, office aur view capture karke har asynchronous response/error ko current state se fence kiya. |
| 5 | P2 | Complete project-metadata cache available hone par newly loaded project selection resolver se miss ho sakta tha; requested project office scope ban sakta tha. | `knownProjects()` complete metadata, loaded catalogue aur retained selection merge karta hai; selected project ID server scope request mein preserve hoti hai. |
| 6 | P2 | Office/scope change ke baad obsolete export ka late 401 current console ko redirect kar sakta tha. | Export requests attempt/version-bound current callbacks use karti hain; obsolete authorization responses current console ko affect nahi karti. |
| 7 | P2 | Search debounce se pehle Load more click karne par previous query ka cursor new query ke saath send ho sakta tha, matching projects skip ho sakte the. | Query change par append reset hota hai aur fresh first page request hoti hai. Existing bounded read coalescing retained hai. |

Code anchors: [admin console](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/src/app/admin.js:176>), [post-worker export validation](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/src/app/admin.js:609>), [migration 108](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/migrations/108_searchable_catalogue_local_project_freshness.sql:1>), [migration 109](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/migrations/109_empty_workspace_queue_arrays.sql:1>).

Regression coverage: [catalogue/media/browser cases](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/tests/browser/performance-second-pass.spec.ts:18>), [export consistency cases](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/tests/browser/register-export-consistency.spec.ts:1>), [SQL read/empty-result cases](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/tests/Test-ReadOptimization.ps1:81>).

**Complete verification**

- Fresh random disposable SQL Express database par migrations 001–109 replay: PASS; disabled/untrusted foreign keys/checks zero, seeded users zero. Constraint scenarios aur notification worker ke 39 cases pass; owned database drop verified.
- Latest schema par all 37 `Test-*.ps1` SQL suites: PASS. Read-optimization suite ke 49 cases pass, including seven new explicit empty-array/terminal-page cases. Immutable baseline ke known missing-empty-array defect ko separately assert karke normalize kiya; remaining fields, row ordering aur denials exact compare hote hain.
- Sequential complete unit/coverage run: 597 pass, 1 platform-specific skip, zero failures. Coverage 97.20% lines, 89.64% branches, 93.68% functions. Non-Windows bootstrap-rejection case Windows par intentionally skip hai; Linux CI case alag hai.
- Typecheck, lint, 109 canonical migration hashes: PASS. Release source artifact: 228 allowlisted files; `deploymentReady: false` metadata preserved.
- Dependency audit: zero reported vulnerabilities. Git-history secret scan: 37 commits, zero findings; iska scope Git history tha.
- Full final browser run: **315/315 PASS, zero failures, zero skips**, 10.9 minutes. Retained presentation case explicitly enabled tha; retries zero aur Chromium worker count one tha. Real SQL flows aur intercepted failure/race scenarios dono included hain. Desktop/mobile layouts, accessibility, intake, staff setup, guard/reception movements, scopes, image handling, exports, SSE aur recovery covered hain.

**Initial failures aur harness corrections**

Initial SQL sweep: 29 pass / 8 fail. Existing demo sessions ko seed zero-session assumption se reject kar raha tha; host eligibility test explicit project-office assignments miss kar raha tha; older guard/read suites shared fixture ke newer capabilities/common assignments ko account nahi kar rahi thi. Printing assertion unrelated history count kar rahi thi; manual-intake test first-project ordering assume kar raha tha. Setup/assertions ko invocation-owned state aur current policy ke saath align kiya. Notification tests nayi private empty queue par chale, existing outbox par nahi.

Initial full browser sweep: 308 pass / 6 fail / 1 opt-in skip. Email-layout fixture ki fixed booking dates real clock ke saath expire ho gayi thi; render fixture ko matching injected clock di. Combined-view regression ne coalesced read ko release karne se pehle latest response expect ki; latest scope aur denial assertions preserve karke ordering correct ki. Thumbnail test refresh ke initial empty DOM ko completed denial samajh raha tha; ab actual denial aur completed refresh ka wait karta hai. Ek onboarding test mein ~16-minute wall-clock interruption aur session expiry observe hui; uninterrupted rerun ke liye temporary test-process awake request use hui, persistent power settings change nahi hui. Live queue 503 separately reproduce hua aur migration 109 mein actual application defect fix hua.

Ek parallel unit/SQL attempt mein production-startup safety test 30-second timeout hit hua (596 pass / 1 fail / 1 skip). Timeout/assertion unchanged hain. Isolated test 1.48s mein pass hua aur final sequential full coverage run clean pass hua. Failed run logs ko successful logs se overwrite nahi kiya gaya.

**Final latency, speed, load aur stress**

Final run **PASS**, ID `e45c45a7-cf60-41ac-9a75-66c2818315f4`: **31 checks**, four APIs × five concurrency points × 200 samples = **4,000 benchmark responses**, zero unexpected responses. Default development RPC workers **4** hain. Fixture 1,000 owned rows (200 pending / 800 approved), office total 2,110 aur database total 2,111 tha; schema 109, SQL Express 17.0.1145.4. Existing p95 5,000ms aur RSS-growth 128 MiB guards unchanged hain; ye local test guards hain, approved production SLOs nahi.

| API | c1 p95 ms | c4 p95 ms | c8 p95 ms | c12 p95 ms | c16 p95 ms |
|---|---:|---:|---:|---:|---:|
| Summary | 31.6 | 50.5 | 59.6 | 214.1 | 161.1 |
| Guard queue | 77.7 | 95.0 | 215.4 | 215.9 | 313.1 |
| Action Centre | 40.1 | 66.6 | 85.2 | 116.0 | 161.5 |
| Reception | 54.0 | 110.1 | 186.3 | 242.0 | 312.1 |

Historical pre-optimization c12 reference Summary 1.83s / Guard 5.58s / Action Centre 5.22s tha. Current samples 200 per cell hain; historical runs ke sample counts alag the. Is comparison ko controlled isolated A/B attribution nahi maana gaya. Summary ka c12/c16 non-monotonic result bhi single-batch variability show karta hai.

**Tail latency disclose ki gayi hai:** c4 p99 Summary **1,274ms**, Guard **1,108ms**, Action Centre **1,190ms**, Reception **1,147ms** tha. Isliye saare requests sub-320ms claim nahi hain. Sequential warm-up se saare four helpers prewarmed nahi hote; extra helpers on demand start hote hain aur 5 seconds idle par retire hote hain. First-burst tail is lifecycle se consistent hai; exact causal contribution ke liye controlled warm-vs-cold A/B baaki hai. 200 samples ka p99 descriptive hai, reliable production tail estimate nahi.

Forty sequential execute-only direct SQL samples per measured RPC: Summary **13.89ms mean**, Guard **46.60ms**, Action Centre **28.26ms**. Same reused SQL connection; principal setup excluded. Ye HTTP percentiles nahi hain; Reception direct-SQL comparison is phase mein collect nahi hua.

Eleven authenticated readers + **100 ordered movement writes**: 889 reads, read p95 **224.7ms**, write p95 **167.8ms**, zero unexpected errors, 50 committed entries / 50 exits, final inside zero. Separate one-export-lane + ten-reader pressure phase: 852 read/export operations, **100 movements**, write p95 **129.8ms**. Eight snapshots create/cancel hue; seven expected final HTTP 409 invalidations retained hain (changed data download nahi hua). Last in-progress export cancelled hua; workload ke dauran zero exports completed hona expected hai. Stable successful export full browser suite aur 10k comparison mein separately verify hua. Dono movement phases alag workloads hain; write-p95 difference ko isolated export-overhead subtraction nahi maana gaya.

Visitor credential race aur mixed employee credential race: har race mein exactly one committed entry; cleanup ke baad inside zero. Per-session/global SSE limits, stream cleanup aur malformed/actual oversized-body rejection pass. Instrumented business RPCs mein SQL 1205 deadlocks **zero** observe hue.

Configured **180-second authenticated soak**, three windows: **4,704 + 4,752 + 4,692 = 14,148 requests**. Four post-GC Node-child samples; RSS delta **−8.97 MiB**, cleanup errors zero. Is observation se memory-leak absence establish nahi hoti; PowerShell aur SQL memory alag hai.

Fresh **10,000-row export comparison PASS**, ID `0d04fafc-3582-44ad-b383-5dcf60a13729`: legacy **46,827.8ms / 50 calls**, snapshot + mandatory final full validation **12,399.1ms / 51 calls** — **73.5% lower elapsed time / 3.78× faster**. Same 10,000 unique rows aur full dataset fingerprint; snapshot JSON **17,473,366 bytes**. Fixture cleanup **16,738.7ms** mein complete hua. One sequential observation per mode, legacy first; SQL/client loop mein PowerShell JSON processing included hai, HTTP/workbook generation excluded hain. Ye 10k end-to-end browser p95 nahi hai.

Final browser 26-column/10k-row workbook-generation probe: **1,020.4ms**, **98 UI heartbeat ticks**, compressed output **1,012,885 bytes**. Worker responsive raha; row collection se pehle wala phase is timing mein included nahi hai. ZIP/deflate/CRC/UTF-8 checks independent unit cases mein pass hain. SQL export timing aur workbook timing separate observations hain; unhe add karke end-to-end latency claim nahi ki gayi.

**Remaining performance candidates**

1. **First-burst tail:** extra helpers ka 5-second idle retirement / lazy startup evaluate karein. Bounded pool prewarming ya longer burst-idle lifetime ko process memory aur cleanup ke saath A/B test karna chahiye. Current default four unchanged hai; fresh six-worker comparison is final run mein nahi kiya gaya.
2. **Queueing under higher concurrency:** c16 Guard mean worker-queue wait **196.3ms**, mean RPC **68.9ms**; Reception **187.4ms queue / 66.0ms RPC**. Reception throughput c8/c12/c16 lagbhag **60 RPS** par plateau hua, jabki tail grow hui. Ye measured local adapter queueing hai; additional workers ko automatically faster assume nahi kiya gaya. Stage percentiles additive nahi hain aur SQL-command elapsed SQL CPU measurement nahi hai.
3. **Large exports:** 10k SQL/client loop ab bhi **12.4s** hai. Agar lower end-to-end target chahiye, collection/serialization/full-hash costs separately profile karke bounded background-export/read-model options evaluate karein. Current scope rechecks, full-content validation, row/storage caps aur cancellation preserve hone chahiye.

**Evidence aur scope**

Raw verification folder: [final verification artifacts](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/output/final-verification>). Schema replay aur every SQL-suite log retained hain; initial SQL/browser failures aur parallel-unit failure alag artifacts mein preserve hain. Screenshots retained synthetic demo data ki hain.

Primary artifacts: [full browser JUnit](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/output/final-verification/browser-full-final.xml>), [final SQL results](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/output/final-verification/sql-results.json>), [fresh schema replay](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/output/final-verification/schema-replay.json>), [final load JSON](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/output/load-stress/e45c45a7-cf60-41ac-9a75-66c2818315f4/report.json>), [10k export comparison](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/output/export-performance/0d04fafc-3582-44ad-b383-5dcf60a13729/report.json>), [browser workbook probe](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/output/performance-second-pass/4daf09bc-d68b-471d-9edf-3b9b789217c0/workbook.json>), [read-only database cleanup proof](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/output/final-verification/database-final.json>).

Cleanup proof, regular app restart se pehle: owned load/profile fixtures ke users/visits zero, export snapshots zero, leased/diagnostic SQL principals zero, temporary baseline procedures zero, mixed occupancy conflicts zero. **26 retained presentation visits aur 13 preexisting development principals preserve hue.** Full test output aur failed-run artifacts ko historical records ke roop mein rakha gaya hai.

Final load artifact ke **40/40 runtime/harness source fingerprints** saved source se match verify hue. Working-tree file hashes aur consolidated results [final summary](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/output/final-verification/final-summary.json>) mein hain. Normal app official `npm.cmd run dev` launcher se fresh start hui; [app smoke](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/output/final-verification/app-smoke.json>) root HTTP **200** aur unauthenticated protected guard route **303** redirect verify karta hai. App port **8443** par running hai.

Reproduction: required local Node 26 / PowerShell / Sharp runtime environment configure karke `npm.cmd run test:ci`, `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run check:migrations`; full browser ke liye retained local demo available ho tab `GATEPASS_RETAIN_DEMO=true` ke saath `npm.cmd run test:browser`. Load invocation: `node tools/run-load-stress-test.ts --requests 200 --concurrency 1,4,8,12,16 --soak-seconds 180 --workers 4`. Complete SQL/fresh-schema runner aur temporary awake wrapper final verification artifact folder mein saved hain. Notification-worker default guard intentionally unrelated pending outbox par test refuse karta hai.

Ye local Windows / SQL Express / dummy identity composition ka verification hai. External production SSO/directory/mail, physical printer, staging restore/deployment aur production capacity is run se certify nahi hote. Load diagnostics API Node child cover karti hain; PowerShell/SQL process memory separate hai. Short soak se memory-leak absence establish nahi hoti. Low-sample p99 production tail estimate nahi hai.
