import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:https';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { createApiHandler } from '../src/transport/ApiHandler.ts';
import { RequestAdmission } from '../src/transport/RequestAdmission.ts';

test('authentication checks have a separate ceiling, share the total limit and release idempotently', () => {
  const admission = new RequestAdmission({ maxInFlight: 3, maxPublicInFlight: 1 });
  const checking = admission.authenticate(); assert(checking.allowed);
  assert.equal(admission.authenticate().allowed, false);
  const publicWork = admission.enter('a'.repeat(64), true); assert(publicWork.allowed);
  const protectedWork = admission.enter('b'.repeat(64), false); assert(protectedWork.allowed);
  assert.equal(admission.enter('c'.repeat(64), false).allowed, false);
  checking.release(); checking.release();
  const nextCheck = admission.authenticate(); assert(nextCheck.allowed);
  assert.equal(admission.enter('c'.repeat(64), false).allowed, false);
  nextCheck.release(); publicWork.release(); protectedWork.release();
  const next = admission.enter('a'.repeat(64), true); assert(next.allowed); next.release();
});

test('invalid and revoked sessions, bad CSRF and verifier failures are rejected before body parsing; checks recover', async () => {
  const session = Buffer.alloc(32, 3).toString('base64url'), csrf = Buffer.alloc(32, 4).toString('base64url');
  const credentials = { cookie: `__Host-gp-session=${session}; __Host-gp-csrf=${csrf}`, 'x-csrf-token': csrf };
  let verification: 'accept' | 'deny' | 'error' = 'deny', reads = 0, actions = 0;
  const authCalls: string[] = [];
  const handler = createApiHandler({ origin: 'https://localhost', sourceKey: Buffer.alloc(32, 5), limits: { maxInFlight: 2, maxPublicInFlight: 1 },
    auth: { async signIn() { throw Error('unused'); }, async completeSetup() { return { ok: false }; }, async sessionAction(action) {
      authCalls.push(action); if (verification === 'error') throw Error('private verifier failure'); return { ok: verification === 'accept' };
    } }, actions: new Map([['/api/protected', async () => { actions++; return { ok: true }; }]]) });
  async function send(headers: Record<string, string>, path = '/api/protected', raw = '{}') {
    const req = Object.assign(Readable.from([Buffer.from(raw)]), { method: 'POST', url: path, socket: { encrypted: true, remoteAddress: '127.0.0.1' },
      headers: { host: 'localhost', origin: 'https://localhost', 'content-type': 'application/json', ...headers } });
    const iterator = req[Symbol.asyncIterator].bind(req);
    req[Symbol.asyncIterator] = () => { reads++; return iterator(); };
    const result = { status: 0, body: '' };
    const res = { setHeader() {}, set statusCode(value: number) { result.status = value; }, end(body: string) { result.body = body; } };
    await handler(req as any, res as any);
    return result;
  }
  assert.equal((await send({})).status, 401);
  assert.equal((await send({ cookie: credentials.cookie })).status, 403);
  assert.equal(authCalls.length, 0);
  assert.equal((await send(credentials)).status, 401);
  verification = 'error';
  const error = await send(credentials); assert.equal(error.status, 503); assert.equal(error.body, '{"error":"UNAVAILABLE"}');
  assert.equal(reads, 0); assert.equal(actions, 0);
  verification = 'accept';
  assert.equal((await send(credentials)).status, 200); assert.equal(reads, 1); assert.equal(actions, 1);
  authCalls.length = 0;
  assert.equal((await send(credentials, '/api/auth/touch')).status, 200); assert.deepEqual(authCalls, ['touch']);
  authCalls.length = 0;
  assert.equal((await send(credentials, '/api/auth/logout')).status, 200); assert.deepEqual(authCalls, ['touch', 'logout']);
  assert.equal((await send(credentials, '/api/protected', '[')).status, 400);
  assert.equal((await send(credentials)).status, 200);
});

