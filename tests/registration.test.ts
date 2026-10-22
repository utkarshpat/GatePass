import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { prepareQrEnvelopes, recoverQrCredential } from '../src/registration/QrCredentialEnvelope.ts';
import { SharpPhotoNormalizer } from '../src/registration/RegistrationPhoto.ts';
import { RegistrationService } from '../src/registration/RegistrationService.ts';
import { SqlRegistrationRepository } from '../src/registration/SqlRegistrationRepository.ts';
import type { QrKeySource } from '../src/registration/QrCredentialEnvelope.ts';
import type { RegistrationContext } from '../src/registration/RegistrationService.ts';
import type { RegistrationParameter, RegistrationRepository } from '../src/registration/SqlRegistrationRepository.ts';

const key = randomBytes(32);
const keys: QrKeySource = { async active() { return { id: 'test_key_1', key }; }, async resolve(id) { assert.equal(id, 'test_key_1'); return key; } };
const sharpPath = process.env.GATEPASS_SHARP_PATH;
if (!sharpPath) throw new Error('Set GATEPASS_SHARP_PATH to the existing approved sharp package for real decoder tests.');
const sharp = createRequire(import.meta.url)(sharpPath);
const normalizer = new SharpPhotoNormalizer(sharp);
const sourceImage = await sharp({ create: { width: 16, height: 24, channels: 3, background: '#345678' } }).png().toBuffer();
const jpegImage = await normalizer.normalize(sourceImage);

test('office selector validates SQL rows and derives authentication only from intake context', async () => {
  const context: RegistrationContext = {intakeId:randomUUID(),intakeToken:randomBytes(32).toString('base64url'),intakeCsrfToken:randomBytes(32).toString('base64url'),requestType:'DIGITAL_ID',employeeSession:{sessionToken:randomBytes(32).toString('base64url'),csrfToken:randomBytes(32).toString('base64url')}};
  let rows:any[]=[{locationId:1,locationCode:'LOC_A',locationName:'Office A'}];
  const repository:RegistrationRepository={async execute(name,parameters){assert.equal(name,'gp.ListRegistrationLocations');assert.equal(parameters.IntakeId.value,context.intakeId);assert.ok(Buffer.isBuffer(parameters.SessionHash.value));return{locations:rows};}};
  const service=new RegistrationService(repository,keys,normalizer,{async putIfAbsent(){throw new Error('unused');}});
  assert.deepEqual(await service.locations(context),{locations:rows});
  for(const invalid of [[...rows,...rows],[{locationId:1,locationCode:'../bad',locationName:'Office'}],[{locationId:1,locationCode:'LOC_A',locationName:'Office\nInjected'}],[null]]){rows=invalid;await assert.rejects(service.locations(context),{code:'UNAVAILABLE'});}
  await assert.rejects(service.locations({...context,employeeSession:undefined}),{code:'NOT_AUTHORIZED'});
});

