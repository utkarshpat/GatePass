export type ReadParameter = { type: 'binary' | 'text' | 'guid' | 'int' | 'bigint' | 'datetime' | 'date'; value: Buffer | string | number | null };
export interface ReadSqlClient { callProcedure(name: string, parameters: Record<string, ReadParameter>): Promise<string> }
export interface VisitReadRepository { execute(name: string, parameters: Record<string, ReadParameter>): Promise<Record<string, unknown>> }
const identity = { SessionHash: 'binary', CsrfHash: 'binary' };
const resource = { ...identity, View: 'text', VisitRequestId: 'guid' };
const contracts: Record<string, Record<string, string>> = {
  'gp.ListVisits': { ...identity, View: 'text', Queue: 'text', LocationId: 'int', LocalVisitDate: 'date', ProjectLocationId: 'bigint',
    PublicReference: 'text', PageSize: 'int', AfterSubmittedAtUtc: 'datetime', AfterVisitRequestId: 'guid' },
  'gp.GetVisitDetail': resource,
  'gp.VerifyGuardPass': { ...identity, LocationId: 'int', CredentialHash: 'binary', CorrelationId: 'guid', SelectedProjectLocationId: 'bigint' },
  'gp.ListGuardWorkContexts': { ...identity, LocationId: 'int' },
  'gp.ResolveVisitPhoto': resource,
};
const optional = new Set(['LocationId', 'LocalVisitDate', 'ProjectLocationId', 'SelectedProjectLocationId', 'PublicReference', 'AfterSubmittedAtUtc', 'AfterVisitRequestId']);
export const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
export const isUtc = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  && !value.startsWith('0000') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) && isUtc(value + 'T00:00:00.000Z');
/** Configure separate actual SQL clients/identities for API and media at composition. */
export class SqlVisitReadRepository implements VisitReadRepository {
  #client: ReadSqlClient; #kind: 'api' | 'media';
  constructor(client: ReadSqlClient, kind: 'api' | 'media') { this.#client = client; this.#kind = kind; }
  async execute(name: string, parameters: Record<string, ReadParameter>): Promise<Record<string, unknown>> {
    const contract = Object.hasOwn(contracts, name) ? contracts[name] : undefined;
    if (!contract || (name === 'gp.ResolveVisitPhoto') !== (this.#kind === 'media') ||
        Object.keys(contract).sort().join('|') !== Object.keys(parameters).sort().join('|')) throw new Error('INVALID_READ_SQL_CONTRACT');
    for (const [key, type] of Object.entries(contract)) {
      const parameter = parameters[key]; const value = parameter.value;
      if (parameter.type !== type || (value === null && !optional.has(key))) throw new Error('INVALID_READ_SQL_PARAMETER');
      if (value === null) continue;
      if (type === 'binary' && (!Buffer.isBuffer(value) || value.length !== 32) || type === 'guid' && !isUuid(value)
          || type === 'datetime' && !isUtc(value) || type === 'date' && !isDate(value)
          || type === 'text' && (typeof value !== 'string' || value.length > 40)
          || type === 'int' && (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2147483647)
          || type === 'bigint' && (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/u.test(value) || BigInt(value) > 9223372036854775807n)) throw new Error('INVALID_READ_SQL_PARAMETER');
    }
    const value: unknown = JSON.parse(await this.#client.callProcedure(name, parameters));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_READ_SQL_RESPONSE');
    return value as Record<string, unknown>;
  }
}
