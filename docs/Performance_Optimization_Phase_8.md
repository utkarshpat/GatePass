# Cost-aware live workspace invalidations

Implemented on **24 October 2026**, following [phase 7](Performance_Optimization_Phase_7.md). The objective is to improve entry visibility while reducing repeated full-list work, using the existing local Node/SQL host. There is no new paid service, broker, dependency, database table/migration, SQL trigger or notification worker.

## Behavior and cost controls

- Guard, admin and reception use a same-origin **POST SSE stream**. Fetch streaming preserves the existing Origin/Host, session-cookie and CSRF-header checks without putting credentials or subscription tickets in a URL. The selected workspace/office/project is authorized against SQL before opening a stream.
- The stream carries only `ready` or `invalidate` with `{}`. It contains no names, visitor/pass identifiers, photos, counts or scope IDs. A signal schedules the normal freshly authorized API reads. It cannot grant access or replace a detail/movement permission check.
- Successful local SQL RPCs notify the in-process bus after the procedure returns. Registration notifies only on `SUBMITTED`, never the intermediate `NEEDS_CREDENTIALS` result. A notification failure cannot fail/replay an already committed write. Existing ordinary API errors do not publish an event.
- Office subscriptions, concrete project subscriptions, common-area rosters and office Digital ID changes use separate internal topics. An administrator's unfiltered role list is never used to widen access: office-wide signals require a successful office-only scope read. A selected project gets project-scoped signals. Guards receive their currently authorized duties; reception is limited to an authorized office.
- Signals within 250 ms coalesce per subscriber, and the browser combines a burst into one pending refresh. Inputs/open dialogs defer that read. Hidden tabs and page exit abort the stream. Scope changes abort the previous stream and ignore its late data.
- With a healthy stream, full safety refreshes occur every **60 seconds**, plus a catch-up read after connection/reconnection and normal focus refresh. Without a stream, ordinary **20-second polling** remains. Stalled streams are detected after 45 seconds without bytes; reconnect uses jittered 5–60-second backoff. Capacity responses back off for approximately a minute. Unsupported/denied streams stop retries for the current scope and retain polling.
- A stream has a **120-second lease**. Reopening requires fresh authorization and performs a catch-up read. Heartbeats every 15 seconds carry no SQL query. There are at most **four streams total and two per session**, including pending authorization reservations. This leaves twelve of the local host's existing sixteen connections for ordinary work; excess viewers use polling. Slow readers are disconnected instead of accumulating an unbounded send queue.
- Routing metadata is limited to **4,096 visit IDs** with a one-hour expiry and **4,096 numeric project/office mappings**. It stores no identity fields or credentials and authorizes nothing. Names/photos/API response payloads are not cached by this feature.

Current integration is in the existing explicit **local development UI host** (`tools/start-dummy-sso.ts`). Production API hosting, HTTP/2/proxy buffering, aggregate connection budgets and multi-instance delivery require deployment-specific integration; this change does not claim those are configured.

## Measured results

| Scenario | Observation |
| --- | --- |
| Actual local SQL, two isolated guard sessions, 65.004-second idle window | Old controller: **3 duties + 3 visitor reads**. SSE: **1 duties + 1 visitor read**. |
| Controlled browser clock, three idle minutes | **3 full safety refreshes**, compared with the old schedule's 9; no repeated stream opening in this simulated window. |
| Visible installed Chrome + Edge; actual visitor form, photo normalization and SQL commit | Submission click to guard card visible: **2,584 ms**, with **one guard list reload** and a healthy stream. |
| Synthetic maximum routing maps + four streams with 505 topics each, forced-GC Node heap comparison | **~1.09 MiB** retained heap increase. This excludes the existing app, HTTP sockets/OS buffers and SQL helpers. |
| Synthetic 10,000 matching invalidations | **~3.3 ms** to coalesce/enqueue; this is not an end-to-end throughput or production SLA benchmark. |
| Idle heartbeat application payload | 13 bytes every 15 seconds = **52 bytes/minute/stream**, excluding HTTP chunking, TCP/TLS and other traffic. |

