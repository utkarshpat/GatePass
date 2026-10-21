import {createHmac,timingSafeEqual} from 'node:crypto';
import type {QrKeySource} from '../registration/QrCredentialEnvelope.ts';
import {isUuid} from '../visits/SqlVisitReadRepository.ts';
export type OutlookAction={v:1;visit:string;host:string;snapshot:string;decision:'APPROVED'|'DENIED';clientKey:string;expires:number};
export class OutlookActionCodec{
 #keys:QrKeySource;#binding:string;#now:()=>number;
 constructor(keys:QrKeySource,binding:string,now=Date.now){if(!binding||binding.length>1024)throw new Error('OUTLOOK_BINDING_REQUIRED');this.#keys=keys;this.#binding=binding;this.#now=now;}
 #valid(v:any){return v&&Object.keys(v).sort().join('|')==='clientKey|decision|expires|host|snapshot|v|visit'&&v.v===1&&isUuid(v.visit)&&isUuid(v.clientKey)&&typeof v.host==='string'&&v.host.length>=1&&v.host.length<=64&&!/[\x00-\x1f\x7f]/u.test(v.host)&&/^[a-f0-9]{64}$/u.test(v.snapshot)&&['APPROVED','DENIED'].includes(v.decision)&&Number.isSafeInteger(v.expires)&&v.expires>this.#now()&&v.expires<=this.#now()+7*86400000;}
 async issue(value:OutlookAction){if(!this.#valid(value))throw new Error('OUTLOOK_ACTION_UNAVAILABLE');const{id,key}=await this.#keys.active();try{const body=id+'.'+Buffer.from(JSON.stringify(value)).toString('base64url');return body+'.'+createHmac('sha256',key).update('GatePass|OutlookAction|1|'+this.#binding+'|'+body).digest('base64url');}finally{key.fill(0);}}
 async verify(raw:unknown):Promise<OutlookAction>{let key:Buffer|undefined;try{
  if(typeof raw!=='string'||raw.length>2048)throw new Error();const parts=raw.split('.');if(parts.length!==3||!/^k_[0-9a-f]{32}$/u.test(parts[0])||!/^[A-Za-z0-9_-]+$/u.test(parts[1])||!/^[A-Za-z0-9_-]{43}$/u.test(parts[2]))throw new Error();key=await this.#keys.resolve(parts[0]);
  const given=Buffer.from(parts[2],'base64url'),expected=createHmac('sha256',key).update('GatePass|OutlookAction|1|'+this.#binding+'|'+parts.slice(0,2).join('.')).digest();if(given.toString('base64url')!==parts[2]||!timingSafeEqual(given,expected))throw new Error();
  const bytes=Buffer.from(parts[1],'base64url');if(bytes.toString('base64url')!==parts[1])throw new Error();const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!this.#valid(value))throw new Error();return value;
 }catch{throw new Error('OUTLOOK_ACTION_UNAVAILABLE');}finally{key?.fill(0);}}
}
