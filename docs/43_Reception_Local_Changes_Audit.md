# Reception local changes audit

Implementation follow-up: [Reception functional workflows](44_Reception_Functional_Workflows.md) records the subsequent corrections and final validation. The findings below describe the earlier reviewed snapshot.

22 October 2026. Review of uncommitted reception HTML, CSS and JavaScript after commit 7ffeb4a. User requested required-feature completeness and unintended data exposure review. Application files were not edited or pushed in this audit. Local files continued changing during the review; observations below identify the inspected behavior, not approval of subsequent edits.

## Findings

### P1 — Assisted registration reports success without creating anything

src/app/reception.js, assistedForm submit handler (around lines 210–215 at review): submission reads only the name, closes the dialog and displays “Walk-in registered … Queued for desk verification.” It makes no API call. Neither registration, host notification nor printing is queued. Reproduced at phone and laptop widths with zero API calls after submit.

This is operationally dangerous because staff can tell a person they are registered when no record exists. The form is also missing a trusted project/host selector, country-aware required visitor phone, photo capture and idempotent submission. Its employee option cannot replace the employee's authentication. Hide/remove this action until a real authorized assisted intake exists, or explicitly implement the full flow. Do not add a permissive registration endpoint just to satisfy this UI.

### P2 — Host/reference column displays the applicant as host

src/app/reception.js renderRows (around lines 92–95): an employee row renders “Employee ” plus row.employeeId in the host column. That ID belongs to the applicant. External rows fall back to “Host verification.” ReceptionService.list and migration 064 do not return hostName at all. The detail API already supplies a trusted hostName, but the dialog does not render it.

Show the actual request host from an explicitly validated scoped projection; for Temporary ID use a truthful not-applicable value rather than inventing a host. Employee-project and external requests need their real host. Do not fetch the complete employee directory into reception to fill this column.

### P2 — Visible filters, totals and “inside” meaning disagree

renderRows counts all fetched rows before applying client-side type/print/inside filters; list-status still uses state.rows.length. Browser evidence: Visitor filter showed one row and “2 matching visits.” KPIs are influenced by server-side search/approval filters but ignore the client-side filters, so they have inconsistent scopes.

Currently Inside is only presence among the selected visit-date/search/status records. It does not enumerate all current occupants, and Temporary ID presence is recorded project presence, not verified building occupancy. Printed is a sum of dispatched print handoffs, including reprints; it is not the number of printed people or proof of physical printer success. Distinguish matching registrations, dispatched jobs and scoped recorded presence, or use proper backend summaries with clearly defined scope. An overnight occupant can otherwise be missed by the date filter.

### P2 — Phone header overflows and accessibility regressed

At 390px the document has horizontal overflow and the header's sign-out control extends beyond the viewport. Laptop at 1366px did not overflow. Both populated dashboard and details fail WCAG contrast checks (muted labels, statuses and avatar text). field() inserts div children into a dl without dt/dd semantics, producing a serious definition-list violation. Interactive KPI divs have role=button/tabindex but no Enter/Space handlers. Use native buttons or complete keyboard behavior, valid definition-list markup and measured contrast.

### P2 — Print affordances ignore capability and state

Each row gets an enabled Print/Reprint button even for a denied pass or a reception account whose canPrint is false. It only opens the same dialog as View pass; it does not start printing. Reproduced with canPrint=false and a denied row. Backend/preview and dialog checks still reject unauthorized printing, so this is not a demonstrated authorization bypass. Gate the affordance by granted capability and current printable state, while rechecking at submission. Preview is permitted only through its existing authorized source boundary. Pending printing is supported by the existing policy and must remain clearly pending, not treated as approved access.

### P2 — Selected date and heading disagree

The heading says Today's registrations even after selecting another day. todayLabel uses the browser's current date/timezone instead of the selected server office date and is not updated by date change or office midnight refresh. Reproduced with selected 20 October but heading date 22 October. Render the selected office day; preserve the existing server-based date bounds/rollover behavior.

### P3 — Search advertises unsupported project search

The new placeholder promises project search. gp.ListReceptionVisits searches person name, public request/pass reference and employee ID, not project name. Either change the wording or implement/test scoped project filtering. Do not load unrestricted project or host data as a shortcut.

