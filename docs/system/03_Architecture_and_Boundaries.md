# 03. Architecture and boundaries

> Current local changes and presentation evidence (23 October 2026): [retained browser rehearsal](../55_Presentation_Rehearsal_23_October_2026.md). Source migrations are 001–085. The original 22 October export and snapshot remain historical.

## Components
| Component | Responsibility | Source |
|---|---|---|
| Browser UI | Forms, role workspaces, camera, dialogs, download | src/app |
| Development host | Loopback pages/dummy identity with real SQL/media | tools/start-dummy-sso.ts |
| Production API entry | Direct HTTPS, separated SQL identities | tools/start-api.ts; src/transport/Composition.ts |
| Services | Typed input validation and SQL orchestration | src/registration, visits, reception, administration |
| SQL Server | Authorization, state, replay, occupancy, audit, outbox | database/migrations |
| Media/renderer | Private photo access, encrypted QR recovery, cards | src/storage, registration, printing |
| Email worker | Lease, relevance check, provider dispatch, acknowledgement | src/email/NotificationEmailWorker.ts |
| Microsoft adapters | Trusted directory/identity, Graph, optional Outlook | src/integrations; src/email |

Flow: Browser -> HTTP admission/auth -> service validation -> allowlisted SQL RPC -> transaction/authorization -> bounded response. Media/network work stays outside transactions where possible; sensitive delivery rechecks authorization. Durable outbox separates business commit from mail availability.

Reviewed forward SQL migrations define schema/contracts. Apply and inspect SQL, then align typed repositories. Entity models do not generate DDL. Restricted-user/concurrency SQL tests are needed; TypeScript responses alone do not prove transaction behavior.

## Runtime roles
| SQL role | Boundary |
|---|---|
| gp_api_runtime | Approved business procedures/scoped reads and mutations |
| gp_auth_runtime | Legacy guard password/session verification |
| gp_staff_auth_runtime | Generic staff password verification |
| gp_worker_runtime | Outbox lease/content/relevance/result |
| gp_media_runtime | Authorized photo read contract |
| gp_render_runtime | Render/reissue material and dispatch |
| gp_outlook_runtime | Independently authenticated Outlook decision only |

Use consistent SQL host/catalog with distinct principals. No web process should use schema-admin access, arbitrary table reads or elevated fallback. Generated role declarations are source evidence, not a live permission audit.

## Local versus production
The complete running UI is assembled by the explicit local-only runner. It uses real SQL/private storage but development cookies/HTTP and dummy employee authentication. Workspace adapters in `src/development` explicitly require loopback and dummy/mock modes.

`tools/start-api.ts` does not currently host the complete local application. Its `composeApi` call does not inject full registration/media/workspace/UI adapters. Optional email links/Outlook handlers are available, but registration/card dependencies need explicit composition. Production staff identity, SSO, static UI hosting and corresponding workspace endpoints must be completed and accepted. `npm run start:api` alone is not a deployment of all four interfaces.

Production admission requires configured HTTPS origin/Host. Arbitrary forwarded headers are not trusted; a reverse proxy needs a separately reviewed contract. Browser APIs enforce method/content type/body limits/CSRF/Origin. Outlook bearer actions have a separate handler, not weaker browser CSRF.

Keep private photos, SQL files, secrets, credentials, backups and signing keys outside source/OneDrive. Logs retain controlled codes/correlations rather than tokens, capability URLs, photographs or raw provider bodies.

Sources: src/transport/Composition.ts; src/transport/ApiHandler.ts; tools/start-api.ts; docs/37_Reception_Audit.md.
