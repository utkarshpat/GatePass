# Remaining performance candidates — implementation and verification

Second implementation pass for [candidate report 75](75_Additional_Performance_Blocker_Candidates_25_October_2026.md). Changes local/uncommitted hain, base commit `4899a7cd7b054674425e539be19d5c57033c1eee`. Local `GatePass_DesignTest` schema **107** tak apply hua. First-pass results [report 74](74_Performance_Optimization_Implementation_25_October_2026.md) mein preserved hain.

## Implemented

1. **Reception:** office ke inside employees aur guest intake/person keys request-local sets mein resolve hote hain. Filters/counts/page same presence materialization reuse karte hain. `_PersonInsideOffice` ki per-row repetition remove hui; multiple projects, mixed employee credentials, cross-date pending returns aur legacy output parity preserve hain.
2. **Guard thumbnails:** new media-role-only `gp.ReadGuardPhotoSource` selected duty policy aur legacy photo policy dono check karta hai. Cold thumbnail: two compact metadata RPCs + one private source read, instead of two full pass-detail + two photo-resolution RPCs. Warm authorized hash cache: two fresh metadata RPCs, zero source-file I/O/resize. Before/after actor/scope/pass/source checks remain. Source buffers transfer ownership and wipe after transform. UI fetch concurrency two, content-version/scope-bound object-URL reuse maximum 128 entries / 60 seconds; scope/denial resets clear pixels. Plain full-size photo behavior unchanged hai.
3. **Register:** unfiltered submitted-time listing chooses authorized page IDs before expensive projection/history. Counts stay full-scope, empty later pages retain totals; all other field filters/sorts use complete projection. Movement history aggregates over candidates once. Start/end authorization and original field/fingerprint parity remain.
4. **Consistent export snapshots:** application opts into protected SQL snapshots. Initial full projection/hash materializes ordered export once; intermediate 200-row pages use that snapshot. Before download a fresh full projection/hash must match, catching same-count edits. Every page rechecks session, VISITS_READ and REPORTS_EXPORT. Snapshot bound to exact session and canonical office/project/date/filter/sort query, expires after two minutes, four global slots, at most 10,000 rows and **32 MiB JSON per slot**. Maximum retained logical JSON payload 128 MiB, excluding SQL/index overhead. Completion/cancellation deletes data; a visit-purge trigger invalidates snapshots. Expired reads are denied; physical expired-row deletion happens on the next authorized register request. Runtime identities have no direct snapshot-table SELECT permission. A fresh valid session can delete only its own snapshot even after former export scope is removed; failed cleanup falls back to expiry/next-activity collection.
5. **Responsive Excel:** XML, CRC and ZIP work runs in a fixed same-origin Web Worker, served under a content-hashed asset URL and existing `worker-src 'self'` CSP. Raw DEFLATE compression supported, bounded STORE fallback for unsupported browsers. Progress, worker termination on completion/error, 60-second generation bound and scope-change cancellation preserve existing flow. Export limits, duplicate checks, full-content validation and no-download-on-change remain.
6. **Lazy catalogue/search:** initial admin catalogue fetches one 25-project page. Load-more and server-side substring search retrieve unseen projects; selected scope survives page/search changes. Roster, role permissions and allocation dialogs request complete authorized project metadata only when needed, so project 61 remains included in complete roster counts. Their metadata stays separate from visible catalogue pages. Guard queue and catalogue search allow one active read plus latest pending input; generation checks still discard stale results/denials. Polling fallback jitters between 18–20 seconds without exceeding the former 20-second polling budget; SSE safety refresh remains 60 seconds.
7. **Bounded capacity experiment:** development worker limit configurable 1–8 for explicit local profiling, default four; waiting/request/HTTP/SSE budgets unchanged. Production identity pools untouched. Four-vs-six results below determine whether the default should change.

Forward migrations **101–107** contain these changes and subsequent execute-only/static-paging, ordered-slice, lifecycle and measured-storage-budget corrections. Applied migrations were preserved; the complete sequence through 107 is required. No prior migration 001–100 was rewritten. A 10k-row test exposed a 16 MiB budget rejection and fixture cleanup timeout; those failed artifacts retain FAIL. Budget is now bounded at 32 MiB and primary keys on exact owned cleanup sets corrected the cleanup plan without increasing business/test timeout thresholds. Both earlier owned fixtures were recovered and removed before final profiling.

## Measured results

Final default-four-worker run **PASS**, `ec4c866e-55d1-456e-a8ea-9ea89feed1a7`: **4 APIs × 4 concurrency points × 100 samples = 1,600 benchmark responses**, zero unexpected benchmark responses. Twenty-seven functional/load phases pass, 5,000ms p95 and 128 MiB RSS-growth guards unchanged. Fixture remains 1,000 owned rows / 2,110 office rows / 2,111 database rows, schema 107. Limits and performance are local observations, not approved production SLOs.

