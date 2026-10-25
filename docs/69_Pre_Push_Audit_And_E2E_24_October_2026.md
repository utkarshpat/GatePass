# Pre-push audit and regression verification — 24 October 2026

This reviews the complete pending change set after revision 97fea7c: range summaries, paged guard/reception queues, private thumbnails, deferred QR loading, Action centre categories/notifications and gesture image previews. The user explicitly requested fixes, E2E coverage and a final push. Earlier no-push notes describe previous task boundaries.

## Findings fixed during this audit

| Finding | Fix and regression evidence |
|---|---|
| Inline Notify was blocked by the Node development RPC allowlist, although the SQL and PowerShell allowlists already permitted it. Earlier mocked browser tests did not exercise that boundary. | Added gp.RemindPendingApproval to LocalDevelopmentApiClient. A real browser/API/SQL test now checks guard project duty, a separate admin session and guard common-area duty against the actual owned notification outbox. Only one new queue row is created; recipient and approval state remain unchanged. |
| Reception search debounce left prior paging/count metadata and accepted an older in-flight result until the next search request started. | Search input immediately invalidates the prior generation and clears rows, cursor, page counts and filter signature. A delayed-response E2E test verifies that old rows cannot reappear and the new query starts without a cursor. |
| An open image preview could retain the old source after the underlying image URL changed or an ancestor was hidden. | The viewer closes and removes its image source on either transition. Mobile and desktop cases also verify parent-dialog closure, focus restoration and original-image reuse. Images inside links/buttons retain their existing action. |
| Action centre did not listen to the admin project selector's scope-change event. | Added console-project to the scope-close hooks alongside office and guard duty changes. |

## Coverage and audit scope

- Forward migrations 091–096 were reviewed for bounds, current scope authorization, payload projection, paging and notification idempotency. Already applied migrations were not rewritten.
- Service contracts reject injected actors/recipients, invalid IDs/cursors/counts and malformed output. Guard pass-return requests remain denied; reception owns returns.
- Notify is an explicit action to the original approval host. Queued/processing mail is not duplicated; cooldown and retry receipts remain serialized with visit/outbox locks. TEMP_ID manager notices are informational, not pending host approvals.
- The new live reminder E2E uses independent sessions and owned synthetic fixtures. It verifies current scopes, an unchanged recipient and approval state, audit receipts, foreign-office denial and recipient-injection rejection. No email worker is started.
- Action centre E2Es cover paging, fixed tabs, keyboard switching, mobile/regional layout, accessibility, double-click suppression, cooldown, lost-response retries with the same key and protected-row clearing after notification authorization denial.
- Gesture previews cover actual Chromium two-finger input, touch/mouse dragging, wheel zoom, reset, keyboard access, source/visibility lifecycle and no extra photo request.
- Existing full-suite coverage includes registration/approval/cancellation, guard entry/exit/history, reception printing/return/correction, role scopes, visit-register sorting/export, counts, deferred QR loading and scoped live refresh.
- The 1,000-row performance case runs Chromium and an independent Microsoft Edge session and compares paged lists, unseen search results, movement/count updates and old-vs-range SQL summaries.

## Verification

| Check | Result |
|---|---|
| Unit/contract suite with CI coverage | 544 passed, 1 existing opt-in skip; 0 failures |
| CI coverage | Lines 97.13%, branches 89.41%, functions 93.59%; required thresholds passed |
| Focused image/search/Action centre regressions | 7 passed |
| Real reminder flow plus notification UI regressions | 4 passed |
| Scoped reminder SQL suite | Passed: scopes, dedupe, replay, cooldown, retry, expiry/revocation and execute-only authority |
| Lint / TypeScript / migration integrity | Passed; 96 sequential hashes verified |
| Locked dependency audit | 0 vulnerabilities |
| Count reconciliation | 36 office/project/date scopes and four office charts matched SQL; 0 mismatches. Retained 23 October Noida total remains 43. |
| Secret scans | Source snapshot and Git history passed; redacted reports only |
| Complete browser suite | **147 passed**, 0 failures/skips, 7.9 minutes; retained presentation case enabled |

