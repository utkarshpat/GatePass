> Documentation status: historical implementation/design/evidence record, indexed 3 November 2026. Read the [current handbook](system/README.md) and [Visit owner/Host glossary](109_Visit_Owner_and_Host_Terminology_03_November_2026.md) for current behavior. Counts, setup examples and screenshots below describe their dated stage, not a fresh certification.

# Visitor preparation and recipient routing

Updated 2 November 2026. Implementation is limited to the authenticated Visit Coordination workspace. The source review was the supplied **Visitor Management Experience / Executive Review / VIP End-to-End Protocol** presentation. This does not change public visitor registration, QR/pass allocation, reception or guard entry/exit rules.

## Invitation preparation

The invitation retains one visitor, office, destination sub-projects, arrival/departure, purpose, VIP notification and stay request. Optional additions are:

- Visitor category and visit type.
- Meeting location and agenda/itinerary.
- Meeting room, AV support, hospitality, parking, ground transport, travel and accessibility support.
- Device types only; no serial number, make/model or identity verification fields.
- Network, recording, after-hours, restricted-area and data-centre requests. Selecting these records a request; it does not authorize access or replace policy review.
- A named internal coordinator, visit owner and alternate receiver. The primary host remains accountable.

Requested services require a named coordinator and create independent preparation tasks. Their confirmation contributes to planning readiness only; it is not a new condition in ordinary guard or reception operations. Accommodation continues through the existing stay task and configured facilities owners. The visit owner and alternate receive FYI information only, without additional workspace or decision permissions.

## Names and additional people

Office routing and selected destination previews show current required reviewer names, ALL/ANY review requirements, notification recipients, VIP recipients when applicable and arrangement owners. Missing configuration is visible and submission still fails closed under existing policy checks.

The **+ Add approval / notify** control searches current internal employees by name or email. A person can be added to the whole visit or a selected destination:

- **Additional required approval** creates a separate review alongside every configured mandatory review. It cannot remove or satisfy the original reviews.
- **Notify only** creates an FYI notice and grants no workspace, thread, approval or entry authority.

Up to twenty explicit additions are accepted. Duplicate person/scope pairs and host self-additions are rejected. Removing a destination removes its extra recipients from the unsaved form. Saving a draft sends nothing. Submission queues the existing mail worker notices; FYI recipients are deduplicated for the submission event. Separate approval/task messages retain their individual actions.

Current internal membership and assigned authority are checked when reading, deciding, updating tasks and processing queued mail. Destination reviewers receive only authorized destinations. A service-only coordinator receives the necessary meeting location and support requirements, without the private agenda or unrelated project details. Stay-only owners do not receive preparation details merely by owning accommodation.

## Storage and compatibility

Forward migrations **133–134** add version-bound preparation, additional people and support-task bindings. The existing reviewed mandatory policy builder remains in use. No direct runtime table grants or new public procedures are added. The existing protected read procedure supports host-scoped people search and recipient previews. Detail responses include scoped recipient names and preparation; owner draft round-trips preserve them through revisions. A draft JSON string/object inconsistency was corrected so edit forms restore saved values reliably.

Revisions reset decisions and service confirmations for the new version. Cancellation and historical activity retain the existing audit/notification flow. No existing migration is rewritten.

## Verification

The isolated SQL acceptance suite adds 31 checks for recipient lookup, additive approvals, notification-only denial, task ownership, preparation privacy, revision reset, invalid fields and execute-only table protection. Phone and laptop browser acceptance covers recipient previews, internal person selection, additional approval/notification, coordinator assignment, save/edit/submit persistence and accessibility. Existing coordination tests continue to cover independent destination approval, private discussion, retries, identity changes and scoped administration.

Mail tests use an owned synthetic database and mock Graph HTTP provider. These checks do not establish real mailbox delivery, client-side permission or physical readiness. Actual travel booking, room reservation, budget authorization and identity-provider integrations are not implemented by these fields.

Verified locally: 134 sequential migration hashes; typecheck, lint, architecture and frontend builds; 719-case full unit run (718 passed, one platform skip), followed by the added multiline regression (26 planning domain cases passed); 145 isolated SQL checks (40 schema, 47 planning, 27 mail, 31 preparation); 12 existing coordination browser cases plus two new phone/laptop preparation cases. The real localhost server was restarted after migrations 133–134, and employee login, routing names and employee search were smoke-tested without saving an invitation or sending mail. Secret scan reported no leaks. Changes remain local and uncommitted.