## Required reception surface

| Capability | Current state |
| --- | --- |
| Staff authentication and location-scoped workspaces | Implemented; common staff login and granted offices |
| Date, person/request/pass search, approval filtering | Implemented; project-search promise incorrect |
| Complete paginated list, individual registration rows | Implemented; type/print/inside counters need consistent scope |
| Actual host and destination | Project exists; host is wrong/missing; Temporary ID should show truthful assignment information |
| Authorized person photo and request/pass detail | Implemented; detail omits trusted host and employee assignment summary already returned by API |
| Pending/approved/denied/cancelled/revoked/expired distinction | Effective state exists; printing buttons do not respect it |
| Authorized preview, first print/reprint, idempotent handoff/status recovery | Implemented; backend is materially stronger than new row affordance |
| Clear print handoff history/state | Counts/status recovery exist; “Printed” misstates physical confirmation and KPI meaning |
| Loading, empty, partial failure, retry, logout | Implemented; mobile and accessibility need repair |
| Assisted walk-in intake | UI-only placeholder; not implemented |
| Read-only access to entry/exit history | Detail API provides a bounded movement list; UI does not display it. Useful if required for desk support; no reception movement authority should be inferred |

Reception should not gain host approval/rejection, guard entry/exit, employee impersonation, role delegation, guard allocation or unrestricted reports by virtue of this redesign. Those controls are not present in the reviewed reception UI. A separate dashboard/profile and extra directory fields are not needed to solve the identified gaps.

## Data exposure review

No new external API, third-party analytics, raw HTML injection or browser storage of identities was added by these three files. Dynamic person/project/error content uses textContent. Fetches use same-origin credentials and CSRF headers.

The list service explicitly projects task fields; arbitrary SQL fields are dropped. SQL requires the current actor, valid reception grant and requested office. Detail/media use fixed RECEPTION scope and reauthorize through restricted procedures. PASS_PRINT is separately enforced for card source and print operations. Print receipts exclude source storage keys, binding hashes, ciphertext and render claim secrets. QR credentials inside an authorized pass image are intentional and must still be treated as sensitive bearer data.

The service worker caches only allowlisted public PWA assets, not authenticated HTML, API/photo/card responses. No cross-office exposure or raw source-secret leak was reproduced within the tested boundaries. This is not a blanket certification: live grant removal cannot erase previously authorized data from an operator's memory/screenshot, and production transport, SSO, retention and physical printer controls remain separate acceptance gates.

## Evidence and limits

- 66 focused Node contract tests passed: reception service/routes, print coordinator, visit reads, own card and print rendering.
- Six actual restricted SQL presence/scope cases passed, including wrong-office reception denial and replacement-ID occupancy. Exact owned fixtures removed.
- 55 actual SQL print/replacement lifecycle cases passed, including wrong office/missing capability, revoked/expired/stale conditions, trusted source separation and redacted receipts. Owned fixtures removed.
- Two observation-only browser cases completed at 390px and 1366px with synthetic identities: confirmed fake assisted success, wrong host, filter/count mismatch, enabled print without capability, wrong date heading, overflow and accessibility violations. “Completed” means observations were captured; accessibility/UX did not pass acceptance.
- Full public registration HTTP/SQL harness failed after 14 completed cases: a second guard-context response returned SQL_52001 and the harness attempted to read missing locations[0]. It never reached the reception cases in this run. Cause is not established; no assertion/authorization was relaxed. Harness finally cleanup ran. The prior successful reception HTTP evidence is historical, not a pass for this run.
- node --check src/app/reception.js passed. No actual emails, approvals or physical prints sent.

Ignored evidence: tmp/reception-audit-browser.log, tmp/reception-audit-contracts.log, tmp/reception-audit-scope-sql.log, tmp/reception-audit-print-sql.log and tmp/reception-audit-http-sql.log. Phone/laptop screenshots contain synthetic data only. Audit harnesses live under ignored tmp; no test credentials or user data were added to source.

Recommendation: do not approve the reception redesign as complete yet. First eliminate false registration success, repair host data and counter/date semantics, then address mobile/accessibility and capability-aware print controls. Preserve the existing backend authorization and idempotency boundaries.
