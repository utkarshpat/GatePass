import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SqlPassPrintRepository } from '../src/printing/SqlPassPrintRepository.ts';
import { PassPrintService, PassRenderService } from '../src/printing/PassPrintService.ts';
import { PassCardRenderer } from '../src/printing/PassCardRenderer.ts';
import { SqlVisitReadRepository } from '../src/visits/SqlVisitReadRepository.ts';
import { VisitReadService } from '../src/visits/VisitReadService.ts';
import { NodeQrMatrixEncoder } from '../src/printing/NodeQrMatrixEncoder.ts';
import type { PrintParameter } from '../src/printing/SqlPassPrintRepository.ts';
import type { QrKeySource } from '../src/registration/QrCredentialEnvelope.ts';

let input = ''; for await (const part of process.stdin) input += part; const fixture = JSON.parse(input);
const bridge = fileURLToPath(new URL('./helpers/PassPrint.SqlBridge.ps1', import.meta.url));
const client = { async callProcedure(procedure: string, parameters: Record<string, any>): Promise<string> {
  const text = await new Promise<string>((resolve, reject) => {
    const child = spawn(fixture.powerShell, ['-NoProfile', '-File', bridge], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('PRINT_BRIDGE_TIMEOUT')); }, 15000);
    child.stdout.on('data', bytes => { output += bytes; }); child.stderr.resume(); child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error('PRINT_BRIDGE_FAILED')); });
    child.stdin.end(JSON.stringify({ server: fixture.server, trustLocalCertificate: fixture.trustLocalCertificate, procedure,
      parameters: Object.fromEntries(Object.entries(parameters).map(([key, p]) => [key, { type: p.type, value: Buffer.isBuffer(p.value) ? p.value.toString('base64') : p.value }])) }));
  });
  const result = JSON.parse(text); if (result.bridgeError) throw Object.assign(new Error('SQL_TEST_ERROR'), { number: result.number }); return text;
} };
const api = new PassPrintService(new SqlPassPrintRepository(client, 'api'), { async active() { return activeKey(); }, async resolve() { return key; } });
const key = randomBytes(32); let available = true; let keyReads = 0;
function activeKey() { keyReads++; if (!available) throw new Error('KEY_OFFLINE'); return { id: 'sql_print', key }; }
const keys: QrKeySource = { async active() { return activeKey(); }, async resolve(id) { assert.equal(id, 'sql_print'); return key; } };
const encoded: string[] = []; const encoder = new NodeQrMatrixEncoder();
const renderer = new PassCardRenderer({ errorCorrectionLevel: 'H', async encode(credential) { encoded.push(credential); return encoder.encode(credential); } }, { applicationLogoPng: await readFile(new URL('../assets/brand/gatepass-logo.png', import.meta.url)), organisationLogoPng: await readFile(new URL('../assets/brand/sopra-steria-logo.png', import.meta.url)), organisationIconPng: await readFile(new URL('../assets/brand/sopra-steria-icon.png', import.meta.url)) });
const photos = { async read(path: string, maximum: number) { assert(/^intakes\/[a-f0-9]{32}\/[a-f0-9]{32}\.jpg$/u.test(path)); const bytes = Buffer.from(fixture.photoBytes, 'base64'); assert.equal(maximum, bytes.length); return bytes; } };
const render = new PassRenderService(new SqlPassPrintRepository(client, 'render'), keys, photos, renderer);
const session = { sessionToken: fixture.sessionToken, csrfToken: fixture.csrfToken };
const request = { clientKey: randomUUID(), visitRequestId: fixture.visitRequestId, expectedPassId: fixture.oldAccessPassId, reason: 'Lost / damaged card' };
const cases: { name: string; passed: boolean }[] = []; let replacement: any;
async function check(name: string, action: () => Promise<void>) { await action(); cases.push({ name, passed: true }); }
await check('actual AES replacement follows key-free SQL preflight and keeps one existing visit', async () => {
  replacement = await api.reissue(session, request); assert.equal(replacement.passVersion, 2); assert.equal(replacement.visitRequestId, fixture.visitRequestId.toLowerCase());
  assert.notEqual(replacement.accessPassId, fixture.oldAccessPassId.toLowerCase()); assert(!/ciphertext|credentialHash/u.test(JSON.stringify(replacement)));
});
await check('approved card and explicit reprint recover and encode the same actual SQL-stored static QR', async () => {
  const body = { clientKey: randomUUID(), visitRequestId: fixture.visitRequestId, expectedPassId: replacement.accessPassId };
  const first = await api.request(session, body); assert.equal(first.printReason, 'REISSUE');
  const one = await render.renderAndDispatch(session, first.printJobId); assert(!one.bytes.toString().includes('APPROVED')); one.bytes.fill(0);
  const second = await api.request(session, { ...body, clientKey: randomUUID() }); assert.equal(second.printReason, 'REPRINT');
  const two = await render.renderAndDispatch(session, second.printJobId); two.bytes.fill(0); assert.equal(encoded.length, 2); assert.equal(encoded[0], encoded[1]);
});
await check('pending QR prints immediately and the same card becomes project-eligible only after host approval', async () => {
  const replacement = await api.reissue(session, { clientKey: randomUUID(), visitRequestId: fixture.pendingVisitRequestId, expectedPassId: fixture.pendingAccessPassId, reason: 'Synthetic pending credential fixture' });
  const job = await api.request(session, { clientKey: randomUUID(), visitRequestId: fixture.pendingVisitRequestId, expectedPassId: replacement.accessPassId });
  const pending = await render.renderAndDispatch(session, job.printJobId); const text = pending.bytes.toString();
  assert(!/>PENDING<|>APPROVED<|>NOT VALID<|>Awaiting<|>Online verification</u.test(text)); assert(text.includes('Sopra Steria QR icon')); assert.equal(encoded.length, 3); pending.bytes.fill(0);
  const reads = new VisitReadService(new SqlVisitReadRepository(client, 'api')); const guard = { view: 'GUARD' as const, sessionToken: fixture.guardSessionToken, csrfToken: fixture.guardCsrfToken };
  const scan = () => reads.verify(guard, { locationId: fixture.locationId, credential: encoded[2], correlationId: randomUUID() });
  const before = await scan(); assert.equal(before.outcome, 'PENDING'); assert.equal(before.visit?.canEnter, false);
  const hash = (value: string) => createHash('sha256').update(Buffer.from(value, 'base64url')).digest();
  await client.callProcedure('gp.DecideVisit', { SessionHash: { type: 'binary', value: hash(fixture.hostSessionToken) }, CsrfHash: { type: 'binary', value: hash(fixture.hostCsrfToken) },
    ClientKey: { type: 'guid', value: randomUUID() }, VisitRequestId: { type: 'guid', value: fixture.pendingVisitRequestId }, SnapshotVersion: { type: 'int', value: 1 },
    SnapshotHash: { type: 'binary', value: Buffer.from(fixture.pendingSnapshotHex, 'hex') }, Decision: { type: 'text', value: 'APPROVED' } });
  const after = await scan(); assert.equal(after.outcome, 'VALID'); assert.equal(after.visit?.canEnter, true); assert.equal(encoded.length, 3);
});
await check('guard verifies the replacement while the original QR is revoked without creating movement', async () => {
  const reads = new VisitReadService(new SqlVisitReadRepository(client, 'api')); const guard = { view: 'GUARD' as const, sessionToken: fixture.guardSessionToken, csrfToken: fixture.guardCsrfToken };
  const current = await reads.verify(guard, { locationId: fixture.locationId, credential: encoded[0], correlationId: randomUUID() }); assert.equal(current.outcome, 'VALID'); assert.equal(current.visit?.isInside, false);
  const old = await reads.verify(guard, { locationId: fixture.locationId, credential: fixture.oldCredential, correlationId: randomUUID() }); assert.equal(old.outcome, 'REVOKED'); assert.equal(old.visit?.canEnter, false);
});
await check('digital ID renders trusted employee ID, directory assignments and standard reason from actual SQL', async () => {
  const replacement = await api.reissue(session, { clientKey: randomUUID(), visitRequestId: fixture.digitalVisitRequestId, expectedPassId: fixture.digitalAccessPassId, reason: 'Synthetic digital card fixture' });
  const job = await api.request(session, { clientKey: randomUUID(), visitRequestId: fixture.digitalVisitRequestId, expectedPassId: replacement.accessPassId });
  const result = await render.renderAndDispatch(session, job.printJobId); const svg = result.bytes.toString();
  const printedText = [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gu)].map(match => match[1]).join('');
  assert(printedText.includes(fixture.employeeId)); assert(svg.includes('ASSIGNED PROJECTS')); assert(svg.includes('Forgot physical ID')); assert(!svg.includes('Employee ID:')); result.bytes.fill(0);
});
await check('committed replacement retry still works while new-key lookup is offline', async () => {
  const before = keyReads; available = false; assert.deepEqual(await api.reissue(session, request), replacement); assert.equal(keyReads, before);
});
key.fill(0); encoded.fill('');
process.stdout.write(JSON.stringify({ Status: 'PASS', CaseCount: cases.length, Cases: cases, NodeVersion: process.version, ActualSqlAesAndQrMatrix: true,
  PhotoStorage: 'actual synthetic JPEG bytes in memory', QrEncoder: 'qrcode version 5 / H, branded centre icon', ProductionSqlDriver: false, PhysicalPrinterOrBrowserTest: false }));
