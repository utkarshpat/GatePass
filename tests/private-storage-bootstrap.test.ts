import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLocalPrivateStorage } from '../src/storage/LocalPrivateStorage.ts';
import { windowsProtection } from '../src/storage/PlatformProtection.ts';

test('private storage bootstrap refuses a supplied root outside test mode', async () => {
 const original = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
 try { await assert.rejects(openLocalPrivateStorage(join(tmpdir(), 'never-created-gatepass-root')), /TEST_STORAGE_ROOT_FORBIDDEN/); }
 finally { if (original === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original; }
});
test('Windows private bootstrap never silently substitutes unprotected storage on another platform', async t => {
 if (process.platform === 'win32') { t.skip('Non-Windows rejection is exercised by the Linux unit job.'); return; }
 await assert.rejects(openLocalPrivateStorage(), /LOCAL_WINDOWS_STORAGE_REQUIRED/);
 await assert.rejects(windowsProtection({ action: 'protect' }), /WINDOWS_PROTECTION_REQUIRED/);
});
test('actual Windows bootstrap reopens its protected key and persists a private photo', async t => {
 if (process.platform !== 'win32') { t.skip('Real DPAPI bootstrap requires Windows; no mock replacement.'); return; }
 const original = process.env.NODE_ENV; process.env.NODE_ENV = 'test';
 const root = await realpath(await mkdtemp(join(tmpdir(), 'gatepass-bootstrap-')));
 try {
  const storage = await openLocalPrivateStorage(join(root, 'private'));
  const photoKey = 'intakes/' + 'a'.repeat(32) + '/' + 'b'.repeat(32) + '.jpg', bytes = Buffer.from([255, 216, 255, 217]);
  await storage.photos.putIfAbsent(photoKey, bytes);
  const reopened = await openLocalPrivateStorage(join(root, 'private'));
  assert.equal(reopened.active.id, storage.active.id);
  assert.deepEqual(await reopened.photos.read(photoKey, 100), bytes);
  const key = await reopened.keys.resolve(storage.active.id);
  assert.equal(key.length, 32); key.fill(0);
 } finally {
  await rm(root, { recursive: true, force: true });
  if (original === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original;
 }
});