| API | c1 p95 ms | c4 p95 ms | c8 p95 ms | c12 p95 ms |
|---|---:|---:|---:|---:|
| Summary | 33.6 | 66.2 | 83.2 | 108.9 |
| Guard queue | 82.2 | 417.8 | 141.1 | 183.8 |
| Action Centre | 34.9 | 67.4 | 165.2 | 114.2 |
| Reception | 84.3 | 117.3 | 208.8 | 249.5 |

**Direct SQL re-profile:** `output/performance-candidates/13f77ed1-dc83-4dd5-9776-360a32f6292d/report.json` PASS. Five sequential samples per scenario, plus 60 exact predicate set comparisons. Reception first page **195.9 → 62.8ms mean** (68.0% lower), per-row `_PersonInsideOffice` eliminated. Unfiltered register first page **72.7 → 50.0ms mean**. These are SQL observations, not HTTP p95. Both run-owned fixtures cleaned.

**Compatibility path limitation:** non-snapshot default-50-row export page in this small diagnostic measured **232.1ms**, versus 124.7ms before this pass. The application now uses the separately measured snapshot protocol; legacy direct export callers retain full projection/hash work and the larger procedure path has a measured residual cost. This pass does not claim every SQL branch improved.

**Concurrent writes:** eleven authenticated readers (including Reception) + 100 ordered movements: **916 reads**, write p95 **522.0ms**. Separate export-pressure phase: one stateful export lane + ten readers + 100 movements, **863 read operations**, movement p95 **129.9ms**, eight created snapshots, seven expected final HTTP 409 content invalidations, eight explicit cancellations. HTTP 409 is retained in metrics, not relabeled 200; it prevents downloading changed data. No unexpected response/errors, 50 committed entries and final outside state in each movement phase. The two workload phases differ; their latency is not an isolated export-overhead subtraction.

**Four versus six:** repeat run `4abb7cc6-f23a-4924-9b3e-45ab63c68566` also PASS (1,600 benchmarks, 6-second soak). Default remains **four** because the gains/regressions are mixed.

| Latest 12-client point | Four workers p95 ms | Six workers p95 ms |
|---|---:|---:|
| Summary | 108.9 | 97.7 |
| Guard queue | 183.8 | 179.5 |
| Action Centre | 114.2 | 115.6 |
| Reception | 249.5 | 309.9 |
| Ordinary mixed movement writes | 522.0 | 125.0 |
| Export-pressure movement writes | 129.9 | 211.1 |

Earlier additional run pair `09cd6be7-f60d-44fe-80ca-196c8f77304a` / `4212483a-a20d-41d8-a5bd-7278dffc5602` (before the export-pressure phase was added) also passed: Guard p95 267.6→498.2ms with six workers, while Reception 411.9→318.7ms. Final repeat Guard did not reproduce that tail regression; Reception and export-pressure writes did regress. Trials are sequential with 100 samples/point, not a randomized repeated capacity study. Extra parallel workers share CPU/SQL/resources; specific wait/CPU causality has not been proven. No production pool default changed.

**Soak/deadlocks:** default-four configured 60-second soak: **4140 requests**, four post-GC Node-child samples, RSS delta **-7.9 MiB**. Six-worker 6-second soak is not memory-comparable. Both runs observe zero SQL 1205 in instrumented phases and no fixture/child cleanup errors. Visitor/employee races and per-session/global SSE gates remain exact. Failed preflight/fixture-argument invocation `98519365-5a06-4595-839d-4dc3ecb424ff` retains FAIL; corrected owned cleanup afterwards verifies zero users. No business request was replayed.

**10,000-row export, final probe PASS:** `output/export-performance/6f6e1737-fe08-499a-ab3d-3e998151c629/report.json`. Same execute-only SQL connection and stable exact row set/fingerprint. Legacy 200-row export: **45,166ms / 50 calls**; snapshot + mandatory final validation: **12,501ms / 51 calls**, **72.3% lower elapsed time / 3.61× faster**. Includes PowerShell JSON parsing/client processing; excludes HTTP and workbook generation. One observation per mode, legacy first; this is not p95. Full row-hash evaluations drop from 50 × 10,000 to 2 × 10,000. Snapshot JSON was **17,473,366 bytes**; fixture cleanup completed in **20,459ms**. Initial and final full hashes match, all 10,000 unique rows exported.

**Excel worker probe:** same 26-column/10k-row synthetic long-purpose data as report 75. Worker diagnostic `output/performance-second-pass/74a8c26d-1e08-4c60-a45f-10e0d2472cf2/workbook.json`: **857ms total**, **84 UI heartbeat ticks**, compressed output **1,012,885 bytes**, versus prior uncompressed **30,429,566 bytes**. This demonstrates asynchronous work and smaller output; compression adds work and total worker duration is not a claim of faster workbook assembly. ZIP headers, native decompression/CRC, UTF-8 and escaped cell content have independent unit validation. Four-times CPU slowdown numbers from report 75 were not re-measured on the worker; no physical-mobile conclusion.

