# Workspace optimization, Action centre and full size images

Local implementation: 24 October 2026. This continues [report 67](67_Final_Browser_Verification_And_Presentation.md). Shift handover was removed after the user clarified that staff hand over organization-provided devices. No handover table, permission transfer or acknowledgement workflow was installed.

## What changed

| Area | Current behavior |
|---|---|
| Overview | One SQL range procedure returns totals and a zero-filled daily series for up to 31 days. Current presence is returned once, separately from historical registrations. |
| Guard queue | Fetches the first 24 records. Load more fetches another page using submitted-time/visit-ID cursors. All allocations is deduplicated in SQL; concrete allocations accompany each card. |
| Reception dashboard | Fetches the first 50 records. Search, effective approval status, person type, print/return status and inside-only filters run in SQL. Counts cover the full matching result. |
| Quiet refresh | Reloads the depth already loaded by the user. Existing scoped SSE invalidation and polling recovery continue to perform authorized reads. |
| Grid photos | Near-viewport requests use 192 × 256 JPEG thumbnails. Details and print/card rendering retain their original images. |
| QR camera | The 362,150-byte decoder is absent from initial guard/reception HTML. A scanner loads one versioned same-origin asset; concurrent opens share its pending request. Failure supports an explicit retry. |
| Action centre | A button opens an on-demand follow-up dialog with a fixed top category switch and counts on each tab. Selecting a row opens the existing details workflow. |
| Full size images | Tap an image inside a guard, reception or admin dialog. The viewer auto-fits the image, supports pinch or wheel/trackpad zoom, drag to move and double-tap/double-click to reset. Only a close icon remains; keyboard zoom, arrows, Home and Escape are supported. Closing restores the existing dialog and focus. |

Queue order is newest submitted time first, then visit ID. A cursor does not freeze the operational database; refresh picks up new submissions. Changing filters restarts at the first page.

## Action centre

- **Approval overdue:** still pending, with a pending current pass, no final return, validity remaining and submission at least 15 minutes old. The threshold uses server time.
- **Expired but inside:** validity has ended and recorded presence still says inside. Staff verify the record and follow the existing exit/reconciliation policy.
- **Pass return pending:** at least one print job was dispatched and there is no final return receipt, including older visits. Reception handles returns; authorized admins can monitor the follow-up. Guards have no return category or return count, and direct requests for that category are denied by both API and SQL.
- Categories can overlap; their counts do not sum to a unique-person total.
- Guard chooses a concrete duty; common areas remain verification-only. Admin sees authorized projects within the selected office. Reception sees its granted office.
- Category tabs stay visible while the list scrolls. Labels and counts share one line; regional text is 2px smaller underneath. Narrow screens can scroll the bar sideways without stacking the count onto a third line. Active styling, category counts, English/regional labels and keyboard Left/Right/Home/End switching replace the dropdown and duplicate count line. Guard has two tabs; reception and scoped admin monitoring have three.
- The panel fetches 24 rows at a time and refreshes while open every 20 seconds and on returning to the visible tab. A closed panel does not poll.
- Pending rows include an explicit **Notify** button beside the record. It queues the existing approval email for the original host without opening details. Queued/processing mail is not duplicated; the existing five-minute cooldown and actor/client-key replay receipts apply. Network retries reuse the same key. Guard project/common-area duty, reception office and admin report scope are rechecked by SQL. The client cannot supply a recipient. There is no per-row status-prefetch fan-out; status appears after a click. TEMP_ID is not an approval request and has no approval reminder.
- It never automatically approves, rejects, revokes, returns a pass, changes a duty or records an exit. Existing actions retain their permission checks.
- Authorization denial clears protected rows/counts. SQL rechecks current scope and each materialized record before returning results.

## Images and authorization

The viewer reuses the image already fetched by the authorized details dialog. Zoom creates no extra photo/card API call and no public image URL. It uses the original detail image rather than the roster thumbnail. Closing the underlying dialog also closes the viewer; closing the viewer removes its image source.

