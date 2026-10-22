import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { VisitReadService, VisitPhotoService } from '../src/visits/VisitReadService.ts';
import { SqlVisitReadRepository } from '../src/visits/SqlVisitReadRepository.ts';
import type { ReadContext } from '../src/visits/VisitReadService.ts';
import type { ReadParameter, VisitReadRepository } from '../src/visits/SqlVisitReadRepository.ts';

const context = (view: ReadContext['view'] = 'GUARD'): ReadContext => ({ view, sessionToken: randomBytes(32).toString('base64url'), csrfToken: randomBytes(32).toString('base64url') });
const stamp = '2026-10-20T10:20:00.000Z';
const visit = () => ({ visitRequestId: randomUUID().toUpperCase(), publicReference: 'V-' + 'a'.repeat(32), requestType: 'EXTERNAL', personName: 'अतिथि / 1',
  locationId: 1, locationName: 'Noida', projectLocationId: '1', projectName: 'Project', status: 'APPROVED', passStatus: 'ACTIVE', isInside: false,
  validFromUtc: stamp, validUntilUtc: stamp, accessPassId: randomUUID().toUpperCase(), publicPassNumber: 'GP-' + 'b'.repeat(32),
  checkedAtUtc: stamp, photoAvailable: true, canDecide: false, canCancel: false, canEnter: true, canExit: false, canReconcileExit: false,
  personEmail: 'private@example.com', personPhone: 'private', storageKey: 'PRIVATE', ciphertext: 'PRIVATE', credentialHash: 'PRIVATE', reason: 'PRIVATE' });
