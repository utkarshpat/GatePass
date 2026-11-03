# 11. Readiness, gaps and roadmap

> Maintained source handbook — **3 November 2026 · migrations 001–136**. [Current status and evidence](11_Readiness_Gaps_and_Roadmap.md) · [Terminology](../109_Visit_Owner_and_Host_Terminology_03_November_2026.md). Source review is not production acceptance.

## Implemented locally versus remaining work

| Area | Implemented / evidenced | Remaining |
|---|---|---|
| UI | Seven native React page bundles; role sidebar, six-step invitation, embedded Admin setup | Organizational usability/accessibility/device acceptance |
| Registration/employee IDs | Individual visitor flow, private Host routing, downloadable cards, exact office/account checks, same-day employee reuse | Corporate identity/directory lifecycle and real camera testing |
| Reception/Guard | Scoped lookup, printing/returns/correction, explicit duty movement and reminders | Physical devices/printer/media, language review and incident procedures |
| Admin | Account/project/host setup, areas, two distinct group types, staff/grants/duties, register/Excel and audit | Organizational permission and operating-owner acceptance |
| Coordination | Owner invitations, independent project Host approvals, arrangements/preparation, extra people, VIP/custom groups, private threads/replies/mentions/activity | Real organization policy/recipient setup and provider/device acceptance |
| Planning email | Independent fenced queue, current scoped content and Graph transport; mock-provider acceptance | Approved organization sender and real company/external delivery |
| Native Outlook actions | Handler/card/SQL contracts, disabled opt-in | Entra/provider/sender/client onboarding and real action acceptance |
| Google tablet sign-in | Agreed station model only | OAuth/linking/mapping implementation; any physical-device policy |
| Production configuration | Private .env loader/template and name-only validation | Organization values and fully composed production UI/auth/media/workspace app |
| Storage/recovery | Windows ACL/DPAPI implementation | Target-platform protector/key migration, reference-aware retention, off-VM restore/RPO/RTO |
| Security/CI | Source hardening, scoped tests, static boundaries, opt-in checks | Independent staged pentest, current dependency/edge/identity review, branch rules/monitoring/load/soak |

Local working source and passing focused checks are not a production certificate or a claim of no bugs. No production infrastructure, organizational credentials or sender integration was provisioned by updating docs.

## Scope retained by decision

Existing registration/card allocation, Reception and Guard entry/exit/returns remain the operational flow. The report-100 manual linking/separate planned-gate extension was withdrawn. Automatic invitation-to-registration data transfer is **not implemented**; it is an optional future convenience requiring a separately approved contract, not a hidden launch requirement or permission bypass.

No mandatory signature, ID-proof verification, gallery upload, device make/model, offline entry or separate general employee dashboard is part of the completed feature set. Account-level ordinary access and project-level planning approval are deliberately distinct.

## Organization inputs

Request the [six agreed inputs](../87_Organization_Production_Requirements.md): VM, HTTPS application hostname/reachability, no-reply Graph authorization, trusted employee data, Entra sign-in setup and IT-owned Google station/OAuth configuration. Confirm approved-host/account/project maps, policy owners, leadership/recipient groups, sender/identity support, privacy/retention and operating/backup owners.

## Recommended implementation sequence

1. Agree the production composition/hosting contract and obtain approved identity/directory/mail staging inputs.
2. Complete production UI/session/workspace/media adapters and target-platform storage/key protection, preserving current SQL scope boundaries.
3. Populate trusted stable identity, primary/eligible offices, exact account-office assignments, project/host/policy/group configuration; test revocation/freshness.
4. Accept registration, coordination, organization mail and separately opted-in Outlook in staging. Add Google station login with its approved mapping/device model.
5. Validate actual guard/reception camera, PWA, language and printing; diagnose tracked print/concurrency findings.
6. Prove coordinated off-VM restore, retention, operational monitoring/support, measured capacity and independent pentest; approve rollout against the agreed acceptance criteria.

Do not insert live keys/data into source docs or weaken authorization to make staging appear complete.
