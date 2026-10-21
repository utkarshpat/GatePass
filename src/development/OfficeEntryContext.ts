import {createHmac,timingSafeEqual} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {cookies,HttpFailure} from '../transport/ApiHandler.ts';
export const officeNames:Record<string,string>={NOIDA:'Noida',BENGALURU:'Bengaluru',CHENNAI:'Chennai',PUNE:'Pune'};
const lifetime=28800000;
export class OfficeEntryContext {
  #key:Buffer;
  constructor(key:Buffer){if(key.length<32)throw new Error('INVALID_OFFICE_KEY');this.#key=Buffer.from(key);}
  #mac(payload:string){return createHmac('sha256',this.#key).update('GatePass|office-entry|v1|').update(payload).digest('base64url');}
  read(req:IncomingMessage){
    const value=cookies(req.headers.cookie)['gp-dev-office'];
    if(typeof value!=='string'||value.length>150)throw new HttpFailure(403);
    const [code,expiry,mac,...extra]=value.split('.');const expires=Number(expiry);const expected=this.#mac(code+'.'+expiry);
    if(extra.length||!Object.hasOwn(officeNames,code)||!Number.isSafeInteger(expires)||expires<=Date.now()||expires>Date.now()+lifetime||typeof mac!=='string'||mac.length!==expected.length||!timingSafeEqual(Buffer.from(mac),Buffer.from(expected)))throw new HttpFailure(403);
    return code;
  }
  issue(res:ServerResponse,code:string){
    if(!Object.hasOwn(officeNames,code))throw new HttpFailure(404);
    const payload=code+'.'+String(Date.now()+lifetime);
    res.setHeader('Set-Cookie',`gp-dev-office=${payload}.${this.#mac(payload)}; Path=/; SameSite=Strict; HttpOnly; Max-Age=28800`);
  }
}
