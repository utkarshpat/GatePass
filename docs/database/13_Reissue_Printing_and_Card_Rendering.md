# 13 - Reissue, reception printing and landscape cards

**Historical Phase 02F card rules are superseded by [current document 14](14_Visitor_Identity_and_Multi_Project_Guards.md).**

Version: 1.6 | Date: 20 October 2026 | Phase 02F

## Delivered boundary

Migration 011 is applied to the dedicated local GatePass_DesignTest database. SQL was authored and tested before the internal TypeScript services. It adds PassPrintRenderState, three API procedures and four isolated renderer procedures. Current physical schema: 33 tables, 296 columns, 58 FKs and 11 migration history rows. The explanatory Chen boards are not the design authority.

This block implements explicit credential replacement and authorized card generation. It does not expose HTTP routes, send a printer command or prove paper output. DISPATCHED means an authorized artifact handoff. Actual reception printer, browser and guard camera acceptance remain required.

## Reissue and reprint have different effects

| Action | Credential | Visit / approval / presence | Retry |
|---|---|---|---|
| Reprint | Same current pass and static QR | Preserved | Same operation key returns the same print job; a new explicit request after handoff creates another audited job |
| Reissue | New pass ID, new random credential and incremented version; predecessor and its links revoked | Preserved, including an existing INSIDE state | Same key and canonical payload return the committed replacement receipt, even when the key provider is offline |

Reissue requires a nonempty reason and the expected current pass ID. A stale expected pass cannot silently replace a newer version. Reception needs PASS_PRINT and PASS_REISSUE together on the same current RECEPTION/LOCATION grant for the visit's office; capabilities from different grants/offices cannot be combined. Printing alone requires PASS_PRINT. ADMIN or GUARD role with these capability codes alone does not qualify.

Only current eligible PENDING/APPROVED visits may be printed or replaced: valid window/deadline, active destination, usable bound photo, and fresh active employee where applicable. Explicit reissue may replace an otherwise eligible revoked current Digital ID without creating another daily visit. It never restores a cancelled/denied/expired request or grants approval. Pending replacement remains pending.

Reissue invalidates outstanding REQUESTED/RENDERED jobs for the old pass, cancels old linked pending/processing deliveries, and queues a historical PASS_REISSUED security notice containing references only. Existing DISPATCHED history remains. Recipient substitution fails worker preflight; the notice itself never grants entry.

## SQL and service contracts

| Port | Procedure | Result / boundary |
|---|---|---|
| API | ReissuePass | Session/CSRF, expected pass, reason and idempotency; key-free NEEDS_CREDENTIALS preflight, then atomic replacement with typed encrypted envelope |
| API | RequestPassPrint | Current eligibility; derives FIRST/REPRINT/REISSUE; at most one unexpired active job per current pass |
| API | GetPassPrintJob | Current reception authorization and exact requester ownership; reference/status/failure only |
| Renderer | BeginPassRender | Owned eligible job, fresh claim, 60-second lease, at most three attempts; necessary photo/card data; encrypted QR material only for APPROVED |
| Renderer | FinishPassRender | Exact live claim, artifact SHA-256 and unchanged status/snapshot/photo binding; REQUESTED to RENDERED |
| Renderer | DispatchPassPrint | Reauthorizes current actor, pass, scope, source and exact digest before RENDERED to DISPATCHED; firstDispatch controls one-shot release |
| Renderer | FailPassPrint | Controlled failure code on the matching live claim; cannot overwrite a newer claim or dispatched job |

SQL operations use the existing checked authorization -> actor/operation -> individual visit lock order. Reissue subsequently takes the queue lock when cancelling linked notifications. Key lookup, decryption, photo I/O and card rendering happen outside SQL transactions. Reauthorization after waits and before artifact handoff prevents an older render from succeeding after replacement/revocation wins the database order. Bytes already handed to an authorized user cannot be recalled; every later guard scan checks current online state.

gp_render_runtime has only the four renderer EXECUTE grants and schema SELECT/INSERT/UPDATE/DELETE/ALTER denied. It cannot reissue or recover arbitrary stored rows. API, worker, auth and media cannot invoke renderer procedures. Current inventory has 45 procedures and four private functions; public EXECUTE counts are API 13, worker 5, auth 6, media 1 and renderer 4. All runtime roles remain unassigned to real identities.

PassPrintService validates exact request fields and typed SQL parameters; no body-supplied actor, validity or credential envelope is accepted. Replacement encryption reuses the established AES-256-GCM visit/pass/key-bound AAD with fresh 256-bit QR and nonce. A committed retry is resolved before looking up keys.

