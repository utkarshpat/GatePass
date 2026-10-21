import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolvePowerShell } from '../src/runtime/PowerShellRuntime.mjs';

test('production API refuses dummy authentication before opening a listener or database', () => {
  const result = spawnSync(process.execPath, ['tools/start-api.ts'], {
    env: { ...process.env, NODE_ENV: 'production', GATEPASS_SSO_MODE: 'dummy' },
    encoding: 'utf8', timeout: 30000
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /API_STARTUP_FAILED/u);
  assert.doesNotMatch(result.stdout, /ready/iu);
});

test('CI SQL override rejects remote, development and unapproved instance targets before connection', () => {
  for (const settings of [
    { CI: 'true', NODE_ENV: 'test', GATEPASS_TEST_SQL_SERVER: 'remote.example\\SQL' },
    { CI: 'false', NODE_ENV: 'test', GATEPASS_TEST_SQL_SERVER: '(localdb)\\GatePassCI_' + 'a'.repeat(32) },
    { CI: 'true', NODE_ENV: 'production', GATEPASS_TEST_SQL_SERVER: '(localdb)\\GatePassCI_' + 'a'.repeat(32) },
    { CI: 'true', NODE_ENV: 'test', GATEPASS_TEST_SQL_SERVER: '(localdb)\\MSSQLLocalDB' }
  ]) {
    const result = spawnSync(resolvePowerShell(), ['-NoProfile', '-Command',
      "Import-Module ./tools/GatePass.LocalSql.psm1 -Force; try { $null=Open-GatePassLocalSql; exit 2 } catch { if($_.Exception.Message -like 'CI SQL override requires*'){ exit 0 }; exit 3 }"
    ], { env: { ...process.env, ...settings }, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
  }
});

test('staging smoke probe refuses missing or insecure origins before network access', () => {
  for (const origin of ['', 'http://example.com', 'https://name:secret@example.com', 'https://example.com/path']) {
    const result = spawnSync(process.execPath, ['tools/ci/staging-smoke.mjs'], {
      env: { ...process.env, GATEPASS_STAGING_ORIGIN: origin }, encoding: 'utf8', timeout: 10000
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /STAGING_ORIGIN_REQUIRED|EXACT_HTTPS_STAGING_ORIGIN_REQUIRED/u);
  }
});
