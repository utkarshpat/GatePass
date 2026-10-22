# Reception ranges and scoped host reminders

Reception now places its title below the navigation, uses a compact Project column and icon-only View pass, and opens a pass when the row or keyboard-focused row is activated. Printing remains a separate action. Table cells retain their table display role on desktop; action buttons cannot overlap the card badge. Phone layout remains stacked.

History accepts inclusive From/To dates within the existing office calendar bounds. It reads every day and cursor in the selected range, with cancellation/version checks; the current-day main list is unchanged. Invalid inverted ranges are rejected. A refresh retains the visible rows until a new response arrives; a failed initial context request has a visible recoverable error instead of silently clearing the page. Office switches clear previous office rows. Private visit data is not stored in browser persistence.

Registration heading focus still announces wizard steps to assistive technology, without a control-like heading outline.

## Host reminders

Reception can remind only within a currently authorized office. A guard can remind only for its assigned project duty and office. Common-area identity verification does not grant this action. The host identity, visit snapshot and request are immutable; recipients cannot be supplied by the client. Host unavailability uses the existing new-registration flow, with no silent host reassignment or approval bypass.

The existing notification worker sends reminders through the existing approval template and original verified host. PENDING/PROCESSING mail is never duplicated or its lease reset. SENT/DEAD messages can produce a new queued attempt after a five-minute cooldown. Sent indicates provider acceptance, not proven delivery. Queue state and last queue time are shown; failed mail can be retried. Approved, cancelled, expired/deadline-expired and revoked latest-pass requests cannot queue reminders. Current host eligibility is checked again by SQL and the sending worker.

The operation is serialized with visit state and outbox claims. Actor/client-key receipts make lost-response retries idempotent; another request cannot reuse that operation key. Reminders audit the operator and outcome. New execute-only procedures do not grant direct table access. No worker or real email is invoked by the tests.

Forward migrations 068 and 069 implement the reminder operation and latest-pass check. Both are included in migration checks and local setup. SQL, HTTP, browser, unit and static checks cover scope, queued dedupe, cooldown, failed retry, status, expiry, revoked pass, desktop overlap, history range, refresh preservation, reload and click behavior. Test fixtures are owned and cleaned.
