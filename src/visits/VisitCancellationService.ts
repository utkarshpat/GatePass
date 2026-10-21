import { createHash } from 'node:crypto';
import { isUuid } from './SqlVisitReadRepository.ts';
import type { ReadParameter, ReadSqlClient } from './SqlVisitReadRepository.ts';

export interface VisitCancellationRepository { execute(parameters: Record<string, ReadParameter>): Promise<Record<string, unknown>> }
export class VisitCancellationError extends Error {
  code: 'INVALID_INPUT' | 'NOT_AUTHORIZED' | 'CONFLICT' | 'UNAVAILABLE';
  constructor(code: VisitCancellationError['code']) { super(code); this.code = code; }
}
const reasonValid = (value: unknown): value is string => typeof value === 'string' && value.isWellFormed() && value.length <= 300 && value.trim().length > 0 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const types: Record<string, ReadParameter['type']> = { SessionHash: 'binary', CsrfHash: 'binary', ClientKey: 'guid', VisitRequestId: 'guid', ExpectedPassId: 'guid', Reason: 'text' };
function token(value: unknown): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value)) throw new VisitCancellationError('NOT_AUTHORIZED');
  const bytes = Buffer.from(value, 'base64url');
  try {
    if (bytes.length !== 32 || bytes.toString('base64url') !== value) throw new VisitCancellationError('NOT_AUTHORIZED');
    return createHash('sha256').update(bytes).digest();
  } finally { bytes.fill(0); }
}
/** Execute-only API port. Actor and ownership are resolved again inside SQL. */
export class SqlVisitCancellationRepository implements VisitCancellationRepository {
  #client: ReadSqlClient;
  constructor(client: ReadSqlClient) { this.#client = client; }
  async execute(parameters: Record<string, ReadParameter>) {
    if (Object.keys(parameters).sort().join('|') !== Object.keys(types).sort().join('|')) throw new Error('INVALID_CANCELLATION_SQL_CONTRACT');
    for (const [key, type] of Object.entries(types)) {
      const p = parameters[key];
      if (!p || p.type !== type || (type === 'binary' ? !Buffer.isBuffer(p.value) || p.value.length !== 32 : type === 'guid' ? !isUuid(p.value) : !reasonValid(p.value))) throw new Error('INVALID_CANCELLATION_SQL_PARAMETER');
    }
    const result: unknown = JSON.parse(await this.#client.callProcedure('gp.CancelVisit', parameters));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('INVALID_CANCELLATION_SQL_RESPONSE');
    return result as Record<string, unknown>;
  }
}
export class VisitCancellationService {
  #repository: VisitCancellationRepository;
  constructor(repository: VisitCancellationRepository) { this.#repository = repository; }
  async cancel(session: { sessionToken: string; csrfToken: string }, value: unknown) {
    const input = (ok: unknown) => { if (!ok) throw new VisitCancellationError('INVALID_INPUT'); };
    input(!!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
    const data = value as Record<string, unknown>;
    input(Object.keys(data).sort().join('|') === 'clientKey|expectedPassId|reason|visitRequestId');
    input(isUuid(data.clientKey) && isUuid(data.visitRequestId) && isUuid(data.expectedPassId) && reasonValid(data.reason));
    const p = (type: ReadParameter['type'], value: ReadParameter['value']): ReadParameter => ({ type, value });
    let result: Record<string, unknown>;
    try {
      result = await this.#repository.execute({ SessionHash: p('binary', token(session?.sessionToken)), CsrfHash: p('binary', token(session?.csrfToken)),
        ClientKey: p('guid', (data.clientKey as string).toLowerCase()), VisitRequestId: p('guid', (data.visitRequestId as string).toLowerCase()),
        ExpectedPassId: p('guid', (data.expectedPassId as string).toLowerCase()), Reason: p('text', (data.reason as string).trim()) });
    } catch (error) {
      if (error instanceof VisitCancellationError) throw error;
      const number = Number((error as { number?: number })?.number);
      throw new VisitCancellationError(number === 52001 ? 'NOT_AUTHORIZED' : number === 52002 ? 'INVALID_INPUT' : [52003, 52004, 52005].includes(number) ? 'CONFLICT' : 'UNAVAILABLE');
    }
    if (!isUuid(result?.operationId) || !isUuid(result?.visitRequestId) || !isUuid(result?.accessPassId) || result.status !== 'CANCELLED'
      || result.visitRequestId.toLowerCase() !== (data.visitRequestId as string).toLowerCase() || result.accessPassId.toLowerCase() !== (data.expectedPassId as string).toLowerCase()
      || typeof result.wasInsideAtCancellation !== 'boolean') throw new VisitCancellationError('UNAVAILABLE');
    return { operationId: result.operationId.toLowerCase(), visitRequestId: result.visitRequestId.toLowerCase(), accessPassId: result.accessPassId.toLowerCase(), status: 'CANCELLED' as const,
      wasInsideAtCancellation: result.wasInsideAtCancellation as boolean };
  }
}
