# GatePass system handbook

Maintained source documentation — **4 November 2026 · migrations 001–136**.

Start here for current behavior. [Full documentation index](../DOCUMENTATION_INDEX.md) classifies historical reports and reference material; [latest documentation review](../111_Documentation_Verification_And_Publication_04_November_2026.md) records this refresh and its limits.

## Current model

- Self-service, Reception, Guard, Admin and additive Visit coordination; seven native React page bundles.
- Accounts contain projects. Ordinary account-office pass handling is preserved; planning approval is independent per selected project.
- **Visit owner** creates/coordinates the invitation; **Hosts** approve their assigned account/project access. Additional FYI contacts cannot acquire ownership.
- Admin setup stays in Accounts & areas: projects/hosts under accounts, common areas and routing groups alongside each other, policies split into focused sections. Guard account groups are separate from email-recipient lists.
- Coordination folders are sidebar links, nested under Visit coordination for Admin. Invitations have six numbered steps and explicit draft/save/submit.
- Preparation, services/stay, extra people, custom/VIP groups, scoped discussion and independent planning mail are implemented. Group selection never bypasses mandatory policy.
- Existing registration, cards, Reception and Guard movement/return remain the operational flow. Planning READY does not authorize entry.
- Corporate Entra/directory/mail acceptance, Google station login, full production composition and target-platform operations remain pending. Local source/test evidence is not deployment or independent pentest approval.

## Chapters

1. [Product and workflows](01_Product_and_Workflows.md)
2. [Identity, roles and access](02_Identity_Roles_and_Access.md)
3. [Architecture and boundaries](03_Architecture_and_Boundaries.md)
4. [Data, state and transactions](04_Data_State_and_Transactions.md)
5. [HTTP and API reference](05_HTTP_and_API_Reference.md)
6. [UI, PWA and user guide](06_UI_PWA_and_User_Guide.md)
7. [Development setup and configuration](07_Development_Setup_and_Configuration.md)
8. [Email, Graph and Outlook](08_Email_and_Outlook.md)
9. [Deployment, operations and recovery](09_Deployment_Operations_and_Recovery.md)
10. [Testing, CI and evidence](10_Testing_CI_and_Evidence.md)
11. [Readiness, gaps and roadmap](11_Readiness_Gaps_and_Roadmap.md)
12. [Maintenance and reference map](12_Maintenance_and_Reference_Map.md)

## Supporting guides and inventories

- [Organization's six production inputs](../87_Organization_Production_Requirements.md)
- [Private .env configuration](../86_Runtime_Environment_Configuration.md)
- [Visit owner / Host terminology](../109_Visit_Owner_and_Host_Terminology_03_November_2026.md)
- [Account setup and coordination navigation](../108_Account_Setup_and_Coordination_Navigation_02_November_2026.md)
- [Architecture/SOLID rules](../ARCHITECTURE.md)
- [Manual acceptance scenarios](../test-scenarios/README.md)
- [SQL declaration catalogue](REFERENCE_SQL_Catalog.md)
- [Routes and configuration names](REFERENCE_Routes_and_Configuration.md)
- [Source hashes](Source-Snapshot.json)

Inventories contain source provenance only. Actual .env, private storage, keys, credential inventories, tokens and authenticated screenshots are not part of the handbook.
