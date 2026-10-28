import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { RequestAdmission } from '../src/transport/RequestAdmission.ts';
import { createApiHandler, readJsonBody } from '../src/transport/ApiHandler.ts';
import { createLoopbackHttpHandler } from '../src/development/LoopbackHttpHandler.ts';

const a = 'a'.repeat(64), b = 'b'.repeat(64), c = 'c'.repeat(64);
test('public overload cannot occupy the slots reserved for protected work; release is idempotent', () => {
  const admission = new RequestAdmission({ maxInFlight: 2, maxPublicInFlight: 1 });
  const publicTicket = admission.enter(a, true); assert(publicTicket.allowed);
  assert.deepEqual(admission.enter(b, true), { allowed: false, retryAfter: 1 });
  const protectedTicket = admission.enter(b, false); assert(protectedTicket.allowed);
  assert.equal(admission.enter(c, false).allowed, false);
  publicTicket.release(); publicTicket.release();
  const another = admission.enter(c, false); assert(another.allowed);
  assert.equal(admission.enter(a, false).allowed, false);
  another.release(); protectedTicket.release();
  assert(admission.enter(a, true).allowed);
});

test('public source budget survives release and recovers at its exact window boundary', () => {
  let now = 0; const admission = new RequestAdmission({ publicRequestsPerMinute: 2 }, () => now);
  for (let n = 0; n < 2; n++) { const ticket = admission.enter(a, true); assert(ticket.allowed); ticket.release(); }
  assert.deepEqual(admission.enter(a, true), { allowed: false, retryAfter: 60 });
  now = 59999; assert.deepEqual(admission.enter(a, true), { allowed: false, retryAfter: 1 });
  const other = admission.enter(b, true); assert(other.allowed); other.release();
  now = 60000; assert(admission.enter(a, true).allowed);
});

test('source bookkeeping is bounded and expires without blocking protected requests', () => {
  let now = 0; const admission = new RequestAdmission({ maximumSources: 2 }, () => now);
  for (const source of [a, b]) { const ticket = admission.enter(source, true); assert(ticket.allowed); ticket.release(); }
  assert.deepEqual(admission.enter(c, true), { allowed: false, retryAfter: 60 });
  const protectedTicket = admission.enter(c, false); assert(protectedTicket.allowed); protectedTicket.release();
  now = 60000; assert(admission.enter(c, true).allowed);
});

test('invalid admission policy and raw/unbounded source identifiers fail closed', () => {
  for (const limits of [{ maxInFlight: 0 }, { maxInFlight: 129 }, { maxPublicInFlight: 1.2 }, { maxInFlight: 1, maxPublicInFlight: 2 }, { publicRequestsPerMinute: 6001 }, { maximumSources: 0 }]) assert.throws(() => new RequestAdmission(limits));
  const admission = new RequestAdmission();
  for (const source of ['127.0.0.1', '', 'X'.repeat(64), 'a'.repeat(65)]) assert.throws(() => admission.enter(source, true));
});

const origin = 'https://gatepass.example.invalid';
const session = Buffer.alloc(32, 3).toString('base64url'), csrf = Buffer.alloc(32, 4).toString('base64url');
const authenticated = { cookie: `__Host-gp-session=${session}; __Host-gp-csrf=${csrf}`, 'x-csrf-token': csrf };
const auth = { async signIn() { return { ok: false as const, message: 'Unable to sign in.' as const }; }, async completeSetup() { return { ok: false }; }, async sessionAction() { return { ok: false }; } };
function request(path: string, headers: Record<string, string> = {}, raw = '{}') {
  return Object.assign(Readable.from([Buffer.from(raw)]), { method: 'POST', url: path, socket: { encrypted: true, remoteAddress: '127.0.0.1' }, headers: { host: new URL(origin).host, origin, 'content-type': 'application/json', ...headers } }) as any;
}
function response() {
  const result = { status: 0, headers: {} as Record<string, string>, body: '' };
  const res = { setHeader(k: string, v: string) { result.headers[k] = v; }, set statusCode(v: number) { result.status = v; }, end(v: string) { result.body = v; } };
  return { result, res: res as any };
}
test('API admission rejects public overload before provider work and still serves an authorized protected call', async () => {
  let release!: () => void, started!: () => void, calls = 0;
  const pending = new Promise<void>(r => release = r), ready = new Promise<void>(r => started = r);
  const handler = createApiHandler({ origin, sourceKey: Buffer.alloc(32, 5), auth, limits: { maxInFlight: 2, maxPublicInFlight: 1 }, actions: new Map([['/api/protected', async () => ({ ok: true })]]), registration: { handles: p => p === '/api/email/external/session', async handle(req) { await readJsonBody(req); calls++; started(); await pending; return { ok: true }; } } });
  const first = response(), rejected = response(), protectedResponse = response();
  const pendingRequest = request('/api/email/external/session');
  const running = handler(pendingRequest, first.res); await ready;
  try {
    // Disconnecting a caller must not release work still pending in a provider.
    pendingRequest.emit('aborted');
    await handler(request('/api/email/external/session'), rejected.res);
    assert.equal(rejected.result.status, 429); assert.equal(rejected.result.headers['Retry-After'], '1'); assert.equal(calls, 1);
    await handler(request('/api/protected', authenticated), protectedResponse.res); assert.equal(protectedResponse.result.status, 200);
  } finally { release(); await running; }
  assert.equal(first.result.status, 200);
});

