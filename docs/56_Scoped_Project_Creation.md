# Scoped project creation

In **Administration → Projects & areas**, **Add → Project** creates a project in the selected authorized office. Enter its name, unique uppercase code (3–64 letters/numbers/dots/underscores/hyphens), and reason. The modal displays the office without an editable location selector. Successful creation refreshes the project cards and selectors; project leads and guard duties can then be assigned through their existing workflows.

## Permission boundary

The server advertises `canCreateProject` separately for each office. SQL revalidates the current session, active office and `ROLE_GRANTS_MANAGE` at **office scope** under the authorization lock. Location administrators can create projects only in their own office. India/platform administrators can use their authorized offices. A project administrator cannot create a sibling project, even when allowed to manage leads within an existing project. A role label alone is insufficient: the current capability grant must also authorize the office.

`POST /api/admin/create-project` accepts exactly `locationId`, `projectName`, `projectCode`, `reason`, `clientKey`. The actor comes from the authenticated session; client-supplied actor/project/scope fields are rejected. Codes are globally unique. An existing code returns a generic conflict without exposing the owning office. The browser retains the same idempotency key after an uncertain response. SQL checks current authorization before returning a cached result, so a retry after permission loss is denied.

`gp.CreateScopedProject` atomically writes the project, exactly one project/office link, a `PROJECT_CREATED` audit event (actor, time, office, project, name/code and reason) and the idempotency result. Runtime identities receive execute permission only. No employees, roles, memberships or additional office links are implicitly granted. A fresh 403 closes the creation dialog and clears previously authorized data.

## Catalogue lifetime and directory boundaries

Migration **086** adds `gp.Projects.IsLocallyManaged` (existing projects default to false), `gp._ProjectCurrent` and the creation procedure. Local projects remain current independently of directory-cache timestamps. Existing directory projects still require fresh timestamps; inactive projects remain unavailable. Twelve existing project consumers use the same predicate for lists, lead/guard administration, staff context, registration and employee/card reads. Employee identity, project membership and office-membership freshness checks remain enforced. Creating a project or assigning its lead does **not** make an employee eligible as a registration host; that still requires verified directory assignments. Future directory ingestion must preserve locally managed entries and must not claim their project codes implicitly.

Migration **087** corrects SQL's literal-hyphen character-class handling in project codes. Both applied migrations are preserved and must run in sequence.

## Verification

- `database/tests/Test-ScopedProjectCreation.ps1`: execute-only creation, single office link, replay/audit deduplication, persistent local catalogue, unchanged stale-directory rejection, forged office/guard/project-admin denial, revoked-scope replay denial and conflict handling. It removes only its own random regression fixtures.
- `tests/admin-workspace.test.ts`: strict input/output validation, trusted identity parameters, capability projection and redacted errors.
- `tests/browser/admin-project-creation.spec.ts`: 390px/1366px modal accessibility/overflow, trusted office display, same-key retry, list/selector refresh and clearing on permission loss.
- `tests/browser/admin-project-creation-live.spec.ts`: actual browser → HTTP → execute-only SQL creation, reload persistence, subsequent lead/guard assignment and forged foreign-office request denial.

Presentation records are retained separately from disposable regression fixtures. The presentation project is **Digital Workplace Transformation · DWT-NOI**, scoped only to Noida.

Follow-up verification on 23 October: 463 Node tests passed (one platform skip); 11 focused admin browser tests passed; six SQL suites passed, including 38 administration-read, 57 registration, 55 printing and 19 guard-duty cases. TypeScript, ESLint and all 87 migration hashes passed. The retained DWT-NOI project was created through the actual Noida location-admin browser session and has exactly one office link and one creation audit.

The live guard follow-up also caught an existing timing issue: opening Assign guard while the office roster was still loading left the dropdown empty. Roster completion now refreshes an already-open assignment dialog while preserving its selected guard. The real project-creation test exercises this immediate transition before assigning the new project’s guard.

The current shared Add flow and area/guard cards are documented in [Unified projects and common areas](57_Unified_Projects_And_Common_Areas.md).
