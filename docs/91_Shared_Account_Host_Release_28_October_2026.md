> Documentation status: historical implementation/design/evidence record, indexed 3 November 2026. Read the [current handbook](system/README.md) and [Visit owner/Host glossary](109_Visit_Owner_and_Host_Terminology_03_November_2026.md) for current behavior. Counts, setup examples and screenshots below describe their dated stage, not a fresh certification.

# Shared Account/host update — 28 October 2026

The user authorized publishing the tested shared Account terminology and approved-host functionality to the `main` branches of both private repositories: `utkarshpat/GatePass` and `utkarshpat/NHSGatePass`.

## Published scope

- Account terminology across the maintained UI, cards, email, reports and documentation; legacy API/database identifiers remain compatible.
- Explicit account-office approved-host management with fresh scope/capability checks, audit metadata, revision fencing and idempotency.
- Approved-host restrictions in visitor, employee and reception selectors, submission/retry, host reads/decisions and approval notification relevance.
- Forward migrations 119–121, test fixtures and current verification/reference documentation.

The retained demo-host approvals described in [report 90](90_Retained_Demo_Host_Acceptance_28_October_2026.md) are local SQL configuration. They are not automatically seeded by a source push. Configure each deployment's approved hosts through authorized administration.

## NHS draft preservation

The independent NHS local checkout contains unfinished, uncommitted NHS-specific form/card/photo changes. The NHS chat was explicitly paused pending this shared update. Those local draft files and inspection scripts are preserved unchanged and are not included in the published shared commit. No reset, force push or checkout overwrite is used. NHS-specific work must reconcile its draft with the updated remote baseline before continuing; publishing this update does not complete or validate the NHS photo-free workflow.

## Verification and exclusions

Feature verification is recorded in [report 89](89_Accounts_And_Approved_Hosts_28_October_2026.md): 636 passing unit tests with one platform skip, 60 registration SQL cases, 25 public/employee HTTP cases, 7 reception manual HTTP cases, 10 native Outlook SQL cases, and passing focused host/card and workspace browser runs. The retained demo acceptance adds six live checks and five complete audit changes.

Pre-publication typecheck, lint and 121 migration hashes passed. The repeated complete unit suite passed 636 tests with one platform skip and zero failures (637 total); coverage was 97.36% lines, 89.94% branches and 94.04% functions. Source hashes are regenerated; the release package remains explicitly a non-production-ready source candidate. A secret scan is required before pushing. Actual `.env`, credentials, SQL/runtime data, private media, temporary logs and generated inspection artifacts are excluded. Remote CI status is separate from these local results.
