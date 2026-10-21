export type PrintParameter = { type: 'binary' | 'text' | 'guid'; value: Buffer | string | null };
export interface PassPrintRepository { execute(name: string, parameters: Record<string, PrintParameter>): Promise<Record<string, unknown>> }
export interface PrintSqlClient { callProcedure(name: string, parameters: Record<string, PrintParameter>): Promise<string> }
const auth = { SessionHash: 'binary', CsrfHash: 'binary' };
const claim = { ...auth, PrintJobId: 'guid', ClaimToken: 'guid' };
const contracts: Record<string, Record<string, string>> = {
  'gp.ReissuePass': { ...auth, ClientKey: 'guid', VisitRequestId: 'guid', ExpectedPassId: 'guid', Reason: 'text', NewAccessPassId: 'guid',
    CredentialHash: 'binary', Ciphertext: 'binary', Nonce: 'binary', AuthenticationTag: 'binary', KeyVersion: 'text' },
  'gp.RequestPassPrint': { ...auth, ClientKey: 'guid', VisitRequestId: 'guid', ExpectedPassId: 'guid', PrinterLabel: 'text' },
  'gp.GetPassPrintJob': { ...auth, PrintJobId: 'guid' },
  'gp.BeginPassRender': claim,
  'gp.FinishPassRender': { ...claim, ArtifactDigest: 'binary' },
  'gp.DispatchPassPrint': { ...claim, ArtifactDigest: 'binary' },
  'gp.FailPassPrint': { ...claim, FailureCode: 'text' },
};
const nullable = new Set(['NewAccessPassId', 'CredentialHash', 'Ciphertext', 'Nonce', 'AuthenticationTag', 'KeyVersion', 'PrinterLabel']);
export class SqlPassPrintRepository implements PassPrintRepository {
  #client: PrintSqlClient; #kind: 'api' | 'render';
  constructor(client: PrintSqlClient, kind: 'api' | 'render') { this.#client = client; this.#kind = kind; }
  async execute(name: string, parameters: Record<string, PrintParameter>): Promise<Record<string, unknown>> {
    const contract = Object.hasOwn(contracts, name) ? contracts[name] : undefined;
    const render = ['gp.BeginPassRender', 'gp.FinishPassRender', 'gp.DispatchPassPrint', 'gp.FailPassPrint'].includes(name);
    if (!contract || render !== (this.#kind === 'render') || Object.keys(contract).sort().join('|') !== Object.keys(parameters).sort().join('|')) throw new Error('INVALID_PRINT_SQL_CONTRACT');
    for (const [key, type] of Object.entries(contract)) {
      const p = parameters[key]; const value = p.value;
      if (p.type !== type || value === null && !nullable.has(key)) throw new Error('INVALID_PRINT_SQL_PARAMETER');
      if (value === null) continue;
      if (type === 'binary' && (!Buffer.isBuffer(value) || value.length !== (key === 'Nonce' ? 12 : key === 'AuthenticationTag' ? 16 : 32))
          || type === 'guid' && (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value))
          || type === 'text' && (typeof value !== 'string' || value.length > (key === 'Reason' ? 300 : key === 'PrinterLabel' ? 100 : 86))) throw new Error('INVALID_PRINT_SQL_PARAMETER');
    }
    const result: unknown = JSON.parse(await this.#client.callProcedure(name, parameters));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('INVALID_PRINT_SQL_RESPONSE');
    return result as Record<string, unknown>;
  }
}
