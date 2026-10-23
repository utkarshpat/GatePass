import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { AdminRoutes } from '../src/development/AdminRoutes.ts';
import { GuardRoutes } from '../src/development/GuardRoutes.ts';
import { EmployeeDigitalIdRoutes } from '../src/development/EmployeeDigitalIdRoutes.ts';
import { EmailWorkflowRoutes } from '../src/development/EmailWorkflowRoutes.ts';
import { OwnCardError } from '../src/printing/OwnDigitalIdCardService.ts';

const env = { NODE_ENV: process.env.NODE_ENV, GATEPASS_SSO_MODE: process.env.GATEPASS_SSO_MODE, GATEPASS_DIRECTORY_MODE: process.env.GATEPASS_DIRECTORY_MODE };
before(() => Object.assign(process.env, { NODE_ENV: 'test', GATEPASS_SSO_MODE: 'dummy', GATEPASS_DIRECTORY_MODE: 'mock' }));
after(() => { for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v; });
const session = { sessionToken: randomBytes(32).toString('base64url'), csrfToken: randomBytes(32).toString('base64url') };
const id = '00000000-0000-4000-8000-000000000001';
const response = {} as any;
function request(path: string, body: unknown = {}, address = '127.0.0.1') {
 return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { url: path, socket: { remoteAddress: address }, headers: { 'content-type': 'application/json', cookie: `gp-dev-session=${session.sessionToken}; gp-dev-csrf=${session.csrfToken}`, 'x-csrf-token': session.csrfToken } }) as any;
}
function fixture() {
 const calls: { name: string; args: any[] }[] = [];
 const state = { valid: true, visit: true, changed: false, cardError: undefined as unknown };
 const photo = Buffer.from('private-photo'); let detailCalls = 0;
 const record = (name: string, result: unknown) => async (...args: any[]) => { calls.push({ name, args }); return result; };
 const staff = { session: (...args: any[]) => { calls.push({ name: 'session', args }); return session; }, verify: async () => state.valid };
 const sso = { verify: async () => state.valid };
 const visit = { visitRequestId: id, accessPassId: 'pass-one', requestType: 'DIGITAL_ID' };
 const reads = { read: record('admin-read', { ok: true }), detail: record('read-detail', visit), workContexts: record('contexts', []) };
 const duties = { administration: record('administration', []), manage: record('manage', { ok: true }), duties: record('duties', []), visitors: record('visitors', []), movement: record('movement', { ok: true }), detail: async (...args: any[]) => { calls.push({ name: 'duty-detail', args }); detailCalls++; return { visit: state.visit ? { ...visit, accessPassId: state.changed && detailCalls > 1 ? 'replacement-pass' : visit.accessPassId } : null }; } };
 const workspace = { read: record('workspace', {}), lookup: record('lookup', id) };
 const photos = { read: record('photo', { mimeType: 'image/jpeg', bytes: photo }) };
 const writes = { grant: record('grant', {}), revoke: record('revoke', {}) };
 const cards = { image: async (...args: any[]) => { calls.push({ name: 'image', args }); if (state.cardError) throw state.cardError; return { imageBase64: 'png' }; } };
 const service = { detail: record('email-detail', visit), decide: record('decide', { ok: true }) };
 return { state, calls, photo, reads, workspace, service, duties,
  admin: new AdminRoutes(staff as any, reads as any, writes as any, duties as any),
  guard: new GuardRoutes(staff as any, workspace as any, reads as any, photos as any, duties as any),
  employee: new EmployeeDigitalIdRoutes(sso as any, reads as any, cards as any),
  email: new EmailWorkflowRoutes(sso as any, service as any, photos as any, cards as any, cards as any) };
}
const rejectsStatus = (promise: Promise<unknown>, status: number) => assert.rejects(promise, (e: any) => e.status === status);

