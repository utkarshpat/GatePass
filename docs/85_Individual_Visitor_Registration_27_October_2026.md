# Individual visitor registration — 27 October 2026

## Current behavior

- One person per registration in self-service and reception manual registration. Add/remove visitor controls, collapsed participant summaries and multi-person photo selection are removed. Service and SQL reject multiple people, including forged submissions. Existing historical group records remain readable.
- Visitor details still include name, mobile, optional email/company and device categories. Photo capture remains camera-only.
- Visitors search hosts by name/email within the QR office. The visitor UI and public options API no longer provide projects or accept a project filter. Employee self-service project access retains its authenticated project selector.
- SQL independently checks the host's current office and directory status. Routing to a host's eligible project office stays server-side. With multiple eligible local project assignments, the lowest project-location key is chosen consistently; committed retries retain the saved routing. A host without an eligible project route cannot receive a visit until their directory mapping is corrected. No project mapping is returned in host search results.
- Visitor start date is always today's India calendar date, derived on the server. **Valid until** selects the final day of the stay, inclusive, within the existing organization-configured horizon. The stored end is midnight after that date. Future starts, past/invalid end dates and caller-supplied timestamps are rejected.
- Current guard/reception queues include visitors whose multi-day stay remains valid. Historical register dates retain their registration-date meaning. Employee Digital IDs and employee project access remain same-day.

## Digital visitor card

The old success UI requested an image only for employee Digital IDs. Visitor submissions now request their own PNG card, display a preview and offer a download with a retry action. A pending card remains visibly pending; it does not bypass host approval or entry checks.

The new render procedure requires the exact active registration intake, intake token/CSRF hashes and visit binding. An email address is not required. Only the raster image, filename and MIME type leave the card service; QR encryption material, photo paths and project assignments are not returned as JSON. A second authorization read prevents issuing an image after the pass changes. The signed intake cookie expires normally; email-based retrieval (when email is supplied) and reception lookup remain available afterward.

Reception manual registration uses its separate intake/session authority and the same card endpoint. Runtime database access to the source procedure belongs only to the render role. Migrations 116–118 preserve previous versions, introduce the new flow/validity and queues, and retain bounded device canonicalization from migration 084.

## Validation

Phone and laptop browser checks cover the individual form, office-wide host lookup without public project data, tomorrow as the inclusive end date, actual camera-photo submission, a real rendered downloadable card without email, and denial from another intake. Accessibility and no-horizontal-overflow checks cover public registration. Unit checks cover date bounds, forged project/group payloads, and public projection privacy. SQL integration retains employee entitlement, concurrent retry, photo, snapshot, rollback and notification checks under the revised single-person contract.

No remote push is included.

## Inclusive validity labels

Digital IDs and all visitor/pass previews, prints, details, guard cards, register display/export and notification emails show calendar-day expiry as the last included minute (`23:59` on the final day). SQL expiry remains the next midnight as an exclusive bound. Actual event timestamps and non-midnight expiry times are unchanged.
