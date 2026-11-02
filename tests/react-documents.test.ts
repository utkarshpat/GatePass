import test from "node:test";
import assert from "node:assert/strict";
import { reactDocument } from "../src/app/ReactDocuments.ts";
import type { PageConfig, PageName } from "../src/frontend/types.ts";
const config = (page: PageName): PageConfig => ({
  page,
  companyLogo: "data:image/png;base64,a",
  gatepassLogo: "data:image/png;base64,b",
  officeCode: "NOIDA",
  officeName: "Noida",
  manualReception: false,
  qrDecoderUrl: "/assets/qr.js",
  exportWorkerUrl: "/assets/export.js",
});
test("seven React documents retain public context, nonce/CSP compatibility and page-owned bundles", () => {
  for (const page of [
    "staff",
    "self-service",
    "guard",
    "reception",
    "admin",
    "email",
    "coordination",
  ] as const) {
    const html = reactDocument(
      config(page),
      "body{}",
      "/assets/react/" + page + "-ABC123.js",
    );
    assert.ok(html.includes('id="app"'));
    assert.ok(html.includes('id="app-config"'));
    assert.ok(html.includes('nonce="__NONCE__"'));
    assert.ok(
      html.includes('src="/assets/react/' + page + '-ABC123.js" defer'),
    );
    assert.ok(html.includes("Loading GatePass"));
    assert.equal(
      html.includes('href="/manifest.webmanifest"'),
      page !== "email",
    );
  }
  const manual = reactDocument(
    { ...config("self-service"), manualReception: true },
    "",
    "/assets/react/self-service-ABC123.js",
  );
  assert.ok(manual.includes('data-reception-manual="true"'));
  assert.equal(manual.includes('href="/manifest.webmanifest"'), false);
});
test("bootstrap JSON escapes HTML delimiters and rejects route/asset injection", () => {
  const html = reactDocument(
    { ...config("staff"), officeName: "</script><script>alert(1)</script>" },
    "",
    "/assets/react/staff-ABC123.js",
  );
  assert.equal(html.includes("</script><script>alert(1)"), false);
  assert.ok(html.includes("\\u003c/script>"));
  for (const patch of [{ page: "unknown" }, { officeCode: '"><script>' }])
    assert.throws(() =>
      reactDocument(
        { ...config("staff"), ...patch } as PageConfig,
        "",
        "/assets/react/staff-ABC123.js",
      ),
    );
  for (const url of [
    "https://example.com/script.js",
    "/assets/react/../secret.js",
    "/assets/react/staff-abc123.js",
  ])
    assert.throws(() => reactDocument(config("staff"), "", url));
});
