# List rendering, lazy media and near-real-time refresh

Implemented on **24 October 2026**, following [phase 6](Performance_Optimization_Phase_6.md).

## Pagination and deferred work

- Guard Expected/Inside cards render 24 at a time. Load more adds 24 and shows the displayed/full count. Changing search, allocation or queue resets the display depth. Quiet refresh retains the current depth. Photos use the viewport plus a 100-pixel margin; regional names retain their existing near-viewport batching.
- Admin Projects & areas renders 24 matching entries at a time, with Load more and displayed/full counts. Search covers the complete authorized catalogue and resets display depth. Lead previews remain restricted to visible/nearby project cards with at most three concurrent reads.
- Reception renders 50 matching rows at a time. Load more adds 50. Filters and KPIs count all matching rows, including rows not yet rendered. Filter changes reset display depth; background refresh preserves it.

These are **DOM/display pagination** limits. Existing backend cursor/offset chains are still consumed to completion for complete totals, scope selection and combined-allocation deduplication. Load more reveals already fetched rows without another network read. This reduces layout/media work; it does not claim bounded total list transfer or replace server pagination. Register, audit, staff and lookup retain their existing server pagination. A future bounded list API needs separate total-count/search contracts.

Guard list replacements now commit atomically after all selected duty pages succeed. Unchanged quiet refreshes do not rebuild cards or reload their photos/names. Access denial clears protected rows and requires an explicit access reload. Existing office/console generation checks discard outdated responses.

## Freshness

Admin, guard and reception perform read-only refreshes every **20 seconds** while visible and idle. Returning focus/visibility triggers a debounced read, with a two-second suppression window. This is polling, not instantaneous WebSocket/SSE delivery. Actual availability depends on request duration, visibility, user activity and network health.

- Guard refreshes authorized duties and then the selected allocation/queue. Existing SQL authorization-version fencing invalidates the target guard's old sessions when common duties are assigned or removed. The next read clears protected cards; the guard must sign in again to obtain the changed duty. Polling does not bypass this rule. Catalogue/visit changes within an unchanged authorization scope can refresh automatically.
- Admin rechecks current capabilities first, then refreshes the active overview, project/area catalogue, guard roster, visit-register page or audit log. Staff editing is excluded. Visit register retains its selected page; audit refresh returns to its latest first chunk. Unchanged catalogues avoid unnecessary project rerenders.
- Reception reloads the selected office/date list through its existing atomic page chain. Return/print workflows and calendar refresh remain coordinated with their busy states.
- Hidden pages, open dialogs, focused input/textarea/select fields and active relevant operations defer polling. Runs never overlap within the controller. Page exit suspends timers; back/forward restoration resumes them and reloads authorized context.

No background mutation, persistent identity cache, notification worker or new service/dependency is introduced. Open pass/detail dialogs pause background updates; their existing explicit refresh and fresh server authorization remain authoritative.

## Verification

Unit checks exercise visibility/readiness, overlap prevention, failures, focus, page lifecycle and editing guards. Browser checks use 60 guard cards and 120 reception rows to verify initial page size, full counts, no extra Load more reads, lazy photos and timed arrival of new backend rows. Name-reading checks verify hover tooltips on the regional text/asterisk and removal of the persistent warning.

Pre-push focused verification: **26 browser cases passed**, covering guard names, combined allocations, admin lead previews, reception layout/calendar, live pagination and access-denial recovery. The full unit suite passed **508 tests, one existing skip, zero failures**. Full repository lint, TypeScript and 90 migration hashes also passed.

Two installed, visible browsers (Chrome and Edge), with independent staff sessions and real local SQL, verified a newly created Noida common area appearing in the second administrator's catalogue without reload after **19,537 ms**. Audit history was visible in that second session. Earlier assignment checks confirmed SQL migration 075 invalidates the target guard's existing session; protected rows cleared on the next poll. A fresh guard sign-in then listed and authorized the new duty. These checks retained the realistic rehearsal areas and assignments. Ignored count/flag evidence: `output/live-pagination/two-browsers.json`; no real email worker was started.

The complete browser suite is run after publishing this batch, with final results recorded in the release validation note.

No production latency percentage is inferred from mocked timing. Retained presentation records/photos/history are preserved.
