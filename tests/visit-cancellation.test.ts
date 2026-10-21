import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SqlVisitCancellationRepository, VisitCancellationService } from '../src/visits/VisitCancellationService.ts';
import type { ReadParameter } from '../src/visits/SqlVisitReadRepository.ts';
const session = () => ({ sessionToken: randomBytes(32).toString('base64url'), csrfToken: randomBytes(32).toString('base64url') });
const body = () => ({ clientKey: randomUUID(), visitRequestId: randomUUID(), expectedPassId: randomUUID(), reason: 'Plans changed' });
function fixture() {
  const data = body(); const calls: Record<string, ReadParameter>[] = [];
  const receipt = { operationId: randomUUID().toUpperCase(), visitRequestId: data.visitRequestId.toUpperCase(), accessPassId: data.expectedPassId.toUpperCase(), status: 'CANCELLED', wasInsideAtCancellation: true, reason: 'PRIVATE', ciphertext: 'PRIVATE' };
  const repository = { async execute(p: Record<string, ReadParameter>) { calls.push(p); return receipt; } };
  return { data, receipt, calls, repository, service: new VisitCancellationService(repository) };
}
test('cancellation sends only typed identifiers reason and hashed session material', async () => {
  const f = fixture(); const auth = session(); const result = await f.service.cancel(auth, { ...f.data, reason: '  Plans changed  ' }); const p = f.calls[0];
  assert.equal(p.Reason.value, 'Plans changed'); assert.equal(p.SessionHash.type, 'binary');
  assert(Buffer.from(p.SessionHash.value as Buffer).equals(createHash('sha256').update(Buffer.from(auth.sessionToken, 'base64url')).digest()));
  assert.equal(result.status, 'CANCELLED'); assert.equal(result.wasInsideAtCancellation, true); assert(!/reason|ciphertext/u.test(JSON.stringify(result)));
});
test('caller cannot forge ownership scope current status or inside state', async () => {
  const f = fixture(); for (const extra of [{ actorUserId: randomUUID() }, { employeeId: 'E1' }, { view: 'HOST' }, { locationId: 1 }, { status: 'CANCELLED' }, { wasInsideAtCancellation: false }]) await assert.rejects(f.service.cancel(session(), { ...f.data, ...extra }), /INVALID_INPUT/u);
  assert.equal(f.calls.length, 0);
});
test('invalid identifiers absent extra keys and malformed objects do not reach SQL', async () => {
  const f = fixture(); for (const value of [null, [], Object.create({}), { ...f.data, expectedPassId: 'invalid' }, { ...f.data, clientKey: undefined }, { ...f.data, other: true }]) await assert.rejects(f.service.cancel(session(), value), /INVALID_INPUT/u);
  assert.equal(f.calls.length, 0);
});
test('reason is bounded before trimming and rejects controls and malformed Unicode', async () => {
  const f = fixture(); for (const reason of ['', ' ', 'x'.repeat(301), 'क'.repeat(301), '\uD800', 'bad\u0000reason', 'bad\nreason']) await assert.rejects(f.service.cancel(session(), { ...f.data, reason }), /INVALID_INPUT/u);
  assert.equal(f.calls.length, 0);
});
test('malformed session or CSRF never reaches SQL', async () => {
  const f = fixture(); for (const auth of [{ ...session(), sessionToken: 'bad' }, { ...session(), csrfToken: 'bad' }]) await assert.rejects(f.service.cancel(auth, f.data), /NOT_AUTHORIZED/u); assert.equal(f.calls.length, 0);
});
test('SQL failures map to bounded redacted errors', async () => {
  for (const [number, expected] of [[52001, 'NOT_AUTHORIZED'], [52002, 'INVALID_INPUT'], [52003, 'CONFLICT'], [52004, 'CONFLICT'], [52005, 'CONFLICT'], [1205, 'UNAVAILABLE'], [0, 'UNAVAILABLE']] as const) {
    const service = new VisitCancellationService({ async execute() { throw { number, message: 'PRIVATE SQL CONNECTION' }; } });
    await assert.rejects(service.cancel(session(), body()), (error: Error) => error.message === expected);
  }
});
test('wrong target pass malformed status or nonboolean historical presence cannot become receipts', async () => {
  for (const extra of [{ visitRequestId: randomUUID() }, { accessPassId: randomUUID() }, { operationId: 'bad' }, { status: 'APPROVED' }, { wasInsideAtCancellation: 1 }]) {
    const f = fixture(); Object.assign(f.receipt, extra); await assert.rejects(f.service.cancel(session(), f.data), /UNAVAILABLE/u);
  }
});
test('SQL cancellation port accepts exactly one procedure and its typed contract', async () => {
  const f = fixture(); await f.service.cancel(session(), f.data); let calls = 0;
  const port = new SqlVisitCancellationRepository({ async callProcedure(name, p) { calls++; assert.equal(name, 'gp.CancelVisit'); assert.equal(p.Reason.type, 'text'); return JSON.stringify(f.receipt); } });
  await port.execute(f.calls[0]); for (const invalid of [{ ...f.calls[0], Extra: { type: 'text', value: 'forged' } }, { ...f.calls[0], ExpectedPassId: { type: 'text', value: f.data.expectedPassId } }, { ...f.calls[0], SessionHash: { type: 'binary', value: Buffer.alloc(31) } }, { ...f.calls[0], Reason: { type: 'text', value: 'x'.repeat(301) } }]) await assert.rejects(port.execute(invalid as Record<string, ReadParameter>)); assert.equal(calls, 1);
});
