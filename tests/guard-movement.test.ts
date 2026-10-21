import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { GuardMovementService, SqlGuardMovementRepository } from '../src/visits/GuardMovementService.ts';
import type { GuardMovementRepository } from '../src/visits/GuardMovementService.ts';
import type { ReadParameter } from '../src/visits/SqlVisitReadRepository.ts';
const session = () => ({ sessionToken: randomBytes(32).toString('base64url'), csrfToken: randomBytes(32).toString('base64url') });
const request = () => ({ clientKey: randomUUID(), visitRequestId: randomUUID(), accessPassId: randomUUID(), locationId: 1, selectedProjectLocationId: '2', eventType: 'ENTRY', entryMethod: 'MANUAL' });
function fixture(handler?: (p: Record<string, ReadParameter>) => Record<string, unknown>) {
  const calls: Record<string, ReadParameter>[] = [];
  const repository: GuardMovementRepository = { async execute(p) { calls.push(p); return handler ? handler(p) : { operationId: randomUUID(), visitRequestId: p.VisitRequestId.value,
    projectLocationId: p.SelectedProjectLocationId.value, accessEventId: 12, eventType: p.EventType.value, isInside: p.EventType.value === 'ENTRY', private: 'DROP' }; } };
  return { repository, calls };
}
test('project movement binds the explicitly displayed target and strips untrusted result fields', async () => {
  const f = fixture(); const data = request(); const result = await new GuardMovementService(f.repository).record(session(), data);
  assert.equal(f.calls[0].SelectedProjectLocationId.value, data.selectedProjectLocationId); assert.equal(result.projectLocationId, '2'); assert(!Object.hasOwn(result, 'private'));
});
test('actor approvals and inferred or malformed targets cannot enter the movement port', async () => {
  const f = fixture(); const service = new GuardMovementService(f.repository); const { selectedProjectLocationId, ...missing } = request();
  for (const body of [missing, { ...request(), actorUserId: randomUUID() }, { ...request(), approved: true }, { ...request(), selectedProjectLocationId: '0' },
    { ...request(), selectedProjectLocationId: '9223372036854775808' }, { ...request(), entryMethod: 'RECONCILE' }]) await assert.rejects(service.record(session(), body), /INVALID_INPUT/u);
  assert.equal(f.calls.length, 0);
});
test('scan movement hashes canonical bearer bytes before SQL and keeps no raw token in calls', async () => {
  const f = fixture(); const credential = randomBytes(32).toString('base64url');
  await new GuardMovementService(f.repository).record(session(), { ...request(), entryMethod: 'SCAN', credential });
  assert((f.calls[0].CredentialHash.value as Buffer).equals(createHash('sha256').update(Buffer.from(credential, 'base64url')).digest())); assert(!JSON.stringify(f.calls).includes(credential));
});
test('location-only Digital ID movement uses explicit null instead of inventing a project', async () => {
  const f = fixture(); const result = await new GuardMovementService(f.repository).record(session(), { ...request(), selectedProjectLocationId: null });
  assert.equal(result.projectLocationId, null); assert.equal(f.calls[0].SelectedProjectLocationId.value, null);
});
test('SQL port forwards only exact typed movement parameters and never arbitrary actor authority', async () => {
  const f = fixture(); await new GuardMovementService(f.repository).record(session(), request()); let calls = 0;
  const repository = new SqlGuardMovementRepository({ async callProcedure(name) { calls++; assert.equal(name, 'gp.RecordMovement'); return '{}'; } });
  await assert.rejects(repository.execute({ ...f.calls[0], ActorUserId: { type: 'guid', value: randomUUID() } }));
  await assert.rejects(repository.execute({ ...f.calls[0], SelectedProjectLocationId: { type: 'int', value: 2 } }));
  await assert.rejects(repository.execute({ ...f.calls[0], SessionHash: { type: 'binary', value: Buffer.alloc(31) } })); assert.equal(calls, 0);
});
test('authorization failure and a substituted project receipt never become successful UI outcomes', async () => {
  const denied: GuardMovementRepository = { async execute() { throw { number: 52001, message: 'PRIVATE_SQL' }; } };
  await assert.rejects(new GuardMovementService(denied).record(session(), request()), error => (error as Error).message === 'NOT_AUTHORIZED');
  const f = fixture(p => ({ operationId: randomUUID(), visitRequestId: p.VisitRequestId.value, projectLocationId: '3', accessEventId: 12, eventType: 'ENTRY', isInside: true }));
  await assert.rejects(new GuardMovementService(f.repository).record(session(), request()), /UNAVAILABLE/u);
  await assert.rejects(new GuardMovementService(f.repository).record({ ...session(), sessionToken: 'bad' }, request()), /NOT_AUTHORIZED/u);
});
