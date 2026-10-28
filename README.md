# GatePass

Visitor registration, temporary employee identity, hosted account access, reception printing/returns and guard verification/movement, with scoped administration for Noida, Bengaluru, Chennai and Pune.

Current source documentation: **28 October 2026 · migrations 001–121**. Start with the [system handbook](docs/system/README.md) and [release evidence](docs/88_Documentation_And_Release_28_October_2026.md). Earlier dated exports/reports remain historical; local checks are not production certification.

## Current workflows

- **Office self-service:** office QR → one visitor's details → office-wide host search, purpose and Valid until → camera photo/review → independent approval request and downloadable card. Public responses do not disclose account assignments. Email is optional.
- **Employees:** corporate SSO is intended; local dummy sign-in exercises explicit office entitlement, same-day Digital ID reuse and independent hosted account requests. Primary office comes from the directory, not QR/array order.
- **Reception:** scoped queues/search/QR lookup, manual single-person registration, history range, card/details/movements, print/reprint, host reminder and audited final-return/correction with device checks.
- **Guards:** account/common/group duties, expected/inside queues, QR/search verification, authorized entry/exit, reconciliation and language/profile controls. Verification alone is not entry.
- **Administration:** scoped overview, account/common-area/group governance, staff permissions/credentials, guard assignments, office QR, visit register/Excel, audit and action centre.

Visitor stays start today and may extend through a selected final day within policy; current queues retain still-valid multi-day visits. Employee requests remain same-day. Calendar-day pass labels show **23:59 on the last included date**, while SQL enforces exclusive next-midnight expiry.

## Local setup

The six main frontend pages now render with React + TypeScript. Existing CSS and workflows are preserved; all six pages now use native React state, components and event handlers. New UI work belongs in `src/frontend`. Print/offline documents remain HTML. See [migration and development policy](docs/92_React_Frontend_Migration_28_October_2026.md).

Use the supported Node range and locked dependencies in package.json, PowerShell 7, local SQL Server and existing Windows private-storage setup:

```text
npm ci
npm run storage:init
npm run dev
```

Local staff entry is http://localhost:8443/; public entry is /office/noida (or another office slug). The existing development database is GatePass_DesignTest on localhost\SQLEXPRESS, using the restricted Windows-authenticated PowerShell bridge. Do not deploy dummy adapters or seed scripts as production authentication.

Root `.env` is private and ignored by Git; the current local file retains development mode. On the VM, copy the empty [.env.example](.env.example), fill approved values and restrict filesystem access. API/email startup load and validate configuration:

```text
npm run check:config -- api
npm run check:config -- email
npm run start:api
npm run start:email
```

Shape validation is not connectivity acceptance. start:api still needs complete production UI/auth/workspace/media composition; it does not deploy the full local application. See [runtime configuration](docs/86_Runtime_Environment_Configuration.md).

## Organization inputs and pending work

Request **one VM, an HTTPS hostname, no-reply Graph mail, trusted employee data, Entra SSO and Google station-account/OAuth configuration**. See [the six requirements and reasons](docs/87_Organization_Production_Requirements.md).

Google station sign-in is agreed but not implemented. An IT-owned tablet account maps to a location/gate/scope; audit identifies that station. Reception retains ID/password. Physical-device restriction requires additional managed-device enforcement. Corporate providers, production composition, platform key protection, retention, off-VM restore and real camera/printer acceptance remain pending.

Photos, OAuth token caches, password hashes and key rings remain database/private-storage assets. `.env` holds configuration, app secrets and protected file paths; actual `.env` is never packaged or pushed. Production mail uses organization Graph app credentials, not the personal Outlook cache.

## Checks and documentation

```text
npm run typecheck
npm run lint
npm run build:frontend
npm run check:migrations
npm run test:ci
npm run test:browser
```

Run SQL fault/locking suites sequentially and separately from browser workloads sharing local SQL. Integration/staging checks and real organization acceptance remain distinct.

- [System handbook](docs/system/README.md)
- [Individual visitor registration](docs/85_Individual_Visitor_Registration_27_October_2026.md)
- [Runtime .env configuration](docs/86_Runtime_Environment_Configuration.md)
- [Organization requirements](docs/87_Organization_Production_Requirements.md)
- [Maintained test scenarios](docs/test-scenarios/README.md)
- [Release evidence and limitations](docs/88_Documentation_And_Release_28_October_2026.md)

Account terminology and the new approved-host policy are described in [the 28 October update](docs/89_Accounts_And_Approved_Hosts_28_October_2026.md). Configure approved hosts per account-office before using hosted registration.

Pentest preparation and subsequent fixes: [security audit](docs/93_Pre_Pentest_Security_Audit_28_October_2026.md) and [risk hardening with verification limits](docs/94_Pentest_Risk_Hardening_28_October_2026.md).
