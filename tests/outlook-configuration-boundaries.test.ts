import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadOutlookActions } from '../src/email/OutlookConfiguration.ts';

const origin = 'https://gatepass.example.com';
function environment(): NodeJS.ProcessEnv {
 return { GATEPASS_OUTLOOK_ACTIONS_ENABLED: 'true', GATEPASS_OUTLOOK_PROVIDER_ID: randomUUID(), GATEPASS_OUTLOOK_TENANT_ID: randomUUID(), GATEPASS_OUTLOOK_APPLICATION_ID: randomUUID(), GATEPASS_OUTLOOK_SCOPE: 'GatePass.Approval' };
}
test('disabled Outlook actions do not load key modules or require production configuration', async () => {
 assert.equal(await loadOutlookActions({ GATEPASS_OUTLOOK_ACTIONS_ENABLED: 'false', GATEPASS_OUTLOOK_KEYS_MODULE: '/missing/module.mjs' }, origin), undefined);
});
test('enabled Outlook actions reject invalid authority, application, scope and unprotected key paths', async () => {
 for (const [key, value] of [['GATEPASS_OUTLOOK_TENANT_ID', 'common'], ['GATEPASS_OUTLOOK_APPLICATION_ID', 'invalid'], ['GATEPASS_OUTLOOK_SCOPE', 'scope with spaces']]) {
  await assert.rejects(loadOutlookActions({ ...environment(), [key]: value }, origin), /INVALID_OUTLOOK_TOKEN_CONFIG/);
 }
 for (const path of ['', 'relative/keys.mjs']) await assert.rejects(loadOutlookActions({ ...environment(), GATEPASS_OUTLOOK_KEYS_MODULE: path }, origin), /OUTLOOK_PROTECTED_KEYS_REQUIRED/);
});
test('Outlook configuration rejects missing or malformed key-provider exports', async () => {
 const root = await mkdtemp(join(tmpdir(), 'gatepass-outlook-config-'));
 try {
  const sources = ['export const unrelated = true;', 'export const createOutlookActionKeys = async () => null;', 'export const createOutlookActionKeys = async () => ({active(){}});', 'export const createOutlookActionKeys = async () => ({resolve(){}});'];
  for (const [index, source] of sources.entries()) {
   const path = join(root, `invalid-${index}.mjs`); await writeFile(path, source);
   await assert.rejects(loadOutlookActions({ ...environment(), GATEPASS_OUTLOOK_KEYS_MODULE: path }, origin), /OUTLOOK_PROTECTED_KEYS_REQUIRED/);
  }
  const failed = join(root, 'unavailable.mjs'); await writeFile(failed, 'export const createOutlookActionKeys = async () => { throw new Error("KEY_STORE_UNAVAILABLE"); };');
  await assert.rejects(loadOutlookActions({ ...environment(), GATEPASS_OUTLOOK_KEYS_MODULE: failed }, origin), /KEY_STORE_UNAVAILABLE/);
 } finally { await rm(root, { recursive: true, force: true }); }
});
test('valid protected-provider contract wires a usable codec with configuration binding', async () => {
 const root = await mkdtemp(join(tmpdir(), 'gatepass-outlook-valid-'));
 try {
  const path = join(root, 'test-keys.mjs');
  // Synthetic key material exists only inside this owned test directory.
  await writeFile(path, 'import {randomBytes} from "node:crypto"; const key=randomBytes(32); const id="k_"+"a".repeat(32); export const createOutlookActionKeys=async()=>({active:async()=>({id,key:Buffer.from(key)}),resolve:async()=>Buffer.from(key)});');
  const env = { ...environment(), GATEPASS_OUTLOOK_KEYS_MODULE: path };
  const actions = await loadOutlookActions(env, origin);
  assert.ok(actions); assert.equal(actions.config.origin, origin); assert.equal(typeof actions.verifier.verify, 'function'); assert.equal(typeof actions.card.render, 'function');
  const value = { v: 1 as const, visit: randomUUID(), host: 'EMP001', snapshot: 'a'.repeat(64), decision: 'APPROVED' as const, clientKey: randomUUID(), expires: Date.now() + 60000 };
  const capability = await actions.codec.issue(value);
  assert.deepEqual(await actions.codec.verify(capability), value);
  const differentApp = await loadOutlookActions({ ...env, GATEPASS_OUTLOOK_APPLICATION_ID: randomUUID() }, origin);
  await assert.rejects(differentApp!.codec.verify(capability), /OUTLOOK_ACTION_UNAVAILABLE/);
 } finally { await rm(root, { recursive: true, force: true }); }
});
