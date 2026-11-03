> Documentation status: historical implementation/design/evidence record, indexed 3 November 2026. Read the [current handbook](system/README.md) and [Visit owner/Host glossary](109_Visit_Owner_and_Host_Terminology_03_November_2026.md) for current behavior. Counts, setup examples and screenshots below describe their dated stage, not a fresh certification.

# Coordination email notifications — 2 November 2026

This extends the host/facilities pre-planning dashboard described in [the scope correction](101_Coordination_Only_Scope_02_November_2026.md). Existing registration, QR card allocation, reception printing/return and guard entry/exit remain unchanged. No alternate card, manual plan binding or new guard workflow is introduced.

## Implemented routing

| Event | Recipient and content |
|---|---|
| Submit visit | Assigned internal approval authorities receive their own pending approval step and only destinations they may read. |
| Requested arrangement | Assigned task owners receive their arrangement. Stay dates/notes appear only for the assigned stay task. |
| Ordinary / leadership visit FYI | Current configured location recipients; VIP recipients only for a VIP visit. Basic visitor, host, office and expected window. FYI does not grant dashboard or approval authority. |
| Discussion mention | Explicitly mentioned current thread participants. The email includes the authorized thread title, never message bodies. |
| Decision / arrangement update | Visit host receives an update. |
| Reschedule / cancellation | Still-entitled previous published participants and configured FYI recipients receive the earlier published visit update. Unpublished draft guest details are not disclosed. |

Saving, revising or cancelling a never-submitted draft sends no mail. Each approval remains independent. Emails never approve a request, allocate a card or permit entry. The review link opens the existing authenticated `/coordination#visit=<plan-id>` view; it contains no approval token. Current permissions are checked again when that view is opened.

## Dispatch and privacy

Migration 132 adds a planning-only outbox populated transactionally from newly inserted notice intents. **No historical backfill** is performed. Queue state is separate from ordinary visitor notifications.

The dedicated worker identity claims at most five jobs, with a fenced lease. Before sending, it resolves current directory email, current role/policy/plan relevance and recipient-scoped content; it renews its lease and reads that content again near dispatch. Changed recipient/content is retried, removed authority or obsolete actions are suppressed, and stale directory data retries rather than guessing an address. Guest contact details, purpose, private discussion bodies and unrelated project details are omitted from mail. Completion audit records the plan, location, notice, status and a redacted error code.

Transient failures use bounded backoff (30, 60, 120, 240, then 300 seconds); a maximum of six claimed attempts leads to `DEAD`. Expired claims recover with a new token, so the old worker cannot acknowledge them. No user-facing manual retry/reset facility is claimed here; operators inspect exhausted jobs before any approved repair. The application worker does not gain direct table access. Preview and dispatch procedures are worker-only and have no public API route.

Provider calls run outside database transactions. `SENT` means Graph accepted the message, not confirmed mailbox delivery. A provider acceptance followed by lost acknowledgement can cause a duplicate on retry. Authorization may also change after the final database check and before an external send; authenticated review still enforces current scope. Emails contain only the reduced projection, not a decision credential.

## Configuration and local preview

The existing production email service runs registration and planning batches independently: a failed channel does not starve the other. It reuses approved Graph sender/application configuration, trusted directory and protected worker SQL credentials from `.env`. This change does not require another mailbox/app registration or additional secrets. Existing production identity/directory configuration and HTTPS prerequisites still apply.

Read-only local synthetic preview:

```powershell
npm run mail:planning -- <selected-plan-uuid>
```

This writes protected HTML and a manifest under the user's private GatePass storage. It opens no Graph/Outlook connection, claims no jobs and changes no attempts/status. Only relevant new notices for the selected plan are rendered; existing historical notices were intentionally not queued. Preview files contain scoped visit data and must remain private.

Only after an explicit request to send a test, a developer can use:

```powershell
npm run mail:planning -- <selected-plan-uuid> --send-to <explicit-test-email>
```

This uses the existing personal Outlook development connector, redirects every message to the explicit test recipient and adds a TEST subject prefix. It processes at most five notices for that one selected plan per invocation. It does not drain other plans or normal visitor notifications. It consumes that selected plan's development queue, so use a synthetic test plan. Production must use the approved organizational sender. No real mail was sent as part of this implementation verification.

## Verification and remaining work

- Unit/contract run: **701 cases, 700 passed, one platform skip, zero failures**. Included backend coverage: **97.96% lines, 90.84% branches, 94.68% functions**; frontend rendering is outside these percentages.
- Fresh isolated SQL applies migrations 001–132: **40 schema/permission checks, 47 original planning persistence checks and 27 mail queue/privacy/lease cases** pass. The integration sends six messages through a mocked Graph HTTP client, then verifies no repeat send; it sends no network mail.
- **12/12 real-SQL Coordination browser cases** cover existing independent approval, facilities, privacy, lifecycle and phone/laptop behavior. Twelve synthetic email layouts fit phone/laptop widths; selected phone/laptop screenshots were visually inspected.
- Typecheck, ESLint, frontend bundles and migration integrity are checked separately. Existing guard/reception page source and global stylesheet remain at the preserved operational baseline.
- Local migration 132 was applied: the 30 historical notice records remain, with zero queue rows and no historical resend. The selected-plan read-only CLI preview also passed without connecting to Graph.

Actual organization mailbox delivery, corporate authentication, deployed links and native Outlook/client acceptance are still pending. Automatic handoff from a pre-planned visit to the **existing** registration/QR-card allocation path remains a separate next task. This change does not claim that handoff complete.

Ignored local evidence: `tmp/planning-mail-unit-final.log`, `tmp/planning-mail-integration-final.log`, `tmp/planning-mail-typecheck-final.log`, `tmp/planning-mail-lint-final.log`, and synthetic screenshots under `output/planning-mail/qa/`. No commit or push is included.
