# 11 - Registration and Digital ID implementation

Version: 1.4 | Date: 20 October 2026 | Phase 02D

Digital ID is the product name. The service accepts `DIGITAL_ID` and `digitalIdReason`; the stable database discriminator `TEMP_ID`, TemporaryIdSlots table and existing notification template code remain internal implementation names. This naming change adds no new identity verification or access privileges.

## Implemented database boundary

Migrations 008/009 add RegistrationIntakeAccess and six procedures. Three public operations join the execute-only API role: CreateRegistrationIntake, RecordRegistrationPhoto and SubmitRegistration. The other three are private helpers. API has seven public grants, worker five and guard authentication six; runtime roles have no direct table SELECT/DML/ALTER and have no permanent members. The current database has 32 tables, 286 columns, 57 foreign keys and nine migration history rows.

An intake requires a random 256-bit capability and a separate 256-bit CSRF binding. Employee intakes additionally require their owning active SSO/MFA session, session CSRF, current authentication version and fresh active directory identity. A public intake can submit external visitors only. Knowing a reference, another intake ID or another employee identity grants no access. Every retry revalidates ownership and expiry before returning a receipt.

The provisional development policies are a 20-minute intake, at most ten people per external form and a 30-day future planning horizon. They are explicit database settings and require production policy review. SQL accepts only individual photo references already owned by the intake. Unknown/duplicate JSON fields, silent truncation, duplicate people/photos and invalid envelope mappings fail atomically.

The three paths are:

| Path | Identity and destination | Submission result |
|---|---|---|
| Digital ID | One SSO employee; official identity from fresh directory; location, photo, reason | Auto-approved location-only pass, OUTSIDE presence and a manager-notification outbox item; no approval decision |
| Employee project visit | One SSO employee; active project at the selected office; fresh assigned host membership | Individual PENDING visit/pass and host-approval outbox item |
| External visitor | Public intake; one or several people; common project/office/host/window/reason | Independent PENDING visit, pass, photo, presence and host notification for each person |

Each form commits all its new people or none. Grouping ends at submission. Approving, denying or moving one person never changes the others. No group operational card, shared decision or shared presence is introduced.

## Reuse, retry and time rules

Digital ID validity starts at the server time and ends at the next India local midnight. Callers cannot supply its host, project or validity. A shared employee/office/day lock and the existing daily slot prevent concurrent duplicate passes. A usable ID is reused even while its holder is inside. Cancelled/expired outside history can be replaced without deleting it; an unusable inside record requires authorized departure/reconciliation. A revoked outside ID requires explicit reissue rather than silent replacement.

Employee project windows are single India-local-day intervals. Overlapping active requests for the same employee/project-office are serialized. An equivalent request with the same host, reason, window and photo content reuses its individual record; changed overlapping requests fail. Adjacent half-open windows can coexist. Planned start can be earlier today, but historical entry is never created.

Idempotency binds the authenticated actor, or the public intake capability, to the operation key and canonical business payload. People are ordered by client person key. Fresh encryption envelopes, generated identifiers, derived employee display values and Digital ID server timestamps do not change that payload. A submitted intake stores one immutable payload digest and original receipt; equivalent retries with either the same or a new operation key return it. Changed content conflicts. Receipt statuses describe the submission outcome; current status must later come from a separately authorized live read.

Key-free SQL preflight resolves committed retries/reuse first. A new request returns NEEDS_CREDENTIALS with its transaction rolled back. The service obtains protected key material and prepares encrypted credentials outside database locks, then calls submission again. SQL rechecks authorization, freshness, time and concurrency conditions. A key-store outage cannot prevent a valid committed receipt/reuse from being returned.

Snapshot version 1 binds the submitted identity/contact, photo identity/content digest, destination, host, reason and validity. Migration 009 derives new hashes from the typed persisted row before dependent records exist, using ordered SQL JSON, explicit nulls, escaped slash, uppercase SQL UUID/hex representation, UTC timestamps with exactly three fractional digits and SHA-256 over UTF-16LE bytes. It does not rewrite existing snapshot hashes or decisions. The operation payload encoding from 008 remains unchanged. Integrity hashes are not encryption and are never authorization credentials.

## Internal backend