test('QR credentials are random, encrypted and recover to the same static QR after reprint', async () => {
  const prepared = await prepareQrEnvelopes([randomUUID(), randomUUID()], keys);
  assert.notEqual(prepared[0].credentialHash, prepared[1].credentialHash); assert.notEqual(prepared[0].nonce, prepared[1].nonce);
  assert.equal(JSON.stringify(prepared).includes(key.toString('hex')), false);
  const one = await recoverQrCredential(prepared[0], keys); const two = await recoverQrCredential(prepared[0], keys);
  assert(one.equals(two)); assert.equal(createHash('sha256').update(one).digest('hex').toUpperCase(), prepared[0].credentialHash);
  assert.equal(one.toString('base64url').length, 43); one.fill(0); two.fill(0);
});
test('GCM rejects different visit/pass/purpose-key identities and tampered ciphertext or tag', async () => {
  const [envelope] = await prepareQrEnvelopes([randomUUID()], keys);
  for (const changed of [{ visitRequestId: randomUUID() }, { accessPassId: randomUUID() }, { keyVersion: 'delivery.v1.test_key_1' },
    { ciphertext: '00'.repeat(32) }, { authenticationTag: '00'.repeat(16) }]) {
    await assert.rejects(recoverQrCredential({ ...envelope, ...changed }, keys));
  }
});
test('short tags hashes and non-purpose-bound keys are rejected', async () => {
  const [envelope] = await prepareQrEnvelopes([randomUUID()], keys);
  await assert.rejects(recoverQrCredential({ ...envelope, authenticationTag: '00' }, keys));
  await assert.rejects(recoverQrCredential({ ...envelope, credentialHash: '00'.repeat(32) }, keys));
  await assert.rejects(prepareQrEnvelopes([randomUUID()], { async active() { return { id: '../key', key }; }, resolve: keys.resolve }));
  assert(key.some(byte => byte !== 0), 'Library erased the provider-owned shared key.');
});
test('normalization actually decodes re-encodes strips metadata and bounds dimensions', async () => {
  const input = await sharp({ create: { width: 1800, height: 900, channels: 3, background: '#789abc' } }).jpeg()
    .withMetadata({ orientation: 6 }).toBuffer();
  const photo = await normalizer.normalize(input); const metadata = await sharp(photo.bytes).metadata();
  assert.equal(photo.mimeType, 'image/jpeg'); assert.equal(photo.width, 640); assert.equal(photo.height, 1280);
  assert.equal(metadata.orientation, undefined); assert.equal(metadata.exif, undefined); assert.equal(metadata.icc, undefined);
  assert.equal(metadata.format, 'jpeg');
});
test('invalid unsupported overlarge and corrupt uploads fail closed', async () => {
  for (const input of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.alloc(0), Buffer.alloc(5242881), Buffer.from('ffd8ff00112233', 'hex')]) await assert.rejects(normalizer.normalize(input));
  const wide = await sharp({ create: { width: 4097, height: 1, channels: 3, background: '#abcdef' } }).png().toBuffer();
  await assert.rejects(normalizer.normalize(wide));
});
test('unsupported signature is rejected before any native decoder call', async () => {
  let calls = 0; const guarded = new SharpPhotoNormalizer(() => { calls++; throw new Error('SHOULD_NOT_DECODE'); });
  await assert.rejects(guarded.normalize(Buffer.from('GIF89a-not-supported'))); assert.equal(calls, 0);
});
test('photo decoding concurrency is bounded without an unbounded queue', async () => {
  let release: () => void = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  const bounded = new SharpPhotoNormalizer(() => ({ async metadata() { await gate; return { format: 'png', width: 1, height: 1 }; }, rotate() { throw new Error('END_TEST'); } }));
  const first = bounded.normalize(sourceImage); const second = bounded.normalize(sourceImage);
  await assert.rejects(bounded.normalize(sourceImage), /PHOTO_BUSY/u); release();
  await Promise.allSettled([first, second]);
});
const context = (type: RegistrationContext['requestType'] = 'DIGITAL_ID'): RegistrationContext => ({ intakeId: randomUUID(), intakeToken: randomBytes(32).toString('base64url'),
  intakeCsrfToken: randomBytes(32).toString('base64url'), requestType: type, employeeSession: type === 'EXTERNAL' ? undefined : { sessionToken: randomBytes(32).toString('base64url'), csrfToken: randomBytes(32).toString('base64url') } });
const body = (ctx: RegistrationContext) => ({ clientKey: randomUUID(), requestType: ctx.requestType, locationId: 1, reason: 'Test Digital ID', digitalIdReason: 'FORGOT',
  people: [{ clientPersonKey: randomUUID(), photoAssetId: randomUUID() }] });
