import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { prepareReplacementQrEnvelope, recoverQrCredential } from '../registration/QrCredentialEnvelope.ts';
import { isUtc, isUuid } from '../visits/SqlVisitReadRepository.ts';
import type { QrKeySource, QrEnvelope } from '../registration/QrCredentialEnvelope.ts';
import type { PrivatePhotoReader } from '../visits/VisitReadService.ts';
import type { PassPrintRepository, PrintParameter } from './SqlPassPrintRepository.ts';
import type { PassCardData, PassCardRenderer } from './PassCardRenderer.ts';
export type PrintSession = { sessionToken: string; csrfToken: string };
export class PassPrintError extends Error {
  code: 'INVALID_INPUT' | 'NOT_AUTHORIZED' | 'CONFLICT' | 'UNAVAILABLE';
  constructor(code: PassPrintError['code']) { super(code); this.code = code; }
}
const input = (condition: unknown) => { if (!condition) throw new PassPrintError('INVALID_INPUT'); };
const output = (condition: unknown) => { if (!condition) throw new PassPrintError('UNAVAILABLE'); };
const parameter = (type: PrintParameter['type'], value: PrintParameter['value']): PrintParameter => ({ type, value });
const uuid = (value: unknown): string => { input(isUuid(value)); return (value as string).toLowerCase(); };
const outUuid = (value: unknown): string => { output(isUuid(value)); return (value as string).toLowerCase(); };
const text = (value: unknown, max: number): string => { input(typeof value === 'string' && value.isWellFormed() && value.length > 0 && value.length <= max && value.trim().length && !/[\u0000-\u001f\u007f]/u.test(value)); return value as string; };
const outText = (value: unknown, max: number): string => { try { return text(value, max); } catch { throw new PassPrintError('UNAVAILABLE'); } };
const object = (value: unknown, keys: string[]) => {
  input(!!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const result = value as Record<string, unknown>; input(Object.keys(result).every(key => keys.includes(key))); return result;
};
function hashToken(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value)) throw new PassPrintError('NOT_AUTHORIZED');
  const bytes = Buffer.from(value, 'base64url');
  try { if (bytes.length !== 32 || bytes.toString('base64url') !== value) throw new PassPrintError('NOT_AUTHORIZED'); return createHash('sha256').update(bytes).digest(); }
  finally { bytes.fill(0); }
}
const auth = (session: PrintSession) => ({ SessionHash: parameter('binary', hashToken(session.sessionToken)), CsrfHash: parameter('binary', hashToken(session.csrfToken)) });
async function call(repository: PassPrintRepository, name: string, parameters: Record<string, PrintParameter>) {
  try { return await repository.execute(name, parameters); }
  catch (error) {
    const number = (error as { number?: number })?.number;
    if ([52001, 53101].includes(Number(number))) throw new PassPrintError('NOT_AUTHORIZED');
    if ([52003, 53103, 53105].includes(Number(number))) throw new PassPrintError('CONFLICT');
    if (number === 53102) throw new PassPrintError('INVALID_INPUT');
    throw new PassPrintError('UNAVAILABLE');
  }
}
function job(row: Record<string, unknown>) {
  output(['REQUESTED', 'RENDERED', 'DISPATCHED', 'FAILED'].includes(String(row.status)) && ['FIRST', 'REPRINT', 'REISSUE'].includes(String(row.printReason)));
  const result = { printJobId: outUuid(row.printJobId), visitRequestId: outUuid(row.visitRequestId), accessPassId: outUuid(row.accessPassId),
    status: row.status as string, printReason: row.printReason as string, failureCode: null as string | null };
  if (row.failureCode !== undefined) { output(['RENDER_FAILED', 'STORAGE_UNAVAILABLE', 'KEY_UNAVAILABLE', 'STALE_CREDENTIAL', 'ATTEMPTS_EXHAUSTED'].includes(String(row.failureCode))); result.failureCode = row.failureCode as string; }
  return result;
}
export class PassPrintService {
  #repository: PassPrintRepository; #keys: QrKeySource;
  constructor(repository: PassPrintRepository, keys: QrKeySource) { this.#repository = repository; this.#keys = keys; }
  async reissue(session: PrintSession, value: unknown) {
    const data = object(value, ['clientKey', 'visitRequestId', 'expectedPassId', 'reason']);
    const visit = uuid(data.visitRequestId); const previous = uuid(data.expectedPassId);
    const p: Record<string, PrintParameter> = { ...auth(session), ClientKey: parameter('guid', uuid(data.clientKey)), VisitRequestId: parameter('guid', visit),
      ExpectedPassId: parameter('guid', previous), Reason: parameter('text', text(data.reason, 300)), NewAccessPassId: parameter('guid', null),
      CredentialHash: parameter('binary', null), Ciphertext: parameter('binary', null), Nonce: parameter('binary', null), AuthenticationTag: parameter('binary', null), KeyVersion: parameter('text', null) };
    let result = await call(this.#repository, 'gp.ReissuePass', p);
    if (result.status === 'NEEDS_CREDENTIALS') {
      let envelope: QrEnvelope;
      try { envelope = await prepareReplacementQrEnvelope(visit, this.#keys); } catch { throw new PassPrintError('UNAVAILABLE'); }
      result = await call(this.#repository, 'gp.ReissuePass', { ...p, NewAccessPassId: parameter('guid', envelope.accessPassId),
        CredentialHash: parameter('binary', Buffer.from(envelope.credentialHash, 'hex')), Ciphertext: parameter('binary', Buffer.from(envelope.ciphertext, 'hex')),
        Nonce: parameter('binary', Buffer.from(envelope.nonce, 'hex')), AuthenticationTag: parameter('binary', Buffer.from(envelope.authenticationTag, 'hex')), KeyVersion: parameter('text', envelope.keyVersion) });
    }
    output(result.status === 'REISSUED' && outUuid(result.visitRequestId) === visit && outUuid(result.replacedPassId) === previous
      && Number.isInteger(result.passVersion) && Number(result.passVersion) >= 2 && Number(result.passVersion) <= 2147483647);
    return { status: 'REISSUED', visitRequestId: visit, replacedPassId: previous, accessPassId: outUuid(result.accessPassId), passVersion: Number(result.passVersion) };
  }
  async request(session: PrintSession, value: unknown) {
    const data = object(value, ['clientKey', 'visitRequestId', 'expectedPassId', 'printerLabel']);
    const visit = uuid(data.visitRequestId); const pass = uuid(data.expectedPassId);
    const result = job(await call(this.#repository, 'gp.RequestPassPrint', { ...auth(session), ClientKey: parameter('guid', uuid(data.clientKey)),
      VisitRequestId: parameter('guid', visit), ExpectedPassId: parameter('guid', pass), PrinterLabel: parameter('text', data.printerLabel === undefined || data.printerLabel === null ? null : text(data.printerLabel, 100)) }));
    output(result.visitRequestId === visit && result.accessPassId === pass); return result;
  }
  async status(session: PrintSession, printJobId: unknown) {
    const id = uuid(printJobId); const result = job(await call(this.#repository, 'gp.GetPassPrintJob', { ...auth(session), PrintJobId: parameter('guid', id) }));
    output(result.printJobId === id); return result;
  }
}
/** Compose only with gp_render_runtime, protected keys/storage and a trusted
 * matrix encoder. Returned bytes are an authorized private binary response. */
export class PassRenderService {
  #repository: PassPrintRepository; #keys: QrKeySource; #photos: PrivatePhotoReader; #renderer: PassCardRenderer;
  constructor(repository: PassPrintRepository, keys: QrKeySource, photos: PrivatePhotoReader, renderer: PassCardRenderer) {
    this.#repository = repository; this.#keys = keys; this.#photos = photos; this.#renderer = renderer;
  }
  async renderAndDispatch(session: PrintSession, printJobId: unknown) {
    const id = uuid(printJobId); const parameters = { ...auth(session), PrintJobId: parameter('guid', id), ClaimToken: parameter('guid', randomUUID()) };
    let begun = false; let failure = 'RENDER_FAILED'; let photo: Buffer | undefined; let rawQr: Buffer | undefined; let artifact: Buffer | undefined;
    try {
      const packet = await call(this.#repository, 'gp.BeginPassRender', parameters);
      if (packet.status === 'FAILED') throw new PassPrintError('CONFLICT'); begun = true;
      output(outUuid(packet.printJobId) === id && ['PENDING', 'APPROVED'].includes(String(packet.visitStatus)) && ['DIGITAL_ID', 'EMPLOYEE_PROJECT', 'EXTERNAL'].includes(String(packet.requestType)));
      const visit = outUuid(packet.visitRequestId); const pass = outUuid(packet.accessPassId); const photoId = outUuid(packet.photoAssetId);
      const mime = outText(packet.mimeType, 30); const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
      output(Object.hasOwn(extensions, mime) && typeof packet.storageKey === 'string'
        && new RegExp(`^intakes/[0-9a-f]{32}/${photoId.replaceAll('-', '')}\\.${extensions[mime]}$`, 'u').test(packet.storageKey)
        && Number.isInteger(packet.byteLength) && Number(packet.byteLength) > 0 && Number(packet.byteLength) <= 5242880
        && typeof packet.photoContentHash === 'string' && /^[0-9a-f]{64}$/iu.test(packet.photoContentHash) && isUtc(packet.validFromUtc) && isUtc(packet.validUntilUtc));
      failure = 'STORAGE_UNAVAILABLE'; const source = await this.#photos.read(packet.storageKey as string, Number(packet.byteLength));
      output(Buffer.isBuffer(source) && source.length === packet.byteLength); photo = Buffer.from(source);
      output(timingSafeEqual(createHash('sha256').update(photo).digest(), Buffer.from(packet.photoContentHash as string, 'hex')));
      let credential: string | null = null;
      {
        failure = 'KEY_UNAVAILABLE'; rawQr = await recoverQrCredential({ clientPersonKey: visit, visitRequestId: visit, accessPassId: pass,
          credentialHash: packet.credentialHash as string, ciphertext: packet.ciphertext as string, nonce: packet.nonce as string,
          authenticationTag: packet.authenticationTag as string, keyVersion: packet.keyVersion as string }, this.#keys);
        credential = rawQr.toString('base64url');
      }
      failure = 'RENDER_FAILED';
      const details = packet.cardDetails as Record<string, unknown>;
      output(!!details && typeof details === 'object' && !Array.isArray(details)
        && Object.keys(details).sort().join('|') === ['employeeId', 'hostEmployeeId', 'hostName', 'purpose', 'assignedProjectCount', 'assignedProjects'].sort().join('|')
        && Number.isInteger(details.assignedProjectCount) && Number(details.assignedProjectCount) >= 0 && Number(details.assignedProjectCount) <= 2147483647
        && Array.isArray(details.assignedProjects) && details.assignedProjects.length === Math.min(3, Number(details.assignedProjectCount)));
      const projects = (details.assignedProjects as Record<string, unknown>[]).map(project => {
        output(!!project && typeof project === 'object' && !Array.isArray(project) && Object.keys(project).sort().join('|') === 'code|name');
        return { code: outText(project.code, 80), name: outText(project.name, 200) };
      });
      output(new Set(projects.map(project => project.code)).size === projects.length);
      const external = packet.requestType === 'EXTERNAL';
      output(external ? details.employeeId === null && details.assignedProjectCount === 0 : details.hostEmployeeId === null && details.hostName === null);
      const data: PassCardData = { personName: outText(packet.personName, 200), requestType: packet.requestType as PassCardData['requestType'], visitStatus: packet.visitStatus as 'PENDING' | 'APPROVED',
        publicReference: outText(packet.publicReference, 40), publicPassNumber: outText(packet.publicPassNumber, 50), locationName: outText(packet.locationName, 150),
        validFromUtc: packet.validFromUtc as string, validUntilUtc: packet.validUntilUtc as string,
        employeeId: external ? null : outText(details.employeeId, 64), hostEmployeeId: external ? outText(details.hostEmployeeId, 64) : null,
        hostName: external ? outText(details.hostName, 200) : null, purpose: outText(details.purpose, 1000), assignedProjects: projects, assignedProjectCount: Number(details.assignedProjectCount) };
      if (packet.projectName !== undefined) data.projectName = outText(packet.projectName, 200);
      artifact = await this.#renderer.render(data, photo, mime, credential);
      const p = { ...parameters, ArtifactDigest: parameter('binary', createHash('sha256').update(artifact).digest()) };
      const completed = await call(this.#repository, 'gp.FinishPassRender', p); output(completed.status === 'RENDERED' && outUuid(completed.printJobId) === id);
      const dispatched = await call(this.#repository, 'gp.DispatchPassPrint', p); output(dispatched.status === 'DISPATCHED' && outUuid(dispatched.printJobId) === id);
      if (dispatched.firstDispatch !== true) throw new PassPrintError('CONFLICT');
      return { printJobId: id, bytes: artifact, mimeType: 'image/svg+xml', cacheControl: 'private, no-store', contentTypeOptions: 'nosniff' };
    } catch (error) {
      artifact?.fill(0);
      if (begun) { try { await call(this.#repository, 'gp.FailPassPrint', { ...parameters, FailureCode: parameter('text', failure) }); } catch { /* No state overwrite after lease loss/handoff. */ } }
      if (error instanceof PassPrintError) throw error; throw new PassPrintError('UNAVAILABLE');
    } finally { photo?.fill(0); rawQr?.fill(0); }
  }
}
