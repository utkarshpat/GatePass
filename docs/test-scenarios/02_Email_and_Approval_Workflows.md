# 02. Email and ordinary approval workflows

> Maintained manual acceptance catalogue — 3 November 2026. These are test instructions, not newly executed results. [Actual evidence](../system/10_Testing_CI_and_Evidence.md).

These cases cover ordinary registration/pass links. Planning notices have separate cases in the coordination catalogue.

| Case | Exercise | Expected result |
|---|---|---|
| MAIL-01 | Create an external/account request and inspect its transactional receipts/notices. | Independent assigned-Host notice and optional holder receipt; no manager approval for temporary IDs. |
| MAIL-02 | Open a Host approval link while signed out, then with the correct identity. | Authentication required; current assigned Host/scope/snapshot controls the explicit decision. |
| MAIL-03 | Visit GET/link-preview, forward a review link, use another identity, replay/change a decision. | GET never decides; forwarding grants no authority; same-key replay is safe and opposite/stale decision conflicts. |
| MAIL-04 | Open employee status under another employee; try an external reference without its capability. | Denied/reduced response without ownership or signed individual authority. |
| MAIL-05 | Exchange external fragment link for holder session, reload and expire/revoke it. | Only that visit is accessible; refresh is supported while authorization remains valid. |
| MAIL-06 | Render company/device details and final-day validity in email/status/card. | Correct escaped text, same 23:59 display policy; no unrelated private data. |
| MAIL-07 | Remind pending Host from authorized Reception/Guard; retry inside cooldown or after return. | Current eligibility/cooldown checked; no approval bypass or duplicate logical action. |
| MAIL-08 | Exercise mock transport acceptance, lease loss and retry; inspect native Outlook while disabled. | Provider acceptance is distinct from delivery; fenced retries; Outlook requires its separate real onboarding. |

Use synthetic identities/media and an approved test environment. Record the environment, source revision, actor/scope, actual result and sanitized correlation. Do not send real email or mutate production as part of a manual documentation walkthrough.
