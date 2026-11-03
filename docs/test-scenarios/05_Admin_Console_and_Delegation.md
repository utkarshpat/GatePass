# 05. Admin console and delegation

> Maintained manual acceptance catalogue — 3 November 2026. These are test instructions, not newly executed results. [Actual evidence](../system/10_Testing_CI_and_Evidence.md).

Keep the original Admin header, office selector/profile and scoped sidebar. New setup is embedded, not a replacement workspace shell.

| Case | Exercise | Expected result |
|---|---|---|
| ADM-01 | Open Overview under Platform/India/Location/Account grants and switch office/account scope. | Metrics/data/actions match current grants; stale scope responses cannot repaint another office. |
| ADM-02 | Create an account using the scoped Add form, retry a failed response and reload. | Governed creation/replay/audit; duplicate/foreign scope denied. |
| ADM-03 | Manage account leads and approved account-office Hosts. | Explicit current internal eligibility and reason; directory membership alone is insufficient. |
| ADM-04 | Open an account card → Projects & visit hosts; create/edit/disable project and manage project hosts. | Project under the selected account-office; host eligibility retained; configuration reloads correctly. |
| ADM-05 | Open Areas & groups → Common areas; create an area and assign/remove its guard. | Separate area card and fixed-area duties; other area/account data unaffected. |
| ADM-06 | Open Areas & groups → Approval & notification groups; create/edit/disable scoped list. | Internal APPROVAL/NOTIFY and raw-email NOTIFY only; revisions/reasons/actor/time audit retained. |
| ADM-07 | As an account admin, attempt an office-wide or foreign-project group/policy change. | Forbidden UI actions hidden and forged request denied independently in SQL. |
| ADM-08 | Edit Approvals & responsibilities for office/project; switch Approvals, Support & people, Visit limits. | All policy fields retained, invalid hidden sections revealed on save, revisions/audit preserved. |
| ADM-09 | Create/assign/edit/archive Guard account groups and verify linked duties. | These are duty bundles, independent of recipient groups; permission loss clears editor/data. |
| ADM-10 | Use Users & permissions / Add guard for governed local onboarding, setup/reset, grants/revoke. | Credential authority and delegation checked separately; no unauthorized self/broader grants; sensitive tokens excluded from audit. |
| ADM-11 | Open Offices & QR, download/print standee, scan generated QR on phone. | Office-bound link, centered logo and cursive welcome; modal scroll stays inside; actual device scan accepted separately. |
| ADM-12 | Filter/sort/paginate visit register, choose columns and export all matched rows. | SQL applies scope/filter before paging; Excel covers the selected result, formula-like data is text. |
| ADM-13 | Open audit log, filter/query and inspect actor/target/reason. | Append-only authorized/redacted events; no password/hash/token/raw sensitive metadata. |
| ADM-14 | Use nested coordination folders and reload setup/detail links on phone/laptop. | Original shell retained; folder query/pagination/detail reset behaves; coordinator-only users never gain Admin links. |

Use synthetic identities/media and an approved test environment. Record the environment, source revision, actor/scope, actual result and sanitized correlation. Do not send real email or mutate production as part of a manual documentation walkthrough.
