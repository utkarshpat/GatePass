# Corrected E2E, load and stress verification — 25 October 2026

Is document ne pehle ke load-test conclusions supersede kiye hain. Purane report ka SSE saturation result invalid tha: saari subscriptions HTTP 400 thi. Static SVG throughput application API capacity nahi tha, aur load-generator heap se server memory leak ka conclusion nahi nikalta. `1,062 ms` lagbhag 1.06 seconds hai; ise subsecond nahi kehna chahiye.

Previously committed workflow, occupancy aur export-authority fixes ka scope [document 70](70_Priority_Bug_Fixes_25_October_2026.md) mein hai. Is pass mein harness ko correct kiya, actual load chalaya, aur local development bridge mein ek additional concurrency defect fix kiya. Production capacity ya application-wide clearance ka claim nahi hai.

## Harness corrections

- Non-200 responses, payload invariant failures, transport errors, SQL deadlocks aur latency-budget breaches run ko FAIL karte hain; command exit code 1 hota hai. Latency breach ke baad baaki safe benchmark phases collect hote hain, lekin final FAIL rehta hai. Correctness/transport failures fail fast hain.
- Failed requests ki actual elapsed latency record hoti hai. Requests mein complete-body deadline, aborted-response handling aur response-size bound hai. Nearest-rank percentiles use hote hain.
- Summary fixture ke current IST date ko include karte hue 31 inclusive days padhti hai. Invocation-owned 1,000 rows mein 800 approved aur 200 aged pending requests hain; queue aur Action Centre payload/count assertions empty-work shortcuts rok dete hain.
- Long runs mein directory fixtures five-minute freshness window se stale na hon, isliye benchmark/race/soak phases se pehle sirf invocation-owned synthetic employees, memberships aur projects refresh hote hain. Application freshness policy, real directory aur background fixtures change nahi hote. Refresh latency benchmark interval ke bahar hai.
- Same-visit aur mixed TEMP_ID/EMPLOYEE_PROJECT races independently require: 12 requests, exactly one HTTP 200, eleven HTTP 409, exactly one committed ENTRY, one occupant, successful EXIT aur zero remaining occupants.
- SSE requests valid subscription schema use karti hain aur ready frame receive karti hain. Per-session expected statuses `200,200,429` hain. Global capacity ke liye two sessions four streams kholti hain; third independently authorized session, jiska per-session budget unused hai, HTTP 429 receive karti hai. All streams close hone ka server-side assertion hai.
- Oversized request actual 64 KiB limit cross karti hai; literal own `__proto__` property otherwise valid payload ke saath bheji jaati hai. Malformed/unknown/type-invalid fields reject hote hain. In input checks ko blanket security clearance nahi kaha gaya hai.
- Server memory, CPU, event-loop aur per-RPC stage timings IPC se owned child process se collect hote hain. Post-GC samples aur explicit RSS growth budget hain. PowerShell workers aur SQL process memory is measurement mein include nahi hai; short soak se leak absence establish nahi hoti.
- Port preflight existing server ko reuse/terminate nahi karta. Setup, readiness, shutdown aur fixture cleanup ek outer lifecycle mein hain. Cleanup failure run fail karti hai. Every invocation ka unique artifact directory, git revision, dirty diff fingerprint, source hashes aur environment metadata hai. Credentials/cookies report mein persist nahi hote.

## Additional defect found and fixed

Pre-fix corrected run `d1a03ba3-9512-46ec-a1fa-d7e1afa8bff0` mein summary concurrency 8 par 100 requests mein 98 HTTP 200 aur 2 HTTP 503 mile. Diagnostic envelopes mein dono failures SQL 1205 the. Local `system_health` graphs ne `read permissions`, `ADD/DROP ROLE MEMBER`, `DROP USER` aur `SEC Cache Coherency` ka metadata-lock cycle confirm kiya.

Local bridge har RPC ke liye disposable execute-only SQL user create/alter/drop karta tha. `tools/GatePass.DevelopmentApiBridge.ps1` ab session-owned application gate use karta hai: principal DDL exclusive mode mein aur execute-only business calls shared mode mein chalte hain. Role setup transactional hai; REVERT aur connection disposal gate release karte hain. Business writes replay nahi hote aur runtime SQL permissions unchanged hain. Yeh local development adapter ka fix hai; production typed TDS adapter alag hai.

Post-fix diagnostic run `ae914450-01ba-43df-8fc6-018929346d4f` ne summary aur queue par concurrency 1/4/8/12 ke 800 requests mein zero HTTP errors observe kiye. Queue concurrency 12 ka p95 **5,243 ms** tha, isliye 5,000 ms guard ne run correctly FAIL kiya. Is run ko all-phases PASS nahi maana gaya hai. Coordination availability improve karti hai, lekin additional waiting create karti hai; development bridge throughput production capacity nahi hai.

Raw evidence workspace ke ignored output folder mein hai:

- `output/load-stress/d1a03ba3-9512-46ec-a1fa-d7e1afa8bff0/report.json`
- `output/load-stress/deadlock-summary.jsonl` (lock/procedure metadata only; SQL statements/session hashes omitted)
- `output/load-stress/ae914450-01ba-43df-8fc6-018929346d4f/report.json`

## Verification and measured bottlenecks

Final corrected run aur verification results [document 72](72_Corrected_Load_Stress_And_Bottleneck_Findings_25_October_2026.md) mein recorded hain. Raw JSON authoritative hai; generated Markdown reading convenience ke liye hai. Historical output overwrite karke fresh verification imply nahi ki gayi hai. Browser queue-performance test bhi ab run-owned search reference aur unique artifact path use karta hai, taaki background fixtures se false failures aur overwritten evidence avoid hon.

Intermediate long run `8f753444-e447-4733-a236-108b9a31442e` mein 1,200 timed API responses successful the, lekin subsequent mixed-employee race stale synthetic directory ke kaaran fail hui. Us run ka overall status **FAIL** hai; use complete verification PASS nahi maana gaya hai. Yeh failure owned-fixture refresh add karne ka regression trigger tha.

## Reproduce

Local dedicated `GatePass_DesignTest` database, 99 applied migrations, synthetic directory marker, Node 26.8 and PowerShell 7 required hain. Fixtures real sessions ya retained presentation records use nahi karti hain. Background records ke counts report mein visible hain; sirf invocation-owned rows modify/clean hoti hain.

```powershell
$env:GATEPASS_SHARP_PATH = "$HOME\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\sharp"
$env:GATEPASS_PWSH_PATH = "$HOME\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe"
$env:PATH = "$HOME\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell;$env:PATH"
npm.cmd test
npm.cmd run test:ci
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run check:migrations
npm.cmd run test:browser -- tests/browser/workspace-sse.spec.ts tests/browser/workspace-sse-live.spec.ts tests/browser/workspace-queue-performance.spec.ts tests/browser/summary-range-live.spec.ts
npm.cmd run test:load -- --requests 100 --soak-seconds 60
```

Default port `18449`, concurrency `1,4,8,12`, p95 guard `5,000 ms`, RSS growth guard `128 MiB` hain. Guard values local regression settings hain, approved business SLOs nahi. `--port`, `--requests`, `--concurrency`, `--soak-seconds`, `--max-p95-ms`, `--max-rss-growth-mb` overrides available hain; report exact selected settings save karti hai. Threshold badalna optimization evidence nahi hai.
