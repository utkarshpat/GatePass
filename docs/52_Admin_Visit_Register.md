# Admin visit register

The former **Visits & reports** module is now **Visit register**. The security **Audit log** remains separate: it records administrative/security actions rather than visit-register rows.

## Available behavior

- Uses the admin console's authorized office and project selectors. Project admins must select a project they can read; they cannot widen the query to the whole office or another project.
- Inclusive visit-date range of up to 31 days per query.
- Optional request-reference lookup and additional field filters. Different fields are combined with AND. Text filters use case-insensitive literal substring matching; `%` and `_` are not wildcards. Status/type/presence/print filters use exact enumerated values. Each device filter matches one declared device type.
- Filter and sort fields: visit date, registration timestamp, name, employee ID, email, mobile, company, devices, office, project, host name/email, request type, purpose, request reference, pass number, approval state, pass state, recorded presence, printed/returned state, returned timestamp, validity start/end, first/latest entry, latest exit.
- Click a column heading for ascending/descending order, or choose any field from **Sort by**, including hidden columns. Sorting applies to every matching record in SQL before pagination, with visit ID as a stable tie-breaker.
- **Columns** controls which fields are visible. At least one remains visible. **Reset filters** restores today's date, no field filters and newest registration first.
- 50 rows per page, total matching count, previous/next navigation. Filters and sort are frozen for page navigation until Apply filters is used again.
- Click anywhere on a row (or the person's name) to open authorized visit details: status chips, every register field and a vertical timeline of registration, pass validity, each guard entry/exit (guard and method) and pass return. The table scrolls horizontally within its own container on phones.
- Quick date chips (Today / 7 / 30 days) and quick Approval, Presence and Visit type dropdowns apply immediately, as do Sort by and Order. Visitor name and request reference apply with **Apply filters**.
- **Export Excel** downloads all rows matching the last applied filters (not only the visible page) as `GatePass-Visit-Register-<office>-<from>_to_<to>.xlsx`. The workbook is generated in the browser from repeated `/api/admin/register` page reads; cells are plain text (no formulas), so values such as `=cmd` stay inert. Exports above 200 pages (10,000 rows) are refused; narrow the range or filters.

## Meaning of the records

One row represents a visit request, not an individual access event. Entry/exit columns summarize recorded events for that request; the detail timeline provides individual events. These are recorded access timestamps, not an independent measure of building occupancy.

Project-visit presence is that visit's own recorded presence; a sibling employee request being inside must not mark it inside. Digital IDs can summarize the employee's recorded office presence, within the office-level read permission required for those IDs.

Approval and pass states are stored workflow states. Validity columns show the permitted time window; an old approved visit is not automatically presented as a newly approved request. Printed/returned state distinguishes NOT_PRINTED, PRINTED and RETURNED; repeated print jobs do not create duplicate visit rows.

## Authorization and storage

`AdminConsoleService.register` / `readAdminRegister` invokes only `gp.ReadAdminVisitRegister`, exposed through authenticated, CSRF-protected `/api/admin/register` in the existing local admin adapter. The production SQL API allowlist is also updated.

Migrations 077 and 078 add the execute-only register procedure, then extend its projection with movement timestamps and project-bound presence. Existing applied migrations are unchanged. Apply both in order on other databases.

SQL rechecks the live session and VISITS_READ capability under the shared authorization gate, validates office/project scope, and checks each visit with `_VisitReadAllowed`. Purged records are excluded. The fixed business projection excludes photo bytes, credentials, bearer links, snapshots and raw audit metadata. A register read creates an ADMIN_REGISTER_READ audit event without copying filter values or contact data into audit metadata.

Field names/directions are whitelisted; text values are parameters and literal comparisons. The dynamic ordering statement operates only on the scoped temporary projection and cannot accept arbitrary SQL. There are no new direct table permissions.

This is a live paginated register, not a frozen export. Concurrent registrations or status changes can change page membership between reads. The Excel export reads the pages one after another, so it can reflect such changes too. Export is not gated by a separate REPORTS_EXPORT flag in the console scope; it only repeats reads the admin is already authorized to make. There is no retention-policy change or new account/role privilege in this feature.

## Verification

- Unit tests: input and output contracts, identity binding, malformed dates/scopes/filters, enum and SQL-order rejection, safe projection and error mapping.
- `database/tests/Test-AdminRegister.ps1`: owned synthetic fixtures, actual execute-only SQL role, >50 matching records, stable ties and pagination, literal and combined filters, exact print status, movement timestamps, sibling-presence regression, office/project isolation, fresh capability revocation and denied direct table reads. Added to the SQL CI suite.
- Browser tests: phone/laptop filters, column sorting, page navigation, column chooser, accessibility, viewport overflow and redaction after authorization denial. A live SQL browser case signs in, filters/sorts owned records and opens visit details.

No external email, real visitor photo or physical print is required by these checks.