function fake(response: Record<string, unknown> | ((name: string, parameters: Record<string, ReadParameter>) => Record<string, unknown>)) {
  const calls: { name: string; parameters: Record<string, ReadParameter> }[] = [];
  const repository: VisitReadRepository = { async execute(name, parameters) { calls.push({ name, parameters }); return typeof response === 'function' ? response(name, parameters) : response; } };
  return { repository, calls };
}
test('list projects safe task fields and normalizes SQL uppercase identifiers', async () => {
  const original = visit(); const f = fake({ visits: [original], hasMore: false, checkedAtUtc: stamp, secret: 'DROP' });
  const result = await new VisitReadService(f.repository).list(context(), { locationId: 1 });
  assert.equal(result.visits[0].visitRequestId, original.visitRequestId.toLowerCase()); assert.equal(result.visits[0].personName, original.personName);
  assert(!/personEmail|personPhone|reason|snapshotHash|storageKey|ciphertext|credentialHash|secret/u.test(JSON.stringify(result)));
});
test('detail retains necessary state and strips private fields from guard output', async () => {
  const original = visit(); const result = await new VisitReadService(fake(original).repository).detail(context(), original.visitRequestId);
  assert.equal(result.canEnter, true); assert(!/personEmail|personPhone|reason|storageKey|ciphertext|credentialHash/u.test(JSON.stringify(result)));
});
test('detail projects movement history timeline with guard display names', async () => {
  const original = {
    ...visit(),
    movements: [
      { accessEventId: '387', eventType: 'ENTRY', entryMethod: 'MANUAL', guardName: 'Guard 1', occurredAtUtc: stamp },
      { accessEventId: '388', eventType: 'EXIT', entryMethod: 'SCAN', guardName: 'Guard 2', occurredAtUtc: stamp }
    ]
  };
  const result = await new VisitReadService(fake(original).repository).detail(context('GUARD'), original.visitRequestId);
  assert.equal(Array.isArray(result.movements), true);
  assert.equal((result.movements as any[]).length, 2);
  assert.equal((result.movements as any[])[0].eventType, 'ENTRY');
  assert.equal((result.movements as any[])[0].guardName, 'Guard 1');
  assert.equal((result.movements as any[])[1].eventType, 'EXIT');
  assert.equal((result.movements as any[])[1].guardName, 'Guard 2');
});
  test('movement history is bounded, uses exact bigint strings, and hides guard names from own/host views', async () => {
    const movement={accessEventId:'9007199254740993',eventType:'ENTRY',entryMethod:'MANUAL',guardName:'Guard 1',occurredAtUtc:stamp};
    const original={...visit(),reason:'Site visit',snapshotVersion:1,snapshotHash:'A'.repeat(64),movements:[movement]};
    const result=await new VisitReadService(fake(original).repository).detail(context('GUARD'),original.visitRequestId);
    assert.equal((result.movements as any[])[0].accessEventId,'9007199254740993');
    for(const view of ['OWN','HOST'] as const){const privateResult=await new VisitReadService(fake(original).repository).detail(context(view),original.visitRequestId);assert.deepEqual(privateResult.movements,[]);}
    for(const movements of [Array(101).fill(movement),[{...movement,accessEventId:9007199254740992}],[{...movement,accessEventId:'01'}]])await assert.rejects(new VisitReadService(fake({...original,movements}).repository).detail(context('GUARD'),original.visitRequestId),/UNAVAILABLE/u);
    await assert.rejects(new VisitReadService(fake({...original,movementsHasMore:true}).repository).detail(context('GUARD'),original.visitRequestId),/UNAVAILABLE/u);
  });
  test('only host detail includes decision snapshot and non-guard details include reason', async () => {
  const original = { ...visit(), reason: 'Site visit', snapshotHash: 'A'.repeat(64), snapshotVersion: 1, canDecide: true, canEnter: false };
  const result = await new VisitReadService(fake(original).repository).detail(context('HOST'), original.visitRequestId);
  assert.equal(result.snapshotHash, original.snapshotHash); assert.equal(result.reason, 'Site visit'); assert(!JSON.stringify(result).includes('private@example'));
});
test('empty pages remain arrays and valid continuation is explicit', async () => {
  const id = randomUUID(); const f = fake({ visits: [], hasMore: false, checkedAtUtc: stamp }); const service = new VisitReadService(f.repository);
  assert.deepEqual((await service.list(context(), { locationId: 1 })).visits, []);
  await service.list(context(), { locationId: 1, cursor: { submittedAtUtc: stamp, visitRequestId: id } });
  assert.equal(f.calls[1].parameters.AfterVisitRequestId.value, id); assert.equal(f.calls[1].parameters.AfterSubmittedAtUtc.type, 'datetime');
});
test('unknown actor fields forged view invalid dates and unbounded pages never reach repository', async () => {
  const f = fake({}); const service = new VisitReadService(f.repository);
  for (const value of [{ locationId: 1, employeeId: 'EMP001' }, { locationId: 1, view: 'ADMIN' }, { locationId: 1, pageSize: 51 },
    { locationId: 1, localVisitDate: '2026-02-30' }, { locationId: 1, queue: 'INSIDE', localVisitDate: '2026-10-20' },
    { locationId: 1, cursor: { submittedAtUtc: stamp } }, {}]) await assert.rejects(service.list(context(), value), /INVALID_INPUT/u);
  assert.equal(f.calls.length, 0);
});
test('malformed sessions and unknown view fail before SQL', async () => {
  const f = fake({}); const service = new VisitReadService(f.repository);
  await assert.rejects(service.detail({ ...context(), sessionToken: 'bad' }, randomUUID()), /NOT_AUTHORIZED/u);
  await assert.rejects(service.detail({ ...context(), view: 'SUPERADMIN' as any }, randomUUID()), /INVALID_INPUT/u); assert.equal(f.calls.length, 0);
});
test('scan hashes QR bytes and never sends raw bearer or arbitrary authority to SQL', async () => {
  const credential = randomBytes(32).toString('base64url'); const f = fake({ outcome: 'VALID', visit: visit() });
  const result = await new VisitReadService(f.repository).verify(context(), { credential, locationId: 1, correlationId: randomUUID() });
  assert.equal(result.outcome, 'VALID'); assert.equal(f.calls[0].parameters.CredentialHash.value instanceof Buffer, true);
  assert((f.calls[0].parameters.CredentialHash.value as Buffer).equals(createHash('sha256').update(Buffer.from(credential, 'base64url')).digest()));
  assert(!JSON.stringify(f.calls).includes(credential)); assert(!Object.hasOwn(f.calls[0].parameters, 'View'));
});
test('one guard can retrieve multiple simultaneous project assignments without selecting a fixed mode', async () => {
  const projects = ['1', '2', '3', '4'].map(id => ({ projectLocationId: id, projectName: `Project ${id}`, private: 'DROP' }));
  const f = fake({ locationId: 1, projects, canHandleDigitalId: true, checkedAtUtc: stamp });
  const result = await new VisitReadService(f.repository).workContexts(context(), 1);
  assert.equal(result.projects.length, 4); assert(!JSON.stringify(result).includes('private')); assert.equal(f.calls[0].name, 'gp.ListGuardWorkContexts');
});
test('scan supports all assigned projects or an exact optional project filter with validated output', async () => {
  const original = visit(); const f = fake({ outcome: 'VALID', visit: original }); const service = new VisitReadService(f.repository);
  const data = { credential: randomBytes(32).toString('base64url'), locationId: 1, correlationId: randomUUID() };
  await service.verify(context(), data); assert.equal(f.calls[0].parameters.SelectedProjectLocationId.value, null);
  await service.verify(context(), { ...data, selectedProjectLocationId: '1' }); assert.equal(f.calls[1].parameters.SelectedProjectLocationId.value, '1');
  await assert.rejects(service.verify(context(), { ...data, selectedProjectLocationId: '2' }), /UNAVAILABLE/u);
  await assert.rejects(service.verify(context(), { ...data, selectedProjectLocationId: '0' }), /INVALID_INPUT/u);
});
test('denied scan response cannot disclose attached private or visit fields', async () => {
  const f = fake({ outcome: 'NOT_AVAILABLE', visit: visit(), secret: 'DROP' });
  assert.deepEqual(await new VisitReadService(f.repository).verify(context(), { credential: randomBytes(32).toString('base64url'), locationId: 1, correlationId: randomUUID() }), { outcome: 'NOT_AVAILABLE' });
});
test('non-guard forged and malformed scans never reach SQL', async () => {
  const f = fake({}); const service = new VisitReadService(f.repository); const data = { credential: randomBytes(32).toString('base64url'), locationId: 1, correlationId: randomUUID() };
  await assert.rejects(service.verify(context('ADMIN'), data)); await assert.rejects(service.verify(context(), { ...data, visitRequestId: randomUUID() }));
  await assert.rejects(service.verify(context(), { ...data, credential: '123' })); assert.equal(f.calls.length, 0);
});
function photoFixture() {
  const bytes = randomBytes(100); const id = randomUUID(); const key = `intakes/${randomUUID().replaceAll('-', '')}/${id.replaceAll('-', '')}.jpg`;
  return { bytes, metadata: { photoAssetId: id.toUpperCase(), storageKey: key, contentHash: createHash('sha256').update(bytes).digest('hex').toUpperCase(), mimeType: 'image/jpeg', byteLength: bytes.length } };
}
test('photo uses bounded storage reads validates digest and reauthorizes before binary response', async () => {
  const photo = photoFixture(); const f = fake(photo.metadata); let reads = 0;
  const result = await new VisitPhotoService(f.repository, { async read(key, maximum) { reads++; assert.equal(key, photo.metadata.storageKey); assert.equal(maximum, 100); return photo.bytes; } }).read(context(), randomUUID());
  assert(result.bytes.equals(photo.bytes)); assert.notEqual(result.bytes, photo.bytes); assert.equal(reads, 1); assert.equal(f.calls.length, 2);
  assert.equal(result.cacheControl, 'private, no-store'); assert.equal(result.contentTypeOptions, 'nosniff'); assert(!Object.hasOwn(result, 'storageKey'));
});
test('photo denial prevents any storage access', async () => {
  let reads = 0; const repository: VisitReadRepository = { async execute() { throw { number: 52801 }; } };
  await assert.rejects(new VisitPhotoService(repository, { async read() { reads++; return Buffer.alloc(1); } }).read(context(), randomUUID()), /NOT_AUTHORIZED/u); assert.equal(reads, 0);
});
test('revocation during I/O prevents photo delivery', async () => {
  const photo = photoFixture(); let allowed = true; const repository: VisitReadRepository = { async execute() { if (!allowed) throw { number: 52001 }; return photo.metadata; } };
  await assert.rejects(new VisitPhotoService(repository, { async read() { allowed = false; return photo.bytes; } }).read(context(), randomUUID()), /NOT_AUTHORIZED/u);
});
test('corrupt stored photo length or digest never reaches output', async () => {
  const photo = photoFixture(); for (const bytes of [Buffer.alloc(99), Buffer.alloc(100)]) await assert.rejects(
    new VisitPhotoService(fake(photo.metadata).repository, { async read() { return bytes; } }).read(context(), randomUUID()), /UNAVAILABLE/u);
});
test('changed metadata after I/O and unsafe storage paths fail closed', async () => {
  const photo = photoFixture(); let calls = 0;
  await assert.rejects(new VisitPhotoService({ async execute() { calls++; return { ...photo.metadata, contentHash: calls === 1 ? photo.metadata.contentHash : 'B'.repeat(64) }; } },
    { async read() { return photo.bytes; } }).read(context(), randomUUID()), /UNAVAILABLE/u);
  for (const storageKey of ['../secret', '/absolute/photo.jpg', photo.metadata.storageKey.replace('intakes/', 'public/')]) await assert.rejects(
    new VisitPhotoService(fake({ ...photo.metadata, storageKey }).repository, { async read() { throw new Error('SHOULD_NOT_READ'); } }).read(context(), randomUUID()), /UNAVAILABLE/u);
});
test('SQL ports restrict API and media to distinct exact typed RPC contracts', async () => {
  let calls = 0; const client = { async callProcedure() { calls++; return '{}'; } }; const api = new SqlVisitReadRepository(client, 'api'); const media = new SqlVisitReadRepository(client, 'media');
  await assert.rejects(api.execute('gp.ResolveVisitPhoto', {})); await assert.rejects(media.execute('gp.GetVisitDetail', {})); await assert.rejects(api.execute('gp.RecordMovement', {}));
  const original = visit(); const f = fake(original); const service = new VisitReadService(f.repository); await service.detail(context(), original.visitRequestId); const p = f.calls[0].parameters;
  await assert.rejects(api.execute('gp.GetVisitDetail', { ...p, SessionHash: { type: 'binary', value: Buffer.alloc(31) } }));
  await assert.rejects(api.execute('gp.GetVisitDetail', { ...p, actorUserId: { type: 'guid', value: randomUUID() } })); assert.equal(calls, 0);
});
test('backend SQL and storage errors are redacted', async () => {
  const repository: VisitReadRepository = { async execute() { throw new Error('PRIVATE_DATABASE_PASSWORD'); } };
  await assert.rejects(new VisitReadService(repository).detail(context(), randomUUID()), error => (error as Error).message === 'UNAVAILABLE');
  const photo = photoFixture(); await assert.rejects(new VisitPhotoService(fake(photo.metadata).repository, { async read() { throw new Error('PRIVATE_STORAGE_ROOT'); } }).read(context(), randomUUID()), error => (error as Error).message === 'UNAVAILABLE');
});
test('invalid SQL row and cursor data cannot become partially trusted UI results', async () => {
  await assert.rejects(new VisitReadService(fake(visit()).repository).detail(context(), randomUUID()), /UNAVAILABLE/u);
  for (const response of [{ visits: [visit(), visit()], hasMore: 'yes', checkedAtUtc: stamp }, { visits: [], hasMore: true, afterVisitRequestId: 'bad', checkedAtUtc: stamp },
    { visits: [{ ...visit(), isInside: 'true' }], hasMore: false, checkedAtUtc: stamp }]) await assert.rejects(new VisitReadService(fake(response).repository).list(context(), { locationId: 1 }), /UNAVAILABLE/u);
});

test('reception detail uses an authoritative return receipt and print count without disclosing them to other views',async()=>{
 const original={...visit(),passStatus:'REVOKED',returnedAtUtc:stamp,printCount:3};
 const result=await new VisitReadService(fake(original).repository).detail(context('RECEPTION'),original.visitRequestId);
 assert.equal(result.returnedAtUtc,stamp);assert.equal(result.printCount,3);
 for(const view of ['GUARD','OWN','ADMIN'] as const){const r=await new VisitReadService(fake(original).repository).detail(context(view),original.visitRequestId);assert.equal(Object.hasOwn(r,'returnedAtUtc'),false);assert.equal(Object.hasOwn(r,'printCount'),false);}
 for(const invalid of [{returnedAtUtc:'yesterday'},{printCount:-1},{printCount:0.5}])await assert.rejects(new VisitReadService(fake({...original,...invalid}).repository).detail(context('RECEPTION'),original.visitRequestId),{code:'UNAVAILABLE'});
 assert.equal((await new VisitReadService(fake({...original,returnedAtUtc:undefined}).repository).detail(context('RECEPTION'),original.visitRequestId)).returnedAtUtc,null);
});
