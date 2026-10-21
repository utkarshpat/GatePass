import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { SqlVisitCancellationRepository, VisitCancellationService } from '../src/visits/VisitCancellationService.ts';
import { SqlVisitReadRepository } from '../src/visits/SqlVisitReadRepository.ts';
import { VisitReadService } from '../src/visits/VisitReadService.ts';
let input = ''; for await (const part of process.stdin) input += part; const fixture = JSON.parse(input);
const bridge = fileURLToPath(new URL('./helpers/VisitCancellation.SqlBridge.ps1', import.meta.url));
const client = { async callProcedure(procedure: string, parameters: Record<string, any>) {
  const text = await new Promise<string>((resolve, reject) => {
    const child = spawn(fixture.powerShell, ['-NoProfile', '-File', bridge], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('CANCELLATION_BRIDGE_TIMEOUT')); }, 15000);
    child.stdout.on('data', bytes => { output += bytes; }); child.stderr.resume(); child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error('CANCELLATION_BRIDGE_FAILED')); });
    child.stdin.end(JSON.stringify({ server: fixture.server, trustLocalCertificate: fixture.trustLocalCertificate, procedure,
      parameters: Object.fromEntries(Object.entries(parameters).map(([key, p]) => [key, { type: p.type, value: Buffer.isBuffer(p.value) ? p.value.toString('base64') : p.value }])) }));
  }); const result = JSON.parse(text); if (result.bridgeError) throw { number: result.number }; return text;
} };
const service = new VisitCancellationService(new SqlVisitCancellationRepository(client));
const session = { sessionToken: fixture.sessionToken, csrfToken: fixture.csrfToken };
const cases: { name: string; passed: boolean }[] = []; async function check(name: string, action: () => Promise<void>) { await action(); cases.push({ name, passed: true }); }
const data = { clientKey: randomUUID(), visitRequestId: fixture.visitRequestId, expectedPassId: fixture.accessPassId, reason: 'Actual synthetic backend cancellation' }; let receipt: any;
await check('actual typed backend cancellation commits only the assigned host individual', async () => {
  receipt = await service.cancel(session, data); assert.equal(receipt.status, 'CANCELLED'); assert.equal(receipt.wasInsideAtCancellation, false); assert(!/reason|credential|session/u.test(JSON.stringify(receipt)));
});
await check('actual SQL retry returns the same immutable receipt', async () => { assert.deepEqual(await service.cancel(session, data), receipt); });
await check('same employee session cancels own location-only Digital ID', async () => {
  const result = await service.cancel(session, { ...data, clientKey: randomUUID(), visitRequestId: fixture.digitalVisitRequestId, expectedPassId: fixture.digitalAccessPassId }); assert.equal(result.status, 'CANCELLED');
});
await check('protected host detail refresh disables cancellation and decision after commit', async () => {
  const reads = new VisitReadService(new SqlVisitReadRepository(client, 'api')); const result = await reads.detail({ ...session, view: 'HOST' }, data.visitRequestId);
  assert.equal(result.status, 'CANCELLED'); assert.equal(result.canCancel, false); assert.equal(result.canDecide, false); assert.equal(result.passStatus, 'REVOKED');
});
await check('different employee cannot cancel another host visitor through real SQL', async () => {
  await assert.rejects(service.cancel({ sessionToken: fixture.otherSessionToken, csrfToken: fixture.otherCsrfToken }, { ...data, clientKey: randomUUID(), visitRequestId: fixture.otherVisitRequestId, expectedPassId: fixture.otherAccessPassId }), /NOT_AUTHORIZED/u);
});
process.stdout.write(JSON.stringify({ Status: 'PASS', CaseCount: cases.length, Cases: cases, NodeVersion: process.version, RestrictedSqlAndActualInternalService: true,
  ProductionSqlDriver: false, BrowserOrHttpAcceptance: false, MessagesSent: 0, PhysicalPrinterTesting: 'Deferred to final acceptance' }));
