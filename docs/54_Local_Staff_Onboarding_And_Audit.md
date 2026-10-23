# Local guard/staff onboarding and audit

Implemented in the local application on 23 October 2026. Current presentation verification and release status are recorded in [the 23 October rehearsal](55_Presentation_Rehearsal_23_October_2026.md).

## Creating an account

- **Staff & access → Add staff** creates an external/local identity. A corporate email or employee number is not required. Login IDs may be a unique Staff ID, such as `sec-noi-001`, or a valid email address.
- **Guard assignments → Add guard** uses the same account flow, with an option to allocate the selected project immediately. Without a selected project, assign duty afterward.
- Available roles are supplied by the server. Account creation requires both role delegation and staff credential authority. Location administrators may create guards/reception accounts in their own office. India/platform administrators remain bounded by the existing delegation rules. Project administrators cannot create local accounts.
- Internal employees continue through directory/SSO discovery and role assignment. Project leads must be internal employees; the local account form cannot create a project lead.
- Name, login ID, selected permissions and a reason are required. Duplicate IDs and corporate identity collisions are rejected. Account creation, initial grant, setup ticket and optional project assignment commit atomically. Retrying the same request does not create duplicates.

## Password setup and reset

No shared/default password is assigned to a new account. The admin receives a one-use setup link, valid for 15 minutes, to share privately with the new staff member. This flow does not send email automatically.

The link opens the common sign-in page. The user chooses a password following the existing 15–128 character policy, then signs in with the new Staff ID. The token is in the URL fragment, removed from browser history immediately, held only in memory and never included in the HTTP URL or audit log. Closing the account dialog clears the displayed link. If the link is lost or expired, use **Find staff → Manage access → Reset password / setup** with a reason.

Reset revokes old password credentials, sessions and unused setup tickets before issuing a fresh one-use link. The reset endpoint independently checks the actor's authority over the target's current roles; hiding a UI control is not the security boundary.

## Audit trail

The admin audit log displays:

- The acting admin and server-recorded timestamp (displayed in IST).
- Target staff name and unique Staff ID.
- Role, scope/office and the administrator's reason.
- Separate `STAFF_ACCOUNT_CREATED`, `STAFF_SETUP_ISSUED`, `STAFF_SETUP_REISSUED` and initial `GUARD_ALLOCATED` events.

Actor and target identifiers are retained in SQL audit records. Only an explicit safe metadata projection is returned to the browser; passwords, raw setup tokens, hashes and arbitrary metadata are not returned. Identical successful retries produce no duplicate creation/setup events.

Audit reads retain existing authorization and pagination. Clear the project filter to see office-level account events. India/platform admins may select **All authorized scopes** to include global-scope account events; SQL still filters every event independently.

## Schema and checks

Migrations 081–083 add the procedures, scoped UI context, safe audit snapshots and a fix for SQL character-class handling of hyphenated Staff IDs. Applied migrations are preserved; follow-up changes use new migration versions. Runtime access is execute-only.

Tests cover actual SQL creation/setup/reset and idempotency, denied superior roles and foreign offices, reception/guard assignment separation, safe audit metadata, password setup and sign-in through the UI, password reset, and phone/laptop rendering. Disposable fixtures are removed by their unique run ID.

Organization deployment still requires the existing production identity, directory, database, HTTPS and secret-provider configuration. This adds no separate HR provisioning integration or automatic delivery of credentials.
