# Email design, person photos and approval identity

23 October 2026. The requested image is the person's submitted photo. Generated pass cards and QR images are not attached to notification emails by this change.

## Email presentation

The HTML template now uses explicit presentation tables, cell backgrounds, inline fonts and an Outlook conditional fixed-width wrapper. It presents company branding, a status badge, the person's name/company/photo, office/project/host/devices, purpose, validity and clear actions. The full request reference stays in the footer; the subject uses the person's name and office. Long names and references wrap at mobile widths. The same notification remains readable without a photo or when a mail client blocks images.

Person photos appear in assigned-host approval, Digital ID manager notice, requester receipt, decision result and pass-delivery emails. Manager notices remain information-only and have no approval or private-holder links. Pass-replacement notices do not gain a photo. The image is an inline MIME attachment referenced by `cid:gatepass-person-photo`, alongside the existing company-logo CID. No public photo URL, photo-storage path, QR credential or pass-card attachment is added to the message.

An email image is a delivered copy, not a live authorization decision. Pass status and permitted actions continue to come from the current application state.

## Photo access

Forward migration **088** adds `gp.ResolveNotificationPhoto`, individually granted only to `gp_worker_runtime`. It accepts a notification ID and claim token, rather than a caller-selected person or storage path. The resolver checks a live PROCESSING lease, takes the existing authorization/visit/outbox locks, and rechecks notification relevance and the exact recipient. A changed recipient, expired claim, decided approval request, returned visit or purged request cannot export a photo. An unavailable/purged photo yields no image metadata.

`NotificationPhotoService` validates the returned visit, asset ID, intake-scoped storage path, MIME, length and SHA-256. It reads only through the protected photo store, resolves permission/metadata again after file work and rejects a changed result. The mail worker then renews its lease and repeats the existing notification-content relevance check before sending. Photo buffers are cleared after rendering. No web route or general photo/QR-source privilege is granted to the worker.

Both mail CLIs now wire this service. Production additionally requires `GATEPASS_MAIL_PHOTOS_ROOT`: the absolute protected **photos directory**, shared with the application media store and readable by the mail service identity. It must be outside the source workspace, with the existing private-directory permissions. The worker receives no QR keys. The development sandbox uses the existing local private photos directory and fences both notification and photo reads to the explicitly selected synthetic visit. It never falls back to the global queue.

## Why HTML buttons may require sign-in

Opening a message in an authenticated mailbox does not give the linked GatePass browser page a verified Microsoft actor identity. HTML Approve/Reject links therefore open the assigned-host review page; an existing valid host session is reused, otherwise the host signs in. Clicking a GET link, forwarding a message, or a mail scanner opening the URL cannot itself decide a visit.

The separate [Direct Outlook approval](36_Outlook_Direct_Approvals.md) implementation supports actions inside Outlook using Microsoft's signed Entra actor token and an independently bound visit/host/decision capability. It needs an organization-registered Actionable Messages provider, approved sender, publicly reachable HTTPS origin, Entra application/scope and governed tenant/object-ID-to-employee mappings. The localhost dummy-SSO presentation setup has none of that live configuration and continues to use the explicit authenticated page. An email-address or visit-ID parameter does not replace authentication.

Microsoft documents the [sender, service-registration, HTTPS and actor-token requirements](https://learn.microsoft.com/outlook/actionable-messages/security-requirements) and [current Entra-based Actionable Messages](https://learn.microsoft.com/en-us/outlook/actionable-messages/).

## Verification and preview

- **468 unit tests passed**, one platform-specific skip. This includes photo scope/path/hash checks, revocation during file work, buffer clearing, manager/holder photo bodies, MIME/CID transport capture and the existing direct-Outlook identity tests. The installed Sharp path is required by existing raster/decode tests.
- **12 actual restricted-SQL email cases passed**, including host/manager/visitor photo claims, API-role denial, wrong/expired claims, wrong recipient, purged photo and actual TypeScript worker dispatch through a capture provider with SQL acknowledgement. Disposable fixture records were cleaned; retained presentation records were preserved.
- **9 browser tests passed**: email layout/photo rendering and long values at 390/1366 px, host login/decision behaviour, external-holder reload/cookie isolation, stale-media fencing, retry and expiry.
- TypeScript, ESLint and **88 sequential migration hashes** passed.

`npm.cmd run mail:preview` generates three synthetic HTML and Outlook `.eml` examples under `~/.gatepass/email-previews`, with inline person-photo and logo parts. It does not claim notifications or send email. Chromium checks and local screenshots are layout evidence. At the user's explicit request, two redesigned samples (host approval and manager notice, both with actual retained synthetic person photos) were accepted by Microsoft Graph at **12:38 PM IST on 23 October** through the separate personal-Outlook test connection. New-message inbox arrival/rendering has not yet been independently verified. The user's earlier inbox screenshot confirms delivery of the previous template.

The sample send left the retained Kunal Verma request pending for the presentation; it did not approve/reject anything or claim/complete original outbox notifications. The manager sample used Employee 2's retained Digital ID. Exactly one of each sample was submitted, with local exclusive receipts preventing accidental retries. All prior visit history and demo assignments remain retained.
