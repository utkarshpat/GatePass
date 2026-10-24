import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServiceActions, composeApi } from '../src/transport/Composition.ts';
import type { ReadParameter } from '../src/visits/SqlVisitReadRepository.ts';
const session = { sessionToken: Buffer.alloc(32, 7).toString('base64url'), csrfToken: Buffer.alloc(32, 8).toString('base64url') };
function fixture() {
  const calls: { name: string; parameters: Record<string, ReadParameter> }[] = [];
  const actions = createServiceActions({ async callProcedure(name, parameters) { calls.push({ name, parameters }); throw { number: 52001 }; } });
  return { calls, actions };
}
test('40 protected routes bind only implemented services', () => { const f = fixture(); assert.equal(f.actions.size, 40); assert.equal(f.actions.has('/api/sql'), false); assert.equal(f.actions.has('/api/registration/submit'), false); });
test('route-owned view is bound to typed SQL without accepting a client actor', async () => {
  const f = fixture();
  await assert.rejects(f.actions.get('/api/guard/visits/list')!(session, { locationId: 1 }), /NOT_AUTHORIZED/u);
  assert.equal(f.calls[0].name, 'gp.ListVisits'); assert.equal(f.calls[0].parameters.View.value, 'GUARD');
  assert.deepEqual(f.calls[0].parameters.SessionHash.value, createHash('sha256').update(Buffer.from(session.sessionToken, 'base64url')).digest());
});
test('client cannot escalate a route view or supply SQL/session identity fields', async () => {
  const f = fixture();
  for (const data of [{ view: 'ADMIN' }, { actorUserId: 'admin' }, { SessionHash: 'chosen' }, { sessionToken: session.sessionToken }]) await assert.rejects(f.actions.get('/api/own/visits/list')!(session, data), /INVALID_INPUT/u);
  assert.equal(f.calls.length, 0);
});
test('detail and context routes reject hidden extra fields', async () => {
  const f = fixture();
  await assert.rejects(async () => f.actions.get('/api/host/visits/detail')!(session, { visitRequestId: '00000000-0000-4000-8000-000000000001', view: 'ADMIN' }));
  await assert.rejects(async () => f.actions.get('/api/guard/contexts')!(session, { locationId: 1, projectLocationId: '1' }));
  await assert.rejects(async () => f.actions.get('/api/guard/context')!(session, { extra: 'forbidden' }));
  await assert.rejects(async () => f.actions.get('/api/guard/detail')!(session, { locationId: 1, dutyKind: 'PROJECT', dutyId: '1', visitRequestId: '00000000-0000-4000-8000-000000000001', extra: 'bad' }));
  assert.equal(f.calls.length, 0);
});
test('administrative route names confer no authority; denial comes from current SQL scope', async () => {
  const f = fixture();
  await assert.rejects(f.actions.get('/api/admin/projects')!(session, { locationId: 1 }), /NOT_AUTHORIZED/u);
  assert.equal(f.calls[0].name, 'gp.ListAdminProjectLocations');
});
test('composition rejects combined SQL credentials before connecting', async () => {
  const identity = { server: 'localhost', port: 1433, database: 'test', user: 'same', password: 'test-only' };
  await assert.rejects(composeApi({ origin: 'https://localhost', sourceKey: Buffer.alloc(32), api: identity, auth: identity }), /INVALID_IDENTITY_SEPARATION/u);
});
