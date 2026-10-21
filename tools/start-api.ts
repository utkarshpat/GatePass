import { createServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { composeApi } from '../src/transport/Composition.ts';

const required = (key: string) => { const value = process.env[key]; if (!value) throw new Error('MISSING_' + key); return value; };
// Explicit TLS files and separate restricted SQL logins. No dev-login or elevated fallback.
try {
  if (process.env.GATEPASS_SSO_MODE === 'dummy' || process.env.NODE_ENV === 'production' && process.env.GATEPASS_DB_NAME === 'GatePass_DesignTest') throw new Error('DEVELOPMENT_AUTH_NOT_ALLOWED');
  const common = { server: required('GATEPASS_DB_SERVER'), port: Number(required('GATEPASS_DB_PORT')), database: required('GATEPASS_DB_NAME') };
  const sourceKey = Buffer.from(required('GATEPASS_SOURCE_KEY'), 'base64url');
  const origin = required('GATEPASS_ORIGIN'); const url = new URL(origin);
  const [key, cert] = await Promise.all([readFile(required('GATEPASS_TLS_KEY_FILE')), readFile(required('GATEPASS_TLS_CERT_FILE'))]);
  const server = createServer({ key, cert, minVersion: 'TLSv1.2', maxHeaderSize: 16384 });
  const app = await composeApi({ origin, sourceKey,
    api: { ...common, user: required('GATEPASS_API_DB_USER'), password: required('GATEPASS_API_DB_PASSWORD') },
    auth: { ...common, user: required('GATEPASS_AUTH_DB_USER'), password: required('GATEPASS_AUTH_DB_PASSWORD') } });
  server.on('request', app.handler);
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000; server.maxRequestsPerSocket = 100; server.maxConnections = 64;
  server.on('error', async () => { console.error('API_LISTENER_UNAVAILABLE'); await app.close(); process.exitCode = 1; });
  server.listen(Number(url.port || 443), process.env.GATEPASS_BIND_ADDRESS ?? '127.0.0.1', () => console.log('GatePass HTTPS API ready.'));
  const stop = () => { server.close(async () => { await app.close(); process.exitCode = 0; }); server.closeIdleConnections(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
} catch { console.error('API_STARTUP_FAILED: verify TLS, origin, source key and separate restricted SQL identities.'); process.exitCode = 1; }
