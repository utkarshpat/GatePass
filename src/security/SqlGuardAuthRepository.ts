import type { AuthStatus, GuardAuthRepository, ProcedureParameter } from './GuardAuthService.ts';

/** Implement with the deployment's SQL driver and separate gp_guard_auth_runtime pool.
 * callProcedure must use stored-procedure RPC and typed parameters, never string SQL.
 */
export interface GuardAuthSqlClient {
  callProcedure(name: string, parameters: Record<string, ProcedureParameter>): Promise<string>;
}
const contracts: Record<string, Record<string, ProcedureParameter['type']>> = {
  'gp.BeginGuardLogin': { LoginId: 'text', AttemptHash: 'binary', SourceHash: 'binary' },
  'gp.CompleteGuardLogin': { AttemptHash: 'binary', SourceHash: 'binary', PasswordVerified: 'bit',
    SessionHash: 'binary', CsrfHash: 'binary', NewEncodedPasswordHash: 'text' },
  'gp.InspectGuardSetup': { TokenHash: 'binary', SourceHash: 'binary' },
  'gp.CompleteGuardSetup': { TokenHash: 'binary', SourceHash: 'binary', NewEncodedPasswordHash: 'text' },
  'gp.TouchGuardSession': { SessionHash: 'binary', CsrfHash: 'binary' },
  'gp.RevokeGuardSession': { SessionHash: 'binary', CsrfHash: 'binary' },
};
export class SqlGuardAuthRepository implements GuardAuthRepository {
  #client: GuardAuthSqlClient;
  #domain: 'Guard'|'Staff';
  constructor(client: GuardAuthSqlClient,domain:'Guard'|'Staff'='Guard') { if(!['Guard','Staff'].includes(domain))throw new Error('INVALID_AUTH_DOMAIN');this.#client = client;this.#domain=domain; }
  async execute(procedure: string, parameters: Record<string, ProcedureParameter>): Promise<AuthStatus> {
    const legacy=procedure.replace('Staff', 'Guard');
    const contract = (this.#domain==='Staff'?procedure.includes('Staff'):!procedure.includes('Staff'))&&Object.hasOwn(contracts, legacy) ? contracts[legacy] : undefined;
    if (!contract || Object.keys(parameters).sort().join('|') !== Object.keys(contract).sort().join('|')) throw new Error('INVALID_AUTH_SQL_CONTRACT');
    for (const [key, type] of Object.entries(contract)) {
      const parameter = parameters[key];
      const nullable = key === 'NewEncodedPasswordHash' && legacy === 'gp.CompleteGuardLogin';
      if (parameter.type !== type || (parameter.value === null && !nullable)) throw new Error('INVALID_AUTH_SQL_PARAMETER');
      if (parameter.value === null) continue;
      if (type === 'binary' && (!Buffer.isBuffer(parameter.value) || parameter.value.length !== 32)) throw new Error('INVALID_AUTH_SQL_PARAMETER');
      if (type === 'text' && (typeof parameter.value !== 'string' || parameter.value.length > 128)) throw new Error('INVALID_AUTH_SQL_PARAMETER');
      if (type === 'bit' && typeof parameter.value !== 'boolean') throw new Error('INVALID_AUTH_SQL_PARAMETER');
    }
    const decoded: unknown = JSON.parse(await this.#client.callProcedure(procedure, parameters));
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('INVALID_AUTH_SQL_RESPONSE');
    const row = decoded as Record<string, unknown>;
    if (!['READY', 'OK', 'DENIED', 'THROTTLED'].includes(String(row.status))) throw new Error('INVALID_AUTH_SQL_RESPONSE');
    const result: AuthStatus = { status: row.status as AuthStatus['status'] };
    if (legacy === 'gp.BeginGuardLogin' && result.status === 'READY') {
      if (typeof row.encodedPasswordHash !== 'string' || row.encodedPasswordHash.length > 128) throw new Error('INVALID_AUTH_SQL_RESPONSE');
      result.encodedPasswordHash = row.encodedPasswordHash;
    }
    if (legacy === 'gp.CompleteGuardLogin' && result.status === 'OK') {
      for (const key of ['idleExpiresAtUtc', 'absoluteExpiresAtUtc'] as const) {
        if (typeof row[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?Z?$/u.test(row[key])) throw new Error('INVALID_AUTH_SQL_RESPONSE');
        const date = new Date(row[key].endsWith('Z') ? row[key] : row[key] + 'Z');
        if (!Number.isFinite(date.getTime())) throw new Error('INVALID_AUTH_SQL_RESPONSE');
        result[key] = date.toISOString();
      }
    }
    return result;
  }
}