PassRenderService copies and verifies bounded private photo bytes against the authorized hash, validates the canonical storage path, recovers the approved QR, creates SVG and binds its digest to SQL completion/handoff. Pending rendering never resolves a QR key or encodes a QR. Failed final authorization releases no artifact. Buffers are wiped on failure where controlled; protected responses specify private/no-store and nosniff. This is an internal service boundary, not a completed HTTP/cookie or production filesystem implementation.

## Card layout and branding

The supplied brand assets are preserved unchanged in assets/brand. [Brand policy](../branding/Branding_and_Printing.md) applies across future login, employee, guard, reception and administrative screens as well as printed cards.

Cards use **85.6 × 54 mm landscape**, SVG viewBox 856 × 540, white surface, restrained crimson/orange accents, prominent horizontal Sopra Steria branding at the top, and the small GatePass app logo at the bottom. Person/photo, office, project where relevant, validity in IST and references remain individual. Long labels wrap within bounded regions. Validate actual maximum-length labels and readability with the selected printer during the pilot.

APPROVED cards include a version 5, byte-mode QR with H error correction, four-module quiet zone and a small central Sopra icon on a seven-module white plate. The plate avoids finder/timing/alignment patterns for that fixed version. The payload is only the opaque credential, never personal details. PENDING cards have no QR and clearly state NOT VALID FOR ENTRY. Neither a printed approval label nor a decoded token grants entry without current server verification.

Print at actual size / 100%, landscape; disable fit-to-page scaling, browser headers/footers and printer margins where the device supports edge-to-edge cards. Keep the SVG vector through printing. If raster output is needed, rasterize the vector directly at the target density (at least 300 DPI for the pilot); enlarging a low-resolution thumbnail destroys QR detail. Preview dimensions do not calibrate physical printer output.

Development previews contain only synthetic avatar/data and a fixed QR never issued into SQL. Generate them with npm run printing:preview and an existing approved sharp package configured in GATEPASS_SHARP_PATH. output/previews contains the approved/pending SVG samples and a combined PNG; these files are excluded from the source package.

## Evidence and reproduction

42 SQL-suite cases passed, including five races with both independent contenders observed at SQL locks. One of the 42 contains five nested actual backend/restricted-SQL/AES/QR scenarios. These exercise replacement, same-QR reprint, QR-free pending card, new-valid/old-revoked guard verification without movement, and key-provider-offline replay. Seventeen additional printing unit cases passed. The complete Node unit run is 84 cases.

The independent ZXing raster check decodes exact payloads for 24 deterministic synthetic credentials at 600, 1,000 and 1,600-pixel full-card widths (72 QR crops), plus 24 complete-card detections at 1,000 pixels. It tries up to four camera orientations because the independent detector can choose a false finder candidate in one orientation. This establishes recoverable encoded payloads under the stated raster conditions, not reliable camera focus, damaged-card or physical printer performance. Original low-DPI thumbnail scaling in the preview/test was corrected; final source remains vector SVG.

Evidence: database/validation/pass-print-report.json, pass-print-backend-integration.json, pass-print-unit-report.json, pass-print-unit-tests.txt and all-unit-test-report.json. Core 40, worker 39 and scoped-read 47 regressions also pass on the current migration set. Test fixture cleanup preserves only the requested synthetic master data and seed audit; no working guard password, business workflow, real photo or outgoing message remains.

```powershell
./database/setup/Apply-LocalTransactionCore.ps1 -Migration 011 -TrustLocalServerCertificate
./database/tests/Test-PassPrinting.ps1 -TrustLocalServerCertificate
$env:GATEPASS_SHARP_PATH = '<existing approved sharp package directory>'
npm run test:printing
npm run printing:preview
```

Apply only missing migrations in order; the runner refuses recorded versions. qrcode 1.5.4 is the pinned runtime encoder and @zxing/library 0.23.0 is a test-only independent decoder. Dependencies are project-scoped in package-lock.json. Production dependency audit recorded zero vulnerabilities at the time checked; this is not a security certification. Native TypeScript execution was tested, not a compiler/typecheck pipeline.

Next: cancellation and remaining scoped administrative contracts, then trusted HTTP/session adapters, production identities/driver/private storage/key source and the shared branded UI. Real SSO/directory/mail, printer/device acceptance, browser security, retention/monitoring and Linux migration remain deployment/application gates.

Encoder/decoder references: [node-qrcode](https://github.com/soldair/node-qrcode), [ZXing JavaScript library](https://github.com/zxing-js/library).

## Superseded card policy

This document records Phase 02F. The user subsequently clarified that guests wait in the common lobby and reception prints immediately, while approval controls project entry. Current 012/013 policy supersedes the QR-free pending card and printed approval labels described above. Pending and approved cards now contain the same identity QR layout without project/approval wording. A shared-area guard handles all current assigned projects concurrently; each movement names its exact target. See [current document 14](14_Visitor_Identity_and_Multi_Project_Guards.md).
