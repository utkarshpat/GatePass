# Local employee Digital ID flow

The explicit dummy runner now connects employee sign-in, private photo storage, protected QR keys and actual SQL registration. Start with `npm.cmd run dev:sso`, open `http://localhost:8443`, select an employee and choose **Request Digital ID**. Choose an office, a reason and a face photo; additional details are required for Other. Existing employee identity, manager and assigned projects stay read-only.

The server revalidates the dummy SSO session on every employee request. The browser cannot submit an employee ID, choose a read scope or select a manager recipient. The only registration type enabled on this local employee surface is DIGITAL_ID. Guard/password, reception and project request screens are separate subsequent work.

Photos are decoded, oriented, resized and re-encoded without metadata. Files remain outside the source/OneDrive tree under `%USERPROFILE%/.gatepass/private-v1/photos`; SQL stores the hash and metadata. No private photo directory is published over HTTP. The persistent QR key source uses the existing Windows DPAPI vault; SQL stores the encrypted opaque credential. Restarting the runner retains these files and keys, while requiring a fresh sign-in/form context.

## Submission and retries

The browser generates a cryptographically random `clientKey` and `clientPersonKey` once after photo upload and retains the exact submission body for retries. SQL binds idempotency to actor, operation and canonical payload. Simultaneous same-key submissions return the same visit; a changed payload with that key conflicts. Same employee, office and local day also reuses an existing Digital ID across different forms. Once a response is uncertain, form fields remain locked and Retry sends the same body. No bearer token, photo bytes or QR plaintext enters an idempotency result.

The SQL transaction creates an APPROVED Digital ID, current pass, encrypted QR credential and manager notification outbox entry together. Manager routing uses the employee directory relationship. Real email delivery remains deferred. The receipt fetches current SQL validity through a fixed OWN read; another employee cannot access it. If the receipt read fails after submission, the UI preserves the saved result and offers a detail refresh.

The current screen shows a saved receipt. Card display/authorized photo retrieval and reception printing UI remain subsequent work; physical printer acceptance stays last.

## DB changes

- Migration 021 adds `gp.ListRegistrationLocations`, bounded to 100 active offices and bound to a validated intake capability and, for employee intakes, current employee session. Authorization and intake locks, final expiry revalidation and successful-read audit follow the existing contracts. API role procedure grants increase from 24 to 25.
- Migration 022 fixes SQL LIKE exclusion brackets in registration and reissue QR key identifier validation. The previous trailing hyphen expression unexpectedly rejected underscores/hyphens, including the file vault's `k_<uuid>` IDs. Hyphen-first exclusion brackets accept the intended alphabet and still reject other characters. Exact expected fragments are checked before transactional ALTER; existing module logic/grants, rows and keys are preserved.
- Local database now has migrations 001–022, 60 procedures and 8 functions. Core structure remains 33 tables, 297 columns and 58 foreign keys.

The development RPC bridge accepts only five named stored procedures and runs each call through a disposable `gp_api_runtime` member without a login. It is restricted to explicit dummy mode and the synthetic local test database. This is local validation plumbing; production continues to require separately provisioned runtime identities and its approved TDS driver.

## Evidence and limits

- 233/233 Node tests pass, including actual image decoding and Windows ACL/DPAPI storage tests: `database/validation/digital-id-unit-tests.txt`.
- Ten actual HTTP/SQL Digital ID checks pass, including concurrent idempotency, changed-payload conflict, daily reuse, rejected cross-employee access and invalid photos. The test administrator verifies photo-file hash equality, one manager outbox event and the encrypted QR record, then removes owned test rows/files: `employee-digital-id-integration-report.json`.
- Eleven existing actual HTTP/SQL dummy SSO checks pass, including nonce-protected served HTML JavaScript syntax and external navigation to the public shell: `dummy-sso-integration-report.json`.
- All 55 existing SQL print/reissue lifecycle cases pass with underscore/hyphen key identifiers, plus six actual backend encryption/QR/card journeys. This is software validation; it does not exercise a physical printer. Evidence: `pass-print-report.json`, `pass-print-backend-integration.json` and `digital-id-print-regression.txt`.
- SQL syntax parser reports zero errors across 31 SQL files; 88 static relational-model checks pass.

Browser visual acceptance is not claimed. Corporate SSO/directory/mail, reference-aware photo retention, Linux key migration/backup restore and production identity/connectivity remain rollout work. Nothing sends real messages or runs a physical printer test.
