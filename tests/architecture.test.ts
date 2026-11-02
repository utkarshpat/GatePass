import test from "node:test";
import assert from "node:assert/strict";
import {
  architectureIssues,
  sourceModules,
} from "../tools/ci/architecture.mjs";

test("whole application dependency boundaries and runtime cycle policy hold", async () => {
  assert.deepEqual(architectureIssues(await sourceModules()), []);
});
test("architecture rules reject outward dependencies even when they are type-only", () => {
  const issues = architectureIssues(
    new Map([
      [
        "src/planning/Service.ts",
        "import type {Client} from '../transport/Adapter.ts';",
      ],
      ["src/transport/Adapter.ts", "export type Client = {};"],
      [
        "src/frontend/View.tsx",
        "type Secret = import('../../tools/private.ts').Secret; import 'node:fs';",
      ],
      [
        "src/contracts/Sql.ts",
        "export type {Client} from '../transport/Adapter.ts';",
      ],
    ]),
  );
  for (const code of [
    "APPLICATION_OUTWARD_DEPENDENCY",
    "BROWSER_SERVER_DEPENDENCY",
    "BROWSER_NODE_DEPENDENCY",
    "CONTRACT_OUTWARD_DEPENDENCY",
  ])
    assert(issues.some((issue) => issue.code === code));
});
test("runtime cycles, re-exports and dynamic imports are audited, while type cycles are safe", () => {
  const runtime = architectureIssues(
    new Map([
      ["src/planning/a.ts", "export {b} from './b.ts';"],
      ["src/planning/b.ts", "const a = import('./a.ts');"],
    ]),
  );
  assert.equal(
    runtime.filter((issue) => issue.code === "RUNTIME_IMPORT_CYCLE").length,
    1,
  );
  assert.deepEqual(
    architectureIssues(
      new Map([
        ["src/planning/a.ts", "import {type B} from './b.ts';"],
        ["src/planning/b.ts", "export type {A} from './a.ts';"],
      ]),
    ),
    [],
  );
});
test("driver and local-development dependencies cannot escape their adapters", () => {
  const issues = architectureIssues(
    new Map([
      [
        "src/security/Service.ts",
        "import sql from 'mssql'; import '../development/Dummy.ts';",
      ],
      ["src/development/Dummy.ts", "export {};"],
    ]),
  );
  assert(issues.some((issue) => issue.code === "SQL_DRIVER_OUTSIDE_ADAPTER"));
  assert(issues.some((issue) => issue.code === "DEVELOPMENT_DEPENDENCY"));
});
