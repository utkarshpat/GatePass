import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SqlVisitReadRepository } from '../src/visits/SqlVisitReadRepository.ts';
import { VisitReadService, VisitPhotoService } from '../src/visits/VisitReadService.ts';
import type { ReadParameter } from '../src/visits/SqlVisitReadRepository.ts';
let input = ''; for await (const part of process.stdin) input += part; const fixture = JSON.parse(input);
const bridge = fileURLToPath(new URL('./helpers/VisitReads.SqlBridge.ps1', import.meta.url));
const client = { async callProcedure(procedure: string, parameters: Record<string, ReadParameter>): Promise<string> {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(fixture.powerShell, ['-NoProfile', '-File', bridge], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let text = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('READ_BRIDGE_TIMEOUT')); }, 15000);
    child.stdout.on('data', data => { text += data; }); child.stderr.resume(); child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(text) : reject(new Error('READ_BRIDGE_FAILED')); });
    child.stdin.end(JSON.stringify({ server: fixture.server, trustLocalCertificate: fixture.trustLocalCertificate, procedure,
      parameters: Object.fromEntries(Object.entries(parameters).map(([key, p]) => [key, { type: p.type, value: Buffer.isBuffer(p.value) ? p.value.toString('base64') : p.value }])) }));
  });
  const result = JSON.parse(output); if (result.bridgeError) throw Object.assign(new Error('SQL_TEST_ERROR'), { number: result.number }); return output;
} };
const context = { view: 'GUARD' as const, sessionToken: fixture.sessionToken, csrfToken: fixture.csrfToken };
const reads = new VisitReadService(new SqlVisitReadRepository(client, 'api')); let storageReads = 0;
const photo = new VisitPhotoService(new SqlVisitReadRepository(client, 'media'), { async read(key, maximum) {
  storageReads++; assert.equal(key, fixture.storageKey); const bytes = Buffer.from(fixture.photoBytes, 'base64'); assert.equal(maximum, bytes.length); return bytes;
} });
const cases: { name: string; passed: boolean }[] = [];
async function check(name: string, action: () => Promise<void>) { await action(); cases.push({ name, passed: true }); }
await check('actual typed SQL keyset list and exact individual detail interoperate', async () => {
  const first = await reads.list(context, { locationId: fixture.locationId, pageSize: 3 }); assert.equal(first.visits.length, 3); assert(first.hasMore && first.cursor);
  const second = await reads.list(context, { locationId: fixture.locationId, pageSize: 3, cursor: first.cursor });
  assert(!second.visits.some(v => first.visits.some(previous => previous.visitRequestId === v.visitRequestId)));
  const detail = await reads.detail(context, fixture.visitRequestId); assert.equal(detail.visitRequestId, fixture.visitRequestId.toLowerCase()); assert.equal(detail.canEnter, true);
  assert(!/storageKey|credentialHash|ciphertext|personEmail|snapshotHash|reason/u.test(JSON.stringify(detail)));
});
await check('actual opaque credential hash verifies without recording entry', async () => {
  const result = await reads.verify(context, { locationId: fixture.locationId, credential: fixture.credential, correlationId: randomUUID() });
  assert.equal(result.outcome, 'VALID'); assert.equal(result.visit?.isInside, false);
});
await check('isolated media RPC authorizes twice and bounds verified photo bytes', async () => {
  const result = await photo.read(context, fixture.visitRequestId); assert(result.bytes.equals(Buffer.from(fixture.photoBytes, 'base64')));
  assert.equal(result.cacheControl, 'private, no-store'); assert.equal(storageReads, 1); assert(!Object.hasOwn(result, 'storageKey')); result.bytes.fill(0);
});
await check('actual SQL prevents forged admin mode and out-of-project photo retrieval', async () => {
  await assert.rejects(reads.detail({ ...context, view: 'ADMIN' }, fixture.visitRequestId), /NOT_AUTHORIZED/u);
  await assert.rejects(photo.read(context, fixture.otherVisitRequestId), /NOT_AUTHORIZED/u); assert.equal(storageReads, 1);
});
process.stdout.write(JSON.stringify({ Status: 'PASS', CaseCount: cases.length, Cases: cases, NodeVersion: process.version,
  ActualRestrictedSqlRpc: true, PhotoStorage: 'synthetic in-memory bytes with actual SQL digest/authorization', ProductionSqlDriver: false, BrowserHttpTest: false }));
