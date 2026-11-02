# 11. Readiness, gaps and roadmap

> Current source documentation: **2 November 2026**, migrations **001–132**. See [current release/configuration evidence](../88_Documentation_And_Release_28_October_2026.md), [individual visitor flow](../85_Individual_Visitor_Registration_27_October_2026.md), [runtime .env configuration](../86_Runtime_Environment_Configuration.md) and [organization requirements](../87_Organization_Production_Requirements.md). Earlier exported PDFs, screenshots and dated reports are historical.

## Status matrix
| Area | Current status | Remaining acceptance |
|---|---|---|
| Frontend | Seven React/TSX page views with native React models and interactions | Print/offline HTML retained; corporate/device acceptance |
| Public/employee forms | Local actual SQL/private photos | Corporate SSO/MFA/directory and devices |
| Exact office/account authorization | Implemented services/migrations | Trustworthy entitlement feed/lifecycle sync |
| Guard cards/duties/movement | Local account presence/common verification | Physical camera, language/users and reconciliation operations |
| Reception preview/print/reprint | Audited/retry-aware local implementation | Physical printer/media; historical SQL 547 investigation |
| Admin accounts/leads/common areas | Scoped local UI | Current scoped UI complete for local workflows; corporate provider/deployment acceptance |
| Report/audit/staff backends | Service/SQL contracts | Production exposure and organizational permission review |
| Email/status/host workflow | Code and confirmed personal test delivery | Organization Graph/mailbox, company delivery, reachable deployed links |
| Native Outlook | Code/SQL tests; disabled by default | Provider/Entra/public HTTPS/stable identity/client onboarding |
| Visit Coordination | Scoped host/facilities dashboard: invitations, approvals, arrangements, discussions and activity; existing operational flows preserved | Automatic handoff to the existing registration/card flow; corporate configuration and real mail acceptance (scoped planning dispatch is implemented) |
| PWA | Manifest/icons/public-only offline shell | Install/device acceptance; no offline entry |
| Media/keys | Windows ACL/DPAPI | Linux protector, reference-aware cleanup, retention/recovery |
| CI | Quality and opt-in integration/probe | Current remote run, branch rules and minutes policy |
| Production | Target/API boundary partially composed | Complete production composition, Entra/Google identities, directory/mail integration and operations |

## Current configuration and station-login status
Root `.env` loading/template/startup validation are implemented. Organization credentials are not populated. Google station sign-in is an agreed model, not implemented: IT-owned tablet account maps to a station/location/scope, and audit identifies that station rather than the person on shift. Entra corporate SSO/MFA and trusted directory integration remain pending. Physical-device binding requires a separately enforced device policy.

## Next sequence
1. Complete production composition: UI routes, auth/session adapters, media/renderer and staff workspace endpoints. Prove equivalent authorization in staging.
2. Obtain organizational SSO/directory/mail inputs. Feed explicit primary office, exact account-office assignments and stable Entra mappings, not inferred affiliation.
3. Implement Linux key/storage/retention and coordinated recovery; accept off-VM backups before meaningful personal data.
4. Perform staged corporate identity/mail acceptance and native Outlook only after its separate onboarding.
5. Test representative guard/reception devices, languages/printers; characterize historical print failure with correlations.
6. Establish monitoring, RPO/RTO, load/soak targets, operational ownership and branch/release rules.

## Open decisions
Organization API/app/mailbox permissions, Linux protector, hosting/proxy contract, retention durations, backup destination/RPO/RTO, capacity targets and required broader admin/reporting screens require approved inputs. Documentation does not silently decide them.

Passing unit tests, local pages or a source candidate is not production certification. The dated evidence distinguishes source changes, local migrations, synthetic approvals and production/provider actions. The 1 November planning implementation applied additive local migrations; no real planning mail, commit or push was performed.

## Account host policy update

See [accounts and approved hosts](../89_Accounts_And_Approved_Hosts_28_October_2026.md). Account-office host lists are explicit and administered within scope; membership alone does not enable hosting. Legacy API/schema names remain compatible.

## Pre-pentest status

See [the 28 October security audit](../93_Pre_Pentest_Security_Audit_28_October_2026.md) for a fixed SQL runtime admission gap, measured local security evidence and the remaining production/staging blockers. Corporate identity/device controls and complete production composition remain pending. No source/local test result constitutes independent pentest approval.

## Additional risk hardening

[Report 94](../94_Pentest_Risk_Hardening_28_October_2026.md) adds reviewed SQL procedure-grant admission, database-user impersonation and server-permission rejection, bounded public/total pending work, explicit production mode/credential checks and rejection of legacy short local passwords in production. Production web/identity implementation, Linux key deployment and actual staging acceptance remain required; these fixes do not mark those items complete.