The final 1,000-record Chromium/Edge run observed a committed entry in the independent reception session in **991 ms**. Both entry/exit counts matched. The same run measured 31 legacy summary calls at **3,961 ms** versus one range request at **214 ms**, with identical totals. These are local samples, not deployment guarantees.

Ignored evidence is in output/improvements-9/push-audit-*.log/json/xml. Generated release-candidate files are ignored and exclude development adapters, fixtures, private data and credentials.

## Limits

These are local browser/SQL results. Physical printer/camera behavior, production SSO/proxy/mail deployment and larger production execution-plan/load measurements remain deployment acceptance work. Browser tests queue only owned synthetic notifications; they do not prove real external mail delivery. Retained presentation records and the older 23 October fixture are preserved; cleanup is restricted to the current invocation's fixture IDs/prefixes.

## Local follow-up fixes — no push

The subsequent bug hunt reproduced four additional browser lifecycle issues. The user authorized fixes and explicitly prohibited pushing this follow-up. The preceding full-suite and push results remain historical results for revision 7b8d578.

| Finding | Local fix |
|---|---|
| A delayed reception Action centre detail could replace a newer selected visitor. | Capture the selection generation before fetching details; ignore both late success and error results after another selection or office change. |
| A restored guard page could retain its cached roster when context authorization failed. | Clear protected cards, photos, profiles, dialogs, scope and paging state before reauthorization; invalidate outstanding reads and reset their busy state. Version context requests so an older success cannot reverse a newer denial. Retry remains available. |
| Action centre polling stopped permanently after a persisted page restore. | Suspend and clear polling on pagehide, then install exactly one timer on persisted pageshow. Closed panels make no periodic requests; pending scope selection is invalidated on workspace reset. |
| Quiet Action centre refresh removed the focused Notify button. | Preserve row nodes when data is unchanged. When rows change, restore focus to the same record/action and preserve scroll; fall back to the selected category when that row disappears. Reminder cooldowns still update. |

Regression coverage is in tests/browser/workspace-lifecycle-regressions.spec.ts. It covers delayed details, unchanged/reordered/removed focused rows, duplicate restore events, closed-panel idleness, authorization loss with an older roster request in flight, retry, overlapping context requests and assignment recovery from an empty scope. Persisted lifecycle events are simulated in Chromium; this does not claim native back/forward-cache coverage on every browser.

The related guard/reception/Action centre/image/SSE/workflow browser run passed **45 tests**. After adding the overlapping-context and empty-scope recovery case, the final focused run passed **all 5 regression tests**. Lint, TypeScript and whitespace checks passed. Evidence is retained under ignored output/improvements-10/. These changes introduce no migration or dependency and do not start an email worker. Existing presentation data is retained. No commit or push is authorized for this follow-up.

### Second follow-up: return selection, scope cleanup and retry recovery

The next bug hunt reproduced four further issues. Their local fixes retain the no-push instruction:

- A completed pass return may reopen its original details only if that operation closed the same selected detail generation and no newer selection, explicit closure, office change or authorization denial occurred during the final list refresh. Normal return completion still reopens the updated receipt.
- Authoritative reception context replacement and protected-workspace clearing emit workspace-reset, immediately closing and invalidating the prior Action centre instead of waiting for its next poll or a selector change event.
- History pagination treats 403 as authorization loss and clears protected workspace/history state. A temporary 500 still retains a clearly marked partial history result.
- A successful authorized Action centre load clears its denied flag, restoring periodic polling after a manual retry following either read or Notify denial.

tests/browser/reception-followup-regressions.spec.ts covers both denial paths, office replacement and denial, history 403 versus 500, and normal/newer/explicitly closed detail selection during delayed return refresh. Before the fixes, seven cases failed and the two normal-behavior cases passed; ignored evidence is in output/improvements-11/regressions-before.log.

Verification: all nine new regression cases passed in the related browser batch; that batch passed 44 cases and exposed one outdated lifecycle-test expectation. Since reception scope revalidation now intentionally closes the old panel, the duplicate-restore test now waits for both contexts and reopens the panel before checking that exactly one timer runs. The final lifecycle run passed all five cases, verifying all 45 selected browser cases across the two runs. This includes the real authenticated SQL lookup using an owned synthetic fixture, printing/reprinting, return/correction, mobile/desktop layouts, calendar/count behavior, image previews, SSE and the preceding lifecycle fixes. No application-code change was needed after the batch. Final lint, TypeScript and whitespace checks passed. Evidence: output/improvements-11/browser-fixed.log, lifecycle-final.log, lint-final.log and typecheck-final.log. This follow-up remains local; no commit or push was performed.

