# Development login identities

This is the migration-028 snapshot. Current admin/reception identity and delegation rules are in [Staff identity and delegation](database/29_Staff_Identity_and_Delegation.md).

Employee fixtures use `employee1@example.com` through `employee24@example.com`. The dummy employee sign-in password remains `Sopra@123`; real corporate identity integration remains deferred. Manager/host emails come from the same directory records. Reception currently uses EMP021–EMP024 with their existing office grants; no new admin or reception identity is implied by the naming change.

Guard fixtures use the requested spelling `gaurd1@example.com` through `gaurd12@example.com`, mapped to GRD001–GRD012. They are password accounts, not SSO employees. The local staff adapter routes these explicitly synthetic guard identifiers to the actual Argon2id verifier; all grants and scopes are still obtained from SQL. Guard operational dashboards remain pending, so authentication currently leads to the truthful unavailable-workspace state.

Migration 028 adds `@` to guard login identifiers in the credential constraint and the existing management/login procedures. It preserves challenge generation, eligibility, lockouts, session and scope checks. Applied migrations 006/007 are unchanged. Normalization still rejects whitespace, Unicode lookalikes, oversized IDs and malformed email-shaped identifiers.

Explicit local enrollment is `node tools/seed-development-guard-logins.ts`, with `NODE_ENV=development` and `GATEPASS_DIRECTORY_MODE=mock`. The helper requires the fixed local synthetic database marker, existing eligible guard identities and their original grants. It inserts only missing credentials, stores independently generated Argon2id hashes in SQL and records one audit event per new account. It never grants access, restores allocations, overwrites credentials or re-enables disabled accounts. It is not part of regular startup or the production API allowlist.

Unique random test passwords and hashes are recorded in the current user's OS-protected `%USERPROFILE%\.gatepass\development-logins\guards.json`, outside the repository/OneDrive. They are not printed by the enrollment script or exposed via HTTP. This is a local test credential inventory, not production credential management. Reruns reuse that inventory and reject mismatched existing SQL credentials. Production accounts must use the reviewed administrator-assisted setup/reset flow.

Validation includes 55 focused directory/SSO/guard/staff tests, atomic migration parsing/application and live HTTP/SQL login/logout for guards 1, 2 and 12, employee 1 and reception employee 21; an incorrect guard password is denied. Admin identity scope and whether dedicated reception fixture identities should be introduced require the user's selected mapping.
