# Code architecture and maintenance rules

> Maintained guide reviewed 3 November 2026. See the [current system handbook](system/README.md) for completion and acceptance status.

GatePass uses composition, small interfaces and pure policies. Classes own stateful services/adapters; React function components and pure validation functions remain functions. More inheritance or a class around every object is not a quality target.

## Dependency direction

| Area | Responsibility and allowed direction |
|---|---|
| `src/contracts` | Application-owned SQL port/types. No import from implementation areas. |
| `src/shared` | Browser/server-safe pure utilities. No backend, Node or feature imports. |
| `src/frontend` | React presentation and browser state/effects. Imports frontend/shared modules, not backend services or driver code. |
| Business areas | Registration, visits, reception, administration, security, planning, operations and email use cases. Inject repositories/ports; do not import HTTP adapters, development runners or UI. |
| `src/transport` | HTTP protocol translation, explicit composition, least-privilege SQL driver and runtime admission. |
| Storage / integrations | Implement the consuming use case's small contract. Protected storage and external providers are not constructed by pure policies. |
| `src/development` / tools | Explicit local/test setup and composition. Production source must not import development modules. |

SQL authorization, state transitions, idempotency, audit and outbox changes remain in reviewed forward migrations and transactions. Refactoring TypeScript does not move authoritative permissions into the browser or introduce a parallel source of truth. Applied migration files remain immutable.

`npm run check:architecture` examines source imports/re-exports, literal dynamic imports and type imports. It enforces these source boundaries, isolates `mssql` in its adapter, and rejects runtime dependency cycles. Type-only cycles are allowed. This is a static source check; dynamic configured adapters still require review and runtime acceptance.

## Applying SOLID

- **Single responsibility:** separate request validation, response projection, orchestration, rendering and provider dispatch. A page composes sections/dialogs; its model owns lifecycle and operations. Extract by business responsibility, not arbitrary line counts.
- **Open/closed:** add an adapter through an existing port or a scoped policy/rule where that variation exists. Keep security-sensitive RPC names and grants explicitly allowlisted. A new command still requires deliberate validation, authorization and tests; do not replace these boundaries with unrestricted plugins.
- **Liskov substitution:** adapters must preserve the interface's result/error/side-effect contract. Use the compiler's explicit override checks where inheritance is appropriate. Prefer composition over base classes created only to share a few lines.
- **Interface segregation:** use the operations a consumer needs: SQL RPC, mail rendering, transport, directory, notification batch, QR encoder and private photo reader. Do not require a full worker, HTTP handler, database pool or broad provider SDK in a business service.
- **Dependency inversion:** application code owns the required contract; composition supplies the real SQL/Graph/storage implementation. A mail adapter must not import a notification worker to obtain its interface or shared error type.

## Error and identity contracts

HTTP status selection belongs in HTTP adapters. Business services return validated DTOs or controlled domain error codes. Never expose raw SQL, provider messages, credentials or private paths to the caller. Preserve current status semantics when replacing a legacy error type.

Canonical session token validation/hashing belongs in `security/SessionProof.ts`. It hashes decoded 32-byte tokens, rejects alternate encodings and discards decoded buffers. These hashes are proof material only: SQL must still validate current session, CSRF, expiry, credential state and role/scope. Do not treat token shape or a TypeScript interface as authorization.

Validate untrusted input/output from `unknown`, with explicit allowed fields and bounded values. Do not replace runtime checks with type assertions. Refactored contracts/planning/Admin view modules reject explicit `any` and enforce unused/type-only imports in ESLint; older modules still require careful incremental typing rather than pretending the entire repository has no dynamic types.

## UI and effects

New UI remains React/TypeScript. Keep presentation separate from requests, scanning, printing, resource ownership and stale-response protection. Preserve element IDs, labels, scope visibility, focus, dialog behavior and small-screen layouts when extracting a component. Share pure display formatting between browser, mail and print so expiry labels remain consistent.

## Review and validation

Before a change is ready:

```powershell
npm run typecheck
npm run lint
npm run check:architecture
npm run check:migrations
npm run build:frontend
npm run test:ci
```

Run relevant real-SQL, browser/accessibility and concurrency tests when their behavior changes. Validate failure, denial, retry and stale-scope cases, not just success. Do not add tests that only repeat an implementation or require live mail to test rendering. Mock external dispatch in automated checks; real messages require an explicit recipient/action request.

Record the actual tests and limitations. Passing architecture/lint/tests is evidence of the checked properties, not proof of zero bugs, complete production integration or independent pentest acceptance.
