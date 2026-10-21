import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { resolvePowerShell } from '../src/development/PowerShellRuntime.mjs';
test('discovers existing bundled PowerShell when user PATH has no pwsh', () => {
  const expected = join('C:/Users/example', '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'native', 'powershell', 'pwsh.exe');
  assert.equal(resolvePowerShell({ platform: 'win32', env: { PATH: 'C:/Windows' }, home: 'C:/Users/example', exists: (p: string) => p === expected }), expected);
});
test('uses approved explicit runtime and rejects an invalid override', () => {
  assert.throws(() => resolvePowerShell({ env: { GATEPASS_PWSH_PATH: 'missing.exe' }, exists: () => false }), /CONFIGURED_POWERSHELL_NOT_FOUND/u);
  const value = resolvePowerShell({ env: { GATEPASS_PWSH_PATH: process.execPath }, exists: () => true });
  assert.equal(value, process.execPath);
});
test('standard installation is found without changing environment', () => {
  const env = { PATH: '', ProgramFiles: 'C:/Program Files' };
  const expected = join(env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe');
  assert.equal(resolvePowerShell({ platform: 'win32', env, exists: (p: string) => p === expected }), expected);
  assert.deepEqual(env, { PATH: '', ProgramFiles: 'C:/Program Files' });
});
test('missing runtime fails clearly rather than silently selecting Windows PowerShell 5', () => {
  assert.throws(() => resolvePowerShell({ platform: 'win32', env: {}, exists: () => false }), /POWERSHELL_7_NOT_FOUND/u);
});
