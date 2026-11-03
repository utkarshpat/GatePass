# 07. Visit coordination, owners, Hosts and groups

> Maintained manual acceptance catalogue — 3 November 2026. These are test instructions, not newly executed results. [Actual evidence](../system/10_Testing_CI_and_Evidence.md).

Visit owner is the invitation creator; Host is an assigned destination account/project permission reviewer. Use current internal synthetic actors with independent roles.

| Case | Exercise | Expected result |
|---|---|---|
| PLAN-01 | Sign in with coordination-only versus Admin+coordination access. | Three folder sidebar items versus nested Admin items; direct authorized landing and mobile drawer. |
| PLAN-02 | Open My visits / Assigned to me / Participating; filter, paginate, reload or close detail using the current folder link. | Correct protected folder query and current scope; no stale private result or lost selected folder. |
| PLAN-03 | Start an invitation; try skipping invalid steps, go back, edit and enter Review. | Six numbered steps preserve input; entering Review does not auto-save. |
| PLAN-04 | Inspect creator identity on create/review/detail/mail; inspect another destination reviewer after deciding. | Creator is Visit owner and not editable ownership; reviewer is Host even after their decision. |
| PLAN-05 | Select another account/project in the eligible source office without membership; use a foreign office directly. | Office-wide authorized destination catalogue; foreign/ineligible source denied; selection grants no access. |
| PLAN-06 | Choose multiple projects or a location-only visit; inspect routing names. | Each selected project has independent Host approval; office baseline always applies. |
| PLAN-07 | Add an internal person by search as project/whole-visit approval or notification. | Actual selected current identity and bounded scope; added review cannot replace mandatory policy or self-approve. |
| PLAN-08 | Select visible custom/VIP groups and inspect every role/member; try raw email approval. | Versioned selection; raw email NOTIFY only; owners cannot edit membership. |
| PLAN-09 | Add services/stay, coordinator, additional FYI contact and alternate receiver. | Required support owner validation; contacts do not transfer ownership/authority; scoped task projections. |
| PLAN-10 | Save draft, submit, interrupt/retry create/change and revise dates/reason. | Draft has no invitation notice; idempotent writes; current revisions and refreshed approvals on material changes. |
| PLAN-11 | Decide one project and inspect another project/Host/security/manager/facilities/FYI views. | Only authorized independent step decisions/private content; no blanket destination authorization. |
| PLAN-12 | Use thread remarks/replies/mentions/history/resolution; attempt unauthorized participant or sibling-project read. | Scoped readers/projections/keyset pagination; no private cross-project leakage. |
| PLAN-13 | Edit/disable a selected group or remove a Host/recipient after submission. | Current revision/readiness conflict as required; removed authority and obsolete notification suppressed. |
| PLAN-14 | Dispatch through mock provider, cancel/revise/revoke before dispatch and simulate lost lease/ack. | Relevance/fencing, bounded retry and reduced content; Graph acceptance remains distinct from inbox delivery. |
| PLAN-15 | Mark planning READY and inspect normal Reception/Guard/card allocation. | No automatic pass creation or new planned gate; existing operational registration/entry/return remains authoritative. |

Use synthetic identities/media and an approved test environment. Record the environment, source revision, actor/scope, actual result and sanitized correlation. Do not send real email or mutate production as part of a manual documentation walkthrough.
