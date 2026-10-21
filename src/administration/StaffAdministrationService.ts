import { createHash } from 'node:crypto';
import { isUuid, isUtc } from '../visits/SqlVisitReadRepository.ts';
import type { ReadParameter, ReadSqlClient } from '../visits/SqlVisitReadRepository.ts';
export class StaffAdministrationError extends Error {
  code: 'INVALID_INPUT' | 'NOT_AUTHORIZED' | 'CONFLICT' | 'UNAVAILABLE';
  constructor(code: StaffAdministrationError['code']) { super(code); this.code = code; }
}
export interface StaffAdministrationRepository { execute(name: string, parameters: Record<string, ReadParameter>): Promise<Record<string, unknown>> }
const identity = { SessionHash: 'binary', CsrfHash: 'binary', ClientKey: 'guid', Reason: 'text' };
const contracts: Record<string, Record<string, string>> = {
  'gp.AllocateGuard': { ...identity, GuardUserId: 'guid', ProjectLocationId: 'bigint', ValidFromUtc: 'datetime', ValidUntilUtc: 'datetime' },
  'gp.DeallocateGuard': { ...identity, GuardAssignmentId: 'bigint' },
  'gp.GrantStaffRole': { ...identity, TargetUserId: 'guid', RoleCode: 'text', ScopeType: 'text', LocationId: 'int', ProjectId: 'bigint', ProjectLocationId: 'bigint', ValidFromUtc: 'datetime', ValidUntilUtc: 'datetime', CapabilitiesJson: 'text' },
  'gp.RevokeStaffRole': { ...identity, RoleGrantId: 'bigint' },
};
const nullable = new Set(['ValidFromUtc', 'ValidUntilUtc', 'LocationId', 'ProjectId', 'ProjectLocationId']);
const big = (v: unknown): v is string => typeof v === 'string' && /^[1-9][0-9]{0,18}$/u.test(v) && BigInt(v) <= 9223372036854775807n;
const reasonValid = (v: unknown): v is string => typeof v === 'string' && v.isWellFormed() && v.length <= 300 && v.trim().length > 0 && !/[\u0000-\u001f\u007f-\u009f]/u.test(v);
const roles = ['GUARD', 'RECEPTION', 'PROJECT_ADMIN', 'LOCATION_ADMIN', 'INDIA_ADMIN', 'PLATFORM_ADMIN'];
const scopes = ['LOCATION', 'PROJECT', 'PROJECT_LOCATION', 'INDIA', 'PLATFORM'];
export class SqlStaffAdministrationRepository implements StaffAdministrationRepository {
  #client: ReadSqlClient;
  constructor(client: ReadSqlClient) { this.#client = client; }
  async execute(name: string, parameters: Record<string, ReadParameter>) {
    const contract = Object.hasOwn(contracts, name) ? contracts[name] : undefined;
    if (!contract || Object.keys(contract).sort().join('|') !== Object.keys(parameters).sort().join('|')) throw new Error('INVALID_ADMIN_SQL_CONTRACT');
    for (const [key, type] of Object.entries(contract)) {
      const p = parameters[key]; if (!p || p.type !== type || p.value === null && (!nullable.has(key) || name === 'gp.AllocateGuard' && key === 'ProjectLocationId')) throw new Error('INVALID_ADMIN_SQL_PARAMETER');
      const v = p.value; if (v === null) continue;
      if (type === 'binary' && (!Buffer.isBuffer(v) || v.length !== 32) || type === 'guid' && !isUuid(v) || type === 'bigint' && !big(v)
        || type === 'datetime' && !isUtc(v) || type === 'int' && (!Number.isInteger(v) || Number(v) < 1 || Number(v) > 2147483647)
        || type === 'text' && (typeof v !== 'string' || (key === 'Reason' ? !reasonValid(v) : v.length > (key === 'CapabilitiesJson' ? 1000 : 24)))) throw new Error('INVALID_ADMIN_SQL_PARAMETER');
    }
    const result: unknown = JSON.parse(await this.#client.callProcedure(name, parameters));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('INVALID_ADMIN_SQL_RESPONSE');
    return result as Record<string, unknown>;
  }
}
const input = (ok: unknown) => { if (!ok) throw new StaffAdministrationError('INVALID_INPUT'); };
function token(v: unknown) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(v)) throw new StaffAdministrationError('NOT_AUTHORIZED');
  const bytes = Buffer.from(v, 'base64url');
  try { if (bytes.toString('base64url') !== v || bytes.length !== 32) throw new StaffAdministrationError('NOT_AUTHORIZED'); return createHash('sha256').update(bytes).digest(); }
  finally { bytes.fill(0); }
}
type Session = { sessionToken: string; csrfToken: string };
const parameter = (type: ReadParameter['type'], value: ReadParameter['value']): ReadParameter => ({ type, value });
const uuid = (v: unknown) => { input(isUuid(v)); return (v as string).toLowerCase(); };
const id = (v: unknown) => { input(big(v)); return v as string; };
const time = (v: unknown) => { input(v === undefined || v === null || isUtc(v)); return v as string ?? null; };
const outId = (v: unknown) => { const value = typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? String(v) : v; if (!big(value)) throw new StaffAdministrationError('UNAVAILABLE'); return value; };
/** Internal API boundary. All actor/scope/eligibility decisions remain in SQL. */
export class StaffAdministrationService {
  #repository: StaffAdministrationRepository;
  constructor(repository: StaffAdministrationRepository) { this.#repository = repository; }
  #body(value: unknown, keys: string[]) {
    input(!!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
    const data = value as Record<string, unknown>; input(Object.keys(data).every(key => ['clientKey', 'reason', ...keys].includes(key)) && isUuid(data.clientKey) && reasonValid(data.reason)); return data;
  }
  async #call(session: Session, name: string, data: Record<string, unknown>, parameters: Record<string, ReadParameter>) {
    try {
      const r = await this.#repository.execute(name, { SessionHash: parameter('binary', token(session?.sessionToken)), CsrfHash: parameter('binary', token(session?.csrfToken)),
        ClientKey: parameter('guid', uuid(data.clientKey)), Reason: parameter('text', (data.reason as string).trim()), ...parameters });
      if (!r || !isUuid(r.operationId)) throw new StaffAdministrationError('UNAVAILABLE'); return { ...r, operationId: r.operationId.toLowerCase() };
    } catch (error) {
      if (error instanceof StaffAdministrationError) throw error;
      const number = Number((error as { number?: number })?.number); throw new StaffAdministrationError(number === 52001 ? 'NOT_AUTHORIZED' : number === 52002 ? 'INVALID_INPUT' : [52003, 52004, 52005].includes(number) ? 'CONFLICT' : 'UNAVAILABLE');
    }
  }
  async allocate(session: Session, value: unknown) {
    const d = this.#body(value, ['guardUserId', 'projectLocationId', 'validFromUtc', 'validUntilUtc']); const guard = uuid(d.guardUserId); const pair = id(d.projectLocationId);
    const start = time(d.validFromUtc); const end = time(d.validUntilUtc); input(!start || !end || start < end);
    const r = await this.#call(session, 'gp.AllocateGuard', d, { GuardUserId: parameter('guid', guard), ProjectLocationId: parameter('bigint', pair), ValidFromUtc: parameter('datetime', start), ValidUntilUtc: parameter('datetime', end) });
    if (!isUuid(r.guardUserId) || r.guardUserId.toLowerCase() !== guard || r.projectLocationId !== pair || r.status !== 'ALLOCATED') throw new StaffAdministrationError('UNAVAILABLE');
    return { operationId: r.operationId, assignmentId: outId(r.assignmentId), guardUserId: guard, projectLocationId: pair, status: 'ALLOCATED' as const };
  }
  async deallocate(session: Session, value: unknown) {
    const d = this.#body(value, ['assignmentId']); const assignment = id(d.assignmentId); const r = await this.#call(session, 'gp.DeallocateGuard', d, { GuardAssignmentId: parameter('bigint', assignment) });
    if (outId(r.assignmentId) !== assignment || r.deallocated !== true) throw new StaffAdministrationError('UNAVAILABLE');
    return { operationId: r.operationId, assignmentId: assignment, deallocated: true as const };
  }
  async grant(session: Session, value: unknown) {
    const d = this.#body(value, ['targetUserId', 'roleCode', 'scopeType', 'locationId', 'projectId', 'projectLocationId', 'validFromUtc', 'validUntilUtc', 'capabilities']); const target = uuid(d.targetUserId);
    input(typeof d.roleCode === 'string' && typeof d.scopeType === 'string' && roles.includes(d.roleCode) && scopes.includes(d.scopeType) && Array.isArray(d.capabilities) && d.capabilities.length >= 1 && d.capabilities.length <= 8);
    const caps = d.capabilities as unknown[]; input(caps.every(c => typeof c === 'string' && /^[A-Z_]{1,40}$/u.test(c)) && new Set(caps).size === caps.length);
    const location = d.locationId ?? null; const project = d.projectId ?? null; const pair = d.projectLocationId ?? null;
    input(location === null || Number.isInteger(location) && Number(location) > 0 && Number(location) <= 2147483647); input(project === null || big(project)); input(pair === null || big(pair));
    input(['INDIA_ADMIN','PLATFORM_ADMIN'].includes(String(d.roleCode)) ? d.scopeType === (d.roleCode==='PLATFORM_ADMIN'?'PLATFORM':'INDIA') && location === null && project === null && pair === null
      : d.roleCode === 'PROJECT_ADMIN' ? location === null && (d.scopeType === 'PROJECT' && project !== null && pair === null || d.scopeType === 'PROJECT_LOCATION' && pair !== null && project === null)
        : d.scopeType === 'LOCATION' && location !== null && project === null && pair === null);
    const start = time(d.validFromUtc); const end = time(d.validUntilUtc); input(!start || !end || start < end);
    const r = await this.#call(session, 'gp.GrantStaffRole', d, { TargetUserId: parameter('guid', target), RoleCode: parameter('text', d.roleCode as string), ScopeType: parameter('text', d.scopeType as string),
      LocationId: parameter('int', location as number | null), ProjectId: parameter('bigint', project as string | null), ProjectLocationId: parameter('bigint', pair as string | null), ValidFromUtc: parameter('datetime', start), ValidUntilUtc: parameter('datetime', end), CapabilitiesJson: parameter('text', JSON.stringify([...caps].sort())) });
    if (!isUuid(r.targetUserId) || r.targetUserId.toLowerCase() !== target || r.roleCode !== d.roleCode || r.scopeType !== d.scopeType || r.status !== 'GRANTED') throw new StaffAdministrationError('UNAVAILABLE');
    return { operationId: r.operationId, roleGrantId: outId(r.roleGrantId), targetUserId: target, roleCode: r.roleCode as string, scopeType: r.scopeType as string, status: 'GRANTED' as const };
  }
  async revoke(session: Session, value: unknown) {
    const d = this.#body(value, ['roleGrantId']); const grant = id(d.roleGrantId); const r = await this.#call(session, 'gp.RevokeStaffRole', d, { RoleGrantId: parameter('bigint', grant) });
    if (outId(r.roleGrantId) !== grant || !isUuid(r.targetUserId) || r.revoked !== true) throw new StaffAdministrationError('UNAVAILABLE');
    return { operationId: r.operationId, roleGrantId: grant, targetUserId: r.targetUserId.toLowerCase(), revoked: true as const };
  }
}
