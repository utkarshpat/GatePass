# 09. Deployment, operations and recovery

> Current source documentation: **28 October 2026**, migrations **001–121**. See [current release/configuration evidence](../88_Documentation_And_Release_28_October_2026.md), [individual visitor flow](../85_Individual_Visitor_Registration_27_October_2026.md), [runtime .env configuration](../86_Runtime_Environment_Configuration.md) and [organization requirements](../87_Organization_Production_Requirements.md). Earlier exported PDFs, screenshots and dated reports are historical.

## Target and boundary
Agreed target: private Ubuntu Server 24.04 LTS x86-64 VM for UI/API, worker, SQL Server Express and private media, with protected off-VM backups. This is intended topology, not deployed evidence or a fresh vendor compatibility/licensing assessment. Windows DPAPI-protected files cannot simply be copied to Linux and assumed operational.

Validate exact OS/SQL edition/CU compatibility, organizational entitlements, hosting cost, service accounts and support policy. This documentation/CI package creates no VM, purchase or deployment.

## Organization inputs
The six requested deliverables are an application VM, reachable default hostname with HTTPS, organization no-reply Graph mail integration, trusted employee data feed, Entra SSO configuration and managed Google station-account/OAuth configuration. Retention, operating ownership and off-VM backup destination also need confirmation. See [the full request list](../87_Organization_Production_Requirements.md).

Production configuration lives in a private root `.env` with restrictive filesystem permissions. Deploy `.env.example` as a template only; never package actual `.env`. API/email startup validates required settings. Key rings, photos, SQL data and PEM files remain their own protected assets. Do not deploy development dummy adapters as a shortcut.

## Deployment sequence

Release preparation now includes six immutable React assets plus `public/frontend-manifest.json`. Build with locked dependencies before packaging. The manifest supplies the asset for each React document; it does not supply the missing production identity/session/workspace composition. Print/offline documents remain HTML. See [migration and build ownership](../92_React_Frontend_Migration_28_October_2026.md).
1. Complete production UI/endpoints and approved identity/directory composition.
2. Provision staging with private SQL, trusted TLS and independent principals.
3. Implement Linux media permissions/key protector and controlled rewrap/migration retaining key IDs.
4. Back up coordinated SQL/referenced media/keys; record artifact and migration manifest.
5. Apply missing forward scripts as migration identity; verify ledger, constraints and permissions.
6. Deploy compatible UI/API/worker and exact origin/key modules with bounded supervision.
7. Accept authenticated workflows, negative scope/retry, real camera/printer/device and organization mail.
8. Approve rollout, observe and retain a tested recovery path.

Reverse-proxy trust is a separate decision. Current production admission expects direct TLS and does not trust arbitrary forwarded headers. X-Forwarded-Proto alone cannot satisfy that contract. Never enable dummy/elevated access just to pass staging.

## Operator signals
| Signal | Response |
|---|---|
| Controlled API startup failure | Verify config/TLS/key permissions and SQL separation without printing secrets |
| Authorization failure | Check current session, office/account, freshness, grant and allocation |
| Quota/stale storage lock | Reconcile SQL references/files; no blind deletion or lock stealing |
| Notification retry/age | Inspect lease, recipient freshness, sender/provider and relevance |
| Unconfirmed print | Query live job; separate dispatch, popup display and printer output |
| Unknown movement | Refresh/replay same key; inspect immutable events/presence |
| SQL constraint/deadlock | Preserve sanitized correlations and diagnose without weakening constraints |

Central metrics/alerts, thresholds, supervision, retention scheduling, SLA ownership and backup operation remain production work. These are runbook requirements, not finished dashboards.

## Backup/restore
Protect SQL, referenced media, QR key versions, external-link/action key rings and adapter configuration. Use encrypted/access-controlled off-VM organization storage. Preserve key IDs and the identity/provider needed to unwrap them. Photos are OS-private files; independent per-photo at-rest encryption is not claimed.

Restore isolated: check SQL integrity/ledger, recover referenced media/keys, test a previously issued sample pass/status link, prove scope denial, reconcile outbox leases/provider ambiguity, and avoid blind redispatch. Agree/demonstrate RPO/RTO instead of inventing values. Source rollback may not fit migrated SQL; use reviewed roll-forward or coordinated restore. No destructive automatic down-migration policy exists.

## Retention/privacy
Default media quotas: 512 MiB and 10,000 files. Immutable bounded publication fails closed when full. Reference-aware staged/orphan cleanup and production retention policy remain required. A timed-out SQL request may have committed; age alone cannot justify deleting its photo. Policy owners must define request/photo/audit/export/backup durations.

## Incidents
Contain affected identities/scopes or the specific worker; preserve protected redacted evidence. Revoke/reset through governed paths and reconcile occupants/print/mail before broad retry. Exposure needs key-specific impact analysis: QR encryption, external status and Outlook action rings are separate rotations.

Sources: docs/database/22_Private_Photos_and_QR_Key_Storage.md; docs/37_Reception_Audit.md; runtime/CI source.

## Account host policy update

See [accounts and approved hosts](../89_Accounts_And_Approved_Hosts_28_October_2026.md). Account-office host lists are explicit and administered within scope; membership alone does not enable hosting. Legacy API/schema names remain compatible.
