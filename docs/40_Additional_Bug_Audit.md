# Additional bug audit — 22 October 2026

Scope: current local working tree, including the previous fixes and existing local edits. This is a findings report, not a fix batch. No source change, migration, commit, push, external email, approval email or physical print was performed for this audit. SQL reproductions used fresh, isolated, synthetic fixtures in GatePass_DesignTest with a restricted gp_api_runtime principal; exact owned registrations, transaction fixtures and that principal were cleaned in finally blocks.

Follow-up: [41 Participant, Contact and Presence Fixes](41_Participant_Contact_and_Presence_Fixes.md) records the subsequent corrections and regression evidence. This document preserves the original findings.

## 1. [P2] Group results attach the wrong person's name to a pass number

Sources: src/app/employee-portal.js:451-456; src/registration/RegistrationService.ts:181-193; database/migrations/061_email_request_workflow.sql:288-290.

The SQL registration response sorts participants by clientPersonKey. The service validates those keys but preserves SQL response order. The success page instead labels each result with job.people[index].name, assuming response order equals form order. The person keys are independent random UUIDs, so this assumption fails for ordinary group requests.

Reproduction:

- Actual restricted SQL submission: input Alice then Bob, with Alice's key sorting after Bob's. SQL returns Bob then Alice.
- Actual application rendering in Chromium, with synthetic jobs in that same response order: Alice is displayed beside GP-BOB and Bob beside GP-ALICE.
- This browser check invokes the actual showResults renderer; it does not submit a real form. It does not claim that stored SQL identities/photos were swapped: the association error is in the confirmation UI.

Impact: users copy or communicate another participant's pass reference. Independent approval states can likewise be labelled as the wrong participant if returned statuses differ.

Recommended fix: resolve every result by visit.clientPersonKey against job.people[].key; do not zip arrays by index. Reject missing/duplicate bindings. Add a reversed-key group regression with different participant statuses.

## 2. [P2] Reception and operational summaries miss current Temporary ID project occupants

Sources: database/migrations/020_admin_read_boundaries.sql:67-80; database/migrations/026_reception_empty_list.sql:35-40; database/migrations/060_project_presence_conflict_checks.sql:92-97.

Temporary ID project entry now updates EmployeeProjectPresence. Reception list and the operational summary still read only the older VisitPresence.IsInside field, which remains false for these movements. A project-scoped summary also selects by VisitRequests.ProjectLocationId, which is NULL for Temporary IDs, so it omits the occupant entirely.

Actual restricted SQL reproduction:

| Observation | Result |
|---|---|
| RecordGuardDutyMovement entry | isInside=true |
| EmployeeProjectPresence | 1 active inside row |
| Office GetOperationalSummary | digitalIdsInside="0" |
| Project GetOperationalSummary | digitalIdsInside="0" |
| ListReceptionVisits Temporary ID row | isInside=false |

Impact: guard and reception/admin views disagree about presence; the reception Inside indicator/counter and operational reports undercount these employees. This is not an entry authorization bypass. Office-wide presence must not be described as confirmed building occupancy because common verification does not record a building movement.

Recommended fix: update these read models in a forward migration to include the current employee/project presence model. Define office counts as distinct employee occupants across authorized project duties, and project counts within the requested authorized project. Preserve scope isolation and avoid counting an employee twice across replacement Temporary IDs. Cover entry, exit, multiple project duties, replacement IDs and overnight occupants.

## 3. [P2] Mandatory visitor mobile can be omitted at the backend

Sources: src/app/employee-portal.html:139; src/app/employee-portal.js:150-155; src/registration/RegistrationService.ts:144-153; database/migrations/061_email_request_workflow.sql:35-59.

The visitor form marks Mobile required and validates its country-aware number. RegistrationService treats phone as optional, validating its number only when supplied. SubmitRegistration requires a visitor name but not a phone, so omitting the property bypasses the UI requirement.

Reproduction: a restricted SQL submission of two EXTERNAL participants with personPhone=NULL returns SUBMITTED; querying only this audit's intake confirms two persisted NULL mobile values. The service boundary also permits missing/null phone and forwards NULL. An explicitly supplied malformed number is a different case and is already validated.

Impact: callers can create visitor requests without the mandatory contact information; browser-only enforcement does not provide a consistent registration contract. Email remains optional as intended.

Recommended fix: require a non-null valid phone for EXTERNAL participants at the service boundary and enforce the mandatory/null rule in SQL as well. Preserve employee identity/contact sourcing from the directory. Existing SQL fixture helpers intentionally use NULL visitor phones and will need realistic synthetic numbers when enforcing this rule.

## Evidence and limits

- tmp/audit-more-sql.ps1 and tmp/audit-more-sql.json: actual SQL movement, office/project summaries, reception row, grouped registration order and NULL-mobile acceptance. Restricted runtime role; no application authorization bypass was used to invoke the business procedures. Test administrator access only set up owned fixtures/capabilities, inspected their state, and cleaned them.
- tmp/audit-more-browser.mjs and tmp/audit-more-browser.json: actual current application renderer in Chromium, using only synthetic participant/result data and mocked API responses. No real identity or photo is present.
- tmp/audit-more-sql.log confirms successful exact owned-fixture/principal cleanup. No signing key, token, password or private production data is included in the report.
- This is focused exploratory verification, not a new full-suite run or a claim that every remaining edge case has been reviewed. Earlier audit 39 remains the evidence for the preceding fix batch. Previously unconfirmed intermittent SQL 547/admin-list failures remain unconfirmed; they are not counted as newly established bugs here.

Fix order: correct participant/result binding first; update the presence read models second; align mandatory visitor-phone validation third. A subsequent fix batch should add the corresponding regressions before reporting them resolved.