Thumbnails have a process-memory content cache: five-minute lazy expiry, at most 128 items of at most 64 KiB each, and four concurrent transformations. Both sides of every guarded photo read still authorize the current duty/pass. A hit saves transformation work; it does **not** bypass authorization, private-storage reads or source integrity checks. Caller and cached buffers remain separate. No new browser storage contains private photos.

## Database and API

| Forward migration | Purpose |
|---|---|
| 091 | GetOperationalSummaryRange: bounded aggregation, daily zero filling and one current-presence snapshot. |
| 092 | ReadGuardQueue / ReadReceptionQueue: bounded payloads, keyset cursors and full-filter counts. |
| 093 | Scope-checked Action centre reads; no handover schema. |
| 094 | Fresh per-record Action centre fencing, dated follow-up projection and distinct reception person-key prefixes. |
| 095 | Reception-owned pass-return follow-ups: guard category access denied in SQL, with no guard return counts. |
| 096 | Inline approval reminders: fresh workspace/visit scope, immutable original host, queue dedupe, five-minute cooldown and idempotent retries. |

Applied migrations 001–090 were not rewritten. The hash manifest and local runner include 091–096. Runtime roles retain procedure-only access.

| New POST route | Contract |
|---|---|
| /api/admin/summary-range | Office, optional project, from/to; returns typed totals, daily series and current presence. |
| /api/guard/queue | Office, ALL or concrete duty, Expected/Inside, search, optional cursor; up to 24 rows plus full total. ALL is never a movement target. |
| /api/reception/queue | Office/date/search, effective status, type/print filters, inside-only, optional cursor; up to 50 rows, full matching counts and office-wide pending-return count. |
| /api/operations/remind | Workspace/office/concrete duty, immutable visit ID and client key. No recipient input; current scope, pass, deadline and notification relevance checked in SQL. |
| /api/operations/actions | Workspace, office, concrete guard duty or office scope, category, optional cursor; bounded follow-ups and category counts. |

Real contexts advertise queuePaging=true. Clients without that capability keep the earlier list protocol. Previous list routes remain for compatibility and reception History. Production API action composition includes the new typed reads; earlier identity/storage/hosting deployment gaps remain documented in the system handbook.

## Measurements

The owned fixture adds 1,000 synthetic records without sending mail. Cleanup removes only its unique run prefix and preserves retained presentation records.

- Guard: **24 initial cards in one request**, then 48 after Load more.
- Reception: **50 initial rows in one request**, then 100 after Load more; full-result counts remain correct.
- Server search finds records outside the first displayed page in both workspaces.
- Entry/exit from Chromium reach an independent Microsoft Edge reception session with correct counts. One sample observed entry in **1,893 ms**.
- With the 1,000-row fixture, a local sample measured the old 31-request summary chain at **3,787 ms**, versus **214 ms** for the range request. All 31 days and aggregate totals matched.
- A deterministic synthetic camera texture, normalized through the app pipeline, measured **404,399 bytes** for the 960 × 1280 original JPEG and **14,614 bytes** for the thumbnail: **96.4% fewer bytes**. Transform time was 25.2 ms; the subsequent memory read was 0.69 ms.

These are local observations, not production latency guarantees. Image results depend on content.

Query work removes repeated per-day and per-allocation/page operations and aggregates summary totals once in SQL. Full-filter counts still evaluate authorized matching rows. No speculative index, stale occupancy cache or database setting change was added. Local AUTO_CLOSE and AUTO_SHRINK were already disabled. Additional indexes should follow larger-data execution-plan/IO measurements.

## Verification

Final verification:

- **539 unit tests passed**, one existing opt-in case skipped; no failures.
- **143 complete browser regression tests passed**.
- After the final guard cursor/permission-clear correction, **12 focused browser tests passed**, including the new paging-boundary case, guard allocations, full size images and live SQL queues.
- **36 office/project/date count comparisons** and all four office Overview/chart checks matched SQL; no mismatches. The retained 23 October Noida register remains 43 visits.
- Lint, TypeScript checking, all **94 migration hashes**, whitespace checks and redacted scanning of the source snapshot passed.

