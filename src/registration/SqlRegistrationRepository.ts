export type RegistrationParameter = { type: 'binary' | 'text' | 'guid' | 'int' | 'bigint' | 'datetime'; value: Buffer | string | number | null };
export interface RegistrationSqlClient { callProcedure(name: string, parameters: Record<string, RegistrationParameter>): Promise<string> }
export interface RegistrationRepository { execute(name: string, parameters: Record<string, RegistrationParameter>): Promise<Record<string, unknown>> }
const identity = { IntakeId: 'guid', TokenHash: 'binary', IntakeCsrfHash: 'binary', SessionHash: 'binary', CsrfHash: 'binary' };
const contracts: Record<string, Record<string, string>> = {
  'gp.GetRegistrationOptions': { ...identity, LocationCode: 'text', ProjectLocationId: 'bigint', Search: 'text' },
  'gp.ListRegistrationLocations': { ...identity },
  'gp.CreateRegistrationIntake': { ...identity, IntakeType: 'text' },
  'gp.RecordRegistrationPhoto': { ...identity, PhotoAssetId: 'guid', ContentHash: 'binary', MimeType: 'text', ByteLength: 'int', PixelWidth: 'int', PixelHeight: 'int' },
  'gp.SubmitRegistration': { ...identity, ClientKey: 'guid', RequestType: 'text', LocationId: 'int', Reason: 'text', PeopleJson: 'text',
    ProjectLocationId: 'bigint', HostEmployeeId: 'text', TemporaryIdReason: 'text', ValidFromUtc: 'datetime', ValidUntilUtc: 'datetime', CredentialsJson: 'text' },
};
const nullable = new Set(['SessionHash', 'CsrfHash', 'ProjectLocationId', 'HostEmployeeId', 'TemporaryIdReason', 'ValidFromUtc', 'ValidUntilUtc', 'CredentialsJson', 'Search']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export class SqlRegistrationRepository implements RegistrationRepository {
  #client: RegistrationSqlClient;
  constructor(client: RegistrationSqlClient) { this.#client = client; }
  async execute(name: string, parameters: Record<string, RegistrationParameter>): Promise<Record<string, unknown>> {
    const contract = Object.hasOwn(contracts, name) ? contracts[name] : undefined;
    if (!contract || Object.keys(contract).sort().join('|') !== Object.keys(parameters).sort().join('|')) throw new Error('INVALID_REGISTRATION_SQL_CONTRACT');
    for (const [key, type] of Object.entries(contract)) {
      const parameter = parameters[key];
      if (parameter.type !== type || (parameter.value === null && !nullable.has(key))) throw new Error('INVALID_REGISTRATION_SQL_PARAMETER');
      const value = parameter.value; if (value === null) continue;
      if (type === 'binary' && (!Buffer.isBuffer(value) || value.length !== 32)) throw new Error('INVALID_REGISTRATION_SQL_PARAMETER');
      if (type === 'text' && (typeof value !== 'string' || Buffer.byteLength(value, 'utf16le') > (key === 'CredentialsJson' ? 524288 : 262144))) throw new Error('INVALID_REGISTRATION_SQL_PARAMETER');
      if (type === 'guid' && (typeof value !== 'string' || !uuid.test(value))) throw new Error('INVALID_REGISTRATION_SQL_PARAMETER');
      if (type === 'int' && (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2147483647)) throw new Error('INVALID_REGISTRATION_SQL_PARAMETER');
      if (type === 'bigint' && (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/u.test(value) || BigInt(value) > 9223372036854775807n)) throw new Error('INVALID_REGISTRATION_SQL_PARAMETER');
      if (type === 'datetime' && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) || value.startsWith('0000') || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)) throw new Error('INVALID_REGISTRATION_SQL_PARAMETER');
    }
    const result: unknown = JSON.parse(await this.#client.callProcedure(name, parameters));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('INVALID_REGISTRATION_SQL_RESPONSE');
    return result as Record<string, unknown>;
  }
}
