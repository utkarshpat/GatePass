# Organization requirements for production

Agreed request list — 27 October 2026. Organization inputs do not constitute completed production integration.

| # | Requirement | What to provide | Why it is needed |
|---|---|---|---|
| 1 | Application VM | Approved VM, deployment/service access, persistent storage and required connectivity; accepted capacity and OS support. | Host the application, SQL database, private photos and background services independently of a developer laptop. |
| 2 | Application URL with HTTPS | Provided default hostname/domain, DNS/TLS and employee/visitor network reachability. | QR codes, email links, secure sign-in and camera access need a stable reachable HTTPS origin. |
| 3 | No-reply email | Organization-managed sender and Microsoft Graph application sending authorization restricted to that mailbox. | Send approvals, pass links and notifications without a personal Outlook account. Validate internal/external delivery. |
| 4 | Employee data | Approved API/feed, documentation, authentication, UAT access and fields below. | Identify employees, search office hosts, notify managers and enforce office/project assignments. |
| 5 | Corporate sign-in | Entra tenant/client IDs, redirect URLs, MFA/access policies and application secret/certificate configuration. | Replace dummy employee authentication with verified corporate identity; GatePass does not receive employee Microsoft passwords. |
| 6 | Location-based tablet Google sign-in | IT-controlled Google account per designated Android guard tablet/station, password withheld from rotating guards; organization-owned OAuth application/configuration. | Avoid a separate remembered GatePass password and retain the station identity when guards change. |

## Employee data fields

- Employee ID, full name, corporate email and active/inactive status.
- Stable Entra tenant/object identity mapping.
- Primary office and authorized office locations.
- Exact project–office assignments with stable project/location IDs.
- Reporting manager ID/email.
- Last-updated/freshness data and updates for exits, transfers and assignments; integration support owner.

## Station model — agreed, not implemented

Admin maps an approved Google account to location, gate/station and authorized duty scope. Unmapped accounts receive no access. Audit identifies the station account, not automatically the rotating individual. IT owns recovery/replacement/revocation. Reception retains ID/password.

Google sign-in does not itself enforce physical-device binding. That restriction requires additional approved device management. Filling OAuth fields does not enable the pending Google adapter.

## Other confirmations

Database installation, application deployment, private storage, jobs and logging can be configured on the VM. Confirm the initial platform administrator; support/patching/backup owners; visitor/privacy notice; retention periods; visitor-stay limit; multi-project/no-project host-routing policy; and an off-VM backup destination/recovery target.

Production settings belong in a private VM `.env`, using `.env.example` as the empty template. Actual credentials remain outside source control. Integration, production composition and hardware/recovery acceptance are still required.
