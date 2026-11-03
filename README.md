# GatePass

Visitor registration, temporary employee IDs, hosted account access, reception printing/returns, guard verification/movement, scoped administration and visit pre-planning.

Current documentation: **3 November 2026 · 136 forward migrations**. Start with the [system handbook](docs/system/README.md). The [documentation index](docs/DOCUMENTATION_INDEX.md) separates maintained guides from historical reports and exports.

## Current workflows

- **Self-service:** office QR, individual visitor registration, private office-wide Host search, camera photo, approval/status and downloadable card. Employee requests use trusted primary office and exact office/account entitlements; employee ID/access requests remain same-day.
- **Reception:** scoped operational queues, search/QR lookup, manual individual registration, history, card/details/timeline, printing, Host reminders and audited pass return/correction with declared-device confirmation.
- **Guard:** assigned account/common-area/group duties, expected/inside queues, QR verification, explicit authorized entry/exit, reconciliation, profile and bilingual helper modes.
- **Admin:** overview, Accounts & areas, users/permissions, guard assignments, Offices & QR, register/Excel, audit and Visit coordination. Setup remains inside the existing Admin shell.
- **Visit coordination:** future invitations, independent destination project approvals, services/stay arrangements, VIP/custom recipient groups, private discussions and activity. The creator is the **Visit owner**; account/project permission reviewers are **Hosts**. Planning readiness does not issue a pass or grant entry.

Accounts contain projects. Regular pass/access handling keeps its existing account-office authorization; coordination obtains independent approval for each selected project. Public visitor lookup exposes no account/project catalogue. Approved source-office hosts may initiate plans to other configured projects at that office; choosing a destination grants no access.

## Local development

Use the supported Node version from [package.json](package.json), PowerShell 7, the dedicated Windows SQL/private-storage setup and locked dependencies:

```powershell
npm ci
npm run storage:init
npm run dev
```

Staff entry: [localhost:8443](http://localhost:8443/); public example: `/office/noida`. This local runner uses HTTP despite its port number. It uses real synthetic SQL/private storage and development identity adapters. It does not replace production authentication. Follow [setup and migrations](docs/system/07_Development_Setup_and_Configuration.md); ordinary startup must not reset passwords or reinstate revoked roles.

Seven primary page bundles use React/TypeScript; new UI belongs in `src/frontend`. Existing print/offline documents remain HTML. Restart the owned development server after source/asset changes.

## Configuration and production work

Use the ignored private root `.env` and the empty tracked [.env.example](.env.example). Keep secrets, keys, media and token caches outside source/public hosting. Existing service environment variables take precedence. [Configuration](docs/86_Runtime_Environment_Configuration.md) explains validation and protected file paths.

Production needs complete application composition, approved VM/HTTPS origin, organizational Entra identity, trusted directory feed, no-reply Graph mailbox, platform storage/key protection and operational/device/recovery acceptance. Google station login is agreed but unimplemented. A shared station account does not itself prove a physical device or identify the guard on shift. See [organization inputs](docs/87_Organization_Production_Requirements.md) and the [readiness matrix](docs/system/11_Readiness_Gaps_and_Roadmap.md).

Planning mail dispatch is implemented and mock-provider tested; corporate delivery acceptance remains pending. Existing registration, QR allocation, reception and guard workflows continue separately. Automatic invitation-to-registration data transfer is a future convenience, not a new required gate or implemented cutover.

## Checks and references

```powershell
npm run typecheck
npm run lint
npm run check:architecture
npm run check:migrations
npm run build:frontend
npm run test:ci
```

Run relevant browser/SQL checks sequentially when they share local SQL. [Testing and actual evidence](docs/system/10_Testing_CI_and_Evidence.md) distinguishes focused local runs, historical full runs and organizational acceptance. Documentation-only edits do not establish a new application test run.

- [System handbook](docs/system/README.md)
- [Architecture/SOLID rules](docs/ARCHITECTURE.md)
- [Manual acceptance scenarios](docs/test-scenarios/README.md)
- [Visit owner and Host glossary](docs/109_Visit_Owner_and_Host_Terminology_03_November_2026.md)
- [Current setup/sidebar layout](docs/108_Account_Setup_and_Coordination_Navigation_02_November_2026.md)
- [Source-derived SQL catalogue](docs/system/REFERENCE_SQL_Catalog.md)
- [Routes/configuration inventory](docs/system/REFERENCE_Routes_and_Configuration.md)
