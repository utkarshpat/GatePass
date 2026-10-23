# Regional name readings on guard cards

Guard cards keep the original English visitor/employee name first and show a pronunciation-oriented regional reading beside it in brackets with an asterisk, for example `Rohan Mehta (रोहन मेहता) *`. Both are inline and wrap naturally when space is limited. Host names receive the same treatment. Hovering the regional reading or its asterisk shows a native tooltip in English and the selected regional language: “Reading aid; pronunciation may be inaccurate.” The persistent footnote has been removed. English-only mode restores the original names. Hindi, Kannada, Tamil and Marathi are supported. Guest forms, stored identities, search, approvals and access checks continue to use their existing values.

Fixed guard labels use familiar spoken terms such as प्रोजेक्ट, होस्ट, कॉमन एरिया and ड्यूटी, with corresponding loan words in the other three dictionaries. These labels are bundled with the page and need no online conversion. Project names remain their canonical values.

## Free, optional provider

The current development adapter uses Google Input Tools' public `inputtools.google.com/request` endpoint. It does not use the paid Google Cloud Translation API, an API key, a billing account, a downloaded model, Python or an additional npm dependency. There is no paid-provider fallback. Google documents [phonetic transliteration](https://www.google.com/inputtools/services/features/transliteration.html) and [support for all four languages](https://www.google.com/inputtools/help/languages.html).

**The public endpoint is undocumented as an application API.** Its continued availability, permitted deployment usage, quotas and service level must not be assumed from the consumer Input Tools feature. Keep it an optional demonstration aid; a production rollout needs a supported provider agreement or a reviewed self-hosted alternative. Google Cloud's separately documented transliteration feature has a different language list and billing setup; do not conflate it with Input Tools.

English spelling does not uniquely encode pronunciation. A returned candidate is not a verified native spelling or an identity match. Initials, foreign names and uncommon spellings especially need native-reader review. For example, the observed Hindi first suggestion for `Ananya Rao` was `अनन्य रओ`; `Rao` alone had `राव` as a later candidate. The asterisk explicitly marks this uncertainty. Always keep the original name and photo available. No accuracy percentage is claimed.

## Enable or disable locally

This feature is disabled unless explicitly configured. For one server session, set `GATEPASS_NAME_READINGS=google-input-tools` before starting the development server. Set it to `off` to override any saved opt-in.

For a persistent local opt-in, place this non-secret JSON in `%USERPROFILE%\.gatepass\private-v1\guard-name-readings.json`:

```json
{"provider":"google-input-tools"}
```

Restart the development server after changing the setting. Missing/invalid settings leave names in English. Tests ignore the saved local setting. The production API composition does not automatically enable this development route/provider.

## Performance and boundaries

- Cards and lazy photos render independently; name readings load in the background for cards near the viewport, prefetching 600 pixels ahead. Scroll/resize loads later cards without converting the whole roster or repeatedly evicting a large roster from the bounded cache. Switching languages and filters does not wait for a reading or permit an old response to repaint the wrong language.
- The browser submits batches of at most ten names through a same-origin, CSRF-protected staff POST. The server verifies the staff session and current guard workspace access before any cached transformation. The endpoint transforms submitted text; it never searches the directory or returns assignments.
- Only person/host name text is sent to Google. Photos, email addresses, pass identifiers, visit details and credentials are not sent. Do not log provider URLs or request bodies, since the provider uses a query string.
- Duplicate normalized name/language requests share one in-flight operation. Server cache: at most 2,000 entries, successful readings for 24 hours, failed readings for one minute. Browser cache: at most 1,000 entries in tab memory. Names are not saved to localStorage, a service worker or a new database table.
- At most two provider requests run concurrently, with at most 40 outstanding unique transformations. Queued work expires before starting after 12 seconds; each fetch has a five-second timeout. Each staff session is limited to 30 batches per minute. Responses are bounded to 32 KiB and checked for the expected echoed source, target script and safe text.
- Disabled provider, timeout, throttling, malformed output or an outage leaves the original English name visible. Card details and access operations remain available. There are no automatic paid upgrades, retries to a paid provider or cloud resources created by this feature.

## Validation on 23 October 2026

`node tools/preview-name-readings.ts` exercises 50 synthetic names across all four languages. The observed run returned 200 candidates from 200 provider calls. This measures candidate availability, not pronunciation correctness.

| Language | First pass, 50 names | Cached pass, 50 names | Cached external calls |
| --- | ---: | ---: | ---: |
| Hindi | 7,936 ms | 0.30 ms | 0 |
| Kannada | 10,252 ms | 0.20 ms | 0 |
| Tamil | 5,323 ms | 0.47 ms | 0 |
| Marathi | 7,371 ms | 0.19 ms | 0 |

These are service-level timings from this machine/network, not end-to-end card loading benchmarks or guaranteed API latency. Results, including initial/foreign-name candidates, are written to ignored `output/name-readings/synthetic-benchmark.json` for review.

Unit coverage checks coalescing, expiry, language separation, bounds, concurrency, current access before cache use, throttling, malformed responses and fallback. Browser coverage checks background loading, original-name references, both person/host readings, language races, English restoration, outages, mobile wrapping and the existing allocation workflow.
