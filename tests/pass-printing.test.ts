import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { BinaryBitmap, DecodeHintType, HybridBinarizer, RGBLuminanceSource, QRCodeReader } from '@zxing/library';
import { PassPrintService, PassRenderService } from '../src/printing/PassPrintService.ts';
import { PassCardRenderer } from '../src/printing/PassCardRenderer.ts';
import { SqlPassPrintRepository } from '../src/printing/SqlPassPrintRepository.ts';
import { prepareReplacementQrEnvelope, recoverQrCredential } from '../src/registration/QrCredentialEnvelope.ts';
import { NodeQrMatrixEncoder } from '../src/printing/NodeQrMatrixEncoder.ts';
import type { PassPrintRepository, PrintParameter } from '../src/printing/SqlPassPrintRepository.ts';
import type { QrKeySource } from '../src/registration/QrCredentialEnvelope.ts';

const logo = await readFile(new URL('../assets/brand/gatepass-logo.png', import.meta.url));
const brands = { applicationLogoPng: logo, organisationLogoPng: await readFile(new URL('../assets/brand/sopra-steria-logo.png', import.meta.url)), organisationIconPng: await readFile(new URL('../assets/brand/sopra-steria-icon.png', import.meta.url)) };
const encoder = new NodeQrMatrixEncoder(); const renderer = new PassCardRenderer(encoder, brands);
const key = randomBytes(32); const keys: QrKeySource = { async active() { return { id: 'print_test', key }; }, async resolve(id) { assert.equal(id, 'print_test'); return key; } };
const session = () => ({ sessionToken: randomBytes(32).toString('base64url'), csrfToken: randomBytes(32).toString('base64url') });
const request = () => ({ clientKey: randomUUID(), visitRequestId: randomUUID(), expectedPassId: randomUUID(), reason: 'Lost card' });
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
function fake(handler: (name: string, p: Record<string, PrintParameter>) => any) {
  const calls: { name: string; parameters: Record<string, PrintParameter> }[] = [];
  const repository: PassPrintRepository = { async execute(name, parameters) { calls.push({ name, parameters }); return handler(name, parameters); } }; return { repository, calls };
}
async function renderFixture(status: 'APPROVED' | 'PENDING' = 'APPROVED') {
  const visit = randomUUID(); const envelope = await prepareReplacementQrEnvelope(visit, keys); const photo = randomBytes(100); const photoId = randomUUID(); const job = randomUUID();
  const packet: Record<string, unknown> = { printJobId: job.toUpperCase(), visitRequestId: visit.toUpperCase(), accessPassId: envelope.accessPassId.toUpperCase(),
    personName: 'Visitor <script>alert(1)</script> & परीक्षण', requestType: 'EXTERNAL', publicReference: 'V-' + 'a'.repeat(32), publicPassNumber: 'GP-' + 'b'.repeat(32), visitStatus: status,
    locationName: 'Noida', projectName: 'Project <A>', validFromUtc: '2026-10-20T03:00:00.000Z', validUntilUtc: '2026-10-20T18:30:00.000Z',
    photoAssetId: photoId.toUpperCase(), storageKey: `intakes/${randomUUID().replaceAll('-', '')}/${photoId.replaceAll('-', '')}.jpg`, photoContentHash: hash(photo), mimeType: 'image/jpeg', byteLength: 100,
    cardDetails: { employeeId: null, hostEmployeeId: 'EMP019', hostName: 'Host <A>', purpose: 'Client meeting', assignedProjectCount: 0, assignedProjects: [] } };
  for (const field of ['credentialHash', 'ciphertext', 'nonce', 'authenticationTag', 'keyVersion'] as const) packet[field] = envelope[field];
  const f = fake((name, p) => name === 'gp.BeginPassRender' ? packet : name === 'gp.FinishPassRender' ? { status: 'RENDERED', printJobId: job }
    : name === 'gp.DispatchPassPrint' ? { status: 'DISPATCHED', printJobId: job, firstDispatch: true } : { status: 'FAILED' });
  return { ...f, packet, photo, job, envelope, store: { async read(path: string, maximum: number) { assert.equal(path, packet.storageKey); assert.equal(maximum, 100); return photo; } } };
}
test('replacement encryption remains bound to the existing visit and recovers a fresh opaque QR', async () => {
  const visit = randomUUID(); const first = await prepareReplacementQrEnvelope(visit, keys); const next = await prepareReplacementQrEnvelope(visit, keys);
  assert.equal(first.visitRequestId, visit); assert.notEqual(first.accessPassId, next.accessPassId); assert.notEqual(first.credentialHash, next.credentialHash);
  const raw = await recoverQrCredential(first, keys); assert.equal(hash(raw), first.credentialHash); raw.fill(0);
});
test('replacement uses key-free SQL preflight and projects only reference receipt fields', async () => {
  const data = request(); let calls = 0;
  const f = fake((name, p) => ++calls === 1 ? { status: 'NEEDS_CREDENTIALS' } : { status: 'REISSUED', visitRequestId: data.visitRequestId.toUpperCase(),
    replacedPassId: data.expectedPassId, accessPassId: p.NewAccessPassId.value, passVersion: 2, ciphertext: 'DROP' });
  const result = await new PassPrintService(f.repository, keys).reissue(session(), data);
  assert.equal(f.calls[0].parameters.CredentialHash.value, null); assert.equal(f.calls[1].parameters.Nonce.value instanceof Buffer, true); assert(!JSON.stringify(result).includes('ciphertext'));
});
test('committed replacement receipt survives key provider outage without another key lookup', async () => {
  const data = request(); const f = fake(() => ({ status: 'REISSUED', visitRequestId: data.visitRequestId, replacedPassId: data.expectedPassId, accessPassId: randomUUID(), passVersion: 2 }));
  const source: QrKeySource = { async active() { throw new Error('MUST_NOT_FETCH_KEYS'); }, resolve: keys.resolve };
  await new PassPrintService(f.repository, source).reissue(session(), data); assert.equal(f.calls.length, 1);
});
test('forged envelopes identity and validity fields never reach replacement SQL', async () => {
  const f = fake(() => ({})); const service = new PassPrintService(f.repository, keys); const data = request();
  for (const extra of [{ credentialHash: 'bad' }, { actorUserId: randomUUID() }, { validUntilUtc: 'tomorrow' }, { reason: 'x'.repeat(301) }]) await assert.rejects(service.reissue(session(), { ...data, ...extra }), /INVALID_INPUT/u);
  assert.equal(f.calls.length, 0);
});
test('print request and live status return no internal renderer fields', async () => {
  const data = request(); const id = randomUUID(); const f = fake(() => ({ printJobId: id, visitRequestId: data.visitRequestId, accessPassId: data.expectedPassId,
    printReason: 'FIRST', status: 'REQUESTED', claimToken: 'DROP', storageKey: 'DROP', ciphertext: 'DROP' }));
  const service = new PassPrintService(f.repository, keys); const { reason, ...body } = data;
  const result = await service.request(session(), body); assert(!/claimToken|storageKey|ciphertext/u.test(JSON.stringify(result))); assert.equal((await service.status(session(), id)).printJobId, id);
});
test('pending card carries its identity QR and keeps workflow state out of print', async () => {
  const f = await renderFixture('PENDING'); let encodes = 0; const card = new PassCardRenderer({ errorCorrectionLevel: 'H', async encode(value) { encodes++; return encoder.encode(value); } }, brands);
  const result = await new PassRenderService(f.repository, keys, f.store, card).renderAndDispatch(session(), f.job);
  assert(!/PENDING|APPROVED|NOT VALID|Awaiting|Project access|Online verification/u.test(result.bytes.toString())); assert.equal(encodes, 1); assert.equal(result.cacheControl, 'private, no-store');
});
test('approved card performs actual AES recovery and real QR encoding before handoff', async () => {
  const f = await renderFixture(); let encoded = '';
  const card = new PassCardRenderer({ errorCorrectionLevel: 'H', async encode(value) { encoded = value; return encoder.encode(value); } }, brands);
  const result = await new PassRenderService(f.repository, keys, f.store, card).renderAndDispatch(session(), f.job);
  assert.equal(hash(Buffer.from(encoded, 'base64url')), f.envelope.credentialHash); assert(result.bytes.toString().includes('shape-rendering="crispEdges"'));
  assert.deepEqual(f.calls.map(c => c.name), ['gp.BeginPassRender', 'gp.FinishPassRender', 'gp.DispatchPassPrint']); assert.equal(result.mimeType, 'image/svg+xml');
});
test('card escapes untrusted names and project labels with no scripts or network resources', async () => {
  const f = await renderFixture('PENDING'); const result = await new PassRenderService(f.repository, keys, f.store, renderer).renderAndDispatch(session(), f.job); const text = result.bytes.toString();
  assert(!/<script|https?:\/\/[^w]|onload=|<foreignObject/iu.test(text.replace('http://www.w3.org/2000/svg', '').replace('http://www.w3.org/1999/xlink', '')));
  const labels = [...text.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gu)].map(match => match[1]).join('');
  assert(labels.includes('&lt;script&gt;')); assert(!labels.includes('Project &lt;A&gt;')); assert(!text.includes('storageKey'));
});
test('failed final authorization releases no content and records only a controlled failure code', async () => {
  const f = await renderFixture('PENDING'); const repository: PassPrintRepository = { async execute(name, p) { if (name === 'gp.DispatchPassPrint') throw { number: 53101 }; return f.repository.execute(name, p); } };
  await assert.rejects(new PassRenderService(repository, keys, f.store, renderer).renderAndDispatch(session(), f.job), /NOT_AUTHORIZED/u);
  assert.equal(f.calls.at(-1)?.parameters.FailureCode.value, 'RENDER_FAILED');
});
test('a repeated handoff receipt never releases a second artifact', async () => {
  const f = await renderFixture('PENDING'); const repository: PassPrintRepository = { async execute(name, p) { return name === 'gp.DispatchPassPrint' ? { status: 'DISPATCHED', printJobId: f.job, firstDispatch: false } : f.repository.execute(name, p); } };
  await assert.rejects(new PassRenderService(repository, keys, f.store, renderer).renderAndDispatch(session(), f.job), /CONFLICT/u);
});
test('corrupt photo or unsafe storage path prevents rendering and successful handoff', async () => {
  const f = await renderFixture('PENDING'); await assert.rejects(new PassRenderService(f.repository, keys, { async read() { return Buffer.alloc(100); } }, renderer).renderAndDispatch(session(), f.job), /UNAVAILABLE/u);
  f.packet.storageKey = '../private'; await assert.rejects(new PassRenderService(f.repository, keys, f.store, renderer).renderAndDispatch(session(), f.job), /UNAVAILABLE/u);
  assert(!f.calls.some(c => c.name === 'gp.DispatchPassPrint'));
});
test('wrong AES tag or key context prevents card generation', async () => {
  const f = await renderFixture(); f.packet.authenticationTag = '00'.repeat(16);
  await assert.rejects(new PassRenderService(f.repository, keys, f.store, renderer).renderAndDispatch(session(), f.job), /UNAVAILABLE/u);
  assert(!f.calls.some(c => c.name === 'gp.FinishPassRender'));
});
test('invalid QR matrices cannot become printable credentials', async () => {
  const f = await renderFixture(); const card = new PassCardRenderer({ errorCorrectionLevel: 'H', async encode() { return [[true]]; } }, brands);
  await assert.rejects(new PassRenderService(f.repository, keys, f.store, card).renderAndDispatch(session(), f.job), /UNAVAILABLE/u);
});
test('SQL API and renderer ports enforce separate exact typed allowlists', async () => {
  let calls = 0; const client = { async callProcedure() { calls++; return '{}'; } }; const api = new SqlPassPrintRepository(client, 'api'); const render = new SqlPassPrintRepository(client, 'render');
  await assert.rejects(api.execute('gp.BeginPassRender', {})); await assert.rejects(render.execute('gp.ReissuePass', {})); await assert.rejects(api.execute('gp.RecordMovement', {}));
  const f = await renderFixture('PENDING'); await new PassRenderService(f.repository, keys, f.store, renderer).renderAndDispatch(session(), f.job); const p = f.calls[1].parameters;
  await assert.rejects(render.execute('gp.FinishPassRender', { ...p, ArtifactDigest: { type: 'binary', value: Buffer.alloc(31) } })); assert.equal(calls, 0);
});
test('session failures invalid results and backend exceptions remain redacted', async () => {
  const service = new PassPrintService({ async execute() { throw new Error('PRIVATE_CONNECTION_STRING'); } }, keys);
  await assert.rejects(service.reissue(session(), request()), error => (error as Error).message === 'UNAVAILABLE');
  await assert.rejects(service.status({ ...session(), csrfToken: 'bad' }, randomUUID()), /NOT_AUTHORIZED/u);
});
test('approved compact layout has side branding, a contained photo and stacked validity', async () => {
  const f = await renderFixture('PENDING'); const result = await new PassRenderService(f.repository, keys, f.store, renderer).renderAndDispatch(session(), f.job);
  const svg = result.bytes.toString(); assert(svg.includes('aria-label="Sopra Steria" x="28" y="24" width="320"'));
  assert(svg.includes('width="85.6mm" height="54mm" viewBox="0 0 856 540"'));
  assert(svg.includes('aria-label="GatePass" x="780" y="473" width="48"')); assert(svg.includes('Sopra Steria QR icon'));
  assert(svg.includes('width="156" height="176" preserveAspectRatio="xMidYMid meet"'));
  assert(svg.includes('x="148" y="461"') && svg.includes('x="148" y="494"'));
});
test('approval changes do not change printed card identity or require a new QR', async () => {
  const f = await renderFixture(); const raw = await recoverQrCredential(f.envelope, keys); const credential = raw.toString('base64url'); raw.fill(0);
  const data = { personName: 'Visitor 1', requestType: 'EXTERNAL', publicReference: 'V-SAMPLE', publicPassNumber: 'GP-SAMPLE', locationName: 'Noida',
    projectName: 'PRIVATE PROJECT', validFromUtc: '2026-10-20T03:00:00.000Z', validUntilUtc: '2026-10-20T18:30:00.000Z',
    employeeId: null, hostEmployeeId: 'EMP019', hostName: 'Employee 19', purpose: 'Client meeting', assignedProjectCount: 0, assignedProjects: [] };
  const pending = await renderer.render({ ...data, visitStatus: 'PENDING' }, f.photo, 'image/jpeg', credential);
  const approved = await renderer.render({ ...data, visitStatus: 'APPROVED' }, f.photo, 'image/jpeg', credential);
  assert(pending.equals(approved)); assert(!pending.toString().includes(data.projectName));
});
test('centre-branded QR decodes to exact payload across multiple raster sizes', async () => {
  const path = process.env.GATEPASS_SHARP_PATH; assert(path, 'Set the existing sharp package path for actual QR raster/decode verification.');
  const sharp = createRequire(import.meta.url)(path); const photo = await sharp({ create: { width: 30, height: 40, channels: 3, background: '#c8d0dc' } }).png().toBuffer();
  const data = { personName: 'Employee 1', requestType: 'DIGITAL_ID', publicReference: 'V-SAMPLE', publicPassNumber: 'GP-SAMPLE', visitStatus: 'APPROVED' as const,
    locationName: 'Noida', validFromUtc: '2026-10-20T03:00:00.000Z', validUntilUtc: '2026-10-20T18:30:00.000Z',
    employeeId: 'EMP001', hostEmployeeId: null, hostName: null, purpose: 'Forgot physical ID', assignedProjectCount: 4,
    assignedProjects: ['APOLLO', 'BEACON', 'COMPASS'].map(code => ({ code, name: code })) };
  const decode = async (bytes: Buffer) => {
    // Independent detector can select a false finder candidate in one orientation.
    // Try the four camera orientations; never supply payload or matrix to the decoder.
    for (const angle of [0, 90, 180, 270]) {
      const raw = await sharp(bytes).rotate(angle).flatten({ background: 'white' }).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
      const luminance = new RGBLuminanceSource(new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength), raw.info.width, raw.info.height);
      try { return new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(luminance)), new Map([[DecodeHintType.TRY_HARDER, true]])).getText(); } catch { /* Try next orientation. */ }
    }
    throw new Error('QR_NOT_DECODED');
  };
  for (let sample = 0; sample < 24; sample++) {
    const token = createHash('sha256').update(`GatePass synthetic QR regression ${sample}`).digest('base64url'); const svg = await renderer.render({ ...data, visitStatus: sample % 2 ? 'APPROVED' : 'PENDING' }, photo, 'image/png', token);
    assert(svg.toString().includes('Sopra Steria QR icon'));
    for (const width of [600, 1000, 1600]) {
      // Render the vector at the target density; enlarging a 72-DPI thumbnail loses QR modules.
      const factor = width / 856; const png = await sharp(svg, { density: width * 25.4 / 85.6 }).resize({ width }).png().toBuffer();
      const crop = await sharp(png).extract({ left: Math.floor(624 * factor), top: Math.floor(132 * factor), width: Math.ceil(208 * factor), height: Math.ceil(208 * factor) }).png().toBuffer();
      try { assert(await decode(crop) === token); } catch { assert.fail(`Branded QR crop decode failed: sample ${sample}, width ${width}.`); }
      if (width === 1000) { try { assert(await decode(png) === token); } catch { assert.fail(`Full-card QR decode failed: sample ${sample}.`); } }
    }
  }
});
test('malformed trusted card packets fail before completion or artifact release', async () => {
  for (const details of [null, {}, { employeeId: null, hostEmployeeId: 'E1', hostName: 'Host', purpose: 'Meeting', assignedProjectCount: 1, assignedProjects: [] },
    { employeeId: 'E2', hostEmployeeId: 'E1', hostName: 'Host', purpose: 'Meeting', assignedProjectCount: 0, assignedProjects: [] }]) {
    const f = await renderFixture(); f.packet.cardDetails = details;
    await assert.rejects(new PassRenderService(f.repository, keys, f.store, renderer).renderAndDispatch(session(), f.job), /UNAVAILABLE/u);
    assert(!f.calls.some(c => c.name === 'gp.FinishPassRender' || c.name === 'gp.DispatchPassPrint'));
  }
});
test('print caller cannot supply employee host purpose or project overrides', async () => {
  const f = fake(() => ({})); const service = new PassPrintService(f.repository, keys); const { reason, ...body } = request();
  for (const extra of [{ cardDetails: {} }, { hostEmployeeId: 'E1' }, { purpose: 'Override' }, { assignedProjects: [] }]) await assert.rejects(service.request(session(), { ...body, ...extra }), /INVALID_INPUT/u);
  assert.equal(f.calls.length, 0);
});
test('employee project pass uses its own assignments and an honest overflow count', async () => {
  const f = await renderFixture(); f.packet.requestType = 'EMPLOYEE_PROJECT'; f.packet.cardDetails = { employeeId: 'EMP001', hostEmployeeId: null, hostName: null,
    purpose: 'Project support', assignedProjectCount: 4, assignedProjects: ['APOLLO', 'BEACON', 'COMPASS'].map(code => ({ code, name: code })) };
  const result = await new PassRenderService(f.repository, keys, f.store, renderer).renderAndDispatch(session(), f.job); const svg = result.bytes.toString();
  assert(svg.includes('EMPLOYEE PASS')); assert(svg.includes('EMP001')); assert(svg.includes('4 assigned')); assert(svg.includes('+1 more')); assert(!svg.includes('VISITOR PASS'));
});
test('long identity fields remain clipped inside their text columns', async () => {
  const f = await renderFixture(); f.packet.personName = 'Long visitor name '.repeat(10); f.packet.cardDetails = { employeeId: null, hostEmployeeId: 'W'.repeat(64),
    hostName: 'Long host name '.repeat(12), purpose: '<private> '.repeat(90), assignedProjectCount: 0, assignedProjects: [] };
  const result = await new PassRenderService(f.repository, keys, f.store, renderer).renderAndDispatch(session(), f.job); const svg = result.bytes.toString();
  const blocks = [...svg.matchAll(/<svg x="207" y="([\d.]+)" width="390" height="([\d.]+)"[^>]*overflow="hidden"/gu)];
  assert(blocks.length >= 4); for (const match of blocks) assert(Number(match[1]) + Number(match[2]) < 425);
  assert(svg.includes('…')); assert(!svg.includes('<private>')); assert(!svg.includes('\uFFFD'));
});
test('duplicate or inconsistent employee project summaries cannot be rendered', async () => {
  const f = await renderFixture(); f.packet.requestType = 'DIGITAL_ID'; f.packet.cardDetails = { employeeId: 'EMP001', hostEmployeeId: null, hostName: null,
    purpose: 'Forgot physical ID', assignedProjectCount: 2, assignedProjects: [{ code: 'A', name: 'A' }, { code: 'A', name: 'Again' }] };
  await assert.rejects(new PassRenderService(f.repository, keys, f.store, renderer).renderAndDispatch(session(), f.job), /UNAVAILABLE/u);
  assert(!f.calls.some(c => c.name === 'gp.FinishPassRender'));
});
