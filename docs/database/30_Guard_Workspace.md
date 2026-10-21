# Guard workspace

Common staff sign-in routes guards with current `VISITS_READ` permission to `/guard`. Local credentials remain independent of employee IDs and corporate SSO. SQL remains the authority for office/project scope and all movement decisions.

## Visitors

The main page contains one search field, Expected / Inside tabs and landscape ID cards in a responsive N × M grid. There is no separate Find pass page, scan-history dashboard, descriptive page copy or enclosing white panel. The sidebar contains Visitors, Projects and the guard profile at its bottom. Scanning uses the lower-right icon FAB; manual fallback focuses the main search.

Migration 040 adds `gp.ListGuardVisitors`, an execute-only API procedure with bounded pages of 50 plus `hasMore`. Search is a literal, case-insensitive name/project filter or a pass/request-reference substring filter, applied in SQL across the authorised queue, not only the currently loaded cards. The API accepts no caller-supplied actor. Search text is not stored in the audit trail.

- Expected: today's pending or approved requests with a current pending/active pass, still within their validity, outside, in the guard's currently assigned project areas. A guard with Digital ID movement permission also sees applicable office Digital IDs. An unscanned request appears here; scan history is not a prerequisite. Future-dated requests appear on their visit day.
- Inside: still-inside requests whose current presence points to an ENTRY performed by this signed-in guard. This list is not date-limited, so an overnight/expired occupant does not disappear. A different guard's entry is not treated as this guard's entry. Current office, project assignment and visit-read scope are still required.

Cards show a readable status and a matching top border / light tint: amber pending, green approved, blue inside, red revoked/denied/cancelled, grey expired. These are presentation states, not grants. Every card opens fresh SQL-authorised details, with `canEnter` / `canExit` controlling actions. Pending approval never exposes normal entry. Revoked/expired or exceptional exits continue to use the established rules; reconciliation mutation UI remains separate work.

Entry removes the request from Expected and puts it in this guard's Inside queue. Exit removes it from Inside; a still-valid approved pass can reappear in Expected for permitted re-entry. Search, tab changes, refresh and office changes invalidate stale in-flight list responses. Lists are advisory live pages; movement rechecks approval, current pass, allocation, scope, presence and session at commit.

## Profile and language

The profile shows the guard's name, role, all currently authorised offices and office-wise assigned projects / Digital ID capability, obtained from the existing scoped context procedures. Opening a profile does not grant or modify access.

The top-right account menu contains Profile, an inline expandable language list, and Sign out. Options are English only or English paired with Hindi, Kannada, Tamil or Marathi. No language dialog is opened. Dictionaries are bundled locally; only the locale preference is persisted. Source names, project names and identifiers stay unchanged. Controls, statuses, card labels and operational messages use the selected bilingual mode.

## Media and actions

Cards load only visible authorised photos, serially; object URLs are released on refresh, office switch and page exit. No card embeds a QR bearer or private storage metadata. Camera streams stop on close, manual fallback, pass opening, office change, logout, backgrounding and page exit. A local bundled ZXing decoder supports QR capture; camera permission errors retain manual search.

Movement retries retain a per-action UUID until confirmation. Changing the pass or work context clears that operation state. A project movement sends the displayed project-location ID explicitly; Digital ID office movement sends explicit null. QR credentials remain in memory and are hashed at the server boundary. Scan audit procedures from migrations 036–039 remain available for audit/integration compatibility but no longer populate the main dashboard.

Active staff calls renew the SQL idle deadline at most once a minute; there is no idle keepalive timer. Absolute expiry remains enforced. Physical camera acceptance, exceptional reconciliation UI, physical printing and real SSO integration remain pending.

## Validation

The automated suite covers bounded queue projection, invalid/extra caller fields, private-data stripping, queue/presence mismatch, scoped SQL transport, language coverage and existing movement policies. The owned HTTP/SQL integration covers unscanned expected requests, literal search, future-date exclusion, office denial, current actor's inside queue, entry/exit transfer and idempotent movement. Its review mode temporarily retains capability-owned fixtures for browser checks, then cleans visits, photos, scans, movements and sessions.

Current validation: 306 automated tests passed; 18 actual HTTP/SQL integration cases passed and cleaned their owned fixtures. Browser review verified pending/approved tints, blue Inside state after real test entry, exit removing the Inside card, no pending entry action, in-page pass-number search, inline language options, office/project profile details, a single-column 390 × 844 bilingual view without horizontal overflow, and the final 1.586 landscape ratio. Proofs are in `tmp/guard-visitors-status.png` and `tmp/guard-visitors-mobile.png`.
