import sql from 'mssql';
import { readFile } from 'node:fs/promises';

export type SqlParameter = { type: 'binary' | 'text' | 'bit' | 'guid' | 'int' | 'bigint' | 'datetime' | 'date'; value: Buffer | string | boolean | number | null };
export type DatabaseIdentity = { server: string; port: number; database: string; user: string; password: string };
export const procedureRoles = {
  auth: ['BeginGuardLogin', 'CompleteGuardLogin', 'InspectGuardSetup', 'CompleteGuardSetup', 'TouchGuardSession', 'RevokeGuardSession'],
  staffAuth: ['ResolveStaffLoginIdentity','BeginStaffLogin','CompleteStaffLogin','InspectStaffSetup','CompleteStaffSetup','TouchStaffSession','RevokeStaffSession'],
  api: ['FindGuardPass','GetGuardWorkspaceContext','ListGuardVisitors','ListGuardRecentScans','GetAdminWorkspaceContext','ListLeadProjects','SearchProjectLeadCandidates','ListProjectHeads','ManageStaffCredential','DecideVisit', 'RecordMovement', 'DeallocateGuard', 'ManageGuardCredential', 'CreateRegistrationIntake', 'RecordRegistrationPhoto', 'SubmitRegistration', 'ListRegistrationLocations', 'GetRegistrationOptions',
    'GetStaffAccessContext', 'GetReceptionContext', 'ListReceptionVisits', 'ListVisits', 'GetVisitDetail', 'VerifyGuardPass', 'ReissuePass', 'RequestPassPrint', 'GetPassPrintJob', 'ListGuardWorkContexts', 'CancelVisit',
    'AllocateGuard', 'GrantStaffRole', 'RevokeStaffRole', 'ListAdminProjectLocations', 'ListAdminGuards', 'SearchStaffSubjects', 'ListStaffRoles', 'GetOperationalSummary', 'ListScopedAuditEvents'],
} as const;
type Pool = { request(): { input(name: string, type: unknown, value: unknown): unknown; execute(name: string): Promise<any> }; close(): Promise<void> };

/** Separate pool per least-privilege SQL identity. No global pool, query(), retries or caller SQL. */
export class SqlProcedureClient {
  #pool: Pool; #allowed: Set<string>;
  constructor(pool: Pool, role: keyof typeof procedureRoles) {
    this.#pool = pool; this.#allowed = new Set(procedureRoles[role].map(name => 'gp.' + name));
  }
  async callProcedure(name: string, parameters: Record<string, SqlParameter>): Promise<string> {
    if (!this.#allowed.has(name)) throw new Error('SQL_PROCEDURE_NOT_ALLOWED');
    const request = this.#pool.request();
    for (const [key, p] of Object.entries(parameters)) {
      if (!/^[A-Za-z][A-Za-z0-9]{0,127}$/u.test(key) || !p) throw new Error('INVALID_SQL_PARAMETER');
      const v = p.value;
      const types = { binary: sql.VarBinary(sql.MAX), text: sql.NVarChar(sql.MAX), bit: sql.Bit, guid: sql.UniqueIdentifier,
        int: sql.Int, bigint: sql.BigInt, datetime: sql.DateTime2(3), date: sql.Date };
      if (!Object.hasOwn(types, p.type)) throw new Error('INVALID_SQL_PARAMETER');
      if (v !== null && (p.type === 'binary' && !Buffer.isBuffer(v) || p.type === 'text' && typeof v !== 'string'
        || p.type === 'bit' && typeof v !== 'boolean' || p.type === 'int' && (!Number.isInteger(v) || Number(v) < -2147483648 || Number(v) > 2147483647)
        || p.type === 'guid' && (typeof v !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(v))
        || p.type === 'bigint' && (typeof v !== 'string' || !/^-?(0|[1-9][0-9]{0,18})$/u.test(v) || BigInt(v) < -9223372036854775808n || BigInt(v) > 9223372036854775807n)
        || p.type === 'datetime' && (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(v) || new Date(v).toISOString() !== v)
        || p.type === 'date' && (typeof v !== 'string' || !/^\d{4}-\d\d-\d\d$/u.test(v) || new Date(v + 'T00:00:00.000Z').toISOString().slice(0, 10) !== v))) throw new Error('INVALID_SQL_PARAMETER');
      request.input(key, types[p.type], v !== null && ['date', 'datetime'].includes(p.type) ? new Date(String(v)) : v);
    }
    const result = await request.execute(name);
    // Existing procedures return one scalar JSON value, sometimes with an unnamed column.
    if (result.recordsets?.length !== 1 || result.recordsets[0].length !== 1) throw new Error('INVALID_SQL_RESULT');
    const values = Object.values(result.recordsets[0][0]);
    if (values.length !== 1 || typeof values[0] !== 'string' || Buffer.byteLength(values[0]) > 4 * 1024 * 1024) throw new Error('INVALID_SQL_RESULT');
    return values[0];
  }
  close() { return this.#pool.close(); }
}

export async function connectSql(identity: DatabaseIdentity, role: keyof typeof procedureRoles) {
  if (!identity.server || !identity.database || !identity.user || !identity.password || !Number.isInteger(identity.port) || identity.port < 1 || identity.port > 65535) throw new Error('INVALID_DATABASE_CONFIGURATION');
  const pool = new sql.ConnectionPool({ ...identity, connectionTimeout: 10000, requestTimeout: 15000,
    pool: { min: 0, max: role === 'auth' ? 2 : 8, idleTimeoutMillis: 30000 },
    options: { encrypt: true, trustServerCertificate: false, useUTC: true, abortTransactionOnError: true, appName: 'GatePass-' + role } });
  pool.on('error', () => { /* Deliberately exclude raw driver errors, config and parameter values from logs. */ });
  try {
    await pool.connect();
    // Fixed startup introspection only: fail closed on elevated or combined identities.
    // Runtime callers never receive a query API or control this SQL text.
    const expected = role === 'api' ? 'gp_api_runtime' : role==='staffAuth'?'gp_staff_auth_runtime':'gp_guard_auth_runtime';
    const admissionSql = await readFile(new URL('./runtime-identity.sql', import.meta.url), 'utf8');
    const check = await pool.request().input('ExpectedRole', sql.NVarChar(128), expected).query(admissionSql);
    if (check.recordset?.[0]?.allowed !== 1) throw new Error('UNSAFE_DATABASE_IDENTITY');
    return new SqlProcedureClient(pool, role);
  }
  catch { await pool.close().catch(() => {}); throw new Error('DATABASE_CONNECTION_UNAVAILABLE'); }
}
