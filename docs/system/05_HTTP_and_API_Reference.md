# 05. HTTP and API reference

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
| /api/guard/ | context, duties, visitors, detail, verify, photo, movement; compatibility lookup/projects/recent | Current staff, selected duty and pass |
| /api/reception/ | me, list, detail, photo, preview, print/request, print/status, print/render; legacy local login/logout | Granted office and current job state |
| /api/admin/ | context, projects, leads, candidates, grant, revoke, common-duties, common-duty | Exact capability/scope |
| /api/email/host/ | detail, photo, decide | Assigned authenticated host/current snapshot |
| /api/email/request/ | detail, image | Authenticated holder |
| /api/email/external/ | detail, image | Signed expiring individual link |
| /api/outlook/decision | Native Outlook decision | Validated Entra token plus bound action capability |
| Production service map | OWN/HOST/GUARD/RECEPTION/ADMIN visits/list/detail; admin read/staff mutation contracts | Registered service map, not complete production UI wiring |

REFERENCE_Routes_and_Configuration.md extracts literal declarations with source/line provenance. Prefixes, regex paths, generated aliases and legacy routes must be interpreted through their handler/composition, not concatenated into an assumed public API.

## Representative payloads
Registration start: `{"requestType":"EXTERNAL"}` under server-bound office context. Options accepts selected project-location/search to return eligible hosts. Submission binds a stable clientKey, request type, reason and people with individual client keys/photoAssetId. External submissions include allowed visitDate, projectLocationId and hostEmployeeId. Employee identity is server-derived.

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
