# Post-push bug audit - 22 October 2026

Audited baseline: e8467118ca75550d83971cd02dcd584c65e97f61 on private utkarshpat/GatePass main. Remote main was verified to match that commit. The user requested pushing the existing snapshot first, then finding bugs. This report is local and not included in that push. No implementation fixes have been applied in this audit.

## Push checks and limits

- Repository private status verified through authenticated GitHub API.
- Staged source and pre-existing Git history passed redacted Gitleaks scanning.
- Typecheck, lint and all 62 source migration hashes passed.
- Fresh pre-push unit run: 376 passed, zero failed/skipped.
- Generated screenshots/PDF packages, private media, credential inventories and runtime keys were excluded from the commit.
- This was targeted adversarial review with focused reproductions, not a declaration that every branch or production integration has been audited. A green unit run did not cover the cases below.

## 1. [P1] Cancelled external/project visitor loses the exit-reconciliation control

Source: database/migrations/060_project_presence_conflict_checks.sql:40; inherited behavior also occurs in migration 054.

The duty detail wrapper overwrites canReconcileExit with a predicate restricted to TEMP_ID. For non-TEMP_ID requests it retains ordinary canEnter/canExit, but discards the reconciliation permission already computed by the underlying visit detail. A visitor inside a project whose visit is cancelled/revoked has neither normal exit nor the permitted reconciliation action in the guard UI.

Actual SQL reproduction, using a temporary execute-only gp_api_runtime principal and unique owned fixtures:

1. Grant the fixture guard RECONCILE_EXIT.
2. Enter an approved EXTERNAL visit through RecordGuardDutyMovement.
3. Cancel that individual visit using its authorized host through CancelVisit.
4. Compare the original scoped detail with ReadGuardDutyPass.
5. Execute an explicitly reasoned RECONCILE exit through the same restricted API identity.

Observed: isInside=true; canExit=false; original detail canReconcileExit=true; duty detail canReconcileExit=false; authorized reconciliation RPC succeeds and closes presence. The backend can perform the action, but the UI hides it because its response lost the flag.

Impact: cancellation/revocation while occupied strands the ordinary guard UI and leaves recorded project presence unresolved until a separate authorized action is performed.

Recommended correction: preserve/recompute reconciliation for non-TEMP_ID project visits while keeping common duties non-moving and retaining the explicit capability/reason checks. Add EXTERNAL and EMPLOYEE_PROJECT cancelled/revoked-occupant cases. Use a new forward migration rather than editing applied 060.

Evidence: ignored tmp/audit-cancelled-visitor.json and tmp/repro-cancelled-visitor.ps1. Owned SQL fixtures and the temporary principal were removed after the run.

## 2. [P2] Refreshing an external status link loses the visitor's authorization context

Source: src/app/email-request.js:2-4 and load() at line 11.

The external capability is read from the fragment and immediately removed from browser history. It survives only in the current script's memory. Reloading the now-clean URL loses it; the code calls the internal request/detail endpoint and shows employee sign-in, which an external visitor cannot complete.

Browser reproduction against the actual page/script with synthetic intercepted responses:

1. Open /request/{id}#link={synthetic-capability}; see Approval pending.
2. Confirm the address no longer contains its fragment.
3. Reload.

Observed request sequence: external/detail, external/image, then request/detail after reload. The external page becomes Sign in to continue with the corporate login visible.

Impact: a visitor refreshing a pending approval page cannot continue or download the eventual pass without finding and reopening the original email link. There is no in-page refresh/polling path that addresses this loss.

Recommended correction: design a narrowly scoped short-lived server-side holder session/exchange that survives navigation without persisting the raw capability in unsafe storage, or another explicitly reviewed refresh-safe capability policy. Continue hiding the capability from logs/referrers and never turn public reference into authorization. Add reload/back-forward/expired-link tests.

## 3. [P2] Reception Today remains yesterday across India midnight

Source: src/app/reception.js:110; currentDate is cached when setContext runs.

Today copies state.context.currentDate, which is populated at initial context load and never refreshed for a new day. A reception workstation left open overnight therefore queries yesterday even after the operator explicitly presses Today.

Clock-controlled browser reproduction using the actual reception page/script:

- Initial context date: 2026-10-22.
- Advance browser Date to 2026-10-22T18:40:00Z, or 2026-10-23 00:10 IST.
- Press Today.
- Observed picker and list request still use 2026-10-22 instead of 2026-10-23.

Impact: today's expected arrivals are omitted and previous-day rows/counters appear under an action named Today.

Recommended correction: refresh authoritative date context on Today/new-day/focus as appropriate, update date bounds coherently, and preserve an intentionally selected historical date except when Today is requested. Test India midnight independently of browser timezone.

## 4. [P2, conditional configuration] Supported long booking horizon breaks external receipt rendering

Sources: src/email/EmailLinkCodec.ts:8; src/email/NotificationEmailWorker.ts:28; database/migrations/023_registration_project_host_options.sql:30.

SQL registration options explicitly support FutureVisitHorizonDays from 0 through 90. The external receipt sets its signed link expiry to visit validUntil plus one day, but EmailLinkCodec rejects any expiry beyond 32 days from issuance.

Pure service reproduction, with generated test keys and no network/provider call:

- Render REQUEST_RECEIVED for an EXTERNAL visitor booked one day ahead: succeeds.
- Render the same valid job for 45 days ahead: throws EMAIL_LINK_UNAVAILABLE.

Impact: if the allowed booking horizon is increased beyond the default 30 days, accepted future requests cannot immediately receive their external receipt. The worker treats the unexpected codec failure as a delivery failure and retries. This does not reproduce under the present default 30-day setting; it is a mismatch in the explicitly supported configuration range.

Recommended correction: align configured booking and signed-link lifetimes, with a deliberate security policy for long future bookings. Either constrain/reject incompatible configuration at startup or implement an appropriate renewable receipt policy. Test the maximum allowed booking date and exclusive-midnight/+one-day boundary.

Evidence for findings 2-4: ignored tmp/audit-browser-and-email.json and tmp/repro-client-and-email.mjs. Browser-facing responses and media were synthetic; no real email, approval or project movement was sent through the browser.

## Fix and regression order

Resolution and executed regression evidence: [39 Bug Fixes and Regression](39_Bug_Fixes_and_Regression.md). The findings below retain the original audit snapshot.

1. Correct reconciliation flag propagation with a forward SQL migration and restricted-user regressions.
2. Make external request status reload-safe without weakening bearer/owner isolation.
3. Fix reception date rollover and its calendar/refresh behavior.
4. Resolve the configurable horizon/link-lifetime mismatch.

The earlier intermittent reception SQL 547 remains a separate unconfirmed-root-cause item in document 37. The known production-composition, Linux key/retention and organization onboarding gates remain open. They are not counted as newly reproduced bugs in this report.
