# CI checks and limits

## Automatic Quality stage

- Full Git history: Gitleaks 8.30.1, downloaded from its official release and
  checked against its release SHA-256. Output is redacted. Three exact QR
  purpose/version fixture identifiers are allowlisted. SHA-256 digests are also
  allowed only in the exact migration manifest path; no test folder is ignored.
- Dependency installation uses `npm ci` and the lockfile. `npm audit` blocks
  known high/critical advisories in development and runtime dependencies.
- Strict TypeScript checks application modules, TypeScript tools and browser
  tests. ESLint checks syntax and suspicious constructs in browser/server/tool
  code; shared classic-script globals and intentionally redacted error causes
  have explicit configuration exceptions.
- Migration numbering and canonical LF hashes must match the manifest. In Azure,
  existing migration edits/deletions are rejected against the prior commit or PR
  target. Add a forward migration and regenerate the manifest with
  `node tools/ci/migrations.mjs --write`.
- Unit/contract JUnit results and LCOV coverage are published. Coverage is for
  TypeScript source, including unimported TS files, not SQL or browser JavaScript.
  Gates: 90% lines, 80% branches, 90% functions. Current local baseline:
  92.00% lines, 85.74% branches, 95.01% functions.
- A revision-bound SHA-256 manifest accompanies an explicit source allowlist.
  Development entrypoints/fixtures, private storage, credentials, node_modules
  and validation exports are excluded. The artifact says `deploymentReady:false`:
  it is a source release candidate, not a working production deployment.

## Manual integration stage

In Azure **Run pipeline**, set `runIntegration=true`. Runs after Quality passes:

1. Creates a new uniquely-named private LocalDB instance on the disposable Windows
   hosted agent; never connects to the developer's or organisation's database.
2. Parses/applies every migration, verifies the ledger and trusted foreign keys,
   and runs actual schema-constraint fixtures.
3. Seeds synthetic employee/guard/admin/reception identities. Test credentials
   remain on the disposable agent; no production credentials are needed.
4. Runs 40 transaction/security cases (including approval races, current scope
   revocation, SQL execute-only access, rollback and idempotent concurrent entry)
   and the 18 public/employee HTTP/SQL integration cases. Each owns/cleans its
   fixtures. JUnit reports suite-level results; individual checks remain in logs.
5. Runs Chromium workflows at mobile/laptop widths, photo crop review, guard
   filters/language/profile and reception/admin sign-in. Axe checks WCAG A/AA
   rules on these states and checks horizontal overflow. Browser tests do not
   replace manual usability, native camera, translation or printer acceptance.

No authenticated screenshots, traces, videos, database dumps, account inventories
or private photos are published as artifacts. The job is bounded to 35 minutes.
Hosted LocalDB is Windows SQL compatibility coverage; Linux SQL 2025 restore,
service/key-provider and production composition validation remain rollout gates.

## Existing staging smoke probe

`runStagingSmoke=false` by default. To use it, provision staging first and supply
its exact HTTPS origin. The probe verifies public entry pages, CSP/HSTS and denial
of unauthenticated guard reads. It sends no credentials and performs no writes.
It is not a deployment job, penetration test or authenticated end-to-end test.

## Cost and external setup

No paid scanner subscription, hosted capacity purchase, cloud VM or billing
change is configured. Pushes are batched, obsolete PR runs are cancelled,
documentation-only changes are excluded and dependency downloads are cached.
Organisation-wide agent entitlement and existing billing still determine cost;
the repository cannot promise unused free minutes for the entire organisation.
SQL/browser checks remain manual until that budget is agreed.

GitHub required-status/PR-review branch rules must be configured separately in
repository settings after the new job has reported a status. This YAML does not
prevent an administrator from pushing directly or bypassing a failing check.
Real SSO/directory/mail integration, staging infrastructure, deployment approval,
load/soak testing, disaster recovery and physical printer acceptance remain
separate production-readiness work.
