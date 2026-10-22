# Return and reception follow-up audit

Date: 22 October 2026. Local changes only; no push. Existing Admin work was retained, with targeted layout and readability corrections.

## Fixed defects

1. An employee's Digital ID and separate project request could both count as separate people inside. Reception now deduplicates every employee request type by employee ID; independent external visitors remain separate.
2. Returned or expired pending requests could inflate the pending KPI while its filter showed fewer rows. The operational pending filter and count now use the same live pending condition.
3. Restoring or replacing the reception context could retain print/type filters and the previous office's counters or rendered rows. Context changes now reset filters, clear rendered records and wait for the new scoped read.
4. An authorization denial during refresh could retain the previously displayed visitor records. A 403 from the office list or context refresh now clears protected lists, images, history and open detail/manual dialogs. Network/service failures continue to retain the previous authorized list with a visible failure message.
5. The periodic renderer could overwrite a failed-refresh warning with a normal matching-count label. Failure and authorization status now remain visible until a successful refresh.
6. Reception requests had no deadline and could leave the UI loading indefinitely. A 30 second abort deadline covers connection setup and response-body reading; mutation retries continue to use existing idempotency keys.
7. A row opened from an old list/history could show Printed after another operator returned it. Reception detail now supplies the current return timestamp and print count, and updates the row, detail and print availability from that fresh read. These new fields are projected only for the reception view.
8. A returned temporary ID or employee project request still participated in same-day reuse/overlap checks, blocking a fresh request. Migration 073 excludes final returns from live registration reuse/overlap. A new request gets a new visit and credential; the old one stays revoked. Repeating the new request still reuses its valid current credential.
9. On mobile, Admin navigation groups could shrink and overlap, intercepting taps. Groups now retain their content width within horizontal navigation scrolling. Navigation headings, the presence badge and disabled actions use readable text contrast. The existing user layout was preserved.
10. The common-area browser test targeted an input now hidden in the new tabbed layout. The test now opens Assign Duty before using that field; assertions and authorization checks remain.
11. A SQL deadlock was observed between reception reads and synthetic test cleanup. A retained deadlock graph showed conflicting VisitRequests/VisitPresence locks. Owned transaction and registration fixture cleanup now takes the existing exclusive authorization gate before modifying records, aligning lock order with API operations. No production isolation setting was weakened and no mutation retry was added.

## Evidence

- Local unit CI: 441 tests, 440 passed, one platform skip, zero failures. Coverage: 95.36 percent lines, 88.56 percent branches.
- Full browser suite: 41 passed, including phone/laptop reception and Admin workflows, authorization denial, context reset, stale return receipts and request timeout cases.
- Live SQL registration suite: 55 passed, including fresh TEMP_ID and EMPLOYEE_PROJECT requests after return and current receipt reads. Exact owned fixtures were removed.
- Live SQL return suite: all five groups passed again after the cleanup locking correction, including concurrent return/entry, duplicate/replay boundaries and old pending returns.
- Typecheck, lint and 73 migration hash checks passed.

## Remaining scope

Retention/disposal policy, organizational Entra/directory/Graph setup, production hosting and organization acceptance remain separate pending work. Signatures remain deferred by the product decision and still differ from the supplied source requirements. These checks establish the tested behavior above; they do not establish absence of every possible defect.
