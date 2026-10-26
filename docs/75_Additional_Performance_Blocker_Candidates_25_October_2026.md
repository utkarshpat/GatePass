# Additional performance candidates — 25 October 2026

Implementation follow-up: [report 76](76_Remaining_Performance_Candidates_Implementation_25_October_2026.md) mein Reception, thumbnails, export snapshot/worker, catalogue/search aur measured worker comparison ke results hain. Neeche pre-implementation findings preserved hain.

Migration 100 ke baad [report 74](74_Performance_Optimization_Implementation_25_October_2026.md) ka full 1/4/8/12-client load run PASS hai. Is follow-up mein application source change nahi hui. Existing measured residuals recheck hue; guard thumbnail fan-out aur browser Excel assembly ke additional findings neeche hain. Candidates ko production incident/blocker certification nahi maana gaya hai.

## 1. Guard thumbnail SQL fan-out and serial loading — newly confirmed code path

`src/development/GuardRoutes.ts` thumbnail route calls guard detail before and after reading photo. `VisitPhotoService.read` in `src/visits/VisitReadService.ts` separately resolves photo metadata before and after file read. Isliye one successful thumbnail request performs **two `gp.ReadGuardDutyPass` + two `gp.ResolveVisitPhoto` business RPCs**, apart from staff session verification.

`src/app/guard.js:82` mein one `drainHistoryPhotos` loop visible-photo jobs serially await karta hai. IntersectionObserver visible cards ko lazily enqueue karta hai; all loaded rows immediately photo-fetch nahi hote. Example: **24 photos actually requested** imply 96 business RPCs; yeh code-derived count hai, measured page-load duration nahi.

`PhotoThumbnails` resized bytes cache karta hai, lekin lookup full authorized source photo read/hash ke baad hoti hai. Warm resize cache SQL authorization/source I/O eliminate nahi karti. `renderRecent` old object URLs/queue discard karta hai; changed rows ke refresh par visible photos repeat ho sakte hain.

**Mitigation:** dedicated scoped thumbnail metadata/authorization path with fresh end-of-read revocation checks; version/content-hash-bound UI thumbnail reuse; after reducing RPC work, small bounded photo concurrency. Before/after checks simply remove karna safe optimization nahi hai. Test cold/warm 24 visible photos, scrolling, row changes, revoked scope and movement p95 under photo traffic. End-to-end impact abhi unmeasured hai. Local dummy composition ka route audited hua; production equivalence independently verify karni hogi.

## 2. Browser Excel generation blocks the UI — newly measured

Current `src/app/admin.js:539`–`:569` workbook code XML strings, CRC and ZIP STORE archive synchronously main thread par generate karta hai. Export gathers all rows before workbook generation; `registerColumns` has **26 columns**.

Fresh headless Chromium diagnostic exact current `crcTable` through `xlsxBlob` functions run karta hai. Synthetic data uses 26 columns, ordinary ~30-character values and a ~500-character purpose field. Three observations per condition:

| Synthetic rows | CPU configuration | Mean workbook assembly | Largest timer delay | Output |
|---|---|---:|---:|---:|
| 1,000 | Native | 62.0ms | 87.0ms | 2.86 MiB |
| 10,000 | Native | 276.2ms | 318.4ms | 29.02 MiB |
| 1,000 | Browser 4× slowdown | 116.9ms | 123.8ms | 2.86 MiB |
| 10,000 | Browser 4× slowdown | 1,044.0ms | 1,055.2ms | 29.02 MiB |

This measures only workbook assembly, not API/SQL time, row formatting or full export wall time. Four-times CPU slowdown is an emulated condition, not an actual mobile-device benchmark. Output size is generated Blob size, not measured peak memory. Three samples do not establish p95.

**Mitigation:** Web Worker workbook generation with cancellation/progress, bounded intermediate data and appropriately compressed/streamed ZIP output. Keep current export authorization, full-content version checks, row limit and scope-change cancellation. Verify 10k-row responsiveness, long values, multilingual text and mid-export scope change.

