import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { RegistrationService } from '../src/registration/RegistrationService.ts';
import { SqlRegistrationRepository } from '../src/registration/SqlRegistrationRepository.ts';
import { SharpPhotoNormalizer } from '../src/registration/RegistrationPhoto.ts';
import { recoverQrCredential } from '../src/registration/QrCredentialEnvelope.ts';
import type { RegistrationParameter } from '../src/registration/SqlRegistrationRepository.ts';
import type { QrEnvelope, QrKeySource } from '../src/registration/QrCredentialEnvelope.ts';

let input = ''; for await (const chunk of process.stdin) input += chunk;
const fixture = JSON.parse(input); const sharp = createRequire(import.meta.url)(fixture.sharpPath);
const bridge = fileURLToPath(new URL('./helpers/Registration.SqlBridge.ps1', import.meta.url));
const tracked = new Set<string>(); const cases: { name: string; passed: boolean }[] = [];
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
async function invoke(payload: Record<string, unknown>): Promise<any> {
  const text = await new Promise<string>((resolve, reject) => {
    const child = spawn(fixture.powerShell, ['-NoProfile', '-File', bridge], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('SQL_BRIDGE_TIMEOUT')); }, 15000);
    child.stdout.on('data', data => { output += data; }); child.stderr.resume();
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error('SQL_BRIDGE_FAILED')); });
    child.stdin.end(JSON.stringify({ server: fixture.server, trustLocalCertificate: fixture.trustLocalCertificate, ...payload }));
  });
  const result = JSON.parse(text);
  if (result?.bridgeError) { process.stderr.write('SQL_TEST_ERROR '+String(result.number)+'\n');throw Object.assign(new Error('SQL_TEST_ERROR'), { number: result.number }); }
  return result;
}
const client = { async callProcedure(procedure: string, parameters: Record<string, RegistrationParameter>) {
  if (procedure === 'gp.CreateRegistrationIntake' && !tracked.has(String(parameters.IntakeId.value))) {
    tracked.add(String(parameters.IntakeId.value));
    process.stdout.write(JSON.stringify({ kind: 'owned', intakeId: parameters.IntakeId.value, tokenHash: (parameters.TokenHash.value as Buffer).toString('hex') }) + '\n');
  }
  const serialized = Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, { type: value.type, value: Buffer.isBuffer(value.value) ? value.value.toString('base64') : value.value }]));
  return JSON.stringify(await invoke({ mode: 'rpc', procedure, parameters: serialized }));
} };
let keysAvailable = true; let keyReads = 0; const key = randomBytes(32);
const keys: QrKeySource = { async active() { keyReads++; if (!keysAvailable) throw new Error('KEY_OFFLINE'); return { id: 'integration', key }; }, async resolve(id) { assert.equal(id, 'integration'); return key; } };
const stored = new Map<string, Buffer>();
const service = new RegistrationService(new SqlRegistrationRepository(client), keys, new SharpPhotoNormalizer(sharp), { async putIfAbsent(path, bytes) {
  assert(!stored.has(path)); stored.set(path, Buffer.from(bytes));
} });
const image = await sharp({ create: { width: 32, height: 48, channels: 3, background: '#6384a5' } }).png().toBuffer();
const session = { sessionToken: fixture.sessionToken, csrfToken: fixture.csrfToken };
let digital: any; let digitalContext: any; let digitalBody: any;
async function check(name: string, action: () => Promise<void>) { await action(); cases.push({ name, passed: true }); }
async function inspect(context: any, visit: any) {
  return await invoke({ mode: 'inspect', intakeId: context.intakeId, visitRequestId: visit.visitRequestId,
    tokenHash: hash(Buffer.from(context.intakeToken, 'base64url')) });
}
await check('actual photo normalization and Digital ID issuance through restricted SQL RPC', async () => {
  const started = await service.start('DIGITAL_ID', session); digitalContext = started.context;
  const photo = await service.recordPhoto(digitalContext, image);
  digitalBody = { requestType: 'DIGITAL_ID', clientKey: randomUUID(), locationId: fixture.locationId, digitalIdReason: 'FORGOT', reason: 'Integration / परीक्षण',
    people: [{ clientPersonKey: randomUUID(), photoAssetId: photo.photoAssetId }] };
  digital = await service.submit(digitalContext, digitalBody);
  assert.equal(digital.visits[0].status, 'APPROVED'); assert.equal(digital.requestType, 'DIGITAL_ID');
  const row = await inspect(digitalContext, digital.visits[0]);
  const bytes = stored.get(row.storageKey); assert(bytes); assert.equal(hash(bytes), row.photoContentHash);
  const metadata = await sharp(bytes).metadata(); assert.equal(metadata.format, 'jpeg'); assert.equal(metadata.exif, undefined);
});
await check('stored AES envelope recovers the same QR and independently matches its verification digest', async () => {
  const row = await inspect(digitalContext, digital.visits[0]); const envelope: QrEnvelope = { ...row, clientPersonKey: digital.visits[0].clientPersonKey };
  const first = await recoverQrCredential(envelope, keys); const second = await recoverQrCredential(envelope, keys);
  assert(first.equals(second)); assert.equal(hash(first), row.credentialHash); first.fill(0); second.fill(0);
});
await check('SQL snapshot hash interoperates with independently serialized Unicode slash-containing data', async () => {
  const row = await inspect(digitalContext, digital.visits[0]); const values = row.snapshotValues;
  const ordered = Object.fromEntries(['snapshotVersion','requestType','employeeId','personName','personEmail','personPhone','companyName','deviceTypes','photoAssetId','photoContentHash','locationId','projectLocationId','hostEmployeeId','reason','temporaryIdReason','validFromUtc','validUntilUtc'].map(key => [key, values[key]]));
  const canonical = JSON.stringify(ordered).replaceAll('/', '\\/');
  assert.equal(values.reason, digitalBody.reason);
  assert.equal(hash(Buffer.from(canonical, 'utf16le')), row.snapshotHash);
  assert(Buffer.from(canonical, 'utf16le').equals(Buffer.from(row.snapshotBytes, 'hex')));
  assert.match(values.validUntilUtc, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert(values.validUntilUtc.endsWith('.000Z'));
});
await check('committed retry and fresh-intake daily reuse work while key source is offline', async () => {
  const before = keyReads; keysAvailable = false;
  assert.deepEqual(await service.submit(digitalContext, digitalBody), digital);
  const started = await service.start('DIGITAL_ID', session); const photo = await service.recordPhoto(started.context, image);
  const reused = await service.submit(started.context, { ...digitalBody, clientKey: randomUUID(), people: [{ clientPersonKey: randomUUID(), photoAssetId: photo.photoAssetId }] });
  assert.equal(reused.visits[0].reused, true); assert.equal(reused.visits[0].accessPassId, digital.visits[0].accessPassId); assert.equal(keyReads, before);
  keysAvailable = true;
});
const tomorrow = new Date(Date.now() + 330 * 60000); tomorrow.setUTCHours(10, 0, 0, 0); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1); tomorrow.setTime(tomorrow.getTime() - 330 * 60000);
const planned = { locationId: fixture.locationId, projectLocationId: String(fixture.projectLocationId), hostEmployeeId: fixture.hostEmployeeId,
  reason: 'Integration visit', validFromUtc: tomorrow.toISOString(), validUntilUtc: new Date(tomorrow.getTime() + 3600000).toISOString() };
