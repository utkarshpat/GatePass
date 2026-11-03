> Documentation status: historical implementation/design/evidence record, indexed 3 November 2026. Read the [current handbook](system/README.md) and [Visit owner/Host glossary](109_Visit_Owner_and_Host_Terminology_03_November_2026.md) for current behavior. Counts, setup examples and screenshots below describe their dated stage, not a fresh certification.

# Performance optimization candidates — 25 October 2026

Implementation follow-up: [document 74](74_Performance_Optimization_Implementation_25_October_2026.md) mein deployed local migration, implemented scope, actual before/after HTTP results aur remaining candidates hain. Neeche original pre-implementation diagnostic record preserved hai.

Is pass ka result ranked implementation backlog hai. Application queries, migrations, authorization policy aur UI behavior is pass mein change nahi hue. Existing working-tree fixes preserve kiye gaye hain. New diagnostic: `tools/profile-performance-candidates.ps1`.

Full HTTP load baseline [document 72](72_Corrected_Load_Stress_And_Bottleneck_Findings_25_October_2026.md) ka hai: concurrency 12 par guard queue p95 **5.58s**, Action Centre **5.22s**, summary **1.83s**; 1,200 benchmark responses successful, zero observed SQL deadlocks, lekin two 5-second guard breaches.

## New measurements

Diagnostic run `83342168-1ea6-410e-9bf7-3599c24ca29b` ne **12 RPC scenarios × 5 measured samples = 60 direct SQL calls**, plus warm-ups execute kiye. Three read-only policy-filter prototypes ko authorized/unauthorized actors aur fresh/stale-directory contexts mein compare kiya: **12 contexts × 5 measured pairs = 60 exact visit-set comparisons**, all matched. Comparison ordered set hashes aur counts dono verify karti hai. Fixture/principal cleanup pass hua.

Same local test database mein 1,000 invocation-owned rows (800 approved, 200 pending) add hue; total office rows 2,110 the. API baseline disposable execute-only SQL principal aur one reused SQL connection par chala. Summary scenarios current IST day ki **one-day range** hain, previous 31-day HTTP case nahi. All timings below **five-sample sequential means** hain; HTTP p95 ya production capacity nahi.

| Existing RPC scenario | Mean ms | Result | Relevant helper calls/RPC |
|---|---:|---|---:|
| Guard first page | 763.6 | 24 / 1,023 visits | 2,110 `_GuardDutyVisitAllowed` |
| Guard second page | 570.0 | 24 / 1,023 visits | 2,110 |
| Guard exact owned reference search | 564.8 | **1 result** | **2,110** |
| Action Centre pending | 606.2 | 24 items, 209 pending | 2,319 `_GuardDutyVisitAllowed` |
| Action Centre expired-inside | 655.3 | **0 items** | **2,319** |
| Reception first page | 321.5 | 50 / 2,050 visits | 2,064 `_VisitReadAllowed` |
| Reception second page | 307.1 | 50 / 2,050 visits | 2,064 |
| Summary, owned project | 189.7 | aggregate | 2,047 `_AdminScopeAllowed` |
| Summary, office | 407.6 | aggregate | 4,163 |
| Admin register first page | 200.6 | 50 / 1,022 visits | 1,022 `_VisitReadAllowed` |
| Export first page | 269.9 | 50 / 1,022 visits | 1,022 |
| Export second page | 281.5 | 50 / 1,022 visits | 1,022 |

Small samples aur separate phases mein CPU/cache variation hai. First/second page differences ko regression ya precise exclusive component cost nahi maana gaya hai. Counter deltas cache-wide hain; nested helper CPU overlap karta hai.

## Most promising SQL experiments

| Predicate experiment, authorized actor + fresh directory | Original mean ms | Candidate mean ms | Observed reduction in that component |
|---|---:|---:|---|
| Guard: relational candidate prefilter, existing helper retained | 457.1 | 238.5 | ~1.9×; helper calls 2,110 → 1,032 |
| Guard: duty authorization once, relational visit eligibility | 491.7 | 11.9 | ~41×; `_GuardDutyAssigned` calls 2,110 → 1 |
| Admin: distinct scope authorization + scope recheck | 311.1 | 16.1 | ~19×; `_AdminScopeAllowed` calls 4,220 → 20 |