### Third follow-up: complete admin rosters and concurrent scope changes

The five additional admin findings are fixed locally, with the no-push instruction retained:

- Guard assignments and project grouping use the full authorized project catalogue instead of silently discarding projects after the first 60. Per-project duty reads remain limited to four concurrent requests; the guard catalogue can fall back to any readable authorized project. Paging rejects repeated/empty continuation responses and fails visibly if its safety bound is reached, rather than declaring incomplete results complete.
- Common-duty reads reuse the bounded full catalogue reader. Transient failures retain the preceding authorized roster when available and report a loading failure; a full refresh with no cached roster shows no invented availability counts. Authorization failures clear protected workspace data. A failed common-duty response is never converted into a successful empty assignment collection.
- Register reads refetch the last valid page when a live result shrinks below the selected page. Every response is checked against the current scope/request generation. At most three reads occur in one refresh, handling another shrink during correction without an unbounded retry loop. Normal pages still use one read; exports retain their separate consistency checks.
- Every console reset invalidates pending initialization generations. Old context successes and errors, including responses arriving after pagehide, cannot overwrite or clear a newer authorized workspace.
- Console resets emit the shared workspace-reset event, clearing Action centre rows/counts and cancelling outstanding reads immediately when admin authorization changes.

tests/browser/admin-followup-regressions.spec.ts covers project 61 and its guard/search/counts, the four-request concurrency bound, common-duty 503 recovery versus 403 clearing, shrinking pages including zero matches and consecutive corrections, old context success/error, pagehide, and a scope denial received after the user opens Action centre. All ten regression cases failed on the prior code; output/improvements-12/regressions-before.log records that baseline.

These changes introduce no migration, new endpoint, package or email worker. Roster API traffic still scales with the authorized project catalogue; concurrency stays bounded and incomplete datasets are not reported as complete availability. This is a correctness fix, not a new server-side roster aggregation endpoint.

Verification: **47 related admin browser tests passed**, including all ten new regressions, real scoped admin identities, register reads through SQL, lead grant/revoke, guard allocation/removal, common-area creation, project creation, onboarding controls, Excel export, mobile/desktop layouts and permission boundaries. The live write case creates and cleans only its invocation-owned fixture; retained presentation records are preserved. Evidence is in output/improvements-12/browser-fixed.log. No commit or push was performed.

Final exact-count checks also passed for both the 61-project case (one assigned guard, zero free guards, 60 uncovered projects) and transient common-duty failure (previous assigned/free counts retained). These two cases were rerun after adding the exact-stat assertions; evidence is in output/improvements-12/counts-final.log. Final lint, TypeScript and whitespace checks passed. The local runtime was restarted with the updated admin script; no production deployment occurred.

### Fourth follow-up: correction ownership, profile lifecycle and duty visibility

The four further findings are fixed locally; the existing no-push instruction remains in effect:

- Mistaken-return correction captures its office and detail generation before writing. Its final list refresh reopens the corrected receipt only while that selection remains current. A newer visitor, explicit close, office replacement or access denial prevents the old operation from reopening or painting a dialog. Successful correction and audit semantics are unchanged.
- Pending reception profile reads are invalidated on profile closure, context replacement, office change, protected-workspace reset and pagehide. Both response rendering and error handling check the captured profile generation, context and office; an older success cannot reopen data after authorization loss.
- Guard-duty expiry inputs use IST explicitly. Today only derives from the authorized office date; custom input and duration presets are serialized consistently regardless of browser timezone. The dialog labels its timezone. Staff-role expiry retains its existing separate input behavior.
- Per-project duty denial immediately removes cached duties for that project and marks coverage incomplete. Readable projects remain available. Guards without visible duties show Availability unknown; global Free and uncovered-project counts become unavailable, and the Free filter is disabled. Denied projects are omitted from duty cards and disabled in allocation options. A successful refresh restores complete counts and choices. Unknown duties are never treated as empty or retained as authorized details.

