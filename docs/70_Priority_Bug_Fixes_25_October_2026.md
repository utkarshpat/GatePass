> Documentation status: historical implementation/design/evidence record, indexed 3 November 2026. Read the [current handbook](system/README.md) and [Visit owner/Host glossary](109_Visit_Owner_and_Host_Terminology_03_November_2026.md) for current behavior. Counts, setup examples and screenshots below describe their dated stage, not a fresh certification.

# Priority bug fixes — 25 October 2026

The three findings from the application-wide review are fixed locally. Forward migration **099** is applied to the dedicated local test database. Applied migrations 001–098 are preserved byte-for-byte. Existing local follow-up fixes remain in place.

## Notification delivery recovery

A notification cancelled or returned during processing no longer terminates the batch. A lost claim produces a bounded `LEASE_UNAVAILABLE` result for that notification, then processing continues with the next claim. The obsolete token cannot send or acknowledge a recovered job. This applies to claim loss during initial content lookup, renewal, final relevance checking, successful-send acknowledgement and failure acknowledgement.

The production worker loop now catches batch failures inside its running loop. It backs off from one second to a maximum of 30 seconds, resets backoff after a successful batch, and checks shutdown during each one-second sleep. Startup/configuration failures and an unsuccessful explicit `--once` still return failure. Retry diagnostics contain no provider response, recipient, token or SQL details. No provider send was started during verification.

## Employee project occupancy

Migration 099 makes both employee movement paths use the existing employee lock before visit/idempotency work. The duty endpoint and legacy `RecordMovement` check both `EmployeeProjectPresence` and employee-backed `VisitPresence` for the requested project. A hosted pass and Digital ID therefore cannot create two active entries for the same employee/project, including independent simultaneous requests and a project assignment change during a hosted visit.

Guard detail advice uses the same combined occupancy check and suppresses a second Entry action. The original credential's exit and same-key entry/exit replay remain available; after the original exit, either eligible pass type can enter normally. Movement histories and their original visit/credential ownership are preserved. Existing conflicting historical records are not silently merged or deleted: authorized exit/reconciliation remains the recovery path.

## Register export authorization

Migration 099 requires `REPORTS_EXPORT` whenever `@ForExport=1`, in addition to existing visit-read and office/project row authorization. Each export page records `ADMIN_REGISTER_EXPORTED`; ordinary reads retain their own audit action.

The scoped console now projects `canExport`. The service validates its boolean type and defaults an absent field to denied. The UI shows and enables export only when the current scope explicitly permits it; an office/scope change reapplies that permission. Ordinary register reading remains available without export authority. SQL rechecks the permission on each exported page, so withholding or revoking it cannot be bypassed by directly calling the endpoint.

## Reproduction and verification

- The new SQL suite reproduced the old authorization and duplicate-occupancy symptoms before migration. It now passes **17/17 cases**, covering denied/granted/revoked export, separate audit, foreign-office denial, membership transition, both credential orders, both entry endpoints, same-key retries, exit/re-entry, two independent mixed-credential races and execute-only/private-helper permissions.
- Full unit suite: **560 passed, one existing skip, zero failures**. The new worker regressions cover five claim-loss stages, malformed claim batches, recovery/backoff/reset, shutdown and one-shot behavior. Scope projection tests cover true/false/missing/malformed export authority.
- Existing live SQL suites passed: guard duties (**19 cases**), admin register, admin console, pass returns (including sibling-presence and concurrent return/entry) and Digital ID presence (**19 cases**).
- CI unit/coverage run also passed: **560 passed, one existing skip**; lines **97.14%**, branches **89.50%**, functions **93.51%**, above the required thresholds.
- TypeScript and ESLint passed; 99 sequential migration hashes are verified. Whitespace checking uses Git's CRLF-aware setting for this Windows checkout.
- **35/35 selected browser cases passed**: authorized exports and changing datasets, missing export permission, office permission changes, admin boundaries and prior lifecycle fixes, mobile/desktop register filtering/paging/accessibility, a real authenticated SQL register read, reception returns, employee/public registration, guard duties and role workflows. These are targeted cases, not a complete browser-suite run.
- Localhost:8443 was restarted from PID 7732 to PID 16036 with the updated script. Independent Node HTTP probes confirmed staff/admin shells return 200, the served admin script includes the export-authority predicate, UTF-8 text is valid and startup stderr is empty. The admin source probe uses a synthetic placeholder cookie and does not claim an authenticated-session test. The first PowerShell HTTP readiness probe failed despite the listener starting; the final independent Node probe is the recorded runtime success.
- Final read-only database checks: migration 099 present, **zero temporary audit principals**, **zero existing mixed occupancy conflicts**, and **all 26 retained presentation visits present**. Raw hashes confirm all 98 preceding migration files remain unchanged.

Evidence is retained under ignored `output/audit-current/`: `sql-regressions-before.log`, `sql-regressions-fixed.log`, `unit-fixed.log`, `ci-fixed.log`, `browser-fixed.log` and the individual SQL suite logs. Fixtures/principals are invocation-owned and cleaned; retained presentation data is preserved. This is targeted verification of these fixes, not a claim that every project feature has been exhaustively audited. Verification did not send real mail or deploy to production. The user subsequently authorized a final source commit/push; earlier no-push notes describe the preceding verification boundary.

## Final source push

The authorized final source batch includes the earlier browser/session/lifecycle regressions documented in audit 69, migrations 097–099 and the three priority fixes above. The final positive Excel-export page fixture explicitly supplies the newly required export permission. Its admin-page/export run passed all eight cases; seven overlap the preceding 35-case run, for **36 distinct selected browser cases** across the successful runs. The final pass also verifies the migration manifest, CRLF-aware whitespace and staged secret scan before publishing the source. Local SQL records, protected photos/keys, runtime credentials and ignored evidence remain outside the source commit.

For another environment already at migration 098, apply the forward migration through its approved release workflow. The local development helper is:

```powershell
pwsh -File database/setup/Apply-LocalTransactionCore.ps1 -Migration 099 -TrustLocalServerCertificate
pwsh -File database/tests/Test-EmployeePresenceAndExport.ps1 -TrustLocalServerCertificate
```

The certificate-trust flag above belongs to the existing local test SQL setup. The new SQL suite is registered in `tools/ci/Run-SqlChecks.ps1`.
