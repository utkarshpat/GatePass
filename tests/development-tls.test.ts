import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { configuredDevelopmentTls } from '../src/development/DevelopmentTls.ts';
import { resolvePowerShell } from '../src/development/PowerShellRuntime.mjs';

test('no configured certificate leaves trust provisioning explicit', async () => { assert.equal(await configuredDevelopmentTls({}), null); });
test('partial or mixed certificate configuration fails closed', async () => {
  for (const env of [{ GATEPASS_DEV_TLS_CERT_FILE: 'cert' }, { GATEPASS_DEV_TLS_KEY_FILE: 'key' }, { GATEPASS_DEV_TLS_PASSWORD_FILE: 'password' },
    { GATEPASS_DEV_TLS_CERT_FILE: 'cert', GATEPASS_DEV_TLS_KEY_FILE: 'key', GATEPASS_DEV_TLS_PFX_FILE: 'pfx' }]) await assert.rejects(configuredDevelopmentTls(env), /INVALID_DEVELOPMENT_TLS_CONFIGURATION/u);
});
test('missing certificate files produce a redacted configuration error', async () => {
  await assert.rejects(configuredDevelopmentTls({ GATEPASS_DEV_TLS_PFX_FILE: 'missing-private-certificate.pfx' }), error => (error as Error).message === 'DEVELOPMENT_TLS_FILES_UNAVAILABLE_OR_INVALID');
});
test('existing PFX loads without touching certificate stores; wrong password rejected', async () => {
  const result = spawnSync(resolvePowerShell(), ['-NoProfile', '-File', fileURLToPath(new URL('./helpers/Create-TestTls.ps1', import.meta.url))], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const directory = await mkdtemp(join(tmpdir(), 'gatepass-tls-test-')); const pfx = join(directory, 'test-only.pfx'); const password = join(directory, 'password');
  try {
    await writeFile(pfx, Buffer.from(result.stdout.trim(), 'base64'), { mode: 0o600 }); await writeFile(password, 'test-only\n', { mode: 0o600 });
    const env = { GATEPASS_DEV_TLS_PFX_FILE: pfx, GATEPASS_DEV_TLS_PASSWORD_FILE: password };
    assert.ok(Buffer.isBuffer((await configuredDevelopmentTls(env))!.pfx));
    await writeFile(password, 'incorrect-password'); await assert.rejects(configuredDevelopmentTls(env), /DEVELOPMENT_TLS_FILES_UNAVAILABLE_OR_INVALID/u);
  } finally { await unlink(pfx).catch(()=>{}); await unlink(password).catch(()=>{}); await rmdir(directory); }
});
