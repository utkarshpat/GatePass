# Guard duties and project presence

Common areas are assignable, location-scoped verification duties. They are not projects, fake project IDs, campus checkpoints or a second movement layer. An admin with current location-wide `GUARDS_MANAGE` authority can create a named common area, assign an active guard in that office, and revoke the assignment. Project admins cannot use a project-scoped grant to manage an office-wide common area.

Each guard action identifies its selected duty (`PROJECT` or `COMMON`) and duty ID. SQL rechecks the active staff grant, capability, duty allocation, office and pass on every call. A dropdown selection is never trusted as authorization. A guard may have project duties, common duties or both; revocation takes effect on later operations and retries. Missing contexts fail closed.

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
