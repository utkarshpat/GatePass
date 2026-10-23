# Loading and live-refresh release validation — 24 October 2026

Feature commit **`9bbe9b9`** was pushed to `origin/main` before the complete browser run, as requested. This release includes the accumulated logo, regional-name, card/SQL-helper performance work documented in phases 1–6 and the pagination/refresh work in [phase 7](Performance_Optimization_Phase_7.md).

## Delivered behavior

- Hovering the regional person/host reading or its asterisk shows the reading-aid warning in English and the selected regional language. The persistent footnote is removed. Original English names, inline brackets and smaller regional fonts remain.
- Guard and admin project/area cards display 24 at a time; reception displays 50 rows at a time. Load more reveals another display page. Full filters/counts still consume the complete authorized server-page chain; total list transfer is not yet bounded by the display limit.
- Guard photos, regional readings and admin lead previews defer work near the viewport. Quiet unchanged guard refreshes preserve cards/media.
- Visible, idle workspaces poll every 20 seconds and on focus. Dialogs/editing pause refresh; backend scope checks remain authoritative. Existing common-duty changes invalidate the affected guard's session and require a new sign-in.

## Completed checks

| Check | Result |
| --- | --- |
| Complete unit suite | **508 passed, one existing skip, zero failures** |
| Complete post-push browser run | **114 passed, one opt-in skip, zero failures**, 6.7 minutes |
| Explicitly enabled retained presentation browser case | **1 passed**, 22 seconds including server startup |
| Distinct browser cases verified across those two runs | **115 passed** |
| Focused pre-push browser checks | 26 distinct cases passed; included again in the broad run |
| ESLint and TypeScript | Passed; presentation-test follow-up also linted/typechecked |
| Migration integrity | 90 sequential hashes verified; no migration changed |
| Credential scanning | Staged diff and complete pre-follow-up Git history clean |

The opt-in case uses the retained **23 October 2026** data, so it now explicitly selects that historical date rather than relying on today's default range. It verified real SQL-backed visit-register loading, name sorting, XLSX download, visitor entry history, themed scrollbars and unified project/area controls. Its opt-in guard remains enabled only for environments with that presentation dataset. The final follow-up changes this test date selection and documentation only; application source is unchanged from the broad passing run.

The full suite includes mobile/desktop layout and accessibility, login/role/scope boundaries, scoped project creation, lead/guard writes, register filters/export consistency, Digital ID loading, email status/approval/revocation, guard combined allocations and names, live pagination/denial recovery, reception registration/printing/returns/history and owned SQL integration fixtures. No physical printer or production SSO/directory/mail delivery was tested.

Ignored evidence: `output/live-pagination/full-browser.log`, `full-browser.xml`, `retained-presentation.log`, `retained-browser.xml`, `unit-final.log`, `two-browsers.json` and redacted gitleaks reports.

## Two installed browsers and retained data

Visible Chrome and Edge used independent staff sessions against the actual localhost SQL-backed app. A new Noida area appeared automatically in the second administrator's catalogue after **19,537 ms**, and its audit event was visible. A common-duty assignment invalidated the guard's previous session as designed; a fresh guard login then listed and authorized the assigned duty. No authorization fencing was relaxed to make the update appear automatic.

Realistic rehearsal areas, guard assignments and their audit events were retained. Existing presentation requests, photos, history and mail outbox were preserved. Disposable integration fixtures cleaned only their own run-scoped records. No real email was sent and no email worker was started.

## Next option: event-driven browser refresh

The user asked whether webhooks could make entry submission real-time. Webhooks deliver events to a server; [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) provide a server-to-browser stream. A suitable next design is: commit the entry and durable change event, deliver a scoped SSE invalidation, then make a fresh authorized list read. Reconnect recovery, event coalescing, revocation and polling fallback must be covered. This is a proposal; **SSE/webhooks are not implemented in this release**. Current automatic updates remain 20-second polling.