Evidence: `output/performance-implementation/extra-candidates.json`, ignored reproducer `output/performance-implementation/profile-extra-candidates.mjs`. Report records current source SHA-256 and browser version. Synthetic data only; no connected service or visitor payload accessed.

## 3. Reception presence aggregation — measured residual, highest direct SQL target

Post-100 direct SQL first-page mean **195.9ms**, with **2,150 `_PersonInsideOffice` invocations/RPC**, even for a 50-row result. Evidence: `output/performance-candidates/c8bc1ebe-fef0-47ec-be30-2c4ebec1e73a/report.json`; five sequential samples, not HTTP p95. Migration 100 line 212 evaluates full matching presence; line 229 projects row presence again.

**Mitigation:** request-local set-based office/employee presence reused by filters, counts and page. Preserve multi-project distinct people, mixed employee credentials, returned passes and office-wide pending returns. Run 1/4/8/12 reception HTTP matrix and movement writes during reception reads.

## 4. Register/export full projection and fingerprint repetition — measured residual plus scaling calculation

Register first-page SQL mean **72.7ms**, default 50-row export page **124.7ms**, at 1,022 matching rows in the same five-sample diagnostic. Migration 100 still builds `#register` before page selection, and export rehashes the full matching projection on each chunk.

At the current 10,000-row maximum and application chunk size 200, an export requires 50 successful page calls. Absent concurrent changes, this implies **500,000 row digest evaluations**, plus full projection work on each call. This is a code-derived bound, not a measured 10k-row SQL result. Current fingerprint consistency check correctly refuses changes during export.

**Mitigation:** late projection where filters allow it; bounded owner/scope-bound snapshot with expiry/audit/fresh authorization. A count-only version cannot detect same-count edits. Test export plus scans/returns/role revocation together.

## 5. Eager catalogue and overlapping search work — confirmed paths, fleet-size impact pending

`prepareConsole` (`src/app/admin.js:173`) drains every authorized project cursor before scope/view initialization. Project-view quiet refresh drains them again (`:674`); common-area catalogue also drains pages. Guard search uses debounce and generation checks; already-dispatched reads remain work. Current retained fixture has few projects, so a 1,000-visit load run does not establish performance at 1k/10k projects/assignments.

**Mitigation:** server-paged searchable catalogue, separate scope metadata and retained selected project; one active search with latest pending query per scope. Validate project-only admins, selected projects outside the first page and stale 401/403 handling.

## 6. Local stream/pool capacity and polling feedback — measured limits, workload impact pending

Local host has **16 sockets**, **4 global SSE streams / 2 per session**, and **4 development RPC workers**. Excess valid stream attempts return 429 as tested. `src/app/live-refresh.js` falls back to the default 20-second refresh interval, with jittered SSE reconnect; active streams use a 60-second safety refresh. Polling refresh itself has no per-client jitter. Separate visible Action Centre panels can add their own refresh work.

At 12 read clients, guard worker queue mean remains **129.7ms**, SQL execute mean **63.9ms**. Those timings concern the development bridge, not production identity pools. Browser arrival synchronization, more-than-four-viewer fallback, media traffic and concurrent export were not part of that 12-client isolated-read point.

**Mitigation:** multi-browser SSE fallback/polling trace and controlled worker matrix with SQL/memory observation; coalesce/jitter background reads while preserving freshness. Keep bounded admission and independently test movement p95. Raising caps alone can move contention into SQL.

## Suggested next order

Reception set-based presence → guard thumbnail fan-out → register/export projection and browser worker → lazy catalogue/search → measured local capacity tuning. Card PNG rendering, photo uploads and mail queue draining still need dedicated mixed-load measurements; existing concurrency limits/cache bounds by themselves do not prove a bottleneck or clear those paths.
