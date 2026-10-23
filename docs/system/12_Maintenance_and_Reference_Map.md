# 12. Maintenance and reference map

> Current local changes and presentation evidence (23 October 2026): [retained browser rehearsal](../55_Presentation_Rehearsal_23_October_2026.md). Source migrations are 001–085. The original 22 October export and snapshot remain historical.

## Precedence
This handbook is the consolidated local baseline dated 22 October 2026. Earlier numbered documents are historical increments. Resolve conflict using latest approved requirements, executable source/migrations and applicable current evidence; update the handbook when behavior changes. Historical reports are not current environment attestations.

The package contains current chapters, source-derived inventories and existing Markdown references. History is retained for traceability instead of being rewritten as newly verified. Source-Snapshot.json records base commit and working-tree hashes; it is not a signed release or live database catalog.

## Source map
| Topic | Read first |
|---|---|
| Current presentation/release evidence | docs/55_Presentation_Rehearsal_23_October_2026.md |
| Local staff onboarding/audit | docs/54_Local_Staff_Onboarding_And_Audit.md |
| Reception all-date lookup/return correction | docs/53_Reception_Lookup_And_Return_Correction.md |
| Admin visit register | docs/52_Admin_Visit_Register.md |
| Visitor company/devices/camera | docs/51_Visitor_Company_Devices_And_Camera.md |
| Original domain/ER/dictionary | docs/database/00_READ_ME_FIRST.md, 01_Domain_and_Design_Decisions.md, 03_Data_Dictionary.md |
| Identity/delegation | docs/database/29_Staff_Identity_and_Delegation.md |
| Office policy | docs/33_Employee_Office_Authorization.md |
| Duties/project presence | docs/34_Guard_Duties_and_Project_Presence.md |
| Email/status | docs/35_Email_Driven_Request_Workflow.md |
| Native Outlook | docs/36_Outlook_Direct_Approvals.md |
| Print/reception audit | docs/37_Reception_Audit.md |
| Private storage | docs/database/22_Private_Photos_and_QR_Key_Storage.md |
| CI/cost controls | azure-pipelines.yml; tools/ci; docs/31_CI_Checks_and_Limits.md |
| UI | docs/13_Product_UX_Standards.md; docs/14_Global_Design_System.md |

Paths are repository-relative. Package retains the Markdown reference tree; executable application code is not duplicated into the shareable ZIP. External specifications linked in historical docs are references, not freshly revalidated vendor guidance.

## Maintainer checklist
For behavior changes update workflow, route/RPC, scope, date/state, retries, migrations and acceptance evidence. New roles/providers require identity matrix/composition updates; storage changes require recovery/retention updates. Mark samples as development-only. Never copy live personal data/secrets into examples.

Regenerate inventories from reviewed source while preserving source-declaration versus live-catalog distinction. Rebuild PDF/HTML after Markdown edits and inspect long tables, code and page breaks visually. Do not claim fresh tests unless actually run.

## Glossary
| Term | Meaning |
|---|---|
| Office | Server-bound location, not a user-chosen entitlement |
| Project-location | Exact authorization pair |
| Primary office | Trusted directory field, not complete entitlement set |
| Digital ID | Same-day employee identity credential |
| Hosted visit | Individually approved temporary project-office permission |
| Duty | Guard PROJECT or COMMON allocation |
| Common area | Office verification without movement |
| Presence | Project occupancy, distinct from decision/pass |
| Capability | Explicit role permission, or narrow signed bearer authority depending on context |
| Snapshot | Immutable submitted approval data |
| Idempotency key | Stable identity of a logical retryable operation |
| Outbox/lease/fence | Durable notice and bounded worker ownership |
| DISPATCHED | Server print handoff, not physical output |
| Provider accepted | Graph 202, not inbox delivery |
| Local adapter | Development composition, not corporate SSO |
