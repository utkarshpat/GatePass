import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename } from "node:path";
const components = {
  coordination: "CoordinationPage",
  staff: "StaffPage",
  "self-service": "SelfServicePage",
  guard: "GuardPage",
  reception: "ReceptionPage",
  admin: "AdminPage",
  email: "EmailPage",
};
export async function buildFrontend({ testMode = false } = {}) {
  const output = await build({
    absWorkingDir: fileURLToPath(new URL("..", import.meta.url)),
    entryPoints: Object.fromEntries(
      Object.keys(components).map((page) => [page, "gatepass:entry/" + page]),
    ),
    outdir: "output/frontend",
    entryNames: "[name]-[hash]",
    metafile: true,
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    minify: true,
    legalComments: "eof",
    define: {
      "process.env.NODE_ENV": '"production"',
      __GATEPASS_UI_TEST__: JSON.stringify(testMode),
    },
    plugins: [
      {
        name: "gatepass-react-pages",
        setup(plugin) {
          plugin.onResolve({ filter: /^gatepass:entry\// }, (args) => ({
            path: args.path.split("/").at(-1),
            namespace: "gatepass-entry",
          }));
          plugin.onLoad(
            { filter: /.*/, namespace: "gatepass-entry" },
            (args) => ({
              contents: `import Page from './pages/${components[args.path]}.tsx';import{renderPage}from'./main.tsx';renderPage(Page);`,
              loader: "tsx",
              resolveDir: fileURLToPath(
                new URL("../src/frontend/", import.meta.url),
              ),
            }),
          );
        },
      },
    ],
  });
  const assets = new Map();
  const pages = /** @type {Record<string,string>} */ ({});
  for (const file of output.outputFiles) {
    const url = "/assets/react/" + basename(file.path);
    assets.set(url, file.text);
    const meta = Object.entries(output.metafile.outputs).find(
      ([path]) => basename(path) === basename(file.path),
    )?.[1];
    if (meta?.entryPoint) pages[meta.entryPoint.split(":").at(-1)] = url;
  }
  if (Object.keys(pages).length !== Object.keys(components).length)
    throw Error("Incomplete React page build");
  return { assets, pages };
}
if (process.argv.includes("--write")) {
  const result = await buildFrontend();
  await mkdir(new URL("../output/frontend/", import.meta.url), {
    recursive: true,
  });
  for (const [url, script] of result.assets)
    await writeFile(
      new URL("../output/frontend/" + basename(url), import.meta.url),
      script,
    );
  console.log("React frontend bundles built:", JSON.stringify(result.pages));
}
