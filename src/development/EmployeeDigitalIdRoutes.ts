import { OwnCardError } from '../printing/OwnDigitalIdCardService.ts';
import type { OwnDigitalIdCardService } from '../printing/OwnDigitalIdCardService.ts';
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { cookies, HttpFailure, readJsonBody, token } from '../transport/ApiHandler.ts';
import type { AdditionalHttpRoutes } from '../transport/ApiHandler.ts';
import type { DummyEmployeeSso } from './DummyEmployeeSso.ts';
import { requireDummySso } from './DummyEmployeeSso.ts';
import type { VisitReadService } from '../visits/VisitReadService.ts';

/** This local employee surface cannot choose a read scope or another person's identity. */
export class EmployeeDigitalIdRoutes implements AdditionalHttpRoutes {
  private sso: DummyEmployeeSso; private reads: VisitReadService; private cards?: OwnDigitalIdCardService;
  constructor(sso: DummyEmployeeSso, reads: VisitReadService, cards?: OwnDigitalIdCardService) { this.sso = sso; this.reads = reads; this.cards=cards; }
  handles(path: string) { return ['/api/employee/digital-id/detail','/api/employee/digital-id/image'].includes(path); }
  async handle(req: IncomingMessage, _res: ServerResponse) {
    requireDummySso();
    if (!this.handles(req.url ?? '')) throw new HttpFailure(404);
    const jar = cookies(req.headers.cookie);
    const sessionToken = jar['gp-dev-session']; const csrfToken = req.headers['x-csrf-token'];
    if (!token(sessionToken)) throw new HttpFailure(401);
    if (!token(csrfToken) || !token(jar['gp-dev-csrf']) || !timingSafeEqual(Buffer.from(csrfToken), Buffer.from(jar['gp-dev-csrf']))) throw new HttpFailure(403);
    const session = { sessionToken, csrfToken };
    if (!await this.sso.verify(session)) throw new HttpFailure(403);
    const input = await readJsonBody(req);
    if (Object.keys(input).length !== 1 || !Object.hasOwn(input, 'visitRequestId')) throw new HttpFailure(400);
    if(req.url==='/api/employee/digital-id/image'){
      if(!this.cards)throw new HttpFailure(503);
      try{return await this.cards.image(session,input.visitRequestId);}catch(error){throw new HttpFailure(error instanceof OwnCardError?error.status:503);}
    }
    const detail = await this.reads.detail({ ...session, view: 'OWN' }, input.visitRequestId);
    if (detail.requestType !== 'DIGITAL_ID') throw new HttpFailure(403);
    return detail;
  }
}
