# Coordination-only scope correction

Clarified by the user on 2 November 2026: the requested addition is a host/facilities pre-planning and coordination workspace. Existing QR card allocation and the existing reception/guard operational flow must stay in place.

## Active feature

The Coordination dashboard retains single-guest invitations, same-office cross-account/sub-project requests, independent internal approval steps, facilities/stay arrangements, leadership/VIP FYI configuration, role-scoped threads/replies/remarks/mentions and activity. Hosting eligibility and destination approval remain separate. Preparation readiness in this workspace is not a separate physical gate or a new card workflow.

Ordinary registration, the existing QR visitor card, reception list/history/printing/return, guard scanning and entry/exit remain their existing interfaces and procedures. No new manual linking step, alternate guard panel, extra QR credential or separate presence system is required by the current design.

## Removed extension

Report 100 described an overextended implementation: reception-assisted invitation/pass binding, a separate planned destination operator panel, extra access API, new linked-pass movement logic and plan-driven cancellation of the ordinary pass. These active UI/service/routes and their feature-specific tests have been removed. The guard page, reception page and global stylesheet were restored exactly to their state before those additions; earlier unrelated changes were preserved.

Applied migrations 129/130 are historical and remain immutable. Forward migration 131 reverses their changes to the six affected existing operational/planning procedures, revokes the new API grant and replaces the retired RPC with an unavailable stub. Its empty schema is retained as migration history, not an enabled workflow. The migration refuses automatic restoration if any linked pass, occupancy or movement exists. The retained local database had zero such records; no real visitor data, gate history or ordinary pass was deleted or modified by the correction. No NHS checkout/database was changed.

## Remaining work within scope

Subsequent [report 102](102_Coordination_Email_Notifications_02_November_2026.md) implements scoped Graph dispatch of planning notices to assigned authorities, facilities and configured FYI recipients; real organization delivery acceptance remains pending. A pre-planned guest must eventually hand off automatically to the existing registration/card allocation path, without a receptionist manually linking records or a guard choosing a separate planned workflow. That automatic handoff is not claimed complete here. Existing normal card allocation already works independently. Real organization identity/mail/deployment acceptance remains pending.

Do not treat a separate guard workflow, sub-project movement cutover or mandatory redesign of all walk-ins as required follow-up work. The user's clarification supersedes those earlier inferred tasks.

## Verification

- **685 unit/contract tests: 684 passed, one platform skip, zero failures.** Typecheck, ESLint and seven production React bundles passed.
- Fresh disposable SQL: all 131 migrations parsed/applied, **40 schema/permission checks** and **47 planning workflow/privacy checks** passed. Six checks compare the restored procedure bodies to their pre-extension migration-128 definitions, apart from CREATE/ALTER header and line endings. The retired RPC has no API grant.
- **12/12 real-SQL Coordination browser tests passed**, preserving same-office cross-account selection, independent approvals, role privacy, arrangements, threads, retry, lifecycle and phone/laptop layouts. The owned test database was removed.
- Local migration 131 applied with zero operational extension records. Actual guard, reception and host logins verified the ordinary pages, the preserved Coordination dashboard and the absence (404) of the retired extra access endpoint. No visitor, plan binding or movement was created by these checks.
- Guard/reception page source and the global stylesheet have no diff from their pre-extension baseline. Their built bundle hashes returned to the prior versions. Earlier migration files, unrelated work and the separate NHS checkout were preserved.

Ignored evidence: `tmp/coordination-scope-unit.log`, `tmp/coordination-scope-browser.log`, `tmp/coordination-scope-sql.log`, `tmp/coordination-scope-typecheck.log`, `tmp/coordination-scope-lint.log`, `tmp/coordination-scope-build.log`, `tmp/coordination-scope-local-smoke.log`.

No commit or push is included.
