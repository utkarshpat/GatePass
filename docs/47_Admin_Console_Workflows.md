# Admin console

## Functional views

The /admin workspace has responsive navigation for Overview, Projects & leads, Staff & access, Guard assignments, Offices & QR, Visits & reports and Audit log. The account menu contains Profile and Sign out. Phone navigation scrolls within its own bar; the page does not overflow horizontally.

Overview reads the existing SQL operational summary for the selected date and office/project scope, including current recorded project-visit and employee-project presence. Current presence is explicitly separate from selected-day visit counts.

Projects & leads retains the existing scoped project lead assignment/removal workflow, directory candidate lookup, explicit permissions, reasons and idempotency. Staff & access searches existing identities, reads current/historical permitted role grants, grants only the delegation tuples offered by SQL, and revokes eligible grants with an explicit reason dialog. Self-service role escalation is prohibited by SQL. Revoked roles invalidate the subject's authorization version. Existing directory employees are discovered and managed through Find staff. Authorized admins may additionally create local external staff/guard accounts with a one-use password setup link; see [staff onboarding](54_Local_Staff_Onboarding_And_Audit.md) and [23 October presentation evidence](55_Presentation_Rehearsal_23_October_2026.md).

Guard assignments is an office-wide roster that does not depend on the project scope selector. It reads every authorized project's active/future allocations plus the office's guard list and common-area duties, then shows totals (guards, assigned, free, projects without a guard), a **By guard** view (duty chips per guard, Free badge) and a **By project** view. An **Assign guard** dialog (opened from the page header, a guard row or a project card) selects the project and guard, an optional end time (Until removed / Today only / 7 days / 30 days / date) and an audit reason, and uses the existing AllocateGuard/DeallocateGuard transaction services. Projects the admin cannot read are skipped; SQL still enforces every read and write. Common-area creation and assignments retain the existing dedicated dialog, now opened from the **Projects & leads** page header (**Common areas**, **Add common area**).

Offices & QR lists only authorized offices and generates/downloads an actual PNG QR for the existing office self-service route. The development server accepts only its localhost origin; a localhost QR is not a remote-device deployment URL.

Visits & reports reads scoped visit pages across an inclusive date range of at most 31 days, with quick date chips, quick Approval/Presence/Visit type filters, sorting, and a full-row visit timeline (registration, pass validity, each guard entry/exit, return). **Export Excel** downloads every visit matching the applied filters as an `.xlsx` built in the browser from the same authorized register reads (50 rows per request, up to 200 pages); it does not add a server export endpoint and is not separately gated by the REPORTS_EXPORT capability, so add a scope flag first if export must be restricted more tightly than reading. Audit log uses the existing bounded audit service and shows permitted action, actor display name, IST time, result and target as day-grouped log lines with client-side Result and text filters, without raw metadata/secrets.

Profile rechecks the current context and displays roles, authorized offices and scoped project names. The console does not add employee or host dashboards.

## Authorization and APIs

New forward migration 070 adds GetAdminConsoleScope and ListAdminGuardAssignments. Both are execute-only API procedures, with fresh actor validation, office/project checks and the authorization lock. Scope flags use effective capability functions; delegation choices use the existing role-delegation function. The project-admin UI falls back to its first authorized project when whole-office scope is denied. Changing office/project clears previous data and invalidates stale requests. The SQL services independently enforce all reads/writes regardless of hidden UI controls.

The local authenticated AdminRoutes adapter now connects the existing AdministrationReadService, StaffAdministrationService and VisitReadService, plus AdminConsoleService. It provides summary, guards, subjects, roles, audit, scope, assignments, allocate/deallocate, visits/detail and office-QR endpoints. Role/scope shapes are validated before the service boundary. No arbitrary actor, SQL query, browser-supplied origin destination or raw credential endpoint is available.

Production Entra/directory provisioning, external staff onboarding/credential setup and published hosting remain integration work; this console uses the established explicit local dummy transport. Existing production API contracts remain unchanged.

## Verification

Real SQL fixture tests check office capability flags, bounded role delegation, cross-office/guard denial, assignment projection, execute-only permissions and project-admin restrictions. They clean only owned fixtures. Real authenticated HTTP/browser checks cover all new read endpoints, safe projections and unknown-office denial. Browser module checks on phone/laptop cover navigation, lead dialog, staff grant/revoke, guard allocation, reports/detail, audit, QR download, profile, accessibility and page bounds. Existing public/reception/guard/admin workflow regression tests remain in place.

Validation results: 432 unit tests pass with one platform-specific skip. The CI coverage gate passed at 95.34% lines / 88.39% branches. All four new admin browser cases and four real SQL test groups pass. In the broader 34-case browser run, 33 passed and one pre-existing reception reminder-button contrast transition failed; readable disabled colors were applied and both affected phone/laptop print cases then passed. Typecheck, lint and all 70 migration hashes pass. No real emails or physical prints were triggered.
