# Digital-card performance: smaller opaque PNGs and cold-stage evidence

Implemented locally on 23 October 2026 after [phase 4](Performance_Optimization_Phase_4.md). This is a modest payload improvement. **It does not resolve cold first-card latency.**

## Cold-stage finding

A direct-service profile explicitly cleared the process key cache before the first image. That first sample spent 1,384 ms in the initial SQL helper/source read, 582 ms resolving the protected QR key, and 90 ms rasterizing; total time was 2,451 ms. Later samples had 3 ms key reads and 64–69 ms rasterization. Another verification run measured 820 ms for cold key recovery. These are local samples affected by process and machine state, not guaranteed stage costs.

The key recovery still uses the original one-shot Windows DPAPI helper. This batch does not extend plaintext-key cache lifetime, add another persistent process, decrypt before authorization or remove either authorized card-source read. Reducing that cold cost needs a separate helper/lifecycle design.

## Change

`PassCardRenderer` paints an opaque white card, but the old download pipeline encoded an unnecessary alpha channel. Added `src/printing/CardPngRasterizer.ts` to render the same 1712 × 1080 PNG with that channel removed, using the existing Sharp dependency and existing default PNG compression.

The local employee Digital ID, reception preview, employee request and visitor email-card compositions now use this shared rasterizer. Transparent source photos and brand assets are unchanged; only the completed opaque card PNG is affected. SVG printing and production composition are unchanged.

## Byte and pixel evidence

| Retained employee card | Before | After |
| --- | ---: | ---: |
| PNG bytes | 135,397 | 129,576 |
| JSON response bytes | 180,638 | 172,874 |
| Dimensions | 1712 × 1080 | 1712 × 1080 |
| Decoded RGBA pixels | Original | Every pixel identical |

The measured PNG/response saving is approximately **4.3%** for this retained demo card. A synthetic textured photo produced a larger PNG saving, from 371,318 to 323,846 bytes (about 13%); photo content affects the result. No palette reduction, lossy photo conversion or lower-resolution QR is used.

Five real authorized source/render comparisons retained only byte counts and a pixel-equality boolean; every comparison passed. Photos/cards, decoded pixels and QR values were held transiently and not written to the benchmark reports.

Alternative PNG compression levels/filtering were measured first. Faster compression enlarged the synthetic image, and adaptive filtering increased CPU time for that sample, so those settings were not adopted. The default compression level remains unchanged.

## Latency limits

Five local HTTP requests measured median 176 ms before and 212 ms after, with first requests 1,516 and 1,552 ms. These runs were not isolated for background load, process/key warm-up or restart effects; **no HTTP latency gain is claimed**. In an alternating same-SVG raster test, 16 old/new samples had medians approximately 97.5 and 99 ms, respectively. The reliable improvement here is fewer bytes with identical decoded pixels, not a faster renderer or cold start.

Ignored evidence under `output/card-optimization-5/` includes `stages-before.json`, `real-card-pixel-check.json`, `synthetic-png-options.json`, `synthetic-opaque-options.json`, `real-raster-comparison.json`, `http-before.json` and `http-after.json`.

## Verification

Follow-up: [phase 6](Performance_Optimization_Phase_6.md) reduces hidden admin-tab requests and coalesces pending lead previews/dialog reads. It does not alter card rendering or cold-key recovery.

New tests compare every decoded pixel against the previous pipeline for both JPEG and translucent PNG photos, and check PNG dimensions, RGB channels and alpha absence. Independent QR decoding uses the exact optimized download pipeline for approved Digital ID, approved employee-project and pending visitor cards. Existing initial/final authorization, photo/hash, source-change and printing tests remain applicable.

The complete unit suite passes **505 tests with one existing skip and zero failures**. All seven focused browser cases pass. TypeScript, targeted ESLint and whitespace checks pass. No retained passes, photos, history or outbox data are deleted; no email worker is started and no email is sent. No dependency or paid service is added. No commit or push.

Next: target process-start/DPAPI cold cost with measured lifecycle and resource bounds. Keep the existing filesystem checks, per-request authorization and final source reread.
