# 03. Reception desk and pass returns

> Maintained manual acceptance catalogue — 3 November 2026. These are test instructions, not newly executed results. [Actual evidence](../system/10_Testing_CI_and_Evidence.md).

Use an authorized reception office. The scanner FAB sits above Manual registration; there is no language option in the profile.

| Case | Exercise | Expected result |
|---|---|---|
| REC-01 | Load/reload/filter queues, including a delayed/failed page. | Matching KPIs derive from complete successful reads; failures do not become zero totals or permanent blank state. |
| REC-02 | Search name/employee/pass reference and scan an issued QR. | Authorized matching entry opens directly with available actions, history and movement. |
| REC-03 | Open History and apply valid/invalid date ranges. | Scoped range results, loading/error/retry; no cross-office data. |
| REC-04 | Tap a row or eye icon to view pass. | Card above details/timeline; Host name/email distinct from visitor; no overlapping row controls. |
| REC-05 | Print approved/pending printable cards; attempt expired/revoked card print. | Current server print policy enforced; expired cards have no usable print action. |
| REC-06 | Print/reprint, close/fail decode and retry uncertain transport. | Direct browser print coordinator; correct live job/replay handling; handoff is not physical output. |
| REC-07 | Open Manual registration, complete one visitor, fail/retry a step and close. | Same functional validation/card flow under isolated staff/intake scope; background focus/scroll restored. |
| REC-08 | Send a pending-Host reminder or use an ineligible/foreign request. | Server cooldown/current eligibility/scope; reminder cannot change Host or approve. |
| REC-09 | Try Returned while inside any relevant account or with unconfirmed declared devices. | Return rejected until all current outside/device conditions hold; approved action is audited. |
| REC-10 | Correct a mistaken return with reason; try stale receipt/pass after replacement. | Reasoned current-receipt correction retained alongside original audit; stale correction fenced. |

Use synthetic identities/media and an approved test environment. Record the environment, source revision, actor/scope, actual result and sanitized correlation. Do not send real email or mutate production as part of a manual documentation walkthrough.
