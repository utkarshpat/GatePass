# 02. Identity, roles and access

> Current local changes and presentation evidence (23 October 2026): [retained browser rehearsal](../55_Presentation_Rehearsal_23_October_2026.md). Source migrations are 001–085. The original 22 October export and snapshot remain historical.

Local staff onboarding requires both permitted role delegation and staff credential-management authority. Project administrators cannot create local password accounts; internal project leads remain directory employees. New local accounts use a one-use, 15-minute setup link and the existing 15–128 character password policy. Reset revokes prior credentials/sessions/setup links. Admin audit metadata displays safe actor/target/role/scope/reason fields and excludes password/setup-token material. See [the onboarding contract](../54_Local_Staff_Onboarding_And_Audit.md).

## Identity model
`gp.Users` is the application identity. Internal employees resolve through `gp.Employees` and trusted SSO provenance. External security/reception/admin staff use `gp.StaffProfiles` and individual local credentials without requiring employee numbers/company mailboxes. SQL resolves authentication provider; an email-shaped username is not proof of SSO.

Internal project leads use employee SSO. Internal admins can use SSO; eligible external admins use local credentials with their scoped roles. Employee identities cannot acquire staff-password sessions to bypass corporate authentication. Directory data is not authentication.

Staff enter at `/`; authorized login resolves their workspace. Public intake opens through office QR. HttpOnly sessions, CSRF and current SQL checks remain necessary even if self-service omits Sign out. A simpler UI does not imply stateless trust.

## Delegation matrix
| Actor | Authority with explicit capability | Restriction |
|---|---|---|
| Platform Admin / PLATFORM | Supported roles across application, including India/platform administration | Cannot change own role through delegation |
| India Admin / INDIA | Location admins, project heads, guard/reception within India | Cannot create Platform or peer India Admin |
| Location Admin / LOCATION | Guard/reception locally; heads at local project-location | Cannot grant project-wide authority from a local grant |
| Project Admin / PROJECT | Internal co-leads in that project/subsets | No broader office authority |
| Project Admin / PROJECT_LOCATION | Internal co-leads at that exact pair | No other project/location |
| Reception | Scoped search, card preview and print handoff | Printing is not host approval or project entry |
| Guard | Verify/perform allowed movements for assigned duties | No administrative authority from role label |
| Host | Decide own assigned individual requests | Current exact project-office eligibility/freshness required |
| Employee | Eligible own temporary ID and hosted access request | Not all-office membership |

SQL checks active identity/session, role, capability, scope, directory freshness, allocation, pass state and operation. UI dropdown values never authorize. Guard/Reception are separate duties and can coexist with independent grants. Guard/Admin combinations are rejected by role management. Lead targets must be active internal employees. Grant/revoke retains reasons, history and stable retry keys; replay rechecks current authority.

## Credentials and sessions
Argon2id verification uses independently salted hashes. Generic staff credentials share the existing credential/version/lockout store rather than duplicating password data. A dedicated auth SQL role verifies credentials. Disable/reset invalidates applicable sessions. `STAFF_CREDENTIALS_MANAGE` is separate; project leads cannot reset staff passwords, SSO passwords are not changed by GatePass, and administrative self-reset is denied.

## Development accounts only
| Login pattern | Local purpose |
|---|---|
| employee1@example.com to employee24@example.com | Synthetic employee/dummy SSO |
| gaurd1@example.com to gaurd12@example.com | Individual security; requested fixture spelling |
| reception1@example.com to reception4@example.com | Noida, Bengaluru, Chennai, Pune respectively |
| platformadmin1@example.com | Platform fixture |
| admin1@example.com | India fixture |
| admin2@example.com to admin5@example.com | Noida, Bengaluru, Chennai, Pune fixtures |

The user-approved current manual-test password is `Sopra@123` for active synthetic accounts. It is not production policy. Retired admin6-admin11 are not re-enabled; project leads use employee identities. Protected inventories remain under the user's `.gatepass/development-logins`, outside the repository. Never copy inventories, hashes, tokens or secrets into documentation.

Sources: docs/database/29_Staff_Identity_and_Delegation.md; migrations 027-035; src/security; src/administration.
