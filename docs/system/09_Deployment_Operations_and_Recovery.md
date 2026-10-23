# 09. Deployment, operations and recovery

> Current local changes and presentation evidence (23 October 2026): [retained browser rehearsal](../55_Presentation_Rehearsal_23_October_2026.md). Source migrations are 001–085. The original 22 October export and snapshot remain historical.

## Target and boundary
Agreed target: private Ubuntu Server 24.04 LTS x86-64 VM for UI/API, worker, SQL Server Express and private media, with protected off-VM backups. This is intended topology, not deployed evidence or a fresh vendor compatibility/licensing assessment. Windows DPAPI-protected files cannot simply be copied to Linux and assumed operational.

Validate exact OS/SQL edition/CU compatibility, organizational entitlements, hosting cost, service accounts and support policy. This documentation/CI package creates no VM, purchase or deployment.

## Deployment sequence
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
| Authorization failure | Check current session, office/project, freshness, grant and allocation |
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
