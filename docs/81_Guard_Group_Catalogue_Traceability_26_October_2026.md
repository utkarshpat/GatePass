# Guard Groups case traceability — 26 October 2026

**76 new cases mapped: GP-0574–GP-0649; 54 P0 + 22 P1. Mapping is not a fresh execution PASS.**

Original 649-case input workbook/CSV unchanged hain. First573 base cases is mapping scope mein remap nahi hue. All76 catalogue statuses Not Run preserve hain. Application code, database, test fixtures aur framework/refactor change nahi hua.

**Follow-up:** Upar ka statement original mapping-only snapshot ke liye hai. [Report 82](82_Project_Group_Management_Location_26_October_2026.md) mein later approved UI relocation aur fresh scoped browser verification recorded hain. Machine mapping ke 10 browser references current source/JUnit evidence par refresh hue hain; previous evidence `priorEvidence` mein preserved hai. Mapping counts/catalogue statuses aur original Excel snapshot unchanged hain.

## Mapping summary

| Mapping status | All cases | P0 cases |
|---|---:|---:|
| MAPPED | 20 | 12 |
| PARTIAL | 36 | 29 |
| GAP | 13 | 10 |
| POLICY_ALIGNMENT | 4 | 2 |
| OUT_OF_SCOPE | 3 | 1 |

MAPPED = existing explicit core assertions; PARTIAL = listed delta pending; GAP = composed assertion missing; POLICY_ALIGNMENT = contract wording settle/alignment; OUT_OF_SCOPE = feature not currently shipped. Fixture labels/office names can differ for core behavioral equivalence. Exact catalogue variant/layer differences PARTIAL mein recorded hain.

## Evidence boundaries

- Unit and browser native test names existing XML se reconcile hue; main group source/test hashes saved historical evidence se match hain. SQL grouped suite source hashes match hain aur log statements referenced hain.
- Related older guard/HTTP sources ke historical file hashes record nahi the; those references explicitly source-hash-unverified hain. They never turn group-specific missing scenarios into coverage.
- SQL scripts ke multiple assertions ek grouped passing execution ka part hain; row IDs independently run nahi hue. Local artifacts ignored output folders mein hain, CI/public proof links nahi hain.
- Previous full browser evidence **317 pass / 1 export SQL timeout** remains open. Is mapping se all-application-green claim nahi hua.

## Prioritized remaining work

1. GP-0612/0639/0640: scan→revoke→ENTRY and true concurrent authority races.
2. GP-0628/0629/0631: before/after membership detail, binding and denial audit assertions.
3. GP-0621/0622/0623/0624/0625: actual group endpoint role/IDOR/session deny matrix.
4. GP-0634/0636/0644/0645/0646: injected rollback, inactive mappings, outage/restart/cache composition.
5. Policy rows GP-0592/0613/0637 ko current archive/exit/source semantics se align karo; unsupported privilege restoration implement karna automatically authorized nahi hai.

## All case decisions

