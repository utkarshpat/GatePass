# Accounts and approved hosts — 28 October 2026

## Agreed business meaning

The entity previously labelled Project represents an **Account/Client**. Real projects are subdivisions of that account. Approval and movement authorization apply to the account at the selected office and cover all its subdivisions; another office is not implicitly authorized. No separate sub-project approval model is introduced.

Current UI, labels, filters, account groups, employee flows, emails, card labels, register exports and guard translations use Account terminology. Directory-provided record names remain data and are not rewritten. Existing database/API identifiers such as `Projects`, `ProjectLocationId`, `PROJECT_ADMIN` and `EMPLOYEE_PROJECT` remain compatibility identifiers for accounts. Their presence in code is not a second user-facing project hierarchy.

## Explicit hosts

Account membership alone no longer permits hosting. A host must have an active explicit approval in `gp.AccountHosts` for the exact account-office **and** current employee, office and account membership. An expired/stale/inactive directory record fails closed even when listed.

The same approved-host restriction applies to public visitor, employee account-access and reception manual-registration selectors. Public search remains bounded name/email search without account identifiers or employee-to-account mappings. Visitor routing privately chooses an eligible approved host-account relationship; when a host belongs to several approved accounts at that office, the existing deterministic lowest-ID route remains. There is no new public account picker.

Submission checks SQL again, including retries of a committed intake. Both authenticated and native Outlook decisions recheck the list. Host detail/media access and approval-notification relevance also use current host eligibility. A forwarded URL or known employee ID cannot bypass removal. Already committed approvals/movement entitlement are not retroactively cancelled by removing host authority.

## Administration

Open **Accounts & areas → account card → Manage hosts**. Authorized administrators can search current account employees, add an approved host or remove one; each change requires a reason. Account administrators manage their account scope, location administrators their office, and authorized India/platform administrators their inherited scope. SQL uses the existing `ROLE_GRANTS_MANAGE` capability and exact scope; the role name alone is insufficient. Host-list management does not require permission to appoint another administrator.

The list shows name/email, current directory eligibility, last editor and time. Changes preserve actor, target employee, account-office, timestamp and reason in the scoped audit log. Adding a host grants no administrator role or new employee entry entitlement. Removing a host leaves employee office/account membership unchanged. Removed entries retain revisions; optimistic revision checks reject stale edits, idempotency prevents duplicate retries, and replay still requires current administrator authority.

**Initial rollout:** no employees are automatically added to production host lists. Administrators must populate each account-office list before new hosted requests can be submitted there. Existing accounts without configured hosts deliberately return no selectable hosts. Synthetic SQL/browser fixtures explicitly approve their own test hosts and remove owned fixture data afterward; normal startup does not reinstate a removed host.

On 28 October, the user subsequently requested retained demo hosts. Employee 1, Employee 2 and Employee 4 are now explicitly approved in three Noida demo accounts; see [the retained-host acceptance record](90_Retained_Demo_Host_Acceptance_28_October_2026.md). This manual demo configuration does not change the fail-closed production rollout policy.

## Forward migrations

- 119: explicit lists, scoped execute-only management and live host checks.
- 120: exact management visibility independent of administrator delegation.
- 121: bounded target/actor/scope/reason metadata in the existing audit view.

These are applied locally after 118. Previously applied migrations and business records are preserved. The independent NHS checkout was not modified during implementation; the subsequent shared publication and preservation of its local draft are described in [report 91](91_Shared_Account_Host_Release_28_October_2026.md).

## Verification

| Check | Result |
|---|---|
| Complete unit suite | 637 tests: 636 pass, one platform skip, zero failures; 97.36% lines / 89.95% branches / 94.04% functions |
| Final focused unit verification | 35 pass after final service/UI wiring adjustments |
| Execute-only account-host SQL matrix | Pass: scoped lists and edits, guard/foreign-office denial, account-admin authority, revision conflict, idempotent replay, revoked-authority replay denial, host decision removal, unchanged employee entitlement and scoped audit target/reason |
| Registration SQL | 60 pass, including direct unlisted-host submission and committed retry after removal; owned fixtures removed |
| Public/employee HTTP + SQL | 25 pass; explicit temporary test-host approval and owned cleanup |
| Reception manual HTTP + SQL | 7 pass; explicit temporary test-host approval and owned cleanup |
| Native Outlook SQL | 10 pass, synthetic identities only |
| Final phone/laptop host and visitor browser run | 4 pass: actual add/remove, public selector filtering, scoped audit display and QR-card issuance/privacy |
| General workspace/accessibility browser run | 10 pass: employee, guard, reception, admin, cross-office flow, common duty and approval landing |
| Source checks | Typecheck, lint, whitespace and 121 migration hashes pass |

Initial runs identified obsolete route-count/display-label expectations, the cross-office fixture missing its new explicit host approval, and audit test page size above the existing bound. Those test contracts were corrected; authority checks were retained. The previous 347-case full browser run belongs to report 88; it has not been repeated for this feature. The results above are the new focused runs.

Tests use synthetic accounts, do not send real email and do not establish organization SSO/production readiness. The local web server on port 8443 was restarted for the new source. No Git commit/push or NHS-copy synchronization is part of this request.