**Yeh complete API speedups nahi hain.** Prototypes diagnostic database owner context mein sirf policy-filter sets evaluate karti hain. Full procedure session checks, time advancing during a read, final revocation fencing, response projection, row flags, count calculation, JSON, bridge waiting aur HTTP overhead is comparison mein complete nahi hain. Guard experiment sirf concrete PROJECT path cover karta hai; COMMON/ALL, inside-but-no-longer-eligible employee, purged data aur concurrent scope changes ka complete regression matrix implementation ke waqt required hai. Fresh/stale tests aur denied actors initial evidence hain, complete security equivalence proof nahi. Dono guard experiments alternative stages hain; their ratios add/multiply karke API forecast nahi banana chahiye.

## Ranked implementation candidates

### 1. Guard query: scope/date/reference prefilter before scalar authorization — high confidence, first low-complexity step

**Evidence:** one reference match aur second page dono abhi 2,110 helper evaluations karte hain. `gp.ReadGuardQueue` already authorized duties materialize karta hai, phir office visits × duties par scalar helper chalata hai. Pure PROJECT predicate prefilter ne same visit sets ke saath helper work roughly half kiya.

**Change:** request-local candidate table mein office/project/date/pass/queue predicates apply karo; TEMP_ID cross-project eligibility/presence branch ko separately retain karo. Recognized exact reference/pass-number lookup ko indexed equality branch do, ordinary name/substring search ko existing semantics ke saath retain karo. Remaining candidates par existing permission helper chale. ALL duties ke cross product ke bajaye project joins + separate TEMP_ID/COMMON branches evaluate karo.

**Source:** `database/migrations/092_workspace_queue_paging.sql:24`, `:30`, `:33`; helper in `database/migrations/059_employee_project_presence_identity.sql:19`.

**Validation:** same ordered pages/counts/cursors; exact reference + Unicode substring search; PROJECT/ALL/COMMON; TEMP_ID outside selected project but eligible/inside; purged rows; revoked duties. New forward migration, existing applied migration edit nahi.

### 2. Guard + Action Centre: authorize each duty once per read — highest measured upside, broader security regression work

**Evidence:** current helper invokes `_GuardDutyAssigned` for every visit. That helper repeats grant/capability/assignment checks which are identical for a fixed actor/duty/as-of time. Predicate prototype reduced 2,110 duty checks to one, 491.7ms → 11.9ms.

**Change:** materialize the authorized duty set once, join ordinary project visits directly, evaluate employee eligibility once per employee/duty where needed. Fresh actor, scope, directory and temporal checks still run before response; read-time authorization work does not become a cross-request permission cache. Reuse the design in Action Centre only after guard equivalence is established.

**Source:** `database/migrations/053_guard_duty_contexts.sql:35`; `database/migrations/059_employee_project_presence_identity.sql:21`; `database/migrations/098_digital_id_presence_followups.sql:110`, `:121`.

**Validation:** full existing real SQL permissions/concurrency suites, session/grant expiry across a read, deallocation/revocation, employee-project and hosted credential parity, entry/exit races; then unchanged HTTP load profile.

### 3. Summary: authorize distinct scopes, not every row twice — high confidence, comparatively contained change

**Evidence:** office summary repeats `_AdminScopeAllowed` 4,163 times/RPC. Current recheck visits every materialized row although many share the same office/project. The isolated filter/recheck prototype used 20 calls instead of 4,220 with identical visit sets, 311.1ms → 16.1ms.

**Change:** materialize unique `(LocationId, ProjectLocationId)` scopes, evaluate membership once per scope, join rows to allowed scopes, and recheck the scopes actually included before returning aggregate counts. Include occupant scopes and NULL/office scopes; final actor and capability checks remain.

**Source:** `database/migrations/091_operational_summary_range.sql:26`, `:37`.

**Validation:** office-wide and project-only administrators, mixed allowed/foreign projects, zero days, current presence without double counting, time/role expiry, denied scope, counts parity over a full 31-day range. This is a good first contained migration while the guard refactor is prepared.

### 4. Local development SQL principal lifecycle — confirmed cost, separate transport track

**Evidence from full load:** concurrency 12 mean setup/coordination ~710ms for queue and ~662ms for actions; additional mean worker wait ~2.8s. Bridge creates/assigns/drops a SQL principal per RPC, and the new correctness gate prevents its permission-cache deadlocks. Pooling is explicitly false because impersonated pooled sessions were unsafe.

**Change:** bounded role-specific stable principals/connections with explicit admission, cleanup, crash recovery and lifetime rules, or test the existing typed TDS adapter with dedicated least-privilege development identities. Preserve separate auth/API/render/media/worker authorities. Do not simply enable pooling on an impersonated connection or remove the DDL coordination gate.

