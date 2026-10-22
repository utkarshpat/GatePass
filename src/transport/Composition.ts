import {EmailPublicRoutes} from './EmailPublicRoutes.ts';
import {createOutlookActionHandler} from './OutlookActionHandler.ts';
import {OutlookDecisionService} from '../email/OutlookDecisionService.ts';
import type {loadOutlookActions} from '../email/OutlookConfiguration.ts';
import type {OwnDigitalIdCardService} from '../printing/OwnDigitalIdCardService.ts';
import {EmailWorkflowService} from '../email/EmailWorkflowService.ts';
import type {EmailLinkCodec} from '../email/EmailLinkCodec.ts';
import { GuardAuthService } from '../security/GuardAuthService.ts';
import { SqlGuardAuthRepository } from '../security/SqlGuardAuthRepository.ts';
import { VisitReadService } from '../visits/VisitReadService.ts';
import { SqlVisitReadRepository } from '../visits/SqlVisitReadRepository.ts';
import { GuardDutyService } from '../visits/GuardDutyService.ts';
import { GuardWorkspaceService } from '../visits/GuardWorkspaceService.ts';
import { VisitCancellationService, SqlVisitCancellationRepository } from '../visits/VisitCancellationService.ts';
import { StaffAdministrationService, SqlStaffAdministrationRepository } from '../administration/StaffAdministrationService.ts';
import { AdministrationReadService, SqlAdministrationReadRepository } from '../administration/AdministrationReadService.ts';
import { createApiHandler } from './ApiHandler.ts';
import type { ApiAction } from './ApiHandler.ts';
import { connectSql } from './SqlProcedureClient.ts';
import type { DatabaseIdentity } from './SqlProcedureClient.ts';
import type { ReadSqlClient } from '../visits/SqlVisitReadRepository.ts';
import { RegistrationService } from '../registration/RegistrationService.ts';
import { SqlRegistrationRepository } from '../registration/SqlRegistrationRepository.ts';
import type { QrKeySource } from '../registration/QrCredentialEnvelope.ts';
import type { PhotoNormalizer, PrivatePhotoStore } from '../registration/RegistrationPhoto.ts';
import { RegistrationHttpRoutes } from './RegistrationHttpRoutes.ts';
import type { EmployeeSsoGate } from './RegistrationHttpRoutes.ts';

export type RegistrationDependencies = { cookieKey: Buffer; keys: QrKeySource; normalizer: PhotoNormalizer; photos: PrivatePhotoStore; sso?: EmployeeSsoGate };
export async function composeApi(config: { origin: string; sourceKey: Buffer; api: DatabaseIdentity; auth: DatabaseIdentity; registration?: RegistrationDependencies; emailLinks?:EmailLinkCodec; emailCards?:Pick<OwnDigitalIdCardService,'image'>; outlook?:NonNullable<Awaited<ReturnType<typeof loadOutlookActions>>>&{database:DatabaseIdentity} }) {
  if (config.api.user.toLowerCase() === config.auth.user.toLowerCase() || config.api.database !== config.auth.database || config.api.server !== config.auth.server || config.api.port !== config.auth.port) throw new Error('INVALID_IDENTITY_SEPARATION');
  if(config.outlook&&([config.api.user.toLowerCase(),config.auth.user.toLowerCase()].includes(config.outlook.database.user.toLowerCase())||['database','server','port'].some(k=>(config.outlook!.database as any)[k]!== (config.api as any)[k])||config.outlook.config.origin!==config.origin))throw new Error('INVALID_OUTLOOK_IDENTITY_SEPARATION');
  const api = await connectSql(config.api, 'api');
  let authClient;let outlookClient:Awaited<ReturnType<typeof connectSql>>|undefined;
  try {
    authClient = await connectSql(config.auth, 'auth');
    const auth = await GuardAuthService.create(new SqlGuardAuthRepository(authClient));
    const actions = createServiceActions(api,config.emailLinks);
    const registration = config.registration ? new RegistrationHttpRoutes(new RegistrationService(new SqlRegistrationRepository(api), config.registration.keys,
      config.registration.normalizer, config.registration.photos), config.registration.cookieKey, config.registration.sso) : undefined;
    const publicEmail=config.emailLinks?new EmailPublicRoutes(new EmailWorkflowService(api,config.emailLinks),config.emailCards):undefined;
    const extra=registration||publicEmail?{handles:(path:string)=>!!(registration?.handles(path)||publicEmail?.handles(path)),handle:async(req:import('node:http').IncomingMessage,res:import('node:http').ServerResponse)=>{const route=registration?.handles(req.url??'')?registration:publicEmail;if(!route)throw new Error('UNKNOWN_ROUTE');return route.handle(req,res);}}:undefined;
    const normal=createApiHandler({ origin: config.origin, sourceKey: config.sourceKey, auth, actions, registration:extra });
    if(config.outlook)outlookClient=await connectSql(config.outlook.database,'outlook');
    const outlook=config.outlook&&outlookClient?createOutlookActionHandler(new OutlookDecisionService(outlookClient,config.outlook.verifier,config.outlook.codec),config.outlook.config):undefined;
    return { handler: (req:import('node:http').IncomingMessage,res:import('node:http').ServerResponse)=>outlook&&req.url==='/api/outlook/decision'?outlook(req,res):normal(req,res),
      close: () => Promise.allSettled([api.close(), authClient!.close(),outlookClient?.close()]) };
  } catch (error) { await Promise.allSettled([api.close(), authClient?.close(),outlookClient?.close()]); throw error; }
}

