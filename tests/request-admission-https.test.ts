import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:https';
import { spawnSync } from 'node:child_process';
import { createApiHandler, readJsonBody } from '../src/transport/ApiHandler.ts';

test('actual HTTPS rejects public bursts before provider work, reserves protected capacity and returns retry guidance', async () => {
  const certificate = spawnSync('pwsh', ['-NoProfile', '-File', 'tests/helpers/Create-TestTls.ps1'], { encoding: 'utf8' });
  assert.equal(certificate.status, 0, certificate.stderr);
  let handler!: ReturnType<typeof createApiHandler>, started!: () => void, release!: () => void, providers = 0;
  const ready = new Promise<void>(r => started = r), hold = new Promise<void>(r => release = r);
  const server = createServer({ pfx: Buffer.from(certificate.stdout.trim(), 'base64'), passphrase: 'test-only' }, (req, res) => void handler(req, res));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port, origin = `https://localhost:${port}`;
  const session = Buffer.alloc(32, 3).toString('base64url'), csrf = Buffer.alloc(32, 4).toString('base64url');
  handler = createApiHandler({ origin, sourceKey: Buffer.alloc(32, 5), limits: { maxInFlight: 2, maxPublicInFlight: 1, publicRequestsPerMinute: 1 }, auth: { async signIn() { return { ok: false, message: 'Unable to sign in.' }; }, async completeSetup() { return { ok: false }; }, async sessionAction() { return { ok: true }; } }, actions: new Map([['/api/protected', async () => ({ ok: true })]]), registration: { handles: path => path === '/api/email/external/session', async handle(req) { await readJsonBody(req); providers++; started(); await hold; return { ok: true }; } } });
  const send = (path: string, headers: Record<string, string> = {}) => new Promise<{ status: number; headers: Record<string, any>; body: string }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'POST', rejectUnauthorized: false, headers: { host: new URL(origin).host, origin, 'content-type': 'application/json', 'content-length': '2', ...headers } }, res => {
      let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    }); req.on('error', reject); req.end('{}');
  });
  let first: ReturnType<typeof send> | undefined;
  try {
    first = send('/api/email/external/session'); await ready;
    const overloaded = await send('/api/email/external/session', { 'x-forwarded-for': '203.0.113.20' });
    assert.equal(overloaded.status, 429); assert.equal(overloaded.headers['retry-after'], '1'); assert.equal(providers, 1);
    assert.equal((await send('/api/protected', { cookie: `__Host-gp-session=${session}; __Host-gp-csrf=${csrf}`, 'x-csrf-token': csrf })).status, 200);
    release(); assert.equal((await first).status, 200);
    const throttled = await send('/api/email/external/session', { forwarded: 'for=203.0.113.21' });
    assert.equal(throttled.status, 429); assert.equal(providers, 1); assert(Number(throttled.headers['retry-after']) > 0); assert(Number(throttled.headers['retry-after']) <= 60);
    assert.equal(throttled.body, '{"error":"RATE_LIMITED"}');
  } finally { release(); await first; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
