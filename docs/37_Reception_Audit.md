# Reception audit — 22 October 2026

Scope: office-scoped visitor search/filter, individual pending/approved pass preview, browser print handoff, retries and explicitly requested reprints. Existing local work was preserved. Physical printer acceptance and organization SSO/mail onboarding remain deferred.

## Findings and fixes

- **Cached print receipts could trap a retry.** `RequestPassPrint` intentionally returns its immutable idempotency receipt, which can still say REQUESTED after the job has been dispatched. The browser now checks the live job before rendering. After a lost render response it reconciles live status again. A dispatched artifact is never automatically released twice; an intentional Reprint creates a new client key. An unresolved network failure retains the original operation key.
- **Popup readiness was mistaken for a displayed print preview.** The popup now acknowledges successful image decoding using its job ID. The parent accepts that acknowledgement only from the exact popup and same origin. Closed/failed/unconfirmed windows report the distinction between server handoff and browser display. No code claims the physical printer succeeded, and browser tests do not invoke `window.print()`.
- **Counters could misrepresent incomplete/filtered results.** Every metric remains unavailable while the keyset chain is incomplete or has failed. An error is not rendered as a valid empty result. Totals are labelled Matching visits; Print handoffs counts dispatched jobs and does not imply physical output. The detail's handoff count updates after a successful dispatch or a live-status reconciliation.
- **Paging response boundaries were loose.** Reception service normalizes GUID casing, rejects duplicate IDs, invalid validity windows, mismatched dates and a hasMore cursor that does not match the last row of a complete 50-row page.
- **Pending status lacked contrast; a scrollable dialog body lacked keyboard access.** The shared warning text token is darker and the reception detail body is a labelled focusable region. Mobile/laptop overflow and accessibility checks cover the pending card dialog.
- **Old printing fixtures did not represent the current authorization model.** The lifecycle harness now inserts exact project-office memberships, updates both levels when removing project assignments, cleans its extra project-location children, and avoids a duplicate VISITS_READ fixture grant. Its notification cases claim only their owned notification rather than consuming older jobs from the shared queue. Production authorization was not weakened to satisfy legacy test data. The 55-case SQL suite is now included in sequential CI checks.

## Existing behavior verified

- Central reception sign-in resolves only granted offices. A role label or caller-supplied office does not create permission.
- Pending visitor cards have a scannable identity QR and can be previewed/printed without project approval. Approval is still enforced at project entry. Printing does not approve a request or rotate its credential.
- Preview/photo reads do not create a print job. Reprint has a separate audited job while preserving the existing current pass/QR.
- Expired/revoked/denied/cancelled credentials, stale directory data, wrong office, changed card details and competing render claims remain checked by SQL and the renderer.
- The browser loads all scoped keyset pages and handles search/filter races with versioned results. Page metrics describe the selected date/search/status only.

## Limits and remaining work

- The SQL job's DISPATCHED state is a server artifact handoff, not proof of a printed card. Printer driver, physical dimensions/orientation and actual media output remain final acceptance work.
- An earlier intermittent SQL 547 from a reception print request, noted in review 32, has no confirmed root cause. The actual print lifecycle/HTTP runs in this audit do not reproduce it; passing reruns are not claimed as a fix. The separate fixture cleanup FK failures encountered during this audit were owned test-data issues and were fixed in the harness.
- A first HTTP test run collided with concurrent lifecycle-fixture mutations on the same development database and received SQL 1205. Integration suites that mutate shared fixtures must run sequentially; CI does so. This result is not presented as an application deadlock fix.
- Current workspaces are exercised through the local HTTP server with real SQL/storage and the explicitly temporary identity adapters. Production workspace hosting/composition and real identity/deployment configuration still require deployment acceptance; this audit does not claim the whole application is production-deployed.

Validation reports are stored locally under ignored `database/validation`, `output` and `tmp`. New browser tests use synthetic data and mock the browser-facing print responses to exercise UI/popup behavior; separate SQL/HTTP suites exercise actual authorization, card generation and print persistence. No external email or physical print is part of this audit. No commit or push is part of this work.

Final evidence: 376 unit tests with coverage gates passed; 55 actual SQL print/replacement cases passed; 23 actual registration/reception/email HTTP/SQL cases passed with owned-fixture cleanup. All 12 app browser/accessibility cases passed, and the two reception popup cases passed again against the final handoff-counter changes. Type-check, lint and secret checks passed. Localhost was restarted with the updated assets.