The actual idle comparison replaced only the browser refresh controller with the committed phase-7 version for the baseline. Both sessions used the same current server and real SQL. The measured window began after initial loading/stream setup and ended before lease renewal. It therefore excludes initial connection authorization, two-minute renewals, reconnection catch-up reads, session touches, mutation traffic and helper/directory work. **Six reads becoming two is not a claim of 67% total SQL, hosting or financial savings.** Connections have memory/hosting overhead; the short local sample does not establish a currency estimate. The fixed caps and fallback avoid requiring more infrastructure for this release.

## Reliability and boundaries

This is a **single-process invalidation bus, not a durable event log**. No extra database write/outbox/broker is introduced solely for browser refresh. Process restart, connection gaps, writes from another instance/direct SQL, a timed-out commit or missing/expired routing metadata can miss a fast signal. Connection catch-up and periodic fresh reads repair those gaps. Submission through this local server has its office/project scope directly in the successful call. Other lifecycle writes signal when their scope is already known from the call or bounded routing metadata; otherwise they rely on safety refresh.

The two-minute lease bounds subscriptions, but it is not an authorization cache for protected data. Guard common-duty authorization-version fencing remains intact: an invalidated session fails the next protected read and must sign in again. A tiny invalidation carries no protected payload. Open detail dialogs continue using their explicit refresh and fresh action checks.

The Chrome–Edge rehearsal retained **Riya Malhotra**, Meridian Consulting, Project 1/Noida, with a synthetic camera image and the associated request/photo/history. The visitor's example-domain contact information is synthetic. The mail outbox can contain its normal queued notifications; no mail worker was started and no real email was sent. Existing presentation records are preserved. Owned integration fixtures remain disposable and clean only their exact run IDs.

## Verification and evidence

The complete unit suite passes **519 tests with one existing skip and zero failures**. Focused browser coverage passes 18 distinct cases, including idle read budgets, burst coalescing, field editing, fallback/reconnect, lazy pagination, combined allocations and admin preview regressions. A real SQL-backed two-session case verifies automatic committed catalogue delivery plus foreign-office, missing-CSRF and malformed-scope rejection. Unit checks cover resource limits/reservations, slow readers, leases/cleanup, routing expiry/eviction, committed-only publication, callback failure without write replay and browser lifecycle isolation.

The complete browser run enabled the retained presentation case and passed **118 of 119** cases. The new live test failed because its string-form Playwright wait invoked browser `eval`, correctly blocked by the application's CSP. The test now uses a function predicate with erased TypeScript declarations; CSP was not relaxed. The final **seven-case browser rerun passed**, including that real two-session case, all SSE controller cases and pagination/access-denial recovery. Therefore **119 distinct browser cases are verified across the broad run and focused rerun**, not a claim that the first broad attempt was entirely green. No unresolved test failure remains.

Audit also reproduced a routing bug: a partial common-area roster row without a numeric project ID could overwrite an already known visit/project route, delaying a later approval update until safety polling. The routing map now preserves the known immutable route for the same office until expiry. The regression was observed failing before the fix and passing afterward. Fresh authorization was unaffected. Malformed array-valued workspace selectors are rejected rather than coerced into strings. Stream errors/backpressure release their bounded slots.

The final complete unit rerun again passed **519 tests plus one existing skip**, with zero failures; focused routing/resource checks were also rerun after the final audit. Repository lint, TypeScript and all 90 migration hashes pass. Ignored evidence is under `output/sse-cost/`: `two-browser-entry.json`, `idle-budget.json`, `memory-budget.json`, focused/unit/full browser logs and JUnit results. Measurements contain counts/timings and synthetic identifiers, never session tokens or private photo bytes.

Implementation references: [MDN SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events), [Fetch readable streams](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream/getReader) and [Node HTTP streaming/backpressure](https://nodejs.org/api/http.html#responsewritechunk-encoding-callback). No third-party realtime SDK is installed.
