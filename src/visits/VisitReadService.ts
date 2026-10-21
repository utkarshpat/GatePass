import { createHash, timingSafeEqual } from 'node:crypto';
import { isDate, isUtc, isUuid } from './SqlVisitReadRepository.ts';
import type { ReadParameter, VisitReadRepository } from './SqlVisitReadRepository.ts';

export type ReadView = 'OWN' | 'HOST' | 'GUARD' | 'RECEPTION' | 'ADMIN';
/** Constructed by the trusted route/session adapter, never by spreading request JSON. */
export type ReadContext = { sessionToken: string; csrfToken: string; view: ReadView };
export interface PrivatePhotoReader { read(key: string, maximumBytes: number): Promise<Buffer> }
export class VisitReadError extends Error {
  code: 'INVALID_INPUT' | 'NOT_AUTHORIZED' | 'UNAVAILABLE';
  constructor(code: VisitReadError['code']) { super(code); this.code = code; }
}
const input = (ok: unknown) => { if (!ok) throw new VisitReadError('INVALID_INPUT'); };
const output = (ok: unknown) => { if (!ok) throw new VisitReadError('UNAVAILABLE'); };
const uuid = (value: unknown) => { input(isUuid(value)); return (value as string).toLowerCase(); };
const outUuid = (value: unknown) => { output(isUuid(value)); return (value as string).toLowerCase(); };
const outText = (value: unknown, max: number) => { output(typeof value === 'string' && value.length > 0 && value.length <= max && value.isWellFormed()); return value as string; };
const outTime = (value: unknown) => { output(isUtc(value)); return value as string; };
const integer = (value: unknown) => Number.isInteger(value) && Number(value) > 0 && Number(value) <= 2147483647;
const bigId = (value: unknown) => typeof value === 'string' && /^[1-9][0-9]{0,18}$/u.test(value) && BigInt(value) <= 9223372036854775807n;
const object = (value: unknown, keys: string[]) => {
  input(!!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const row = value as Record<string, unknown>; input(Object.keys(row).every(key => keys.includes(key))); return row;
};
const parameter = (type: ReadParameter['type'], value: ReadParameter['value']): ReadParameter => ({ type, value });
function token(value: unknown): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value)) throw new VisitReadError('NOT_AUTHORIZED');
  const bytes = Buffer.from(value, 'base64url');
  try {
    if (bytes.length !== 32 || bytes.toString('base64url') !== value) throw new VisitReadError('NOT_AUTHORIZED');
    return createHash('sha256').update(bytes).digest();
  } finally { bytes.fill(0); }
}
function identity(context: ReadContext) {
  input(['OWN', 'HOST', 'GUARD', 'RECEPTION', 'ADMIN'].includes(context.view));
  return { SessionHash: parameter('binary', token(context.sessionToken)), CsrfHash: parameter('binary', token(context.csrfToken)), View: parameter('text', context.view) };
}
async function call(repository: VisitReadRepository, name: string, parameters: Record<string, ReadParameter>) {
  try { return await repository.execute(name, parameters); }
  catch (error) {
    const number = (error as { number?: number })?.number;
    if ([52001, 52701, 52801].includes(Number(number))) throw new VisitReadError('NOT_AUTHORIZED');
    if (number === 52802) throw new VisitReadError('INVALID_INPUT');
    throw new VisitReadError('UNAVAILABLE');
  }
}
function row(value: unknown, context: ReadContext, detail = false) {
  output(!!value && typeof value === 'object' && !Array.isArray(value)); const source = value as Record<string, unknown>;
  output(['DIGITAL_ID', 'EMPLOYEE_PROJECT', 'EXTERNAL'].includes(String(source.requestType)) && ['PENDING', 'APPROVED', 'DENIED', 'CANCELLED'].includes(String(source.status))
    && ['PENDING', 'ACTIVE', 'DENIED', 'REVOKED'].includes(String(source.passStatus)) && typeof source.isInside === 'boolean' && integer(source.locationId));
  if (source.projectLocationId !== undefined) output(bigId(source.projectLocationId));
  const result: Record<string, unknown> = { visitRequestId: outUuid(source.visitRequestId), publicReference: outText(source.publicReference, 40),
    requestType: source.requestType, personName: outText(source.personName, 200), locationId: source.locationId, locationName: outText(source.locationName, 150),
    status: source.status, passStatus: source.passStatus, isInside: source.isInside, validFromUtc: outTime(source.validFromUtc), validUntilUtc: outTime(source.validUntilUtc) };
  if (source.projectLocationId !== undefined) { result.projectLocationId = source.projectLocationId; result.projectName = outText(source.projectName, 200); }
  if (detail) {
    result.accessPassId = outUuid(source.accessPassId); result.publicPassNumber = outText(source.publicPassNumber, 50); result.checkedAtUtc = outTime(source.checkedAtUtc);
    for (const key of ['photoAvailable', 'canDecide', 'canCancel', 'canEnter', 'canExit', 'canReconcileExit']) { output(typeof source[key] === 'boolean'); result[key] = source[key]; }
    if (context.view !== 'GUARD') result.reason = outText(source.reason, 1000);
    if (context.view === 'HOST') {
      output(source.snapshotVersion === 1 && typeof source.snapshotHash === 'string' && /^[0-9a-f]{64}$/iu.test(source.snapshotHash));
      result.snapshotVersion = 1; result.snapshotHash = source.snapshotHash;
    }
    output(source.movements === undefined || Array.isArray(source.movements) && source.movements.length <= 100);
    output(source.movementsHasMore === undefined || typeof source.movementsHasMore === 'boolean');
    result.movementsHasMore = ['GUARD','RECEPTION','ADMIN'].includes(context.view) && source.movementsHasMore === true;
    if (Array.isArray(source.movements) && ['GUARD','RECEPTION','ADMIN'].includes(context.view)) {
      output(!source.movementsHasMore || source.movements.length === 100);
      result.movements = source.movements.map(m => {
        output(!!m && typeof m === 'object' && !Array.isArray(m));
        const item = m as Record<string, unknown>;
        output(['ENTRY', 'EXIT'].includes(String(item.eventType)));
        output(['SCAN', 'MANUAL', 'RECONCILE'].includes(String(item.entryMethod)));
        return {
          accessEventId: (()=>{output(bigId(item.accessEventId));return item.accessEventId as string;})(),
          eventType: item.eventType,
          entryMethod: item.entryMethod,
          guardName: outText(item.guardName, 200),
          occurredAtUtc: outTime(item.occurredAtUtc),
        };
      });
    } else {
      result.movements = [];
    }
  }
  return result;
}
export class VisitReadService {
  #repository: VisitReadRepository;
  constructor(repository: VisitReadRepository) { this.#repository = repository; }
  async workContexts(context: ReadContext, locationId: unknown) {
    input(context.view === 'GUARD' && integer(locationId));
    const auth = identity(context); delete (auth as Record<string, ReadParameter>).View;
    const result = await call(this.#repository, 'gp.ListGuardWorkContexts', { ...auth, LocationId: parameter('int', Number(locationId)) });
    output(result.locationId === locationId && Array.isArray(result.projects) && typeof result.canHandleDigitalId === 'boolean');
    const projects = (result.projects as Record<string, unknown>[]).map(project => {
      output(!!project && bigId(project.projectLocationId));
      return { projectLocationId: project.projectLocationId as string, projectName: outText(project.projectName, 200) };
    });
    output(new Set(projects.map(project => project.projectLocationId)).size === projects.length);
    return { locationId: Number(locationId), projects, canHandleDigitalId: result.canHandleDigitalId as boolean, checkedAtUtc: outTime(result.checkedAtUtc) };
  }
  async list(context: ReadContext, value: unknown) {
    const data = object(value, ['queue', 'locationId', 'localVisitDate', 'projectLocationId', 'publicReference', 'pageSize', 'cursor']);
    const queue = data.queue ?? 'DAY'; const size = data.pageSize ?? 25;
    input(['DAY', 'PENDING', 'INSIDE'].includes(String(queue)) && Number.isInteger(size) && Number(size) >= 1 && Number(size) <= 50);
    input(data.locationId === undefined || integer(data.locationId)); input(['OWN', 'HOST'].includes(context.view) || integer(data.locationId));
    input(data.localVisitDate === undefined || isDate(data.localVisitDate)); input(queue !== 'INSIDE' || data.localVisitDate === undefined);
    input(data.projectLocationId === undefined || bigId(data.projectLocationId));
    input(data.publicReference === undefined || typeof data.publicReference === 'string' && data.publicReference.trim().length > 0 && data.publicReference.length <= 40);
    let afterTime: string | null = null; let afterId: string | null = null;
    if (data.cursor !== undefined) { const cursor = object(data.cursor, ['submittedAtUtc', 'visitRequestId']); input(isUtc(cursor.submittedAtUtc)); afterTime = cursor.submittedAtUtc as string; afterId = uuid(cursor.visitRequestId); }
    const result = await call(this.#repository, 'gp.ListVisits', { ...identity(context), Queue: parameter('text', String(queue)),
      LocationId: parameter('int', data.locationId as number ?? null), LocalVisitDate: parameter('date', data.localVisitDate as string ?? null),
      ProjectLocationId: parameter('bigint', data.projectLocationId as string ?? null), PublicReference: parameter('text', data.publicReference as string ?? null),
      PageSize: parameter('int', Number(size)), AfterSubmittedAtUtc: parameter('datetime', afterTime), AfterVisitRequestId: parameter('guid', afterId) });
    output(Array.isArray(result.visits) && result.visits.length <= Number(size) && typeof result.hasMore === 'boolean');
    const visits = (result.visits as unknown[]).map(value => row(value, context));
    output(new Set(visits.map(visit => visit.visitRequestId)).size === visits.length);
    const cursor = result.hasMore ? { submittedAtUtc: outTime(result.afterSubmittedAtUtc), visitRequestId: outUuid(result.afterVisitRequestId) } : null;
    return { visits, hasMore: result.hasMore as boolean, cursor, checkedAtUtc: outTime(result.checkedAtUtc) };
  }
  async detail(context: ReadContext, visitRequestId: unknown) {
    const id = uuid(visitRequestId);
    const result = row(await call(this.#repository, 'gp.GetVisitDetail', { ...identity(context), VisitRequestId: parameter('guid', id) }), context, true);
    output(result.visitRequestId === id); return result;
  }
  async verify(context: ReadContext, value: unknown) {
    input(context.view === 'GUARD'); const data = object(value, ['credential', 'locationId', 'correlationId', 'selectedProjectLocationId']); input(integer(data.locationId));
    input(data.selectedProjectLocationId === undefined || data.selectedProjectLocationId === null || bigId(data.selectedProjectLocationId));
    // Hash the opaque QR at the server boundary. SQL/logs never receive plaintext.
    const hash = token(data.credential); const auth = identity(context); delete (auth as Record<string, ReadParameter>).View;
    const result = await call(this.#repository, 'gp.VerifyGuardPass', { ...auth, CredentialHash: parameter('binary', hash), LocationId: parameter('int', Number(data.locationId)), CorrelationId: parameter('guid', uuid(data.correlationId)),
      SelectedProjectLocationId: parameter('bigint', data.selectedProjectLocationId as string ?? null) });
    if (result.outcome === 'NOT_AVAILABLE') return { outcome: 'NOT_AVAILABLE' };
    output(['VALID', 'PENDING', 'DENIED', 'EXPIRED', 'REVOKED', 'NOT_YET_VALID', 'NOT_AUTHORIZED', 'CANCELLED'].includes(String(result.outcome)));
    const visit = row(result.visit, context, true);
    output(visit.locationId === data.locationId && (data.selectedProjectLocationId == null || visit.projectLocationId === data.selectedProjectLocationId));
    return { outcome: result.outcome as string, visit };
  }
}

/** Internal binary-response path. Metadata is never returned in public JSON.
 * Resolve twice so permission loss during storage I/O prevents delivery. */
export class VisitPhotoService {
  #repository: VisitReadRepository; #store: PrivatePhotoReader;
  constructor(repository: VisitReadRepository, store: PrivatePhotoReader) { this.#repository = repository; this.#store = store; }
  async read(context: ReadContext, visitRequestId: unknown) {
    const parameters = { ...identity(context), VisitRequestId: parameter('guid', uuid(visitRequestId)) };
    const resolve = async () => {
      const photo = await call(this.#repository, 'gp.ResolveVisitPhoto', parameters);
      const id = outUuid(photo.photoAssetId); const key = outText(photo.storageKey, 400);
      const extension: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
      output(Object.hasOwn(extension, String(photo.mimeType)) && new RegExp(`^intakes/[0-9a-f]{32}/${id.replaceAll('-', '')}\\.${extension[String(photo.mimeType)]}$`, 'u').test(key)
        && typeof photo.contentHash === 'string' && /^[0-9a-f]{64}$/iu.test(photo.contentHash) && integer(photo.byteLength) && Number(photo.byteLength) <= 5242880);
      return { id, key, contentHash: photo.contentHash as string, mimeType: photo.mimeType as string, length: Number(photo.byteLength) };
    };
    const before = await resolve(); let bytes: Buffer;
    try { const source = await this.#store.read(before.key, before.length); output(Buffer.isBuffer(source) && source.length === before.length); bytes = Buffer.from(source); }
    catch { throw new VisitReadError('UNAVAILABLE'); }
    try {
      output(timingSafeEqual(createHash('sha256').update(bytes).digest(), Buffer.from(before.contentHash, 'hex')));
      const after = await resolve(); output(JSON.stringify(before) === JSON.stringify(after));
      return { bytes, mimeType: before.mimeType, cacheControl: 'private, no-store', contentTypeOptions: 'nosniff' };
    } catch (error) { bytes.fill(0); throw error; }
  }
}