await check('external grouped form creates independent pending visitors with encrypted credentials', async () => {
  const started = await service.start('EXTERNAL'); const people = [];
  for (let index = 1; index <= 2; index++) { const photo = await service.recordPhoto(started.context, image); people.push({ clientPersonKey: randomUUID(), photoAssetId: photo.photoAssetId, name: 'अतिथि ' + index, phone:'+919876543210' }); }
  const result = await service.submit(started.context, { ...planned, requestType: 'EXTERNAL', clientKey: randomUUID(), people });
  assert.equal(result.visits.length, 2); assert(result.visits.every(visit => visit.status === 'PENDING'));
  assert.notEqual(result.visits[0].visitRequestId, result.visits[1].visitRequestId);
  for (const visit of result.visits) { const row = await inspect(started.context, visit); const raw = await recoverQrCredential({ ...row, clientPersonKey: visit.clientPersonKey }, keys); assert.equal(hash(raw), row.credentialHash); raw.fill(0); }
});
await check('employee project request derives employee identity and stays pending for its assigned host', async () => {
  const started = await service.start('EMPLOYEE_PROJECT', session); const photo = await service.recordPhoto(started.context, image);
  const result = await service.submit(started.context, { ...planned, validFromUtc: new Date(Date.now()).toISOString(), validUntilUtc: new Date(new Date(Date.now()+330*60000).setUTCHours(24,0,0,0)-330*60000).toISOString(), requestType: 'EMPLOYEE_PROJECT', clientKey: randomUUID(), people: [{ clientPersonKey: randomUUID(), photoAssetId: photo.photoAssetId }] });
  assert.equal(result.visits[0].status, 'PENDING'); const row = await inspect(started.context, result.visits[0]);
  assert.equal(row.snapshotValues.employeeId, fixture.employeeId); assert.equal(row.snapshotValues.hostEmployeeId, fixture.hostEmployeeId);
});
process.stdout.write(JSON.stringify({ kind: 'report', Status: 'PASS', CaseCount: cases.length, Cases: cases,
  NodeVersion: process.version, SharpVersion: sharp.versions.sharp, ActualSharpAndAesAndSqlRpc: true, ProductionSqlDriver: false, BrowserHttpTest: false }) + '\n');
key.fill(0); for (const bytes of stored.values()) bytes.fill(0);
