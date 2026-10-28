import type { PageConfig, PageName } from "../frontend/types.ts";
import { pwaHead } from "./PwaAssets.ts";
const titles: Record<PageName, string> = {
  staff: "Sign in · Sopra Steria GatePass",
  "self-service": "GatePass · Sopra Steria",
  guard: "Guard · Sopra Steria",
  reception: "Reception Desk · Sopra Steria GatePass",
  admin: "Accounts & Delegation · Sopra Steria",
  email: "GatePass",
};
const classes: Record<PageName, string> = {
  staff: "staff-entry-page",
  "self-service": "",
  guard: "guard-app",
  reception: "reception-page",
  admin: "",
  email: "",
};
export function reactDocument(
  config: PageConfig,
  styles: string,
  scriptUrl: string,
) {
  if (
    !Object.hasOwn(titles, config.page) ||
    !/^\/assets\/react\/[a-z-]+-[A-Z0-9]+\.js$/u.test(scriptUrl) ||
    !["NOIDA", "BENGALURU", "CHENNAI", "PUNE"].includes(config.officeCode)
  )
    throw Error("INVALID_REACT_DOCUMENT");
  const encoded = JSON.stringify(config)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="light"><meta name="gp-office" content="' +
    config.officeCode +
    '"><title>' +
    titles[config.page] +
    "</title>" +
    (config.page === "email" || config.manualReception ? "" : pwaHead) +
    '<style nonce="__NONCE__">' +
    styles +
    '\n#app{display:contents}#react-startup{padding:2rem;font-family:system-ui}</style></head><body class="' +
    classes[config.page] +
    '"' +
    (config.page === "self-service" ? ' data-view="landing"' : "") +
    (config.manualReception ? ' data-reception-manual="true"' : "") +
    '><div id="app"><main id="react-startup" role="status">Loading GatePass… <a href="">Reload</a></main></div><noscript>Enable JavaScript to use GatePass.</noscript><script id="app-config" type="application/json" nonce="__NONCE__">' +
    encoded +
    '</script><script nonce="__NONCE__" src="' +
    scriptUrl +
    '" defer></script></body></html>'
  );
}