The final guard audit caught a stale-cursor interval during debounced search and stale page-count metadata after duty loss. All list resets now clear paging metadata immediately; focused regression coverage verifies both cases.

New coverage includes range boundaries and total consistency; foreign-scope denial; queue cursors, duplicate cards and malformed counts; real SQL comparison with the legacy lists; Action centre paging/deferred loading/mobile-desktop accessibility; thumbnail isolation, concurrency and authorization loss; QR deduplication/failure retry; image tap/keyboard/zoom/focus restoration and no extra image request.

Ignored evidence: output/improvements-9/final-unit.log, final-full-browser.log/xml, queue-performance.json, thumbnail-metrics.json, migration logs, final-counts-audit.log/count-results.json, final-boundaries-browser.log/xml and lint/typecheck/hash reports. action-centre-preview.png uses synthetic names.

## Follow-up verification: return ownership and gesture viewer

- Reception-only return correction: 23 targeted unit tests and six browser tests passed. Direct SQL verification confirmed zero guard return counts and denial of guard UNRETURNED reads. All 95 migration hashes passed.
- Image viewer: three browser cases passed on mobile and desktop, including actual two-finger touch input, touch and mouse dragging, wheel zoom, double-tap/double-click reset, keyboard operation, Hindi text sizing, accessibility, parent-dialog preservation and focus restoration. Zoom reused the original blob without additional photo/card requests. Visible plus/minus, percent, Fit and Actual size controls were removed.
- Updated lint and TypeScript checks passed. Evidence: output/improvements-9/gesture-browser.log, gesture-lint.log, gesture-typecheck.log and image-gestures-390.png / image-gestures-1366.png (synthetic images only).

## Category switch follow-up

Five focused browser cases passed for mobile/desktop paging, fixed category-bar position, keyboard switching, record navigation, empty states, permission-denial clearing and real SQL guard/reception scope checks. The included Hindi guard case verifies the two permitted tabs, regional text sizing and accessibility. Lint and TypeScript checks passed. Synthetic previews and logs: output/improvements-9/action-tabs-*.png and action-tabs-*.log.

## Inline notification follow-up

Forward migration 096 adds gp.RemindPendingApproval and is included in both procedure allowlists and the local migration runner. Existing applied migrations remain unchanged. The queued notification uses HOST_APPROVAL_REQUEST for EXTERNAL / EMPLOYEE_PROJECT; it does not resend requester receipts or manager informational notices.

Targeted validation: 34 unit tests passed; SQL checks passed for project/common-area/reception/admin scope, wrong-office/area denial, scope loss on replay, queue deduplication, same-key replay, cooldown, failed-mail retry, revoked pass, expired deadline, immutable recipient/approval and execute-only runtime permissions. The final three Action centre browser cases passed, alongside the six unaffected reception/live-SQL browser cases in the preceding run. Browser coverage verifies mobile/desktop inline clicks, double-click suppression, cooldown, lost-response retry with the same key, retained list/dialog, Hindi labels and accessibility. Evidence: output/improvements-9/inline-reminder-*.log and inline-notify-guard-hi.png. SQL tests use owned fixtures and do not run a sending worker.

## Remaining checks

The real-device/deployment checks in [report 66](66_Final_E2E_Counts_And_Edge_Cases_24_October_2026.md) still apply, including actual printers, mobile cameras and production proxy/SSO behavior. Reception History retains its existing full selected-range list protocol. Larger 5,000/50,000-row datasets, long-running concurrent insert/delete pagination and production plan distributions remain follow-up measurements.

The initial implementation was kept local. The subsequent audit and user-authorized final push are recorded in [report 69](69_Pre_Push_Audit_And_E2E_24_October_2026.md).