Regression coverage is in tests/browser/action-scope-regressions.spec.ts: fourteen cases for unchanged/newer/closed correction selection, success/failure after office replacement, late profiles after denial/office replacement/pagehide, Today only in Los Angeles/Tokyo/Kolkata, India midnight and custom IST input, and mixed project visibility with recovery. Against the previous script, twelve cases failed and two normal-behavior cases passed; the baseline is recorded in output/improvements-13/regressions-before.log. API writes in these new cases are intercepted synthetic fixtures.

Verification: **72 related browser tests passed** in 3.5 minutes, including all fourteen new cases and the previous admin/reception/lifecycle regressions. The batch also exercised scoped SQL reads, invocation-owned admin writes, historical reception lookup, print/reprint/return/correction, calendar/count behavior, exports and mobile/desktop layouts. No Playwright retries were configured. SQL diagnostics included two ListProjectHeads deadlock messages; their live workflow completed successfully. Existing expected denial diagnostics are retained in the log. Evidence: output/improvements-13/browser-fixed.log. Final lint, TypeScript and whitespace checks passed. New regression writes are mocked; live cases retain their invocation-owned cleanup. Existing presentation records remain preserved. No new dependency, migration, endpoint or email worker was introduced; no real email, commit or push was performed. This targeted result does not replace the historical full-suite result above or claim production/device acceptance.

The local localhost:8443 runtime was restarted with the updated scripts. Both rendered admin and reception pages were checked for the new fixes; startup stderr is empty. No production deployment occurred.

### Fifth follow-up: live duty loss and obsolete context/notification responses

The four further findings are fixed locally, with the prior no-push instruction retained:

- Guard live duty changes and duty/queue authorization denials invalidate pending context, queue, profile and pass reads before clearing scoped dialogs and rows. The shared workspace-reset event closes Action centre and clears its counts/actions immediately, including when the panel opened after the background read started. Changed/empty assignments clear the previous queue before reading a new scope. Unchanged duties and transient duty-read failures retain the current authorized panel. Scan availability and retry controls follow the resulting scope.
- Reception initial and restored context reads share an initialization generation, invalidated on pagehide, context replacement, protected-workspace clearing and login. Both success and error results must still own that generation. The API's automatic 401 redirect also checks ownership for these context reads, so an obsolete session response cannot log out a newer valid workspace. Current authorization failures retain the existing sign-in behavior.
- Admin project selection captures its console generation before the try block and checks it in the error path as well as the success path. A superseded scope denial or server error cannot clear a newer refreshed console or paint its status; a current denial still clears protected state.
- Action centre tracks panel lifecycle separately from read/poll generations. Closing/reopening, category/scope replacement and denial invalidate old panel ownership. A reminder's late denial cannot blank a newer panel, while a current denial still clears the active panel even if an ordinary refresh occurred during Notify. Confirmed reminder outcomes remain cached across closure; uncertain retries retain their existing idempotency key. Closing a panel does not cancel or manufacture a duplicate notification write.

Regression coverage is in tests/browser/live-scope-lifecycle-regressions.spec.ts. All new API writes are intercepted synthetic fixtures; no real notifications are sent. Persisted lifecycle events are simulated in Chromium rather than relying on native back/forward-cache admission.

Verification: the initial eighteen-case baseline failed twelve cases and passed six normal-behavior cases on the preceding scripts (output/improvements-14/regressions-before.log). The first fixed run passed all twenty expanded cases. The related workflow batch then passed **94 browser tests** in 4.6 minutes, covering earlier fixes, scope/counts, guard allocation/queue/language/profile, image viewing, reception print/return/correction/history, SQL lookup, admin controls, authentication, accessible mobile/desktop layouts and SSE behavior (browser-fixed.log).

Review also added recovery checks ensuring a successful authorized queue retry re-enables scanning after denial, in both paged and legacy queues. After this final guard adjustment, **29 tests passed** in 1.2 minutes: all **22 new regression cases** plus seven existing guard allocation/paging cases (recovery-final.log). This verifies 116 distinct selected browser cases across the successful batches; the seven existing guard cases were repeated on the final script. No Playwright retries were configured. **17 related unit/contract tests passed**, as did final lint, TypeScript and whitespace checks. Evidence is under ignored output/improvements-14/, including unit-fixed.log, lint-final.log and typecheck-final.log. This is targeted verification, not a new claim that the entire global suite was rerun.