function fakeRepository() {
  const calls: { name: string; parameters: Record<string, RegistrationParameter> }[] = []; let submitted: Record<string, unknown> | undefined;
  const repository: RegistrationRepository = { async execute(name, parameters) {
    calls.push({ name, parameters });
    if (name === 'gp.CreateRegistrationIntake') return { intakeId: parameters.IntakeId.value, status: 'DRAFT', expiresAtUtc: '2026-10-20T23:00:00.000' };
    if (name === 'gp.RecordRegistrationPhoto') return { photoAssetId: parameters.PhotoAssetId.value, storageKey: `intakes/${String(parameters.IntakeId.value).replaceAll('-', '')}/${String(parameters.PhotoAssetId.value).replaceAll('-', '')}.jpg` };
    if (submitted) return submitted;
    if (parameters.CredentialsJson.value === null) return { status: 'NEEDS_CREDENTIALS' };
    const envelopes = JSON.parse(String(parameters.CredentialsJson.value));
    submitted = { status: 'SUBMITTED', intakeId: parameters.IntakeId.value, requestType: parameters.RequestType.value, secret: 'drop-this', visits: envelopes.map((row: any) => ({
      clientPersonKey: row.clientPersonKey, visitRequestId: row.visitRequestId, accessPassId: row.accessPassId, publicReference: 'V-' + row.visitRequestId.replaceAll('-', ''),
      publicPassNumber: 'GP-' + row.accessPassId.replaceAll('-', ''), status: 'APPROVED', reused: false, ciphertext: row.ciphertext })) };
    return submitted;
  } };
  return { repository, calls };
}
const store = { async putIfAbsent(_key: string, _bytes: Buffer) {} };
test('service maps Digital ID label to stable SQL code and excludes all credential material from its result', async () => {
  const fake = fakeRepository(); const service = new RegistrationService(fake.repository, keys, normalizer, store); const ctx = context();
  const result = await service.submit(ctx, body(ctx)); assert.equal(result.requestType, 'DIGITAL_ID');
  assert.equal(fake.calls[0].parameters.RequestType.value, 'TEMP_ID'); assert.equal(fake.calls[0].parameters.CredentialsJson.value, null);
  assert.equal(fake.calls.length, 2); assert.equal('secret' in result, false); assert.equal('ciphertext' in result.visits[0], false);
  assert.equal(JSON.stringify(result).includes('TEMP_ID'), false);
});
test('committed retry succeeds without fetching keys or regenerating a credential', async () => {
  let reads = 0; const source: QrKeySource = { async active() { reads++; if (reads > 1) throw new Error('KEY_SERVICE_OFFLINE'); return keys.active(); }, resolve: keys.resolve };
  const fake = fakeRepository(); const service = new RegistrationService(fake.repository, source, normalizer, store); const ctx = context(); const data = body(ctx);
  const first = await service.submit(ctx, data); const retry = await service.submit(ctx, data);
  assert.deepEqual(retry, first); assert.equal(reads, 1);
});
test('key-source failure stops issuance after key-free SQL preflight', async () => {
  const fake = fakeRepository(); const service = new RegistrationService(fake.repository, { async active() { throw new Error('PRIVATE_KEY_PATH'); }, resolve: keys.resolve }, normalizer, store);
  const ctx = context(); await assert.rejects(service.submit(ctx, body(ctx)), error => (error as Error).message === 'UNAVAILABLE'); assert.equal(fake.calls.length, 1);
});
test('client cannot supply employee identity trusted envelope or internal request type', async () => {
  const fake = fakeRepository(); const service = new RegistrationService(fake.repository, keys, normalizer, store); const ctx = context(); const data = body(ctx);
  for (const extra of [{ employeeId: 'EMP002' }, { credentials: 'forged' }, { requestType: 'TEMP_ID' }]) await assert.rejects(service.submit(ctx, { ...data, ...extra }));
  await assert.rejects(service.submit(ctx, { ...data, people: [{ ...data.people[0], name: 'Another employee' }] })); assert.equal(fake.calls.length, 0);
});
test('public context cannot act as an employee and malformed capability does not reach SQL', async () => {
  const fake = fakeRepository(); const service = new RegistrationService(fake.repository, keys, normalizer, store);
  await assert.rejects(service.start('DIGITAL_ID')); await assert.rejects(service.start('EXTERNAL', context().employeeSession));
  const ctx = context(); ctx.intakeToken = 'bad'; await assert.rejects(service.submit(ctx, body(ctx))); assert.equal(fake.calls.length, 0);
});
test('photo upload authorizes intake before decoding and returns only a photo ID', async () => {
  const fake = fakeRepository(); const writes: string[] = [];
  const service = new RegistrationService(fake.repository, keys, normalizer, { async putIfAbsent(key) { writes.push(key); } });
  const result = await service.recordPhoto(context('EXTERNAL'), sourceImage);
  assert.deepEqual(Object.keys(result), ['photoAssetId']); assert.equal(writes.length, 1);
  assert.equal(fake.calls[0].name, 'gp.CreateRegistrationIntake'); assert.equal(fake.calls[1].name, 'gp.RecordRegistrationPhoto');
  assert.equal(fake.calls[1].parameters.MimeType.value, 'image/jpeg');
});
test('unauthorized photo upload never decodes or stores untrusted data', async () => {
  let decoded = 0; let stored = 0;
  const service = new RegistrationService({ async execute() { throw { number: 52701 }; } }, keys,
    { async normalize() { decoded++; return jpegImage; } }, { async putIfAbsent() { stored++; } });
  await assert.rejects(service.recordPhoto(context('EXTERNAL'), sourceImage), /NOT_AUTHORIZED/u); assert.equal(decoded, 0); assert.equal(stored, 0);
});
test('body validation rejects duplicate people overlong fields and unknown properties before issuing credentials', async () => {
  const fake = fakeRepository(); const service = new RegistrationService(fake.repository, keys, normalizer, store); const ctx = context(); const data = body(ctx);
  await assert.rejects(service.submit(ctx, { ...data, people: [data.people[0], data.people[0]] }));
  await assert.rejects(service.submit(ctx, { ...data, reason: 'x'.repeat(1001) }));
  await assert.rejects(service.submit(ctx, { ...data, actorUserId: randomUUID() })); assert.equal(fake.calls.length, 0);
});
test('SQL port has a static RPC allowlist typed hashes and precise UTC time requirements', async () => {
  let calls = 0; const repository = new SqlRegistrationRepository({ async callProcedure() { calls++; return '{}'; } });
  await assert.rejects(repository.execute('gp.RecordMovement', {}));
  const fake = fakeRepository(); const service = new RegistrationService(fake.repository, keys, normalizer, store); const ctx = context(); await service.submit(ctx, body(ctx));
  const parameters = { ...fake.calls[0].parameters, TokenHash: { type: 'binary', value: Buffer.alloc(33) } } as Record<string, RegistrationParameter>;
  await assert.rejects(repository.execute('gp.SubmitRegistration', parameters));
  parameters.TokenHash = fake.calls[0].parameters.TokenHash; parameters.ValidFromUtc = { type: 'datetime', value: '2026-02-30T10:00:00.000Z' };
  await assert.rejects(repository.execute('gp.SubmitRegistration', parameters)); assert.equal(calls, 0);
});
test('SQL errors and invalid result data never expose private infrastructure or secrets', async () => {
  const service = new RegistrationService({ async execute() { throw new Error('PRIVATE_SQL_CONNECTION'); } }, keys, normalizer, store); const ctx = context();
  await assert.rejects(service.submit(ctx, body(ctx)), error => (error as Error).message === 'UNAVAILABLE');
});

