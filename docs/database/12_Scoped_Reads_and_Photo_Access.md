# 12 - Scoped visit reads, guard verification and photo access

Version: 1.5 | Date: 20 October 2026 | Phase 02E

Migration 010 was authored/applied before its dependent TypeScript services. It adds six SQL modules and no physical tables/columns. The database remains 32 tables, 286 columns and 57 foreign keys, with ten migration history rows. Current modules are 35 procedures and four private functions. This block does not implement printable cards, QR recovery permissions, credential reissue or public delivery links.

## Read boundary

Every operation requires an active user/session, current authorization version and CSRF binding. Callers cannot assert an actor ID. Each read context has its own qualifying rule; a role name alone does not grant access, and capabilities/scopes from unrelated grants cannot be combined.

| Context | Individual records visible |
|---|---|
| OWN | Requests whose EmployeeId belongs to the fresh active authenticated employee |
| HOST | Requests assigned to that exact employee, with fresh active directory/project membership |
| GUARD | VISITS_READ in the visit office and an active exact project allocation; Digital ID additionally needs TEMP_ID_MOVEMENT on the same qualifying grant |
| GUARD reconciliation | VISITS_READ plus RECONCILE_EXIT on one qualifying office grant permits existing INSIDE occupants even without project allocation |
| RECEPTION | VISITS_READ on a reception grant for the visit office |
| ADMIN | VISITS_READ on the matching eligible India/location/project/project-location admin grant; project scopes do not include location-only Digital ID |

All contexts exclude personally purged visits. Disabled users, expired/revoked sessions, expired/revoked grants and deallocated guards cannot continue through an earlier view. Employee/host freshness is checked from the trusted cache. Reading historic state does not reactivate an inactive destination or a denied/cancelled/expired credential.

The API role now has ten individually granted operations: its seven earlier grants plus ListVisits, GetVisitDetail and VerifyGuardPass. It still cannot read tables, private helpers, private photo paths or encrypted QR material. Worker/auth retain five/six grants respectively. A new unassigned gp_media_runtime role has exactly one public grant, ResolveVisitPhoto, with direct schema read/DML/ALTER denied. Actual service identities and separately configured SQL connections are a production composition gate; one broadly privileged connection would defeat this separation.

## Lists and details

ListVisits returns individual task rows only: reference/name, office/project, request/pass state, INSIDE/OUTSIDE and validity. It returns no contacts, reason, employee identifier, snapshot hash, intake/group record, private storage path, bearer value or QR encryption material. Empty results are a literal array; there is no global count or directory enumeration.

Pages default to 25 and are limited to 50. Ordering is SubmittedAtUtc descending then SQL UUID descending, with a typed two-part keyset cursor. Both cursor fields are required together. A cursor carries no authorization; every page reapplies the current scope. It is a live operational list, not an export or a frozen snapshot. New submissions/state changes can affect later pages; the UI must reset the cursor when filters change and refresh detail before an action.

DAY defaults to the current India-local date. Explicit dates are bounded to 30 days past / 90 days future. PENDING selects still-actionable pending deadlines, with an optional date. INSIDE does not filter by visit date and rejects an explicit date, so occupants from yesterday remain visible. Staff lists require a selected office. Exact project-office/reference filters further restrict authorized rows; guessing a filter does not expand scope. The pending queue is not an approval override: detail/decision recheck current state and assigned identity.

GetVisitDetail obtains shared authorization and visit locks, then reauthenticates after a lock wait. It returns coherent current individual state and task hints. HOST additionally receives the exact snapshot version/hash for the existing decision procedure. GUARD receives no reason/contact or approval binding. Other contexts receive the submitted reason but no contact details. No read context gains printing, approval or movement from visibility alone.

canEnter/canExit/canReconcileExit/canDecide are advisory hints derived from the implemented mutation rules. Pending/denied/cancelled, inactive destinations, unusable photos and stale/disabled employee state cannot suggest entry. An approved active pass may still permit normal EXIT after expiry. An inside occupant whose normal exit is unavailable can offer designated reconciliation. The actual decision/movement transaction always checks again; a prior read is never an authorization ticket.

## Guard verification

