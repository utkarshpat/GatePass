import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { cookies, HttpFailure, readJsonBody, token } from '../transport/ApiHandler.ts';
import type { AdditionalHttpRoutes, Session } from '../transport/ApiHandler.ts';
import { DummyEmployeeSso, requireDummySso } from './DummyEmployeeSso.ts';

export function dummyPasswordValid(password:unknown){
 requireDummySso();if(typeof password!=='string'||password.length>128)return false;
 return timingSafeEqual(createHash('sha256').update(password).digest(),createHash('sha256').update('Sopra@123').digest());
}
const paths = ['/api/dev/sso/employees', '/api/dev/sso/login', '/api/dev/sso/me', '/api/dev/sso/touch', '/api/dev/sso/logout'];
export class DummySsoRoutes implements AdditionalHttpRoutes {
  #sso: DummyEmployeeSso;
  #localHttp: boolean;
  constructor(sso: DummyEmployeeSso, options: { localHttp?: boolean } = {}) { requireDummySso(); this.#sso = sso; this.#localHttp = options.localHttp === true; }
  #names() { return this.#localHttp ? { session: 'gp-dev-session', csrf: 'gp-dev-csrf' } : { session: '__Host-gp-session', csrf: '__Host-gp-csrf' }; }
  #cookies(session: string, csrf: string, clear = false) {
    const names=this.#names();const attributes=`; Path=/; SameSite=Strict${this.#localHttp?'':'; Secure'}${clear?'; Max-Age=0':''}`;
    return [`${names.session}=${session}${attributes}; HttpOnly`,`${names.csrf}=${csrf}${attributes}`];
  }
  handles(path: string) { return paths.includes(path); }
  #session(req: IncomingMessage): Session {
    const jar = cookies(req.headers.cookie); const names=this.#names(); const sessionToken = jar[names.session]; const csrfToken = req.headers['x-csrf-token'];
    if (!token(sessionToken)) throw new HttpFailure(401);
    if (!token(csrfToken) || !token(jar[names.csrf]) || !timingSafeEqual(Buffer.from(csrfToken), Buffer.from(jar[names.csrf]))) throw new HttpFailure(403);
    return { sessionToken, csrfToken };
  }
  async handle(req: IncomingMessage, res: ServerResponse) {
    requireDummySso();
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) throw new HttpFailure(403);
    const path = req.url ?? ''; if (!this.handles(path)) throw new HttpFailure(404);
    const input = await readJsonBody(req);
    if (path === paths[1]) {
      // Shared credential belongs exclusively to the explicitly gated local dummy provider.
      if(!dummyPasswordValid(input.password))throw new HttpFailure(401);
      delete input.password;
      if(Object.hasOwn(input,'email')){
        if(Object.keys(input).length!==1||typeof input.email!=='string'||input.email.length>320)throw new HttpFailure(400);
        const matched=(await this.#sso.list()).find(person=>person.officialEmail.toLowerCase()===String(input.email).trim().toLowerCase());
        if(!matched)throw new HttpFailure(401);
        delete input.email;input.employeeId=matched.employeeId;
      }
      if (Object.keys(input).some(k => k !== 'employeeId') || typeof input.employeeId !== 'string' || !/^EMP[0-9]{3}$/u.test(input.employeeId)) throw new HttpFailure(400);
      let previous: Session | undefined; try { previous = cookies(req.headers.cookie)[this.#names().session] ? this.#session(req) : undefined; } catch { /* Stale cleanup */ }
      const result = await this.#sso.signIn(input.employeeId);
      if (previous) await this.#sso.sessionAction('logout', previous).catch(() => {});
      res.setHeader('Set-Cookie', this.#cookies(result.sessionToken,result.csrfToken));
      return { developmentOnly: true, employee: result.employee, csrfToken: result.csrfToken, idleExpiresAtUtc: result.idleExpiresAtUtc, absoluteExpiresAtUtc: result.absoluteExpiresAtUtc };
    }
    if (Object.keys(input).length) throw new HttpFailure(400);
    if (path === paths[0]) return { developmentOnly: true, employees: await this.#sso.list() };
    const session = this.#session(req);
    if (path === paths[2]) { const employee = await this.#sso.current(session); if (!employee) throw new HttpFailure(401); return { developmentOnly: true, employee }; }
    const result = await this.#sso.sessionAction(path === paths[3] ? 'touch' : 'logout', session);
    if (path === paths[4]) res.setHeader('Set-Cookie', this.#cookies('','',true));
    if (!result.ok) throw new HttpFailure(401);
    return { developmentOnly: true, ok: true };
  }
}
