# 04. Guard workspace and movements

> Maintained manual acceptance catalogue — 3 November 2026. These are test instructions, not newly executed results. [Actual evidence](../system/10_Testing_CI_and_Evidence.md).

Verify using a current assigned duty. Scanning is verification; entry and exit are explicit state-changing actions.

| Case | Exercise | Expected result |
|---|---|---|
| GRD-01 | Sign in and inspect account/common-area/guard-group duties. | Only current granted scope; stale/deallocated duty cannot retain access. |
| GRD-02 | Search/filter expected and inside cards across all assigned loaded scopes. | Assigned visitors are fetched completely; current status/tint and independent inside queues. |
| GRD-03 | Use QR FAB or card to open detail, devices and movement timeline. | Authorized current person/pass only; verification itself creates no entry. |
| GRD-04 | Check in an approved valid account visit; repeat/alter retry and try pending/expired. | Exactly scoped transition; replay safe; invalid approval/pass denied. |
| GRD-05 | Record separate account entries/exits, including another assigned guard exit. | Independent account presence and audit; sibling request does not silently change state. |
| GRD-06 | Verify at a common area and try account movement there. | Common verification only; no account entry/exit or invented global occupancy. |
| GRD-07 | Cancel/replace a pass while the person is inside and perform governed exit/reconciliation. | Existing actual presence is preserved until authorized reasoned correction/exit. |
| GRD-08 | Open profile, language dropdown and switch English/bilingual modes. | Assigned scope visible; helper labels wrap at phone/laptop widths; no full translation-certification claim. |
| GRD-09 | Refresh, revoke duties/session, use a foreign identifier and a pending Host reminder. | Private state cleared on denial; current reminder eligibility/cooldown; no authority from a QR or label. |

Use synthetic identities/media and an approved test environment. Record the environment, source revision, actor/scope, actual result and sanitized correlation. Do not send real email or mutate production as part of a manual documentation walkthrough.
