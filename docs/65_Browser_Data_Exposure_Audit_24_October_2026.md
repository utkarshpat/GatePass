# Browser and network data exposure audit — 24 October 2026

> This report preserves the initial audit and authorized-fix snapshots. For the later complete regression run, dependency fix, retained demo additions and source push, see [final 24 October verification](67_Final_Browser_Verification_And_Presentation.md).

Initial audited application revision: `62297b8`, running at `http://localhost:8443` on the loopback-only development host. The initial review was read-only; the subsequently authorized fixes and their validation are recorded at the end. No retained business records, photos or presentation history were changed or deleted. Audit sign-ins/sign-outs created normal session/audit activity. No mail worker or email delivery was started.

**Initial result:** no critical/high-severity exposure was demonstrated in the tested paths. Three development/hardening findings were reproduced and subsequently fixed locally. This is a bounded local audit, not a production penetration-test certificate.

## Reproduced findings

| Finding | Priority and scope | Evidence | Recommended action |
| --- | --- | --- | --- |
| Anonymous dummy employee-directory endpoint | Low in the current synthetic, loopback-only deployment; review before any shared deployment | An unsigned same-origin `POST /api/dev/sso/employees` returned HTTP 200 and 23 employee profiles, including names, synthetic email addresses, manager and project relationships. All returned IDs/emails met the mock `EMP…` / `@example.com` restrictions. | Remove the unused browser-facing list route, or restrict it to an explicit authenticated development-picker capability. Do not connect this dummy surface to a real directory or publish the development runner. |
| Exchanged email-link capabilities remain in a parsed JavaScript object | Low; unnecessary same-tab secret lifetime | Controlled **synthetic** link exchange cleared the address-bar fragment and the `bearer`/`revokeLink` variables, but the top-level `fragment` object still contained its `link` and `revoke` parameters. Reproduction inspected presence booleans only. | Delete both parameters after a successful exchange; release them on page exit as well. Preserve retry behavior only while an exchange is genuinely pending/failed. |
| Failed email sign-in leaves its attempted password in the field | Low; password-field hygiene | An unsuccessful sign-in on `/approval/<synthetic-id>` left a nonempty `#password` field. The main staff sign-in already clears its field on success/failure. | Clear the email-page password on failure and page exit; retain only non-secret form fields. |

Code references: `src/development/DummySsoRoutes.ts` (public list branch), `src/development/DummyEmployeeSso.ts` (environment/profile restrictions), and `src/app/email-request.js` (parsed fragment and sign-in lifecycle).

The two email-page findings do **not** establish a remote authentication bypass or a cross-user leak. The person controlling a browser can already inspect what they type and a link they open. Clearing unnecessary copies reduces exposure time if that tab is later accessible or another same-origin vulnerability exists. HttpOnly cookies do not make the user's own DevTools inaccessible.

## Deployment and privacy boundaries

1. **Current host is HTTP development software.** Browser inspection confirmed staff session cookies have `HttpOnly` and `SameSite=Strict`, but not `Secure`; the listener is bound to `127.0.0.1` and API requests enforce exact Host/Origin/loopback checks. This runner also intentionally accepts documented synthetic fixture credentials. It must not become an internet/LAN/tunnel deployment with real identities. The separate production starter uses HTTPS with TLS 1.2 minimum and rejects dummy authentication; production cookie/TLS paths were inspected in source/unit coverage, not exercised against a deployed HTTPS site in this audit. Keep HTTPS and Secure cookies mandatory for a shared deployment. See [OWASP REST Security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html).
2. **Regional name readings have an optional external data flow.** When the explicitly opted-in Google Input Tools adapter is enabled, the server sends person/host **name text** to Google. Browser Network's same-origin-only result does not imply the server makes no external requests. Photos, email addresses, pass identifiers and credentials are not part of that provider request. The public Input Tools endpoint is not a supported contractual application API; real deployment needs a reviewed provider/privacy decision. Existing details and configuration: [Guard name readings](Guard_Name_Readings.md).
3. **Public visitor registration intentionally exposes a bounded host picker.** Source inspection shows office/project-scoped options, a minimum two-character search and at most ten host results with name, employee ID and official email. This supports host selection; it is still directory information that a person using the public registration flow can see. It is separate from the unused full dummy-directory route above. If real-directory email visibility is not acceptable, change the picker contract/display policy before rollout. This public-picker behavior was source-reviewed, not exhaustively enumerated against live data.
4. **Authorized register/contact/photo information is visible to its viewer.** Server authorization is the boundary; hiding a column in the UI cannot keep a field secret once its response has been delivered. IDs, role/capability labels, snapshot hashes and public pass references are not authority by themselves. A valid permission check must precede every sensitive read/action.

