# Final browser verification and retained presentation data

Run date: **24 October 2026 (Asia/Calcutta)**. This report follows the requested complete browser rehearsal, preservation of realistic demo data, documentation refresh and final source push. Local development URL: **http://localhost:8443**.

## Presentation walkthrough

Use separate browser profiles/private windows for each role. Local synthetic staff/employee fixture password: `Sopra@123`. The original populated rehearsal is dated **23 October 2026**; newer live workflows are dated **24 October 2026**. If presenting on a later day, use those dates in **History** and **Visit register**. Expiry preserves historical decisions, photos, movements and audits; old passes are not silently renewed.

| Surface | Login / entry | What to demonstrate |
| --- | --- | --- |
| Public offices | `/office/noida`, `/office/bengaluru`, `/office/chennai`, `/office/pune` | Office-specific Employee / Visitor choices, form stages, company/devices, individual/group registration, host selection, photo and review. |
| Employee | `employee2@example.com` through office Employee entry | Bound employee details, Digital ID, photo/crop, card and independent project requests. Employee 1's retained cross-office request remains in history. |
| Assigned host | `employee19@example.com` at the corresponding `/approval/<visitRequestId>` | Details and explicit Approve / Reject. Opening a link alone does not decide the request. |
| Reception | `reception1@example.com` | Today counters/filters, lookup, card preview, print/reprint handoff, manual registration, **History** date range, returns/device checklist and audited correction. |
| Guard | `gaurd1@example.com` (existing fixture spelling) | Project 1 / common-area duties, Expected / Inside, language/profile, pass lookup, Entry / Exit and movement timeline. Project movements require a project duty. |
| Noida admin | `admin2@example.com` | All seven modules: Overview, Projects & areas, Users & permissions, Guard assignments, Offices & QR, Visit register, Audit log. |
| India admin | `admin1@example.com` | Authorized office switching and scope differences. A project admin's permissions are narrower than a location admin's. |

For the original populated register, choose **Noida → Project 1**, set both Visit register dates to **23 October 2026**, and apply. Show name sorting, columns, a visitor detail/timeline and Excel export. For office-wide totals, clear the project filter. Reception's separate **History** dialog accepts the historical date range; its dashboard date is server-selected today.

Retained examples include **Aarav Sharma** (entry/exit and returned pass), **Meera Iyer** (recorded project presence), **Rohan Mehta** (approved), **Ananya Rao** (pending), **Kabir Sethi** (declined), and **Priya Nair** (return/correction audit). **Neha Kulkarni / Orion Business Services** has a 24 October approval and entry/exit timeline. Group bookings, assisted registrations, Digital IDs and **Digital Workplace Transformation · DWT-NOI** remain available. Exact current states depend on subsequent authorized demo actions.

New records retained by this automation:

| Person / company | Visit date | Verified state |
| --- | --- | --- |
| Aditya Shah / Cedarbridge Consulting | 24 October 2026 | Actual visitor submission, assigned-host approval, guard Entry and Exit; two movement events, photo/history retained. |
| Kavya Menon / Vertex Digital Solutions | 25 October 2026 | Future booking, explicitly approved by the assigned host; available for tomorrow's valid-day guard demonstration. |
| Rahul Khanna / Northstar Consulting | 25 October 2026 | Future booking, left pending; assigned host can demonstrate an explicit decision tomorrow. |

The new visitors use synthetic camera frames, realistic fictional names/companies, fixture phone numbers and `example.invalid` contact email addresses. No external mail is sent. Their normal application notification records may be queued. Kavya and Rahul were created through the actual public browser form, not inserted directly into SQL.