No migration, endpoint, package or email worker was introduced. New regression writes are fully intercepted; existing live cases retain their owned-fixture boundaries and presentation data is preserved. The original bad-symptom harness and findings are retained as historical evidence. No real email, commit or push was performed.

The local localhost:8443 runtime was restarted with the final scripts. Rendered guard, reception and admin pages all returned HTTP 200 and included their expected fix markers; startup stderr is empty. No production deployment occurred.

### Sixth follow-up: guard validity, detail presence, approval polling and lookup ownership

The four further findings are fixed locally; the no-push instruction remains in force:

- Guard pass validity has a bounded, selection-owned deadline timer. Expiry repaints the status/allowed styling and hides Entry without fetching the pass/photo again or replacing the selected visitor. Entry handlers also check validity before writing, including programmatic activation. A cached VALID scan outcome cannot override an elapsed deadline. Visibility/focus resume rechecks elapsed time; closing/replacing a pass clears its timer. Existing server-authorized Exit and Reconcile actions remain available, including for an inside visitor after expiry. Common-area identity verification and pending approvals also lose their allowed/valid appearance on expiry.
- Admin detail presence is derived from the current detail's isInside field instead of the older register row. If that field is absent, the badge says Unknown rather than assuming inside/outside. Register-only print/return metadata retains its separate existing contract. Related SQL verification found that ADMIN Digital ID details still used legacy visit presence while the register used employee project presence. Forward migration 097 aligns the authorized GetVisitDetail projection with the existing register calculation, preserving its actor/scope checks, locks, transaction and execute-only grants. Reception and guard presence semantics are unchanged; applied migrations 001–096 were not rewritten.
- Email status polling uses one shared scheduling helper. Finishing sign-in, decision or revoke releases busy and rearms polling when an authorized active request remains; failure/timeout cannot permanently consume the timer. The status read does not retry a decision write or replace its idempotency key. Pagehide suspends scheduling and clears the timer; persisted restoration resumes it. Expired requests stop polling and remove actionable/downloadable media.
- Reception lookup clears its rows/cursor and disables/hides Load more immediately when input changes. Continuation requires a cursor bound to the same trimmed query and office. New non-continuation reads clear old rows before loading; outstanding older pages retain their generation/office checks and cannot append after a newer search. QR credentials are not stored in the cursor binding.

Regression coverage is in tests/browser/validity-status-regressions.spec.ts: nineteen cases covering direct/scanned/pending/common pass expiry, authorized exits, timer replacement and visibility resume, current/unknown admin presence, valid and invalidated lookup paging, approval failures from 503/network/timeout, retained decision keys, one polling timer after retry and pagehide idleness. All writes in these new cases are intercepted; no real decision, movement or email is performed. Six focused checks failed on the preceding scripts (output/improvements-15/regressions-before.log); all nineteen cases passed on the fixed scripts (regressions-fixed.log).

Verification: **121 related browser tests passed** in the broader admin, guard, reception, approval, lifecycle, SSE and workflow batch. The final full unit run passed **544 tests, with one existing skip and zero failures**. Lint, TypeScript, whitespace, SQL syntax and all 97 sequential migration hashes passed. The initial unit invocation lacked the required GATEPASS_SHARP_PATH; rerunning with the configured local sharp path produced the successful final result. Evidence: output/improvements-15/browser-fixed.log, unit-final.log, lint-final.log, typecheck-final.log and sql-syntax.log.

The new database/tests/Test-AdminDetailPresence.ps1 runs the actual RPCs through gp_api_runtime with an invocation-owned synthetic fixture. Its eight checks cover Digital ID entry/exit, ordinary visitor presence, unchanged reception/guard reads, out-of-scope denial and direct-table denial. Before migration 097, the Digital ID project-entry assertion failed; after applying 097 locally, all eight passed. The existing guard-duty SQL suite also passed all 19 cases. These database tests create and clean only their owned data; retained presentation fixture GP02-F8C7F73D68364B00BCA4 remains untouched. Evidence: sql-presence-before.log, sql-presence-fixed.log and sql-guard-duties.log. An additional historical Test-VisitReads.ps1 attempt stopped before its cases because its setup inserts an already-present VISITS_READ capability into the current fixture; its finally cleanup ran. That old harness is not reported as passing (sql-visit-reads.log).

