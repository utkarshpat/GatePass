# Admin loading: defer hidden work and share pending lead reads

Implemented locally on **24 October 2026**, following [phase 5](Performance_Optimization_Phase_5.md). This batch targets frontend request volume rather than card encoding or database settings. No dependency, SQL procedure, authorization rule, schema/index or server cache changes.

## Finding

`setScope()` renders the project catalogue even when the administrator lands on Overview. That rendering previously queued first-page lead reads for the first 40 projects, whether the project tab/cards were visible or not. The requests competed with active work and did not cover project 41 onward. Opening a lead dialog during its preview read also issued a second identical request.

## Change

- Overview and other hidden project views no longer start lead previews. Switching away pauses the queued work; requests already sent are allowed to finish.
- On the Projects page, `IntersectionObserver` requests previews only for cards within the actual viewport plus a 150-pixel margin. Scrolling/searching can load any authorized project, including those beyond the old 40-project cutoff. At most three preview reads run concurrently. Browsers without this API fall back to bounded concurrent reads of connected project cards while the tab is active.
- A preview and dialog share only an identical request **currently in progress**. The key includes console generation, office, CSRF binding, project location, mutation revision and cursor. Each consumer gets its own result copy. The entry is removed when the request settles, including failure; reopening a completed dialog makes a fresh server request.
- Successful lead grant/revoke invalidates that project's read revision before loading the updated list. Older previews cannot overwrite the new names, and a post-write read cannot join a request started before the write.
- Office changes, permission loss, refresh and page exit disconnect the observer, discard queued previews and clear pending-sharing references. Existing version checks reject late results. Existing card preview summaries remain in tab memory as before; this does not add a new TTL or persistent data/authorization cache.

Other reads and mutations use their original API paths. In particular, the new sharing helper is not applied to writes, notifications, exports or movement operations. Backend authorization remains authoritative on every dispatched request.

## Reproducible browser measurement

A 1366 × 768 Chromium scenario used 60 synthetic projects, deterministic mocked API replies and a 40 ms delay per lead response. It first opened Overview, waited for background work, then opened Projects and searched for Project 60.

| Measurement | Before | After |
| --- | ---: | ---: |
| Lead requests while Projects is hidden | **40** | **0** |
| Additional requests on first opening Projects | 0, already prefetched | **9**, visible/nearby cards |
| Total lead requests through the final search | 40 | **10** |
| Project 60 lead preview loads | No | **Yes** |

The durable result is reduced request count and correct on-demand coverage. Overview DOM readiness measured 216 ms before and 146 ms after, but this single mocked scenario is **not a production/SQL latency benchmark**; no percentage loading-time guarantee is claimed. Request counts vary with viewport, filters and scrolling. Ignored evidence: `output/admin-optimization-6/before.json`, `after.json` and `benchmark.mjs`.

The first implementation used the full content element as observer root; a longer measurement exposed excess prefetch. The final implementation uses the viewport, and tests now wait for the queue to settle before checking request counts.

## Verification

Six new browser cases cover mobile/desktop viewport loading, no hidden requests, project 60, pending preview/dialog deduplication, a fresh denial after reopening, three-request concurrency, pausing hidden-tab work, office changes and mutation-revision races. Existing admin cases cover scoped navigation, common-area guards, unified creation, visit register/timeline, Excel export and permission-loss cleanup. Role/allocation workflows, project creation and register loading are checked separately.

All **22 focused/regression browser cases pass**. The complete unit suite passes **505 tests with one existing skip and zero failures**. TypeScript, targeted ESLint and whitespace checks pass. No new unit test duplicates the browser/network assertions.

A separate browser smoke against the real localhost SQL-backed application signs in as the existing synthetic administrator, opens the three project cards and a successful lead dialog, then signs out its own session. Its evidence contains only counts/success flags in `output/admin-optimization-6/actual-smoke.json`, not names or session data.

All measured data and mocked mutations are synthetic. Retained presentation records/photos/history/outbox are preserved; no real email is sent and no email worker starts. Changes remain local, without a commit or push.

## Next candidate

Guard photo loading still rebuilds/reloads thumbnails during some list-page and language rerenders. A later optimization should preserve in-flight/loaded images only within the current authorized list generation, with concrete duty keys, strict memory bounds, and clearing on refresh/scope/denial. This batch does not implement that cache or alter guard behavior. Large register/history queries and cold DPAPI/helper startup remain separate measured candidates.