| Case | Priority | Mapping | Existing references | Remaining work |
|---|---|---|---|---|
| GP-0574 | P0 | PARTIAL | U02, S01, B_CREATE, B_REAL | Bengaluru ke four named projects aur reload ka exact composed E2E assertion add karo. |
| GP-0575 | P1 | PARTIAL | U05, B_CREATE | Blank-name browser submit aur unchanged database count explicitly assert karo. |
| GP-0576 | P1 | POLICY_ALIGNMENT | C_NAME | Repeated internal whitespace collapse/uniqueness policy define karo; current trim behavior se expected result align karo. |
| GP-0577 | P1 | MAPPED | S03, S06, U08 | Core assertions mapped; catalogue ID still Not Run. |
| GP-0578 | P1 | GAP | C_NAME | Same name ko two authorized offices mein create karke independent IDs/memberships assert karo. |
| GP-0579 | P0 | PARTIAL | U05 | Markup, unicode boundaries aur safe browser rendering/injection payload cases add karo. |
| GP-0580 | P1 | POLICY_ALIGNMENT | U05, C_LIMITS | Expected result ko explicit 1-50 projects contract par set karo; empty group ko supported feature mat assume karo. |
| GP-0581 | P1 | MAPPED | S11, S09 | Core assertions mapped; catalogue ID still Not Run. |
| GP-0582 | P1 | PARTIAL | U01, S06, B_ASSIGN, B_REAL_READ | Multi-group project/guard count badges ko database counts se explicitly reconcile karo. |
| GP-0583 | P1 | OUT_OF_SCOPE | C_LIST | Interactive group search/sort/pagination future scope hai; current acceptance ko supported bounded list par align karo. |
| GP-0584 | P1 | PARTIAL | U02 | Real rename-only mutation ke before/after effective projects equality assert karo. |
| GP-0585 | P0 | MAPPED | S17, S09 | Core assertions mapped; catalogue ID still Not Run. |
| GP-0586 | P0 | MAPPED | S12, S13 | Core assertions mapped; catalogue ID still Not Run. |
| GP-0587 | P0 | PARTIAL | S17, S18 | Concurrent authorized reader ko edit ke saath race karke old-or-new complete sets assert karo. |
| GP-0588 | P0 | MAPPED | S04, U08 | Core assertions mapped; catalogue ID still Not Run. |
| GP-0589 | P0 | PARTIAL | S16, C_CURRENT | Deactivated project aur unmapped location ke negative group-save/assignment cases add karo. |
| GP-0590 | P1 | MAPPED | U05, S05 | Core assertions mapped; catalogue ID still Not Run. |
| GP-0591 | P0 | MAPPED | S12, S13 | Core assertions mapped; catalogue ID still Not Run. |
| GP-0592 | P0 | OUT_OF_SCOPE | C_ARCHIVE | Re-enable/automatic binding restore current feature nahi hai; approved future requirement ya N/A rakho. |
| GP-0593 | P1 | PARTIAL | B_REMOVE, C_ARCHIVE | Real SQL unassigned-group archive aur no-orphan/history assertions add karo; hard delete assume mat karo. |
| GP-0594 | P0 | PARTIAL | B_REMOVE, S12 | Confirmation ke affected guard/project counts aur exact source-preservation state explicitly assert karo. |
| GP-0595 | P0 | MAPPED | S08, S09, B_REAL | Core assertions mapped; catalogue ID still Not Run. |
| GP-0596 | P0 | MAPPED | S11, S09 | Core assertions mapped; catalogue ID still Not Run. |
| GP-0597 | P1 | MAPPED | S17 | Core assertions mapped; catalogue ID still Not Run. |
| GP-0598 | P1 | MAPPED | S08 | Core assertions mapped; catalogue ID still Not Run. |
| GP-0599 | P0 | PARTIAL | S15, B_REMOVE | Same group ke second guard ki bindings/effective projects unchanged explicitly assert karo. |
| GP-0600 | P0 | MAPPED | S07, U08 | Core assertions mapped; catalogue ID still Not Run. |
| GP-0601 | P0 | PARTIAL | S18, C_ELIGIBLE | Inactive user assignment test add karo; unapproved guard ka precise account/role policy define karo. |
| GP-0602 | P0 | GAP | S07, S19 | One guard with two legitimate office roles/groups ka positive per-office effective-set scenario add karo. |
| GP-0603 | P1 | MAPPED | B_ASSIGN, B_REAL_READ | Core assertions mapped; catalogue ID still Not Run. |
| GP-0604 | P0 | MAPPED | S11, S13, S15 | Core assertions mapped; catalogue ID still Not Run. |
| GP-0605 | P0 | MAPPED | S09, S15, U09 | Core assertions mapped; catalogue ID still Not Run. |
| GP-0606 | P0 | MAPPED | S13, B_REAL_DIRECT | Core assertions mapped; catalogue ID still Not Run. |
| GP-0607 | P0 | MAPPED | S11 | Core assertions mapped; catalogue ID still Not Run. |
| GP-0608 | P0 | PARTIAL | S15 | Direct row deallocate karke still-active group se same project authorization assert karo. |
| GP-0609 | P0 | PARTIAL | U05, S19, C_SELF | Self group assignment aur unauthorized admin group mutation ke explicit denial/no-write tests add karo. |
| GP-0610 | P0 | PARTIAL | B_CREATE, C_OFFICE | Misleading floor/office names aur rename se privilege set unchanged test karo. |
| GP-0611 | P0 | PARTIAL | S09, S12, G_QR | Group membership revoke ke baad previously valid QR verification ka composed real SQL/API case add karo. |
| GP-0612 | P0 | GAP | S12, G_MOVE | Scan valid, group revoke commit, phir ENTRY deny aur zero movement event explicitly test karo. |
| GP-0613 | P0 | POLICY_ALIGNMENT | G_RECON, G_MOVE | Group revocation ke context mein exact authorized exit/reconciliation policy choose karke test karo; bypass invent mat karo. |
| GP-0614 | P0 | PARTIAL | G_PENDING, S09 | Group-assigned guard ke pending/denied pass movement attempts par no-entry assertions add karo. |
| GP-0615 | P0 | PARTIAL | G_QR, G_PRESENCE, S11 | Guard group includes Y, person pass lacks Y, verify/move denied composed scenario add karo. |
| GP-0616 | P0 | PARTIAL | S17, C_MUTATION | Employee/visitor permission rows ke before/after unchanged state explicitly assert karo. |
| GP-0617 | P0 | PARTIAL | S09, S11 | Property tests for permutation, repeated memberships aur union idempotence add karo. |
| GP-0618 | P0 | PARTIAL | S11, S12, S13 | Complete before/after effective-set subset property across generated combinations assert karo. |
| GP-0619 | P0 | PARTIAL | U01, S04, S07, S19 | Multi-office grant union mein server filters correct office before returning projects explicitly assert karo. |
| GP-0620 | P1 | MAPPED | U01, U02, U03, U04, U05, U06, U07, U08, U09, U10, S14, B_STALE | Core assertions mapped; catalogue ID still Not Run. |
| GP-0621 | P0 | GAP | C_OFFICE | Authenticated reception token se create/edit/archive/assign/remove 403 aur unchanged DB test karo. |
| GP-0622 | P0 | PARTIAL | S19 | Guard token ke all group mutation endpoints par 403 aur zero writes assert karo. |
| GP-0623 | P0 | PARTIAL | H_AUTH | Named group endpoints par no-cookie/expired-cookie enumeration requests aur non-disclosure explicitly test karo. |
| GP-0624 | P0 | PARTIAL | S04, S19 | Own office body ke saath foreign group ID read/edit/archive/assign/remove IDOR matrix add karo. |
| GP-0625 | P0 | PARTIAL | U05, S04, S19 | Forged positive foreign office ID plus valid own-office group/guard combination mutation test karo. |
| GP-0626 | P0 | PARTIAL | U05, C_NAME | SQL injection strings, markup aur event-handler payloads ke explicit API/DOM nonexecution assertions add karo. |
| GP-0627 | P0 | MAPPED | S14, B_STALE | Core assertions mapped; catalogue ID still Not Run. |
| GP-0628 | P0 | GAP | C_AUDIT | Explicit previous/new membership/name snapshots implement/map karo aur immutable audit assertions add karo. |
| GP-0629 | P0 | GAP | C_AUDIT_GUARD | Assign/remove audit row mein actor/guard/group/time/reason/operation fields assert karo. |
| GP-0630 | P1 | PARTIAL | B_IMPACT, S17 | Exactly three linked guards ke impact count/names/project deltas aur stale-preview conflict assert karo. |
| GP-0631 | P0 | GAP | C_AUDIT_FAIL, U08 | Denied/conflicting group mutations ke audit rows aur absence of sensitive token fields explicitly assert karo. |
| GP-0632 | P0 | PARTIAL | S19, C_FK | Owned rollback fixture mein dangling group/guard/project FK insert violations assert karo. |
| GP-0633 | P0 | PARTIAL | S03, S05, S08, C_NAME | Same name different-office positive case aur relationship enforcement boundary clearly assert karo. |
| GP-0634 | P0 | PARTIAL | S18 | Mid-materialization injected SQL failure ke baad members/children/revision/audit full rollback assert karo. |
| GP-0635 | P0 | PARTIAL | S12, C_ARCHIVE | Before/after audit and movement history row IDs/counts immutable explicitly assert karo. |
| GP-0636 | P0 | GAP | C_CURRENT | Previously assigned group project deactivate/unmap karke subsequent verify/entry deny and policy-visible state assert karo. |
| GP-0637 | P0 | POLICY_ALIGNMENT | S18, G_MOVE | Deallocation ko office GUARD role revocation ke roop mein specify karo; single direct-source removal group access override nahi karega. |
| GP-0638 | P0 | PARTIAL | S05, S14 | Two real admin sessions same project add race; one membership aur explicit conflict assert karo. |
| GP-0639 | P0 | GAP | G_RACE, S12 | Committed group revoke versus concurrent guard ENTRY under authorization lock ka exact race test add karo. |
| GP-0640 | P0 | GAP | S17, S18 | Concurrent group edit versus guard-office revocation/binding removal ka no-restored-access test add karo. |
| GP-0641 | P1 | GAP | C_LIMITS | Supported group sizes/overlaps aur numeric scan p95/p99 SLO define karke benchmark add karo. |
| GP-0642 | P1 | GAP | C_LIMITS | Agreed throughput/scan SLO aur same-time group mutation workload ke SQL waits/deadlocks capture karo. |
| GP-0643 | P1 | OUT_OF_SCOPE | C_LIST, C_LIMITS | Thousands active groups/page/filter expectation revise karo; cap rejection plus bounded active/history datasets test karo. |
| GP-0644 | P0 | PARTIAL | U08, S02, S08 | Actual SQL connection/outage during group transaction, rollback aur explicit recovery/idempotence execute karo. |
| GP-0645 | P0 | GAP | C_MUTATION | Owned assigned group retain karke service restart and fresh authorization read test add karo. |
| GP-0646 | P0 | PARTIAL | S09, S12 | Prime guard QR/thumbnail/context caches then revoke; every sensitive API fail-closed assert karo; UI 20s refresh separate rakho. |
| GP-0647 | P1 | PARTIAL | B_AXE | Keyboard-only creation/selection/save/cancel, focus restoration aur validation error announcements explicitly test karo. |
| GP-0648 | P1 | MAPPED | B_RESPONSIVE, B_IMPACT | Core assertions mapped; catalogue ID still Not Run. |
| GP-0649 | P1 | PARTIAL | S09, B_REAL | Group-assigned guard browser view mein effective projects aur absence of group admin controls assert karo. |