The localhost:8443 runtime was restarted with the final scripts. Guard, reception, admin and approval pages returned HTTP 200 with their expected fix markers; startup stderr is empty (runtime-final.log and main.*.log). No email worker, real email, commit, push or production deployment occurred. All four sixth-follow-up findings are fixed locally; earlier local fixes are preserved.

### Seventh follow-up: movement permissions, status recovery and obsolete authentication responses

The four seventh-hunt findings are fixed locally. The existing no-push instruction remains in effect, and earlier fixes are preserved.

- Guard movement controls have explicit permission freshness. A confirmed movement or 409 invalidates that snapshot until a fresh authorized detail/verification succeeds. Focus, visibility and expiry repainting cannot restore invalidated Entry/Exit/Reconcile controls or green allowed styling, and direct handler activation also checks freshness. An uncertain movement failure retains its original operation key and permits an explicit retry. A freshly authorized inside visitor can still exit after expiry.
- Email status reads recover from transient network/timeout, 408, 429 and server failures using delays of 5, 10, 20 and at most 30 seconds. A successful read restores the single normal 30-second poll. Retry scheduling retains only deadline/backoff metadata while failed reads clear protected content. Authentication/client failures and terminal status stop retries; known expiry and pagehide also stop them. These retries perform reads only and do not repeat approval/revoke writes or create additional email work.
- Reception API authentication effects require ownership of the current workspace context, office and initialization generation. Detail, photo, preview, queue/list, history, lookup, profile, calendar and reminder reads additionally bind their component/request generation. Obsolete 401 responses cannot clear a newer workspace before the caller's own stale-response check runs. A current 401 still redirects to sign-in. Mutation idempotency and server authorization are unchanged.
- Approval validity uses its own generation-owned deadline timer, armed immediately after detail rendering, independently of optional host photo loading. Expiry hides actions and clears media even during a slow image read or busy operation. A late photo cannot reappear after expiry; the decision handler also rejects expired activation. The existing login-operation busy guard remains intact.

Coverage in tests/browser/action-recovery-regressions.spec.ts is based on affected paths rather than a target number of findings:

| Area | New cases | Coverage |
| --- | ---: | --- |
| Guard | 4 | Conflict and confirmed-movement/read-failure invalidation, fresh-read recovery, uncertain retry key, focus, authorized exit after expiry |
| Email status and validity | 14 | Host/self/external recovery, first-load failure, network/timeout, bounded backoff and reset, 401/403/404, terminal state, known expiry, pagehide, slow photo and expired handler activation |
| Reception | 13 | Old detail after office/selection/close, photo/preview/reminder, list/queue replacement, closed history, changed lookup, profile/calendar office replacement, current 401 |

Five focused cases failed on the preceding scripts, covering all four findings and both guard paths (output/improvements-17/regressions-before.log). The first fixed run passed 42 cases: the initial 23 new cases and all 19 preceding validity/status regressions (regressions-fixed.log). The reception request-timeout unit fixture now supplies the workspace context used by its extracted API helper; its original timeout/status assertions remain intact. New regression writes are intercepted. No new endpoint, migration, dependency or email worker is introduced in this follow-up.

The first broader run exposed three temporary UTF-8 text regressions from an edit; the text and original line-ending conventions were restored. One new calendar test was corrected to exercise the supported visibility-resume path instead of clicking the hidden legacy Today button. An existing scoped-admin workflow now waits for the authorized overview to finish initializing before opening its office selector. That run is retained as browser-fixed.log (145 passed, five failed), rather than reported as successful. The final browser run checks the corrected source and tests.

