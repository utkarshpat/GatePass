> Documentation status: historical implementation/design/evidence record, indexed 3 November 2026. Read the [current handbook](system/README.md) and [Visit owner/Host glossary](109_Visit_Owner_and_Host_Terminology_03_November_2026.md) for current behavior. Counts, setup examples and screenshots below describe their dated stage, not a fresh certification.

# Retained demo hosts — 28 October 2026

The user requested adding example hosts and testing them. Three approvals were added through the running application's authenticated Noida administrator API, not direct table writes, and remain configured for manual testing.

| Office | Account's existing demo name | Approved employee | Email |
|---|---|---|---|
| Noida | Project 1 | Employee 1 / EMP001 | employee1@example.com |
| Noida | Project 2 | Employee 2 / EMP002 | employee2@example.com |
| Noida | Project 3 | Employee 4 / EMP004 | employee4@example.com |

The mock directory still supplies the record names “Project 1/2/3”; the application labels their business meaning as Account. No corporate host permissions or NHS-copy settings were changed.

## Live acceptance results

All six browser/API checks passed against the current server at `http://localhost:8443/`:

1. The three employees were approved only for their exact Noida account-office. Replaying each add with the same key returned the original operation without duplicate changes.
2. Public visitor search returned the three approved hosts, excluded assigned-but-unapproved Employee 18, and returned no account catalogue or account names.
3. Employee 14's additional-account request showed Employee 2 for the second account; unapproved Employee 18 and the first account's Employee 1 were excluded.
4. Reception manual registration showed approved Employee 1 and excluded unapproved Employee 18.
5. Removing Employee 4 immediately removed them from public host search; restoring approval immediately made them selectable again. Employee 4 remains approved afterward.
6. The real admin Manage hosts dialog displayed the retained Employee 1 approval and email.

The audit query matched exactly five changes: four adds, including restoration, and one removal. All five contained actor, target name/employee ID, exact office/account, timestamp and reason. The idempotent add replays created no extra audit changes.

No visit/pass was issued and no real email was sent. Browser test sessions were signed out and closed. Host approvals and their audit history are deliberately retained. These local checks do not establish corporate identity or production acceptance.