## Reference registry

- **U01** [tests/project-groups.test.ts:13](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/tests/project-groups.test.ts:13>) — group reads sanitize output and bind only the authenticated office. HISTORICAL_PASS_SOURCE_MATCH.
- **U02** [tests/project-groups.test.ts:17](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/tests/project-groups.test.ts:17>) — create and edit bind canonical members and revisions; results exclude raw SQL fields. HISTORICAL_PASS_SOURCE_MATCH.
- **U03** [tests/project-groups.test.ts:23](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/tests/project-groups.test.ts:23>) — archive and group assignment removal use explicit source identity. HISTORICAL_PASS_SOURCE_MATCH.
- **U04** [tests/project-groups.test.ts:28](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/tests/project-groups.test.ts:28>) — group assignments retain end dates and fresh identity bindings. HISTORICAL_PASS_SOURCE_MATCH.
- **U05** [tests/project-groups.test.ts:35](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/tests/project-groups.test.ts:35>) — forged identity, malformed IDs, duplicate or oversized members fail before SQL. HISTORICAL_PASS_SOURCE_MATCH.
- **U06** [tests/project-groups.test.ts:43](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/tests/project-groups.test.ts:43>) — malformed group projections never enable a partial or forged roster. HISTORICAL_PASS_SOURCE_MATCH.
- **U07** [tests/project-groups.test.ts:47](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/tests/project-groups.test.ts:47>) — mutation output must match requested group and operation before reporting success. HISTORICAL_PASS_SOURCE_MATCH.
- **U08** [tests/project-groups.test.ts:50](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/tests/project-groups.test.ts:50>) — denials and conflicts stay explicit; group mutations never automatically retry. HISTORICAL_PASS_SOURCE_MATCH.
- **U09** [tests/project-groups.test.ts:53](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/tests/project-groups.test.ts:53>) — admin assignment projection preserves group provenance without leaking private fields. HISTORICAL_PASS_SOURCE_MATCH.
- **U10** [tests/project-groups.test.ts:59](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/tests/project-groups.test.ts:59>) — production and development console paths route groups through the same service contract. HISTORICAL_PASS_SOURCE_MATCH.
- **S01** [database/tests/Test-ProjectGroups.ps1:24](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/tests/Test-ProjectGroups.ps1:24>) — Create group and initial revision. HISTORICAL_PASS_SOURCE_MATCH.
- **S02** [database/tests/Test-ProjectGroups.ps1:25](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/tests/Test-ProjectGroups.ps1:25>) — Create idempotent replay. HISTORICAL_PASS_SOURCE_MATCH.
- **S03** [database/tests/Test-ProjectGroups.ps1:26](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/tests/Test-ProjectGroups.ps1:26>) — Duplicate office group name. HISTORICAL_PASS_SOURCE_MATCH.
- **S04** [database/tests/Test-ProjectGroups.ps1:27](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/tests/Test-ProjectGroups.ps1:27>) — Reject foreign office group member. HISTORICAL_PASS_SOURCE_MATCH.
- **S05** [database/tests/Test-ProjectGroups.ps1:28](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/tests/Test-ProjectGroups.ps1:28>) — Reject duplicate project members. HISTORICAL_PASS_SOURCE_MATCH.
- **S06** [database/tests/Test-ProjectGroups.ps1:29](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/tests/Test-ProjectGroups.ps1:29>) — Read exactly one created office group. HISTORICAL_PASS_SOURCE_MATCH.
- **S07** [database/tests/Test-ProjectGroups.ps1:32](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/tests/Test-ProjectGroups.ps1:32>) — Reject wrong-office guard. HISTORICAL_PASS_SOURCE_MATCH.
- **S08** [database/tests/Test-ProjectGroups.ps1:33](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/tests/Test-ProjectGroups.ps1:33>) — Assign, replay and fresh-key duplicate binding. HISTORICAL_PASS_SOURCE_MATCH.
- **S09** [database/tests/Test-ProjectGroups.ps1:38](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/tests/Test-ProjectGroups.ps1:38>) — Deduplicated direct/group duties in existing session. HISTORICAL_PASS_SOURCE_MATCH.
- **S11** [database/tests/Test-ProjectGroups.ps1:50](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/tests/Test-ProjectGroups.ps1:50>) — Independent overlapping groups survive one-source removal. HISTORICAL_PASS_SOURCE_MATCH.
- **S12** [database/tests/Test-ProjectGroups.ps1:53](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/tests/Test-ProjectGroups.ps1:53>) — Archive revokes next-call group duty. HISTORICAL_PASS_SOURCE_MATCH.
- **S13** [database/tests/Test-ProjectGroups.ps1:56](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/tests/Test-ProjectGroups.ps1:56>) — Replace members while preserving direct assignment. HISTORICAL_PASS_SOURCE_MATCH.
- **S14** [database/tests/Test-ProjectGroups.ps1:57](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/tests/Test-ProjectGroups.ps1:57>) — Reject stale group revision. HISTORICAL_PASS_SOURCE_MATCH.
- **S15** [database/tests/Test-ProjectGroups.ps1:62](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/tests/Test-ProjectGroups.ps1:62>) — Independent direct source and removed group source. HISTORICAL_PASS_SOURCE_MATCH.
- **S16** [database/tests/Test-ProjectGroups.ps1:75](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/tests/Test-ProjectGroups.ps1:75>) — Persistent local project assignment policy. HISTORICAL_PASS_SOURCE_MATCH.
- **S17** [database/tests/Test-ProjectGroups.ps1:82](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/tests/Test-ProjectGroups.ps1:82>) — Fan out membership to multiple guards and existing session. HISTORICAL_PASS_SOURCE_MATCH.
- **S18** [database/tests/Test-ProjectGroups.ps1:87](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/tests/Test-ProjectGroups.ps1:87>) — Expired role denies and failed addition rolls back. HISTORICAL_PASS_SOURCE_MATCH.
- **S19** [database/tests/Test-ProjectGroups.ps1:93](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/tests/Test-ProjectGroups.ps1:93>) — Guard/project-only/cross-office read denial and execute-only principal. HISTORICAL_PASS_SOURCE_MATCH.
- **B_CREATE** [tests/browser/project-groups.spec.ts:25](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/tests/browser/project-groups.spec.ts:25>) — Create group form. HISTORICAL_PASS_SOURCE_MATCH.
- **B_ASSIGN** [tests/browser/project-groups.spec.ts:26](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/tests/browser/project-groups.spec.ts:26>) — Assigned guard visible. HISTORICAL_PASS_SOURCE_MATCH.
- **B_IMPACT** [tests/browser/project-groups.spec.ts:27](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/tests/browser/project-groups.spec.ts:27>) — Added/removed project and affected guard preview. HISTORICAL_PASS_SOURCE_MATCH.
- **B_AXE** [tests/browser/project-groups.spec.ts:28](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/tests/browser/project-groups.spec.ts:28>) — WCAG and viewport overflow checks. HISTORICAL_PASS_SOURCE_MATCH.
- **B_STALE** [tests/browser/project-groups.spec.ts:29](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/tests/browser/project-groups.spec.ts:29>) — 409 preserves group edit draft. HISTORICAL_PASS_SOURCE_MATCH.
- **B_REMOVE** [tests/browser/project-groups.spec.ts:31](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/tests/browser/project-groups.spec.ts:31>) — Group removal and unassigned archive confirmation. HISTORICAL_PASS_SOURCE_MATCH.
- **B_RESPONSIVE** [tests/browser/project-groups.spec.ts:7](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/tests/browser/project-groups.spec.ts:7>) — Phone and desktop workflows. HISTORICAL_PASS_SOURCE_MATCH.
- **B_REAL** [tests/browser/project-groups.spec.ts:36](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/tests/browser/project-groups.spec.ts:36>) — real SQL-backed admin creates, assigns, edits and archives an owned group through the browser. HISTORICAL_PASS_SOURCE_MATCH.
- **B_REAL_READ** [tests/browser/project-groups.spec.ts:43](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/tests/browser/project-groups.spec.ts:43>) — Persisted members and group assignment count. HISTORICAL_PASS_SOURCE_MATCH.
- **B_REAL_DIRECT** [tests/browser/project-groups.spec.ts:44](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/tests/browser/project-groups.spec.ts:44>) — Direct source survives group membership removal. HISTORICAL_PASS_SOURCE_MATCH.
- **G_PENDING** [database/tests/Test-GuardDuties.ps1:36](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/tests/Test-GuardDuties.ps1:36>) — Related baseline only: Pending visitors can be verified in common areas without gaining project movement. HISTORICAL_PASS_SOURCE_HASH_NOT_RECORDED.
- **G_QR** [database/tests/Test-GuardDuties.ps1:65](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/tests/Test-GuardDuties.ps1:65>) — Related baseline only: Unknown and out-of-duty QR reads return the same neutral result. HISTORICAL_PASS_SOURCE_HASH_NOT_RECORDED.
- **G_MOVE** [database/tests/Test-GuardDuties.ps1:61](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/tests/Test-GuardDuties.ps1:61>) — Related baseline only: Common area duty cannot write an entry or exit event. HISTORICAL_PASS_SOURCE_HASH_NOT_RECORDED.
- **G_RECON** [database/tests/Test-GuardDuties.ps1:91](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/tests/Test-GuardDuties.ps1:91>) — Related baseline only: Revoked credential requires explicit audited project exit reconciliation. HISTORICAL_PASS_SOURCE_HASH_NOT_RECORDED.
- **G_PRESENCE** [database/tests/Test-GuardDuties.ps1:73](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/tests/Test-GuardDuties.ps1:73>) — Related baseline only: Same Digital ID has independent presence in two explicitly assigned projects. HISTORICAL_PASS_SOURCE_HASH_NOT_RECORDED.
- **G_RACE** [database/tests/Test-GuardDuties.ps1:141](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/tests/Test-GuardDuties.ps1:141>) — Related baseline only: Two independent guards racing a Digital ID project entry commit exactly once. HISTORICAL_PASS_SOURCE_HASH_NOT_RECORDED.
- **H_AUTH** [tests/http-api.test.ts:50](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/tests/http-api.test.ts:50>) — Shared HTTP unauthenticated session rejection. HISTORICAL_PASS_SOURCE_HASH_NOT_RECORDED.
- **C_NAME** [database/migrations/110_project_groups_and_guard_assignments.sql:13](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/migrations/110_project_groups_and_guard_assignments.sql:13>) — Trim and office name uniqueness. IMPLEMENTATION_ONLY_NOT_TEST_EVIDENCE.
- **C_LIMITS** [database/migrations/110_project_groups_and_guard_assignments.sql:96](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/migrations/110_project_groups_and_guard_assignments.sql:96>) — Bounded group/member limits. IMPLEMENTATION_ONLY_NOT_TEST_EVIDENCE.
- **C_LIST** [database/migrations/110_project_groups_and_guard_assignments.sql:54](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/migrations/110_project_groups_and_guard_assignments.sql:54>) — Bounded fixed-sort catalogue. IMPLEMENTATION_ONLY_NOT_TEST_EVIDENCE.
- **C_ARCHIVE** [database/migrations/110_project_groups_and_guard_assignments.sql:66](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/migrations/110_project_groups_and_guard_assignments.sql:66>) — Archive is supported; no re-enable command. IMPLEMENTATION_ONLY_NOT_TEST_EVIDENCE.
- **C_CURRENT** [database/migrations/110_project_groups_and_guard_assignments.sql:93](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/migrations/110_project_groups_and_guard_assignments.sql:93>) — Active project mapping check. IMPLEMENTATION_ONLY_NOT_TEST_EVIDENCE.
- **C_ELIGIBLE** [database/migrations/110_project_groups_and_guard_assignments.sql:27](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/migrations/110_project_groups_and_guard_assignments.sql:27>) — Guard account and whole-interval eligibility. IMPLEMENTATION_ONLY_NOT_TEST_EVIDENCE.
- **C_SELF** [database/migrations/110_project_groups_and_guard_assignments.sql:143](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/migrations/110_project_groups_and_guard_assignments.sql:143>) — Self assignment denied. IMPLEMENTATION_ONLY_NOT_TEST_EVIDENCE.
- **C_OFFICE** [database/migrations/110_project_groups_and_guard_assignments.sql:45](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/migrations/110_project_groups_and_guard_assignments.sql:45>) — Office GUARDS_MANAGE required. IMPLEMENTATION_ONLY_NOT_TEST_EVIDENCE.
- **C_MUTATION** [database/migrations/110_project_groups_and_guard_assignments.sql:17](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/migrations/110_project_groups_and_guard_assignments.sql:17>) — Independent materialized guard assignment sources. IMPLEMENTATION_ONLY_NOT_TEST_EVIDENCE.
- **C_AUDIT** [database/migrations/110_project_groups_and_guard_assignments.sql:119](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/migrations/110_project_groups_and_guard_assignments.sql:119>) — Current group mutation metadata. IMPLEMENTATION_ONLY_NOT_TEST_EVIDENCE.
- **C_AUDIT_GUARD** [database/migrations/110_project_groups_and_guard_assignments.sql:164](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/migrations/110_project_groups_and_guard_assignments.sql:164>) — Current binding mutation audit. IMPLEMENTATION_ONLY_NOT_TEST_EVIDENCE.
- **C_AUDIT_FAIL** [database/migrations/110_project_groups_and_guard_assignments.sql:121](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/migrations/110_project_groups_and_guard_assignments.sql:121>) — Mutation failure audit call. IMPLEMENTATION_ONLY_NOT_TEST_EVIDENCE.
- **C_FK** [database/migrations/110_project_groups_and_guard_assignments.sql:14](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/database/migrations/110_project_groups_and_guard_assignments.sql:14>) — Foreign key schema. IMPLEMENTATION_ONLY_NOT_TEST_EVIDENCE.

