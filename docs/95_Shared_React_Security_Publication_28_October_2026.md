# Shared React and security publication — 28 October 2026

The user authorized pushing this shared checkpoint to the private `main` branches of both `utkarshpat/GatePass` and `utkarshpat/NHSGatePass`. Both remotes were fetched and verified at the shared account-host baseline before publication; repository metadata confirms private visibility and push access.

## Shared checkpoint

- Six native React/TypeScript page implementations with existing UI and business behavior preserved; compatibility controllers are removed from browser assembly.
- Reviewed SQL runtime admission, including unexpected object/procedure grants, database-user impersonation and server permission checks.
- Bounded public/total pending request work, per-source admission and explicit production configuration checks.
- Rejection of legacy short local passwords in production, while retaining the development fixtures.
- Regression tests, six production browser assets, current configuration template, source inventory and security/migration evidence.

## Local verification

The final Node run has 654 cases: 653 passed, one platform skip, zero failures. Included backend coverage is 97.44% lines / 90.20% branches / 94.11% functions; browser-only React code is tested separately. The full browser run passed 358 and skipped one across 359 cases. The later login/setup admission classification follow-up passed focused transport verification and fresh 25-case public/employee and seven-case manual Reception HTTP+SQL suites. SQL admission passes 21 actual cases. Typecheck, ESLint, 121 migration hashes, release integrity and redacted secret scans passed. See [React migration](92_React_Frontend_Migration_28_October_2026.md), [security audit](93_Pre_Pentest_Security_Audit_28_October_2026.md) and [risk hardening](94_Pentest_Risk_Hardening_28_October_2026.md) for exact scope and limits.

Remote CI is separate from these local results. The source candidate remains `deploymentReady: false`; production composition/identity adapters, Linux key deployment and real organization staging acceptance remain open.

## NHS draft preservation

The separate NHS checkout remains at `b41248b` with its unfinished, uncommitted NHS-specific edits and `work/` files. Those files are preserved and excluded from this shared checkpoint. No merge, reset, checkout replacement or force push is performed on that draft.

NHS-specific development must reconcile that draft with the newly published shared baseline. Several draft edits concern the retired HTML/JS page controllers; their intended behavior must be ported to the native React components rather than assuming those controllers remain active. Draft card/photo/service changes also require deliberate reconciliation and NHS-specific verification.

## Publication exclusions

Actual `.env`, credentials, private media/key rings, SQL/runtime data, test logs and generated evidence are excluded. The unrelated pre-existing `outputs/.../Guard_Group_Traceability_26_October_2026.xlsx.inspect.ndjson` remains local and unstaged. Source publication does not move local SQL/demo host configuration or perform a deployment.
