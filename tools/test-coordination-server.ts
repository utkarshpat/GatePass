import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { buildFrontend } from "./frontend-build.mjs";
import { reactDocument } from "../src/app/ReactDocuments.ts";
import { LocalDevelopmentApiClient } from "../src/development/LocalDevelopmentApiClient.ts";
import { PlanningRoutes } from "../src/development/PlanningRoutes.ts";
import { PlanningService } from "../src/planning/PlanningService.ts";
import { createLoopbackHttpHandler } from "../src/development/LoopbackHttpHandler.ts";
import { cookies, HttpFailure, token } from "../src/transport/ApiHandler.ts";
if (
  process.env.NODE_ENV !== "test" ||
  process.env.GATEPASS_SSO_MODE !== "dummy" ||
  process.env.GATEPASS_DIRECTORY_MODE !== "mock"
)
  throw Error("ISOLATED_PLANNING_TEST_ONLY");
const fixture = JSON.parse(
  await readFile(
    new URL("../tmp/planning-browser-fixture.json", import.meta.url),
    "utf8",
  ),
);
if (!/^GatePass_Verification_[a-f0-9]{32}$/u.test(fixture.database))
  throw Error("INVALID_DISPOSABLE_FIXTURE");
const client = new LocalDevelopmentApiClient(
  () =>
    spawn(
      "pwsh",
      [
        "-NoProfile",
        "-File",
        "tools/Planning.TestBridge.ps1",
        "-Database",
        fixture.database,
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    ),
  2,
);
const routes = new PlanningRoutes(
  {
    session(req) {
      const jar = cookies(req.headers.cookie),
        sessionToken = jar["gp-staff-session"],
        csrfToken = req.headers["x-csrf-token"];
      if (!token(sessionToken)) throw new HttpFailure(401);
      if (
        !token(csrfToken) ||
        !token(jar["gp-staff-csrf"]) ||
        !timingSafeEqual(
          Buffer.from(csrfToken),
          Buffer.from(jar["gp-staff-csrf"]),
        )
      )
        throw new HttpFailure(403);
      return { sessionToken, csrfToken };
    },
    async verify() {
      return true;
    },
  },
  new PlanningService(client),
);
// SQL still validates the actual synthetic session/CSRF on every procedure call.
const port = 18463,
  api = createLoopbackHttpHandler("http://localhost:" + port, routes);
const frontend = await buildFrontend();
const styles =
  (await readFile(new URL("../src/app/global.css", import.meta.url), "utf8")) +
  "\n" +
  (await readFile(
    new URL("../src/frontend/coordination.css", import.meta.url),
    "utf8",
  ));
const logo =
  "data:image/png;base64," +
  (
    await readFile(
      new URL("../assets/brand/sopra-steria-logo.png", import.meta.url),
    )
  ).toString("base64");
const server = createServer((req, res) => {
  if (
    req.method === "GET" &&
    (req.url === "/coordination" || req.url === "/")
  ) {
    const nonce = randomBytes(24).toString("base64");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
    );
    res.end(
      reactDocument(
        {
          page: "coordination",
          companyLogo: logo,
          gatepassLogo: logo,
          officeCode: "NOIDA",
          officeName: "Noida",
          manualReception: false,
          qrDecoderUrl: "",
          exportWorkerUrl: "",
        },
        styles,
        frontend.pages.coordination,
      ).replaceAll("__NONCE__", nonce),
    );
    return;
  }
  const asset = frontend.assets.get(req.url ?? "");
  if (req.method === "GET" && asset) {
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.end(asset);
    return;
  }
  void api(req, res);
});
await client.warmUp();
server.listen(port, "127.0.0.1", () =>
  process.stdout.write("Isolated planning UI ready.\n"),
);
const stop = () => {
  server.closeAllConnections();
  server.close(() => void client.close());
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
