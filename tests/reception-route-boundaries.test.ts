import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { ReceptionRoutes } from '../src/development/ReceptionRoutes.ts';
import { OwnCardError } from '../src/printing/OwnDigitalIdCardService.ts';
const env = { NODE_ENV: process.env.NODE_ENV, GATEPASS_SSO_MODE: process.env.GATEPASS_SSO_MODE, GATEPASS_DIRECTORY_MODE: process.env.GATEPASS_DIRECTORY_MODE };
before(() => Object.assign(process.env, { NODE_ENV: 'test', GATEPASS_SSO_MODE: 'dummy', GATEPASS_DIRECTORY_MODE: 'mock' }));
after(() => { for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v; });
const session = { sessionToken: randomBytes(32).toString('base64url'), csrfToken: randomBytes(32).toString('base64url') };
const res = {} as any;
function request(action: string, body: unknown = {}) {
 return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { url: '/api/reception/' + action, socket: { remoteAddress: '127.0.0.1' }, headers: { 'content-type': 'application/json', cookie: `gp-staff-session=${session.sessionToken}; gp-staff-csrf=${session.csrfToken}`, 'x-csrf-token': session.csrfToken } }) as any;
}
function fixture() {
 const calls: string[] = []; const state = { verified: true, error: undefined as unknown };
 const sso = { verify: async () => { throw new Error('Central session must not use employee SSO'); } };
 const staff = { verify: async () => state.verified };
 const workspace = { context: async () => { calls.push('context'); return {}; }, list: async () => { calls.push('list'); return {}; }, lookup: async () => { calls.push('lookup'); return { matches: [], cursor: null }; }, correctReturn: async () => { calls.push('correct-return'); if (state.error) throw state.error; return { correctedAtUtc: '2026-10-22T12:05:00.000Z' }; }, returnPass: async () => { calls.push('return'); if(state.error)throw state.error;return {returnedAtUtc:'2026-10-22T12:00:00.000Z'}; } };
 const photos = { read: async () => ({ mimeType: 'image/jpeg', bytes: Buffer.from('photo') }) };
 const cards = { image: async () => { if (state.error) throw state.error; return {}; } };
 const printing = { request: async () => ({}), status: async () => ({}) };
 const render = { renderAndDispatch: async (..._args: any[]): Promise<any> => { throw new Error('Not installed'); } };
 const route = new ReceptionRoutes(sso as any, workspace as any, {} as any, photos as any, cards as any, printing as any, render as any, staff);
 return { route, state, calls, render };
}
const rejectsStatus = (p: Promise<unknown>, status: number) => assert.rejects(p, (e: any) => e.status === status);
test('reception central sessions use staff verifier and stop revoked identities before reads', async () => {
 const f = fixture(); await f.route.handle(request('me'), res); assert.deepEqual(f.calls, ['context']);
 f.state.verified = false; await rejectsStatus(f.route.handle(request('list', { locationId: 1 }), res), 401);
 assert.deepEqual(f.calls, ['context']);
});
test('reception rejects remote access, missing/mismatched CSRF, unknown routes and extra context fields', async () => {
 const f = fixture();
 const remote = request('me'); remote.socket.remoteAddress = '192.0.2.1'; await rejectsStatus(f.route.handle(remote, res), 403);
 await rejectsStatus(f.route.handle(request('unknown'), res), 404);
 for (const mode of ['missing', 'mismatch']) {
  const req = request('me'); if (mode === 'missing') delete req.headers['x-csrf-token']; else req.headers['x-csrf-token'] = randomBytes(32).toString('base64url');
  await rejectsStatus(f.route.handle(req, res), 403);
 }
 await rejectsStatus(f.route.handle(request('me', { scope: 'all' }), res), 400); assert.deepEqual(f.calls, []);
});
test('reception preview retains typed card denials and redacts unexpected failures', async () => {
 const f = fixture();
 for (const error of [new OwnCardError(403), new Error('private rendering details')]) {
  f.state.error = error; await rejectsStatus(f.route.handle(request('preview', { visitRequestId: 'test' }), res), error instanceof OwnCardError ? 403 : 503);
 }
});
test('reception concurrent renders are bounded, return wiped buffers and release slots after failures', async () => {
 const f = fixture(); const pending: { resolve: (v: any) => void; reject: (e: Error) => void }[] = [];
 f.render.renderAndDispatch = async () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
 const first = f.route.handle(request('print/render', { printJobId: 'first' }), res);
 const second = f.route.handle(request('print/render', { printJobId: 'second' }), res);
 // Wait for both independent body streams to reach the renderer.
 const deadline = Date.now() + 2000;
 while (pending.length < 2 && Date.now() < deadline) await new Promise(resolve => setImmediate(resolve));
 assert.equal(pending.length, 2);
 await rejectsStatus(f.route.handle(request('print/render', { printJobId: 'third' }), res), 429);
 const failure = assert.rejects(first, /DISPATCH_FAILED/); pending[0].reject(new Error('DISPATCH_FAILED')); await failure;
 const bytes = Buffer.from('rendered-card'); pending[1].resolve({ printJobId: 'second', mimeType: 'image/svg+xml', bytes });
 assert.deepEqual(await second, { printJobId: 'second', mimeType: 'image/svg+xml', imageBase64: Buffer.from('rendered-card').toString('base64'), status: 'DISPATCHED' });
 assert.ok(bytes.every(b => b === 0));
 f.render.renderAndDispatch = async () => ({ printJobId: 'retry', mimeType: 'image/svg+xml', bytes: Buffer.from('retry') });
 assert.equal((await f.route.handle(request('print/render', { printJobId: 'retry' }), res)).status, 'DISPATCHED');
});

test('return route uses verified reception session and rejects inside or unauthenticated operations', async()=>{
 const f=fixture();assert.equal(f.route.handles('/api/reception/return'),true);assert.equal(f.route.handles('/api/reception/lookup'),true);assert.equal(f.route.handles('/api/reception/correct-return'),true);
 assert.deepEqual(await f.route.handle(request('lookup',{locationId:1,search:'Visitor'}),res),{matches:[],cursor:null});
 assert.deepEqual(await f.route.handle(request('return',{}),res),{returnedAtUtc:'2026-10-22T12:00:00.000Z'});
 assert.deepEqual(await f.route.handle(request('correct-return',{}),res),{correctedAtUtc:'2026-10-22T12:05:00.000Z'});
 f.state.error={code:'INSIDE_PROJECT'};await rejectsStatus(f.route.handle(request('return',{}),res),409);await rejectsStatus(f.route.handle(request('correct-return',{}),res),409);
 f.state.verified=false;await rejectsStatus(f.route.handle(request('return',{}),res),401);await rejectsStatus(f.route.handle(request('lookup',{}),res),401);await rejectsStatus(f.route.handle(request('correct-return',{}),res),401);assert.deepEqual(f.calls,['lookup','return','correct-return','return','correct-return']);
});