test('external numbers require valid international format before reaching SQL', async()=>{
  for(const phone of [undefined,null,'',' ','9876543210','+91123','+911234567890','Call +919876543210','+919876543210 ext 2']){
    const fake=fakeRepository(),ctx=context('EXTERNAL'),service=new RegistrationService(fake.repository,keys,normalizer,store);
    await assert.rejects(service.submit(ctx,{clientKey:randomUUID(),requestType:'EXTERNAL',locationId:1,projectLocationId:'1',hostEmployeeId:'EMP001',reason:'Business meeting',validFromUtc:'2026-10-20T00:00:00.000Z',validUntilUtc:'2026-10-20T12:00:00.000Z',people:[{clientPersonKey:randomUUID(),photoAssetId:randomUUID(),name:'Visitor',phone}]}));
    assert.equal(fake.calls.length,0);
  }
  const fake=fakeRepository(),ctx=context('EXTERNAL'),service=new RegistrationService(fake.repository,keys,normalizer,store);
  await service.submit(ctx,{clientKey:randomUUID(),requestType:'EXTERNAL',locationId:1,projectLocationId:'1',hostEmployeeId:'EMP001',reason:'Business meeting',validFromUtc:'2026-10-20T00:00:00.000Z',validUntilUtc:'2026-10-20T12:00:00.000Z',people:[{clientPersonKey:randomUUID(),photoAssetId:randomUUID(),name:'Visitor',phone:'+919876543210'}]});
  assert.equal(JSON.parse(String(fake.calls[0].parameters.PeopleJson.value))[0].personPhone,'+919876543210');
});


