# Office entry and registration UI

The office entry now has two working paths: **SSI Employee** and **Visitor**. The supplied original Noida photo is copied unmodified to `assets/locations/office-background.png` and reused for all office backgrounds, as requested. The image does not determine the request location. Existing global CSS tokens/components remain the visual foundation.

## Entry context

Office QR destinations are `/office/noida`, `/office/bengaluru`, `/office/chennai`, and `/office/pune`. An exact allowlisted server route issues a signed, HttpOnly office-context cookie, valid for eight hours. Registration binds that office code into its signed intake context. Changing office during an active intake is rejected. Active office and project information is resolved in SQL; incoming location IDs and raw validity timestamps are rejected on this surface.

The local root `/` retains a valid current office cookie or previews Noida when none exists. This is a local development convenience. Deployable office QR codes should target the explicit office URL on the approved HTTPS host. Opening a public office link is registration context, not proof of physical presence or an access grant. Guard access authorization remains separate.

## Employee

The employee button opens email/password sign-in with Show/Hide and a generic incorrect-credentials error. Existing synthetic emails (`employee1@example.invalid`, etc.) use the shared local test password `Sopra@123`. The explicitly gated dummy HTTP provider validates the password before directory lookup or SQL session issuance, including direct employee-ID login clients. Missing or wrong passwords are rejected. The password is cleared from the form after an attempt and is neither stored in the directory/SQL nor returned in response JSON. This remains a development/test credential, not corporate authentication; the identity/session gate remains replaceable by corporate SSO.

After sign-in the app fetches the employee name, ID, email, manager mapping and assigned projects. The UI shows the required read-only identity/projects, reason and photo flow, then review. There is no employee date/time field. Both DIGITAL_ID and EMPLOYEE_PROJECT reject a client-supplied visit date; project windows use the current India calendar day. Digital ID continues to use its existing SQL-issued start time and same-day expiry, auto-approval, manager outbox notification and daily reuse.

**Request access to more projects** opens project selection and bounded host name/email search. Own assigned projects are resolved from the signed-in profile and are excluded from extra project requests. Each added project gets its own employee project intake, photo asset, stable client key and pending approval. The Digital ID is submitted first and retained independently if a later extra request fails. Retries skip confirmed jobs and preserve the current uncertain job's payload and intake.

## Visitor

People → Visit → Photo → Review → Submit. Up to ten people can share one intake; names, contacts, photos, visits, passes, approvals and notification rows remain individual. Email is optional. The visitor date defaults to the current office date and can be changed within the existing SQL policy horizon (currently thirty days). No time picker is shown. The server derives the selected India calendar day's UTC boundaries.

Project selection precedes host search. Results show host name and corporate email, only for a current eligible member of that project at the office. Changing the project clears host selection. SQL rechecks the host/project relationship on submission. Submission immediately creates independent pending visitor passes/credentials; it does not wait for approval or change the existing reception-printing policy.

## Photos and interaction

An explicit Open camera action requests video only; microphone and geolocation are disabled by Permissions Policy. Captured frames become bounded JPEG files and use the existing server-side decoder/re-encoder and private filesystem store. File upload remains available. Camera tracks stop when changing step, returning home, hiding/leaving the page, or signing out. A late permission result cannot reopen the camera after leaving its step. Group photos are selected and reviewed per person. No face recognition or automatic photo-quality approval is claimed.

The UI uses concise page labels, an actual stepper, keyboard-accessible host options, photo preview/retake, group controls and review. Confirmation is shown only for actual SQL results. No download, wallet, approval or print action is fabricated on these screens. The landscape pass renderer and staff-role screens remain separate work.

## Database and transport

Migration 023 adds `gp.GetRegistrationOptions`, an intake/capability-scoped selector with shared authorization/intake locks, fresh directory predicates, final intake revalidation and audit. Projects are bounded to 100, hosts to 10, with a minimum two-character name/email query. Query text is parameterized and is not copied into audit records. Existing submission SQL remains the final authority. Core structure remains 33 tables, 297 columns and 58 foreign keys; the database now has 61 procedures and eight functions. API procedure grants increase to 26; worker/auth/media/render grants remain separate.

Local development keeps the execute-only RPC bridge, synthetic directory and dummy SSO mode. Photos, encrypted QR material, permissions, registration and notification outbox operations are actual application services and SQL transactions. No real email is sent. Production identity/TDS/SSO/directory/mail integration and retention/Linux/restore gates remain unchanged.

## Verification

- 239 Node tests pass, including six office/date/camera lifecycle checks: `public-registration-unit-tests.txt`.
- Ten actual HTTP/SQL office/public/employee cases pass with owned test data and private files removed: `public-registration-integration-report.json`. These verify the original background hash, served JavaScript/CSP, office binding, host mismatch rejection, date injection rejection, group idempotency and independent extra-project approval.
- The SQL parser reports no errors across 32 SQL files; 88 static model checks pass.
- UI source checks resolve all labels, control references and global CSS tokens. Browser visual acceptance, an actual camera-device test and physical printer acceptance are not claimed by these source/HTTP checks.

