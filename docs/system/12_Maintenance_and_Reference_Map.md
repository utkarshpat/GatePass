# 12. Maintenance and reference map

> Maintained source handbook — **4 November 2026 · migrations 001–136**. [Current status and evidence](11_Readiness_Gaps_and_Roadmap.md) · [Terminology](../109_Visit_Owner_and_Host_Terminology_03_November_2026.md). Source review is not production acceptance.

## Documentation authority

This handbook is the maintained narrative source baseline reviewed on 4 November 2026. Approved user requirements and executable source/immutable migrations determine behavior; documentation must be corrected when they differ. Source review, dated local tests and organizational acceptance are separate kinds of evidence.

The [full documentation index](../DOCUMENTATION_INDEX.md) classifies every Markdown guide. Dated numbered reports, database phase notes, previous exports and screenshots remain historical implementation/evidence records. They are not silently rewritten into current test or deployment certificates. Read the current handbook and latest glossary before following older examples.

The report-100 planned-pass linking/gate extension is withdrawn. Old Host-for-creator terminology is superseded: Visit owner creates an invitation; destination account/project reviewers are Hosts. Ordinary pass Host labels retain their existing meaning.

## Source map

| Topic | Primary maintained/reference entry |
|---|---|
| Workflows and scope | [Chapter 01](01_Product_and_Workflows.md) |
| Roles, credentials and planned station identity | [Chapter 02](02_Identity_Roles_and_Access.md) |
| Dependency/OOP/SOLID rules | [Architecture rules](../ARCHITECTURE.md) and [chapter 03](03_Architecture_and_Boundaries.md) |
| SQL/state and legacy identifiers | [Chapter 04](04_Data_State_and_Transactions.md) and [generated catalogue](REFERENCE_SQL_Catalog.md) |
| HTTP contracts | [Chapter 05](05_HTTP_and_API_Reference.md), request validators and generated route inventory |
| Admin setup/sidebar/invitation | [Chapter 06](06_UI_PWA_and_User_Guide.md), [layout contract](../108_Account_Setup_and_Coordination_Navigation_02_November_2026.md) |
| Runtime .env | [Configuration guide](../86_Runtime_Environment_Configuration.md), `.env.example`, chapter 07 |
| Mail/provider boundaries | [Chapter 08](08_Email_and_Outlook.md) |
| Deployment/retention/recovery | [Chapter 09](09_Deployment_Operations_and_Recovery.md) |
| Actual scoped test evidence | [Chapter 10](10_Testing_CI_and_Evidence.md) and dated reports |
| Completion and organization dependencies | [Chapter 11](11_Readiness_Gaps_and_Roadmap.md), [organization inputs](../87_Organization_Production_Requirements.md) |
| Visit owner/Host and legacy wire keys | [Terminology contract](../109_Visit_Owner_and_Host_Terminology_03_November_2026.md) |

## Glossary

Office is server-bound context, not entitlement. Account-office is the exact operational authorization pair. Projects are subparts of accounts; coordination approvals are per selected project. Common areas use verification without account movement. Guard account groups bundle duties; approval/notification groups route planning work/mail.

Visit owner is the authenticated invitation creator. Host is the assigned account/project permission reviewer. Coordinator owns support tasks; an additional FYI contact is not a second Visit owner. Snapshot/revision describes immutable submitted data; an idempotency key identifies one logical retryable operation. Outbox/lease/fence controls durable delivery ownership. DISPATCHED is server print handoff; Graph acceptance is not inbox delivery. Local adapters are not corporate integration.

## Maintainer procedure

Update applicable workflow, identity/scope, API/RPC, state/retry, UI/mail and deployment/acceptance chapters with behavior changes. Keep release/evidence claims dated. Never edit an applied migration; use reviewed forward scripts and integrity manifests. Preserve current privacy/scope semantics when refactoring.

Regenerate non-secret source inventories with:

```powershell
python tools/update-documentation-references.py --date 2026-11-04
```

Use the actual review date on future runs. This reads reviewed source names/hashes, not SQL, .env, token caches or mail. Source-Snapshot records the base commit plus working-tree hashes; it is not a signed release or live catalogue.

Validate Markdown local links, encoding and whitespace after editing. Regenerate and visually verify any Word/PDF/HTML export **only when producing that export**; old exports remain historical until rebuilt. Do not silently present an old file as the current handbook. Never package real .env, passwords/hashes, keys, private photos, sessions or authenticated artifacts with documentation.