for (const kind of ['admin', 'guard'] as const) {
 test(`${kind} rejects remote callers, unknown routes and expired sessions before service access`, async () => {
  const f = fixture(); const route = f[kind];
  await rejectsStatus(route.handle(request(`/api/${kind}/context`, {}, '192.0.2.1'), response), 403);
  await rejectsStatus(route.handle(request(`/api/${kind}/unknown`), response), 404);
  assert.equal(route.handles(`/api/${kind}/context?scope=all`), false);
  f.state.valid = false;
  await rejectsStatus(route.handle(request(`/api/${kind}/context`), response), 401);
  assert.ok(!f.calls.some(c => c.name !== 'session'));
 });
}
test('admin dispatch preserves authenticated identity and limits grant roles/scopes', async () => {
 const f = fixture();
 for (const [action, name] of [['context', 'admin-read'], ['projects', 'admin-read'], ['leads', 'admin-read'], ['candidates', 'admin-read'], ['common-duties', 'administration'], ['common-duty', 'manage'], ['revoke', 'revoke'], ['grant', 'grant']]) {
  const body = action === 'grant' ? { roleCode: 'PROJECT_ADMIN', scopeType: 'PROJECT_LOCATION' } : { locationId: 1 };
  await f.admin.handle(request('/api/admin/' + action, body), response);
  const call = f.calls.findLast(c => c.name === name)!;
  assert.deepEqual(call.args[0], session);
  assert.deepEqual(call.args.at(-1), body);
 }
 for (const body of [{ roleCode: 'INDIA_ADMIN', scopeType: 'PROJECT' }, { roleCode: 'PROJECT_ADMIN', scopeType: 'COUNTRY' }]) await rejectsStatus(f.admin.handle(request('/api/admin/grant', body), response), 400);
 assert.equal(f.calls.filter(c => c.name === 'grant').length, 1);
});
test('admin office-qr generates decodable QR code with organization badge', async () => {
 const f = fixture();
 f.reads.read = async (_session: any, action: string) => {
  if (action === 'context') return { locations: [{ locationId: 10, locationCode: 'noida', locationName: 'Noida SEZ' }] };
  return {};
 };
 const req = request('/api/admin/office-qr', { locationId: 10 });
 req.headers.origin = 'http://localhost:8443';
 const result = await f.admin.handle(req, response);
 assert.equal(result.url, 'http://localhost:8443/office/noida');
 assert.equal(result.locationName, 'Noida SEZ');
 assert.match(result.imageDataUrl, /^data:image\/png;base64,/);

 const sharpPath = process.env.GATEPASS_SHARP_PATH;
 if (sharpPath) {
  const { createRequire } = await import('node:module');
  const sharp = createRequire(import.meta.url)(sharpPath);
  const ZXing = await import('@zxing/library');
  const pngBuf = Buffer.from(result.imageDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
  const raw = await sharp(pngBuf).flatten({ background: 'white' }).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const luminance = new ZXing.RGBLuminanceSource(new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength), raw.info.width, raw.info.height);
  const text = new ZXing.QRCodeReader().decode(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(luminance)), new Map([[ZXing.DecodeHintType.TRY_HARDER, true]])).getText();
  assert.equal(text, 'http://localhost:8443/office/noida');
 }
 const fallbackAdmin = new AdminRoutes({ session: () => session, verify: async () => true } as any, f.reads as any, {} as any, f.duties as any, undefined, undefined, undefined, Buffer.from('bad'), () => { throw new Error('broken'); });
 const fallbackReq = request('/api/admin/office-qr', { locationId: 10 });
 fallbackReq.headers.origin = 'http://localhost:8443';
 const fallbackResult = await fallbackAdmin.handle(fallbackReq, response);
 assert.match(fallbackResult.imageDataUrl, /^data:image\/png;base64,/);
});
test('guard dispatch fixes read scope and validates context/lookup request shapes', async () => {
 const f = fixture();
 for (const [action, name, body] of [ ['context', 'workspace', {}], ['duties', 'duties', { locationId: 1 }], ['visitors', 'visitors', { locationId: 1 }], ['projects', 'contexts', { locationId: 1 }], ['recent', 'workspace', { locationId: 1 }], ['verify', 'duty-detail', { visitRequestId: id }], ['movement', 'movement', { visitRequestId: id }], ['detail', 'duty-detail', { visitRequestId: id }] ] as const) {
  await f.guard.handle(request('/api/guard/' + action, body), response);
  const call = f.calls.findLast(c => c.name === name)!;
  assert.deepEqual(call.args[0], name === 'contexts' ? { ...session, view: 'GUARD' } : session);
 }
 const found = await f.guard.handle(request('/api/guard/lookup', { locationId: 1, publicReference: 'GP-1' }), response);
 assert.equal(found.visits.length, 1);
 assert.deepEqual(f.calls.findLast(c => c.name === 'read-detail')!.args, [{ ...session, view: 'GUARD' }, id]);
 f.workspace.lookup = async () => null as any;
 assert.deepEqual(await f.guard.handle(request('/api/guard/lookup', { locationId: 1, publicReference: 'missing' }), response), { visits: [] });
 for (const action of ['context', 'projects', 'recent', 'lookup']) await rejectsStatus(f.guard.handle(request('/api/guard/' + action, { actor: 'other' }), response), 400);
});
for (const changed of [false, true]) test(`guard photo ${changed ? 'rejects replaced pass' : 'returns authorized bytes'} and wipes private buffer`, async () => {
 const f = fixture(); f.state.changed = changed;
 const pending = f.guard.handle(request('/api/guard/photo', { visitRequestId: id }), response);
 if (changed) await rejectsStatus(pending, 403);
 else assert.deepEqual(await pending, { mimeType: 'image/jpeg', imageBase64: Buffer.from('private-photo').toString('base64') });
 assert.ok(f.photo.every(b => b === 0));
});
test('guard cannot disclose detail or photo when duty authorization is denied', async () => {
 const f = fixture(); f.state.visit = false;
 for (const action of ['detail', 'photo']) await rejectsStatus(f.guard.handle(request('/api/guard/' + action), response), 403);
 assert.ok(!f.calls.some(c => c.name === 'photo'));
});
for (const kind of ['employee', 'email'] as const) test(`${kind} requires canonical session, CSRF binding and active identity`, async () => {
 const path = kind === 'employee' ? '/api/employee/digital-id/detail' : '/api/email/host/detail';
 const f = fixture(), route = f[kind];
 await rejectsStatus(route.handle(request('/unknown'), response), 404);
 const absent = request(path); delete absent.headers.cookie;
 await rejectsStatus(route.handle(absent, response), 401);
 for (const mode of ['missing-header', 'missing-cookie', 'mismatch']) {
  const req = request(path);
  if (mode === 'missing-header') delete req.headers['x-csrf-token'];
  if (mode === 'missing-cookie') req.headers.cookie = `gp-dev-session=${session.sessionToken}`;
  if (mode === 'mismatch') req.headers['x-csrf-token'] = randomBytes(32).toString('base64url');
  await rejectsStatus(route.handle(req, response), 403);
 }
 f.state.valid = false; await rejectsStatus(route.handle(request(path), response), kind === 'employee' ? 403 : 401);
 assert.deepEqual(f.calls, []);
});
test('employee detail is OWN only and cannot return another request type', async () => {
 const f = fixture(), path = '/api/employee/digital-id/detail';
 assert.equal(f.employee.handles(path), true);
 for (const body of [{}, { visitRequestId: id, view: 'ADMIN' }]) await rejectsStatus(f.employee.handle(request(path, body), response), 400);
 await f.employee.handle(request(path, { visitRequestId: id }), response);
 assert.deepEqual(f.calls.at(-1)!.args, [{ ...session, view: 'OWN' }, id]);
 f.reads.detail = async () => ({ requestType: 'VISITOR' } as any);
 await rejectsStatus(f.employee.handle(request(path, { visitRequestId: id }), response), 403);
});
test('employee image handles absent provider, private provider errors and typed denials', async () => {
 const f = fixture(), path = '/api/employee/digital-id/image', body = { visitRequestId: id };
 const unavailable = new EmployeeDigitalIdRoutes({ verify: async () => true } as any, f.reads as any);
 await rejectsStatus(unavailable.handle(request(path, body), response), 503);
 assert.deepEqual(await f.employee.handle(request(path, body), response), { imageBase64: 'png' });
 for (const error of [new OwnCardError(403), new Error('private provider failure')]) {
  f.state.cardError = error; await rejectsStatus(f.employee.handle(request(path, body), response), error instanceof OwnCardError ? 403 : 503);
 }
});
test('email routes separate HOST/OWN reads, decisions and images; photo is reauthorized and wiped', async () => {
 const f = fixture(), body = { visitRequestId: id };
 for (const [path, name, mode] of [['host/detail', 'email-detail', 'HOST'], ['request/detail', 'email-detail', 'OWN'], ['host/decide', 'decide', undefined]] as const) {
  await f.email.handle(request('/api/email/' + path, body), response);
  assert.deepEqual(f.calls.at(-1), { name, args: mode ? [session, body, mode] : [session, body] });
 }
 await f.email.handle(request('/api/email/request/image', body), response);
 assert.equal(f.calls.at(-2)!.args[2], 'OWN');
 for (const error of [new OwnCardError(403), new Error('private image failure')]) {
  f.state.cardError = error; await rejectsStatus(f.email.handle(request('/api/email/request/image', body), response), error instanceof OwnCardError ? 403 : 503);
 }
 const result = await f.email.handle(request('/api/email/host/photo', body), response);
 assert.equal(result.imageBase64, Buffer.from('private-photo').toString('base64'));
 assert.ok(f.photo.every(b => b === 0));
 assert.equal(f.calls.filter(c => c.name === 'email-detail' && c.args[2] === 'HOST').length, 3);
});
test('all development adapters are disabled outside the explicit dummy environment', async () => {
 const f = fixture(); process.env.GATEPASS_SSO_MODE = 'real';
 try { for (const route of [f.admin, f.guard, f.employee, f.email]) await assert.rejects(route.handle(request('/unknown'), response), /DUMMY_SSO_DISABLED/); }
 finally { process.env.GATEPASS_SSO_MODE = 'dummy'; }
});
test('email photo revocation during read rejects response and wipes the bytes', async () => {
 const f = fixture(); let reads = 0;
 f.service.detail = async () => { if (++reads === 2) throw new OwnCardError(403); return { visitRequestId: id } as any; };
 await rejectsStatus(f.email.handle(request('/api/email/host/photo', { visitRequestId: id }), response), 403);
 assert.ok(f.photo.every(b => b === 0));
});
test('guard photo revocation during read rejects response and wipes the bytes', async () => {
 const f = fixture(); let reads = 0;
 f.duties.detail = async () => ({ visit: ++reads === 1 ? { visitRequestId: id, accessPassId: 'one' } as any : null });
 await rejectsStatus(f.guard.handle(request('/api/guard/photo', { visitRequestId: id }), response), 403);
 assert.ok(f.photo.every(b => b === 0));
});
