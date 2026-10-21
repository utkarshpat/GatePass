import { createHash, randomBytes } from 'node:crypto';
import { GuardPasswordHasher, validateNewGuardPassword } from './GuardPasswordHasher.ts';

export type AuthStatus = { status: 'READY' | 'OK' | 'DENIED' | 'THROTTLED'; encodedPasswordHash?: string;
  idleExpiresAtUtc?: string; absoluteExpiresAtUtc?: string };
export type ProcedureParameter = { type: 'binary' | 'text' | 'bit'; value: Buffer | string | boolean | null };
export interface GuardAuthRepository {
  execute(procedure: string, parameters: Record<string, ProcedureParameter>): Promise<AuthStatus>;
}
// Repository implementations must use typed parameters and the separate auth SQL role.
// This is an internal service, not a route: sourceHash must be derived from a trusted
// transport/proxy identity (keyed IP/device bucket), never accepted from request JSON.
export type GuardAuthContext = { sourceHash: Buffer };
export type GuardSignInResult = { ok: false; message: 'Unable to sign in.' } | {
  ok: true; sessionToken: string; csrfToken: string; idleExpiresAtUtc: string; absoluteExpiresAtUtc: string;
};
const failure = (): GuardSignInResult => ({ ok: false, message: 'Unable to sign in.' });
const digest = (value: Buffer): Buffer => createHash('sha256').update(value).digest();
const binary = (value: Buffer | null): ProcedureParameter => ({ type: 'binary', value });
const text = (value: string | null): ProcedureParameter => ({ type: 'text', value });
const bit = (value: boolean): ProcedureParameter => ({ type: 'bit', value });
export const normalizeGuardLogin = (input: unknown): string | null => {
  if (typeof input !== 'string' || input.length > 64) return null;
  const normalized = input.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{2,63}$/u.test(normalized) || /^[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/u.test(normalized) ? normalized : null;
};
const tokenBytes = (input: unknown): Buffer | null => {
  if (typeof input !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(input)) return null;
  const value = Buffer.from(input, 'base64url');
  return value.length === 32 && value.toString('base64url') === input ? value : null;
};

export class GuardAuthService {
  #repository: GuardAuthRepository;
  #hasher: GuardPasswordHasher;
  #dummyHash: string;
  #active = 0;
  #domain: 'Guard' | 'Staff';
  private constructor(repository: GuardAuthRepository, hasher: GuardPasswordHasher, dummyHash: string, domain: 'Guard' | 'Staff') {
    this.#repository = repository; this.#hasher = hasher; this.#dummyHash = dummyHash; this.#domain=domain;
  }
  static async create(repository: GuardAuthRepository, domain: 'Guard' | 'Staff'='Guard'): Promise<GuardAuthService> {
    if(!['Guard','Staff'].includes(domain))throw new Error('INVALID_AUTH_DOMAIN');
    const hasher = new GuardPasswordHasher(2);
    const dummyHash = await hasher.hash(randomBytes(32).toString('base64url'));
    return new GuardAuthService(repository, hasher, dummyHash, domain);
  }
  #context(context: GuardAuthContext): Buffer {
    if (!Buffer.isBuffer(context?.sourceHash) || context.sourceHash.length !== 32) throw new Error('INVALID_AUTH_CONTEXT');
    return context.sourceHash;
  }
  async signIn(login: unknown, password: unknown, context: GuardAuthContext, newPassword?: string): Promise<GuardSignInResult> {
    const normalized = normalizeGuardLogin(login);
    if (!normalized || typeof password !== 'string' || password.length > 512 || this.#active >= 2) return failure();
    this.#active++;
    try {
      const source = this.#context(context);
      if (newPassword !== undefined) validateNewGuardPassword(newPassword);
      const attempt = randomBytes(32);
      const challenge = await this.#repository.execute(`gp.Begin${this.#domain}Login`, {
        LoginId: text(normalized), AttemptHash: binary(digest(attempt)), SourceHash: binary(source) });
      if (challenge.status === 'THROTTLED') return failure();
      const verified = await this.#hasher.verify(password, challenge.encodedPasswordHash ?? this.#dummyHash);
      if (challenge.status !== 'READY' || !challenge.encodedPasswordHash) return failure();
      const session = randomBytes(32); const csrf = randomBytes(32);
      const updatedHash = verified && newPassword !== undefined ? await this.#hasher.hash(newPassword) : null;
      const result = await this.#repository.execute(`gp.Complete${this.#domain}Login`, {
        AttemptHash: binary(digest(attempt)), SourceHash: binary(source), PasswordVerified: bit(verified),
        SessionHash: binary(digest(session)), CsrfHash: binary(digest(csrf)), NewEncodedPasswordHash: text(updatedHash) });
      if (result.status !== 'OK' || !result.idleExpiresAtUtc || !result.absoluteExpiresAtUtc) return failure();
      // Only a trusted HTTP adapter may consume this result. Put sessionToken in a
      // Secure/HttpOnly/SameSite cookie, never JSON/localStorage or logs. CSRF is separate.
      return { ok: true, sessionToken: session.toString('base64url'), csrfToken: csrf.toString('base64url'),
        idleExpiresAtUtc: result.idleExpiresAtUtc, absoluteExpiresAtUtc: result.absoluteExpiresAtUtc };
    } catch { return failure(); }
    finally { this.#active--; }
  }
  async completeSetup(token: unknown, password: unknown, context: GuardAuthContext): Promise<{ ok: boolean }> {
    const value = tokenBytes(token);
    if (!value || this.#active >= 2) return { ok: false };
    this.#active++;
    try {
      validateNewGuardPassword(password);
      const parameters = { TokenHash: binary(digest(value)), SourceHash: binary(this.#context(context)) };
      const ticket = await this.#repository.execute(`gp.Inspect${this.#domain}Setup`, parameters);
      if (ticket.status !== 'READY') return { ok: false };
      const result = await this.#repository.execute(`gp.Complete${this.#domain}Setup`, {
        ...parameters, NewEncodedPasswordHash: text(await this.#hasher.hash(password)) });
      return { ok: result.status === 'OK' };
    } catch { return { ok: false }; }
    finally { this.#active--; }
  }
  async sessionAction(action: 'touch' | 'logout', sessionToken: unknown, csrfToken: unknown): Promise<{ ok: boolean }> {
    const session = tokenBytes(sessionToken); const csrf = tokenBytes(csrfToken);
    if (!session || !csrf) return { ok: false };
    try {
      const result = await this.#repository.execute(action === 'touch' ? `gp.Touch${this.#domain}Session` : `gp.Revoke${this.#domain}Session`, {
        SessionHash: binary(digest(session)), CsrfHash: binary(digest(csrf)) });
      return { ok: result.status === 'OK' };
    } catch { return { ok: false }; }
  }
}
