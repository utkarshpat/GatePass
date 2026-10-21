import {createRemoteJWKSet,jwtVerify} from 'jose';
import type {JWTVerifyGetKey} from 'jose';
import {isUuid} from '../visits/SqlVisitReadRepository.ts';
export const outlookActionsAppId='48af08dc-f6d2-435f-b2a7-069abd99c086';
export type OutlookTokenConfig={tenantId:string;applicationId:string;scope:string};
export type OutlookActor={tenantId:string;objectId:string};
export function validateOutlookTokenConfig(c:OutlookTokenConfig){if(!isUuid(c.tenantId)||!isUuid(c.applicationId)||!/^[A-Za-z][A-Za-z0-9.]{0,100}$/u.test(c.scope))throw new Error('INVALID_OUTLOOK_TOKEN_CONFIG');return c;}
/** Only the configured org's v2 Entra authority is accepted. EAT, email-name mapping and app-only tokens are rejected. */
export class OutlookActionTokenVerifier{
 #config:OutlookTokenConfig;#keys:JWTVerifyGetKey;
 constructor(config:OutlookTokenConfig,keys?:JWTVerifyGetKey){this.#config=validateOutlookTokenConfig(config);this.#keys=keys??createRemoteJWKSet(new URL('https://login.microsoftonline.com/'+config.tenantId+'/discovery/v2.0/keys'),{timeoutDuration:5000,cooldownDuration:30000});}
 async verify(raw:unknown):Promise<OutlookActor>{try{
  if(typeof raw!=='string'||raw.length>16384||!/^Bearer [A-Za-z0-9_.-]+$/u.test(raw))throw new Error();
  const {payload:p}=await jwtVerify(raw.slice(7),this.#keys,{algorithms:['RS256'],issuer:'https://login.microsoftonline.com/'+this.#config.tenantId+'/v2.0',audience:this.#config.applicationId,clockTolerance:30,requiredClaims:['exp','nbf','iat','tid','oid','azp','scp','ver']});
  if(p.ver!=='2.0'||p.tid!==this.#config.tenantId||!isUuid(p.oid)||p.azp!==outlookActionsAppId||typeof p.scp!=='string'||!p.scp.split(' ').includes(this.#config.scope)||typeof p.iat!=='number'||p.iat>Date.now()/1000+30)throw new Error();
  return{tenantId:this.#config.tenantId,objectId:p.oid.toLowerCase()};
 }catch{throw new Error('OUTLOOK_ACTION_NOT_AUTHORIZED');}}
}
