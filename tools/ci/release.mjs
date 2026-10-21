import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile, cp, lstat, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, relative, sep } from 'node:path';

const root = process.cwd();
const destination = join(root, 'output/release-candidate');
// Validate the fixed workspace-owned target before replacing generated output.
if (relative(root, destination).replaceAll(sep, '/') !== 'output/release-candidate') throw Error('INVALID_RELEASE_OUTPUT');
try {
  const existing = await lstat(destination);
  if (existing.isSymbolicLink() || !existing.isDirectory()) throw Error('INVALID_RELEASE_OUTPUT');
  await rm(destination, { recursive: true });
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(destination, { recursive: true });
// Explicit source allowlist: no .git, test fixtures, dummy login entrypoint,
// node_modules, validation exports, credentials or private photo directories.
const allowed = ['src', 'assets', 'database/migrations', 'database/migrations.sha256.json',
  'package.json', 'package-lock.json', 'tools/start-api.ts', 'tools/PrivateStorage.Windows.ps1'];
for (const path of allowed) {
  await cp(join(root, path), join(destination, path), {
    recursive: true, filter: source => !relative(root, source).replaceAll(sep, '/').startsWith('src/development')
  });
}
const hashes = {};
async function walk(folder) {
  for (const item of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, item.name);
    if (item.isSymbolicLink()) throw Error('RELEASE_LINK_FORBIDDEN');
    if (item.isDirectory()) await walk(path);
    else hashes[relative(destination, path).replaceAll(sep, '/')] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
}
await walk(destination);
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
await writeFile(join(destination, 'manifest.json'), JSON.stringify({
  revision, version: JSON.parse(await readFile('package.json', 'utf8')).version,
  kind: 'source-release-candidate', deploymentReady: false,
  pending: ['Real SSO/directory/mail integration', 'Linux protected-key provider and complete production web composition', 'Staging deployment and restore/printer acceptance'],
  files: hashes
}, null, 2) + '\n');
// Check the copied package manifests are usable and no dev runtime was copied.
if (!hashes['tools/start-api.ts'] || !hashes['database/migrations/001_individual_visit_baseline.sql'] ||
    Object.keys(hashes).some(path => /(^|\/)(development|node_modules|tmp|validation)(\/|$)/u.test(path))) throw Error('INVALID_RELEASE_CANDIDATE');
console.log(`PASS: ${Object.keys(hashes).length} allowlisted source files packaged for ${revision}. Deployment readiness remains explicitly false.`);
