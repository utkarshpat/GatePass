import { GuardAuthService } from '../security/GuardAuthService.ts';
import { SqlGuardAuthRepository } from '../security/SqlGuardAuthRepository.ts';
import { VisitReadService } from '../visits/VisitReadService.ts';
import { SqlVisitReadRepository } from '../visits/SqlVisitReadRepository.ts';
import { GuardMovementService, SqlGuardMovementRepository } from '../visits/GuardMovementService.ts';
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
export async function composeApi(config: { origin: string; sourceKey: Buffer; api: DatabaseIdentity; auth: DatabaseIdentity; registration?: RegistrationDependencies }) {
  if (config.api.user.toLowerCase() === config.auth.user.toLowerCase() || config.api.database !== config.auth.database || config.api.server !== config.auth.server || config.api.port !== config.auth.port) throw new Error('INVALID_IDENTITY_SEPARATION');
  const api = await connectSql(config.api, 'api');
  let authClient;
  try {
    authClient = await connectSql(config.auth, 'auth');
    const auth = await GuardAuthService.create(new SqlGuardAuthRepository(authClient));
    const actions = createServiceActions(api);
    const registration = config.registration ? new RegistrationHttpRoutes(new RegistrationService(new SqlRegistrationRepository(api), config.registration.keys,
      config.registration.normalizer, config.registration.photos), config.registration.cookieKey, config.registration.sso) : undefined;
    return { handler: createApiHandler({ origin: config.origin, sourceKey: config.sourceKey, auth, actions, registration }),
      close: () => Promise.allSettled([api.close(), authClient!.close()]) };
  } catch (error) { await Promise.allSettled([api.close(), authClient?.close()]); throw error; }
}

/** Routes select a view; SQL still checks the session's current role and scope. */
export function createServiceActions(api: ReadSqlClient): ReadonlyMap<string, ApiAction> {
    const reads = new VisitReadService(new SqlVisitReadRepository(api, 'api'));
    const movement = new GuardMovementService(new SqlGuardMovementRepository(api));
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
    actions.set('/api/guard/contexts', (session, body) => {
      const data = body as Record<string, unknown>;
      if (Object.keys(data).some(key => key !== 'locationId')) throw Object.assign(new Error(), { code: 'INVALID_INPUT' });
      return reads.workContexts({ ...session, view: 'GUARD' }, data.locationId);
    });
    actions.set('/api/guard/verify', (session, body) => reads.verify({ ...session, view: 'GUARD' }, body));
    actions.set('/api/guard/movement', (session, body) => movement.record(session, body));
    actions.set('/api/visits/cancel', (session, body) => cancellation.cancel(session, body));
    for (const method of ['projects', 'guards', 'subjects', 'roles', 'summary', 'audit'] as const)
      actions.set('/api/admin/' + method, (session, body) => admin[method](session, body));
    for (const method of ['allocate', 'deallocate', 'grant', 'revoke'] as const)
      actions.set('/api/admin/staff/' + method, (session, body) => staff[method](session, body));
    return actions;
}
