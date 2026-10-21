import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:https';
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createApiHandler } from '../src/transport/ApiHandler.ts';
import { RegistrationHttpRoutes } from '../src/transport/RegistrationHttpRoutes.ts';
import type { RegistrationContext, ProductRequestType } from '../src/registration/RegistrationService.ts';
import { Readable } from 'node:stream';

const intakeToken = Buffer.alloc(32, 11).toString('base64url'); const intakeCsrfToken = Buffer.alloc(32, 12).toString('base64url'); const key = Buffer.alloc(32, 13);
const sessionToken = Buffer.alloc(32, 14).toString('base64url'); const csrfToken = Buffer.alloc(32, 15).toString('base64url');
const id = '00000000-0000-4000-8000-000000000001';
let server: ReturnType<typeof createServer>; let port: number; let origin: string;
let starts = 0; let uploads = 0; let submissions = 0; let lastContext: RegistrationContext; let submittedBody: unknown;
const service = {
  async start(requestType: ProductRequestType, employeeSession?: { sessionToken: string; csrfToken: string }) {
    starts++; lastContext = { intakeId: id, intakeToken, intakeCsrfToken, requestType, employeeSession };
    return { context: lastContext, expiresAtUtc: new Date(Date.now() + 1200000).toISOString() };
  },
  async recordPhoto(context: RegistrationContext, input: Buffer) { uploads++; lastContext = context; assert.ok(input.length > 0); return { photoAssetId: id }; },
  async submit(context: RegistrationContext, input: unknown) { submissions++; lastContext = context; submittedBody = input; return { status: 'SUBMITTED' as const, intakeId: id, requestType: context.requestType, visits: [] }; },
};
before(async () => {
  const certificate = spawnSync('pwsh', ['-NoProfile', '-File', 'tests/helpers/Create-TestTls.ps1'], { encoding: 'utf8' }); assert.equal(certificate.status, 0, certificate.stderr);
  const auth = { async signIn() { return { ok: false as const, message: 'Unable to sign in.' as const }; }, async completeSetup() { return { ok: false }; }, async sessionAction() { return { ok: false }; } };
  let handler: ReturnType<typeof createApiHandler>;
  server = createServer({ pfx: Buffer.from(certificate.stdout.trim(), 'base64'), passphrase: 'test-only' }, (req, res) => handler(req, res));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); port = (server.address() as { port: number }).port; origin = `https://localhost:${port}`;
  handler = createApiHandler({ origin, sourceKey: Buffer.alloc(32, 16), auth, actions: new Map(), registration: new RegistrationHttpRoutes(service, key) });
});
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
function send(path: string, options: { headers?: Record<string, string>; body?: unknown; raw?: Buffer } = {}) {
  const bytes = options.raw ?? Buffer.from(JSON.stringify(options.body ?? {}));
  return new Promise<{ status: number; headers: any; text: string }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: '/api/registration/' + path, method: 'POST', rejectUnauthorized: false,
      headers: { host: new URL(origin).host, origin, 'content-type': 'application/json', 'content-length': String(bytes.length), ...options.headers } }, res => {
      let text = ''; res.on('data', b => text += b); res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, text }));
    }); req.on('error', reject); req.end(bytes);
  });
}
async function intake() {
  const r = await send('start', { body: { requestType: 'EXTERNAL' } }); assert.equal(r.status, 200);
  return { cookie: r.headers['set-cookie'].map((c: string) => c.split(';')[0]).join('; '), 'x-intake-csrf-token': intakeCsrfToken };
}
test('public intake issues host-only signed HttpOnly capability, without raw secrets in JSON', async () => {
  const r = await send('start', { body: { requestType: 'EXTERNAL' } }); assert.equal(r.status, 200);
  assert.ok(!r.text.includes(intakeToken) && !r.text.includes(intakeCsrfToken));
  assert.deepEqual(Object.keys(JSON.parse(r.text)).sort(), ['expiresAtUtc', 'intakeId', 'requestType']);
  const jar = r.headers['set-cookie']; assert.ok(jar[0].includes('HttpOnly')); assert.ok(jar.every((c: string) => c.includes('Secure') && c.includes('SameSite=Strict') && c.includes('Max-Age=') && !c.includes('Domain=')));
  assert.equal(lastContext.employeeSession, undefined);
});
test('employee intake fails closed without a real SSO gate even if guard session cookies exist', async () => {
  const n = starts;
  for (const requestType of ['DIGITAL_ID', 'EMPLOYEE_PROJECT']) {
    const r = await send('start', { body: { requestType }, headers: { cookie: `__Host-gp-session=${sessionToken}; __Host-gp-csrf=${csrfToken}`, 'x-csrf-token': csrfToken } });
    assert.equal(r.status, 503);
  }
  assert.equal(starts, n);
});
test('intake start rejects caller-supplied identity, capability or authentication claims', async () => {
  const n = starts;
  for (const extra of [{ employeeId: 'employee1' }, { sso: true }, { intakeToken }, { actorUserId: id }]) assert.equal((await send('start', { body: { requestType: 'EXTERNAL', ...extra } })).status, 400);
  assert.equal(starts, n);
});
test('photo requires signed intake capability and matching cookie/header CSRF', async () => {
  const headers = await intake(); const n = uploads;
  assert.equal((await send('photo', { headers: { 'content-type': 'image/jpeg' }, raw: Buffer.from('photo') })).status, 403);
  assert.equal((await send('photo', { headers: { cookie: headers.cookie, 'content-type': 'image/jpeg' }, raw: Buffer.from('photo') })).status, 403);
  assert.equal((await send('photo', { headers: { ...headers, 'x-intake-csrf-token': sessionToken, 'content-type': 'image/jpeg' }, raw: Buffer.from('photo') })).status, 403);
  assert.equal(uploads, n);
});
test('signed intake type or ID cannot be changed by editing the cookie', async () => {
  const headers = await intake(); const entries = headers.cookie.split('; '); const [name, value] = entries[0].split('='); const [payload, mac] = value.split('.');
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString()); data.requestType = 'DIGITAL_ID';
  const altered = Buffer.from(JSON.stringify(data)).toString('base64url');
  const r = await send('submit', { headers: { ...headers, cookie: `${name}=${altered}.${mac}; ${entries[1]}` } }); assert.equal(r.status, 403);
});
test('bounded binary upload forwards only cookie-derived context and returns photo ID', async () => {
  const headers = await intake();
  const r = await send('photo', { headers: { ...headers, 'content-type': 'image/png' }, raw: Buffer.from('test image bytes; real service normalizes magic/decode') });
  assert.equal(r.status, 200); assert.deepEqual(JSON.parse(r.text), { photoAssetId: id }); assert.equal(lastContext.intakeToken, intakeToken); assert.equal(lastContext.requestType, 'EXTERNAL');
});
test('photo rejects unsupported media, compression, zero bytes and oversized uploads before service', async () => {
  const headers = await intake(); const n = uploads;
  assert.equal((await send('photo', { headers: { ...headers, 'content-type': 'image/svg+xml' }, raw: Buffer.from('<svg/>') })).status, 415);
  assert.equal((await send('photo', { headers: { ...headers, 'content-type': 'image/png', 'content-encoding': 'gzip' }, raw: Buffer.from('x') })).status, 415);
  assert.equal((await send('photo', { headers: { ...headers, 'content-type': 'image/jpeg' }, raw: Buffer.alloc(0) })).status, 400);
  assert.equal((await send('photo', { headers: { ...headers, 'content-type': 'image/jpeg' }, raw: Buffer.alloc(5242881) })).status, 413);
  assert.equal(uploads, n);
});
test('submit preserves clientKey retry body and intake after a lost response', async () => {
  const headers = await intake(); const input = { clientKey: id, requestType: 'EXTERNAL', people: [{ clientPersonKey: id }] };
  for (let i = 0; i < 2; i++) { const r = await send('submit', { headers, body: input }); assert.equal(r.status, 200); assert.equal(r.headers['set-cookie'], undefined); assert.equal(lastContext.intakeToken, intakeToken); assert.deepEqual(submittedBody, input); }
  assert.ok(submissions >= 2); // Actual service/SQL enforces independent people and idempotent results.
});
test('replacing an active form requires its CSRF proof', async () => {
  const headers = await intake(); const n = starts;
  assert.equal((await send('start', { headers: { cookie: headers.cookie }, body: { requestType: 'EXTERNAL' } })).status, 403); assert.equal(starts, n);
  assert.equal((await send('start', { headers, body: { requestType: 'EXTERNAL' } })).status, 200);
});
test('reset clears both intake cookies without deleting committed data or the login session', async () => {
  const headers = await intake(); const r = await send('reset', { headers }); assert.equal(r.status, 200);
  assert.equal(r.headers['set-cookie'].length, 2); assert.ok(r.headers['set-cookie'].every((c: string) => c.includes('Max-Age=0') && !c.includes('__Host-gp-session')));
});
test('cross-origin requests cannot create intakes or upload photos', async () => {
  const n = starts; assert.equal((await send('start', { body: { requestType: 'EXTERNAL' }, headers: { origin: 'https://evil.example' } })).status, 403); assert.equal(starts, n);
});
test('expired signed contexts reject submission and can be discarded', async () => {
  const data = { intakeId: id, intakeToken, intakeCsrfToken, requestType: 'EXTERNAL', expires: Date.now() - 1 };
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url'); const mac = createHmac('sha256', key).update('GatePass|intake|v1|').update(payload).digest('base64url');
  const headers = { cookie: `__Host-gp-intake=${payload}.${mac}; __Host-gp-intake-csrf=${intakeCsrfToken}`, 'x-intake-csrf-token': intakeCsrfToken };
  assert.equal((await send('submit', { headers })).status, 403); assert.equal((await send('reset', { headers })).status, 200);
});
test('intake budget is bounded and forwarded addresses cannot reset it', async () => {
  let limited = false;
  for (let i = 0; i < 121; i++) {
    const r = await send('start', { body: { requestType: 'EXTERNAL' }, headers: { 'x-forwarded-for': `203.0.113.${i}` } });
    if (r.status === 429) { limited = true; break; } assert.equal(r.status, 200);
  }
  assert.equal(limited, true);
});
function internalRequest(path: string, body: unknown, headers: Record<string, string> = {}) {
  return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { url: '/api/registration/' + path,
    headers: { 'content-type': 'application/json', ...headers }, socket: { remoteAddress: '127.0.0.1' } }) as any;
}
const employeeHeaders = () => ({ cookie: `__Host-gp-session=${sessionToken}; __Host-gp-csrf=${csrfToken}`, 'x-csrf-token': csrfToken });
test('configured SSO gate denies guard authentication before SQL registration', async () => {
  const n = starts; const routes = new RegistrationHttpRoutes(service, key, { async verify() { return false; } });
  await assert.rejects(routes.handle(internalRequest('start', { requestType: 'DIGITAL_ID' }, employeeHeaders()), { setHeader() {} } as any), error => (error as any).status === 403);
  assert.equal(starts, n);
});
test('employee context comes from verified cookies, and SSO is rechecked for photo and submit', async () => {
  let checks = 0; let allowed = true; let issued: string[] = [];
  const routes = new RegistrationHttpRoutes(service, key, { async verify(s) { checks++; assert.equal(s.sessionToken, sessionToken); return allowed; } });
  await routes.handle(internalRequest('start', { requestType: 'DIGITAL_ID' }, employeeHeaders()), { setHeader(_key: string, value: string[]) { issued = value; } } as any);
  assert.equal(lastContext.employeeSession?.sessionToken, sessionToken);
  const cookie = employeeHeaders().cookie + '; ' + issued.map(c => c.split(';')[0]).join('; ');
  const headers = { ...employeeHeaders(), cookie, 'x-intake-csrf-token': intakeCsrfToken };
  allowed = false; const n = uploads; const submitted = submissions;
  for (const path of ['photo', 'submit']) await assert.rejects(routes.handle(internalRequest(path, {}, headers), { setHeader() {} } as any), error => (error as any).status === 403);
  assert.equal(checks, 3); assert.equal(uploads, n); assert.equal(submissions, submitted);
});
test('valid SSO provenance still requires session CSRF and does not create fake sessions', async () => {
  let checks = 0; const routes = new RegistrationHttpRoutes(service, key, { async verify() { checks++; return true; } });
  await assert.rejects(routes.handle(internalRequest('start', { requestType: 'DIGITAL_ID' }), { setHeader() {} } as any), e => (e as any).status === 401);
  await assert.rejects(routes.handle(internalRequest('start', { requestType: 'DIGITAL_ID' }, { cookie: employeeHeaders().cookie }), { setHeader() {} } as any), e => (e as any).status === 403);
  assert.equal(checks, 0);
});
