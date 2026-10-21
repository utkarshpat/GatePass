import {GuardAuthService} from './GuardAuthService.ts';
import type {GuardAuthRepository} from './GuardAuthService.ts';
import {SqlGuardAuthRepository} from './SqlGuardAuthRepository.ts';
import type {GuardAuthSqlClient} from './SqlGuardAuthRepository.ts';
/** Shared password engine; only the fixed generic-staff RPC contracts are selected. */
export class StaffAuthService {
 static create(repository:GuardAuthRepository){return GuardAuthService.create(repository,'Staff');}
}
export class SqlStaffAuthRepository extends SqlGuardAuthRepository {
 constructor(client:GuardAuthSqlClient){super(client,'Staff');}
}
