import { createHash } from 'node:crypto';
import { isUuid } from './SqlVisitReadRepository.ts';
import type { ReadParameter, ReadSqlClient } from './SqlVisitReadRepository.ts';

export interface GuardMovementRepository { execute(parameters: Record<string, ReadParameter>): Promise<Record<string, unknown>> }
const types: Record<string, ReadParameter['type']> = { SessionHash: 'binary', CsrfHash: 'binary', ClientKey: 'guid', VisitRequestId: 'guid', AccessPassId: 'guid',
  LocationId: 'int', SelectedProjectLocationId: 'bigint', EventType: 'text', EntryMethod: 'text', CredentialHash: 'binary' };
const bigId = (value: unknown): value is string => typeof value === 'string' && /^[1-9][0-9]{0,18}$/u.test(value) && BigInt(value) <= 9223372036854775807n;
export class GuardMovementError extends Error {
  code: 'INVALID_INPUT' | 'NOT_AUTHORIZED' | 'CONFLICT' | 'UNAVAILABLE';
  constructor(code: GuardMovementError['code']) { super(code); this.code = code; }
}
const input = (ok: unknown) => { if (!ok) throw new GuardMovementError('INVALID_INPUT'); };
function tokenHash(value: unknown): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value)) throw new GuardMovementError('NOT_AUTHORIZED');
  const bytes = Buffer.from(value, 'base64url');
  try {
    if (bytes.length !== 32 || bytes.toString('base64url') !== value) throw new GuardMovementError('NOT_AUTHORIZED');
    return createHash('sha256').update(bytes).digest();
  } finally { bytes.fill(0); }
}
/** API identity only. Reconciliation remains a separate explicitly privileged SQL action. */
export class SqlGuardMovementRepository implements GuardMovementRepository {
  #client: ReadSqlClient;
  constructor(client: ReadSqlClient) { this.#client = client; }
  async execute(parameters: Record<string, ReadParameter>) {
    if (Object.keys(parameters).sort().join('|') !== Object.keys(types).sort().join('|')) throw new Error('INVALID_MOVEMENT_SQL_CONTRACT');
    for (const [key, type] of Object.entries(types)) {
      const p = parameters[key]; const v = p.value;
      if (p.type !== type || v === null && !['SelectedProjectLocationId', 'CredentialHash'].includes(key)
        || v !== null && (type === 'binary' && (!Buffer.isBuffer(v) || v.length !== 32) || type === 'guid' && !isUuid(v)
          || type === 'bigint' && !bigId(v) || type === 'int' && (!Number.isInteger(v) || Number(v) < 1 || Number(v) > 2147483647)
          || type === 'text' && (typeof v !== 'string' || v.length > 20))) throw new Error('INVALID_MOVEMENT_SQL_PARAMETER');
    }
    const result: unknown = JSON.parse(await this.#client.callProcedure('gp.RecordMovement', parameters));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('INVALID_MOVEMENT_SQL_RESPONSE');
    return result as Record<string, unknown>;
  }
}
export class GuardMovementService {
  #repository: GuardMovementRepository;
  constructor(repository: GuardMovementRepository) { this.#repository = repository; }
  async record(session: { sessionToken: string; csrfToken: string }, value: unknown) {
    input(!!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
    const data = value as Record<string, unknown>;
    input(Object.keys(data).every(key => ['clientKey', 'visitRequestId', 'accessPassId', 'locationId', 'selectedProjectLocationId', 'eventType', 'entryMethod', 'credential'].includes(key)));
    input(['clientKey', 'visitRequestId', 'accessPassId'].every(key => isUuid(data[key])) && Number.isInteger(data.locationId) && Number(data.locationId) > 0 && Number(data.locationId) <= 2147483647);
    input(Object.hasOwn(data, 'selectedProjectLocationId') && (data.selectedProjectLocationId === null || bigId(data.selectedProjectLocationId)));
    input(['ENTRY', 'EXIT'].includes(String(data.eventType)) && ['SCAN', 'MANUAL'].includes(String(data.entryMethod)));
    input(data.entryMethod === 'SCAN' ? typeof data.credential === 'string' : data.credential === undefined);
    const p = (type: ReadParameter['type'], value: ReadParameter['value']): ReadParameter => ({ type, value });
    let result: Record<string, unknown>;
    try {
      result = await this.#repository.execute({ SessionHash: p('binary', tokenHash(session.sessionToken)), CsrfHash: p('binary', tokenHash(session.csrfToken)),
        ClientKey: p('guid', (data.clientKey as string).toLowerCase()), VisitRequestId: p('guid', (data.visitRequestId as string).toLowerCase()), AccessPassId: p('guid', (data.accessPassId as string).toLowerCase()),
        LocationId: p('int', Number(data.locationId)), SelectedProjectLocationId: p('bigint', data.selectedProjectLocationId as string | null),
        EventType: p('text', data.eventType as string), EntryMethod: p('text', data.entryMethod as string), CredentialHash: p('binary', data.entryMethod === 'SCAN' ? tokenHash(data.credential) : null) });
    } catch (error) {
      if (error instanceof GuardMovementError) throw error;
      const number = Number((error as { number?: number })?.number);
      throw new GuardMovementError(number === 52001 ? 'NOT_AUTHORIZED' : number === 52002 ? 'INVALID_INPUT' : [52003, 52004, 52005].includes(number) ? 'CONFLICT' : 'UNAVAILABLE');
    }
    if (!isUuid(result.operationId) || !isUuid(result.visitRequestId) || result.visitRequestId.toLowerCase() !== (data.visitRequestId as string).toLowerCase()
      || result.eventType !== data.eventType || result.isInside !== (data.eventType === 'ENTRY') || !Number.isSafeInteger(result.accessEventId) || Number(result.accessEventId) <= 0
      || (result.projectLocationId ?? null) !== data.selectedProjectLocationId) throw new GuardMovementError('UNAVAILABLE');
    return { operationId: result.operationId.toLowerCase(), visitRequestId: result.visitRequestId.toLowerCase(), accessEventId: result.accessEventId as number,
      projectLocationId: result.projectLocationId as string ?? null, eventType: data.eventType as 'ENTRY' | 'EXIT', isInside: result.isInside as boolean };
  }
}
