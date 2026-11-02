# 05. HTTP and API reference

> Current source documentation: **2 November 2026**, migrations **001–132**. See [current release/configuration evidence](../88_Documentation_And_Release_28_October_2026.md), [individual visitor flow](../85_Individual_Visitor_Registration_27_October_2026.md), [runtime .env configuration](../86_Runtime_Environment_Configuration.md) and [organization requirements](../87_Organization_Production_Requirements.md). Earlier exported PDFs, screenshots and dated reports are historical.

Current additions: `POST /api/admin/register` applies authorized date ranges, field filters, sorting and pagination in SQL; the UI exports the complete selected result as an Excel workbook. `POST /api/admin/create-staff` and `/reset-staff-setup` provide scoped local account/setup issuance. `POST /api/staff/setup` inspects/completes the one-time password setup capability. Reception's `POST /api/reception/lookup` searches authorized records across dates, while `/correct-return` requires the current pass/return receipt and a reason. All staff operations retain session/CSRF and current SQL authorization checks; no browser-supplied identity or scope becomes authority.

## Conventions
This catalog distinguishes local workspace adapters and production service-map composition. It is not an OpenAPI specification: typed services and SQL RPC parameters are the exact executable schemas. Use synthetic identifiers, never live credentials/capability links, in examples.

Browser APIs use POST with exact allowlisted JSON object fields; bounded binary photo upload is an exception. IDs/date/length/unknown-property checks occur across route, service and SQL. Protected browser operations require session/CSRF; external status uses its signed capability. Production responses are non-cacheable.

## Route families
| Family | Operations | Authority |
|---|---|---|
| /api/staff/ | Login/logout and resolved workspace | SQL-selected provider; current staff scope; local adapter |
| /api/dev/sso/ | Employee login/logout/session helpers | Explicit development-only adapter |
| /api/registration/ | start, options, photo, submit, reset, locations | Office-bound intake; SSO for employee types |
| /api/employee/digital-id/ | detail, image | Current authenticated own ID |
| /api/guard/ | context, duties, visitors, detail, verify, photo, movement; compatibility lookup/accounts/recent | Current staff, selected duty and pass |
| /api/reception/ | me, list, detail, photo, preview, print/request, print/status, print/render; legacy local login/logout | Granted office and current job state |
| /api/admin/ | context, accounts, leads, candidates, grant, revoke, common-duties, common-duty | Exact capability/scope |
| /api/email/host/ | detail, photo, decide | Assigned authenticated host/current snapshot |
| /api/email/request/ | detail, image | Authenticated holder |
| /api/email/external/ | detail, image | Signed expiring individual link |
| /api/outlook/decision | Native Outlook decision | Validated Entra token plus bound action capability |
| Production service map | OWN/HOST/GUARD/RECEPTION/ADMIN visits/list/detail; admin read/staff mutation contracts | Registered service map, not complete production UI wiring |

REFERENCE_Routes_and_Configuration.md extracts literal declarations with source/line provenance. Prefixes, regex paths, generated aliases and legacy routes must be interpreted through their handler/composition, not concatenated into an assumed public API.

## Representative payloads
Registration start: `{"requestType":"EXTERNAL"}` under server-bound office context. Options accepts selected account-location/search to return eligible hosts. Submission binds a stable clientKey, request type, reason and people with individual client keys/photoAssetId. External submissions include allowed visitDate, projectLocationId and hostEmployeeId. Employee identity is server-derived.

Duty movement contains locationId, dutyKind=PROJECT, server-issued dutyId, visitRequestId, accessPassId, eventType=ENTRY/EXIT, entryMethod and stable clientKey. SCAN additionally presents the issued credential; privileged RECONCILE requires a reason. Common-area movement is unsupported. All IDs must come from authorized server results.

Print request binds visit and client key. Status/render identifies printJobId. Preview/photo creates no job. Host decision contains visitRequestId, snapshotVersion, snapshotHash, decision and clientKey. Opposite decisions are not a replay of the same payload.

## Error contract
| Status | Response |
|---|---|
| 400 | Correct malformed/unsupported input before retry |
| 401 | Reauthenticate through intended provider |
| 403 | Current scope/context denied; never broaden scope or guess IDs |
| 404 | Unknown/unavailable resource; avoid revealing existence |
| 405 / 415 | Correct method/content type |
| 409 | Refresh authoritative state/snapshot |
| 413 | Reduce bounded body/media |
| 429 | Wait and retry same logical operation appropriately |
| Network / 5xx | Reconcile uncertain outcome; retain operation key |

Only controlled errors are exposed; no raw SQL/provider messages or secrets. Browser mocks prove rendering, not backend authorization.

Sources: src/development/*Routes.ts; src/transport/RegistrationHttpRoutes.ts, Composition.ts, ApiHandler.ts, EmailPublicRoutes.ts, OutlookActionHandler.ts.

## Refresh-safe external endpoints (follow-up)

POST /api/email/external/session exchanges a signed link for a path-scoped HttpOnly holder cookie after current SQL checks. POST /api/email/external/{visitId}/detail and /image require an empty JSON body and that visit-scoped cookie. Legacy /external/detail and /external/image still require the original explicit signed link. No route grants approval authority. See docs/35_Email_Driven_Request_Workflow.md for expiry/key-retention policy.

## Current visitor registration boundary

`POST /api/registration/options` returns no accounts for EXTERNAL intakes; host searches use the bound office and reject supplied account filters. EXTERNAL submit accepts one person, `hostEmployeeId` and `validUntilDate`; old `visitDate`, supplied office/timestamps and account selection are rejected by the office-bound adapter. Employee account requests retain their authenticated account selector and same-day behavior.

`POST /api/registration/card` accepts only `visitRequestId` and requires the signed active intake cookie plus CSRF. `gp.GetPublicRegistrationCard` binds the visit to that exact intake under the render role. The response is PNG/filename/MIME only, with two authorization reads around rendering. Reception manual has the corresponding `/api/reception/manual/card` route with independent staff/intake checks.

## Account host policy update

See [accounts and approved hosts](../89_Accounts_And_Approved_Hosts_28_October_2026.md). Account-office host lists are explicit and administered within scope; membership alone does not enable hosting. Legacy API/schema names remain compatible.

## Visit Coordination

Seven protected POST actions under `/api/coordination/`: `options`, `list`, `detail`, `thread`, `create`, `change`, `manage`. Current session/CSRF and SQL scope are required; no caller-supplied actor/roles/recipient overrides are accepted. Thread history uses a thread-bound keyset cursor; lists filter before pagination. Four reviewed API RPCs: `ReadVisitCoordination`, `ManageVisitPlanning`, `CreatePlannedVisit`, `ChangePlannedVisit`. [Contracts and limitations](../98_Visit_Coordination_Persistence_01_November_2026.md).

Coordination is an additive host/facilities pre-planning workspace. It contains invitations, project approvals, arrangements, VIP/FYI recipients, discussion and activity. QR card allocation, reception, guard scanning, entry/exit and returned badges use their existing workflows. No manual invitation linking or separate planned gate is exposed. See [coordination-only scope correction](../101_Coordination_Only_Scope_02_November_2026.md).
