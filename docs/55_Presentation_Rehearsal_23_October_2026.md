# Presentation rehearsal — 23 October 2026

The presentation is **today, 23 October**, using the local SQL-backed application. Demo business records are intentionally retained. The additive browser runner never deletes visits, photos, decisions, print jobs, returns or movements. Disposable security-regression fixtures remain separate from this retained dataset.

## Open the application

Run `npm.cmd run dev` and open `http://localhost:8443`. The live rehearsal uses a separate listener on port 18448 with the same local `GatePass_DesignTest` database and protected photo/key storage. Restart listeners after source edits because frontend assets are loaded into memory at startup.

| Surface | Account | Local fixture password |
|---|---|---|
| Administration | `admin1@example.com` | `Sopra@123` |
| Reception, Noida | `reception1@example.com` | `Sopra@123` |
| Guard, Noida | `gaurd1@example.com` (existing spelling) | `Sopra@123` |
| Assigned host | `employee19@example.com` | `Sopra@123` |
| Employee self-service | `employee2@example.com` | `Sopra@123` |
| New security staff (created through the admin UI) | `demo-noida-security` — Rakesh Kumar | `Presentation GUARD 2026!` |
| New reception staff (created through the admin UI) | `demo-noida-reception` — Pooja Singh | `Presentation RECEPTION 2026!` |

These are synthetic development credentials. Use separate browser profiles/private windows for each role. Do not replace a role's cookies in the middle of a workflow.

## Add a project in the authorized office

In **Projects & areas**, use **Add → Project** to create a project in the selected authorized office. The retained Noida project is **Digital Workplace Transformation · DWT-NOI**. Location admins cannot create projects in another office; project admins cannot create sibling projects. See [scoped project creation](56_Scoped_Project_Creation.md) for the permission boundary, migrations 086–087 and regression coverage.

## Retained presentation dataset

Names, companies, phone numbers and `example.com` addresses are fictional demonstration data. Camera frames are synthetic; real camera hardware and physical printing are separate acceptance checks.

| Person | Company | Intended demonstration state |
|---|---|---|
| Aarav Sharma | Northstar Consulting | Approved, entered, exited, printed pass returned |
| Meera Iyer | BluePeak Technologies | Approved, printed and currently inside Project 1 |
| Rohan Mehta | Meridian Systems | Approved and printed, ready for entry |
| Ananya Rao | Cedar Design Studio | Pending host approval; pending printed card |
| Kabir Sethi | Summit Infrastructure | Declined by the host |
| Priya Nair | Orion Analytics | Entry/exit, final return, then audited mistaken-return correction |
| Sana Qureshi / Dev Patel | Meridian Systems | Group submission; independent approval and rejection |
| Ishita Verma / Aditya Menon | Harbor Facilities | Reception-assisted group registration; independent decisions |
| Neha Bansal / Arjun Desai | Orion Analytics | Future group booking, 24 October |
| Vikram Malhotra / Nisha Kapoor | Northstar Consulting / BluePeak Technologies | Future approved / pending bookings, 24 October |
| Employee 2 | Synthetic employee directory | Same-day Digital ID and downloaded card |
| Employee 1 | Synthetic employee directory | Approved cross-office Project 1 request in Bengaluru |

Each visitor carries declared device types. Inspect the record to see company/device details. Today's passes expire at the configured India-day boundary; expiry preserves history and movements. Future bookings are extra examples, not a substitute for today's populated demonstration.

The local manifest `output/presentation/manifest.json` records actual request/pass IDs and successful browser checkpoints. Screenshots and downloads are in `output/presentation`. Runtime data and protected photos/keys are local and are not included in Git pushes.

The retained dataset contains 14 external visitors, one employee Digital ID, one employee project request and two newly created local staff accounts. Ten external visits are dated 23 October; four demonstrate future booking. The real register Excel download was opened as a ZIP/XML workbook and checked for retained visitor rows.

Signed external holder pages were exercised for Ananya (Pending), Rohan (Approved) and Aarav (Revoked), including HttpOnly scoped-cookie exchange, fragment removal and reload. Employee 1's approved request-owner page and card also passed. For the presentation, open `%USERPROFILE%\.gatepass\presentation-2026-10-23\holder-links.html`; the signed capabilities are kept outside the workspace and are not committed. No email was sent.

## Suggested walkthrough

1. Open `/office/noida`; show employee and visitor entry, optional company, per-person devices, project/host selection, camera capture/crop and review. A group generates independent request/pass references.
2. Sign in as the assigned host at `/approval/<visitRequestId>`. Show pending data, company/devices and the explicit Approve/Reject buttons. A page open alone never makes a decision.
3. Sign in as reception. Show today's KPIs and approval/type/card filters. Search the retained names. Open **History** with both dates set to **23 October 2026**, then open Aarav or Priya to show entry/exit history.
4. Open the pass preview and Print/Reprint. These create audited browser handoffs. They do not establish that paper was physically printed.
5. Sign in as guard; choose **Project 1 · Project**. Meera appears in **Inside**. Rohan is ready for a live check-in; check him out afterward to leave a complete timeline. Common-area duties verify identity without project movement.
6. For an outside printed visitor, reception's card-status control requires confirmation of every declared device before final return. Priya demonstrates a correction with a mandatory reason and retained audit history. Do not return Meera while she is still inside.
7. Open all seven admin modules: Overview, Projects & areas, Users & permissions, Guard assignments, Offices & QR, Visit register and Audit log. In the register, choose 23 October, filter by a retained name, change columns/sort, open the visit timeline and download the Excel register. Show project/office-scoped controls, guard roster grouping and the QR standee.
8. Use the four office landing URLs to show office-specific entry. Use employee self-service for a new Digital ID or additional/cross-office project request, then the matching host approval page.

