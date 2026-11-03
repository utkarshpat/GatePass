# 10. Testing, CI and evidence

> Maintained source handbook — **3 November 2026 · migrations 001–136**. [Current status and evidence](11_Readiness_Gaps_and_Roadmap.md) · [Terminology](../109_Visit_Owner_and_Host_Terminology_03_November_2026.md). Source review is not production acceptance.

## Evidence is scoped and dated

The documentation-only refresh did not rerun application/SQL/provider tests. A subsequent user-authorized push ran the fresh full Node/static checks recorded below. SQL/browser entries remain their dated focused runs; no remote CI or production certification is claimed.

| Recorded check | Latest relevant result | Limit |
|---|---|---|
| Full Node/contract baseline, 2 November | 723 cases: 722 pass, one platform skip | Historical baseline before the terminology test additions |
| Pre-push full Node/contract run, 3 November | 727 cases: 726 pass, one platform skip, zero failures; included backend coverage 97.77% lines / 91.14% branches / 94.78% functions | Fresh complete rerun after one earlier subprocess timeout; no code/test relaxation was used |
| Coordination isolated database | 174 checks: schema/permission 40, management/workflow 47, mail 27, preparation 31, groups 29 | Disposable owned SQL; not a fresh audit of deployed/retained infrastructure |
| Coordination browser acceptance | 17 passed | Real owned SQL, mocked provider; phone/laptop, save/retry, scopes, threads, preparation/groups |
| Admin/navigation/area/group checks | 34 distinct cases passed across focused runs | Combined evidence, not a repeated full application browser sweep |
| 3 November role/email follow-up | 20 unit checks and two browser cases passed | Visit owner/Host display, post-decision role and planning mail labels; browser presentation fixtures retain real staff sign-in |
| Static source checks | Typecheck/lint, 222-module dependency boundaries, seven bundles and 136 migration hashes passed | Source/compile evidence, not production runtime composition |
| Secret scan | Last local source/history scan reported no leaks | No claim of a new provider/infrastructure audit or zero future vulnerabilities |

The 34 Admin cases are the union of four overflow, five folder/setup, eight staff navigation, four embedded-layout, two area-boundary, four area-workspace and seven guard-group cases. Outdated assertion failures were corrected for new setup URLs/visibility and the affected files passed; failed intermediate runs are not reported as clean full runs.

Historical coverage percentages in numbered reports describe their included backend source and dates. Browser React files are excluded from Node backend coverage; do not present those percentages as full frontend coverage or zero-bug proof. Older full browser counts remain historical.

## Confidence layers

Static checks validate contracts/import boundaries. Unit tests exercise adapters/policies/rendering. Execute-only SQL tests exercise actual permissions, transactions, retries and privacy. Browser/Axe cases exercise selected interactions, lifecycle, responsive layout and automated accessibility rules. None alone proves corporate identity/mail, native devices, physical output, recovery, full accessibility or an independent pentest.

## Commands and safety

```powershell
npm run typecheck
npm run lint
npm run check:architecture
npm run check:migrations
npm run build:frontend
npm run test:ci
npm run test:browser
npm run test:coordination
```

Use the configured/pinned Sharp package for decoder tests. `test:coordination` creates a marked owned database, applies all migrations, tests real persistence/mail adapters with a mock provider, runs its dedicated browser configuration, and removes only its owned database. It refuses an existing fixture pointer. Do not manually delete an unverified database or run independent SQL-heavy suites concurrently against shared resources.

## CI behavior

The checked-in Azure YAML uses main push/PR quality triggers with `docs/**` and root README excluded. Quality uses UseNode@1, locked install, redacted secret scanning, npm audit high/critical threshold, typecheck/lint/architecture/migration/build, Node JUnit/coverage and allowlisted source candidate packaging. Included-source coverage gates are 90% lines, 80% branches and 90% functions.

Integration and already-deployed staging smoke are separate opt-in parameters for hosted-minute control. Integration initializes isolated Windows SQL, runs SQL/browser checks sequentially, then the coordination harness. Staging smoke does not deploy or prove authenticated acceptance. Branch protection/review/bypass policy is configured separately. No current Azure run or billing status was queried during this documentation refresh.

## Outstanding acceptance

Run organization SSO/directory/mail, actual Outlook tokens/clients, representative guard/reception camera/PWA/printer/language and managed-device cases in staging. Confirm historical print SQL 547 diagnostics and concurrency findings with sanitized correlations; prior final runs did not establish a universal fix. Measure restore/load/soak and agree operational targets.

Publish only appropriate redacted JUnit/coverage/logs. Authenticated screenshots, traces, photos, capability URLs, credentials and private SQL/media dumps require separate explicit artifact handling. [Manual scenarios](../test-scenarios/README.md) are a case catalogue, not an execution count.

Pre-push source/candidate secret checks passed using the pinned scanner and existing narrow public-digest allowlist. Typecheck, lint, architecture, migration hashes and frontend build passed. No real email or new production acceptance was performed for publication.