## Browser and API checks

Installed Chrome was driven with isolated Playwright browser contexts against the existing local server. The probe collected endpoint paths, status codes, field names, cookie **attributes**, counts and boolean findings. It did not save cookie values, passwords, signed proofs, private image bytes, full response payloads, screenshots, traces or HAR files.

There were **47 explicit browser-audit checks: 44 passed and 3 reproduced the findings above**. The first probe observed 54 page API responses, including its explicitly mocked email-link lifecycle case; this is not a count of unique endpoints or an assertion that every response in the application was inspected. A second probe exercised eight checks using an existing retained visit and photo.

| Area | Observed result |
| --- | --- |
| Public source/config probes | `.env`, `.git/config`, package/source files, a traversal-style path, source map, Swagger and debug probes were denied with generic JSON errors; no private file content was served. |
| Anonymous protected reads | Staff/admin/guard/reception/employee/email/photo probes returned generic rejection responses. Some reject invalid input before authentication; that does not authorize a read. |
| Staff session cookies | All three tested workspaces used HttpOnly session cookies; `document.cookie` exposed the CSRF cookie, not the session cookie. CSRF token visibility is intentional. |
| Browser persistence | Guard/admin/reception contexts had no local/session storage data at inspection and no IndexedDB databases. CacheStorage held only six allowlisted public PWA/offline assets. The mocked external-link page stored only a non-secret view hint. |
| Authenticated reads | Valid guard/admin/reception sessions could read their respective authorized context. |
| CSRF and origin | Missing CSRF was denied for each workspace. A foreign Origin was denied without an allow-origin CORS response. |
| Role and duty fencing | Guard could not read admin/reception contexts. Forged office/duty identifiers were denied. |
| Existing object authorization | India admin could read an existing Noida visit. Bengaluru location admin was denied that same visit and the Noida register. This used a known existing object, not only a random nonexistent UUID. |
| Photos | Noida reception could read the retained photo, receiving only `mimeType` and `imageBase64` with `Cache-Control: no-store`. An anonymous request for the **same** photo was denied. Unknown visit-photo probes were also denied. |
| Logout | Each tested role's captured cookie was rejected after its audit session logged out. No existing user session was intentionally logged out. |
| Error/SQL disclosure | Invalid register sort input containing SQL syntax was rejected with HTTP 400 and a generic error. Protected denials did not return SQL, stack traces or filesystem paths. |
| Response minimization | Observed page JSON schemas contained none of the checked session-token/password-hash/storage-key/private-key/connection-string/stack/intake-secret fields. This schema scan supplements source review; it is not a general-purpose secret classifier. |
| HTTP caching | Observed actual API responses were `no-store`. The two synthetic email-route mock responses intentionally lacked real server headers and were excluded from that claim. |
| HTML policy | Login shell had nonce-based CSP without `unsafe-inline`/`unsafe-eval`, `no-store`, `nosniff` and `no-referrer`. |
| Browser external requests | No third-party HTTP origin appeared in the exercised browser flows. Server-side name-provider traffic is a separate boundary, described above. |
| Console | No unhandled page JavaScript errors. Supplemental real-object checks found no observed cookie values, fixture password or checked server-secret/path patterns in console messages. Intentional 401/403 probes generated expected browser resource-error messages; those are not application secret logs. |

Source review also found no application `console.*` logging in the inspected app scripts. The inspected HTML insertion sites used constant icon SVG; names and visit text use DOM text APIs. This was not an exhaustive stored-XSS fuzzing exercise. Print/manual-registration messages check same origin and expected window source; private API traffic is excluded from service-worker caching.

## Additional verification

- **104 targeted automated security tests passed**, zero failures/skips: loopback HTTP, main HTTP API, registration HTTP, email revocation, private storage, dummy SSO, visit reads and workspace event routes. These include malformed request/authentication/error-redaction/private-storage checks; they are separate from the 47 live browser-audit checks.
- Gitleaks scanned **34 commits, approximately 10.74 MB**, with full redaction enabled: no findings.
- `npm audit --omit=dev --json`: **zero known production-dependency advisories** at audit time. This is registry-advisory coverage, not proof of an absence of vulnerable code; development dependencies were outside this invocation.
- Existing listener remained on loopback port 8443; no runtime restart was needed for the audit.