## Reproduce the retained browser rehearsal

Start the current development listener on port 18448 with `NODE_ENV=development`, `GATEPASS_SSO_MODE=dummy`, `GATEPASS_DIRECTORY_MODE=mock`, `GATEPASS_DUMMY_PORT=18448`, and `GATEPASS_SHARP_PATH` pointing to the installed `node_modules/sharp` package.

```powershell
$env:GATEPASS_RETAIN_DEMO='true'
node tools/run-presentation-demo.ts
```

The explicit retain flag and loopback URL allowlist prevent accidental use against another server. The manifest resumes completed stages. Do not remove it merely to retry a failed stage: doing so would create additional demonstration records. Run fault-injection SQL harnesses separately from the browser rehearsal; they deliberately exercise failures and locking.

## Corrections from this rehearsal

- Removed a duplicate guard-allocation submit handler and updated browser selectors for the new roster/modal and separate reception searches.
- Bounded waiting in the local four-worker RPC pool prevents spurious overload 503 responses during overlapping admin reads. An eight-request browser regression exercises this boundary.
- Admin scope/assignment reads retry one SQL deadlock (1205) with the same authorized session/scope. Repeated deadlocks and authorization denials still fail; mutations are not retried by this policy. This addresses an observed successful allocation followed by a failed roster refresh.
- Improved pending guard-card text contrast, verified with populated data and Axe.
- Added missing guard person/detail layout, readable status colors and wrapping timeline timestamps for phone-sized dialogs.
- Prevented ignored early host decision clicks while the post-login photo request is still loading; a browser regression holds that photo response to verify the disabled/enabled transition.
- Forward migration **084** replaces an unbounded ordered LOB aggregation for five device codes with deterministic bounded canonicalization. SQL diagnostics observed `RESOURCE_SEMAPHORE` waits and a roughly 20 MB grant for only a few device bytes. Applied migrations 001–083 remain unchanged.
- Kept regression fixture audit removal within the fixture's own project scope and isolated administration-read name searches by run prefix, so retained data does not invalidate exact-count assertions.
- Forward migration **085** preserves the 31-day audit-window contract while rejecting year-9999 inputs without a `datetime2` arithmetic overflow.

## Validation and limits

Fresh local results on 23 October:

| Check | Result |
|---|---|
| Node unit/contract tests | 458 passed, 1 platform-specific skip, 0 failures |
| Coverage gate | 95.42% lines, 88.87% branches, 94.12% functions |
| Live SQL/HTTP integration | 15 suites passed; includes 57 registration, 19 duty, 38 administration-read, 55 printing, 25 public/employee HTTP/SQL and 7 manual reception HTTP/SQL cases |
| Full Chromium/Axe suite | 65 passed, 0 failures; live SQL journeys plus controlled UI/security fixtures, phone and desktop |
| Retained Chromium rehearsal | Real submissions, decisions, print handoffs, movement, return/correction, all seven admin modules, staff creation/setup/login, cross-office approval, QR decoding and Excel download passed |
| Signed holder/employee status | Pending/approved/revoked holder states, cookie exchange/reload and employee request card passed |
| Office entry smoke checks | Noida, Bengaluru, Chennai and Pune employee/visitor entry rendered in the presentation browser |
| Static/security gates | TypeScript, ESLint, 85 migration hashes, dependency audit (0 vulnerabilities), redacted secret scan and whitespace checks |

The final full browser rerun passed all 65 tests after the roster deadlock-read retry correction. Earlier documents' counts remain dated historical evidence. Corporate SSO/MFA/directory, actual organization mailbox delivery, Outlook provider onboarding, physical cameras/printers and production deployment are outside the local browser result. No real messages are sent by the retained runner.

The current shared Add flow and area/guard cards are documented in [Unified projects and common areas](57_Unified_Projects_And_Common_Areas.md).

For register data, choose **Noida → Project 1**, then **Visit register**. The status shows the selected scope and active sort. See [register loading and shared scrollbars](58_Visit_Register_Loading_And_Theme_Scrollbars.md).

Presentation account lookup: [current login IDs, roles, locations and project/duty assignments](59_Presentation_Account_Role_Assignment_List.md), snapshotted from local SQL on 23 October.

Email presentation: [person-photo emails and why HTML approval links use host authentication](60_Email_Design_Person_Photos_And_Approvals.md). Use `npm.cmd run mail:preview` for synthetic HTML/Outlook examples. Generated pass/QR cards are not added to emails.