/** Routes select a view; SQL still checks the session's current role and scope. */
export function createServiceActions(api: ReadSqlClient,links?:EmailLinkCodec): ReadonlyMap<string, ApiAction> {
    const email=new EmailWorkflowService(api,links);
    const reads = new VisitReadService(new SqlVisitReadRepository(api, 'api'));
    const duty = new GuardDutyService(api);
    const workspace = new GuardWorkspaceService(api);
    const cancellation = new VisitCancellationService(new SqlVisitCancellationRepository(api));
    const staff = new StaffAdministrationService(new SqlStaffAdministrationRepository(api));
    const admin = new AdministrationReadService(new SqlAdministrationReadRepository(api));
    const actions = new Map<string, ApiAction>();
    for (const view of ['OWN', 'HOST', 'GUARD', 'RECEPTION', 'ADMIN'] as const) {
      const prefix = '/api/' + view.toLowerCase();
      actions.set(prefix + '/visits/list', (session, body) => reads.list({ ...session, view }, body));
      actions.set(prefix + '/visits/detail', (session, body) => {
        const data = body as Record<string, unknown>;
        if (Object.keys(data).some(key => key !== 'visitRequestId')) throw Object.assign(new Error(), { code: 'INVALID_INPUT' });
        return reads.detail({ ...session, view }, data.visitRequestId);
      });
    }
    actions.set('/api/guard/context', (session, body) => {
      const data = body as Record<string, unknown>;
      if (data && typeof data === 'object' && Object.keys(data).length > 0) throw Object.assign(new Error(), { code: 'INVALID_INPUT' });
      return workspace.read(session);
    });
    actions.set('/api/guard/contexts', (session, body) => {
      const data = body as Record<string, unknown>;
      if (Object.keys(data).some(key => key !== 'locationId')) throw Object.assign(new Error(), { code: 'INVALID_INPUT' });
      return reads.workContexts({ ...session, view: 'GUARD' }, data.locationId);
    });
    actions.set('/api/guard/duties',(session,body)=>duty.duties(session,body));
    actions.set('/api/guard/visitors',(session,body)=>duty.visitors(session,body));
    actions.set('/api/admin/common-duties',(session,body)=>duty.administration(session,body));
    actions.set('/api/admin/common-duty',(session,body)=>duty.manage(session,body));
    actions.set('/api/guard/verify', (session, body) => duty.detail(session, body));
    actions.set('/api/guard/detail', async (session, body) => {
      const result = await duty.detail(session, body);
      if (!result.visit) throw Object.assign(new Error(), { code: 'NOT_AUTHORIZED' });
      return result.visit;
    });
    actions.set('/api/guard/movement', (session, body) => duty.movement(session, body));
    actions.set('/api/email/host/detail',(session,body)=>email.detail(session,body,'HOST'));
    actions.set('/api/email/host/decide',(session,body)=>email.decide(session,body));
    actions.set('/api/email/request/detail',(session,body)=>email.detail(session,body,'OWN'));
    actions.set('/api/email/external/detail',(_session,body)=>email.external(body));
    actions.set('/api/visits/cancel', (session, body) => cancellation.cancel(session, body));
    for (const method of ['projects', 'guards', 'subjects', 'roles', 'summary', 'audit'] as const)
      actions.set('/api/admin/' + method, (session, body) => admin[method](session, body));
    for (const method of ['allocate', 'deallocate', 'grant', 'revoke'] as const)
      actions.set('/api/admin/staff/' + method, (session, body) => staff[method](session, body));
    return actions;
}
