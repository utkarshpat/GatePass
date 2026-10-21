import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SqlStaffAdministrationRepository, StaffAdministrationService } from '../src/administration/StaffAdministrationService.ts';
import type { ReadParameter } from '../src/visits/SqlVisitReadRepository.ts';
const session = () => ({ sessionToken: randomBytes(32).toString('base64url'), csrfToken: randomBytes(32).toString('base64url') });
const allocate = () => ({ clientKey: randomUUID(), guardUserId: randomUUID(), projectLocationId: '9223372036854775807', reason: 'Project coverage' });
const grant = () => ({ clientKey: randomUUID(), targetUserId: randomUUID(), roleCode: 'RECEPTION', scopeType: 'LOCATION', locationId: 1, capabilities: ['VISITS_READ', 'PASS_PRINT'], reason: 'Reception duties' });
function fixture() {
  const calls: { name: string; p: Record<string, ReadParameter> }[] = []; const op = randomUUID().toUpperCase(); let overrides: Record<string, unknown> = {};
  const repository = { async execute(name: string, p: Record<string, ReadParameter>) {
    calls.push({ name, p }); const common = { operationId: op, reason: 'PRIVATE', ciphertext: 'PRIVATE' };
    return { ...common, ...(name === 'gp.AllocateGuard' ? { assignmentId: '9223372036854775806', guardUserId: p.GuardUserId.value, projectLocationId: p.ProjectLocationId.value, status: 'ALLOCATED' }
      : name === 'gp.DeallocateGuard' ? { assignmentId: Number(p.GuardAssignmentId.value), deallocated: true }
      : name === 'gp.GrantStaffRole' ? { roleGrantId: '123', targetUserId: p.TargetUserId.value, roleCode: p.RoleCode.value, scopeType: p.ScopeType.value, status: 'GRANTED' }
        : { roleGrantId: p.RoleGrantId.value, targetUserId: randomUUID().toUpperCase(), revoked: true }), ...overrides };
  } };
  return { calls, repository, service: new StaffAdministrationService(repository), override(v: Record<string, unknown>) { overrides = v; } };
}
test('allocation sends typed scope and hashed tokens without caller identity', async () => {
  const f = fixture(); const auth = session(); const d = allocate(); const result = await f.service.allocate(auth, d); const p = f.calls[0].p;
  assert.equal(p.ProjectLocationId.type, 'bigint'); assert.equal(p.ProjectLocationId.value, d.projectLocationId); assert.equal(p.ValidFromUtc.value, null);
  assert((p.SessionHash.value as Buffer).equals(createHash('sha256').update(Buffer.from(auth.sessionToken, 'base64url')).digest())); assert.equal(typeof result.assignmentId, 'string'); assert(!/reason|ciphertext/u.test(JSON.stringify(result)));
});
test('grant sorts only an explicit unique capability set and does not infer defaults', async () => {
  const f = fixture(); const d = grant(); const result = await f.service.grant(session(), d); const p = f.calls[0].p;
  assert.equal(p.CapabilitiesJson.value, '["PASS_PRINT","VISITS_READ"]'); assert.equal(p.ProjectId.value, null); assert.equal(p.LocationId.type, 'int'); assert.equal(result.status, 'GRANTED'); assert(!JSON.stringify(result).includes('capabilities'));
});
test('existing numeric deallocation receipt becomes a safe string identifier', async () => {
  const f = fixture(); const r = await f.service.deallocate(session(), { clientKey: randomUUID(), assignmentId: '123', reason: 'Ended' }); assert.equal(r.assignmentId, '123'); assert.equal(r.deallocated, true);
});
test('role revocation returns only authorized bounded reference fields', async () => {
  const f = fixture(); const r = await f.service.revoke(session(), { clientKey: randomUUID(), roleGrantId: '9223372036854775807', reason: 'Ended' }); assert.equal(r.roleGrantId, '9223372036854775807'); assert.equal(r.revoked, true); assert(!/reason|ciphertext/u.test(JSON.stringify(r)));
});
test('forged actor privileges or version fields never reach SQL', async () => {
  const f = fixture(); for (const extra of [{ actorUserId: randomUUID() }, { authorizationVersion: 1 }, { grantedByUserId: randomUUID() }, { isAdmin: true }, { assignmentId: '1' }]) await assert.rejects(f.service.allocate(session(), { ...allocate(), ...extra }), /INVALID_INPUT/u);
  assert.equal(f.calls.length, 0);
});
test('invalid session CSRF and noncanonical bearer encodings fail locally', async () => {
  const f = fixture(); await assert.rejects(f.service.allocate({ ...session(), csrfToken: 'bad' }, allocate()), /NOT_AUTHORIZED/u);
  const raw = randomBytes(32).toString('base64url'); const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'; const altered = raw.slice(0, -1) + alphabet[alphabet.indexOf(raw.at(-1)!) + 1];
  await assert.rejects(f.service.allocate({ ...session(), sessionToken: altered }, allocate()), /NOT_AUTHORIZED/u); assert.equal(f.calls.length, 0);
});
test('invalid bigint UTC window or reason fields fail before repository calls', async () => {
  const f = fixture(); for (const extra of [{ projectLocationId: 1 }, { projectLocationId: '9223372036854775808' }, { projectLocationId: '01' }, { validFromUtc: '2026-02-30T01:00:00.000Z' },
    { validFromUtc: '2026-10-20T10:00:00.000Z', validUntilUtc: '2026-10-20T09:00:00.000Z' }, { reason: 'x'.repeat(301) }, { reason: '\uD800' }, { reason: 'bad\u0000reason' }, { reason: '' }]) await assert.rejects(f.service.allocate(session(), { ...allocate(), ...extra }), /INVALID_INPUT/u);
  assert.equal(f.calls.length, 0);
});
test('role and scope combinations require the exact appropriate resource', async () => {
  const f = fixture(); for (const extra of [{ roleCode: 'UNKNOWN' }, { scopeType: 'INDIA' }, { locationId: null }, { projectId: '1' }, { capabilities: [] }, { capabilities: ['VISITS_READ', 'VISITS_READ'] }, { capabilities: ['VISITS_READ '] }, { capabilities: ['a'] }, { roleCode: {} }]) await assert.rejects(f.service.grant(session(), { ...grant(), ...extra }), /INVALID_INPUT/u);
  assert.equal(f.calls.length, 0);
});
test('all supported role scope forms serialize without generated SQL or inferred authority', async () => {
  const f = fixture(); for (const extra of [{ roleCode: 'GUARD' }, { roleCode: 'LOCATION_ADMIN' }, { roleCode: 'PROJECT_ADMIN', scopeType: 'PROJECT', locationId: null, projectId: '1' },
    { roleCode: 'PROJECT_ADMIN', scopeType: 'PROJECT_LOCATION', locationId: null, projectLocationId: '2' }, { roleCode: 'INDIA_ADMIN', scopeType: 'INDIA', locationId: null }]) await f.service.grant(session(), { ...grant(), ...extra, capabilities: ['VISITS_READ'] });
  assert.equal(f.calls.length, 5);
});
test('wrong resource receipts and unsafe numeric SQL identifiers cannot escape', async () => {
  for (const extra of [{ guardUserId: randomUUID() }, { projectLocationId: '1' }, { status: 'APPROVED' }, { assignmentId: 9007199254740992 }, { operationId: 'bad' }]) {
    const f = fixture(); f.override(extra); await assert.rejects(f.service.allocate(session(), allocate()), /UNAVAILABLE/u);
  }
  const f = fixture(); f.override({ targetUserId: randomUUID() }); await assert.rejects(f.service.grant(session(), grant()), /UNAVAILABLE/u);
});
test('role deallocation and revocation response flags must match the exact action', async () => {
  const f = fixture(); f.override({ revoked: false }); await assert.rejects(f.service.revoke(session(), { clientKey: randomUUID(), roleGrantId: '1', reason: 'End' }), /UNAVAILABLE/u);
  f.override({ assignmentId: '2' }); await assert.rejects(f.service.deallocate(session(), { clientKey: randomUUID(), assignmentId: '1', reason: 'End' }), /UNAVAILABLE/u);
});
test('SQL errors are mapped to redacted stable codes', async () => {
  for (const [number, expected] of [[52001, 'NOT_AUTHORIZED'], [52002, 'INVALID_INPUT'], [52003, 'CONFLICT'], [52004, 'CONFLICT'], [52005, 'CONFLICT'], [1205, 'UNAVAILABLE']] as const) {
    const service = new StaffAdministrationService({ async execute() { throw { number, message: 'PRIVATE CONNECTION' }; } }); await assert.rejects(service.allocate(session(), allocate()), (error: Error) => error.message === expected);
  }
});
test('typed SQL repository exposes only the four exact named contracts', async () => {
  const f = fixture(); await f.service.allocate(session(), allocate()); let calls = 0; const response = { operationId: randomUUID() };
  const port = new SqlStaffAdministrationRepository({ async callProcedure(name) { calls++; assert.equal(name, 'gp.AllocateGuard'); return JSON.stringify(response); } }); const p = f.calls[0].p;
  await port.execute('gp.AllocateGuard', p); await assert.rejects(port.execute('gp._RequireRoleAdministrator', p)); await assert.rejects(port.execute('gp.RecordMovement', p));
  for (const invalid of [{ ...p, Extra: { type: 'text', value: 'bad' } }, { ...p, ProjectLocationId: { type: 'bigint', value: null } }, { ...p, GuardUserId: { type: 'text', value: randomUUID() } }, { ...p, SessionHash: { type: 'binary', value: Buffer.alloc(31) } }]) await assert.rejects(port.execute('gp.AllocateGuard', invalid as Record<string, ReadParameter>)); assert.equal(calls, 1);
});

test('platform administration uses an explicit platform scope and bounded capabilities',async()=>{const f=fixture();const input={...grant(),roleCode:'PLATFORM_ADMIN',scopeType:'PLATFORM',locationId:null,capabilities:['VISITS_READ','GUARDS_MANAGE','REPORTS_READ','REPORTS_EXPORT','AUDIT_READ','GUARD_CREDENTIALS_MANAGE','STAFF_CREDENTIALS_MANAGE','ROLE_GRANTS_MANAGE']};const result=await f.service.grant(session(),input);assert.equal(result.roleCode,'PLATFORM_ADMIN');assert.equal(f.calls[0].p.ScopeType.value,'PLATFORM');await assert.rejects(f.service.grant(session(),{...input,scopeType:'INDIA'}),/INVALID_INPUT/u);});
