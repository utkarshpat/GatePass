import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Official pinned release; verify its archive against the release checksums.
const version = '8.30.1';
if (!['linux', 'win32'].includes(process.platform) || process.arch !== 'x64') throw Error('UNSUPPORTED_SCANNER_PLATFORM');
const archive = `gitleaks_${version}_${process.platform === 'win32' ? 'windows' : 'linux'}_x64.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`;
const base = `https://github.com/gitleaks/gitleaks/releases/download/v${version}/`;
const download = async name => {
  const response = await fetch(base + name, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw Error(`SCANNER_DOWNLOAD_FAILED_${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};
const folder = await mkdtemp(join(tmpdir(), 'gatepass-gitleaks-'));
try {
  const [bytes, sums] = await Promise.all([download(archive), download(`gitleaks_${version}_checksums.txt`)]);
  const expected = sums.toString('utf8').split(/\r?\n/u).map(line => line.trim().split(/\s+/u)).find(row => row[1] === archive)?.[0];
  if (!expected || createHash('sha256').update(bytes).digest('hex') !== expected) throw Error('SCANNER_CHECKSUM_MISMATCH');
  const file = join(folder, archive);
  await writeFile(file, bytes);
  const extract = process.platform === 'win32'
    ? spawnSync('tar', ['-xf', file, '-C', folder], { stdio: 'inherit' })
    : spawnSync('tar', ['-xzf', file, '-C', folder], { stdio: 'inherit' });
  if (extract.error || extract.status !== 0) throw Error('SCANNER_EXTRACTION_FAILED');
  const executable = join(folder, process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks');
  if (process.platform !== 'win32') await chmod(executable, 0o700);
  const report = join(folder, 'redacted.json');
  const result = spawnSync(executable, ['git', '--redact=100', '--no-banner', '--report-format=json', '--report-path='+report, '--log-opts=--all', '.'], { stdio: 'inherit' });
  if (result.status === 1) {
    for (const finding of JSON.parse(await readFile(report, 'utf8'))) {
      console.error(JSON.stringify({ rule: finding.RuleID, file: finding.File, line: finding.StartLine, fingerprint: finding.Fingerprint }));
    }
  }
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  // Only the newly-created OS temp directory owned by this invocation.
  await rm(folder, { recursive: true, force: true });
}
