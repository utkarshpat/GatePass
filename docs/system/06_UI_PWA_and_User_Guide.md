# 06. UI, PWA and user guide

> Current source documentation: **28 October 2026**, migrations **001–121**. See [current release/configuration evidence](../88_Documentation_And_Release_28_October_2026.md), [individual visitor flow](../85_Individual_Visitor_Registration_27_October_2026.md), [runtime .env configuration](../86_Runtime_Environment_Configuration.md) and [organization requirements](../87_Organization_Production_Requirements.md). Earlier exported PDFs, screenshots and dated reports are historical.

Current administration has seven modules, account lead previews, guard/account roster grouping, a separate allocation dialog, date/field-filtered visit register with Excel export and visit timelines, office QR standees and filterable audit events. Local staff can be created and receive a one-use password setup link. Reception offers all-date lookup/QR search, device confirmation on final pass return and a reasoned correction for mistaken returns. Visitor company and devices remain optional and per person. See the dated walkthrough for retained names and the 23 October presentation sequence.

## Routes and views
| Route | Purpose |
|---|---|
| / | Unified staff sign-in and authorized workspace resolution |
| /office/noida, /office/bengaluru, /office/chennai, /office/pune | Office-bound public intake |
| /guard | Cards, duty filter/search, scanner and actions |
| /reception | Scoped list/search/filter, preview and printing |
| /reception/print | Isolated opener-controlled print window |
| /admin | Account governance, leads/common duties |
| /approval/{visitId} | Minimal host authentication/detail/decision |
| /request/{visitId} | Owner/capability status and current PNG |
| /pwa/offline.html | Reconnection shell; no cached authorized workspace |

The separate 22 October screenshot package contains 43 views at Phone 390x844 and Laptop 1366x768 CSS viewports. Selectors/dialogs/state examples are views, not 43 routes. Populated queues/success/card examples sometimes use intercepted synthetic data, not live approvals/production identities. Screenshots are a separate artifact, not duplicated into the documentation ZIP.

## Visitor registration
One visitor per form; optional company/devices, camera photo, office-wide host search and inclusive Valid until. Account selection is absent from visitor UI/public options; employee account access is unchanged. Desktop places Host and Valid until together; mobile stacks them. The success page renders a downloadable card for visitors as well as Digital IDs. Card failure has an explicit retry. A pending card remains pending.

All calendar-day pass expiry labels, including images/printing, details, emails and register export, show the last included date at 23:59. The original exclusive timestamp continues to control access.

## Shared UI
`global.css` owns tokens/reusable controls; feature CSS owns layout. Utilities include accessible custom selects, country-aware phone input, toasts, camera lifecycle and photo adjustment. Password visibility is an accessible icon and the whole control has a consistent focus state. Mobile forms render directly without redundant page cards/marketing copy.

Public landing fits the viewport, with mobile campus background and overlaid choices. Long forms/workspaces may scroll for genuine content. Landing fit is not a prohibition on useful scrolling. Responsive acceptance requires testing, not an inference from a single screenshot.

## Guard guide
Use main-page search/duty filter and Expected/Inside account tabs. Cards have status accents/tints. No separate Find pass/Recent scans/Accounts sidebar. Scanner is a thumb-accessible FAB. Open a card or scan QR to review current details/history. Verification alone does not enter; explicitly Check in/Check out. SQL determines available actions. Reasoned privileged reconciliation cannot erase occupancy arbitrarily.

Account menu contains profile, language dropdown and sign out. Profile shows assigned offices/duties. Language modes are English only or English plus Hindi, Kannada, Tamil or Marathi. This is guard helper translation, not a claim that all application text is translated or native-speaker accepted.

## Reception guide
Use granted office, date/status and supported person/employee/pass-reference search. Metrics describe matching filtered results after the full page chain loads. Failed/incomplete reads are not valid zero counts. View pass authorizes current private details/image. Print requests an audited handoff; popup failure/closure is distinct from server dispatch. Reprint creates a separate job. Pending cards remain pending for account entry. Validate real printer, scaling, orientation and media before rollout.

## Admin guide
Choose the authorized office in the header pill; the account scope bar applies to Overview, Users & permissions, Visit register and Audit log. Accounts & areas shows labelled account/common-area cards and one scoped Add flow. Account cards manage leads; common-area cards manage their guards. Users & permissions manages existing identities, scoped role/permission grants and revocations, and password setup/reset. Add user creates permitted reception/admin accounts and excludes Guard. Guard assignments provides Add guard and account duty allocation/removal. Visit register shows scoped visits, sorting, full timelines and Excel export. Audit log shows authorized administration history. See [unified accounts/areas](../57_Unified_Projects_And_Common_Areas.md) and [account onboarding](../54_Local_Staff_Onboarding_And_Audit.md).

## PWA
Manifest uses the GatePass app icon. Service worker caches only a fixed public offline/icon set. Authenticated HTML, APIs, photos, cards, reports and POSTs are excluded. Navigations are network-first with reconnect fallback. All verification/movement requires online SQL authorization. Browser installation and native camera/device behavior remain acceptance checks.

Sources: src/app; docs/13_Product_UX_Standards.md; docs/14_Global_Design_System.md; docs/27_PWA.md; docs/37_Reception_Audit.md.

## Account host policy update

See [accounts and approved hosts](../89_Accounts_And_Approved_Hosts_28_October_2026.md). Account-office host lists are explicit and administered within scope; membership alone does not enable hosting. Legacy API/schema names remain compatible.
