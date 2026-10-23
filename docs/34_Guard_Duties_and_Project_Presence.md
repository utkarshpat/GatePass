# Guard duties and project presence

Common areas are assignable, location-scoped verification duties. They are not projects, fake project IDs, campus checkpoints or a second movement layer. An admin with current location-wide `GUARDS_MANAGE` authority can create a named common area, assign an active guard in that office, and revoke the assignment. Project admins cannot use a project-scoped grant to manage an office-wide common area.

Each guard action identifies its selected duty (`PROJECT` or `COMMON`) and duty ID. SQL rechecks the active staff grant, capability, duty allocation, office and pass on every call. A dropdown selection is never trusted as authorization. A guard may have project duties, common duties or both; revocation takes effect on later operations and retries. Missing contexts fail closed.

## All allocations in the guard filter

The guard filter also offers **All allocations** for the selected office. It combines the lists for the guard's currently assigned project and common-area duties, follows each duty's pagination, and displays each visit/pass once. Reads use at most two concurrent duty requests. Individual allocation filters remain available and the initial selection remains the first assigned duty.

The combined Expected view includes the identities returned by assigned common areas as well as project queues. The combined Inside view includes only project duties and retains the existing rule that the current entry belongs to that guard. A common-only guard has no Inside queue. Common-area verification never implies building occupancy or grants project movement.

When a combined card belongs to several allocations, the guard chooses a concrete allocation before viewing its details. Scanning from All allocations also asks for the allocation first. The detail dialog identifies that allocation, and refresh, photo, reminder and movement requests retain the explicit project/common duty and ID. The server does not accept an `ALL` authorization scope. If a combined read returns an authorization denial, the combined cards and open pass are cleared rather than displaying a partial list as complete.

All allocations, allocation types and the choice dialog support English with Hindi, Kannada, Tamil or Marathi. Card labels show Projects separately below Host, with both selected-language labels separated clearly.

Optional regional person/host readings, spoken-label choices, free-provider limitations and local opt-in are documented in [Regional name readings](Guard_Name_Readings.md). They are display aids and never replace the original identity or duty authorization.

The guard roster renders 24 cards per display page and defers photos/name readings near the viewport. Visible workspaces receive bounded SSE invalidations and refresh through the normal freshly authorized APIs. Connected safety reads run every 60 seconds; polling fallback runs every 20 seconds, with focus refresh. Open dialogs/editing defer reads; hidden tabs disconnect. Complete server-page chains still supply totals and combined-allocation deduplication. See [list rendering](Performance_Optimization_Phase_7.md) and [cost-aware live updates](Performance_Optimization_Phase_8.md) for scope, capacity and delivery limits.

| Duty | Verification | Movement |
| --- | --- | --- |
| Common area | Office-valid, unexpired, unrevoked employee identity; visitor may be pending or approved | No entry/exit and no campus-presence claim |
| Project, employee Digital ID | Current exact employee project-office assignment | Independent presence for the selected project |
| Project, visitor/additional employee access | Exact requested project-office and current independent host approval | Existing visit presence for that requested project |

The existing `VisitPresence` row remains the source for a project-specific visitor/request and for historical records. It is not treated as global campus occupancy. New Digital ID project movement records its entry visit and exact project-location, with a unique active employee/project occupant across daily ID replacements. A later valid card can resolve and close that original entry; events retain both the entry visit and the presented credential’s visit. Separate immutable runtime events preserve the history. Entering or leaving one project does not change another project's presence. Common verification never modifies either presence table. A common area's visitor list has no Inside tab.

The Inside roster contains the current entries recorded by that guard, scoped to the selected project duty. Another assigned guard can scan an occupant to authorize a departure; this does not transfer the roster's current-entry ownership. Cancelled/revoked occupants require explicitly privileged, reasoned exit reconciliation. Removing an employee's project entitlement blocks new/cached entry, while an existing occupant can depart. A cancelled/expired Digital ID cannot be silently replaced while any of its projects still contains that occupant.

`TEMP_ID_MOVEMENT` remains a compatibility capability for old data; it no longer authorizes new office-wide Digital ID entry through the legacy movement procedure. Employee project entry must use the explicit duty workflow.

The employee API's location is the primary office. The normalized directory contract now carries `primaryOfficeLocationCode` explicitly. A unique primary-office marker is synchronized from that trusted field. Neither database row order nor the scanned QR is used to infer a primary office. Additional office/project entitlements must still be explicit; a primary-office label alone does not grant other-office access.

Migrations 053–060 add this model without rewriting earlier migrations or retroactively labelling historical movements as campus/project events. No production common duty or primary-office entitlement is fabricated. Development data explicitly assigns Lobby/Cafeteria duties and primary offices.

Connected guard APIs: duties, visitors, verify, detail, photo and movement. Connected admin APIs: common-duties (scoped lists/search/paging) and common-duty (create, assign, revoke). SQL source/role allowlists remain separate from private media access. Photo handoff checks the selected duty again after reading the private asset.

Verification: `database/validation/guard-duty-report.json` includes live SQL scope, pending visitor, no-common-movement, independent project presence, concurrent entry, retry, revocation, reconciliation, audit rollback, input-width and owned-fixture-cleanup cases. Unit, HTTP and browser reports cover the typed boundary and UI. Real SSO/directory integration and physical printer testing remain separate integration work.
