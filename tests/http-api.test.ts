import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:https';
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createApiHandler } from '../src/transport/ApiHandler.ts';

const session = Buffer.alloc(32, 1).toString('base64url'); const csrf = Buffer.alloc(32, 2).toString('base64url'); const sourceKey = Buffer.alloc(32, 3);
let origin: string; let server: ReturnType<typeof createServer>; let port: number; let calls = 0; let source: Buffer;
before(async () => {
  const generated = spawnSync('pwsh', ['-NoProfile', '-File', 'tests/helpers/Create-TestTls.ps1'], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  const auth = {
    async signIn(_login: unknown, _password: unknown, context: { sourceHash: Buffer }) { calls++; source = context.sourceHash; return { ok: true as const, sessionToken: session, csrfToken: csrf, idleExpiresAtUtc: '2026-10-20T10:00:00.000Z', absoluteExpiresAtUtc: '2026-10-20T18:00:00.000Z' }; },
    async completeSetup() { return { ok: true }; }, async sessionAction() { return { ok: true }; },
  };
  let handler: ReturnType<typeof createApiHandler>;
  server = createServer({ pfx: Buffer.from(generated.stdout.trim(), 'base64'), passphrase: 'test-only' }, (req, res) => handler(req, res));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port; origin = `https://localhost:${port}`;
  handler = createApiHandler({ origin, sourceKey, auth, actions: new Map([
    ['/api/test', async (s, body) => { assert.equal(s.sessionToken, session); assert.equal(s.csrfToken, csrf); return { body }; }],
    ['/api/error', async () => { throw new Error('password=private; SQL internals'); }],
    ['/api/denied', async () => { throw Object.assign(new Error('private'), { code: 'NOT_AUTHORIZED' }); }],
  ]) });
});
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
function send(path: string, options: { method?: string; headers?: Record<string, string>; raw?: string; body?: unknown } = {}) {
  return new Promise<{ status: number; headers: any; text: string }>((resolve, reject) => {
    const payload = options.raw ?? JSON.stringify(options.body ?? {});
    const req = request({ hostname: '127.0.0.1', port, path, method: options.method ?? 'POST', rejectUnauthorized: false,
      headers: { host: new URL(origin).host, origin, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)), ...options.headers } }, res => {
      let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, text }));
    }); req.on('error', reject); req.end(payload);
  });
}
const authenticated = () => ({ cookie: `__Host-gp-session=${session}; __Host-gp-csrf=${csrf}`, 'x-csrf-token': csrf });
test('login sets host-only secure cookies and never returns the session in JSON', async () => {
  const r = await send('/api/auth/login', { body: { login: 'guard1', password: 'test' } });
  assert.equal(r.status, 200); assert.ok(!r.text.includes(session)); assert.equal(JSON.parse(r.text).csrfToken, csrf);
  const cookies = r.headers['set-cookie']; assert.ok(cookies[0].includes('HttpOnly')); assert.ok(cookies.every((c: string) => c.includes('Secure') && c.includes('SameSite=Strict') && !c.includes('Domain=')));
});
test('source HMAC uses direct peer and ignores spoofed forwarding', async () => {
  await send('/api/auth/login', { headers: { 'x-forwarded-for': '203.0.113.1', forwarded: 'for=203.0.113.2' } });
  assert.deepEqual(source, createHmac('sha256', sourceKey).update('127.0.0.1').digest());
});
test('wrong origin is rejected before password work', async () => { const n = calls; assert.equal((await send('/api/auth/login', { headers: { origin: 'https://evil.example' } })).status, 403); assert.equal(calls, n); });
test('wrong host rejected', async () => { assert.equal((await send('/api/test', { headers: { host: 'evil.example' } })).status, 403); });
test('same-site sibling requests rejected', async () => { assert.equal((await send('/api/auth/login', { headers: { 'sec-fetch-site': 'same-site' } })).status, 403); });
test('no session is unauthenticated', async () => { assert.equal((await send('/api/test')).status, 401); });
test('session needs matching CSRF cookie and header', async () => {
  assert.equal((await send('/api/test', { headers: { cookie: `__Host-gp-session=${session}` } })).status, 403);
  assert.equal((await send('/api/test', { headers: { ...authenticated(), 'x-csrf-token': session } })).status, 403);
});
test('duplicate session cookies rejected', async () => { assert.equal((await send('/api/test', { headers: { ...authenticated(), cookie: authenticated().cookie + `; __Host-gp-session=${session}` } })).status, 400); });
test('authenticated requests reach explicit service action', async () => { const r = await send('/api/test', { headers: authenticated(), body: { locationId: 1 } }); assert.equal(r.status, 200); assert.deepEqual(JSON.parse(r.text), { body: { locationId: 1 } }); });
test('query URLs and arbitrary procedure endpoints absent', async () => { for (const path of ['/api/test?token=secret', '/api/sql', '/api/auth/sso']) assert.equal((await send(path)).status, 404); });
test('GET and OPTIONS do not execute actions', async () => { for (const method of ['GET', 'OPTIONS']) assert.equal((await send('/api/test', { method })).status, 405); });
test('only JSON objects with supported encoding accepted', async () => {
  assert.equal((await send('/api/test', { raw: '[' })).status, 400);
  assert.equal((await send('/api/test', { body: [] })).status, 400);
  assert.equal((await send('/api/test', { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await send('/api/test', { headers: { 'content-encoding': 'gzip' } })).status, 415);
});
test('body limit enforced', async () => { assert.equal((await send('/api/test', { raw: JSON.stringify({ text: 'x'.repeat(65536) }) })).status, 413); });
test('errors are redacted; authorization errors remain distinct', async () => {
  const r = await send('/api/error', { headers: authenticated() }); assert.equal(r.status, 503); assert.equal(r.text, '{"error":"UNAVAILABLE"}');
  assert.equal((await send('/api/denied', { headers: authenticated() })).status, 403);
});
test('all protected responses prohibit cache and framing', async () => { const r = await send('/api/test'); assert.equal(r.headers['cache-control'], 'no-store'); assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/u); assert.equal(r.headers['access-control-allow-origin'], undefined); });
test('logout expires both cookies', async () => { const r = await send('/api/auth/logout', { headers: authenticated() }); assert.equal(r.status, 200); assert.ok(r.headers['set-cookie'].every((c: string) => c.includes('Max-Age=0'))); });
test('auth rejects unknown actor and source fields', async () => { const n = calls; assert.equal((await send('/api/auth/login', { body: { actorUserId: 'admin', sourceHash: 'chosen' } })).status, 400); assert.equal(calls, n); });
test('configuration requires HTTPS canonical origin and strong source key', () => {
  for (const origin of ['http://localhost', 'https://localhost/']) assert.throws(() => createApiHandler({ origin, sourceKey, auth: {} as any, actions: new Map() }));
  assert.throws(() => createApiHandler({ origin, sourceKey: Buffer.alloc(1), auth: {} as any, actions: new Map() }));
});
