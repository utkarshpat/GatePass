# Local guard review — 21 October 2026

Disposition: approved locally after the integration and display fixes below.

Reviewed user changes: host names in scoped guard lists/details, person/project
titles, compact pass references and the associated regional labels. Migration
046 is already applied locally and was preserved unchanged. Comparison with
041/043 showed only the host-name projection/join, with no authorisation changes.

Fixed missing runner registration/checksum entries for 046, removed hash symbols
from pass labels/references, and added forward migration 047 for the confirmed
display rules:

- Employee Digital ID shows current assigned employee projects.
- Visitor/additional-access requests show the requested project beside the host.
- Multiple employee assignments use up to three names plus an honest remaining
  count. Stale memberships show unavailable, not a false zero/partial roster.
- Display metadata never grants project entry. Existing SQL scope and movement
  decisions remain authoritative. Full pass IDs remain in details/tooltips;
  compact references are display/search conveniences, not unique credentials.
- Card names/projects can wrap to two lines and expose the full title on hover.

Validation: 320 Node tests and coverage gates, strict type-check, lint and the
47-file migration manifest passed. All 47 migrations replayed on a fresh owned
test database, which was then removed. Eighteen real HTTP/SQL cases, including
employee/host project assertions, and 40 SQL transaction/security cases passed.
A rollback-only probe verified stale memberships return unavailable. Browser
inspection confirmed Employee 14's own projects 1/6 versus requested host project
2 and hash-free references. Test visits/photos were cleaned by the harness.

Changes remain local; no commit or push was performed for this review.

Next product priority: authenticated host approval list/detail with approve/deny,
followed by notification delivery and the full pending-to-approved-to-entry flow.
Use the existing SQL decision/idempotency contracts and dummy employee identity
adapter until corporate SSO/mail become available. Physical printing remains
deferred to final acceptance.

## Office and duty follow-up

Reviewed and retained the local employee office badge, request-access placement, sticky mobile actions, guard refresh/tab styling, scanner layout and bilingual overflow changes. Removed the scanned-office fallback and made the directory primary office explicit rather than inferring the first database office. Role and exact project-office enforcement stays in SQL.

Forward migrations 048–060 add explicit employee office/project-office entitlements, assignable common-area duties, project-specific employee movement, live replay authorization and presence continuity across replacement credentials. Guard details/photos now use the selected duty at the HTTP boundary. SQL movement GUIDs are normalized before receipt comparison. Common duties verify office identity without representing project or campus movement.

Validation: 335 unit tests with coverage gates; 40 transaction/security, 52 registration and 17 duty SQL cases; 18 HTTP/SQL cases; type-check/lint and 60 migration checksums. All 60 migrations replayed on a fresh owned database. SQL and HTTP harnesses removed their owned fixtures. The new browser common-area assertion verifies the expected named areas instead of assuming a fixed total on a shared development database.

Remaining investigation: one earlier reception print request returned SQL 547 without its constraint name. The failure did not recur in 200 direct owned print requests or the full subsequent HTTP print/reprint run. Root cause is unconfirmed; the passing rerun is not evidence that the intermittent failure was fixed. Physical printer testing is still deferred.

No commit or push performed.

Final browser verification: all 8 mobile/desktop workflows and accessibility checks passed after the duty-route fixes. Localhost was restarted with the latest code and returned HTTP 200.
