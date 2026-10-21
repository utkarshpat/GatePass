// Invoked only by Test-GuardAuthentication.ps1 with disposable fixture context on stdin.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { GuardAuthService } from '../src/security/GuardAuthService.ts';
import { SqlGuardAuthRepository } from '../src/security/SqlGuardAuthRepository.ts';
import type { ProcedureParameter } from '../src/security/GuardAuthService.ts';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const context = JSON.parse(input);
const cases: { name: string; passed: boolean }[] = [];
const bridge = fileURLToPath(new URL('./helpers/GuardAuth.SqlBridge.ps1', import.meta.url));
async function call(procedure: string, parameters: Record<string, any>, role = 'auth'): Promise<string> {
  const serialized = Object.fromEntries(Object.entries(parameters).map(([key, parameter]) => [key,
    { type: parameter.type, value: Buffer.isBuffer(parameter.value) ? parameter.value.toString('base64') : parameter.value }]));
  return await new Promise((resolve, reject) => {
    const child = spawn(context.powerShell, ['-NoProfile', '-File', bridge], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let errorOutput = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('SQL_TEST_BRIDGE_TIMEOUT')); }, 20000);
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { errorOutput += data; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error('SQL_TEST_BRIDGE_FAILED')); });
    child.stdin.end(JSON.stringify({ server: context.server, trustLocalCertificate: context.trustLocalCertificate, role, procedure, parameters: serialized }));
  });
}
const b = (value: Buffer): ProcedureParameter => ({ type: 'binary', value });
const t = (value: string | null): ProcedureParameter => ({ type: 'text', value });
const digest = (value: Buffer): Buffer => createHash('sha256').update(value).digest();
const authContext = { sourceHash: Buffer.from(context.sourceHex, 'hex') };
const repository = new SqlGuardAuthRepository({ callProcedure: call });
const service = await GuardAuthService.create(repository);
const password = randomBytes(24).toString('base64url');
const replacement = randomBytes(24).toString('base64url');
async function reset(action = 'ISSUE_SETUP'): Promise<string> {
  const token = randomBytes(32);
  const response = JSON.parse(await call('gp.ManageGuardCredential', {
    SessionHash: b(Buffer.from(context.adminSessionHex, 'hex')), CsrfHash: b(Buffer.from(context.adminCsrfHex, 'hex')),
    TargetUserId: { type: 'guid', value: context.guardUserId }, Action: t(action), LoginId: t(context.login), SetupTokenHash: b(digest(token)),
  }, 'api'));
  assert.equal(response.status, 'OK');
  return token.toString('base64url');
}
async function check(name: string, action: () => Promise<void>) {
  await action(); cases.push({ name, passed: true });
}
let session: Awaited<ReturnType<typeof service.signIn>>;
await check('actual Argon2 setup and single-use reset through restricted SQL RPC', async () => {
  const ticket = await reset();
  assert.deepEqual(await service.completeSetup(ticket, password, authContext), { ok: true });
  assert.deepEqual(await service.completeSetup(ticket, password, authContext), { ok: false });
});
await check('wrong and unknown passwords return identical public failure', async () => {
  assert.deepEqual(await service.signIn(context.login, password + 'wrong', authContext),
    await service.signIn(context.login + 'unknown', password, authContext));
});
await check('correct password returns opaque session and distinct CSRF after database commit', async () => {
  session = await service.signIn(context.login.toUpperCase(), password, authContext);
  assert(session.ok); assert.equal(session.sessionToken.length, 43); assert.notEqual(session.sessionToken, session.csrfToken);
  assert.deepEqual(await service.sessionAction('touch', session.sessionToken, session.csrfToken), { ok: true });
});
await check('password change revokes the old session and old password', async () => {
  assert(session.ok);
  const changed = await service.signIn(context.login, password, authContext, replacement);
  assert(changed.ok);
  assert.deepEqual(await service.sessionAction('touch', session.sessionToken, session.csrfToken), { ok: false });
  assert.equal((await service.signIn(context.login, password, authContext)).ok, false);
  session = changed;
});
await check('new password works and logout revokes its session', async () => {
  const signedIn = await service.signIn(context.login, replacement, authContext); assert(signedIn.ok);
  assert.deepEqual(await service.sessionAction('logout', signedIn.sessionToken, signedIn.csrfToken), { ok: true });
  assert.deepEqual(await service.sessionAction('touch', signedIn.sessionToken, signedIn.csrfToken), { ok: false });
});
await check('admin credential disable blocks correct-password login and old sessions', async () => {
  assert(session.ok); await reset('DISABLE');
  assert.equal((await service.signIn(context.login, replacement, authContext)).ok, false);
  assert.deepEqual(await service.sessionAction('touch', session.sessionToken, session.csrfToken), { ok: false });
});
process.stdout.write(JSON.stringify({ Status: 'PASS', Cases: cases, CaseCount: cases.length,
  NodeVersion: process.version, ActualArgon2AndSqlRpc: true, ProductionSqlDriver: false, BrowserHttpTest: false }));
