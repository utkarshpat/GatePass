# Latest commit and Admin console follow-up audit

> Historical 22 October audit. The current implementation, staff onboarding, Excel export, retained 23 October data and release verification are recorded in [the presentation rehearsal](55_Presentation_Rehearsal_23_October_2026.md). Scope and counts below describe that earlier audit.

Reviewed on 22 October 2026. Remote `origin/main` was fetched successfully; reviewed commit: `e1f6ae5` (Complete admin console, pass return workflows, lifecycle guards and E2E test scenarios). The checkout matched that commit and was clean before this follow-up. Existing committed work was preserved. The follow-up changes below have not been committed or pushed.

## Findings and corrections

1. **Authorization-denial redaction was incomplete.** `clearConsole` hid main views but left project/lead/common-area data and their dialogs intact. A fresh 403 could therefore leave previously loaded details visible. It now closes those dialogs, empties protected lists, invalidates their pending searches/reads, clears selected identities and hides scope/navigation controls. The destructive-action confirmation also uses the same denial path. Rebuilding an authorized scope restores its project list.

2. **Date initialization still trusted the browser clock.** The audit scenarios document said this was corrected, but the script still prefilled date inputs from `new Date()`, preventing the subsequent server-date fallback. Initial dates now come from the authorized scope response. Refresh preserves a deliberately selected date and project. A browser regression deliberately supplies a different server date to verify this behavior.

3. **Common-duty changes did not invalidate existing guard sessions.** Migration 074 checked self-assignment and conflicting roles but did not increment the target guard's authorization version as the scenarios document claimed. New forward migration **075** increments that version on ASSIGN/REMOVE and resolves the target guard from the stored assignment for REMOVE. Idempotent replay does not increment it again. Applied migration 074 was not modified. SQL tests prove old-session denial, re-authenticated access, removal denial and replay stability.

4. **The real write browser test was not reliably targeting its own identities.** Display-name selectors could match multiple synthetic subjects; SQL fixture UUIDs were uppercase while API UUIDs were normalized lowercase. Rows now carry stable user/assignment identifiers. The test normalizes fixture UUIDs and targets exact owned identities rather than whichever similarly named row appears first. The test completes real grant/revoke, guard allocation/deallocation and common-area creation through the UI and cleans only its own fixture.

5. **Office QR requests needed ordering within a scope.** A slower response for a previously requested office could overwrite a newer QR selection. QR rendering now checks a per-request token as well as the scope version.

## Permission boundaries verified

- `platformadmin1@example.com`: PLATFORM_ADMIN; can delegate Platform and India administrator roles when its explicit role-management capability is active.
- `admin1@example.com`: INDIA_ADMIN; cannot appoint Platform administrators or peer India administrators.
- `admin2@example.com`: Noida LOCATION_ADMIN; context contains Noida only, and delegation remains within permitted subordinate office/project-office roles.
- `employee19@example.com`: internal PROJECT_ADMIN; receives authorized project-office scope rather than whole-office scope and cannot access common-duty management or promote to Platform administrator.
- API attempts to obtain an unknown office scope or escalate to a superior role return 403. UI visibility uses server-provided effective capability/delegation flags; backend SQL remains the authority.
- Unsupported navigation is hidden. A project administrator is not offered the unusable whole-office selector option. Profile and sign-out remain in the account menu.

These are synthetic development accounts, using the existing test password `Sopra@123`. They are not production credentials.

## Validation

The fetched commit passed 442 unit tests with one platform-specific skip, 74 migration hash checks, 37 staff-administration SQL cases, 29 staff-authentication SQL cases, five pass-return SQL groups, and 19 guard-duty SQL cases. Its focused admin browser run exposed the live-write test selector failure; it was not treated as a clean end-to-end result.

After the follow-up, all **48 browser tests pass**, including the real write test, four real admin-role boundaries, server-date/refresh and authorization-redaction regressions, phone/laptop accessibility and the public/employee/reception/guard/email workflows. The unit suite passes **442 tests**, with **one platform-specific skip**, at **95.36% line / 88.56% branch coverage**. All 19 guard-duty SQL cases pass with the new session-version assertions. TypeScript, ESLint, diff whitespace checks and all **75 migration hashes** pass. Migration 075 was applied to the local development database. Localhost was restarted with the updated source.

## Scope and remaining organization dependencies

Staff & access manages roles on existing identities; it does not provision new directory users or external local-password accounts. Visits & reports supports scoped reading and request/pass reference filtering; the console does not offer an implemented CSV export simply because a role may hold REPORTS_EXPORT. Actual organization SSO/MFA, corporate Graph mailbox approval/delivery, hosting and retention policy remain organization-configuration work. No real email, physical print, production identity or external role grant was used by this audit.
