import { createHash } from 'node:crypto';
import { isUuid, isUtc, isDate } from '../visits/SqlVisitReadRepository.ts';
import type { ReadParameter, ReadSqlClient } from '../visits/SqlVisitReadRepository.ts';
export class AdministrationReadError extends Error {
  code: 'INVALID_INPUT' | 'NOT_AUTHORIZED' | 'CONFLICT' | 'UNAVAILABLE';
  constructor(code: AdministrationReadError['code']) { super(code); this.code = code; }
}
export interface AdministrationReadRepository { execute(name: string, parameters: Record<string, ReadParameter>): Promise<Record<string, unknown>> }
const identity = { SessionHash: 'binary', CsrfHash: 'binary' };
const contracts: Record<string, Record<string, string>> = {
  'gp.ListAdminProjectLocations': { ...identity, LocationId: 'int', PageSize: 'int', AfterProjectLocationId: 'bigint' },
  'gp.ListAdminGuards': { ...identity, ProjectLocationId: 'bigint', ValidFromUtc: 'datetime', ValidUntilUtc: 'datetime', NamePrefix: 'text', PageSize: 'int', AfterUserId: 'guid' },
  'gp.SearchStaffSubjects': { ...identity, NamePrefix: 'text', PageSize: 'int', AfterUserId: 'guid' },
  'gp.ListStaffRoles': { ...identity, TargetUserId: 'guid', State: 'text', PageSize: 'int', AfterRoleGrantId: 'bigint' },
  'gp.GetOperationalSummary': { ...identity, LocationId: 'int', LocalVisitDate: 'date', ProjectLocationId: 'bigint' },
  'gp.ListScopedAuditEvents': { ...identity, FromUtc: 'datetime', UntilUtc: 'datetime', LocationId: 'int', ProjectLocationId: 'bigint', PageSize: 'int', AfterAuditEventId: 'bigint' },
};
const big = (v: unknown): v is string => typeof v === 'string' && /^[1-9][0-9]{0,18}$/u.test(v) && BigInt(v) <= 9223372036854775807n;
const count = (v: unknown): v is string => v === '0' || big(v);
const positiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 2147483647;
const input = (ok: unknown) => { if (!ok) throw new AdministrationReadError('INVALID_INPUT'); };
const output = (ok: unknown) => { if (!ok) throw new AdministrationReadError('UNAVAILABLE'); };
const validText = (v: unknown, max: number): v is string => typeof v === 'string' && v.isWellFormed() && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f\u007f-\u009f]/u.test(v);
const textOut = (v: unknown, max: number) => { output(validText(v, max)); return v as string; };
const idOut = (v: unknown) => { output(big(v)); return v as string; };
const uuidOut = (v: unknown) => { output(isUuid(v)); return (v as string).toLowerCase(); };
const boolOut = (v: unknown) => { output(typeof v === 'boolean'); return v as boolean; };
const stampOut = (v: unknown) => { output(isUtc(v)); return v as string; };
const nullable = (name: string, key: string) => key.startsWith('After') || key === 'NamePrefix' && name === 'gp.ListAdminGuards' || ['ValidFromUtc', 'ValidUntilUtc'].includes(key)
  || key === 'ProjectLocationId' && ['gp.GetOperationalSummary', 'gp.ListScopedAuditEvents'].includes(name) || key === 'LocationId' && name === 'gp.ListScopedAuditEvents';
