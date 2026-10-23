import {visitorDetails} from './VisitorDetails.ts';
import { parsePhoneNumberFromString } from 'libphonenumber-js/mobile';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { prepareQrEnvelopes } from './QrCredentialEnvelope.ts';
import type { QrKeySource } from './QrCredentialEnvelope.ts';
import type { PhotoNormalizer, PrivatePhotoStore } from './RegistrationPhoto.ts';
import type { RegistrationParameter, RegistrationRepository } from './SqlRegistrationRepository.ts';

export type ProductRequestType = 'DIGITAL_ID' | 'EMPLOYEE_PROJECT' | 'EXTERNAL';
export type EmployeeSession = { sessionToken: string; csrfToken: string };
/** Internal transport context. The HTTP adapter extracts verified cookies/headers;
 * request JSON cannot supply EmployeeId/UserId or an authentication method assertion.
 */
export type RegistrationContext = { intakeId: string; intakeToken: string; intakeCsrfToken: string;
  requestType: ProductRequestType; employeeSession?: EmployeeSession };
export type SubmittedVisit = { clientPersonKey: string; visitRequestId: string; accessPassId: string; publicReference: string;
  publicPassNumber: string; status: 'APPROVED' | 'PENDING' | 'DENIED' | 'CANCELLED'; reused: boolean };
export type RegistrationResult = { status: 'SUBMITTED'; intakeId: string; requestType: ProductRequestType; visits: SubmittedVisit[] };
export class RegistrationError extends Error {
  code: 'INVALID_INPUT' | 'NOT_AUTHORIZED' | 'CONFLICT' | 'UNAVAILABLE';
  constructor(code: RegistrationError['code']) { super(code); this.code = code; }
}
const b = (value: Buffer | null): RegistrationParameter => ({ type: 'binary', value });
const t = (value: string | null): RegistrationParameter => ({ type: 'text', value });
const g = (value: string): RegistrationParameter => ({ type: 'guid', value });
const i = (value: number): RegistrationParameter => ({ type: 'int', value });
const digest = (value: Buffer): Buffer => createHash('sha256').update(value).digest();
const requireInput = (condition: unknown): void => { if (!condition) throw new RegistrationError('INVALID_INPUT'); };
const uuid = (value: unknown): string => {
  requireInput(typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value));
  return (value as string).toLowerCase();
};
const outputUuid = (value: unknown): string => {
  try { return uuid(value); } catch { throw new RegistrationError('UNAVAILABLE'); }
};
const tokenHash = (value: unknown): Buffer => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value)) throw new RegistrationError('NOT_AUTHORIZED');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== 32 || bytes.toString('base64url') !== value) throw new RegistrationError('NOT_AUTHORIZED');
  return digest(bytes);
};
const string = (value: unknown, maximum: number, optional = false): string | null => {
  if (optional && (value === undefined || value === null)) return null;
  requireInput(typeof value === 'string' && value.isWellFormed() && value.length > 0 && value.length <= maximum && value.trim().length > 0 && !value.includes('\0'));
  return value as string;
};
const object = (value: unknown, allowed: string[]): Record<string, unknown> => {
  requireInput(!!value && typeof value === 'object' && !Array.isArray(value));
  const record = value as Record<string, unknown>;
  requireInput([Object.prototype, null].includes(Object.getPrototypeOf(record)) && Object.keys(record).every(key => allowed.includes(key)));
  return record;
};
function productType(value: unknown): ProductRequestType {
  requireInput(typeof value === 'string' && ['DIGITAL_ID', 'EMPLOYEE_PROJECT', 'EXTERNAL'].includes(value));
  return value as ProductRequestType;
}

