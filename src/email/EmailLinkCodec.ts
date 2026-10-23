import {createHmac,timingSafeEqual} from 'node:crypto';
import type {QrKeySource} from '../registration/QrCredentialEnvelope.ts';
import {isUuid} from '../visits/SqlVisitReadRepository.ts';
export type EmailLink={v:1;visit:string;emailHash:string;snapshot:string;expires:number};
// 90-day supported booking horizon + remaining visit day + one-day status grace.
export class EmailLinkCodec {
 #keys:QrKeySource;#now:()=>number;
 constructor(keys:QrKeySource,now=Date.now){this.#keys=keys;this.#now=now;}
 #valid(v:any){return v&&Object.keys(v).sort().join('|')==='emailHash|expires|snapshot|v|visit'&&v.v===1&&isUuid(v.visit)&&/^[a-f0-9]{64}$/u.test(v.emailHash)&&/^[a-f0-9]{64}$/u.test(v.snapshot)&&Number.isSafeInteger(v.expires)&&v.expires>this.#now()&&v.expires<=this.#now()+92*86400000;}
 async issue(value:EmailLink){return this.#issue(value,'EmailRequest');}
 async verify(token:unknown){return this.#verify(token,'EmailRequest');}
 async issueRevoke(value:EmailLink){return this.#issue(value,'EmailRevoke');}
 async verifyRevoke(token:unknown){return this.#verify(token,'EmailRevoke');}
 async #issue(value:EmailLink,purpose:string){if(!this.#valid(value))throw new Error('EMAIL_LINK_UNAVAILABLE');const {id,key}=await this.#keys.active();try{const data=Buffer.from(JSON.stringify(value)).toString('base64url');const body=id+'.'+data;return body+'.'+createHmac('sha256',key).update('GatePass|'+purpose+'|1|'+body).digest('base64url');}finally{key.fill(0);}}
 async #verify(token:unknown,purpose:string):Promise<EmailLink>{if(typeof token!=='string'||token.length>1024)throw new Error('EMAIL_LINK_UNAVAILABLE');const parts=token.split('.');if(parts.length!==3||!/^k_[a-f0-9]{32}$/u.test(parts[0])||!/^[A-Za-z0-9_-]+$/u.test(parts[1])||!/^[A-Za-z0-9_-]{43}$/u.test(parts[2]))throw new Error('EMAIL_LINK_UNAVAILABLE');let key:Buffer|undefined;try{key=await this.#keys.resolve(parts[0]);const expected=createHmac('sha256',key).update('GatePass|'+purpose+'|1|'+parts.slice(0,2).join('.')).digest();const given=Buffer.from(parts[2],'base64url');if(given.toString('base64url')!==parts[2]||!timingSafeEqual(expected,given))throw new Error();const data=Buffer.from(parts[1],'base64url');if(data.toString('base64url')!==parts[1])throw new Error();const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));if(!this.#valid(value))throw new Error();return value;}catch{throw new Error('EMAIL_LINK_UNAVAILABLE');}finally{key?.fill(0);}}
}
