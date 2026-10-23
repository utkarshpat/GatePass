# 11. Readiness, gaps and roadmap

> Current local changes and presentation evidence (23 October 2026): [retained browser rehearsal](../55_Presentation_Rehearsal_23_October_2026.md). Source migrations are 001–085. The original 22 October export and snapshot remain historical.

## Status matrix
| Area | Current status | Remaining acceptance |
|---|---|---|
| Public/employee forms | Local actual SQL/private photos | Corporate SSO/MFA/directory and devices |
| Exact office/project authorization | Implemented services/migrations | Trustworthy entitlement feed/lifecycle sync |
| Guard cards/duties/movement | Local project presence/common verification | Physical camera, language/users and reconciliation operations |
| Reception preview/print/reprint | Audited/retry-aware local implementation | Physical printer/media; historical SQL 547 investigation |
| Admin projects/leads/common areas | Scoped local UI | Broader necessary staff/credential/reporting UI |
| Report/audit/staff backends | Service/SQL contracts | Production exposure/permission review and required screens |
| Email/status/host workflow | Code and confirmed personal test delivery | Organization Graph/mailbox, company delivery, reachable deployed links |
| Native Outlook | Code/SQL tests; disabled by default | Provider/Entra/public HTTPS/stable identity/client onboarding |
| PWA | Manifest/icons/public-only offline shell | Install/device acceptance; no offline entry |
| Media/keys | Windows ACL/DPAPI | Linux protector, reference-aware cleanup, retention/recovery |
| CI | Quality and opt-in integration/probe | Current remote run, branch rules and minutes policy |
| Production | Target/API boundary partially composed | Full hosting/composition, identities, deployment/operations |

## Next sequence
1. Complete production composition: UI routes, auth/session adapters, media/renderer and staff workspace endpoints. Prove equivalent authorization in staging.
2. Obtain organizational SSO/directory/mail inputs. Feed explicit primary office, exact project-office assignments and stable Entra mappings, not inferred affiliation.
3. Implement Linux key/storage/retention and coordinated recovery; accept off-VM backups before meaningful personal data.
4. Perform staged corporate identity/mail acceptance and native Outlook only after its separate onboarding.
5. Test representative guard/reception devices, languages/printers; characterize historical print failure with correlations.
6. Establish monitoring, RPO/RTO, load/soak targets, operational ownership and branch/release rules.

## Open decisions
Organization API/app/mailbox permissions, Linux protector, hosting/proxy contract, retention durations, backup destination/RPO/RTO, capacity targets and required broader admin/reporting screens require approved inputs. Documentation does not silently decide them.

Passing unit tests, local pages or a source candidate is not production certification. No commit/push, mail, approval, grant, migration or deployment is part of this documentation task.