Final verification: **150/150 selected browser tests passed**, including all 31 new regressions, the preceding 19 validity/status regressions, guard allocations/paging, reception calendars/history/printing/returns/correction, host/holder approval and revocation, lifecycle/scope changes, full-size images, SSE and existing public/employee/staff workflows. This includes the owned-fixture authenticated SQL lookup and visitor email revocation cases; retained presentation data is preserved. The final full unit run passed **544 tests, one existing skip, zero failures**. Lint, TypeScript and whitespace checks passed. Evidence: output/improvements-17/browser-final.log, unit-final.log, lint-final.log, typecheck-final.log and timeout-unit-fixed.log. This is the listed targeted browser coverage, not a claim that every project feature has been exhaustively audited.

The verified localhost:8443 runtime was restarted as PID29376 with the final scripts. Guard, reception and approval shells returned HTTP 200 with their final fix markers; UTF-8 text checks passed and startup stderr is empty (runtime-final.log, runtime-utf8.log and main.*.log). All four seventh-hunt findings are fixed locally. No additional migration, real email, production deployment, commit or push occurred.

### Eighth follow-up: entry deadlines, setup recovery and search ownership

The five eighth-hunt findings are fixed locally, preserving the preceding fixes and the no-push instruction.

- Public/employee/manual-intake and staff transport helpers enforce a 30-second deadline through both fetch and response-body decoding. Every path clears its timer, preserves safe HTTP statuses and releases its caller's busy state. A stalled Digital ID image can reach the existing explicit Retry card action; image request sharing remains intact. No timed-out write is automatically repeated. Registration retries retain the same job payload, participant bindings and client key.
- Staff setup still clears the one-time proof and passwords on pagehide. Restored or proof-less setup pages now disable the unusable form, explain that the original link must be reopened, and offer Go to sign in. Setup responses are generation-owned, so late success/failure cannot replace that recovery state. An uncertain setup timeout also offers sign-in without issuing another setup write. No raw proof is persisted to restore the UI.
- Staff search input immediately invalidates its results, cursor and request generation. Continuation requires the query that created the cursor; current paging disables Load more until completion. Older success/error responses cannot append results or apply authentication effects after a new query. Same-query continuation remains available.
- Admin profile context/scope reads capture both workspace and profile generations. Both successful rendering and failures, including API-level 401 redirects, require current ownership. Scope parameters are captured before awaiting, and an obsolete context result cannot start a second read using a newer scope. Closing/resetting the profile invalidates pending reads; a cleared scope cannot initiate profile reads. A current denial retains its protected-content clearing behavior.
- Host input immediately clears old options and the current selection. Option handlers validate their query/project generation and cancel the pending debounce when committing a choice. Detached/stale options cannot replace a newer selection; short queries do not send unnecessary reads. Existing old-response fencing remains intact.

Seven focused browser cases failed on the preceding scripts, covering the five findings and all three stalled-request surfaces (output/improvements-19/regressions-before.log). The initial fixed browser run passed 25 cases: 18 new cases plus the seven existing Digital ID image/result-binding cases (regressions-fixed.log). Six new transport unit cases verify header/body deadlines, timer cleanup and safe HTTP error behavior for both helpers (entry-unit.log).

Final regression coverage in tests/browser/entry-search-regressions.spec.ts covers public/staff/card deadlines, manual-intake route isolation, staff bootstrap and setup timeout, unchanged registration retry payload/key, restored setup and late setup replies, staff cursor binding/continuation and stale query replies, current versus obsolete profile denials, cleared scopes, and host option ownership/short queries. Browser mutations use synthetic intercepted requests; existing live onboarding cases create and clean only invocation-owned test accounts. No additional migration, endpoint, dependency or email worker is introduced.

Verification: **67 related browser cases passed**, including 25 new regression cases, real guard-account setup/login/reset and audit checks at mobile/desktop sizes, admin pages/permissions/rosters, public and employee workflows, manual intake, visitor devices and Digital ID/result binding. A final cleared-scope profile guard and regression were added, then **all 26 final regression cases passed** on the final source. This verifies 68 distinct selected browser cases across the two successful runs, not 93 independent cases. Evidence: output/improvements-19/browser-fixed.log and regressions-final.log. The final full unit run passed **550 tests, one existing skip, zero failures**, including the six new transport unit cases; lint, TypeScript and whitespace checks passed (unit-final.log, entry-unit.log, lint-final.log and typecheck-final.log).