For tomorrow's host demonstration, open [Rahul's pending approval](http://localhost:8443/approval/897cd0e3-ecac-4d30-8e01-d3a1881b2595) in a separate browser context and sign in as `employee19@example.com`. [Kavya's approved request](http://localhost:8443/approval/e81079a1-7179-458b-8405-c42ee2d6c655) shows the completed decision. These are ordinary request IDs, not signed holder capabilities; server-side host authentication still applies. The local IDs are also retained in `output/automation-final-24-oct/future-bookings.json`.

The original request/pass references and completed checkpoints are in ignored `output/presentation/manifest.json`. Private signed holder links are in `%USERPROFILE%/.gatepass/presentation-2026-10-23/holder-links.html`; their capability fragments must stay outside Git. A source push does not transfer the local SQL database, private photos or signing keys to another machine.

## Validation and fixes

Full-browser coverage includes real SQL journeys and controlled intercepted UI/failure fixtures; a green suite is not a claim that every possible device or concurrency schedule was tested.

| Verification on 24 October | Final result |
| --- | --- |
| Full Chromium/Axe suite after clean dependency install | **132 passed, 0 failed/skipped**, 37 spec files, **368.9 seconds**; retained presentation test explicitly enabled. The earlier fresh run also passed all 132 before the dependency refresh. |
| Final unit/contract suite and coverage gate | **520 passed, 1 expected platform skip, 0 failed**. Coverage: **97.03% lines, 89.53% branches, 93.85% functions**. The first unconfigured unit invocation failed because the required Sharp path was absent; both configured coverage runs passed. |
| Changed HTTP/SQL integration harnesses | **11 dummy SSO + 25 public/employee registration cases passed**, including actual SQL artifacts, group decisions, private card QR decoding and signed holder/host browser pages. Only owned disposable fixtures cleaned. |
| SQL → API count reconciliation | **57 scope/date combinations, 456 numeric comparisons**, all matched: four canonical offices, active seeded DEMO project allocations and retained locally managed DWT-NOI, across **23–25 October**. Four office UI Registered/donut totals also matched. Taken after regression fixture cleanup. |
| Retained Chrome + Edge workflow | **8 assertions passed**: Aditya submitted, assigned host approved, guard entered/exited, timeline contains exactly two events, and independent admin/guard counters changed once per action. Submission click → independent guard card **2,163 ms** without manual refresh; one local measurement, not a performance guarantee. |
| Future bookings | Kavya's **25 October Approved** and Rahul's **25 October Pending** requests created and verified through real browser forms/host pages; both retained. |
| Reception KPIs/history and actual Excel | **5 assertions passed**. Noida Today: 7 registered, 4 actionable pending, 0 matching inside, 12 office-wide pending returns. Historical 23 October: 43 registrations. Export **23–25 October**: **52 data rows + header**, 52 unique request references, exact SQL total; two authenticated export pages of **50 + 2** rows. |
| Network/Inspect and real-object authorization | **39 + 8 = 47 checks passed**, no open findings or unhandled page JavaScript errors. Expected denied probes produce browser resource errors. Rechecked scoped retained visit/photo authorization, anonymous denial, CSRF/Origin, persistence and password/proof handling. Synthetic email lifecycle responses remain separate from real authorization evidence. |
| Dependency and static gates | Clean `npm ci --ignore-scripts` succeeded; installed-tree npm audit **zero advisories**. Patched dependency import/API constructor smoke passed without requesting Azure tokens. TypeScript, ESLint, all **90 migration hashes**, CRLF-aware whitespace checks and redacted staged/history secret scans passed. |

The initial supplemental export probe assumed a single API page because the earlier dataset had 49 records. With 52 records, the application correctly downloaded both pages; the probe's first-response-only assertion failed. The corrected probe collects both responses and independently checks unique references in the actual workbook XML. No application change or data deletion was needed.

Noida office-wide retained snapshot after the additive workflows:

| Date | Registered | Pending | Approved | Denied | Cancelled |
| --- | ---: | ---: | ---: | ---: | ---: |
| 23 October | 43 | 13 | 24 | 4 | 2 |
| 24 October | 7 | 4 | 3 | 0 | 0 |
| 25 October | 2 | 1 | 1 | 0 | 0 |

Numbers are snapshots, not permanent seed expectations. Current presence is independent of historical date filters; reception's matching Inside count differs from office/project presence and its Pending return count spans history. See [count definitions](66_Final_E2E_Counts_And_Edge_Cases_24_October_2026.md).

Application changes included in this release correct:

- Admin Registered/chart totals now include Cancelled; the existing four summary tiles stay aligned with register totals, and the charts expose all four statuses.
- Guard All allocations deduplicates overlapping duty choices while preserving distinct visit records.
- Re-enabled public-form buttons have readable contrast immediately, without disabled-color interpolation.
- The full dummy employee directory endpoint is removed. Email capability parsing no longer keeps an extra parsed proof copy; pending proof/password fields are cleared on page exit, and sign-in clears the DOM password immediately even when a request fails.
- The fresh dependency audit identified nested `@azure/msal-node@6.0.1` under `@azure/identity`, despite the direct dependency already being patched. An npm override resolves all MSAL Node consumers to the existing exact **7.1.0** dependency and removes the nested vulnerable copy from the lockfile. [Microsoft's advisory](https://github.com/AzureAD/microsoft-authentication-library-for-js/security/advisories/GHSA-xcx6-jx8p-x3h5) identifies 7.1.0 as patched for CVE-2026-109461. The override crosses Azure Identity's declared MSAL major range; the package/API import smoke and local regression results do not establish real Azure tenant/SQL authentication acceptance, which remains a deployment check. Revisit the override when Azure Identity publishes a compatible patched dependency range.
- The public/employee HTTP/SQL harness now chooses seeded projects with host memberships rather than the first alphabetically returned project. Retained DWT-NOI legitimately has no implicit employee memberships. The initial harness failed first at visitor host lookup, then at extra-project lookup; both selections are now deterministic, all **25** cases pass, and no business project or membership was changed to make a test pass.

Detailed reproduction and regression evidence: [browser exposure audit and fixes](65_Browser_Data_Exposure_Audit_24_October_2026.md), [count/edge-case report](66_Final_E2E_Counts_And_Edge_Cases_24_October_2026.md).

## Data preservation and limits

Presentation business records, photos, print/return records, decisions and movements are retained. Disposable regression harnesses clean only their owned test fixtures; they do not reset the demo database. No real email worker or external email delivery is started. Browser printing validates the handoff, and camera tests use synthetic frames.

Real corporate SSO/MFA, enterprise directory/mail, production HTTPS/proxy/SSE behavior, physical cameras/printers, large-volume load and the complete simultaneous SQL race matrix remain separate acceptance tasks. [Report 66](66_Final_E2E_Counts_And_Edge_Cases_24_October_2026.md) lists concrete remaining scenarios. Historical evidence documents retain their original dates and results.

Sanitized logs/results for this automation are retained locally in ignored `output/automation-final-24-oct/`. Credentials, cookies, bearer links and raw private photo payloads are excluded from committed evidence.

## Source delivery

The final source changes and current documentation are committed on **main** and pushed to **origin/main**. The automation verifies remote/main equals the local commit and records its exact SHA in the completion message and local push receipt. No database migration was added or applied by this run. The source release package remains explicitly `deploymentReady: false` for the separate production acceptance tasks above.

The main local listener uses the final source/dependency installation at **http://localhost:8443**. It was restarted during dependency refresh; sign in again if an old browser session no longer works. No email worker was started. The managed Playwright server on 18447 closes at the end of its suite.
