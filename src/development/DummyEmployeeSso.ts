import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { EmployeeSsoGate } from '../transport/RegistrationHttpRoutes.ts';
import type { Session } from '../transport/ApiHandler.ts';
import { token } from '../transport/ApiHandler.ts';
import { resolvePowerShell } from './PowerShellRuntime.mjs';

export function requireDummySso() {
  if (!['development', 'test'].includes(process.env.NODE_ENV ?? '') || process.env.GATEPASS_SSO_MODE !== 'dummy' || process.env.GATEPASS_DIRECTORY_MODE !== 'mock') throw new Error('DUMMY_SSO_DISABLED');
}
export type DummyEmployee = { employeeId: string; displayName: string; officialEmail: string; primaryOffice?: string | null; managerEmployeeId: string | null;
  manager: { employeeId: string; displayName: string; officialEmail: string; active: boolean } | null;
  projects: { projectCode: string; projectName: string }[] };
export interface DevelopmentSsoRepository {
  execute(action: 'list' | 'create' | 'inspect' | 'touch' | 'logout' | 'refresh', employeeId: string | null, sessionHash: Buffer | null, csrfHash: Buffer | null): Promise<Record<string, unknown>>;
}
const hash = (value: string) => createHash('sha256').update(Buffer.from(value, 'base64url')).digest();
const employeeId = (v: unknown): v is string => typeof v === 'string' && /^EMP[0-9]{3}$/u.test(v);
const text = (v: unknown, length: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= length && !/[\u0000-\u001f\u007f]/u.test(v);
const email = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._+-]+@example\.com$/u.test(v);
function profile(v: unknown): DummyEmployee {
  if (!v || typeof v !== 'object') throw new Error('INVALID_DEVELOPMENT_PROFILE');
  const p = v as DummyEmployee;
  if (!employeeId(p.employeeId) || !text(p.displayName, 200) || !email(p.officialEmail) || p.managerEmployeeId !== null && !employeeId(p.managerEmployeeId)
    || (p.primaryOffice !== undefined && p.primaryOffice !== null && !text(p.primaryOffice, 100))
    || p.manager !== null && (!p.manager || p.manager.employeeId !== p.managerEmployeeId || !text(p.manager.displayName, 200) || !email(p.manager.officialEmail) || typeof p.manager.active !== 'boolean')
    || !Array.isArray(p.projects) || p.projects.length > 50 || p.projects.some(x => !x || !/^DEMO-PRJ-[0-9]{3}$/u.test(x.projectCode) || !text(x.projectName, 200))) throw new Error('INVALID_DEVELOPMENT_PROFILE');
  return { employeeId: p.employeeId, displayName: p.displayName, officialEmail: p.officialEmail, primaryOffice: p.primaryOffice ?? null, managerEmployeeId: p.managerEmployeeId,
    manager: p.manager ? { employeeId: p.manager.employeeId, displayName: p.manager.displayName, officialEmail: p.manager.officialEmail, active: p.manager.active } : null,
    projects: p.projects.map(x => ({ projectCode: x.projectCode, projectName: x.projectName })) };
}

