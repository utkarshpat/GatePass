# 17 - Scoped guard allocation and staff role administration

Version: 1.10 | Date: 20 October 2026 | Phase 02J

Physical printer testing remains deferred to final acceptance. This block implements database mutations and internal services; public HTTP routes and admin UI are subsequent work.

## Database contracts

Migrations 017/018 add AllocateGuard, GrantStaffRole and RevokeStaffRole, each individually granted to the API runtime. The existing DeallocateGuard is exposed through the same strict internal service. All operations require live session/CSRF, a client retry key, a bounded reason and current authorization. Private role-administrator and capability-matrix helpers receive no direct runtime permissions.

Every authorization mutation takes the Exclusive authorization gate before the actor/payload-bound operation lock. This serializes allocation, role changes and concurrent operational actions. Scope/authority are checked again before returning a cached receipt. A changed payload with the same key conflicts. Success audit failure rolls back the mutation, explicit capabilities, authorization generation and retry receipt together.

## Guard allocation

An administrator needs GUARDS_MANAGE on a complete qualifying grant matching the trusted target pair. Location, project, project/location and India admin scopes remain distinct. Role name or capability on another scope does not suffice. Target project, pair and office must be active, with current project directory data. The target user must be active.

One unrevoked GUARD location grant must cover the full requested assignment interval and explicitly contain both PROJECT_MOVEMENT and VISITS_READ. Multiple grants cannot be combined into interval coverage. Overlapping non-guard staff roles make the guard ineligible. Omitted start means server time now; an explicit start must be in the future. End is exclusive and may be unbounded only when the covering guard grant permits it.

Duplicate overlapping intervals are rejected for the same guard and exact project/location pair. Adjacent intervals are allowed. Different projects may overlap for one guard, and multiple guards may cover the same project. Existing deallocated history is retained. Allocation/deallocation increments the target user's AuthorizationVersion, so old sessions must authenticate again.

## Roles and capabilities

Only a current INDIA_ADMIN grant with explicit ROLE_GRANTS_MANAGE can grant or revoke roles. No self-grant or self-revocation is allowed. User, role, scope and interval are explicit. Scope IDs must match the role: GUARD/RECEPTION/LOCATION_ADMIN use one location; PROJECT_ADMIN uses project or exact project/location; INDIA_ADMIN uses India scope without resource IDs. New targets and resources must be active.

Capabilities are a nonempty explicit unique set, with a maximum of seven. Canonical sorting binds retries independently of input order. SQL enforces the eligible matrix: guards get only read/movement/reconciliation capabilities, reception gets only read/print/reissue, and administrators get the documented scoped management/report/audit set. GUARD_CREDENTIALS_MANAGE is eligible only for India/location administrators; ROLE_GRANTS_MANAGE only for India administrators. A role name grants no implicit capability.

Overlapping duplicate grants for the same user, role and exact scope are rejected. Capabilities are immutable through this boundary: revoke and create a new grant to change the set. Overlapping GUARD and non-guard roles are rejected, matching the isolated guard-password authentication model. Revocation retains the grant/capability history and increments the target's AuthorizationVersion. Existing assignments and INSIDE occupants are retained; current authorization and privileged exit reconciliation remain authoritative.

Migration 018 corrects project/location scoped grant and revoke audit records by deriving LocationId from the trusted pair. A positive scope test caught the missing audit location; its transaction rolled back. Applied migration 017 was preserved, and the correction was applied forward.

## Internal service

StaffAdministrationService accepts only action-specific fields and sends exact typed RPC parameters. Actor identity and privileges are never caller input. Tokens are hashed, dates validated, reasons bounded, bigint IDs represented as decimal strings and receipts projected to reference fields. Backend errors are redacted. Receipts describe the committed historical action; applications must refresh current grants/assignments before showing effective authority. No SSO, guard password or real identity is provisioned here.

## Evidence and current state

- 37 restricted SQL cases, including four observed two-connection races and seven nested actual typed-service/SQL scenarios.
- 13 administration unit cases; 119 tests in the full Node run. Native TypeScript execution is not compiler/typecheck validation.
- Core, guard context, guard authentication and scoped-read regression reports have separate evidence.
- Migrations 001-018 locally applied: 33 tables, 297 columns, 58 FKs, 52 procedures and five private functions. Individual public EXECUTE grants: API 18, worker 5, auth 6, media 1, renderer 4. No permanent runtime members.

All test users, sessions, assignments, grants, operations and non-seed audit rows are removed. The requested synthetic directory master records remain. No real messages, accounts or production deployment are created.

Next: scoped administration read/selectors and report/audit contracts, then connect the tested operations to HTTP and a clear reception/guard/employee/admin UI. Real SSO/directory/mail, private storage/key management and Linux deployment remain separate gates. Printer/device acceptance stays at the end.


Migrations 019/020 now implement scoped selectors, role history, operational summary and redacted audit pages. The API has 24 individually granted operations. See [document 18](18_Administration_Reads_Reports_and_Audit.md). Printer testing remains final acceptance.
