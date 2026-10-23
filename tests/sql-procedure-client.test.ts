import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqlProcedureClient, connectSql, procedureRoles } from '../src/transport/SqlProcedureClient.ts';

function fixture(role: 'api' | 'auth' = 'api', result: unknown = { recordsets: [[{ '': '{"ok":true}' }]] }) {
  const inputs: Array<{ name: string; type: any; value: unknown }> = []; const executed: string[] = [];
  const request = { input(name: string, type: unknown, value: unknown) { inputs.push({ name, type, value }); return request; }, async execute(name: string) { executed.push(name); return result; } };
  let closed = false;
  const client = new SqlProcedureClient({ request: () => request, async close() { closed = true; } }, role);
  return { client, inputs, executed, closed: () => closed };
}
test('driver uses exact stored-procedure RPC and explicit types', async () => {
  const f = fixture(); const result = await f.client.callProcedure('gp.GetOperationalSummary', {
    SessionHash: { type: 'binary', value: Buffer.alloc(32) }, LocalVisitDate: { type: 'date', value: '2026-10-20' },
    ProjectLocationId: { type: 'bigint', value: '9223372036854775807' }, LocationId: { type: 'int', value: 1 },
  });
  assert.equal(result, '{"ok":true}'); assert.deepEqual(f.executed, ['gp.GetOperationalSummary']);
  assert.ok(f.inputs[1].value instanceof Date); assert.equal((f.inputs[1].value as Date).toISOString(), '2026-10-20T00:00:00.000Z');
  assert.equal(f.inputs[2].value, '9223372036854775807'); // Never coerce bigint IDs through Number.
});
test('API and auth procedure allowlists are disjoint and match DB grant counts', async () => {
  assert.equal(procedureRoles.api.length, 56); assert.equal(procedureRoles.auth.length, 6);
  assert.ok(procedureRoles.api.includes('GetReceptionEmployeeTimeline'));
  assert.ok(procedureRoles.api.includes('AuditReceptionRegistration'));
  const api = fixture(); const auth = fixture('auth');
  await assert.rejects(api.client.callProcedure('gp.BeginGuardLogin', {}));
  await assert.rejects(auth.client.callProcedure('gp.ListVisits', {}));
  assert.equal(api.executed.length + auth.executed.length, 0);
});
test('SQL text, private helpers, media and renderer RPCs rejected', async () => {
  const f = fixture();
  for (const name of ['SELECT 1', 'gp._RequireSession', 'gp.ResolveVisitPhoto', 'gp.ClaimPassRender', 'gp.ListVisits;DROP TABLE x', 'other.gp.ListVisits']) await assert.rejects(f.client.callProcedure(name, {}));
  assert.equal(f.executed.length, 0);
});
test('invalid primitive values never execute SQL', async () => {
  for (const p of [{ type: 'int', value: 1.5 }, { type: 'bigint', value: 9007199254740992 }, { type: 'bigint', value: '9223372036854775808' },
    { type: 'binary', value: 'secret' }, { type: 'bit', value: 1 }, { type: 'guid', value: 'invalid' }, { type: 'text', value: {} },
    { type: 'datetime', value: '2026-10-20T00:00:00' }, { type: 'date', value: '2026-02-30' }, { type: 'query', value: 'DROP TABLE' }]) {
    const f = fixture(); await assert.rejects(f.client.callProcedure('gp.ListVisits', { X: p as any })); assert.equal(f.executed.length, 0);
  }
});
test('parameter names cannot be SQL fragments', async () => { const f = fixture(); await assert.rejects(f.client.callProcedure('gp.ListVisits', { 'x;select': { type: 'text', value: 'x' } })); assert.equal(f.executed.length, 0); });
test('nullable typed parameters and Unicode text retained', async () => { const f = fixture(); await f.client.callProcedure('gp.ListVisits', { X: { type: 'bigint', value: null }, Name: { type: 'text', value: 'कर्मचारी' } }); assert.equal(f.inputs[0].value, null); assert.equal(f.inputs[1].value, 'कर्मचारी'); });
test('ambiguous or non-scalar SQL responses fail closed', async () => {
  for (const result of [{ recordsets: [] }, { recordsets: [[], []] }, { recordsets: [[{ a: '{}', b: '{}' }]] }, { recordsets: [[{ a: {} }]] }, { recordsets: [[{ a: '{}' }, { a: '{}' }]] }]) await assert.rejects(fixture('api', result).client.callProcedure('gp.ListVisits', {}));
});
test('SQL error numbers reach existing services without mutation retries', async () => {
  let calls = 0; const failure = Object.assign(new Error('sensitive SQL detail'), { number: 52001 });
  const client = new SqlProcedureClient({ request: () => ({ input() {}, async execute() { calls++; throw failure; } }), async close() {} }, 'api');
  await assert.rejects(client.callProcedure('gp.CancelVisit', {}), error => error === failure); assert.equal(calls, 1);
});
test('client closes owned pool', async () => { const f = fixture(); await f.client.close(); assert.equal(f.closed(), true); });
test('missing database configuration fails before network', async () => { await assert.rejects(connectSql({ server: '', port: 1433, database: 'test', user: 'user', password: 'password' }, 'api'), /INVALID_DATABASE_CONFIGURATION/u); });