**Catalogue/photo evidence:** 1,000-project browser fixture initially makes one catalogue request, can find project 1000 by server search, load additional pages and retain selected scope. Project-61 roster test checks all 61 projects and complete availability counters. Thumbnail unit tests verify two cold metadata reads, warm I/O avoidance, invalid source rejection and fresh denials. Browser checks cover same-hash reuse, changed version refetch, office switch and clearing on denial. Live execute-only media SQL verifies wrong scope/capability/expired/blocked actor denials and purge handling. A full HTTP thumbnail-fleet capacity profile has not been claimed.

## Verification and remaining limits

- **597 unit tests passed, 1 skipped, 0 failed**; CI coverage gates pass: **97.20% lines / 89.58% branches / 93.68% functions**. Includes export-pressure expected-409/unexpected-error assertions, worker cap bounds, coalesced search, workbook compression/CRC and fresh thumbnail authority.
- **60 selected browser checks passed after fixes**: broad final suite 59 pass + one thumbnail test repaired for the visible office picker and independently passed. Source behavior was unchanged by that final test-only selector fix. Earlier security tests were adapted to release obsolete reads before expecting their coalesced latest request; latest state and ignored stale 401 assertions remain. Includes live SQL snapshot download, catalogue/search/scope, full project-61 roster, independent-session movements, export mutations/revocation, worker responsiveness and thumbnail reuse/denial.
- **12 live SQL suites passed**, including **43 equivalence/boundary cases** against original procedure outputs, new media-role photo checks, export snapshot lifecycle/ownership/mutation/capacity/purge/revocation and real helper crash/role isolation. Equivalent legacy payloads ignore only checkedAtUtc and the newly added optional photoVersion field.
- Typecheck, lint, **107 migration hashes**, Git diff whitespace check pass. Prior 99 manifest entries and migration 100 remain unchanged. npm audit **0 vulnerabilities**; Git-history secret scan **37 commits, 0 leaks** (history scope). Source release **226 allowlisted files**, development runtime excluded, deploymentReady false.
- Final read-only DB proof: **zero owned fixture users/visits, zero export snapshots, zero leased/diagnostic SQL principals, zero baseline procedures, zero mixed occupancy conflicts**. **26 retained demo visits and 13 preexisting development principals preserved.** Zero-lease snapshot was taken before normal app startup/browsing.
- Both final load runs' **36 runtime/harness source hashes match** current saved source. Quality/SQL/browser/DB evidence in `output/performance-implementation/`; final load artifacts remain immutable under `output/load-stress/ec4c866e-55d1-456e-a8ea-9ea89feed1a7/` and `4abb7cc6-f23a-4924-9b3e-45ab63c68566`.

Normal app 8443 official launcher se fresh controlled terminal session mein restart hua; root HTTP 200 and protected guard HTTP 303 check recorded separately. Historical failed artifacts are retained, and source changes remain uncommitted/unpushed.

Snapshot pages still parse the bounded stored JSON and compose a 200-row slice; the 10k probe shows remaining page CPU/client parsing cost. A separate indexed row-slice representation could reduce it further. Roster/role views deliberately load complete authorized metadata on demand; very large rosters/common-area assignment sets still need a dedicated server-aggregate/paged design. The 1k-project browser fixture measures request behavior with mocked catalogue responses, not 1k-project SQL throughput.

Local synthetic tests do not establish production capacity, absence of memory leaks, or all image/upload/print/mail workflow performance. Node-child memory samples exclude PowerShell and SQL. Stream/socket/worker limits are bounded protections; raising them without mixed-load evidence is not an optimization.

## Reproduce

```powershell
$env:GATEPASS_SHARP_PATH = "$HOME\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\sharp"
$env:GATEPASS_PWSH_PATH = "$HOME\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe"
$env:PATH = "$HOME\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell;$env:PATH"
node tools/run-load-stress-test.ts --requests 100 --concurrency 1,4,8,12 --soak-seconds 60 --workers 4
node tools/run-load-stress-test.ts --requests 100 --concurrency 1,4,8,12 --soak-seconds 6 --workers 6
& $env:GATEPASS_PWSH_PATH -NoProfile -File tools/profile-export-snapshots.ps1 -Rows 10000
& $env:GATEPASS_PWSH_PATH -NoProfile -File database/tests/Test-ExportSnapshots.ps1 -TrustLocalServerCertificate
& $env:GATEPASS_PWSH_PATH -NoProfile -File database/tests/Test-GuardPhotoReads.ps1 -TrustLocalServerCertificate
```

Generated evidence local/ignored hai; owned fixtures/principals and isolated test servers clean up before the normal app restarts.