test('untrusted verification is bounded and disconnects do not release outstanding provider work', async () => {
  const session = Buffer.alloc(32, 3).toString('base64url'), csrf = Buffer.alloc(32, 4).toString('base64url');
  let finish!: () => void, started!: () => void, checks = 0, reads = 0;
  const hold = new Promise<void>(resolve => finish = resolve), ready = new Promise<void>(resolve => started = resolve);
  let denied = true;
  const handler = createApiHandler({ origin: 'https://localhost', sourceKey: Buffer.alloc(32, 5), limits: { maxInFlight: 2, maxPublicInFlight: 1 },
    auth: { async signIn() { throw Error('unused'); }, async completeSetup() { return { ok: false }; }, async sessionAction() {
      checks++; started(); await hold; return { ok: !denied };
    } }, actions: new Map([['/api/protected', async () => ({ ok: true })]]) });
  function pending() {
    const req = Object.assign(Readable.from([Buffer.from('{}')]), { method: 'POST', url: '/api/protected', socket: { encrypted: true, remoteAddress: '127.0.0.1' },
      headers: { host: 'localhost', origin: 'https://localhost', 'content-type': 'application/json', cookie: `__Host-gp-session=${session}; __Host-gp-csrf=${csrf}`, 'x-csrf-token': csrf } });
    const iterator = req[Symbol.asyncIterator].bind(req); req[Symbol.asyncIterator] = () => { reads++; return iterator(); };
    const result = { status: 0, retry: '' };
    return { req, result, res: { setHeader(key: string, value: string) { if (key === 'Retry-After') result.retry = value; }, set statusCode(value: number) { result.status = value; }, end() {} } };
  }
  const first = pending(), second = pending(); const running = handler(first.req as any, first.res as any);
  try {
    await ready; first.req.emit('aborted');
    await handler(second.req as any, second.res as any);
    assert.equal(second.result.status, 429); assert.equal(second.result.retry, '1'); assert.equal(checks, 1); assert.equal(reads, 0);
  } finally { finish(); await running; }
  assert.equal(first.result.status, 401);
  denied = false;
  const recovered = pending(); await handler(recovered.req as any, recovered.res as any);
  assert.equal(recovered.result.status, 200); assert.equal(checks, 2); assert.equal(reads, 1);
});

test('slow unauthenticated protected requests cannot occupy authenticated capacity over HTTPS', { timeout: 15000 }, async () => {
  const certificate = spawnSync('pwsh', ['-NoProfile', '-File', 'tests/helpers/Create-TestTls.ps1'], { encoding: 'utf8' });
  assert.equal(certificate.status, 0, certificate.stderr);
  const session = Buffer.alloc(32, 3).toString('base64url'), csrf = Buffer.alloc(32, 4).toString('base64url');
  const credentials = { cookie: `__Host-gp-session=${session}; __Host-gp-csrf=${csrf}`, 'x-csrf-token': csrf };
  let handler!: ReturnType<typeof createApiHandler>, seen = 0, arrived!: () => void, actions = 0;
  const received = new Promise<void>(resolve => arrived = resolve);
  const server = createServer({ pfx: Buffer.from(certificate.stdout.trim(), 'base64'), passphrase: 'test-only' }, (req, res) => {
    void handler(req, res);
    if (++seen === 6) arrived();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port, origin = `https://localhost:${port}`;
  handler = createApiHandler({ origin, sourceKey: Buffer.alloc(32, 5), limits: { maxInFlight: 2, maxPublicInFlight: 1 },
    auth: { async signIn() { return { ok: false, message: 'Unable to sign in.' }; }, async completeSetup() { return { ok: false }; },
      async sessionAction(_action, candidate, candidateCsrf) { return { ok: candidate === session && candidateCsrf === csrf }; } },
    actions: new Map([['/api/protected', async () => { actions++; return { ok: true }; }]]) });
  function send(headers: Record<string, string>, slow = false) {
    let req!: ReturnType<typeof request>;
    const result = new Promise<{ status: number; connection: string | string[] | undefined }>((resolve, reject) => {
      req = request({ hostname: '127.0.0.1', port, path: '/api/protected', method: 'POST', rejectUnauthorized: false, agent: false,
        headers: { host: new URL(origin).host, origin, 'content-type': 'application/json', 'content-length': slow ? '1024' : '2', ...headers } }, res => {
        res.resume(); res.on('end', () => resolve({ status: res.statusCode!, connection: res.headers.connection }));
      });
      req.on('error', reject);
      if (slow) req.flushHeaders(); else req.end('{}');
    });
    // Cleanup may close a deliberately unfinished request after an assertion fails.
    void result.catch(() => {});
    return { req, result };
  }
  const slow: ReturnType<typeof send>[] = [];
  try {
    for (let i = 0; i < 4; i++) slow.push(send({}, true));
    await receivedAfterFour();
    const forged = { ...credentials, cookie: credentials.cookie.replace(session, Buffer.alloc(32, 9).toString('base64url')) };
    const denied = send(forged, true); slow.push(denied);
    // Let the forged session check complete so the test does not demand service
    // while its deliberately one-slot authentication provider is busy.
    await new Promise<void>(resolve => setImmediate(resolve));
    slow.push(send({ cookie: credentials.cookie }, true));
    await received;
    assert.equal((await send(credentials).result).status, 200);
    const statuses = await Promise.all(slow.map(value => value.result));
    assert.deepEqual(statuses.map(value => value.status), [401, 401, 401, 401, 401, 403]);
    assert(statuses.every(value => value.connection === 'close'));
    assert.equal(actions, 1);
  } finally {
    for (const pending of slow) pending.req.destroy();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  async function receivedAfterFour() {
    while (seen < 4) await new Promise<void>(resolve => setImmediate(resolve));
  }
});
