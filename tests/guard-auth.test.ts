import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { GuardPasswordHasher, PasswordPolicyError, validateNewGuardPassword } from '../src/security/GuardPasswordHasher.ts';
import { GuardAuthService, normalizeGuardLogin } from '../src/security/GuardAuthService.ts';
import { SqlGuardAuthRepository } from '../src/security/SqlGuardAuthRepository.ts';
import type { GuardAuthRepository, ProcedureParameter } from '../src/security/GuardAuthService.ts';

const hasher = new GuardPasswordHasher();
const password = '  guard passphrase with spaces  ';
const encoded = await hasher.hash(password);
const context = { sourceHash: randomBytes(32) };
test('Argon2id uses fresh salts and verifies correct/wrong passwords', async () => {
  assert.notEqual(encoded, await hasher.hash(password));
  assert.equal(await hasher.verify(password, encoded), true);
  assert.equal(await hasher.verify(password + 'wrong', encoded), false);
});
test('passwords preserve spaces case and Unicode exactly', async () => {
  assert.equal(await hasher.verify(password.trim(), encoded), false);
  assert.equal(await hasher.verify(password.toUpperCase(), encoded), false);
  const unicode = 'गार्ड की लंबी निजी पासफ्रेज 🔒';
  assert.equal(await hasher.verify(unicode, await hasher.hash(unicode)), true);
});
test('new password length is bounded without silent truncation', async () => {
  assert.throws(() => validateNewGuardPassword('short'), PasswordPolicyError);
  assert.throws(() => validateNewGuardPassword('x'.repeat(129)), PasswordPolicyError);
  assert.throws(() => validateNewGuardPassword('\ud800'.repeat(16)), PasswordPolicyError);
  validateNewGuardPassword('x'.repeat(128));
  assert.equal(await hasher.verify('x'.repeat(129), encoded), false);
});
test('tampered costs algorithms and noncanonical PHC are rejected before derivation', async () => {
  for (const value of [encoded.replace('19456', '999999999'), encoded.replace('argon2id', 'argon2i'), encoded + '=', 'sha256:123']) {
    await assert.rejects(hasher.verify(password, value), /INVALID_PASSWORD_HASH/u);
  }
});
test('hashing concurrency is bounded without an unbounded wait queue', async () => {
  const single = new GuardPasswordHasher(1);
  const first = single.hash(password);
  await assert.rejects(single.hash(password), /AUTH_BUSY/u); await first;
});
test('login normalization applies to ASCII IDs and never invents Unicode lookalikes', () => {
  assert.equal(normalizeGuardLogin(' Guard.1 '), 'guard.1');
  assert.equal(normalizeGuardLogin(' Gaurd1@Example.com '), 'gaurd1@example.com');
  for(const value of ['gaurd@@example.com','gaurd@example','@example.com'])assert.equal(normalizeGuardLogin(value),null);
  for (const value of ['gu ard', 'Ｇuard', '_guard', 'x'.repeat(65), null]) assert.equal(normalizeGuardLogin(value), null);
});
function repository(options: { denied?: boolean; throttled?: boolean; completionDenied?: boolean; fail?: boolean } = {}) {
  const calls: { name: string; parameters: Record<string, ProcedureParameter> }[] = [];
  const source: GuardAuthRepository = { async execute(name, parameters) {
    calls.push({ name, parameters });
    if (options.fail) throw new Error('PRIVATE_DATABASE_ERROR');
    if (name === 'gp.BeginGuardLogin') return options.throttled ? { status: 'THROTTLED' } : options.denied ? { status: 'DENIED' } : { status: 'READY', encodedPasswordHash: encoded };
    if (name === 'gp.CompleteGuardLogin') return options.completionDenied || !parameters.PasswordVerified.value ? { status: 'DENIED' } : { status: 'OK', idleExpiresAtUtc: '2026-10-20T00:15:00.000Z', absoluteExpiresAtUtc: '2026-10-20T08:00:00.000Z' };
    return { status: 'DENIED' };
  } };
  return { calls, source };
}
test('service sends password attestation and token hashes, never plaintext passwords', async () => {
  const repo = repository(); const service = await GuardAuthService.create(repo.source);
  const result = await service.signIn('GUARD1', password, context); assert(result.ok);
  assert.equal(repo.calls[0].parameters.LoginId.value, 'guard1');
  assert.equal(repo.calls[1].parameters.PasswordVerified.value, true);
  assert.equal(JSON.stringify(repo.calls).includes(password), false);
  assert.notEqual(repo.calls[1].parameters.SessionHash.value, result.sessionToken);
  assert.notEqual(result.sessionToken, result.csrfToken);
  assert.equal('encodedPasswordHash' in result, false);
});
test('wrong unknown locked and throttled logins have one public failure shape', async () => {
  const results = [];
  for (const options of [{}, { denied: true }, { throttled: true }]) {
    const repo = repository(options); const service = await GuardAuthService.create(repo.source);
    results.push(await service.signIn('guard1', password + 'wrong', context));
  }
  assert.deepEqual(results[0], results[1]); assert.deepEqual(results[0], results[2]);
});
test('correct password cannot override a reset/version denial from SQL', async () => {
  const repo = repository({ completionDenied: true }); const service = await GuardAuthService.create(repo.source);
  assert.equal((await service.signIn('guard1', password, context)).ok, false);
  assert.equal(repo.calls[1].parameters.PasswordVerified.value, true);
});
test('repository failure is closed and does not expose private details', async () => {
  const repo = repository({ fail: true }); const service = await GuardAuthService.create(repo.source);
  assert.deepEqual(await service.signIn('guard1', password, context), { ok: false, message: 'Unable to sign in.' });
});
test('invalid source context and identifiers never reach the SQL port', async () => {
  const repo = repository(); const service = await GuardAuthService.create(repo.source);
  assert.equal((await service.signIn('guard1', password, { sourceHash: Buffer.alloc(2) })).ok, false);
  assert.equal((await service.signIn('invalid login', password, context)).ok, false);
  assert.equal(repo.calls.length, 0);
});
test('SQL port allowlist rejects arbitrary procedures and extra authority fields', async () => {
  let calls = 0;
  const repo = new SqlGuardAuthRepository({ async callProcedure() { calls++; return '{}'; } });
  await assert.rejects(repo.execute('gp.ManageGuardCredential', {}), /INVALID_AUTH_SQL_CONTRACT/u);
  await assert.rejects(repo.execute('gp.BeginGuardLogin', { ActorUserId: { type: 'text', value: 'attacker' } }), /INVALID_AUTH_SQL_CONTRACT/u);
  assert.equal(calls, 0);
});
test('SQL port enforces parameter types and hash sizes', async () => {
  const repo = new SqlGuardAuthRepository({ async callProcedure() { throw new Error('SHOULD_NOT_CALL'); } });
  await assert.rejects(repo.execute('gp.BeginGuardLogin', { LoginId: { type: 'text', value: 'guard1' }, AttemptHash: { type: 'binary', value: Buffer.alloc(33) }, SourceHash: { type: 'binary', value: context.sourceHash } }), /INVALID_AUTH_SQL_PARAMETER/u);
});
test('SQL port rejects malformed success and normalizes declared UTC expiry', async () => {
  const parameters = { AttemptHash: { type: 'binary', value: randomBytes(32) }, SourceHash: { type: 'binary', value: randomBytes(32) }, PasswordVerified: { type: 'bit', value: true }, SessionHash: { type: 'binary', value: randomBytes(32) }, CsrfHash: { type: 'binary', value: randomBytes(32) }, NewEncodedPasswordHash: { type: 'text', value: null } } as Record<string, ProcedureParameter>;
  const malformed = new SqlGuardAuthRepository({ async callProcedure() { return '{"status":"OK"}'; } });
  await assert.rejects(malformed.execute('gp.CompleteGuardLogin', parameters), /INVALID_AUTH_SQL_RESPONSE/u);
  const valid = new SqlGuardAuthRepository({ async callProcedure() { return '{"status":"OK","idleExpiresAtUtc":"2026-10-20T01:02:03.123","absoluteExpiresAtUtc":"2026-10-20T08:00:00.000","secret":"dropped"}'; } });
  const result = await valid.execute('gp.CompleteGuardLogin', parameters);
  assert.equal(result.idleExpiresAtUtc, '2026-10-20T01:02:03.123Z'); assert.equal('secret' in result, false);
});
test('invalid reset and invalid cookie tokens never reach SQL', async () => {
  const repo = repository(); const service = await GuardAuthService.create(repo.source);
  assert.deepEqual(await service.completeSetup('short', password, context), { ok: false });
  assert.deepEqual(await service.sessionAction('logout', 'bad', 'bad'), { ok: false });
  assert.equal(repo.calls.length, 0);
});
