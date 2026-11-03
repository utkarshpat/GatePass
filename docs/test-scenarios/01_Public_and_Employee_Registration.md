# 01. Public and employee registration

> Maintained manual acceptance catalogue — 3 November 2026. These are test instructions, not newly executed results. [Actual evidence](../system/10_Testing_CI_and_Evidence.md).

Office QR binds location. Employee corporate identity is intended; the local adapter is dummy. Ordinary pass Host means the selected authorized person; it is not the planning Visit owner label.

| Case | Exercise | Expected result |
|---|---|---|
| REG-01 | Open each configured office QR and attempt to change office fields directly. | Correct server-bound context; forged office is rejected. |
| REG-02 | Authenticate employee1, inspect primary office and eligible account-office choices. | Directory-derived office/entitlements; no array-order or same-account cross-office access. |
| REG-03 | Request a temporary ID with reason, live camera image and review. | Eligible same-day auto-approval and current downloadable card; manager notice is informational. |
| REG-04 | Request again/retry, then revoke entitlement and retry. | Valid same-day reuse/idempotency; revoked or stale entitlement cannot reuse/issue a pass. |
| REG-05 | Request another authorized account-office with its eligible Host. | Independent exact-scope request/approval; no permanent membership is added. |
| REG-06 | Register one visitor with optional company/device types and no email. | Card/status available under the active matching intake; pending card is not entry permission. |
| REG-07 | Search Hosts by name/email at the office; inspect returned public data. | Only eligible office Host results; no account/project catalogue or mappings. |
| REG-08 | Try Add visitor/grouped API payload, public account filter or gallery file upload. | No grouped UI/gallery control; disallowed payloads are rejected without partial registration. |
| REG-09 | Select an inclusive multi-day final date, reload queues on a still-valid day, then cross expiry. | Starts today; labels end final date 23:59; exclusive timestamp controls expiry and queues retain valid stays. |
| REG-10 | Try malformed phone/company/device fields, missing photo, stale intake and another intake card ID. | Validation/privacy rejection; card download cannot cross intake ownership. |

Use synthetic identities/media and an approved test environment. Record the environment, source revision, actor/scope, actual result and sanitized correlation. Do not send real email or mutate production as part of a manual documentation walkthrough.
