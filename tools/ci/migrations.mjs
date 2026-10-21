import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const directory = new URL('../../database/migrations/', import.meta.url);
const manifestFile = new URL('../../database/migrations.sha256.json', import.meta.url);
const files = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
const actual = {};
for (const [index, name] of files.entries()) {
  if (!name.startsWith(String(index + 1).padStart(3, '0') + '_')) throw Error('MIGRATION_GAP_OR_DUPLICATE');
  // Git's text checkout can use CRLF. SQL content is hashed canonically as LF.
  const source = (await readFile(new URL(name, directory), 'utf8')).replace(/\r\n/gu, '\n');
  actual[name] = createHash('sha256').update(source).digest('hex');
}
if (process.argv.includes('--write')) {
  await writeFile(manifestFile, JSON.stringify(actual, null, 2) + '\n');
} else {
  const expected = JSON.parse(await readFile(manifestFile, 'utf8'));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error('MIGRATION_MANIFEST_MISMATCH: add new forward migrations; do not rewrite applied SQL');
  if (process.env.TF_BUILD === 'True') {
    const target = process.env.SYSTEM_PULLREQUEST_TARGETBRANCH?.replace(/^refs\/heads\//u, '');
    if (target && target !== 'main') throw Error('UNEXPECTED_MIGRATION_TARGET');
    const base = target ? execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { encoding: 'utf8' }).trim() : 'HEAD^';
    const changes = execFileSync('git', ['diff', '--name-status', '--no-renames', base, 'HEAD', '--', 'database/migrations/'], { encoding: 'utf8' }).trim();
    if (changes && changes.split(/\r?\n/u).some(line => !line.startsWith('A\t'))) throw Error('APPLIED_MIGRATION_CHANGED: append a forward migration instead');
  }
  console.log(`PASS: ${files.length} sequential migration hashes verified.`);
}
