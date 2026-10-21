# 06. UI, PWA and user guide

## Routes and views
| Route | Purpose |
|---|---|
| / | Unified staff sign-in and authorized workspace resolution |
| /office/noida, /office/bengaluru, /office/chennai, /office/pune | Office-bound public intake |
| /guard | Cards, duty filter/search, scanner and actions |
| /reception | Scoped list/search/filter, preview and printing |
| /reception/print | Isolated opener-controlled print window |
| /admin | Project governance, leads/common duties |
| /approval/{visitId} | Minimal host authentication/detail/decision |
| /request/{visitId} | Owner/capability status and current PNG |
| /pwa/offline.html | Reconnection shell; no cached authorized workspace |

The separate 22 October screenshot package contains 43 views at Phone 390x844 and Laptop 1366x768 CSS viewports. Selectors/dialogs/state examples are views, not 43 routes. Populated queues/success/card examples sometimes use intercepted synthetic data, not live approvals/production identities. Screenshots are a separate artifact, not duplicated into the documentation ZIP.

## Shared UI
`global.css` owns tokens/reusable controls; feature CSS owns layout. Utilities include accessible custom selects, country-aware phone input, toasts, camera lifecycle and photo adjustment. Password visibility is an accessible icon and the whole control has a consistent focus state. Mobile forms render directly without redundant page cards/marketing copy.

Public landing fits the viewport, with mobile campus background and overlaid choices. Long forms/workspaces may scroll for genuine content. Landing fit is not a prohibition on useful scrolling. Responsive acceptance requires testing, not an inference from a single screenshot.

## Guard guide
Use main-page search/duty filter and Expected/Inside project tabs. Cards have status accents/tints. No separate Find pass/Recent scans/Projects sidebar. Scanner is a thumb-accessible FAB. Open a card or scan QR to review current details/history. Verification alone does not enter; explicitly Check in/Check out. SQL determines available actions. Reasoned privileged reconciliation cannot erase occupancy arbitrarily.

Account menu contains profile, language dropdown and sign out. Profile shows assigned offices/duties. Language modes are English only or English plus Hindi, Kannada, Tamil or Marathi. This is guard helper translation, not a claim that all application text is translated or native-speaker accepted.

## Reception guide
Use granted office, date/status and supported person/employee/pass-reference search. Metrics describe matching filtered results after the full page chain loads. Failed/incomplete reads are not valid zero counts. View pass authorizes current private details/image. Print requests an audited handoff; popup failure/closure is distinct from server dispatch. Reprint creates a separate job. Pending cards remain pending for project entry. Validate real printer, scaling, orientation and media before rollout.

## Admin guide
Choose authorized office/project. Project leads shows broader/local grants and allowed assignment/removal controls. Search active internal employees, select allowed scope, give reason. Seeing a broader lead does not grant permission to remove it. Common areas requires location-wide authority for named duties and guard allocation. Broader account/credential/reporting administration remains backend capability or subsequent UI work.

## PWA
Manifest uses the GatePass app icon. Service worker caches only a fixed public offline/icon set. Authenticated HTML, APIs, photos, cards, reports and POSTs are excluded. Navigations are network-first with reconnect fallback. All verification/movement requires online SQL authorization. Browser installation and native camera/device behavior remain acceptance checks.

Sources: src/app; docs/13_Product_UX_Standards.md; docs/14_Global_Design_System.md; docs/27_PWA.md; docs/37_Reception_Audit.md.
