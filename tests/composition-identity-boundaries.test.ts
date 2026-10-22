import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { composeApi } from '../src/transport/Composition.ts';

const database = { server: '127.0.0.1', port: 1433, database: 'GatePass_Test', user: 'api-user', password: 'synthetic-only', trustServerCertificate: false };
const config = () => ({ origin: 'https://gatepass.example.com', sourceKey: randomBytes(32), api: { ...database }, auth: { ...database, user: 'auth-user' } });
test('composition rejects shared identities and mismatched database endpoints before connecting', async () => {
 for (const patch of [{ user: 'API-USER' }, { server: 'elsewhere.invalid' }, { port: 1444 }, { database: 'OtherDatabase' }]) {
  const c = config(); Object.assign(c.auth, patch);
  await assert.rejects(composeApi(c), /INVALID_IDENTITY_SEPARATION/);
 }
});
test('Outlook composition requires a third identity on the same endpoint and exact application origin', async () => {
 for (const patch of [{ user: 'API-USER' }, { user: 'AUTH-USER' }, { server: 'elsewhere.invalid' }, { port: 1444 }, { database: 'OtherDatabase' }, { origin: 'https://other.example.com' }]) {
  const c = config(); const { origin, ...identity } = patch as any;
  const outlook = { database: { ...database, user: 'outlook-user', ...identity }, config: { origin: origin ?? c.origin } } as any;
  await assert.rejects(composeApi({ ...c, outlook }), /INVALID_OUTLOOK_IDENTITY_SEPARATION/);
 }
});
