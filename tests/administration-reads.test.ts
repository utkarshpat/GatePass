import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AdministrationReadService, SqlAdministrationReadRepository } from '../src/administration/AdministrationReadService.ts';
import type { ReadParameter } from '../src/visits/SqlVisitReadRepository.ts';
const at = '2026-10-20T08:00:00.000Z'; const from = '2026-10-20T07:00:00.000Z'; const until = '2026-10-20T09:00:00.000Z';
const session = () => ({ sessionToken: randomBytes(32).toString('base64url'), csrfToken: randomBytes(32).toString('base64url') });
const project = () => ({ projectLocationId: '10', projectId: '2', locationId: 1, locationName: 'Noida', projectCode: 'ALPHA', projectName: 'Alpha', active: true, canAllocate: true, secret: 'PRIVATE' });
const audit = () => ({ auditEventId: '100', actionCode: 'VISIT_CANCELLED', targetType: 'VISIT', resultCode: 'SUCCESS', locationId: 1, projectLocationId: '10', actorDisplayName: 'Admin', occurredAtUtc: at, metadataJson: 'PRIVATE', targetReference: 'PRIVATE', actorUserId: randomUUID() });
function fake(response: Record<string, unknown>) {
  const calls: { name: string; p: Record<string, ReadParameter> }[] = []; const repository = { async execute(name: string, p: Record<string, ReadParameter>) { calls.push({ name, p }); return response; } };
  return { calls, repository, service: new AdministrationReadService(repository) };
}
const page = (key: string, rows: unknown[]) => ({ [key]: rows, hasMore: false, checkedAtUtc: at, private: 'PRIVATE' });
test('project selector projects bounded task fields and hashes session identity', async () => {
  const f = fake(page('projects', [project()])); const auth = session(); const result = await f.service.projects(auth, { locationId: 1 });
  assert.equal(result.projects[0].projectId, '2'); assert(!JSON.stringify(result).includes('PRIVATE')); assert.equal(f.calls[0].p.PageSize.value, 25);
  assert((f.calls[0].p.SessionHash.value as Buffer).equals(createHash('sha256').update(Buffer.from(auth.sessionToken, 'base64url')).digest()));
});
test('guard selector preserves explicit interval and literal prefix without contact fields', async () => {
  const id = randomUUID(); const f = fake(page('guards', [{ userId: id.toUpperCase(), displayName: 'Guard 1', overlappingAssignment: true, canAllocate: false, password: 'PRIVATE', email: 'PRIVATE' }]));
  const result = await f.service.guards(session(), { projectLocationId: '10', namePrefix: 'Sy%', validFromUtc: at, validUntilUtc: until }); assert.equal(result.guards[0].userId, id); assert.equal(f.calls[0].p.NamePrefix.value, 'Sy%'); assert.equal(f.calls[0].p.ValidFromUtc.type, 'datetime'); assert(!JSON.stringify(result).includes('PRIVATE'));
});
test('staff subject search returns only names identifiers and active flags', async () => {
  const f = fake(page('users', [{ userId: randomUUID(), displayName: 'Employee 1', active: false, identityIssuer: 'PRIVATE', employeeEmail: 'PRIVATE' }]));
  assert.equal((await f.service.subjects(session(), { namePrefix: 'Employee' })).users[0].active, false); assert(!JSON.stringify(await f.service.subjects(session(), { namePrefix: 'Employee' })).includes('PRIVATE'));
});
test('global role history preserves explicit capabilities and null scope fields', async () => {
  const target = randomUUID(); const row = { roleGrantId: '3', userId: target, roleCode: 'PROJECT_ADMIN', scopeType: 'PROJECT', locationId: null, projectId: '2', projectLocationId: null, validFromUtc: from, validUntilUtc: null, revoked: true, capabilities: ['AUDIT_READ'], metadataJson: 'PRIVATE' };
  const f = fake(page('grants', [row])); const result = await f.service.roles(session(), { targetUserId: target, state: 'ALL' }); assert.equal(result.grants[0].projectId, '2'); assert.deepEqual(result.grants[0].capabilities, ['AUDIT_READ']); assert(!JSON.stringify(result).includes('PRIVATE'));
});
test('current role mode rejects stale revoked or mismatched target rows', async () => {
  const target = randomUUID(); const base = { roleGrantId: '3', userId: target, roleCode: 'GUARD', scopeType: 'LOCATION', locationId: 1, projectId: null, projectLocationId: null, validFromUtc: from, validUntilUtc: null, revoked: false, capabilities: [] };
  for (const extra of [{ revoked: true }, { userId: randomUUID() }, { validFromUtc: until }, { validUntilUtc: at }, { roleCode: { toString: null } }, { locationId: null }, { capabilities: ['VISITS_READ', 'VISITS_READ'] }]) await assert.rejects(new AdministrationReadService(fake(page('grants', [{ ...base, ...extra }])).repository).roles(session(), { targetUserId: target }), /UNAVAILABLE/u);
});
test('summary keeps selected-day counts separate from current recorded presence', async () => {
  const f = fake({ localVisitDate: '2026-10-20', visits: { total: '4', pending: '1', approved: '1', denied: '1', cancelled: '1', email: 'PRIVATE' }, recordedPresence: { projectVisitsInside: '12', digitalIdsInside: '2', raw: 'PRIVATE' }, checkedAtUtc: at });
  const result = await f.service.summary(session(), { locationId: 1, localVisitDate: '2026-10-20' }); assert.equal(result.recordedPresence.projectVisitsInside, '12'); assert.equal(result.visits.total, '4'); assert(!JSON.stringify(result).includes('PRIVATE'));
});
test('inconsistent numeric or overlarge summary values fail without partial results', async () => {
  const base = { localVisitDate: '2026-10-20', visits: { total: '1', pending: '1', approved: '0', denied: '0', cancelled: '0' }, recordedPresence: { projectVisitsInside: '0', digitalIdsInside: '0' }, checkedAtUtc: at };
  for (const extra of [{ visits: { ...base.visits, total: '2' } }, { visits: { ...base.visits, total: 1 } }, { recordedPresence: { projectVisitsInside: '-1', digitalIdsInside: '0' } }, { recordedPresence: { projectVisitsInside: '9223372036854775808', digitalIdsInside: '0' } }]) await assert.rejects(fake({ ...base, ...extra }).service.summary(session(), { locationId: 1, localVisitDate: '2026-10-20' }), /UNAVAILABLE/u);
});
test('audit projection never releases metadata raw references or authentication identifiers', async () => {
  const f = fake(page('events', [audit()])); const result = await f.service.audit(session(), { fromUtc: from, untilUtc: until, locationId: 1, projectLocationId: '10' }); assert.equal(result.events[0].actionCode, 'VISIT_CANCELLED'); assert(!/PRIVATE|metadataJson|targetReference|actorUserId/u.test(JSON.stringify(result)));
});
test('audit wrong scope date result type or resource shape is not partially trusted', async () => {
  for (const extra of [{ locationId: 2 }, { projectLocationId: '11' }, { occurredAtUtc: until }, { occurredAtUtc: '2026-10-19T00:00:00.000Z' }, { resultCode: { toString: null } }, { locationId: null, projectLocationId: '10' }]) await assert.rejects(fake(page('events', [{ ...audit(), ...extra }])).service.audit(session(), { fromUtc: from, untilUtc: until, locationId: 1, projectLocationId: '10' }), /UNAVAILABLE/u);
});
test('keyset hasMore requires a complete bounded page with the exact last-row cursor', async () => {
  const f = fake({ ...page('projects', [project()]), hasMore: true, afterProjectLocationId: '10' }); assert.equal((await f.service.projects(session(), { locationId: 1, pageSize: 1 })).afterProjectLocationId, '10');
  for (const response of [{ ...page('projects', [project()]), hasMore: true, afterProjectLocationId: '11' }, { ...page('projects', []), hasMore: true, afterProjectLocationId: '10' }, { ...page('projects', [project(), project()]) }, { ...page('projects', [project()]), afterProjectLocationId: '10' }]) await assert.rejects(fake(response).service.projects(session(), { locationId: 1, pageSize: 1 }), /UNAVAILABLE/u);
});
test('UUID paging normalizes cursors while arrays remain arrays on empty pages', async () => {
  const uid = randomUUID(); const f = fake({ ...page('users', [{ userId: uid.toUpperCase(), displayName: 'User', active: true }]), hasMore: true, afterUserId: uid.toUpperCase() }); assert.equal((await f.service.subjects(session(), { namePrefix: 'Us', pageSize: 1 })).afterUserId, uid); assert.deepEqual((await fake(page('users', [])).service.subjects(session(), { namePrefix: 'Us' })).users, []);
});
test('caller cannot forge role view scope bypass totals or actor identity', async () => {
  const f = fake({}); for (const extra of [{ actorUserId: randomUUID() }, { isAdmin: true }, { capability: 'AUDIT_READ' }, { view: 'INDIA' }, { pageSize: 51 }]) await assert.rejects(f.service.projects(session(), { locationId: 1, ...extra }), /INVALID_INPUT/u); assert.equal(f.calls.length, 0);
});
test('unbounded dates invalid search malformed windows and IDs never reach SQL', async () => {
  const f = fake({}); await assert.rejects(f.service.subjects(session(), { namePrefix: '%' }), /INVALID_INPUT/u); await assert.rejects(f.service.subjects(session(), { namePrefix: 'x'.repeat(81) }), /INVALID_INPUT/u);
  await assert.rejects(f.service.audit(session(), { fromUtc: from, untilUtc: '2026-12-01T00:00:00.000Z' }), /INVALID_INPUT/u); await assert.rejects(f.service.audit(session(), { fromUtc: from, untilUtc: until, projectLocationId: '1' }), /INVALID_INPUT/u);
  await assert.rejects(f.service.guards(session(), { projectLocationId: 1 }), /INVALID_INPUT/u); await assert.rejects(f.service.guards(session(), { projectLocationId: '1', validFromUtc: until, validUntilUtc: from }), /INVALID_INPUT/u); await assert.rejects(f.service.summary(session(), { locationId: 1, localVisitDate: '2026-02-30' }), /INVALID_INPUT/u); assert.equal(f.calls.length, 0);
});
test('expired token shapes and SQL errors use stable redacted errors', async () => {
  const f = fake({}); await assert.rejects(f.service.projects({ ...session(), csrfToken: 'bad' }, { locationId: 1 }), /NOT_AUTHORIZED/u); assert.equal(f.calls.length, 0);
  for (const [number, message] of [[52001, 'NOT_AUTHORIZED'], [52002, 'INVALID_INPUT'], [52004, 'CONFLICT'], [1205, 'UNAVAILABLE'], [0, 'UNAVAILABLE']] as const) {
    const service = new AdministrationReadService({ async execute() { throw { number, message: 'PRIVATE CONNECTION' }; } }); await assert.rejects(service.projects(session(), { locationId: 1 }), (error: Error) => error.message === message);
  }
});
test('impossible selector flags wrong office or oversized fields fail closed', async () => {
  for (const row of [{ ...project(), locationId: 2 }, { ...project(), active: false, canAllocate: true }, { ...project(), projectName: 'x'.repeat(201) }]) await assert.rejects(fake(page('projects', [row])).service.projects(session(), { locationId: 1 }), /UNAVAILABLE/u);
  await assert.rejects(fake(page('guards', [{ userId: randomUUID(), displayName: 'Guard', overlappingAssignment: true, canAllocate: true }])).service.guards(session(), { projectLocationId: '10' }), /UNAVAILABLE/u);
});
test('SQL read port exposes only exact typed allowlists with strict nullability', async () => {
  const f = fake(page('projects', [])); await f.service.projects(session(), { locationId: 1 }); const parameters = f.calls[0].p; let calls = 0;
  const port = new SqlAdministrationReadRepository({ async callProcedure(name) { assert.equal(name, 'gp.ListAdminProjectLocations'); calls++; return '{}'; } }); await port.execute('gp.ListAdminProjectLocations', parameters);
  await assert.rejects(port.execute('gp.GrantStaffRole', parameters)); await assert.rejects(port.execute('gp._AdminScopeAllowed', parameters));
  for (const p of [{ ...parameters, LocationId: { type: 'int', value: null } }, { ...parameters, PageSize: { type: 'int', value: 51 } }, { ...parameters, AfterProjectLocationId: { type: 'bigint', value: '0' } }, { ...parameters, SessionHash: { type: 'binary', value: Buffer.alloc(31) } }, { ...parameters, Raw: { type: 'text', value: 'bad' } }]) await assert.rejects(port.execute('gp.ListAdminProjectLocations', p as Record<string, ReadParameter>)); assert.equal(calls, 1);
});
