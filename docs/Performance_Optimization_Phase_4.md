# Digital-card performance: reuse a helper across browsing pauses

Implemented locally on 23 October 2026 after [phase 3](Performance_Optimization_Phase_3.md). This batch targets development API helper churn between ordinary user actions. Production SQL/SSO composition, card rendering, authorization and database options are unchanged.

## Finding and change

With `AUTO_CLOSE OFF`, a direct card-service profile measured the first SQL source read at 707 ms, followed by source reads around 22–63 ms. The development API client retired every PowerShell helper after only five idle seconds. A user pausing to inspect a card or fill a form could repeatedly pay that process-start cost.

`LocalDevelopmentApiClient` now retains **one** idle helper for up to **90 seconds** after its last response. Extra helpers from concurrent work still retire after five seconds, and the existing maximum of four helpers is unchanged. No helper is started speculatively. An idle helper remains unreferenced so it does not keep a CLI process alive.

Each procedure call still opens a fresh unpooled SQL connection, creates its own disposable execute-only principal, applies the existing procedure/role allowlists and SQL authorization, then reverts/drops the principal and disposes the connection. Keeping the helper alive retains executable/runtime state, not an authenticated SQL connection or a cached authorization decision.

The PowerShell loop releases its previous input/result references after writing each response. This does not promise immediate erasure of immutable managed strings. No new result, photo, rendered-card or QR cache is introduced.

The client now has explicit shutdown: closing rejects active/waiting calls, destroys its helpers and prevents later spawning. The local server invokes it during graceful shutdown/listener failure. Destroying a worker is idempotent; late error/close/output events cannot destroy it twice or affect its replacement. Failed calls are not replayed.

## Measurement

The same retained employee card was requested four times per run through the browser, with **6.5 seconds between requests**. The first sample is listed separately because key/process/font/cache warm-up differed between runs. The comparison of samples 2–4 measures the repeated browsing pause this batch targets.

| Complete card-image response | Before | After |
| --- | ---: | ---: |
| Requests after a 6.5-second pause | 1,226 / 1,213 / 1,248 ms | 266 / 214 / 171 ms |
| Median after the pause | **1,226 ms** | **214 ms** |
| First image in the run | 2,130 ms | 1,257 ms |
| PNG bytes | 135,397 | 135,397 |
| JSON response bytes | 180,638 | 180,638 |

The observed pause-case median is approximately **83% lower**. This is a small local test, not a production guarantee or load test. It does not establish an improvement to a completely cold first request or to already-warm consecutive requests. After 90 idle seconds, startup cost returns; after the QR key cache expires, protected-key recovery may also add delay.

There is no additional dependency or service/API charge. The tradeoff is retaining one PowerShell process longer. One observed helper working-set snapshot was about **116 MiB**, including shared pages; it is not a measurement of incremental private memory. Burst helpers are released quickly to limit sustained resource use.

Duration/status/size evidence is in ignored `output/card-optimization-4/idle-before.json`, `idle-after.json` and `stages-before.json`. No card images, private photos, raw QR values or session cookies are saved in these reports.

## Verification

Follow-up: [phase 5](Performance_Optimization_Phase_5.md) measures cold key/helper stages and reduces opaque card PNG size while preserving every decoded pixel. It makes no claim of reduced cold latency.

Five new lifecycle tests cover pause reuse/renewed expiry, four-worker capacity and waiting requests, fast burst retirement, explicit shutdown, late events/no replay, and fresh environment/procedure guards. The complete unit suite passes **503 tests with one existing skip and zero failures**. Seven focused browser cases pass for card loading/retry, participant binding, employee photo review and guard dashboard/filter/language/profile behavior. TypeScript, targeted ESLint, PowerShell parsing and whitespace checks pass.

All retained presentation records/photos/history remain available. No email worker is started or email sent. Changes remain local; no commit or push.

The remaining cold request needs separate protected-key and rasterizer measurements. Extending helper lifetime does not replace those measurements or remove the final fresh card-source authorization check.