test('API public budgets ignore forged forwarding headers and invalid origins do not consume a valid budget', async () => {
  let calls = 0;
  const handler = createApiHandler({ origin, sourceKey: Buffer.alloc(32, 5), auth, actions: new Map(), limits: { publicRequestsPerMinute: 1 }, registration: { handles: () => true, async handle(req) { await readJsonBody(req); calls++; return { ok: true }; } } });
  const invalid = response(); await handler(request('/api/email/external/session', { origin: 'https://attacker.invalid' }), invalid.res); assert.equal(invalid.result.status, 403);
  const first = response(); await handler(request('/api/email/external/session', { 'x-forwarded-for': '203.0.113.1' }), first.res); assert.equal(first.result.status, 200);
  const second = response(); await handler(request('/api/email/external/session', { 'x-forwarded-for': '203.0.113.2', forwarded: 'for=203.0.113.3' }), second.res);
  assert.equal(second.result.status, 429); assert(Number(second.result.headers['Retry-After']) > 0); assert.equal(calls, 1); assert.equal(second.result.body, '{"error":"RATE_LIMITED"}');
});

test('parse failures and provider exceptions release admission without retaining work slots', async () => {
  let fail = true;
  const handler = createApiHandler({ origin, sourceKey: Buffer.alloc(32, 5), auth, actions: new Map(), limits: { maxInFlight: 1 }, registration: { handles: () => true, async handle(req) { await readJsonBody(req); if (fail) throw Error('private provider details'); return { ok: true }; } } });
  for (const [raw, status] of [['[', 400], ['{}', 503]] as const) { const r = response(); await handler(request('/api/email/external/session', {}, raw), r.res); assert.equal(r.result.status, status); assert(!r.result.body.includes('private')); }
  fail = false; const r = response(); await handler(request('/api/email/external/session'), r.res); assert.equal(r.result.status, 200);
});

test('local adapter uses the same public admission policy without weakening production-only checks', async () => {
  const previous = { NODE_ENV: process.env.NODE_ENV, GATEPASS_SSO_MODE: process.env.GATEPASS_SSO_MODE, GATEPASS_DIRECTORY_MODE: process.env.GATEPASS_DIRECTORY_MODE };
  Object.assign(process.env, { NODE_ENV: 'test', GATEPASS_SSO_MODE: 'dummy', GATEPASS_DIRECTORY_MODE: 'mock' });
  try {
    let calls = 0;
    const handler = createLoopbackHttpHandler('http://localhost:8443', { handles: () => true, async handle() { calls++; return { ok: true }; } }, { publicRequestsPerMinute: 1 });
    for (const expected of [200, 429]) { const req = request('/api/registration/start', { host: 'localhost:8443', origin: 'http://localhost:8443' }); const r = response(); await handler(req, r.res); assert.equal(r.result.status, expected); }
    assert.equal(calls, 1);
  } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test('unauthenticated login work shares public admission before password verification',async()=>{
 let logins=0;const handler=createApiHandler({origin,sourceKey:Buffer.alloc(32,5),actions:new Map(),limits:{publicRequestsPerMinute:1},auth:{...auth,async signIn(){logins++;return{ok:false as const,message:'Unable to sign in.' as const};}}});
 const first=response();await handler(request('/api/auth/login',{},JSON.stringify({login:'guard1',password:'synthetic'})),first.res);assert.equal(first.result.status,401);
 const second=response();await handler(request('/api/auth/login',{'x-forwarded-for':'203.0.113.99'}),second.res);assert.equal(second.result.status,429);assert.equal(logins,1);
});
