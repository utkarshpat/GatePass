# GatePass manual acceptance scenarios

Maintained 3 November 2026. These catalogues describe what to exercise; they are **not executable test totals or newly passed cases**. See [recorded automated evidence](../system/10_Testing_CI_and_Evidence.md) and [readiness](../system/11_Readiness_Gaps_and_Roadmap.md).

| Guide | Current coverage |
|---|---|
| [01. Registration](01_Public_and_Employee_Registration.md) | Individual visitor, private Host search, exact office/account entitlement, camera/card/validity/reuse |
| [02. Ordinary email/approvals](02_Email_and_Approval_Workflows.md) | Authenticated Host decision, holder capability/session, reminders and provider boundaries |
| [03. Reception](03_Reception_Desk_and_Pass_Returns.md) | Queue/lookup/QR, history, printing, manual intake, return/device checks/correction |
| [04. Guard](04_Guard_Workspace_and_Movements.md) | Duty scopes, expected/inside, verification/movement/reconciliation and helper languages |
| [05. Admin](05_Admin_Console_and_Delegation.md) | Accounts/projects/hosts, areas, two group types, policies, staff/duties, register/audit/sidebar |
| [07. Visit coordination](07_Visit_Coordination.md) | Visit owner/Host roles, six-step invitation, independent approvals, services/stay, groups, threads/mail |
| [08. Current security/recovery checklist](08_Current_Security_and_Recovery_Checklist.md) | Admission, least privilege, replay/privacy/XSS/export, provider/device and restore acceptance |
| [06. Historical findings](06_Security_and_Concurrency_Findings.md) | Dated issue/fix evidence; not a current whole-system test count or pentest approval |

Use dedicated synthetic accounts and approved targets. Current grants determine authority; account numbers/older seed tables do not. Example IDs are admin1@example.com, employee1@example.com, reception1@example.com and gaurd1@example.com. Credential setup is deliberate and private; no scenario grants permission to reset users or send real mail. Keep production credentials, photos, identities and tokens out of reports.

Retain current synthetic data unless an isolated harness explicitly owns its fixtures. Run SQL-heavy suites sequentially. Mark each actual execution with source/target/date/result and its limits. Corporate SSO/Graph delivery, managed-device enforcement, physical printing and restore remain independent acceptance work.
