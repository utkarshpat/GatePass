# Browser E2E, counts and remaining edge cases — 24 October 2026

> This is the earlier 24 October validation snapshot, completed before commit/push was requested. The later [final browser verification and presentation guide](67_Final_Browser_Verification_And_Presentation.md) records the fresh run, new retained 25 October bookings and final source push. Earlier counts below remain dated evidence.

Scope: local development application with the retained presentation data, browser workflows, independent SQL count comparisons and the uncommitted security fixes from [audit 65](65_Browser_Data_Exposure_Audit_24_October_2026.md). No production deployment, commit/push or real email delivery is included. Retained presentation records, photos, assignments and history remain available. Disposable test fixtures clean up only records owned by their run IDs.

## Findings fixed during this run

| Finding | Reproduction | Fix and regression |
| --- | --- | --- |
| Admin Registered total and charts omitted cancelled registrations | Retained Noida on 23 October had 43 registrations: 13 pending, 24 approved, 4 denied and 2 cancelled. The card/donut showed 41. A synthetic 10-record dataset with 4 cancelled showed 6. | Registered uses the backend total. Donut, status bars, daily stacked columns, percentages and tooltips include cancelled records. The four summary cards remain Registered/Pending/Approved/Denied. Tests cover one/two-day ranges and 390/1366 px. |
| Guard combined-view allocation choices could repeat | A valid row repeated across adjacent pagination responses produced duplicate choices for the same project duty. Cards were already deduplicated, so the incorrect options were easy to miss. | Merge allocations by `(kind, dutyId)` as well as visits by visit ID. A regression verifies four unique cards and two distinct non-placeholder allocation choices for the affected visitor. |
| Registration Back text could briefly fail contrast when re-enabled | Both widths failed the existing Axe check in the first full run. Disabled-to-enabled color animation can leave enabled text temporarily in the disabled color. Stable-state probing alone did not reproduce the failure. | Registration action buttons no longer animate text/background colors; transform/shadow/border transitions remain. New tests measure contrast immediately after re-enabling, and existing public-form Axe checks pass in the focused rerun. |

The new count/overlap regressions were run before their fixes: the two cancelled-count cases and overlap case failed; the reception case already passed. The overlap test initially included the empty chooser placeholder in its count; its final assertion explicitly counts actual allocation options.

## Validation status

| Verification | Result |
| --- | --- |
| Full unit suite after final code changes | **520 passed, 1 skipped, 0 failed**; 521 cases, about 58 seconds. The skipped case tests non-Windows rejection and belongs to the Linux job; this run is Windows. |
| First full browser suite, retained-data test enabled | **124 passed, 2 failed**, 126 cases, 7.3 minutes. Both failures were the public-form contrast issue above; preserved as baseline evidence. |
| Focused browser rerun after fixes | **21 passed**, including the two original failures, six added cases and the guard/workflow files, about 1.5 minutes. |
| Final complete browser rerun | **132/132 passed, zero failed/skipped, in 7.2 minutes**, 37 files, retained-data test enabled. This final single run includes all six added cases and the two formerly failing accessibility cases. |
| Independent SQL/API count audit | **36 office/project/day combinations matched** for Noida/Bengaluru/Chennai/Pune and 23/24 October. Compared five registration status totals, two current-presence measures and register total: 288 numeric comparisons. |
| Admin visible totals/donut | **4/4 office views matched** the independent 23 October totals after the fix. |
| Installed Chrome + Edge, actual form and SQL | **8/8 workflow assertions passed**: submit, automatic guard update/count, admin count, host approval, entry, timeline, exit and Inside queue removal. |
| Final Reception/history/actual XLSX check | **5/5 assertions passed**: today's four KPIs and rendered rows matched SQL; 23 October history contained 43 registrations; the actual 23–24 October workbook contained 49 distinct registrations and reported 49 exported. |
| ESLint, TypeScript, migration integrity | Passed; **90 migration hashes** unchanged. |