**Source:** `tools/GatePass.DevelopmentApiBridge.ps1:23`, `:26`, `:57`; `tools/GatePass.LocalSql.psm1:32`; `src/transport/SqlProcedureClient.ts` already has separate identity pools.

**Validation:** role isolation, role switching, crashes/timeouts, no orphan principals, clean reconnect, no write replay, and repeat 1/4/8/12 concurrency. This candidate changes the local adapter; it does not imply production pays the same per-request DDL cost.

### 5. Refresh request amplification across loaded pages — confirmed code/call pattern, user-visible impact needs a dedicated trace

**Evidence:** guard, reception and Action Centre restart from the first cursor during quiet refresh, then serially refill all currently loaded rows. Second-page RPCs repeat almost the same full-filter work as first pages. Action Centre refreshes an open idle panel every 20 seconds. Five loaded pages therefore mean five RPCs per panel refresh; 12 such panels would offer 3 RPC/s before other traffic. This is a request-count model, not a measured multi-browser capacity result.

**Change:** bounded server-side window refresh that reuses count/authorization work once for the loaded window; retain ordinary small first pages. Alternatively design an explicitly versioned conditional read with fresh scope authorization and authoritative reconciliation. Preserve cursor consistency, freshness/error labels, focus, selected rows and refusal to show partial totals as complete.

**Source:** `src/app/guard.js:120`, `:127`; `src/app/reception.js:154`, `:161`; `src/app/action-centre.js:17`, `:65`, `:72`.

**Validation:** trace 1/5/10 loaded pages, idle and mutation bursts, multiple browsers, disconnect/reconnect, scope change, inserted/removed rows between pages, stale/denied response handling. Do not parallel-fetch a dependent cursor chain or just slow all safety refreshes.

### 6. Action Centre: separate cheap counts from selected-category page work — confirmed empty-result cost

**Evidence:** empty EXPIRED_INSIDE returns zero items but still averages 655ms and 2,319 guard helper calls; PENDING with 24 items averages 606ms. The backend computes all follow-up flags and full authorized matches before the selected page.

**Change:** share a scoped candidate set, calculate all category counters efficiently, then project/order only the selected category. Explicit workspace/category branches can avoid evaluating irrelevant return/print paths for guards.

**Source:** `database/migrations/098_digital_id_presence_followups.sql:99`, `:110`, `:121`.

**Validation:** all three tab counters must stay correct even when selected category is empty. PENDING deadline, expired TEMP_ID entry owner, common-duty restrictions and unreturned/return corrections remain exact. Filtering solely to the selected category and losing other counters is not an acceptable optimization.

### 7. Reception: amortize office counts and per-row authorization — newly measured secondary bottleneck

**Evidence:** 50-row first and second pages average 322/307ms and each invoke `_VisitReadAllowed` 2,064 times. Office pending-return count is also computed across authorized outstanding records.

**Change:** materialize reception scope/candidates once, reuse shared print/return/presence state across counts and page projection; use the bounded window approach for multi-page refresh. A date-filtered page must not incorrectly narrow the deliberately office-wide pending-return metric.

**Source:** `database/migrations/098_digital_id_presence_followups.sql:8`; `database/migrations/092_workspace_queue_paging.sql:76`, `:104` (base version).

**Validation:** pending returns across dates, distinct employee occupancy, print/type/status filters, corrected returns and denied offices. Reception already has real paging; replacing it with another frontend-only slice would not reduce SQL work.

### 8. Register/export: late projection and bounded consistent export snapshot — confirmed repeated work, larger design

**Evidence:** list first page 201ms, export pages 270/282ms at 1,022 matching rows. `#register` materializes all projected rows, movement summaries and field filters before returning 50 rows. Export hashes the entire matching dataset on every page; 1,022 rows require 21 pages, so current code performs 21 full projections/authorization passes and 21,462 row digests. At the existing maximum 10,000 rows / 200 pages this becomes 2,000,000 row digests, a code-derived count rather than a measured 10,000-row run.

**Change:** late-materialize expensive history/projection fields for list pages after the applicable filters/counts are resolved. For export, design one bounded owner/scope-bound snapshot or consistent bulk stream with explicit expiry, authorization checks and audit policy. Preserve concurrent-change detection and the existing 10,000-row bound; do not remove `datasetVersion` comparisons or substitute row count for a full-content revision.

**Source:** `database/migrations/099_employee_presence_and_export_authority.sql:275`, `:301`, `:306`; `src/app/admin.js:573`, `:579`, `:586`.

