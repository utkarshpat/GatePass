# GatePass system documentation

Current source handbook — **2 November 2026 · migrations 001–132**.

The running local app uses real SQL and private media. Corporate identity/directory/mail, Google station login and production composition remain pending. Earlier exported PDFs, screenshots and dated reports remain historical, not current deployment certificates.

## Current contracts

- Seven main views, including Visit Coordination, render through React/TSX. All seven pages use native React models, components and event handlers; the compatibility controller adapter has been removed. Print/offline stay HTML. See [migration and new UI policy](../92_React_Frontend_Migration_28_October_2026.md).

- One visitor per registration, private office-wide host search and intake-authorized downloadable card without email.
- Today-started visitor stay with inclusive final day; still-valid multi-day visits remain in operational queues. Employee requests stay same-day.
- Calendar-day pass labels show final date 23:59; actual authorization uses exclusive midnight.
- Private root .env loading, empty tracked template and name-only startup validation.
- Scoped account/common/group administration, register/export/audit and performance corrections.
- Google tablet accounts are planned station identities, not automatic physical-device binding or individual guard identification.

## Chapters

- [01. Product and workflows](01_Product_and_Workflows.md)
- [02. Identity, roles and access](02_Identity_Roles_and_Access.md)
- [03. Architecture and boundaries](03_Architecture_and_Boundaries.md)
- [04. Data, state and transactions](04_Data_State_and_Transactions.md)
- [05. HTTP and API reference](05_HTTP_and_API_Reference.md)
- [06. UI, PWA and user guide](06_UI_PWA_and_User_Guide.md)
- [07. Development setup and configuration](07_Development_Setup_and_Configuration.md)
- [08. Email, Graph and Outlook](08_Email_and_Outlook.md)
- [09. Deployment, operations and recovery](09_Deployment_Operations_and_Recovery.md)
- [10. Testing, CI and evidence](10_Testing_CI_and_Evidence.md)
- [11. Readiness, gaps and roadmap](11_Readiness_Gaps_and_Roadmap.md)
- [12. Maintenance and reference map](12_Maintenance_and_Reference_Map.md)

## Current supporting documents

- [Group/performance boundaries](../83_P0_Group_Boundaries_Stable_Refresh_And_Export_Memory_26_October_2026.md)
- [26 October retained evidence](../84_Final_Browser_Verification_And_Retained_Presentation_26_October_2026.md)
- [Individual visitor flow and validity](../85_Individual_Visitor_Registration_27_October_2026.md)
- [Runtime .env setup](../86_Runtime_Environment_Configuration.md)
- [Organization requirements](../87_Organization_Production_Requirements.md)
- [Current release evidence](../88_Documentation_And_Release_28_October_2026.md)

- [Accounts and approved hosts](../89_Accounts_And_Approved_Hosts_28_October_2026.md)
- [Retained demo hosts and live acceptance](../90_Retained_Demo_Host_Acceptance_28_October_2026.md)
- [Shared publication and NHS draft preservation](../91_Shared_Account_Host_Release_28_October_2026.md)
- [React migration, new UI policy and local validation](../92_React_Frontend_Migration_28_October_2026.md)

## Source references

- [SQL catalogue](REFERENCE_SQL_Catalog.md)
- [Route/configuration inventory](REFERENCE_Routes_and_Configuration.md)
- [Source hashes](Source-Snapshot.json)

These are source inventories, not live database/provider attestations. Actual .env, private keys, photos, token caches and authenticated browser artifacts are excluded from source publication.

Latest security follow-up: [pentest risk hardening](../94_Pentest_Risk_Hardening_28_October_2026.md), including fixed code/configuration gaps and remaining implementation/staging gates.

Visit Coordination follow-up (1 November 2026): [SQL/API persistence and native React workspace](../98_Visit_Coordination_Persistence_01_November_2026.md). Migrations 122–127 are applied locally. Scoped configuration, plans, approvals, arrangements and threads are usable; planning email dispatch and automatic handoff to the existing registration/card flow remain pending. A separate gate cutover is outside the clarified scope. [Foundation report](../97_Visit_Coordination_Foundation_01_November_2026.md) is the historical first milestone.

[Cross-account invitation correction](../99_Location_Sponsored_Cross_Account_Invitations_01_November_2026.md): an approved source-office host may select other account/project destinations at that office, with independent destination approvals.

Coordination is an additive host/facilities pre-planning workspace. It contains invitations, project approvals, arrangements, VIP/FYI recipients, discussion and activity. QR card allocation, reception, guard scanning, entry/exit and returned badges use their existing workflows. No manual invitation linking or separate planned gate is exposed. See [coordination-only scope correction](../101_Coordination_Only_Scope_02_November_2026.md).

- [Coordination email routing, privacy and test evidence](../102_Coordination_Email_Notifications_02_November_2026.md)

- [Architecture/SOLID maintenance rules](../ARCHITECTURE.md) and [2 November review evidence](../103_OOP_SOLID_Architecture_Audit_02_November_2026.md)
