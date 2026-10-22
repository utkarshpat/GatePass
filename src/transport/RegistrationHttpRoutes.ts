import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RegistrationService, RegistrationContext, ProductRequestType } from '../registration/RegistrationService.ts';
import { cookies, HttpFailure, readJsonBody, token } from './ApiHandler.ts';
import type { AdditionalHttpRoutes, Session } from './ApiHandler.ts';
import { registrationDates } from '../registration/RegistrationDates.ts';

/** Deployment implements this against trusted SSO session provenance, never directory data or JSON. */
export interface EmployeeSsoGate { verify(session: Session): Promise<boolean> }
type Service = Pick<RegistrationService, 'start' | 'recordPhoto' | 'submit'> & Partial<Pick<RegistrationService,'locations'|'options'>>;
type CookieData = { intakeId: string; intakeToken: string; intakeCsrfToken: string; requestType: ProductRequestType; expires: number;officeCode?:string };
const paths = ['/api/registration/start', '/api/registration/photo', '/api/registration/submit', '/api/registration/reset', '/api/registration/locations','/api/registration/options'];
const types = ['EXTERNAL', 'DIGITAL_ID', 'EMPLOYEE_PROJECT'];
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** One active intake per browser. SQL owns expiry/ownership/idempotency; cookie signatures only protect transport context. */
export class RegistrationHttpRoutes implements AdditionalHttpRoutes {
  #service: Service; #key: Buffer; #sso?: EmployeeSsoGate;
  #buckets = new Map<string, { start: number; starts: number; photos: number; submits: number }>();
  #active = 0;
  #localHttp:boolean;#types:ProductRequestType[];
  #office?: (req:IncomingMessage)=>string;
  #surface:'PUBLIC'|'RECEPTION';
  #submitted?: (req:IncomingMessage,context:RegistrationContext,result:unknown)=>Promise<void>;
  constructor(service: Service, cookieKey: Buffer, sso?: EmployeeSsoGate, options:{localHttp?:boolean;allowedTypes?:ProductRequestType[];office?:(req:IncomingMessage)=>string;surface?:'PUBLIC'|'RECEPTION';submitted?:(req:IncomingMessage,context:RegistrationContext,result:unknown)=>Promise<void>}={}) {
    if (!Buffer.isBuffer(cookieKey) || cookieKey.length < 32) throw new Error('INVALID_INTAKE_COOKIE_KEY');
    this.#service = service; this.#key = Buffer.from(cookieKey); this.#sso = sso;
    this.#office=options.office;
    this.#surface=options.surface??'PUBLIC';this.#submitted=options.submitted;
    this.#localHttp=options.localHttp===true;this.#types=[...(options.allowedTypes??types)] as ProductRequestType[];
    if(!this.#types.length||this.#types.some(t=>!types.includes(t)))throw new Error('INVALID_REGISTRATION_TYPES');
    this.#guard();
  }
  #guard(req?:IncomingMessage){if(this.#localHttp&&(!['development','test'].includes(process.env.NODE_ENV??'')||process.env.GATEPASS_SSO_MODE!=='dummy'||process.env.GATEPASS_DIRECTORY_MODE!=='mock'
    ||req&&!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'')))throw new HttpFailure(403);}
  #names(){if(this.#surface==='RECEPTION'){const prefix=this.#localHttp?'gp-reception':'__Host-gp-reception';return{intake:prefix+'-intake',csrf:prefix+'-intake-csrf',session:prefix+'-session',sessionCsrf:prefix+'-csrf'};}return this.#localHttp?{intake:'gp-dev-intake',csrf:'gp-dev-intake-csrf',session:'gp-dev-session',sessionCsrf:'gp-dev-csrf'}:{intake:'__Host-gp-intake',csrf:'__Host-gp-intake-csrf',session:'__Host-gp-session',sessionCsrf:'__Host-gp-csrf'};}
  #attributes(){return `; Path=/; SameSite=Strict${this.#localHttp?'':'; Secure'}`;}
  handles(path: string) { return paths.includes(path); }
  #mac(value: string) { return createHmac('sha256', this.#key).update('GatePass|intake|v1|').update(value).digest('base64url'); }
  #decode(value: unknown): CookieData {
    if (typeof value !== 'string' || value.length > 2048) throw new HttpFailure(403);
    const parts = value.split('.');
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/u.test(parts[0]) || !token(parts[1]) || !same(parts[1], this.#mac(parts[0]))) throw new HttpFailure(403);
    let data: CookieData;
    try { data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { throw new HttpFailure(403); }
    if (!data || !uuid.test(data.intakeId) || !token(data.intakeToken) || !token(data.intakeCsrfToken) || !this.#types.includes(data.requestType)
      || !Number.isSafeInteger(data.expires) || Date.now() >= data.expires || data.expires > Date.now() + 3600000) throw new HttpFailure(403);
    return data;
  }
  #setCookies(res: ServerResponse, data: CookieData) {
    const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
    const age = Math.max(1, Math.floor((data.expires - Date.now()) / 1000));
    const names=this.#names();const attrs=this.#attributes();
    res.setHeader('Set-Cookie', [`${names.intake}=${payload}.${this.#mac(payload)}${attrs}; HttpOnly; Max-Age=${age}`,`${names.csrf}=${data.intakeCsrfToken}${attrs}; Max-Age=${age}`]);
  }
  #csrf(req: IncomingMessage, jar: Record<string, string>, data: CookieData) {
    const header = req.headers['x-intake-csrf-token']; const csrf = jar[this.#names().csrf];
    if (!token(header) || !token(csrf) || !same(header, csrf) || !same(header, data.intakeCsrfToken)) throw new HttpFailure(403);
  }
  async #employee(req: IncomingMessage, jar: Record<string, string>): Promise<Session> {
    if (!this.#sso) throw new HttpFailure(503);
    const names=this.#names();const sessionToken = jar[names.session]; const csrfToken = req.headers['x-csrf-token'];
    if (!token(sessionToken)) throw new HttpFailure(401);
    if (!token(csrfToken) || !token(jar[names.sessionCsrf]) || !same(csrfToken, jar[names.sessionCsrf])) throw new HttpFailure(403);
    const session = { sessionToken, csrfToken };
    if (!await this.#sso.verify(session)) throw new HttpFailure(403);
    return session;
  }
  #budget(req: IncomingMessage, action: 'starts' | 'photos' | 'submits') {
    const now = Date.now();
    for (const [key, value] of this.#buckets) if (now - value.start >= 3600000) this.#buckets.delete(key);
    const source = createHmac('sha256', this.#key).update('GatePass|intake-source|').update(req.socket.remoteAddress ?? 'unknown').digest('hex');
    let bucket = this.#buckets.get(source);
    if (!bucket) { if (this.#buckets.size >= 4096) throw new HttpFailure(429); bucket = { start: now, starts: 0, photos: 0, submits: 0 }; this.#buckets.set(source, bucket); }
    // Single-process admission only. Corporate NAT limits require deployment-specific tuning.
    const limit = { starts: 120, photos: 600, submits: 240 }[action];
    if (bucket[action] >= limit) throw new HttpFailure(429);
    bucket[action]++;
  }
  async handle(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
    this.#guard(req);
    if (!this.handles(req.url ?? '')) throw new HttpFailure(404);
    if (this.#active >= 4) throw new HttpFailure(429);
    this.#active++;
    try {
      const jar = cookies(req.headers.cookie);
      const names=this.#names();
      if (req.url === paths[3]) {
        if (Object.keys(await readJsonBody(req)).length) throw new HttpFailure(400);
        let current: CookieData | undefined;
        try { if (jar[names.intake]) current = this.#decode(jar[names.intake]); } catch { /* An expired/invalid capability can only be discarded. */ }
        if (current) this.#csrf(req, jar, current);
        res.setHeader('Set-Cookie', [`${names.intake}=${this.#attributes()}; HttpOnly; Max-Age=0`,`${names.csrf}=${this.#attributes()}; Max-Age=0`]);
        return { ok: true };
      }
      if (req.url === paths[0]) {
        this.#budget(req, 'starts');
        const input = await readJsonBody(req);
        if (Object.keys(input).some(key => key !== 'requestType') || !this.#types.includes(input.requestType as ProductRequestType)) throw new HttpFailure(400);
        // Replacing another active form is explicit: require its CSRF proof first.
        if (jar[names.intake]) this.#csrf(req, jar, this.#decode(jar[names.intake]));
        const requestType = input.requestType as ProductRequestType;
        const officeCode=this.#office?.(req);
        const employee = requestType === 'EXTERNAL' ? undefined : await this.#employee(req, jar);
        const result = await this.#service.start(requestType, employee);
        const data = { intakeId: result.context.intakeId, intakeToken: result.context.intakeToken, intakeCsrfToken: result.context.intakeCsrfToken,
          requestType, expires: Date.parse(result.expiresAtUtc),...(officeCode?{officeCode}:{}) };
        if (!uuid.test(data.intakeId) || !token(data.intakeToken) || !token(data.intakeCsrfToken) || !Number.isSafeInteger(data.expires) || data.expires <= Date.now() || data.expires > Date.now() + 3600000) throw new HttpFailure(503);
        this.#setCookies(res, data);
        return { intakeId: data.intakeId, requestType, expiresAtUtc: new Date(data.expires).toISOString() };
      }
      const data = this.#decode(jar[names.intake]); this.#csrf(req, jar, data);
      if(this.#office&&this.#office(req)!==data.officeCode)throw new HttpFailure(403);
      const context: RegistrationContext = { intakeId: data.intakeId, intakeToken: data.intakeToken, intakeCsrfToken: data.intakeCsrfToken, requestType: data.requestType };
      if (data.requestType !== 'EXTERNAL') context.employeeSession = await this.#employee(req, jar);
      if(req.url===paths[5]){
        this.#budget(req,'submits');
        const input=await readJsonBody(req);
        if(!this.#office||!data.officeCode||!this.#service.options||Object.keys(input).some(k=>!['projectLocationId','search'].includes(k)))throw new HttpFailure(400);
        return this.#service.options(context,data.officeCode,input.projectLocationId??null,input.search??null);
      }
      if(req.url===paths[4]){
        if(Object.keys(await readJsonBody(req)).length)throw new HttpFailure(400);
        if(!this.#service.locations)throw new HttpFailure(404);
        return this.#service.locations(context);
      }
      if (req.url === paths[1]) {
        this.#budget(req, 'photos');
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(req.headers['content-type'] ?? '') || req.headers['content-encoding']) throw new HttpFailure(415);
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 5242880) throw new HttpFailure(413); chunks.push(chunk); }
        if (!size) throw new HttpFailure(400);
        const photo = Buffer.concat(chunks);
        try { return await this.#service.recordPhoto(context, photo); } finally { photo.fill(0); }
      }
      this.#budget(req, 'submits');
      const input = await readJsonBody(req);
      if(this.#office){
        if(!data.officeCode||!this.#service.options)throw new HttpFailure(503);
        if(['locationId','validFromUtc','validUntilUtc'].some(k=>Object.hasOwn(input,k)))throw new HttpFailure(400);
        const options=await this.#service.options(context,data.officeCode);
        const dates=registrationDates(data.requestType,input.visitDate,options.currentDate,options.maxVisitDate);
        delete input.visitDate;
        const result=await this.#service.submit(context,{...input,locationId:options.locationId,...dates});
        await this.#submitted?.(req,context,result);return result;
      }
      return await this.#service.submit(context, input);
      // Keep the same cookie after submission so a lost-response retry uses the same clientKey/intake.
    } finally { this.#active--; }
  }
}