Local sanitized evidence is in ignored `output/browser-exposure-audit/`: `results.json`, `cross-scope-results.json`, `security-unit-tests.log`, `secret-scan.log` and `dependency-audit.json`. The scripts are also retained there for rerunning; evidence is intentionally not committed with application data.

## What seeing something in Inspect means

Frontend HTML/JavaScript/CSS, authorized JSON fields and displayed images must reach the browser to work. The browser owner can inspect them. They can also inspect their own outgoing login request and cookies through DevTools even when JavaScript cannot read HttpOnly cookies. HTTPS protects transport; it does not conceal a request from its own sender. Do not share an unsanitized Network export or screenshots containing session/capability values.

The security requirement is to avoid sending information to an unauthorized browser, keep secrets out of persistent web storage/logs/public assets, and recheck server-side authorization. The observed HttpOnly/session-storage approach follows the direction of [OWASP HTML5 Security](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html); actual authorization evidence is recorded above.

## Remaining coverage limits

No production/reverse-proxy/TLS deployment, live identity provider, Outlook connector infrastructure, corporate browser extensions, other users' devices, OS compromise, exhaustive endpoint/role matrix, rate-limit load test or concurrent role-revocation race was newly penetration-tested here. Existing targeted tests cover some of these application boundaries, but do not replace deployment testing. Email capability memory reproduction used synthetic intercepted responses; no real recipient link or production email was accessed or sent.

At the end of the initial review, application code was unchanged and all three findings remained open. The following work was then explicitly authorized by the user.

## Authorized fixes and revalidation — 24 October 2026

All three reproduced findings are **fixed in the local working tree**:

- Removed `/api/dev/sso/employees` from the route allowlist and removed its full-directory response. It returns 404 both anonymously and after employee sign-in. Server-side email login resolution remains available; the public visitor picker retains its existing office/project scope. SQL integration fixtures now obtain synthetic account profiles directly from the internal provider or fixture file.
- Deleted `link` and `revoke` from the parsed fragment immediately after extracting the pending exchange values. Successful exchange still clears those pending variables and the address-bar fragment. Page exit also clears pending variables. A failed exchange can retry while the page is open; restoring its failed-link history entry reloads from the existing fragment instead of keeping proof variables in the suspended page. This does not claim to erase a request already visible in DevTools or overwrite immutable strings inside the JavaScript engine.
- Email sign-in clears the DOM password as soon as the request starts, and again on completion/failure and page exit. Tests cover incorrect credentials, service failure, network failure and an actual simulated 30-second timeout. Host sign-in, explicit approval/revocation, cookie isolation and refresh remain working.

Validation:

- **66 targeted unit tests passed**, zero failures/skips: dummy SSO, email workflow/revocation, registration HTTP and loopback HTTP. The new directory regression failed against the original implementation before the fix.
- **21 browser tests passed** in one final run: the complete email-status and email-revocation files, including seven new regression cases and an existing real SQL visitor-link/revocation case. The failed-password browser regression also failed against the original implementation. An initial capability-test fixture incorrectly combined denied status with revoked pass status; its expected business state was corrected before the final green run.
- The original live browser probe was rerun against the restarted main server: **39/39 checks passed**, including all three formerly failing checks, with no unhandled page errors. Its synthetic lifecycle mock remains clearly separate from real endpoint authorization evidence.
- The supplemental retained-visit/photo probe also passed **8/8 checks**, for **47/47 total rerun audit checks**. An initial supplemental rerun encountered a connection reset while opening another isolated context; the final probe releases each role's session/context before opening the next. The application's connection limits were unchanged.
- Full repository ESLint and TypeScript checks passed. Existing CRLF/mixed file endings were preserved; Git diff whitespace verification treats CR as a line ending.

The main development listener was restarted with the fixes at port 8443. Development sessions from before that restart require signing in again. No database migration, dependency, paid service, email send, commit or push was added. Existing presentation data remains available. Deployment/privacy boundaries and coverage limits above still apply.

Final evidence: `output/browser-exposure-audit/fix-unit.log`, `fix-browser.log`, `fix-lint.log`, `fix-typecheck.log` and the rerun `results.json`. Original audit evidence is preserved as `before-fix-results.json` and `before-fix-cross-scope-results.json`.