export class SqlAdministrationReadRepository implements AdministrationReadRepository {
  #client: ReadSqlClient;
  constructor(client: ReadSqlClient) { this.#client = client; }
  async execute(name: string, parameters: Record<string, ReadParameter>) {
    const contract = Object.hasOwn(contracts, name) ? contracts[name] : undefined;
    if (!contract || Object.keys(contract).sort().join('|') !== Object.keys(parameters).sort().join('|')) throw new Error('INVALID_ADMIN_READ_SQL_CONTRACT');
    for (const [key, type] of Object.entries(contract)) {
      const p = parameters[key]; if (!p || p.type !== type || p.value === null && !nullable(name, key)) throw new Error('INVALID_ADMIN_READ_SQL_PARAMETER');
      const v = p.value; if (v === null) continue;
      if (type === 'binary' && (!Buffer.isBuffer(v) || v.length !== 32) || type === 'guid' && !isUuid(v) || type === 'bigint' && !big(v) || type === 'int' && (!positiveInt(v) || key === 'PageSize' && v > 50)
        || type === 'datetime' && !isUtc(v) || type === 'date' && !isDate(v) || type === 'text' && !validText(v, key === 'NamePrefix' ? 80 : 24)) throw new Error('INVALID_ADMIN_READ_SQL_PARAMETER');
    }
    const value: unknown = JSON.parse(await this.#client.callProcedure(name, parameters));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_ADMIN_READ_SQL_RESPONSE'); return value as Record<string, unknown>;
  }
}
type Session = { sessionToken: string; csrfToken: string };
function token(v: unknown) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(v)) throw new AdministrationReadError('NOT_AUTHORIZED'); const raw = Buffer.from(v, 'base64url');
  try { if (raw.length !== 32 || raw.toString('base64url') !== v) throw new AdministrationReadError('NOT_AUTHORIZED'); return createHash('sha256').update(raw).digest(); } finally { raw.fill(0); }
}
const p = (type: ReadParameter['type'], value: ReadParameter['value']): ReadParameter => ({ type, value });
const uuid = (v: unknown) => { input(isUuid(v)); return (v as string).toLowerCase(); };
const id = (v: unknown) => { input(big(v)); return v as string; };
const int = (v: unknown) => { input(positiveInt(v)); return v as number; };
const utc = (v: unknown) => { input(isUtc(v)); return v as string; };
const optionalId = (v: unknown) => v === undefined || v === null ? null : id(v);
const optionalUuid = (v: unknown) => v === undefined || v === null ? null : uuid(v);
const optionalTime = (v: unknown) => v === undefined || v === null ? null : utc(v);
function prefix(v: unknown, optional = false) { if (optional && (v === undefined || v === null)) return null; input(validText(v, 80) && v.trim().length >= 2); return (v as string).trim(); }
function pageSize(d: Record<string, unknown>) { const size = d.pageSize ?? 25; input(positiveInt(size) && size <= 50); return size as number; }
/** Read-only internal API boundary; SQL independently enforces all effective scopes. */
export class AdministrationReadService {
  #repository: AdministrationReadRepository;
  constructor(repository: AdministrationReadRepository) { this.#repository = repository; }
  #body(value: unknown, keys: string[]) {
    input(!!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))); const d = value as Record<string, unknown>;
    input(Object.keys(d).every(key => keys.includes(key))); return d;
  }
  async #call(session: Session, name: string, parameters: Record<string, ReadParameter>) {
    try { const result = await this.#repository.execute(name, { SessionHash: p('binary', token(session?.sessionToken)), CsrfHash: p('binary', token(session?.csrfToken)), ...parameters }); output(!!result && typeof result === 'object' && !Array.isArray(result)); return result; }
    catch (error) { if (error instanceof AdministrationReadError) throw error; const n = Number((error as { number?: number })?.number); throw new AdministrationReadError(n === 52001 ? 'NOT_AUTHORIZED' : n === 52002 ? 'INVALID_INPUT' : [52003, 52004, 52005].includes(n) ? 'CONFLICT' : 'UNAVAILABLE'); }
  }
  #page<T>(r: Record<string, unknown>, list: string, cursor: string, size: number, convert: (row: Record<string, unknown>) => T, key: (row: T) => string, guid = false) {
    output(Array.isArray(r[list]) && r[list].length <= size && typeof r.hasMore === 'boolean');
    const rows = (r[list] as unknown[]).map(row => { output(!!row && typeof row === 'object' && !Array.isArray(row)); return convert(row as Record<string, unknown>); });
    output(new Set(rows.map(key)).size === rows.length);
    let after: string | null = null;
    if (r.hasMore) { output(rows.length === size); after = guid ? uuidOut(r[cursor]) : idOut(r[cursor]); output(after === key(rows.at(-1)!)); }
    else output(r[cursor] === undefined || r[cursor] === null);
    return { rows, hasMore: r.hasMore as boolean, after, checkedAtUtc: stampOut(r.checkedAtUtc) };
  }
  async projects(session: Session, value: unknown) {
    const d = this.#body(value, ['locationId', 'pageSize', 'afterProjectLocationId']); const location = int(d.locationId); const size = pageSize(d);
    const r = await this.#call(session, 'gp.ListAdminProjectLocations', { LocationId: p('int', location), PageSize: p('int', size), AfterProjectLocationId: p('bigint', optionalId(d.afterProjectLocationId)) });
    const result = this.#page(r, 'projects', 'afterProjectLocationId', size, row => { output(row.locationId === location); const active = boolOut(row.active); const canAllocate = boolOut(row.canAllocate); output(!canAllocate || active);
      return { projectLocationId: idOut(row.projectLocationId), projectId: idOut(row.projectId), locationId: location, locationName: textOut(row.locationName, 150), projectCode: textOut(row.projectCode, 80), projectName: textOut(row.projectName, 200), active, canAllocate }; }, row => row.projectLocationId);
    return { projects: result.rows, hasMore: result.hasMore, afterProjectLocationId: result.after, checkedAtUtc: result.checkedAtUtc };
  }
  async guards(session: Session, value: unknown) {
    const d = this.#body(value, ['projectLocationId', 'validFromUtc', 'validUntilUtc', 'namePrefix', 'pageSize', 'afterUserId']); const size = pageSize(d); const start = optionalTime(d.validFromUtc); const end = optionalTime(d.validUntilUtc); input(!start || !end || start < end);
    const r = await this.#call(session, 'gp.ListAdminGuards', { ProjectLocationId: p('bigint', id(d.projectLocationId)), ValidFromUtc: p('datetime', start), ValidUntilUtc: p('datetime', end), NamePrefix: p('text', prefix(d.namePrefix, true)), PageSize: p('int', size), AfterUserId: p('guid', optionalUuid(d.afterUserId)) });
    const result = this.#page(r, 'guards', 'afterUserId', size, row => { const overlap = boolOut(row.overlappingAssignment); const canAllocate = boolOut(row.canAllocate); output(!overlap || !canAllocate);
      return { userId: uuidOut(row.userId), displayName: textOut(row.displayName, 200), overlappingAssignment: overlap, canAllocate }; }, row => row.userId, true);
    return { guards: result.rows, hasMore: result.hasMore, afterUserId: result.after, checkedAtUtc: result.checkedAtUtc };
  }
  async subjects(session: Session, value: unknown) {
    const d = this.#body(value, ['namePrefix', 'pageSize', 'afterUserId']); const size = pageSize(d);
    const r = await this.#call(session, 'gp.SearchStaffSubjects', { NamePrefix: p('text', prefix(d.namePrefix)), PageSize: p('int', size), AfterUserId: p('guid', optionalUuid(d.afterUserId)) });
    const result = this.#page(r, 'users', 'afterUserId', size, row => ({ userId: uuidOut(row.userId), displayName: textOut(row.displayName, 200), active: boolOut(row.active),...(row.localAccount===undefined?{}:{localAccount:boolOut(row.localAccount)}) }), row => row.userId, true);
    return { users: result.rows, hasMore: result.hasMore, afterUserId: result.after, checkedAtUtc: result.checkedAtUtc };
  }
  async roles(session: Session, value: unknown) {
    const d = this.#body(value, ['targetUserId', 'state', 'pageSize', 'afterRoleGrantId']); const target = uuid(d.targetUserId); const size = pageSize(d); const state = d.state ?? 'CURRENT'; input(state === 'CURRENT' || state === 'ALL');
    const r = await this.#call(session, 'gp.ListStaffRoles', { TargetUserId: p('guid', target), State: p('text', state as string), PageSize: p('int', size), AfterRoleGrantId: p('bigint', optionalId(d.afterRoleGrantId)) });
    const result = this.#page(r, 'grants', 'afterRoleGrantId', size, row => {
      output(uuidOut(row.userId) === target && typeof row.roleCode === 'string' && ['GUARD', 'RECEPTION', 'PROJECT_ADMIN', 'LOCATION_ADMIN', 'INDIA_ADMIN', 'PLATFORM_ADMIN'].includes(row.roleCode) && typeof row.scopeType === 'string' && ['LOCATION', 'PROJECT', 'PROJECT_LOCATION', 'INDIA', 'PLATFORM'].includes(row.scopeType));
      output(row.locationId === null || positiveInt(row.locationId)); output(row.projectId === null || big(row.projectId)); output(row.projectLocationId === null || big(row.projectLocationId));
      output(['INDIA_ADMIN','PLATFORM_ADMIN'].includes(String(row.roleCode)) ? row.scopeType === (row.roleCode==='PLATFORM_ADMIN'?'PLATFORM':'INDIA') && row.locationId === null && row.projectId === null && row.projectLocationId === null : row.roleCode === 'PROJECT_ADMIN' ? row.locationId === null && (row.scopeType === 'PROJECT' && row.projectId !== null && row.projectLocationId === null || row.scopeType === 'PROJECT_LOCATION' && row.projectLocationId !== null && row.projectId === null) : row.scopeType === 'LOCATION' && row.locationId !== null && row.projectId === null && row.projectLocationId === null);
      const start = stampOut(row.validFromUtc); const end = row.validUntilUtc === null ? null : stampOut(row.validUntilUtc); output(!end || start < end); const revoked = boolOut(row.revoked);
      if (state === 'CURRENT') output(!revoked && start <= stampOut(r.checkedAtUtc) && (!end || r.checkedAtUtc as string < end));
      output(Array.isArray(row.capabilities) && row.capabilities.length <= 12 && row.capabilities.every(c => typeof c === 'string' && /^[A-Z_]{1,40}$/u.test(c)) && new Set(row.capabilities).size === row.capabilities.length);
      return { roleGrantId: idOut(row.roleGrantId), userId: target, roleCode: row.roleCode as string, scopeType: row.scopeType as string, locationId: row.locationId as number | null, projectId: row.projectId as string | null, projectLocationId: row.projectLocationId as string | null, validFromUtc: start, validUntilUtc: end, revoked, capabilities: [...row.capabilities as string[]] };
    }, row => row.roleGrantId);
    return { grants: result.rows, hasMore: result.hasMore, afterRoleGrantId: result.after, checkedAtUtc: result.checkedAtUtc };
  }
  async summary(session: Session, value: unknown) {
    const d = this.#body(value, ['locationId', 'localVisitDate', 'projectLocationId']); input(isDate(d.localVisitDate));
    const r = await this.#call(session, 'gp.GetOperationalSummary', { LocationId: p('int', int(d.locationId)), LocalVisitDate: p('date', d.localVisitDate as string), ProjectLocationId: p('bigint', optionalId(d.projectLocationId)) });
    output(r.localVisitDate === d.localVisitDate && !!r.visits && typeof r.visits === 'object' && !Array.isArray(r.visits) && !!r.recordedPresence && typeof r.recordedPresence === 'object' && !Array.isArray(r.recordedPresence));
    const raw = r.visits as Record<string, unknown>; const visits: Record<string, string> = {}; for (const key of ['total', 'pending', 'approved', 'denied', 'cancelled']) { output(count(raw[key])); visits[key] = raw[key] as string; }
    output(BigInt(visits.total) === BigInt(visits.pending) + BigInt(visits.approved) + BigInt(visits.denied) + BigInt(visits.cancelled));
    const presence = r.recordedPresence as Record<string, unknown>; output(count(presence.projectVisitsInside) && count(presence.digitalIdsInside));
    return { localVisitDate: r.localVisitDate as string, visits, recordedPresence: { projectVisitsInside: presence.projectVisitsInside as string, digitalIdsInside: presence.digitalIdsInside as string }, checkedAtUtc: stampOut(r.checkedAtUtc) };
  }
  async audit(session: Session, value: unknown) {
    const d = this.#body(value, ['fromUtc', 'untilUtc', 'locationId', 'projectLocationId', 'pageSize', 'afterAuditEventId']); const from = utc(d.fromUtc); const until = utc(d.untilUtc); input(from < until && Date.parse(until) - Date.parse(from) <= 31 * 86400000);
    const location = d.locationId === undefined || d.locationId === null ? null : int(d.locationId); const pair = optionalId(d.projectLocationId); input(!pair || location !== null); const size = pageSize(d);
    const r = await this.#call(session, 'gp.ListScopedAuditEvents', { FromUtc: p('datetime', from), UntilUtc: p('datetime', until), LocationId: p('int', location), ProjectLocationId: p('bigint', pair), PageSize: p('int', size), AfterAuditEventId: p('bigint', optionalId(d.afterAuditEventId)) });
    const result = this.#page(r, 'events', 'afterAuditEventId', size, row => { output(typeof row.resultCode === 'string' && ['SUCCESS', 'DENIED', 'ERROR'].includes(row.resultCode)); output(row.locationId === null || positiveInt(row.locationId)); output(row.projectLocationId === null || big(row.projectLocationId)); output(row.projectLocationId === null || row.locationId !== null); output(location === null || row.locationId === location); output(pair === null || row.projectLocationId === pair);
      const at = stampOut(row.occurredAtUtc); output(from <= at && at < until); return { auditEventId: idOut(row.auditEventId), actionCode: textOut(row.actionCode, 80), targetType: textOut(row.targetType, 50), resultCode: row.resultCode as string, locationId: row.locationId as number | null, projectLocationId: row.projectLocationId as string | null, actorDisplayName: textOut(row.actorDisplayName, 200),...Object.fromEntries((['targetDisplayName','staffCode','roleCode','scopeName','reason'] as const).filter(k=>row[k]!==undefined&&row[k]!==null).map(k=>[k,textOut(row[k],k==='reason'?300:k==='staffCode'?64:k==='roleCode'?24:k==='scopeName'?150:200)])), occurredAtUtc: at }; }, row => row.auditEventId);
    return { events: result.rows, hasMore: result.hasMore, afterAuditEventId: result.after, checkedAtUtc: result.checkedAtUtc };
  }
}
