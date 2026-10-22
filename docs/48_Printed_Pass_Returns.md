# Printed pass return workflow

Implemented locally on 22 October 2026. This note records the updated product decisions; it does not alter the supplied Requirements.docx or establish organization acceptance.

## Product decisions

- Physical badge means the printed GatePass ID. No separate reusable badge inventory is introduced.
- Contractor and Support staff are options in the existing visitor Purpose selector, shared by QR registration and reception manual registration. They use the existing external visitor fields, authorized host, photo and approval rules. The selected text is persisted as the visit reason through the existing registration API. They are not new employee request types or a complete organization subcategory catalogue.
- Handwritten visitor/security signatures are deferred by the product decision. The source requirements still require them; that discrepancy needs requirements owner resolution. Authenticated approval and movement audit records remain.
- Retention and disposal remain pending company policy. No retention period or deletion job is introduced.

## Reception behavior

The fourth KPI is Pending return. Its server supplied count is the number of distinct visible visits in the authorized office with at least one dispatched print and no return record. Multiple copies of a pass do not multiply the count. Expired, denied or cancelled visits are still pending if their printed pass has not been returned. The count is independent of the current search and approval filters.

Selecting the KPI opens all pending returns for that office, including earlier visit dates. Normal registrations and returned-history filters retain their existing date context. History can display the return receipt.

A printed status badge is a button with the accessible action Mark printed pass returned. It is disabled while the person is inside a project or another print/return action is active. The server independently verifies presence, office authorization and the current credential. The badge becomes Returned after success, and pass details show the returned time. The original approval decision is preserved.

Returned means the reception operator has accepted the printed pass at final building exit. Project EXIT and final return are separate records. Return does not silently create missing project exits. No signature is collected.

## Server controls

Migration 071 introduces gp.PassReturns, gp.ReturnReceptionPass and office wide pending-return reads. Migration 072 blocks replaying an old legacy entry receipt after return and indexes dispatched prints by visit. The return operation requires an authenticated session, matching CSRF, a scoped RECEPTION VISITS_READ grant and PASS_PRINT capability for the office.

The operation binds an idempotency key to the visit and expected current pass. It rejects unprinted visits, stale credentials and duplicate returns. Repeating the same completed key returns its receipt after current authorization checks, without another audit or return record.

Presence includes the visit, sibling employee requests in the same office and employee project presence. External identity is limited to the stable intake/person key; names or emails are not used to guess identity across unrelated registrations.

A short exclusive authorization gate serializes the presence check and closure against movement, print rendering and credential replacement writers. There are no network or printer calls within that transaction. This uses the existing shared authorization gate for correctness; production throughput should be measured against the agreed load targets.

Return revokes the current credential and delivery links. Existing entry and common-area verification checks reject the revoked pass. Reception print/reissue authorization additionally rejects any visit with a final return record. Returning a pass does not invalidate unrelated credentials for that person; returning each separately issued printed pass is tracked separately.

The audit stores actor, time, office, visit and pass reference. The API returns only the visit, pass and returned timestamp. Runtime SQL identities receive procedure access and no direct table authority.

## Printing limitation

The existing Printed state is based on a server dispatch to the browser print workflow. It cannot confirm that paper actually emerged from the printer. Return is an explicit reception attestation, not an automatic consequence of expiry or a print counter.

## Verification

- Unit/service tests cover return input/output validation, safe error handling, typed pending-return selection and authenticated HTTP routing.
- Dedicated live SQL tests cover permission boundaries, unprinted/stale credentials, inside-project blocking, idempotent retries, duplicate denial, revoked entry, blocked print/reissue, old expired passes, sibling employee presence, employee project presence and a concurrent entry/return race. Fixtures are owned and cleaned.
- Phone and laptop browser tests cover the pending-return KPI, older visits, disabled inside state, retry key reuse, returned badge, removed print action, layout and accessibility.
- Test-PassReturns.ps1 is included in the SQL CI suite. Existing local Admin changes are preserved; no push is performed for this task.

### Recorded results

Local unit CI: 438 tests, 437 passed, one platform skip, zero failed; coverage 95.36 percent lines and 88.49 percent branches. Full typecheck, lint and 72 migration hashes passed.

Five live SQL return test groups passed, including ordinary and same-key entry rejection after return. Forty transaction/security regression cases and 55 printing regression cases passed; owned fixtures were cleaned.

Twelve relevant browser cases were exercised: eleven passed in the combined run; the remaining manual form test used a hidden native select and timed out. After changing the test to use the visible purpose dropdown, that case passed independently. A further full browser suite rerun is not claimed.

The restarted localhost server passed actual HTTP reception authentication, SQL pending-return listing and malformed-return rejection. The smoke test logged out its own session without changing real visits or sending email.
