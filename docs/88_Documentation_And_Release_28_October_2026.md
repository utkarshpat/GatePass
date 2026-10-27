# Documentation and release verification — 28 October 2026

## Scope

This source batch includes forward migrations 112–118 and existing local performance/group-boundary fixes, individual visitor registration and intake-owned card export, private office-host search, multi-day visitor stays/queues, inclusive 23:59 pass labels, responsive Host/Valid until alignment, and root `.env` configuration/validation. Existing local changes have been preserved. Production credentials, personal tokens, photos, SQL runtime data and generated inspection artifacts are excluded.

## Documentation updated

Root/database READMEs, historical database-guide notices, all twelve current handbook chapters, handbook index, SQL/route/environment/source references and maintained test-scenario catalogue are synchronized with reports 83–87. Reports 85–86 document visitor/runtime behavior; report 87 gives the six organization requests and reasons, including planned station Google sign-in. Historical PDFs, earlier screenshots and dated reports remain unchanged historical evidence, explicitly identified by the current index.

Source references can be regenerated with `python tools/update-documentation-references.py`. They contain paths/hashes/configuration names, not live environment values or a live SQL drift attestation.

## Evidence available before this release

| Check | Result |
|---|---|
| Final configuration/validity unit suite | 633 tests: 632 pass, one platform skip, zero failures |
| Coverage | 97.34% lines; 89.94% branches; 94.17% functions |
| Live restricted SQL registration | 58 cases pass, owned fixtures removed |
| Actual public/employee registration HTTP + SQL | 25 cases pass, owned fixtures removed |
| Actual reception manual HTTP + SQL | 7 cases pass, owned fixtures removed |
| Focused visitor/accessibility browser run | 6 pass (phone/laptop form/device details, actual card and intake privacy) |
| Focused Digital ID/visitor regression browser run | 6 pass (shared pending image/retry, Digital ID submission, individual visitor and employee photo flow) |
| Desktop/mobile row geometry | Desktop date/host top coordinates equal; mobile stacked; no horizontal overflow |
| Typecheck/lint/migration integrity | Passing before documentation changes; repeated at pre-push |

The full browser run completed 347 cases: **341 passed, 5 failed, one opt-in skip** (17.4 minutes). Two failures asserted the removed multi-person visitor result UI; these now cover separate employee project requests and retain unknown/duplicate binding rejection. Two onboarding failures read the audit pagination state before its first response; the test now waits for the creation event or a loaded continuation. The independent-session reminder case passed unchanged on rerun; the original run crossed India midnight while its same-day fixture expired, which is consistent with the missing pending row.

A focused rerun of all affected files completed **7/7 passing**, including phone/laptop onboarding and both invalid-result bindings (56.5 seconds). Typecheck and affected-test lint passed again. No application authorization rule was relaxed to satisfy these checks. This is a full initial run plus a passing affected-file rerun, not a second all-green full-suite run.

## Configuration and deployment limits

Actual root `.env` is Git-ignored and the local copy remains development mode. Only `.env.example` is included. Production API/email entry points load and validate configuration; invalid dummy/mock/database/personal-mail settings fail closed. The release source allowlist now includes the empty template, email-worker entry point and configuration checker, without packaging a live `.env`.

Corporate Entra SSO, trusted live directory, organization mailbox delivery, Google OAuth station linking/sign-in, full production web/workspace/media composition, platform key protection, retention, off-VM restore and hardware acceptance remain pending. Google station audit is an agreed model, not an implemented device-binding or individual shift-identification guarantee. Passing local tests does not establish production readiness.

## Publication

The user authorized updating documentation and pushing this source batch. Final publication will use an ordinary commit/push to the existing repository without force-pushing or including private configuration/runtime data. Remote CI completion must be checked separately from local verification.
