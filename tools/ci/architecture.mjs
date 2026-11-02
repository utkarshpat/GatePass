import ts from "typescript";
import { readdir, readFile } from "node:fs/promises";
import { posix, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const applicationAreas = new Set([
  "administration",
  "email",
  "operations",
  "planning",
  "printing",
  "reception",
  "registration",
  "security",
  "visits",
]);
const outerAreas = new Set([
  "app",
  "development",
  "frontend",
  "runtime",
  "transport",
]);
const sourceExtension = /\.(?:[cm]?[jt]s|tsx)$/u;

/** Static dependency rules; no app initialization, SQL, credentials or external service access. */
export function architectureIssues(input) {
  const files = new Map(
    [...input].map(([name, text]) => [name.replaceAll("\\", "/"), text]),
  );
  const issues = [],
    edges = new Map();
  const report = (code, file, dependency) =>
    issues.push({ code, file, dependency });
  for (const [name, text] of files) {
    const area = name.split("/")[1];
    const source = ts.createSourceFile(
      name,
      text,
      ts.ScriptTarget.Latest,
      true,
      name.endsWith(".tsx") ? ts.ScriptKind.TSX : undefined,
    );
    const references = [];
    const add = (node, typeOnly = false) => {
      if (node && ts.isStringLiteralLike(node))
        references.push({ specifier: node.text, typeOnly });
    };
    const walk = (node) => {
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause;
        const named = clause?.namedBindings;
        add(
          node.moduleSpecifier,
          !!clause?.isTypeOnly ||
            !!(
              named &&
              ts.isNamedImports(named) &&
              !clause.name &&
              named.elements.length &&
              named.elements.every((e) => e.isTypeOnly)
            ),
        );
      } else if (ts.isExportDeclaration(node)) {
        add(
          node.moduleSpecifier,
          node.isTypeOnly ||
            !!(
              node.exportClause &&
              ts.isNamedExports(node.exportClause) &&
              node.exportClause.elements.length &&
              node.exportClause.elements.every((e) => e.isTypeOnly)
            ),
        );
      } else if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument)
      ) {
        add(node.argument.literal, true);
      } else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require"))
      ) {
        add(node.arguments[0]);
      }
      ts.forEachChild(node, walk);
    };
    walk(source);
    const runtime = [];
    for (const { specifier, typeOnly } of references) {
      if (
        specifier === "mssql" &&
        name !== "src/transport/SqlProcedureClient.ts"
      )
        report("SQL_DRIVER_OUTSIDE_ADAPTER", name, specifier);
      if (
        ["frontend", "shared"].includes(area) &&
        specifier.startsWith("node:")
      )
        report("BROWSER_NODE_DEPENDENCY", name, specifier);
      if (!specifier.startsWith(".")) continue;
      let target = posix.normalize(posix.join(posix.dirname(name), specifier));
      if (!files.has(target)) {
        const candidates = [
          target.replace(/\.js$/u, ".ts"),
          target + ".ts",
          target + ".tsx",
          target + "/index.ts",
        ];
        target = candidates.find((candidate) => files.has(candidate)) ?? target;
      }
      const targetArea = target.startsWith("src/")
        ? target.split("/")[1]
        : null;
      if (area === "shared" && targetArea !== "shared")
        report("SHARED_OUTWARD_DEPENDENCY", name, target);
      if (area === "contracts" && targetArea !== "contracts")
        report("CONTRACT_OUTWARD_DEPENDENCY", name, target);
      if (area === "frontend" && !["frontend", "shared"].includes(targetArea))
        report("BROWSER_SERVER_DEPENDENCY", name, target);
      if (
        applicationAreas.has(area) &&
        (outerAreas.has(targetArea) || !targetArea)
      )
        report("APPLICATION_OUTWARD_DEPENDENCY", name, target);
      if (area !== "development" && targetArea === "development")
        report("DEVELOPMENT_DEPENDENCY", name, target);
      if (
        applicationAreas.has(area) &&
        area !== "reception" &&
        target.endsWith("/reception/ReceptionService.ts")
      )
        report("FEATURE_SESSION_DEPENDENCY", name, target);
      if (
        name === "src/email/GraphMailTransport.ts" &&
        target.endsWith("/NotificationEmailWorker.ts")
      )
        report("MAIL_ADAPTER_WORKER_DEPENDENCY", name, target);
      if (!typeOnly && files.has(target)) runtime.push(target);
    }
    edges.set(name, [...new Set(runtime)]);
  }
  const visited = new Set(),
    active = new Set(),
    stack = [],
    reportedCycles = new Set();
  function visit(name) {
    if (active.has(name)) {
      const cycle = stack.slice(stack.indexOf(name));
      const key = [...cycle].sort().join("|");
      if (!reportedCycles.has(key)) {
        reportedCycles.add(key);
        report("RUNTIME_IMPORT_CYCLE", name, [...cycle, name].join(" -> "));
      }
      return;
    }
    if (visited.has(name)) return;
    visited.add(name);
    active.add(name);
    stack.push(name);
    for (const dependency of edges.get(name) ?? []) visit(dependency);
    stack.pop();
    active.delete(name);
  }
  for (const name of files.keys()) visit(name);
  return issues.sort((a, b) =>
    (a.file + a.code + a.dependency).localeCompare(
      b.file + b.code + b.dependency,
    ),
  );
}

export async function sourceModules(root = resolve("src")) {
  const files = new Map();
  async function walk(folder, prefix) {
    for (const item of await readdir(folder, { withFileTypes: true })) {
      const path = resolve(folder, item.name),
        name = prefix + "/" + item.name;
      if (item.isDirectory()) await walk(path, name);
      else if (sourceExtension.test(item.name))
        files.set(name, await readFile(path, "utf8"));
    }
  }
  await walk(root, "src");
  return files;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const files = await sourceModules(),
    issues = architectureIssues(files);
  for (const issue of issues) console.error(JSON.stringify(issue));
  if (issues.length) process.exitCode = 1;
  else
    console.log(
      `PASS: ${files.size} source modules satisfy dependency boundaries and have no runtime import cycles.`,
    );
}
