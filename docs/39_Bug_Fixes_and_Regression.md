# Post-push fixes and regression evidence

22 October 2026. Local follow-up to pushed baseline `e8467118ca75550d83971cd02dcd584c65e97f61`. No additional commit, push, production deployment, real email or physical print is part of this fix batch.

## Corrections

1. **Guard reconciliation:** forward migration 063 preserves the underlying authorized reconciliation flag for cancelled/revoked external and employee-project visitors who remain inside. Ordinary exit stays denied; reconciliation requires the existing explicit capability, reason and audit. Common-area duties do not gain project authority. Temporary ID behavior is preserved. Migration 063 was applied to the dedicated local test database; earlier migrations were not rewritten.
2. **External email status reload:** a validated signed link is exchanged for a request-path-scoped, HttpOnly, SameSite=Strict session cookie (Secure in production). The fragment is removed only after a successful exchange. History contains a non-secret view hint; neither browser storage nor the response body contains the proof. Scoped detail/image calls verify the signature, request binding and current SQL authorization. This grants read access only. Corporate host decisions retain their existing authorization model.
3. **Reception date rollover:** Today asks the server for the current India date. Calendar bounds and the selected current day refresh on visibility and a periodic day check. Deliberately selected historical dates survive automatic refresh. Versioning and overlapping-request control prevent a late date response from overwriting a newer selection.
4. **Future receipt lifetime:** signed-link validation supports at most 92 days, covering the supported 90-day booking horizon, remaining visit-day time and one-day status grace. Existing shorter tokens retain their original expiry. Current SQL and media checks remain mandatory. Signing-key retention must cover outstanding links, and links can be invalidated by the existing snapshot/recipient authorization checks.

## Adjacent cases covered

- Both external and employee-project cancellations/revocations while inside; incapable guard and common-area denial; actual unauthorized reconciliation RPC denial; ordinary exit denial and authorized reasoned reconciliation.
- Missing, malformed, duplicate, tampered, expired and wrong-request holder cookies/proofs; body override denial; failed exchange retry; cookie loss; two independent holder tabs; uppercase UUID and trailing-slash normalization. The local route/client changes for trailing slashes were preserved and included in the link regression.
- Reloaded status/card, cancellation after a delayed image response, approved-card expiry while open, and visibility/BFCache invalidation. The page discards stale media before refreshing. This cannot recall an image already downloaded by its authorized holder.
- India midnight with a browser in another timezone; calendar bounds; manual historical date retention and slow Today response races.
- Receipt rendering at 0, 30, 45 and 90 days; exact 92-day signature limit and rejection beyond that bound.

## Executed validation

- 380 unit tests passed with coverage gates: 92.10% lines, 86.96% branches, 93.88% functions across measured TypeScript. Browser JavaScript is exercised separately, not included in those percentages.
- 19 actual SQL guard-duty cases passed, including the new cancellation/revocation and denied-RPC regressions. Exact owned fixtures were removed.
- 24 actual HTTP/SQL registration, reception and email cases passed, including holder cookie exchange, scoped media, reload and isolation. Exact owned fixtures were removed.
- All 21 Chromium browser/accessibility cases passed in the final full run, covering phone and laptop layouts. All six email-status browser cases passed again after strengthening the trailing-slash/multi-tab regression.
- Type-check, full lint, all 63 sequential migration hashes and diff whitespace checks passed. Earlier applied migration contents remain unchanged.

The first full browser run passed 20/21: the admin common-area options were unavailable. The isolated case then passed, followed by a full 21/21 pass. The first run overlapped a local server restart/directory seed, but that timing is not a confirmed root cause. The regression now asserts the common-duty HTTP status before checking rendered options; no production logic was relaxed and no fix for an unconfirmed cause is claimed.

Local ignored logs: `tmp/fix-unit-coverage.log`, `tmp/fix-guard-duty-final.log`, `tmp/fix-http-sql.log`, `tmp/fix-browser-full.log`, `tmp/fix-browser-common-investigation.log`, and `tmp/fix-*-final.log`. These contain local execution evidence and are not shipped as application assets.

## Remaining limits

Passing these checks is not proof of a bug-free system. The previously unconfirmed intermittent reception SQL 547 remains a separate investigation if it recurs; no root-cause fix is claimed. Production workspace composition, organization SSO/MFA and Graph onboarding, Linux key/storage retention, and physical-printer acceptance remain deployment work described in the system handbook. Production HTTPS is required for the Secure holder cookie; the non-Secure cookie variant is confined to the explicit local development adapter.
