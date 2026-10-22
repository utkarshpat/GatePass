import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { StaffEntryRoutes } from '../src/development/StaffEntryRoutes.ts';

for (const provider of ['LOCAL', 'SSO'] as const) {
 for (const failRevocation of [false, true]) {
  test(`${provider} replacement uses original CSRF binding${failRevocation ? ' and rolls back on revocation failure' : ''}`, async () => {
   const previousEnv = { NODE_ENV: process.env.NODE_ENV, GATEPASS_SSO_MODE: process.env.GATEPASS_SSO_MODE, GATEPASS_DIRECTORY_MODE: process.env.GATEPASS_DIRECTORY_MODE };
   Object.assign(process.env, { NODE_ENV: 'test', GATEPASS_SSO_MODE: 'dummy', GATEPASS_DIRECTORY_MODE: 'mock' });
   try {
    const sessions = Array.from({ length: 2 }, () => ({ sessionToken: randomBytes(32).toString('base64url'), csrfToken: randomBytes(32).toString('base64url'), absoluteExpiresAtUtc: new Date(Date.now() + 3600000).toISOString() }));
    const revoked: typeof sessions = []; let signed = 0;
    const revoke = async (session: typeof sessions[number]) => {
     revoked.push(session);
     if (failRevocation && session.sessionToken === sessions[0].sessionToken) throw new Error('SQL unavailable');
     return { ok: true };
    };
    const sso = { async signIn() { return sessions[signed++]; }, async verify() { return true; }, async sessionAction(_action: string, session: typeof sessions[number]) { return revoke(session); } };
    const guard = { async signIn() { return { ok: true, ...sessions[signed++] }; }, async sessionAction(_action: string, sessionToken: string, csrfToken: string) { return revoke({ sessionToken, csrfToken, absoluteExpiresAtUtc: '' }); } };
    const client = { async callProcedure(name: string) { return JSON.stringify(name === 'gp.ResolveStaffLoginIdentity' ? { provider, employeeId: 'EMP001' } : { displayName: 'Staff', grants: [{ roleCode: 'RECEPTION', scopeType: 'LOCATION', scopeName: 'Noida', capabilities: [{ code: 'VISITS_READ' }] }], receptionAvailable: true, adminAvailable: false }); } };
    const route = new StaffEntryRoutes(sso as any, guard as any, client);
    const request = (cookie?: string) => Object.assign(Readable.from([Buffer.from(JSON.stringify({ login: 'staff@example.com', password: 'Sopra@123' }))]), { url: '/api/staff/login', socket: { remoteAddress: '127.0.0.1' }, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } }) as any;
    await route.handle(request(), { setHeader() {} } as any);
    let cookiesPublished = false;
    const replacement = route.handle(request('gp-staff-session=' + sessions[0].sessionToken), { setHeader() { cookiesPublished = true; } } as any);
    if (failRevocation) {
     await assert.rejects(replacement, /SQL unavailable/);
     assert.equal(cookiesPublished, false);
     assert.equal(revoked[1].sessionToken, sessions[1].sessionToken);
     assert.equal(await route.verify(sessions[0]), true);
     assert.equal(await route.verify(sessions[1]), false);
    } else {
     const result = await replacement;
     assert.equal(cookiesPublished, true);
     assert.equal(await route.verify(sessions[0]), false);
     assert.equal(await route.verify(sessions[1]), true);
     assert.ok(!JSON.stringify(result).includes(sessions[1].csrfToken));
    }
    assert.equal(revoked[0].sessionToken, sessions[0].sessionToken);
    assert.equal(revoked[0].csrfToken, sessions[0].csrfToken);
   } finally {
    for (const [key, value] of Object.entries(previousEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
   }
  });
 }
}
