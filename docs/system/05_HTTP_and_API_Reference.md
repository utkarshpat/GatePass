# 05. HTTP and API reference

> Maintained source handbook — **3 November 2026 · migrations 001–136**. [Current status and evidence](11_Readiness_Gaps_and_Roadmap.md) · [Terminology](../109_Visit_Owner_and_Host_Terminology_03_November_2026.md). Source review is not production acceptance.

## Boundary

This is a route-family guide, not an OpenAPI schema. The [literal inventory](REFERENCE_Routes_and_Configuration.md), request validators, composition and SQL procedures define exact supported payloads. Some complete workspace routes exist only in the explicit local runner; `start:api` does not yet compose the complete production application.

Browser operations use allowlisted POST JSON and bounded media exceptions. Protected requests require current session/CSRF and Origin/Host policy; active session preflight protects reserved capacity before reading protected bodies. Each operation still performs current SQL authorization. Public intake/capability endpoints have their own checks. Production responses are non-cacheable; ID shape is not authority.

| Family | Purpose / authority |
|---|---|
| `/api/staff/` | Provider-resolved staff login/logout/setup/current sections |
| `/api/dev/sso/` | Explicit local employee adapter only |
| `/api/registration/` | Office-bound start/options/photo/submit/reset/card; employee requests additionally authenticate |
| `/api/employee/digital-id/` | Authenticated own ID detail/image |
| `/api/guard/` | Duties, authorized queues/detail/verify/photo/movement; selected current duty |
| `/api/reception/` | Granted-office queues/detail/lookup/photo/preview/printing/reminders/return/correction and isolated manual intake |
| `/api/admin/` | Exact-capability account/staff/grant/duty/office/register/export/audit operations |
| `/api/email/host/` | Current assigned Host detail/photo/explicit decision |
| `/api/email/request/` | Authenticated holder status/image |
| `/api/email/external/` | Expiring individual capability and visit-scoped holder session |
| `/api/outlook/decision` | Separately validated organizational bearer/action capability |
| `/api/coordination/` | Authenticated planning, scoped configuration and private discussions |

## Registration and operational requests

EXTERNAL intake has one person and server-bound office. Options expose no account catalogue. Submit uses selected `hostEmployeeId` and inclusive `validUntilDate`; old supplied `visitDate`, office/timestamps and account selection are rejected by the office-bound adapter. Employee account requests keep their authenticated selector and same-day contract.

`/api/registration/card` accepts `visitRequestId` with the active matching intake and CSRF; the private PNG is reauthorized around rendering. Reception manual has its own staff/intake card boundary. After intake expiry, a reference alone cannot retrieve a pass.

Movement binds current duty, visit, pass, ENTRY/EXIT, method and stable key. SCAN also presents its issued credential; privileged reconciliation requires a reason. Common-area duty cannot perform account movement. Printing/status/rendering uses the current job, not a browser-invented printed state. Host decisions bind visit snapshot/version/hash and decision key.

External signed-link exchange can issue a path-scoped HttpOnly holder cookie after current checks. Per-visit detail/image still require that visit's cookie. GET never changes a decision.

## Coordination actions

Ten protected POST actions: `options`, `people`, `routing`, `groups`, `list`, `detail`, `thread`, `create`, `change`, `manage`.

| Action | Important inputs / result |
|---|---|
| options / people | Authorized catalogue and bounded current internal contact search; no caller-selected actor |
| routing | Office and at most ten destination project UUIDs; scoped required reviewers/FYI/task owners |
| groups | Authorized office and optional search; visible group members/revisions |
| list | MY / ASSIGNED / PARTICIPATING, authorized office/date/search and bounded offset |
| detail / thread | Authorized plan/version or thread-bound keyset history; reduced role-specific content |
| create | Stable clientKey and one-person draft; Visit owner derived from authenticated session |
| change | Plan, current revision, stable key and allowlisted submit/revise/cancel/decision/task/thread command |
| manage | Stable key and PROJECT / HOST / POLICY / GROUP payload; exact current management scope and reason |

The four API RPCs remain `gp.ReadVisitCoordination`, `gp.ManageVisitPlanning`, `gp.CreatePlannedVisit` and `gp.ChangePlannedVisit`. New fields/actions do not permit arbitrary procedure calls. Up to five selected groups and twenty additional people are bounded separately; mandatory policy review remains additive. Raw group emails are NOTIFY only.

Legacy planning `hostName` means Visit owner. Preparation `visitOwnerId` is an additional notification contact, not an ownership override. Request validators reject unknown fields; UI role labels do not grant a command capability.

## Error/retry handling

400: correct input; 401: intended-provider sign-in; 403: deny/clear protected state; 404: unavailable; 405/415: method/content type; 409: reload current revision/snapshot; 413: bounded payload exceeded; 429: back off; interrupted/5xx: reconcile outcome and retain the same logical operation key. Never broaden scope or expose raw SQL/provider/token material to recover.