The final supplemental Reception check used the visible History dialog for 23 October; its dashboard is for today, and `#reception-date` is an internal hidden input. An initial probe incorrectly tried to fill that hidden input and timed out; correcting the probe to use the real UI resolved it without an application change.

The first SQL snapshot was taken while the broad suite was creating/cleaning disposable SQL fixtures. It included temporary records that disappeared before later API calls. Those mismatches were **not** counted as application defects; the stable rerun after fixture cleanup matched. Aggregate counts must be compared against the same data state.

## Retained data count snapshot

Office-wide registration counts at the stable post-workflow snapshot:

| Office | Visit date | Registered | Pending | Approved | Denied | Cancelled | Register total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Noida | 23 Oct 2026 | 43 | 13 | 24 | 4 | 2 | 43 |
| Noida | 24 Oct 2026 | 6 | 4 | 2 | 0 | 0 | 6 |
| Bengaluru | 23 Oct 2026 | 1 | 0 | 1 | 0 | 0 | 1 |
| Bengaluru | 24 Oct 2026 | 0 | 0 | 0 | 0 | 0 | 0 |
| Chennai | 23/24 Oct 2026 | 0 each day | 0 | 0 | 0 | 0 | 0 |
| Pune | 23/24 Oct 2026 | 0 each day | 0 | 0 | 0 | 0 | 0 |

Numbers are a snapshot, not permanent expected seed counts. Project filters intentionally show a subset of their office; Digital IDs without a project must not be naively added to every project total.

Reception's final Noida dashboard showed **Registered 6, Approval pending 4, Inside (matching) 0, Pending return 12**. All four matched independent SQL counts. Pending return spans office history and therefore can exceed today's registration count. Admin's current project presence remained 1 because its occupant belongs to an earlier visit day; that is consistent with today's Reception matching count of 0. The actual exported workbook for 23–24 October had **49 data rows plus its header**, with no duplicated registration IDs.

## What each count means

- **Admin Registered:** requests within the selected office/project and visit-date range, including cancelled requests. `total = pending + approved + denied + cancelled`. Counts are registrations, not unique people.
- **Admin charts:** the same four stored request statuses. A pending record from yesterday may still have stored status PENDING even though its pass has expired. Reception's actionable pending count has a different definition.
- **Admin current presence:** current recorded presence in the selected scope, independent of the chosen historical date range. The range view uses the final response's current presence, not the sum of presence across dates. Project visits and distinct employees with project presence remain separate measures.
- **Reception Registered / pending / Inside (matching):** match the current loaded date/search/type/status/print filters, using the full loaded page chain rather than just the first 50 rendered rows. Pending excludes expired, returned and revoked/non-pending passes. Inside deduplicates the same employee across a Digital ID and project pass, but preserves independent visitors.
- **Reception Pending return:** office-wide unreturned printed passes across dates, as the tile tooltip explains. It deliberately remains an office total while a name/date filter narrows the table.
- **Guard:** the count is matching unique visit/pass records for the chosen duty and queue. All allocations deduplicates a visit appearing under several duties; it does not combine different pass requests simply because they share a person's name. The UI may show `24 / N` while all N records remain searchable. Common areas are verification-only; project movements require a concrete authorized project duty.
- **Register page/export:** total is the complete authorized filtered result, not the number of DOM rows. Each page holds at most 50 records. Export reads every page and refuses changed datasets, same-count edits or duplicate records rather than silently producing a partial file.
- **History/timeline:** registration-history counts are registrations in the selected dates. Timeline counts are movement events, so an entry followed by an exit produces two events, not one visitor.

## Two-browser retained workflow

Actual installed Chrome ran Guard 1; Edge ran the Noida admin and a separate visitor/host context. A real visitor form submitted **Neha Kulkarni, Orion Business Services**, Project 1, Noida, using synthetic camera frames and an `example.invalid` contact address. No real camera or mail worker was used. The normal application may queue notifications; nothing was externally sent by this test.

