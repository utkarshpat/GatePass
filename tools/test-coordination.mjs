import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Every invocation owns a new marked catalogue; no application database is seeded.
const root = fileURLToPath(new URL("../", import.meta.url));
const pointer = new URL(
  "../tmp/planning-browser-fixture.json",
  import.meta.url,
);
if (process.platform !== "win32")
  throw new Error(
    "Coordination acceptance requires local Windows SQL and PowerShell 7.",
  );
if (existsSync(pointer))
  throw new Error(
    "An owned planning fixture already exists. Review and clean it before starting another run.",
  );
const env = {
  ...process.env,
  NODE_ENV: "test",
  GATEPASS_SSO_MODE: "dummy",
  GATEPASS_DIRECTORY_MODE: "mock",
};
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `Coordination check failed (${result.status ?? result.signal}).`,
    );
}
let owned;
try {
  run("pwsh", [
    "-NoProfile",
    "-File",
    "database/tests/Test-VisitPlanningFoundation.ps1",
    "-TrustLocalServerCertificate",
    "-IncludePersistence",
    "-KeepForBrowser",
  ]);
  owned = JSON.parse(readFileSync(pointer, "utf8")).database;
  run(process.execPath, ["tools/test-planning-mail.ts"]);
  run(process.execPath, [
    "node_modules/@playwright/test/cli.js",
    "test",
    "--config",
    "tests/coordination-browser.config.ts",
    ...process.argv.slice(2),
  ]);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Coordination acceptance failed.",
  );
  process.exitCode = 1;
} finally {
  try {
    if (owned) cleanupOwnedFixture(owned);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Owned fixture cleanup failed.",
    );
    process.exitCode = 1;
  }
}
function cleanupOwnedFixture(database) {
  const current = JSON.parse(readFileSync(pointer, "utf8"));
  if (
    current.database !== database ||
    current.createdBy !== "Test-VisitPlanningFoundation"
  )
    throw new Error("Fixture ownership changed; automatic cleanup refused.");
  run("pwsh", [
    "-NoProfile",
    "-File",
    "database/tests/Cleanup-VisitPlanningBrowser.ps1",
    "-TrustLocalServerCertificate",
  ]);
}
