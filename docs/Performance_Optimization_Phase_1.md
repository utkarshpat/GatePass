# Digital-card performance: first implementation batch

Implemented locally on 23 October 2026 after the performance findings review. Earlier optimized brand assets and guard display changes remain in the working tree. This batch adds no dependencies, paid services, database migrations or SQL indexes.

## Result and measurement limits

The same retained employee Digital ID was downloaded read-only five times before and five times after reloading the development server. The local Windows machine, database, card dimensions and PNG byte count were unchanged.

| Measurement | Before | After |
| --- | ---: | ---: |
| Median complete image response, five samples | 2,561 ms | 1,640 ms |
| First sample | 4,094 ms | 3,854 ms |
| Remaining four samples, range | 2,428–3,832 ms | 1,520–1,819 ms |
| PNG bytes | 135,397 | 135,397 |
| JSON response bytes | 180,638 | 180,638 |

The observed median reduction is approximately **36%**. This is a small local comparison with a server restart, font/worker warm-up and background machine activity, not an isolated production benchmark or a latency guarantee. It measures the image endpoint; removing an earlier blocking browser detail request gives a separate benefit not included in these timings. The first request still takes several seconds.

Ignored raw evidence: `output/card-optimization-before.json`, `output/card-optimization-after.json` and `output/card-optimization/key-cache.json`. No QR credentials, decrypted keys, card images or photo bytes are written to these timing reports.

## Changes

### Reuse recently unwrapped QR keys

`FileQrKeySource` retains at most eight decrypted key versions in process memory for at most 60 seconds. Each caller receives an independent buffer. Concurrent reads of the same protected blob share its unprotect operation. Cached plaintext is zeroed on expiry, eviction and explicit clearing; temporary unprotected buffers are also wiped. There is no disk plaintext cache. Setting `cacheTtlMs: 0` disables reuse for diagnostics.

Every resolve still reads the protected record through `PrivateDirectory`, checking the private path/file boundary, schema, version, protection scheme and protected bytes. A SHA-256 fingerprint selects a matching cache entry. Missing, malformed or changed records invalidate the entry. A waiter rereads the file after unprotect completes, preventing a removed/changed file from being hidden by pending work. The active-key manifest is not cached, so rotation is observed on later active-key reads and existing key versions retain their normal recovery behavior.

A separate synthetic Windows DPAPI experiment compared the cache options against the same protected test key. Three disabled-cache resolves took 845.20, 859.78 and 835.58 ms and invoked unprotect three times. An enabled cold resolve took 820.97 ms; three warm resolves took 0.03, 0.11 and 0.04 ms and invoked unprotect zero times. That microbenchmark uses an in-memory protected record and excludes real vault filesystem checks; the HTTP comparison above includes them.

### Remove a discarded Digital ID detail request

The registration success path previously awaited `/api/employee/digital-id/detail`, computed status/validity elements and then removed those elements to display the card image. It now requests the authorized image as soon as creation is confirmed, without this unused blocking HTTP call. The detail endpoint remains available for consumers that need it.

A job shares one pending image promise across repeated result rendering. Failed prefetches are handled without unhandled rejections or an automatic duplicate request; the visible Retry card action starts a fresh attempt. After decoding to the existing blob URL, the promise is released to avoid retaining its base64 response. Detached/replaced result containers do not receive late image content.

The server's card source read before rendering, ownership/scope checks, photo hash checks and final source/authorization reread are unchanged. Rendered cards, photos, raw QR credentials and approval decisions are not placed in a new server cache.

### Combine concurrent development SSO inspections

Requests using the same valid employee session can share an SQL inspection that is currently in progress. Once it finishes, the next request performs a fresh inspection. There is no TTL cache of authentication or directory results. CSRF/provenance is checked before sharing, and local session provenance/expiry is checked again after the wait. Logout or closing the provider cannot revive a session through a late result. Each consumer receives its own profile copy.

This change applies to the explicitly selected dummy development provider. Production SSO does not import that provider and is not claimed to have received the same improvement.

## Verification

Tests cover cache expiry/capacity, independent buffers, duplicate unprotect work, protected-file deletion/tampering/change, deletion during unprotect, disabled caching, key rotation and actual Windows DPAPI recovery. Session tests cover simultaneous reads, a fresh later SQL check and logout during an inspection. Existing own-card tests retain initial denial, final changed-pass rejection and tampered-photo/path checks.

Browser cases cover duplicate rendering, one downloadable blob, explicit retry after prefetch failure, one submission/image request without the discarded detail call, participant binding, employee camera/review and guard login/profile workflows. No presentation records are deleted, no real email is sent and benchmark downloads do not change pass state.

Final validation: the complete unit suite passed 489 tests with one skip and no failures, with the existing Sharp runtime configured for real image/QR decoding. Nine relevant browser cases passed across the focused runs. TypeScript checks, targeted ESLint and `git diff --check` passed. An older project-summary assertion was updated to the already-requested separate person/host/project presentation; no guard behavior was reverted to satisfy the old assertion.

## Next measurements

Follow-up completed in [phase 2](Performance_Optimization_Phase_2.md): stage profiling identified dummy SSO helper startup as a major delay, followed by bounded helper reuse and a separate before/after HTTP comparison.

The remaining cold delay needs stage timings around development SSO process creation, restricted SQL worker/principal setup, protected-file validation and rasterizer/font warm-up. The first request and steady-state requests must be reported separately.

Query/index changes remain findings until the actual plan and logical reads identify the responsible operator. Candidate report/export/history queries, bulk endpoints and a protected persistent cache for optional regional name readings are later batches; they are not implemented by this change. Existing HTTP `no-store` protection remains in place for personal/pass data.