**Validation:** all 24 field filters/sorts, movement/return changes mid-export, reordered/duplicate pages, revocation, dataset changing without row-count change, partial download cancellation, result size limits and bounded protected storage. Existing SQL transport has a 4 MiB scalar result limit; a single huge JSON response is not a drop-in replacement.

### 9. Admin catalogue + search scheduling — confirmed eager reads, profiling still needed for fleet-size impact

**Evidence:** `prepareConsole` fetches all project pages before rendering the active view; project view refresh repeats the full catalogue. Rendering 24 tiles does not prevent those reads. Common-area catalogue similarly drains offset pages. Guard search debounces 250ms but discards late responses by version rather than coalescing the SQL work before dispatch.

**Change:** lazy/searchable server-paged catalogue, scope metadata separate from catalogue data, current selected project retained safely; one active search read plus latest pending query per scope. Reuse existing bounded lead-preview controls rather than adding another preview cache.

**Source:** `src/app/admin.js:66`, `:173`, `:176`, `:673`; `src/app/guard.js:10`, `:138`.

**Validation:** 1k/10k projects and assignments, office-only vs project-only administration, navigation/focus, rapid input, scope changes and stale 401/403 responses. Aborting a browser fetch alone does not prove the SQL query was cancelled; request prevention/coalescing is the useful first experiment.

### 10. Worker/socket/index tuning — defer until the above costs shrink

**Evidence:** local RPC worker cap four, HTTP sockets sixteen, global SSE streams four. The full run already shows throughput plateau and queue delay. Existing visit indexes cover project/status/date and office/date/status; the captured metadata does not establish a missing-index root cause. Some apparently duplicate unique indexes support composite foreign-key integrity.

**Change:** after query/transport fixes, test a bounded worker-count matrix and fair scheduling under mixed read/write/render load. Capture actual plans, waits, sorts/spills and logical reads on larger retained datasets before adding a scope/date/keyset covering index. Test SSE fallback/polling with more than four viewers before changing stream caps.

**Source:** `src/development/LocalDevelopmentApiClient.ts:23`; `tools/start-dummy-sso.ts:198`; current index metadata in the diagnostic report.

**Validation:** include actual scan/movement write latency during read/export load, memory across Node/PowerShell/SQL, SQL concurrency, queue limits and rejection behavior. More workers, higher timeouts or a larger p95 budget do not by themselves demonstrate optimization.

## Recommended execution order and acceptance

1. Summary distinct scopes and guard relational prefilter as contained forward migrations.
2. Guard duty-once design, then share it with Action Centre; preserve all authorization/time/occupancy checks.
3. Development principal lifecycle in a separate change, so transport gains can be measured independently.
4. Loaded-window refresh, Action Centre count/page separation, reception shared work.
5. Register/export snapshot, eager catalogue reads, then measured worker/index tuning.

Each implementation should run the same-data 1/4/8/12 HTTP profile before/after, keep default guard thresholds unchanged, preserve exact counts/pages and full authorization regression coverage, and measure write latency under mixed load. Then expand datasets and arrival-rate tests. The small predicate experiments identify where to invest; their ratios are not end-to-end promises. Images, rendering and mail were not exercised by this new SQL probe and are not cleared as application-wide bottlenecks; thumbnail caching/singleflight and render bounds already exist.

## Reproduce and evidence

```powershell
& "$HOME\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe" -NoProfile -File tools/profile-performance-candidates.ps1 -Repetitions 5
```

Use the existing local synthetic `GatePass_DesignTest` database. The script creates unique owned fixtures, adds export authority only to its synthetic administrator, uses an execute-only principal for existing RPCs, compares read-only prototypes as the diagnostic owner, and cleans its exact fixture/principal in `finally`. It does not alter production procedures, global freshness settings, persistent runtime permissions, retained presentation records or send mail.

Raw local/ignored artifact: `output/performance-candidates/83342168-1ea6-410e-9bf7-3599c24ca29b/report.json`. It contains individual timings, counter deltas, set comparisons, current index metadata, script hash and cleanup status. Tokens/session hashes, visitor names and full SQL result payloads are not persisted. Prior HTTP baseline and validation evidence remain in document 72.

Final verification: diagnostic run PASS; all 60 measured set comparisons matched; current script SHA-256 matches the measured artifact; PowerShell parser, repository typecheck/lint and 99 migration hashes pass. Read-only database checks show **0 owned users, 0 owned visits, 0 owned SQL principals**, with **26 retained presentation visits preserved**. `artifact-verification.json`, `database-verification.json` and quality logs are saved alongside the raw report. Full application unit/browser suites were not rerun for this diagnostic/document-only pass; their previous results are scoped in document 72.