The localhost:8443 runtime was restarted from verified PID29376 to PID2392. Staff entry, public registration and admin shells returned HTTP 200 with the final fix markers and correct UTF-8 text; startup stderr is empty (runtime-final.log and main.*.log). All five eighth-hunt findings are fixed locally. Retained presentation data and prior local fixes are preserved. No real email, additional migration, production deployment, commit or push occurred. This is targeted verification of the listed changes and related paths, not an exhaustive claim about all remaining project bugs.


## Ninth follow-up — guard authentication responses and Digital ID presence

The three ninth-hunt findings are fixed locally, preserving the preceding 34 fixes and the no-push instruction. Evidence is retained in `output/improvements-21/`; the original findings and bad-symptom harness remain in `output/improvements-20/`.

- Guard API authentication failures now check the request's CSRF identity, workspace/initialization generations, office and caller generation before redirecting. Profile, paged/legacy queues, allocation fan-out, pass detail/scan, full photos/thumbnails, movement follow-up, reminders and duty/context reads provide the appropriate current-request predicate. Current401 failures still return to sign-in. Existing request deadlines and operation keys remain intact.
- Forward migration098 extends the authorized Digital ID OWN detail projection to office presence and corrects `wasInsideAtCancellation`, including audit metadata and same-key receipts. It retains cancellation's existing authorization, expected-pass fence, locks and preservation of occupancy.
- Action centre expiry checks now use the visit that owns actual project/visitor presence. A valid daily Digital ID entry no longer promotes yesterday's unrelated expired ID into the office follow-ups or count. Genuinely expired and cancelled occupants remain visible for reconciliation. The person-wide function used to block unsafe reception returns is unchanged.
- The local migration runner now supports097/098. The migration manifest verifies98 sequential hashes; raw source hashes for applied001–097 match the pre-fix audit snapshot. Migration098 was applied only to the local test database. The new19-case SQL suite and the preceding admin-detail suite are registered in the SQL CI runner.

Validation:

- Three focused browser cases failed on the preceding guard script (old profile401 and paged/legacy queue401). The fixed new suite passed15/15, then the broader selected browser run passed70/70, including those same15 plus allocation, paging boundaries, name readings, validity, live-scope lifecycle and Action centre cases. These are70 distinct cases, not85.
- The new SQL suite completed19 cases before the fix with nine failing assertions across the two presence findings, then19/19 passed after098. Coverage includes owner/admin/reception presence, multiple project entries and partial/final exits, historical expiry false positives and counts, real expired occupants for office/guard views, occupied cancellation and idempotent replay, true audit metadata, ordinary visitor/empty presence, authorization boundaries and exact fixture cleanup.
- Existing SQL validation passed30 cancellation cases (including concurrent entry/approval/cancel and backend integration),19 guard duty cases, eight admin presence cases and all five pass-return check groups. The sibling-request presence block and concurrent return/entry safety remain correct.
- Full unit run:550 passed, one existing skip, zero failures (551 total). TypeScript, ESLint, migration hashes and whitespace checks passed. The updated SQL CI runner parses successfully; its complete isolated CI job was not rerun locally.

The SQL test fixture was corrected during setup to avoid the PowerShell Move alias and to update a visitor's approval deadline consistently when accelerating its expiry. An initial generated migration draft retained an older footer because the source files had mixed line endings; SQL rejected it and rolled the transaction back. The corrected final migration applied atomically in five parsed batches. The failed draft log is retained as `migration.log`, and the successful application is `migration-fixed.log`; the failure is not reported as a successful run.

The main localhost:8443 server was verified as PID2392 and restarted hidden as PID7732 with the fixed guard code. Runtime shell checks confirm HTTP200, final guard predicates and valid UTF-8; anonymous guard navigation still returns303 to sign-in, and startup stderr is empty. Shell-marker inspection uses a synthetic placeholder cookie and does not claim a real authenticated session. The first anonymous marker probe followed that expected redirect to the login shell; the final check explicitly distinguishes anonymous redirect and shell inspection.

All new browser writes are intercepted. SQL suites use synthetic owned fixtures and remove their exact data/principals. Final local checks show097/098 present, zero temporary presence-test principals and all26 retained presentation visits still present. No real mail, production deployment, commit or push occurred. Refresh an already open local page to load the updated script.
