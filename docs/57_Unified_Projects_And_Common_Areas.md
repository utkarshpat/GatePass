# Unified projects and common areas

**Administration → Projects & areas** now shows projects and common areas together as labelled cards, ordered by name. One **Add** button opens a shared creation form. Its **Type** selector offers only the options authorized for the selected office:

- **Project**: project name, unique code and reason; uses the existing scoped project-creation procedure.
- **Common area**: area name and reason; uses the existing common-area management procedure. The project-code field is hidden and disabled.

The office is fixed in the form. Both operations retain their idempotency key after an uncertain response, refresh the shared list after success and preserve existing records. The permission boundaries from migrations 056 and 086–087 remain enforced by SQL; this UI increment adds no migration or broader grant.

Project cards keep **Project leads / Add lead**. Common-area cards show a guard preview and **Assigned guards / Assign guard**. Opening either common-area action fixes the dialog to that card's area and displays only its guards. Assignment and removal refresh the dialog and card. The old office-wide common-area dialog entry points and its separate New Area tab have been removed.

The shared search matches project names/codes and area names. Common-duty pages are read to completion before publishing guard previews, including areas whose assignments occur after page one. Office changes and fresh permission denial invalidate pending results, clear prior cards and close protected dialogs. Common areas are never requested or displayed for project-only administrators.

Browser coverage includes 390px/1366px accessibility and overflow, both creation types, area creation retry, fixed-area guard assignment/removal, assignment pagination, restricted type choices, permission revocation, stale office responses and real SQL-backed creation/assignment. Disposable regression fixtures are separate from the retained presentation dataset.

Follow-up validation: 463 unit tests passed with one platform skip. Thirteen final targeted browser cases passed, including loading/sorting, live SQL register and project/area assignment; the separate retained-data browser verification passed as well. TypeScript, ESLint and all 87 migration hashes passed. Existing presentation records and the DWT-NOI project were preserved.