`src/registration/RegistrationService.ts` follows the applied SQL contracts. A trusted adapter supplies cookie/session context; request JSON cannot supply EmployeeId, UserId, encrypted envelopes or an authentication assertion. The service maps the product name to the internal SQL discriminator and returns only individual references, initial status and reuse information. SQL identifiers are normalized at the service boundary. Provider/SQL errors are reduced to generic error codes.

`SqlRegistrationRepository.ts` permits three named RPCs with explicit parameter types and exact parameter keys. It is a driver port, not an installed production SQL driver or a generic SQL executor.

`RegistrationPhoto.ts` uses an injected sharp decoder. It accepts JPEG/PNG/WebP signatures, fully decodes and re-encodes to JPEG, applies orientation, strips metadata, flattens transparency and limits output to 1280 pixels per side. Inputs are limited to 5 MB, 4096 pixels per side and 16 million pixels; multiple frames fail. At most two normalizations run concurrently, with no unbounded queue. Intake authorization precedes decoding/storage. Storage keys derive only from server-generated intake/photo UUIDs.

`QrCredentialEnvelope.ts` prepares 32-byte random static QR credentials, stores their SHA-256 verification digests, and protects the recoverable value using AES-256-GCM, a random 12-byte nonce and 16-byte tag. Purpose/version/visit/pass/key identity are authenticated as associated data. Keys are injected through QrKeySource and are not saved in source or SQL. Recovery verifies tag, identity and digest; only a future separately authorized renderer may use it. Registration returns no plaintext QR, ciphertext, hash, key or private storage path.

The integration test uses actual sharp and AES and a restricted SQL RPC bridge. Its photo store and keys exist in memory only. The test-only PowerShell/.NET bridge is not an application transport and adds no production SELECT permission.

## Evidence and reproduction

The registration harness contains 43 suite cases: 42 SQL lifecycle/security cases, including four observed two-connection races, plus one actual-backend case containing six nested Node/photo/AES/SQL scenarios. There are 17 additional Node unit/security cases. These are local implementation checks, not browser acceptance or a security certification.

Reports in database/validation are registration-report.json, registration-backend-integration.json, registration-unit-report.json and registration-unit-tests.txt. Source hashes and cleanup status are recorded. Synthetic workflow rows and temporary fixture users are removed; requested dummy employee/project/guard master data remains.

Apply only missing reviewed migrations, in order:

```powershell
./database/setup/Apply-LocalTransactionCore.ps1 -Migration 008 -TrustLocalServerCertificate
./database/setup/Apply-LocalTransactionCore.ps1 -Migration 009 -TrustLocalServerCertificate
./database/tests/Test-Registration.ps1 -TrustLocalServerCertificate -SharpPath '<existing approved sharp package directory>'
$env:GATEPASS_SHARP_PATH = '<existing approved sharp package directory>'
npm run test:registration
```

The helper refuses recorded migrations. Node tests use native TypeScript execution; no compiler/typecheck result is claimed. The already available bundled sharp package was used locally without installing software.

## Next application gate

Scoped operational reads, guard verification and isolated photo access subsequently passed in [Phase 02E](12_Scoped_Reads_and_Photo_Access.md). Reissue/print SQL and landscape card rendering subsequently passed in [Phase 02F](13_Reissue_Printing_and_Card_Rendering.md). Implement cancellation and remaining scoped administration before dependent HTTP/UI. Reception print and guard scan/entry/exit must all use current individual state. Raw registration receipts must not stand in for live authorization.

Before exposing public intake, add HTTPS transport, trusted SSO issuance, secure cookie/CSRF handling, rate limits/body limits, production SQL identities/driver, private filesystem storage and reference-aware staged-photo cleanup. Never delete a staged file blindly after a SQL timeout: its metadata may already have committed. Define TTL/quota and database-reference reconciliation before public rollout. Private storage must stay outside the source/OneDrive directory and web root, reject symlinks/path escapes and use restrictive OS permissions.

Real directory sync, SSO, mail dispatch, protected key storage/rotation/recovery, browser/mobile UX, reception printer acceptance and Linux deployment remain pending. No permanent guard passwords, production identities, external messages or real personal photos were created in this block.