export class RegistrationService {
  #repository: RegistrationRepository; #keys: QrKeySource; #normalizer: PhotoNormalizer; #photos: PrivatePhotoStore;
  constructor(repository: RegistrationRepository, keys: QrKeySource, normalizer: PhotoNormalizer, photos: PrivatePhotoStore) {
    this.#repository = repository; this.#keys = keys; this.#normalizer = normalizer; this.#photos = photos;
  }
  #identity(context: RegistrationContext): Record<string, RegistrationParameter> {
    const type = productType(context.requestType);
    if (type !== 'EXTERNAL' && !context.employeeSession) throw new RegistrationError('NOT_AUTHORIZED');
    if (type === 'EXTERNAL' && context.employeeSession) throw new RegistrationError('NOT_AUTHORIZED');
    return { IntakeId: g(uuid(context.intakeId)), TokenHash: b(tokenHash(context.intakeToken)), IntakeCsrfHash: b(tokenHash(context.intakeCsrfToken)),
      SessionHash: b(context.employeeSession ? tokenHash(context.employeeSession.sessionToken) : null),
      CsrfHash: b(context.employeeSession ? tokenHash(context.employeeSession.csrfToken) : null) };
  }
  async #call(name: string, parameters: Record<string, RegistrationParameter>): Promise<Record<string, unknown>> {
    try { return await this.#repository.execute(name, parameters); }
    catch (error) {
      const number = (error as { number?: unknown })?.number;
      if ([52001, 52701].includes(Number(number))) throw new RegistrationError('NOT_AUTHORIZED');
      if (number === 52703) throw new RegistrationError('CONFLICT');
      if (number === 52702) throw new RegistrationError('INVALID_INPUT');
      throw new RegistrationError('UNAVAILABLE');
    }
  }
  /** Return only to the trusted cookie adapter; raw intake capabilities never enter public JSON/logs. */
  async start(requestType: ProductRequestType, employeeSession?: EmployeeSession): Promise<{ context: RegistrationContext; expiresAtUtc: string }> {
    const context: RegistrationContext = { intakeId: randomUUID(), intakeToken: randomBytes(32).toString('base64url'),
      intakeCsrfToken: randomBytes(32).toString('base64url'), requestType: productType(requestType), employeeSession };
    const result = await this.#call('gp.CreateRegistrationIntake', { ...this.#identity(context), IntakeType: t(requestType === 'EXTERNAL' ? 'PUBLIC' : 'EMPLOYEE') });
    if (outputUuid(result.intakeId) !== context.intakeId || typeof result.expiresAtUtc !== 'string') throw new RegistrationError('UNAVAILABLE');
    return { context, expiresAtUtc: result.expiresAtUtc.endsWith('Z') ? result.expiresAtUtc : result.expiresAtUtc + 'Z' };
  }
  async recordPhoto(context: RegistrationContext, input: Buffer): Promise<{ photoAssetId: string }> {
    const identity = this.#identity(context);
    const intake = await this.#call('gp.CreateRegistrationIntake', { ...identity, IntakeType: t(context.requestType === 'EXTERNAL' ? 'PUBLIC' : 'EMPLOYEE') });
    if (intake.status !== 'DRAFT') throw new RegistrationError('CONFLICT');
    let photo;
    try { photo = await this.#normalizer.normalize(input); }
    catch { throw new RegistrationError('INVALID_INPUT'); }
    const photoAssetId = randomUUID();
    const storageKey = `intakes/${context.intakeId.replaceAll('-', '').toLowerCase()}/${photoAssetId.replaceAll('-', '')}.jpg`;
    if (!Buffer.isBuffer(photo.bytes) || photo.mimeType !== 'image/jpeg' || photo.bytes.length === 0 || photo.bytes.length > 5242880 ||
        !Number.isInteger(photo.width) || !Number.isInteger(photo.height) || photo.width < 1 || photo.height < 1 || photo.width > 4096 || photo.height > 4096 || photo.width * photo.height > 16000000) throw new RegistrationError('INVALID_INPUT');
    try { await this.#photos.putIfAbsent(storageKey, photo.bytes); } catch { throw new RegistrationError('UNAVAILABLE'); }
    // Retain a staged file on an uncertain SQL outcome. Blind deletion after a
    // timeout could remove a photo whose metadata actually committed. TTL GC must
    // reconcile unreferenced files and intake metadata under a separate policy.
    const result = await this.#call('gp.RecordRegistrationPhoto', { ...identity, PhotoAssetId: g(photoAssetId),
      ContentHash: b(digest(photo.bytes)), MimeType: t(photo.mimeType), ByteLength: i(photo.bytes.length), PixelWidth: i(photo.width), PixelHeight: i(photo.height) });
    if (outputUuid(result.photoAssetId) !== photoAssetId || result.storageKey !== storageKey) throw new RegistrationError('UNAVAILABLE');
    return { photoAssetId };
  }
  async locations(context: RegistrationContext): Promise<{locations:{locationId:number;locationCode:string;locationName:string}[]}> {
    const result=await this.#call('gp.ListRegistrationLocations',this.#identity(context));
    if(!Array.isArray(result.locations)||result.locations.length>100)throw new RegistrationError('UNAVAILABLE');
    const ids=new Set<number>();
    const locations=result.locations.map(value=>{
      const row=value as Record<string,unknown>;
      if(!row||!Number.isInteger(row.locationId)||Number(row.locationId)<1||Number(row.locationId)>2147483647||ids.has(Number(row.locationId))
        ||typeof row.locationCode!=='string'||!/^[A-Z][A-Z0-9_]{0,15}$/u.test(row.locationCode)||typeof row.locationName!=='string'||row.locationName.length<1||row.locationName.length>100||/[\u0000-\u001f\u007f]/u.test(row.locationName))throw new RegistrationError('UNAVAILABLE');
      ids.add(Number(row.locationId));return{locationId:Number(row.locationId),locationCode:row.locationCode,locationName:row.locationName};
    });return{locations};
  }
  async options(context: RegistrationContext, locationCode: string, projectLocationId: unknown = null, search: unknown = null) {
    requireInput(['NOIDA','BENGALURU','CHENNAI','PUNE'].includes(locationCode));
    requireInput(projectLocationId === null || typeof projectLocationId === 'string' && /^[1-9][0-9]{0,18}$/u.test(projectLocationId) && BigInt(projectLocationId)<=9223372036854775807n);
    requireInput(search === null || projectLocationId !== null && typeof search === 'string' && search.trim().length>=2 && search.length<=100 && !/[\u0000-\u001f\u007f]/u.test(search));
    const result=await this.#call('gp.GetRegistrationOptions',{...this.#identity(context),LocationCode:t(locationCode),ProjectLocationId:{type:'bigint',value:projectLocationId as string|null},Search:t(search as string|null)});
    if(!Number.isInteger(result.locationId)||Number(result.locationId)<1||result.locationCode!==locationCode||typeof result.locationName!=='string'||result.locationName.length>100
      ||typeof result.currentDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/u.test(result.currentDate)||typeof result.maxVisitDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/u.test(result.maxVisitDate)
      ||typeof result.digitalIdEligible!=='boolean'||!Array.isArray(result.projects)||result.projects.length>100||!Array.isArray(result.hosts)||result.hosts.length>10)throw new RegistrationError('UNAVAILABLE');
    const projects=(result.projects as Record<string,unknown>[]).map(row=>{
      if(!row||typeof row.assigned!=='boolean'||typeof row.projectLocationId!=='string'||!/^[1-9][0-9]{0,18}$/u.test(row.projectLocationId)||typeof row.projectCode!=='string'||row.projectCode.length>80||typeof row.projectName!=='string'||row.projectName.length>200)throw new RegistrationError('UNAVAILABLE');
      return {projectLocationId:row.projectLocationId,projectCode:row.projectCode,projectName:row.projectName,assigned:row.assigned===true};
    });
    const hosts=(result.hosts as Record<string,unknown>[]).map(row=>{
      if(!row||typeof row.employeeId!=='string'||row.employeeId.length>64||typeof row.displayName!=='string'||row.displayName.length>200||typeof row.officialEmail!=='string'||!/^\S+@\S+\.\S+$/u.test(row.officialEmail))throw new RegistrationError('UNAVAILABLE');
      return {employeeId:row.employeeId,displayName:row.displayName,officialEmail:row.officialEmail};
    });
    return {locationId:Number(result.locationId),locationCode,locationName:result.locationName,currentDate:result.currentDate,maxVisitDate:result.maxVisitDate,digitalIdEligible:result.digitalIdEligible===true,projects,hosts};
  }
  async submit(context: RegistrationContext, input: unknown): Promise<RegistrationResult> {
    const data = object(input, ['clientKey', 'requestType', 'locationId', 'reason', 'people', 'projectLocationId', 'hostEmployeeId', 'digitalIdReason', 'validFromUtc', 'validUntilUtc']);
    const requestType = productType(data.requestType); requireInput(requestType === context.requestType);
    requireInput(Number.isInteger(data.locationId) && Number(data.locationId) > 0 && Number(data.locationId) <= 2147483647);
    requireInput(Array.isArray(data.people) && data.people.length > 0 && data.people.length <= 50);
    const people = (data.people as unknown[]).map(value => {
      const person = object(value, ['clientPersonKey', 'photoAssetId', 'name', 'email', 'phone', 'companyName', 'deviceTypes']);
      let extras:ReturnType<typeof visitorDetails>;try{extras=visitorDetails(person.companyName,person.deviceTypes);}catch{throw new RegistrationError('INVALID_INPUT');}
      if(requestType!=='EXTERNAL')requireInput(person.companyName===undefined&&person.deviceTypes===undefined);
      const name = string(person.name, 200, true); const email = string(person.email, 320, true); const phone = string(person.phone, 30, true);
      if (requestType !== 'EXTERNAL') requireInput(name === null && email === null && phone === null);
      else requireInput(name !== null && phone !== null);
      if (name !== null) requireInput(!/[\u0000-\u001f\u007f]/u.test(name));
      if (email !== null) requireInput(/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) && !/[\u0000-\u001f\u007f]/u.test(email));
      if (phone !== null) {
        const parsed=parsePhoneNumberFromString(phone,{extract:false});
        requireInput(/^\+[1-9]\d{1,14}$/u.test(phone) && parsed?.isValid() === true && !parsed.ext);
      }
      return { clientPersonKey: uuid(person.clientPersonKey), photoAssetId: uuid(person.photoAssetId), personName: name, personEmail: email, personPhone: phone, ...extras };
    });
    requireInput(new Set(people.map(person => person.clientPersonKey)).size === people.length && new Set(people.map(person => person.photoAssetId)).size === people.length);
    if (requestType !== 'EXTERNAL') requireInput(people.length === 1);
    if (requestType === 'DIGITAL_ID') {
      requireInput(['FORGOT', 'LOST', 'OTHER'].includes(String(data.digitalIdReason)) && [data.projectLocationId, data.hostEmployeeId, data.validFromUtc, data.validUntilUtc].every(value => value === undefined || value === null));
    } else {
      requireInput(typeof data.projectLocationId === 'string' && /^[1-9][0-9]{0,18}$/u.test(data.projectLocationId) && BigInt(data.projectLocationId) <= 9223372036854775807n);
      requireInput(data.digitalIdReason === undefined || data.digitalIdReason === null);
      string(data.hostEmployeeId, 64);
      requireInput(typeof data.validFromUtc === 'string' && typeof data.validUntilUtc === 'string');
    }
    const parameters: Record<string, RegistrationParameter> = { ...this.#identity(context), ClientKey: g(uuid(data.clientKey)),
      RequestType: t(requestType === 'DIGITAL_ID' ? 'TEMP_ID' : requestType), LocationId: i(Number(data.locationId)), Reason: t(string(data.reason, 1000)), PeopleJson: t(JSON.stringify(people)),
      ProjectLocationId: { type: 'bigint', value: requestType === 'DIGITAL_ID' ? null : data.projectLocationId as string },
      HostEmployeeId: t(requestType === 'DIGITAL_ID' ? null : data.hostEmployeeId as string), TemporaryIdReason: t(requestType === 'DIGITAL_ID' ? data.digitalIdReason as string : null),
      ValidFromUtc: { type: 'datetime', value: requestType === 'DIGITAL_ID' ? null : data.validFromUtc as string },
      ValidUntilUtc: { type: 'datetime', value: requestType === 'DIGITAL_ID' ? null : data.validUntilUtc as string }, CredentialsJson: t(null) };
    let result = await this.#call('gp.SubmitRegistration', parameters);
    if (result.status === 'NEEDS_CREDENTIALS') {
      let credentials: RegistrationParameter;
      try { credentials = t(JSON.stringify(await prepareQrEnvelopes(people.map(person => person.clientPersonKey), this.#keys))); }
      catch { throw new RegistrationError('UNAVAILABLE'); }
      result = await this.#call('gp.SubmitRegistration', { ...parameters, CredentialsJson: credentials });
    }
    if (result.status !== 'SUBMITTED' || outputUuid(result.intakeId) !== uuid(context.intakeId) || result.requestType !== parameters.RequestType.value || !Array.isArray(result.visits) || result.visits.length !== people.length) throw new RegistrationError('UNAVAILABLE');
    const seen = new Set<string>();
    const visits: SubmittedVisit[] = result.visits.map(value => {
      const row = value as Record<string, unknown>;
      if (!row || typeof row !== 'object') throw new RegistrationError('UNAVAILABLE');
      const personKey = outputUuid(row.clientPersonKey);
      if (!people.some(person => person.clientPersonKey === personKey) || seen.has(personKey) ||
          typeof row.reused !== 'boolean' || !['APPROVED', 'PENDING', 'DENIED', 'CANCELLED'].includes(String(row.status)) ||
          typeof row.publicReference !== 'string' || !/^V-[0-9a-f]{32}$/u.test(row.publicReference) || typeof row.publicPassNumber !== 'string' || !/^GP-[0-9a-f]{32}$/u.test(row.publicPassNumber)) throw new RegistrationError('UNAVAILABLE');
      seen.add(personKey);
      return { clientPersonKey: personKey, visitRequestId: outputUuid(row.visitRequestId), accessPassId: outputUuid(row.accessPassId),
        publicReference: row.publicReference, publicPassNumber: row.publicPassNumber, status: row.status as SubmittedVisit['status'], reused: row.reused };
    });
    return { status: 'SUBMITTED', intakeId: uuid(context.intakeId), requestType, visits };
  }
}
