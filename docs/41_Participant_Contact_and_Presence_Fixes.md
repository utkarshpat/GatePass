# Participant, contact and presence fixes

22 October 2026. Local follow-up resolving the three findings in [audit 40](40_Additional_Bug_Audit.md). No commit, push, production deployment, real email or physical printing is part of this batch. Existing local work was preserved.

## Result binding

The confirmation renderer joins each returned visit.clientPersonKey to the submitted person's key, normalizing UUID casing. SQL may continue returning its deterministic sorted order. Pass reference, displayed name and decision now belong to the same participant. Missing or duplicate result bindings produce a recovery message without displaying mislabelled cards or automatically resubmitting an already saved request.

Browser regressions exercise reversed person-key ordering, different participant decisions, uppercase UUIDs, unknown/duplicate bindings and both phone/laptop widths with the actual application renderer and synthetic responses.

## Presence read models

Forward migration 064 updates GetOperationalSummary and ListReceptionVisits to read Temporary ID occupancy from EmployeeProjectPresence. Earlier applied migrations are unchanged. The migration has been applied to the dedicated local GatePass_DesignTest database.

- digitalIdsInside is the distinct count of employee IDs currently inside at least one authorized project duty in the requested office/scope. Two simultaneous project entries or a replacement daily ID do not double count an employee in an office report.
- Project reports count only authorized occupants of the requested project. A project-scoped administrator cannot see another project's occupants through an office query.
- Occupancy is current recorded state, independent of the selected visit date. An unclosed overnight entry remains counted until departure/reconciliation. The visits totals retain their existing selected-day/request-scope meaning and are not multiplied by project-presence joins.
- Reception derives each Temporary ID's inside state from employee/project presence within that same office, including an original entry presented through a replacement ID. Its matching-list Inside counter deduplicates employee IDs. External and employee-project visit presence remains visit-specific.
- These are recorded project occupants, not proof of building occupancy: common-area verification still records no entry/exit.

The restricted SQL read-model and administration-read suites are included in the sequential CI SQL runner. They cover entry/exit visibility, two projects/one employee, scope denial, replacement IDs, unclosed overnight occupants and unchanged external visitor presence. Owned test fixtures and principals are cleaned. Older administration fixtures now seed Temporary ID presence through the actual project movement procedure, account for all eligible guard candidates and assert exact owned report deltas without assuming that the shared development office contains no other records.

## Required external mobile

RegistrationService rejects omitted/null/empty or invalid visitor phones before SQL. The database also rejects missing/null phones and malformed/padded international phone syntax atomically for the entire EXTERNAL group. Country-aware number validity remains enforced by the installed phone library at the service boundary. Email remains optional; employee identity/contact still comes from the directory.

Existing test helpers now supply valid synthetic international numbers. Explicit negative cases verify that an invalid second participant does not partially create the group. Existing legacy records are not assigned invented phone numbers or rewritten.

## Local change preservation review

Existing guard action-state, layout, route normalization, composition and stale-cookie login edits were retained. Review caught an empty CSRF token in staff-session replacement cleanup: the adapter now retains the original CSRF binding with its ephemeral issued-session provenance and uses that binding to revoke the previous session after fresh authentication. An unexpected revocation failure rolls back the newly created session without publishing replacement cookies. Four provider-specific regressions cover successful replacement and rollback for both SSO and local passwords. Current-session CSRF checks remain required.

## Verification results

- The preservation rerun exercised 388 unit tests: 387 passed; the production-startup rejection test hit its existing 30-second subprocess timeout under the full run. Its unchanged CI-safety suite subsequently passed in isolation. Coverage gates passed at 92.16% lines, 87.27% branches and 93.91% functions for measured TypeScript. All four new staff-session replacement tests passed. The earlier complete 384-test run also passed before those four tests were added. An initial rerun omitted the required installed Sharp path; it was corrected in the test environment without changing application code or weakening checks.
- Six actual SQL presence read-model groups passed with owned-fixture cleanup.
- 53 registration SQL cases passed, including missing/null/empty/padded/malformed phone rejection and the actual photo/encryption/service integration.
- 19 SQL guard-duty cases passed; current movement/reconciliation authorization is preserved.
- 38 administration-read SQL cases passed, including authorization wait/revocation checks, audit failure rollback and the actual typed service integration.
- 25 actual HTTP/SQL registration, reception and email cases passed with verified artifacts and cleanup; includes missing/invalid mobile rejection for an individual group member.
- Eight targeted browser cases passed for result bindings, reception counter deduplication and date rollover. All 26 cases passed in the full Chromium browser/accessibility run.
- Type-check, lint, all 64 sequential migration hashes and diff whitespace checks passed.

Local evidence is ignored under tmp/fix64-*.log. New browser tests use synthetic data; separate SQL and HTTP suites verify the actual restricted business procedures. This is evidence for these corrections, not a claim that every possible bug has been eliminated. The separate unconfirmed intermittent issues and organization/production/printer acceptance gates from audit 39 remain open.
