# Staff identity and scoped administration

This is the current staff identity contract, superseding employee-only reception and guard-only password assumptions in earlier implementation snapshots. The application remains DB-first. Real corporate SSO integration is deferred; the explicit dummy SSO adapter is still used locally.

## Identity and authentication

`gp.Users` is the application identity. Corporate employees resolve through `gp.Employees` and the corporate/dummy SSO provider. External staff have `gp.StaffProfiles` with a unique staff code; they do not require an Employee ID, corporate mailbox or employee-directory record.

Local staff use independently generated passwords verified by the shared Argon2id engine. `gp.StaffLocalCredentials` is an updatable view over the existing credential store, preserving one credential version, lockout/challenge/setup history and account lock across legacy guard and generic staff contracts. There is no duplicated password store. Generic staff verification uses the separate execute-only `gp_staff_auth_runtime` role; API, legacy guard verifier and renderer identities cannot invoke its verification RPCs. The general API can invoke scoped credential management, but cannot read hashes or attest password verification.

`gp.ResolveStaffLoginIdentity` selects the authentication provider from SQL identity data. A username looking like an email does not make it an SSO account. Local staff sign-in does not call the employee-directory API. Internal admins use employee SSO; external admins can use local credentials with the same administrative role/scope. Employee identities cannot acquire local staff password sessions. Internal project heads use employee SSO.

All staff enter through `/`. Public QR registration remains at `/office/<office-code>`. Sessions use HttpOnly cookies, CSRF binding and current SQL authorization/version checks. Account disable/reset revokes sessions. Disabling a staff profile also blocks existing authorized requests. The common login clears obsolete reception cookies. Protected pages, API data, photos and passes remain excluded from PWA caches.

## Role and delegation boundaries

| Actor with explicit `ROLE_GRANTS_MANAGE` | Authority |
|---|---|
| Platform Admin, `PLATFORM` | Assign/revoke any supported role, including India/platform administration; cannot change their own role |
| India Admin, `INDIA` | Assign location admins, project heads, guards and reception within the current India application; cannot create a Platform or peer India Admin |
| Location Admin, `LOCATION` | Assign guard/reception at their office and project heads only at a project-location pair in that office |
| Project Admin, `PROJECT` | Assign project co-leads within that project, including its project-location subsets |
| Project Admin, `PROJECT_LOCATION` | Assign co-leads only at that exact project-location pair |

A role label grants no implicit capability. SQL checks role, capability, scope, current state and session again on every mutation and retry. Role grant/revoke keeps explicit reasons, idempotency keys, historical grants and audit records. Project-location audit scope comes from the trusted pair. Location admins cannot grant project-wide authority merely because that project also operates in their office. New project-head targets must be active internal employees.

Guard and Reception are separate duties. A person can hold both roles; only their Guard grant/allocations authorize movements, and only their Reception grant/capabilities authorize print operations. Guard/Admin combinations remain rejected by the role-management API. Read selectors follow the corresponding scope and disclose bounded fields, not contact data, identity issuers, password hashes or audit metadata.

Local credential administration requires the separate `STAFF_CREDENTIALS_MANAGE` capability. Platform administrators can manage eligible local accounts. India administrators cannot reset Platform/peer India accounts. Location administrators can manage local guard/reception accounts only if every current duty falls inside their office authority. Project heads cannot reset local staff passwords, and nobody can use the administrative reset path on their own account. SSO credentials are never reset by this application.

## Current local fixtures

| Login | Provider | Scope |
|---|---|---|
| `platformadmin1@example.com` | Local | Platform |
| `admin1@example.com` | Local | India |
| `admin2@example.com` | Local | Noida |
| `admin3@example.com` | Local | Bengaluru |
| `admin4@example.com` | Local | Chennai |
| `admin5@example.com` | Local | Pune |
| `reception1@example.com` – `reception4@example.com` | Local | Noida, Bengaluru, Chennai, Pune respectively |
| `gaurd1@example.com` – `gaurd12@example.com` | Local | Existing individual guard allocations |
| `employee19@example.com` | Dummy SSO | Project 1 |
| `employee24@example.com` | Dummy SSO | Project 2 |
| `employee20@example.com` | Dummy SSO | Project 3 |
| `employee21@example.com` | Dummy SSO | Project 4 |
| `employee22@example.com` | Dummy SSO | Project 5 |
| `employee23@example.com` | Dummy SSO | Project 6 |

Dummy employee SSO password remains `Sopra@123`. Unique local passwords are recorded only under the current user's protected `%USERPROFILE%\.gatepass\development-logins\staff.json` and `guards.json`, outside the repository/OneDrive. The inventory can contain retired local project-admin fixtures; `admin6`–`admin11` have been disabled, their grants/sessions revoked, and their duties moved to existing employee SSO identities. The former EMP021–EMP024 reception workaround is revoked.

Explicit enrollment: `tools/seed-development-staff-logins.ts`, with development/mock flags, after migrations 029–034 and the directory/guard fixture setup. Regular startup does not provision credentials. Enrollment preserves existing passwords, disabled accounts and revoked grants/capabilities. The one-time explicitly approved delegation capability expansion is marked in the synthetic database; reruns do not restore later removals. The script is not a production account-creation route.

## Delivery and checks

Reception and the admin Projects workspace are operational. Common staff login routes authorised admins and employee project leads to `/admin`. The Projects view lists only authorised offices/projects, shows current project-wide and office-specific leads, searches existing internal employee identities and assigns/removes leads through audited, idempotent SQL procedures. Location admins cannot appoint project-wide leads or remove a wider-scope lead; server and database both enforce the boundary. The guard workspace is available at `/guard`; broader staff/account administration screens remain subsequent UI work. An account whose dashboard is not ready receives an unavailable-workspace state.

Evidence includes the generic staff SQL suite (29 cases), staff administration suite (37 cases), actual HTTP logins for Platform/India/location/reception/guard identities and an employee SSO project lead, plus 16 public/employee/reception HTTP+SQL cases including issued QR decoding and audited pending-card print/reprint. Physical printer and real corporate SSO acceptance remain deferred as agreed.

Admin workspace migration: `035_admin_project_lead_workspace.sql`. New read procedures run only as `gp_api_runtime`; authentication roles receive no project administration access. Candidate searches return at most 20 employees; project and grant pages return at most 25 rows with scope-filtered cursors. Assignment requires fresh employee/project directory records. UI capability template: visit reads, guard management, report reads/exports, audit reads, and same-scope project-lead delegation.

Actual SQL/HTTP workspace verification covered Noida-only office lists, cross-office and reception denial, project-wide assignment denial for Noida admin, visible wider-scope leads without removal authority, scoped employee search, successful lead grant/revoke and idempotent retries. The owned test grant was revoked. Browser visual acceptance remains pending because the in-app browser returned a URL-policy/network-suspension block.

## Current manual testing password

At the user's explicit request, all 22 active local synthetic guard/reception/admin credentials were reset to `Sopra@123` for local testing. Employee dummy SSO already uses that password. Each local account still stores an independently salted Argon2id hash. Private credential inventories were synchronised; old sessions were revoked. Retired and disabled accounts were not enabled. The explicit `tools/set-development-test-passwords.ts` helper is restricted to the synthetic local database and is never called at startup. The ordinary production password creation/change policy is unchanged. This supersedes earlier unique-random-password descriptions for the current local fixture state.
