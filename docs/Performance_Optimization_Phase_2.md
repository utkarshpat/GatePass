# Digital-card performance: development SSO worker reuse

Implemented locally on 23 October 2026, following [phase 1](Performance_Optimization_Phase_1.md). This batch targets the measured process-start overhead in the explicitly enabled dummy SSO adapter. Production SSO and its typed SQL driver are unchanged. No new dependency, paid service, database migration or index is required.

## Measured result

Five read-only image requests used the same retained employee Digital ID, local machine, database and PNG dimensions. The before run used the phase-1 development server; the after run used the restarted server with this batch. The benchmark logs out its own session afterward and retains no image or credentials.

| Complete image HTTP response | Before | After |
| --- | ---: | ---: |
| Median of five samples | 2,828 ms | 589 ms |
| First image request in the run | 4,122 ms | 1,658 ms |
| Remaining four samples, range | 2,305–3,117 ms | 268–608 ms |
| PNG bytes | 135,397 | 135,397 |
| JSON response bytes | 180,638 | 180,638 |

The observed median is approximately **79% lower**. These are small local samples, affected by process/SQL/font warm-up and background machine activity. The first request follows sign-in; it is not a completely cold database/machine measurement. This is not a production latency guarantee or a load test, and the full difference cannot be attributed exclusively to one code change.

A separate five-sample stage profile measured the actual SSO verifier plus the own-card service directly. Median SSO verification fell from **1,290 ms to 159 ms** (about 88%). Median total service time fell from 2,267 ms to 776 ms; rasterization remained around 0.1 seconds. SQL source-read timings also varied between these runs despite unchanged SQL, so those differences are not claimed as query optimization.

Ignored duration-only evidence: `output/card-optimization-2/http-before.json`, `http-after.json`, `stages-before.json` and `stages-after.json`. Reports contain timings, status codes and byte counts, not tokens, QR credentials, photo bytes or rendered cards.

## Change and boundaries

Previously `LocalDevelopmentSsoRepository` started PowerShell, imported the SQL helper and loaded its SQL source for every directory/session operation. It now lazily reuses at most **two** hidden helpers through `JsonLineWorkerPool`. SQL source is read once per helper, so changes to that development SQL file require restarting the server.

Each operation still opens and disposes a **fresh, unpooled SQL connection** and executes the existing SQL transaction, development-marker, session, expiry and authorization checks. Authentication results, employee profiles and SQL connections are not retained by the pool. Phase 1's sharing of only an inspection currently in progress remains separate; later inspections still query SQL.

The transport uses one active operation per helper and a random request ID checked against the response. The waiting queue is capped at 32 requests, with a 10-second waiting deadline; execution has a 20-second deadline. Requests are limited to 8 KiB and responses to 1 MiB. Invalid, oversized, mismatched or unsolicited output destroys the helper and rejects its active request. A failed or ambiguous operation is **never replayed**, including session creation/logout. Later queued operations may start a new helper.

Idle helpers retire after 90 seconds and do not keep Node alive. Provider shutdown first attempts to revoke only its own issued sessions, then closes the pool. The original single-request PowerShell invocation remains compatible for existing tooling. Runtime environment guards still require development/test plus explicit dummy/mock modes.

The tradeoff is keeping up to two PowerShell processes in memory while active/recently used. The first operation after startup or idle retirement still pays helper startup cost; the improvement is reuse during normal browsing. No additional service/API billing is introduced. Production performance needs measurement against its actual SSO and SQL composition.

## Verification

- Full unit suite: **498 passed, one existing platform-specific skip, zero failures**, using the installed Sharp runtime for real card/QR checks.
- Nine new worker-pool tests cover reuse, fragmented Unicode, concurrency/FIFO progression, queue limits/deadlines, execution timeout, wrong IDs, invalid/oversized/duplicate output, no mutation replay, idle retirement and shutdown.
- Actual local SQL smoke checks pass for the legacy helper, five concurrent directory reads, two isolated employee sessions, CSRF denial, touch/logout, and direct SQL session revocation observed by the next inspection. Only the smoke check's own temporary sessions are created/revoked.
- Seven browser cases pass: shared image loading/download, explicit retry, removal of the discarded detail call, invalid/duplicate participant binding rejection, employee sign-in/photo review, and guard sign-in/filter/language/profile.
- TypeScript, targeted ESLint and whitespace checks pass.

Presentation records, passes, photos and history are retained. No email worker is started and no test email is sent by this batch. Changes remain local; nothing is committed or pushed.

## Next bottleneck

Follow-up: [phase 3](Performance_Optimization_Phase_3.md) identified `AUTO_CLOSE ON` on the dedicated local database, disabled it explicitly, and measured card-source plans/IO without changing queries or indexes.

Restricted SQL worker/principal setup and repeated card-source reads remain visible in the stage profile. Keep the final ownership/authorization reread: it prevents a card changed or revoked during rendering from being returned. Next, capture actual execution plans and logical reads for the slower SQL operations before choosing an index/query change. Connection reuse across disposable restricted principals needs its own security/lifecycle design; it is not enabled here.