| Step | Registered | Pending | Approved | Project visits inside |
| --- | ---: | ---: | ---: | ---: |
| Before submission | 5 | 4 | 1 | 1 |
| Visitor submitted | 6 | 5 | 1 | 1 |
| Assigned host approved | 6 | 4 | 2 | 1 |
| Guard recorded entry | 6 | 4 | 2 | 2 |
| Guard recorded exit | 6 | 4 | 2 | 1 |

The new card reached the independent guard view **3,071 ms after clicking Submit** without manual refresh. This is one local measurement, not a latency guarantee. The Inside queue removed the visitor after exit, and the retained timeline contains entry plus exit. The record/photo/history are kept for presentation.

## Test-case coverage and remaining work

| Area / edge case | Covered here | Remaining boundary |
| --- | --- | --- |
| Registration and Digital ID | Public forms, mobile/desktop accessibility, optional company/devices, employee auth, cross-office approval flow, photo crop/review and card rendering/retry; actual retained visitor submission | Real camera permissions/device switching and physical hardware are not exercised by synthetic frames. |
| Requests and decisions | Scoped host login, explicit approve/reject, expired/revoked/cancelled rendering, idempotent retry keys, separate email capability purposes, real SQL visitor revocation | Exhaustive simultaneous approval vs cancellation vs entry races need the dedicated SQL concurrency suites; they were not all rerun by the browser command. |
| Counts and paging | 24-card and 50-row DOM boundaries, 51/60/61/120/121-record mocked cases, full matching totals, empty results, cancelled totals, unique-employee Inside, historical expiry and office-wide returns | Large sustained datasets and mutations during every pagination boundary are not exhaustively stress-tested. Offset-based live guard pagination is not a durable database snapshot. |
| Search, sorting and export | Full scope/filter preservation, ascending/descending controls, live SQL register reads, page transitions, stale office response isolation, stable multi-page export and changed-dataset rejection | A 10,000-record browser export/memory test and performance under real production volume remain separate load tests. |
| Roles and assignments | Platform/India/location/project boundaries, scoped creation, leads/guards, common-only guard behavior, assignment revocation, no stale office leakage, setup/reset/login flows | Live enterprise SSO/directory outage and production role propagation require the deployed identity system. |
| Real-time and failures | Actual Chrome/Edge workflow, independent-session committed update, SSE burst coalescing, editing deferral, disconnect/poll fallback, hidden page behavior, timeout recovery, fresh access denial | Current SSE is process-local and capped at four streams. Multi-node delivery, proxy buffering and higher connection concurrency are not validated deployment guarantees. |
| Dates and history | India rollover despite another browser timezone, retained 23 October history, validity expiry, independent current presence, movement timeline and pass returns | Extended clock skew, browser/system clock rollback and multi-day unattended sessions need dedicated longer runs. |
| Email and printing | Browser email/status/photo layout, signed-link isolation, decision/revoke flows, print/reprint handoff, device-return confirmation | Actual recipient delivery, tenant policies and physical printer output were not performed. No email worker was started. |
| Security and privacy | Prior 47-check exposure audit and security regressions remain documented in audit 65; scopes/CSRF/error behavior also run in the browser suite | Production HTTPS/proxy/cookies, real SSO, full stored-XSS fuzzing and the optional Google name-provider privacy agreement remain deployment checks. |

Recommended follow-up before a shared production release: run the dedicated SQL race suites in an isolated test database, validate the HTTPS/SSO/mail/proxy environment, then perform a realistic load/volume test. These are outstanding validation tasks, not newly confirmed bugs. No claim is made that every possible input, device or concurrency schedule has been tested.

### Concrete remaining scenarios

These extend the browser coverage above. Some have unit/SQL coverage in the repository, but the complete combined scenario was not newly exercised in this run.

