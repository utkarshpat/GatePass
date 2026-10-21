# 18 - Administration selectors, reports and scoped audit

Version: 1.11 | Date: 20 October 2026 | Phase 02K

Migrations 019/020 implement six execute-only API read contracts. Database authorization determines each row's scope; caller-supplied filters only narrow it. Physical printer acceptance remains at the final stage.

## Administration selectors

- ListAdminProjectLocations returns project/pair IDs, names, active state and canAllocate for one office. GUARDS_MANAGE is evaluated against each pair. A global role administrator may select role scope without inheriting allocation permission. Stale/inactive project data remains visible with allocation disabled.
- ListAdminGuards returns same-office guard candidates for the complete proposed interval. A single guard grant must supply read/movement and cover the whole interval; overlapping non-guard staff authority makes the candidate ineligible. Existing same-pair overlap is shown explicitly and disables allocation. Concurrent assignments at other projects do not block it. Prefix search treats percent, underscore and brackets literally.
- SearchStaffSubjects requires global role-administration authority and a minimum two-character literal name prefix. Only user ID, display name and active state are returned, including inactive accounts for authorized history/revocation tasks.
- ListStaffRoles requires the same global authority and an explicit target user. CURRENT omits revoked/future/expired grants; ALL preserves history. The response includes canonical scope, validity and explicit capabilities. It does not infer capabilities from a role name or return authentication details.

Selectors use keyset pages of at most 50 rows. hasMore is calculated after scope filtering. There is no global count. Bigint identifiers are decimal strings. Empty lists remain arrays. Sessions and effective row scopes are checked again before release; live mutation contracts still reauthorize independently.

## Operational summary

GetOperationalSummary requires explicit REPORTS_READ for the requested office/project scope. It returns selected-day status counts and separately recorded current presence. Status counts are consistent with the collected authorized rows. Presence includes historical expired/revoked/cancelled INSIDE records independently of the selected report day and separates project visits from location-only Digital IDs.

These are recorded movement counts, not physical building/lobby headcount. No names, purpose, host contact, photos, credentials or raw visit list are returned. Counts are decimal strings, with a selected day and server check timestamp. The report is advisory; it is not a serializable census across unrelated concurrent visits. REPORTS_EXPORT alone does not grant REPORTS_READ, and no export endpoint is added here.

## Scoped audit

ListScopedAuditEvents requires explicit AUDIT_READ and a bounded interval of at most 31 days, with a descending ID cursor and optional narrower office/pair filters. Pair filters require the matching location. The response contains audit ID, action, target type, result, scope, actor display name and event time.

Raw MetadataJson, TargetReference, actor authentication IDs, tokens, contacts, free-text reasons and payloads are excluded. Scope is never inferred from arbitrary references, free-text metadata or a shared actor. A typed ROLE_GRANT target may resolve a project-wide grant event to its retained ProjectId. Only an administrator with the whole project's audit scope or India audit authority can see it. Pair-only and location-only audit authority cannot inherit that wider scope. System/unscoped events require India AUDIT_READ.

Successful read queries append a bounded audit event in the same transaction. Success-audit failure prevents release. Operational reads hold the Shared authorization gate; permission mutations take Exclusive. Time-based session/grant expiry is rechecked before release. All protected API/HTTP responses must be no-store when the transport layer is implemented.

## Internal service and boundaries

AdministrationReadService and its exact typed SQL port expose only these six procedures. Inputs reject actor, role, capability or scope-bypass overrides. Output projection strips extra fields and validates array bounds, duplicate IDs, cursor consistency, typed scopes, status totals, UTC windows and eligibility flags. Errors are bounded/redacted. There are no public HTTP routes, production SQL driver or completed screens in this block.

Migration 020 preserves applied 019 and adds forward checks for an allocation interval that elapses during a read, requested report scope after waiting, and overflow-safe audit-window validation. The test-only PowerShell RPC bridge preserves already-parsed DateTime values to retain UTC kind and milliseconds; production date binding remains part of the driver gate.

## Evidence and current inventory

- 38 restricted SQL cases, including two observed authorization waits, one observed guard-row wait and seven nested actual internal service/SQL scenarios.
- 16 administration-read unit cases; 135 tests in the full Node run. Native TypeScript execution is not compiler/typecheck validation.
- Existing staff-mutation and visit-read regression reports are separate evidence.
- Migrations 001-020 applied locally: 33 tables, 297 columns, 58 FKs, 59 procedures and eight private functions. Individual public EXECUTE grants: API 24, worker 5, guard auth 6, media 1, renderer 4. Runtime roles have no permanent members.

Disposable fixture users, grants, sessions, operations and audit rows are removed; the requested dummy directory master data stays. No real people/messages, production deployment or physical printer acceptance is claimed.

Next: wire these tested database/service contracts into a production SQL adapter and HTTP authentication/authorization boundary, then the simple employee, reception, guard and administration screens. Real SSO/directory/mail and private storage/key management remain integration work. Printer/device testing stays at final acceptance.