Machine-readable mapping: `docs/test-traceability/guard-group-v2-mapping.json`. Source anchors, SHA-256 fingerprints, native test names, local artifact hashes aur per-case expected results us file mein preserved hain.


## Deliverables aur verification

- [Filterable Excel mapping](<C:/Users/utpatel/OneDrive - Sopra Steria/Desktop/Gate Pass/outputs/01a16f07-9696-7ce2-8a7a-103e868b25ac/Guard_Group_Traceability_26_October_2026.xlsx>): all76 case IDs, priorities, mapping decisions, existing assertion references, historical artifact paths aur remaining work. Original649-case catalogue unchanged hai.
- Original input rows: `Test Catalogue!A575:P650`; every case ka source range machine JSON mein hai. Available archive hash source review se match hua; all four incoming copies ZIP bytes se match hain.
- Validation: all76 unique cases,54 P0/22 P1;58 reference entries with live line anchors and file SHA-256 checked. Unit/browser native names existing XML se reconcile hue.
- Excel native table/filter `A6:I82`, frozen pane `D7`, cached counts aur change/restore formula response verified; render review complete. Catalogue execution status all76 Not Run hai.
- Is turn mein application tests execute nahi hue; mapping/evidence integrity aur workbook functionality verify hui. No application-source/database/test-data separation change hua.