| ID / priority | Setup and action | Expected result / assertion |
| --- | --- | --- |
| EC-01 / High | Two independently authenticated guards submit Entry for the same approved pass at the same time, then repeat with the same and different operation keys. | One effective entry/presence change; retries have stable outcomes, no double timeline event or count increment. |
| EC-02 / High | Race host approval, owner revocation/cancellation and guard Entry for one request. Repeat with Entry committing first. | Decisions serialize consistently. A committed revocation prevents later entry; cancellation while inside follows the existing policy. No contradictory active/revoked state or lost occupancy. |
| EC-03 / High | Open four eligible SSE sessions, then a fifth; create one visit and remove one guard's permission. | Extra sessions use the documented fallback, authorized views refresh, revoked access clears data, and connection/SQL work remains bounded. The current four-stream cap must be part of the test expectation. |
| EC-04 / High | Interrupt the response after a real submission commits, then retry; separately restart the development host while a form is open. | No duplicated registration or notification from a retry. Expired process-bound session/intake state requires clear recovery rather than silently accepting stale credentials. |
| EC-05 / High | Populate a visitor name/company/purpose with HTML-like text and spreadsheet formula prefixes; view it in every role, email template and exported workbook. | Text remains inert; no script runs, generated XML remains valid and workbook values are literal strings rather than formulas. Do not send these test emails externally. |
| EC-06 / Medium | Use owned datasets at 49/50/51 and 9,999/10,000/10,001 records, exporting on a memory-constrained browser while data changes between pages. | Correct page boundaries and totals, documented export cap enforced, no truncated success, changed snapshots rejected, acceptable memory/time measured. Smaller multi-page cases and the backend cap are already covered. |
| EC-07 / Medium | Submit at the exact India midnight boundary while browser timezone differs; change the browser clock backwards during an open card. | Server-authoritative validity/visit day, correct expiry and clear refresh behavior; current presence is never summed as historical registrations. Ordinary rollover/expiry already has browser coverage. |
| EC-08 / Medium | On a real Android/iPhone, deny camera permission, rotate/change device and navigate away/back while capture is open. | Actionable error/retry, stopped camera tracks, no lost/cross-person photo binding and usable mobile layout. Synthetic camera and Chromium viewport tests do not establish this hardware behavior. |
| EC-09 / High for deployment | Run production HTTPS behind the actual proxy with enterprise SSO, then expire its session and revoke a role during an open workspace. | Secure cookie/Origin/proxy rules, no cached private content, fresh authorization denial and recoverable sign-in; proxy must not buffer SSE indefinitely. |
| EC-10 / Medium | In an isolated mail environment, verify provider timeout, retry, eventual delivery, recipient binding and forwarded status/revoke/approval links; inspect the received person image. | Correct recipients and token purposes, no duplicate logical notification, explicit decision/revoke confirmation, expected image rendering. Actual external delivery was deliberately outside this run. |
| EC-11 / Medium | Disable/fail the optional name provider and switch regional languages while scrolling a large roster. | English originals/photos stay usable, stale language results never overwrite the new selection, and private fields are not sent to the provider. Existing bounded-cache/provider-failure tests cover part of this scenario. |

High-priority concurrency/deployment checks should be completed before a shared production release. Physical printing and real-device checks should be completed before relying on those specific devices in operation.

## Evidence

Ignored local artifacts under `output/final-e2e-24-oct/`: `unit.log` / `final-unit.log`, `full-browser.log/xml` (first baseline), `count-red.log/xml`, `focused-fixes.log/xml`, `final-full-browser.log/xml`, `count-results.json`, `two-browser-workflow.json`, `reception-export-results.json`, `lint.log`, `typecheck.log`, `migrations.log` and `test-inventory.txt`. Count scripts and browser probes are retained alongside them. Reports store counts/statuses and diagnostic flags; session cookie values, passwords and raw photo payloads are not written to these JSON reports.

Final state: no unresolved failure in the completed 132-case browser suite, 520 passing unit cases or the recorded count/workflow probes. Local application fixes and documents are available for review; **nothing was committed or pushed**. The remaining scenarios above are explicitly outside this validation's completion claim.
