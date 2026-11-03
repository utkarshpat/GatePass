> Documentation status: historical implementation/design/evidence record, indexed 3 November 2026. Read the [current handbook](system/README.md) and [Visit owner/Host glossary](109_Visit_Owner_and_Host_Terminology_03_November_2026.md) for current behavior. Counts, setup examples and screenshots below describe their dated stage, not a fresh certification.

# Protected request admission — 29 October 2026

## Reproduced P2

The HTTPS API previously classified capacity by URL and read the JSON body before checking session cookies. Unauthenticated clients could hold unfinished bodies on protected paths, occupy the total handler ceiling and cause an otherwise valid authenticated request to receive `429`.

The new actual HTTPS regression reproduces `429` instead of the expected `200` on the previous implementation. After the fix, missing credentials and forged sessions receive `401`, invalid CSRF receives `403`, and the valid request receives `200` while the rejected uploads remain unfinished.

## Fix

- Protected actions validate cookie/token shape and matching CSRF headers before body parsing or protected admission. Token shape alone never grants protected capacity.
- The trusted auth service validates the current session using its existing SQL-backed `touch` operation before admitting body/action work. The explicit touch endpoint reuses that result; logout still performs revocation. Each action's SQL role/scope checks remain required.
- Pending session verification has a separate ceiling equal to `maxPublicInFlight`, and counts toward `maxInFlight`. It does not use the public-body ceiling, so a held public body cannot itself monopolize session verification. Default pending verification is at most eight; all counted work together remains at most 32.
- Verification slots release on completion/failure, exactly once. Disconnecting a caller does not release a still-running auth provider call. Forged credentials cannot proceed to a body/action slot.
- Additional registration/public route providers use public capacity even if their path does not match a known public prefix. Their own capability/SSO checks remain in place.
- Rejected incomplete uploads disable keep-alive so the connection closes after the rejection response rather than waiting for an unauthenticated body.
- Authentication errors now take precedence over body-format errors on protected endpoints. Authenticated requests retain the existing JSON encoding, object and size checks. Login/setup retain their public admission/body flow.

## Verification

| Check | Result |
|---|---|
| Focused API/admission tests, including actual HTTPS | 32 passed |
| Full CI unit/contract suite | 658 total: 657 passed, one platform skip, zero failures |
| Included backend coverage | 97.46% lines, 90.27% branches, 94.12% functions |
| Typecheck / ESLint | Passed |
| Migration integrity | 121 hashes passed; no migration changed |

The regression coverage includes unfinished bodies without credentials, canonical forged sessions, CSRF rejection, denied/revoked-session responses, verifier exceptions, verification overload, caller disconnect, idempotent release, later recovery and touch/logout behavior. Auth provider responses are controlled test fixtures; no new corporate identity or SQL deployment acceptance is claimed.

The first plain `npm test` invocation lacked the required Sharp test package path and failed its image checks. The complete passing CI run above supplied the existing local Sharp package through the test process environment. Evidence: ignored `tmp/protected-capacity-ci.log`; the focused HTTPS regression also failed before the implementation change and passed afterward.

This is a process-local application admission fix, not a guarantee of availability during provider failure, authenticated abuse or network/connection exhaustion. A saturated authentication provider can still produce bounded `429` responses. Listener timeouts, edge controls, staging load and corporate identity/deployment acceptance remain necessary. The development-only loopback adapter has no new production session verifier and is not certified by this HTTPS fix. Full browser/SQL integration was not rerun for this transport-only change; the original database, private storage and Outlook connection were not used.