/** Local Windows integrated helper for development only. Production uses its separate typed TDS adapter. */
export class LocalDevelopmentSsoRepository implements DevelopmentSsoRepository {
  #active = 0;
  constructor() { requireDummySso(); }
  async execute(action: Parameters<DevelopmentSsoRepository['execute']>[0], employeeId: string | null, sessionHash: Buffer | null, csrfHash: Buffer | null): Promise<Record<string, unknown>> {
    requireDummySso(); if (this.#active >= 4) throw new Error('DEVELOPMENT_SQL_BUSY'); this.#active++;
    try {
      return await new Promise((resolve, reject) => {
        const child = spawn(resolvePowerShell(), ['-NoProfile', '-File', fileURLToPath(new URL('../../tools/GatePass.DevelopmentSqlBridge.ps1', import.meta.url))], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        let output = ''; let size = 0;
        const timer = setTimeout(() => { child.kill(); reject(new Error('DEVELOPMENT_SQL_UNAVAILABLE')); }, 20000);
        child.stdout.on('data', bytes => { size += bytes.length; if (size > 1048576) { child.kill(); reject(new Error('DEVELOPMENT_SQL_UNAVAILABLE')); } else output += bytes; });
        child.stderr.resume(); child.on('error', () => { clearTimeout(timer); reject(new Error('DEVELOPMENT_SQL_UNAVAILABLE')); });
        child.on('close', code => { clearTimeout(timer); try { if (code !== 0) throw new Error(); const value = JSON.parse(output); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); resolve(value); } catch { reject(new Error('DEVELOPMENT_SQL_UNAVAILABLE')); } });
        child.stdin.on('error', () => {});
        child.stdin.end(JSON.stringify({ action, employeeId, SessionHash: sessionHash?.toString('base64') ?? null, CsrfHash: csrfHash?.toString('base64') ?? null }));
      });
    } finally { this.#active--; }
  }
}

/** Dummy authentication of existing synthetic employees. This does not implement an OIDC provider. */
export class DummyEmployeeSso implements EmployeeSsoGate {
  #repository: DevelopmentSsoRepository;
  #issued = new Map<string, { csrf: string; expires: number }>();
  constructor(repository: DevelopmentSsoRepository) { requireDummySso(); this.#repository = repository; }
  #binding(session: Session) {
    requireDummySso();
    for (const [key, entry] of this.#issued) if (entry.expires <= Date.now()) this.#issued.delete(key);
    if (!token(session?.sessionToken) || !token(session?.csrfToken)) return null;
    const sessionHash = hash(session.sessionToken); const csrfHash = hash(session.csrfToken);
    const issued = this.#issued.get(sessionHash.toString('hex'));
    return issued?.csrf === csrfHash.toString('hex') ? { sessionHash, csrfHash } : null;
  }
  async list() {
    requireDummySso(); const result = await this.#repository.execute('list', null, null, null);
    if (result.ok !== true || !Array.isArray(result.employees) || result.employees.length > 100) throw new Error('DEVELOPMENT_DIRECTORY_UNAVAILABLE');
    return result.employees.map(profile);
  }
  async signIn(id: unknown) {
    requireDummySso(); if (!employeeId(id)) throw new Error('INVALID_DEVELOPMENT_EMPLOYEE');
    this.#binding({ sessionToken: '', csrfToken: '' }); if (this.#issued.size >= 256) throw new Error('DEVELOPMENT_SESSION_LIMIT');
    const sessionToken = randomBytes(32).toString('base64url'); const csrfToken = randomBytes(32).toString('base64url');
    const result = await this.#repository.execute('create', id, hash(sessionToken), hash(csrfToken));
    if (result.ok !== true || typeof result.idleExpiresAtUtc !== 'string' || typeof result.absoluteExpiresAtUtc !== 'string'
      || !Number.isFinite(Date.parse(result.idleExpiresAtUtc)) || !Number.isFinite(Date.parse(result.absoluteExpiresAtUtc))
      || Date.parse(result.idleExpiresAtUtc) <= Date.now() || Date.parse(result.absoluteExpiresAtUtc) < Date.parse(result.idleExpiresAtUtc)) throw new Error('DEVELOPMENT_SIGN_IN_FAILED');
    const employee = profile(result.employee); if (employee.employeeId !== id) throw new Error('DEVELOPMENT_SIGN_IN_FAILED');
    this.#issued.set(hash(sessionToken).toString('hex'), { csrf: hash(csrfToken).toString('hex'), expires: Date.parse(result.absoluteExpiresAtUtc) });
    return { sessionToken, csrfToken, employee, idleExpiresAtUtc: result.idleExpiresAtUtc, absoluteExpiresAtUtc: result.absoluteExpiresAtUtc };
  }
  async current(session: Session) {
    const binding = this.#binding(session); if (!binding) return null;
    const result = await this.#repository.execute('inspect', null, binding.sessionHash, binding.csrfHash);
    if (result.ok !== true) { this.#issued.delete(binding.sessionHash.toString('hex')); return null; }
    return profile(result.employee);
  }
  async verify(session: Session) { return !!await this.current(session); }
  async sessionAction(action: 'touch' | 'logout', session: Session) {
    const binding = this.#binding(session); if (!binding) return { ok: false };
    const result = await this.#repository.execute(action, null, binding.sessionHash, binding.csrfHash);
    if (action === 'logout' || result.ok !== true) this.#issued.delete(binding.sessionHash.toString('hex'));
    return { ok: result.ok === true };
  }
  async close() {
    // Best-effort revoke of this process's own issued sessions only; no global employee logout.
    const entries = [...this.#issued]; this.#issued.clear();
    for (let index = 0; index < entries.length; index += 4) await Promise.allSettled(entries.slice(index, index + 4).map(([session, entry]) => this.#repository.execute('logout', null, Buffer.from(session, 'hex'), Buffer.from(entry.csrf, 'hex'))));
  }
}
