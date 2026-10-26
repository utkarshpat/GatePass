# External source audit acceptance — 26 October 2026

**Accepted with refinements:** provided report ke three core findings independently reproduced hue aur ZIP fixes merge/verify hui. Input report SHA-256 `e069751087056540362e00da7542303f2aa7be097692b5ead58be0ac7374eda6`; ZIP `03c1fa1289bd288a80580ac389e25724dfcfe1e9410ba938e5472fcc4f901762`. Embedded report exact match; git-apply check pass aur all seven incoming outputs canonical source copies se match hue. Original inputs preserved hain. Base HEAD `4899a7cd7b054674425e539be19d5c57033c1eee`; work local/uncommitted hai.

F-01 wake-all amplification: 40 callers/one worker mein one completion par 38 redundant queue timer rearms → zero. FIFO dispatch, 64-waiter cap, worker crash aur all-caller shutdown tests pass. F-02 invalid-date RangeError → stable INVALID_SQL_PARAMETER before binding/execution; incoming helper ka unsupported SQL year0000 gap bhi fix hua, live SQL boundary probe eight cases pass. F-03 stale first10k telemetry → bounded rolling latest10k per metric, explicit window-policy metadata, full reset-window counts/errors preserved.

Exact incoming regression selection **23/23 pass**. Expanded repository verification **617 unit pass / one platform-specific skip; 315/315 browser pass / zero retries/skips; two real SQL lease cases pass**. Coverage **97.23% lines / 89.71% branches / 93.93% functions**. Typecheck/lint/109 migration integrity/source packaging **229 files** pass; production date helper included, dev runtime excluded. No database migration change hui; earlier 37-suite/fresh-schema evidence historical report77 mein hai.

Fresh HTTP run `78ee990f-8bce-417b-a296-b983ee02a716`: **PASS**, 31 phases, 4,000 benchmark requests, 180-second soak **9,708 requests**, zero unexpected benchmark errors / instrumented deadlocks / cleanup errors. HTTP p95:

| API | 12 clients | 16 clients |
|---|---:|---:|
| Summary | 82ms | 161ms |
| Guard queue | 248ms | 243ms |
| Action Centre | 179ms | 107ms |
| Reception | 174ms | 236ms |

Mixed-write p95 98.9ms; separate export-pressure-write p95 136.1ms. Expected content-conflict 409 responses retained; movement/race invariants pass. No isolated HTTP speedup attribution made. RPC stage percentiles latest10k valid observations ki hain; full HTTP batches unchanged. Node RSS delta -2.8MiB short-soak leak absence prove nahi karta.

Report ke risk wording refine hue: current Reception UI at most **121 inclusive days** hai, unlimited range nahi; serial requests ka concern valid hai. Registration admission cap4 intentional bounded control hai; full runtime body64KiB / request15s / headers10s defaults already present hain, confirmed remote DoS reproduce nahi hua. Guard contention / cross-office authority / production integration recommendations resolved findings nahi hain. Node typed-client validation tests controlled pool double use karte hain; live SQL type boundaries separately verify hue.

**41/41 source fingerprints match**. Owned fixture/snapshot/temp principal cleanup zero; 26 retained demo visits aur13 preexisting principals preserved. Current-source app8443 root200/guard303 smoke PASS. One browser directory-refresh warning recovered (24 records fresh at five seconds); final soak mein throughput/SQL-time variation remaining candidate hai, exact cause unestablished. Detailed verdict, evidence aur limits: [report79](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/docs/79_External_Source_Audit_Validation_And_Acceptance_26_October_2026.md>). Previous worker optimization results: [report78](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/docs/78_Development_Worker_Prewarm_And_Burst_Latency_26_October_2026.md>).

Load run ke dauran normal app8443 bhi shared local SQL host par running thi; ye host-isolated performance A/B nahi hai. Source freshness verify karke existing app reuse ki gayi.


## Guard Assignment Groups follow-up — 26 October 2026

Office-scoped dynamic project groups implement hue: direct assignments aur overlapping sources preserve hain; group edits linked guard access atomic/audited update karti hain. Forward migrations110/111 apply hain; 111 existing local-project freshness policy preserve karti hai. Details: docs/80_Guard_Assignment_Groups_26_October_2026.md.

Unit627 pass +1 platform skip; seven SQL suites pass (group/local-project/staff final111 reruns), focused browser4 pass. Broad Chromium317 pass +1 register/export SQL timeout; same export concurrent repeats1/3 pass, normal app stop karne ke baad3/3 pass. Broad suite all-green nahi hai; exact shared-SQL contention/root cause pending performance priority hai. Group cases all pass. Normal app restored; fixture cleanup verified. Changes local/uncommitted hain.