Run `npm.cmd run dev` and open `http://localhost:8443/office/noida` for the current local entry.

## Entry layout refinement

The landing screen fits the dynamic viewport beneath the navigation. On mobile, the original campus photograph fills that area and both entry actions sit above it as translucent, blurred glass buttons. Only the navigation shows the office name; the photo caption and bottom GatePass footer are removed. Short mobile landscape layouts place actions side by side. Registration screens retain natural scrolling, and the landing content can scroll internally when enlarged text requires extra room. CSS/source checks do not constitute browser visual acceptance.

The registration and sign-in surfaces render directly on the white page beneath navigation, without the outer bordered card, shadow or inset canvas. The campus image is reserved for landing. Employee sign-in has empty email/password fields and no synthetic-account datalist or directory-list fetch; existing dummy credentials still work. Form widths remain bounded for readability on desktop.

Sign-in heading is centered. Mobile hides the sign-in Back link; same-document history supports phone/browser Back across screens and registration steps. History stores navigation markers only, not form contents or credentials. In-flight submissions retain their current screen to avoid disrupting uncertain requests. Decorative button arrows are removed. Password focus outlines the entire password control, including the visibility toggle.

## Visitor contact, compact cards and notifications

Visitor mobile entry defaults to India and offers all 245 supported country/territory calling codes, with a searchable country/name/code dialog and local SVG flags (including Ascension and Tristan da Cunha aliases). Mobile numbering metadata comes from the pinned `libphonenumber-js` mobile bundle; both UI and RegistrationService validate it. UI country mismatch is rejected; the API accepts valid canonical E.164 mobile numbers. No identity or ownership verification is inferred from format validation. Flags and numbering metadata are served locally with the existing nonce/CSP and loopback rules. Sources: [numbering library](https://github.com/catamphetamine/libphonenumber-js), [flag assets](https://github.com/lipis/flag-icons).

Adding another visitor validates the existing people first, then collapses completed entries into name/contact summaries. Edit reopens a card, preserving its country, number, email and photo. Invalid hidden cards reopen before validation focus. Group submission and per-person idempotency remain unchanged.

`visitor-components.js` provides the phone picker and shared toast presenter. Global CSS owns country-dialog, phone-control and info/success/error toast styles. Toasts support explicit dismissal, expiry, hover/focus pause and accessible announcements; field errors remain attached to the phone field. Generic notifications use the presenter rather than inline page banners. New frontend behavior tests cover country metadata/assets, international normalization, mismatches, compact-card restoration and toast dismissal. Registration tests also reject malformed phone submissions before SQL.

Country dialog sizing uses explicit fixed bounds from the visual viewport, with internal results scrolling and resize/keyboard updates. The first registration step renders before the intake/options round trips. During setup, local details (including phone country selection) are editable immediately while navigation/submission stays disabled until server context is ready. During actual submission all form fields remain frozen, with consistent phone disabled styling. Component tests exercise viewport bounds and both initialization/submission control states. Browser visual acceptance is still separate.

Employee extra-project selection now opens a modal dialog on top of Details, with Project, Host, Purpose and optional details. Add project is its primary footer action; Cancel/close/Escape discard only the draft. The Details/Photo/Review navigation remains in place. Added projects remain independent host/project snapshots shown on Details. Shared visitor fields return to their original form location after closing; popup select menus stay within the active dialog. Modal bounds follow the visual viewport, with internal scrolling and focus restoration. Targeted tests cover cancellation/restoration and validated additions.

## Employee completion and card image

The public entry header contains company branding and office only. Employee authentication is requested for each new flow; a server-bound session/CSRF context still protects registration, photo and card operations. Home or closing the flow calls session revocation, clears the employee state and releases temporary card/photo object URLs. There is no account workspace or visible Sign out action.

On successful employee registration, the actual landscape Digital ID appears with Download image. PNG output is 1712 × 1080, generated from the existing trusted card renderer with SQL-sourced identity, current project assignments, private photo and issued QR. Pending additional projects remain separate summaries. A failed image read offers Retry card and never repeats registration.

Migration 024 adds `gp.GetOwnDigitalIdCard`, executable only by `gp_render_runtime`, not `gp_api_runtime`. It verifies session/CSRF, employee OWN relationship, current active pass, validity, fresh directory data and available private photo under shared authorization/visit locks. Source QR material remains encrypted in SQL and is never returned by HTTP. The image service verifies photo integrity, decrypts the existing QR using protected keys, renders, and re-reads the authorized source before release to reject changed/revoked passes. Two concurrent renders are permitted with no unbounded queue. The local bridge uses a separate execute-only render principal for this exact procedure. No print job is created or dispatched by image download.

Only `{mimeType,fileName,imageBase64}` crosses the no-store, same-origin authenticated endpoint. Tests verify wrong-owner denial, malformed IDs, private-path/photo integrity, source changes during rendering and actual exported QR decoding matched to the issued SQL credential. Browser UI acceptance and physical printer testing remain separate.
