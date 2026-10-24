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
