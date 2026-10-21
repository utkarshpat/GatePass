import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GuardAuthService } from '../security/GuardAuthService.ts';

export type Session = { sessionToken: string; csrfToken: string };
export type ApiAction = (session: Session, body: unknown) => Promise<unknown>;
export interface AdditionalHttpRoutes { handles(path: string): boolean; handle(req: IncomingMessage, res: ServerResponse): Promise<unknown> }
type Options = { origin: string; sourceKey: Buffer; auth: Pick<GuardAuthService, 'signIn' | 'completeSetup' | 'sessionAction'>; actions: ReadonlyMap<string, ApiAction>; registration?: AdditionalHttpRoutes };
export const token = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(v) && Buffer.from(v, 'base64url').toString('base64url') === v;
export class HttpFailure extends Error { status: number; constructor(status: number) { super('REQUEST_REJECTED'); this.status = status; } }
const cookie = (name: string, value: string, clear = false) => `${name}=${value}; Path=/; Secure; SameSite=Strict${name === '__Host-gp-session' ? '; HttpOnly' : ''}${clear ? '; Max-Age=0' : ''}`;
export function cookies(raw: string | undefined) {
  const result: Record<string, string> = Object.create(null);
  for (const entry of (raw ?? '').split(';')) {
    const index = entry.indexOf('='); if (index < 0) continue;
    const name = entry.slice(0, index).trim();
    if (Object.hasOwn(result, name)) throw new HttpFailure(400);
    result[name] = entry.slice(index + 1).trim();
  }
  return result;
}
export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(req.headers['content-type'] ?? '') || req.headers['content-encoding']) throw new HttpFailure(415);
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 65536) throw new HttpFailure(413); chunks.push(chunk); }
  let data: unknown;
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { throw new HttpFailure(400); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpFailure(400);
  return data as Record<string, unknown>;
}
export function createApiHandler(options: Options) {
  if (new URL(options.origin).origin !== options.origin || !options.origin.startsWith('https://') || options.sourceKey.length < 32) throw new Error('INVALID_HTTP_CONFIGURATION');
  const origin = options.origin; const key = Buffer.from(options.sourceKey); const actions = new Map(options.actions);
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Pragma', 'no-cache'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'"); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000'); res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const send = (status: number, value: unknown) => { res.statusCode = status; res.end(JSON.stringify(value)); };
    try {
      // Direct TLS only. Forwarded headers never create trust or rate-limit buckets.
      if (!(req.socket as typeof req.socket & { encrypted?: boolean }).encrypted) throw new HttpFailure(400);
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); throw new HttpFailure(405); }
      if (req.headers.origin !== origin || req.headers.host !== new URL(origin).host || ['cross-site', 'same-site'].includes(String(req.headers['sec-fetch-site']))) throw new HttpFailure(403);
      const path = req.url ?? ''; if (path.includes('?') || (!actions.has(path) && !options.registration?.handles(path) && !['/api/auth/login', '/api/auth/setup', '/api/auth/touch', '/api/auth/logout'].includes(path))) throw new HttpFailure(404);
      if (options.registration?.handles(path)) return send(200, await options.registration.handle(req, res));
      const data = await readJsonBody(req);
      const context = { sourceHash: createHmac('sha256', key).update(req.socket.remoteAddress ?? 'unknown').digest() };
      if (path === '/api/auth/login') {
        if (Object.keys(data).some(k => !['login', 'password', 'newPassword'].includes(k))) throw new HttpFailure(400);
        const result = await options.auth.signIn(data.login, data.password, context, data.newPassword as string | undefined);
        if (!result.ok) return send(401, { error: 'SIGN_IN_FAILED' });
        res.setHeader('Set-Cookie', [cookie('__Host-gp-session', result.sessionToken), cookie('__Host-gp-csrf', result.csrfToken)]);
        return send(200, { ok: true, csrfToken: result.csrfToken, idleExpiresAtUtc: result.idleExpiresAtUtc, absoluteExpiresAtUtc: result.absoluteExpiresAtUtc });
      }
      if (path === '/api/auth/setup') {
        if (Object.keys(data).some(k => !['token', 'password'].includes(k))) throw new HttpFailure(400);
        const result = await options.auth.completeSetup(data.token, data.password, context);
        return send(result.ok ? 200 : 400, { ok: result.ok });
      }
      const jar = cookies(req.headers.cookie); const sessionToken = jar['__Host-gp-session']; const csrfToken = req.headers['x-csrf-token'];
      if (!token(sessionToken)) throw new HttpFailure(401);
      if (!token(csrfToken) || !token(jar['__Host-gp-csrf']) || !timingSafeEqual(Buffer.from(csrfToken), Buffer.from(jar['__Host-gp-csrf']))) throw new HttpFailure(403);
      if (path === '/api/auth/logout' || path === '/api/auth/touch') {
        if (Object.keys(data).length) throw new HttpFailure(400);
        const logout = path.endsWith('/logout'); const result = await options.auth.sessionAction(logout ? 'logout' : 'touch', sessionToken, csrfToken);
        if (logout) res.setHeader('Set-Cookie', [cookie('__Host-gp-session', '', true), cookie('__Host-gp-csrf', '', true)]);
        return send(result.ok ? 200 : 401, result);
      }
      return send(200, await actions.get(path)!({ sessionToken, csrfToken }, data));
    } catch (error) {
      req.resume();
      const code = (error as { code?: string })?.code;
      const status = error instanceof HttpFailure ? error.status : code === 'INVALID_INPUT' ? 400 : code === 'NOT_AUTHORIZED' ? 403 : code === 'CONFLICT' ? 409 : 503;
      send(status, { error: ({ 400: 'INVALID_INPUT', 401: 'NOT_AUTHENTICATED', 403: 'NOT_AUTHORIZED', 404: 'NOT_FOUND', 405: 'METHOD_NOT_ALLOWED', 409: 'CONFLICT', 413: 'BODY_TOO_LARGE', 415: 'UNSUPPORTED_MEDIA_TYPE', 429: 'RATE_LIMITED' } as Record<number, string>)[status] ?? 'UNAVAILABLE' });
    }
  };
}