test('one missing mobile rejects the whole external group before SQL while email remains optional',async()=>{
  const fake=fakeRepository(),ctx=context('EXTERNAL'),service=new RegistrationService(fake.repository,keys,normalizer,store);
  const data={clientKey:randomUUID(),requestType:'EXTERNAL',locationId:1,projectLocationId:'1',hostEmployeeId:'EMP001',reason:'Business meeting',validFromUtc:'2026-10-20T00:00:00.000Z',validUntilUtc:'2026-10-20T12:00:00.000Z',people:[{clientPersonKey:randomUUID(),photoAssetId:randomUUID(),name:'Alice',phone:'+919876543210'},{clientPersonKey:randomUUID(),photoAssetId:randomUUID(),name:'Bob'}]};
  await assert.rejects(service.submit(ctx,data),{code:'INVALID_INPUT'});assert.equal(fake.calls.length,0);
  await service.submit(ctx,{...data,people:data.people.map(p=>({...p,phone:'+919876543210'}))});
  assert(JSON.parse(String(fake.calls[0].parameters.PeopleJson.value)).every((p:any)=>p.personEmail===null&&p.personPhone==='+919876543210'));
});

test('registration options preserve SQL office eligibility and exact assigned pair flags, failing closed on old contracts', async () => {
  const packet:any={locationId:1,locationCode:'NOIDA',locationName:'Noida',currentDate:'2026-10-21',maxVisitDate:'2026-11-01',digitalIdEligible:true,projects:[{projectLocationId:'1',projectCode:'DEMO-PRJ-001',projectName:'Project 1',assigned:true},{projectLocationId:'2',projectCode:'DEMO-PRJ-002',projectName:'Project 2',assigned:false}],hosts:[]};
  const repo:RegistrationRepository={async execute(name){assert.equal(name,'gp.GetRegistrationOptions');return structuredClone(packet);}};
  const service=new RegistrationService(repo,keys,normalizer,store);
  const ctx=context('DIGITAL_ID');
  let result=await service.options(ctx,'NOIDA');assert.equal(result.digitalIdEligible,true);assert.deepEqual(result.projects.map(p=>p.assigned),[true,false]);
  packet.digitalIdEligible=false;packet.projects[0].assigned=false;
  result=await service.options(ctx,'NOIDA');assert.equal(result.digitalIdEligible,false);assert(result.projects.every(p=>!p.assigned));
  delete packet.digitalIdEligible;await assert.rejects(service.options(ctx,'NOIDA'),{code:'UNAVAILABLE'});
  packet.digitalIdEligible=true;delete packet.projects[0].assigned;await assert.rejects(service.options(ctx,'NOIDA'),{code:'UNAVAILABLE'});
  packet.projects[0].assigned='true';await assert.rejects(service.options(ctx,'NOIDA'),{code:'UNAVAILABLE'});
});