The internal service accepts exactly a canonical 43-character base64url encoding of a 32-byte opaque QR. It hashes the decoded bytes before SQL; raw QR values never enter SQL scan/audit rows. VerifyGuardPass validates the current guard, requested office, individual scope and presented credential under shared authorization/visit locks. It writes one redacted PassScanAttempts row and returns current individual state. It creates no AccessEvents and changes no VisitPresence.

Unknown and out-of-scope QR values return the same NOT_AVAILABLE response and an unlinked scan log; no unrelated visit/photo/reference is disclosed. Authorized pending/denied/expired/revoked/not-yet-valid states are explicit. A superseded/revoked QR cannot suggest normal movement on a replacement pass. The current individual INSIDE list/detail remains available for authorized departure handling.

CorrelationId is tracing only. Repeating it verifies current state and records a fresh attempt; cached VALID results are never replayed. SQL scan logging is atomic with the verification response. HTTP source/account throttling and request/body limits still must be added before exposing scans.

## Private photo response

ResolveVisitPhoto uses the same current per-visit authorization and shared locks, rejects purged/unavailable photos, and audits successful authorization. Only the isolated media role receives the internal storage key, content digest, MIME and bounds. API detail contains only photoAvailable. Knowing a PhotoAssetId, storage path, visit reference or earlier read result grants no photo access.

VisitPhotoService resolves authorization before storage access, accepts only canonical server-derived intake/photo paths and supported image extensions, enforces the recorded length up to 5 MB, copies the returned bytes, and verifies SHA-256. It then resolves authorization again after storage I/O and requires the same photo metadata. Permission loss, purge, replacement, corruption or a failed audit prevents delivery. There is no SQL transaction held over storage I/O.

The returned internal binary-response object supplies MIME, private/no-store and nosniff instructions without exposing its storage key/digest. The future HTTPS adapter must enforce these headers, prevent service-worker caching, avoid sensitive logs and return binary content rather than serialize the internal object as JSON. A revocation after the final authorization boundary cannot recall bytes already delivered.

PrivatePhotoReader is an injected bounded storage port. Integration exercises synthetic in-memory bytes with actual SQL authorization/digests. Production filesystem confinement, symlink/path-race protection, OS ACLs, upload/retention cleanup and deployment remain explicit gates; no production photo directory was provisioned here. Actual image decoding/re-encoding remains covered by the registration module's sharp tests.

## Evidence and reproduction

47 SQL-suite cases passed, including two observed independent-connection waits and one case containing four nested actual TypeScript-to-restricted-SQL scenarios. The nested cases exercise typed keyset RPCs, individual detail, opaque QR verification, isolated media authorization and denied scope. They are included in the 47 suite count. Seventeen additional read/photo unit cases passed. The full Node unit run passed 67 cases: directory 18, guard auth 15, registration 17 and reads 17. The existing 40-case transaction/movement SQL suite passed after 010.

Evidence is under database/validation: visit-reads-report.json, visit-reads-backend-integration.json, visit-reads-unit-report.json, visit-reads-unit-tests.txt and all-unit-test-report.json. Source hashes and cleanup are recorded. Fresh live catalog comparison passed 1,510 scoped checks; this checks structural dimensions stated in that report, not full permission/expression/index equivalence. No TypeScript compiler/typecheck, browser/HTTP, real SSO/mail, production SQL driver/filesystem or Linux deployment result is implied.

```powershell
./database/setup/Apply-LocalTransactionCore.ps1 -Migration 010 -TrustLocalServerCertificate
./database/tests/Test-VisitReads.ps1 -TrustLocalServerCertificate
npm run test:visit-reads
```

Apply only missing migrations in order; the runner refuses recorded versions. Synthetic visits, credentials, scans, photo audit events, sessions and temporary users are removed. The requested dummy master data remains. Runtime roles have no permanent members and no real visitors/messages were used.

## Next block

Credential reissue and audited reception print/render lifecycle subsequently passed in [Phase 02F](13_Reissue_Printing_and_Card_Rendering.md), including company-branded landscape cards. The contract below remains the required print boundary: Bind a render operation to the exact current individual credential and authorization, keep recovery material restricted, preserve pending/denied distinctions, revoke old credentials on explicit reissue, and recheck state before handing off printable content. Pending print must never suggest permission to enter. Follow with trusted HTTP/session/cookie adapters and the simple clean UI, then real SSO/directory/mail/storage and device/printer acceptance.
