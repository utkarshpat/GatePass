import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {PublicClientApplication} from '@azure/msal-node';
import type {AccountInfo,DeviceCodeRequest} from '@azure/msal-node';
import type {QrKeySource} from '../registration/QrCredentialEnvelope.ts';
import {PrivateDirectory} from '../storage/PrivateDirectory.ts';
import {FileQrKeySource} from '../storage/FileQrKeySource.ts';
import {WindowsCurrentUserKeyProtector} from '../storage/PlatformProtection.ts';
import {isUuid} from '../visits/SqlVisitReadRepository.ts';

export type OutlookConfig={clientId:string;sender:string};
export const outlookScopes=['https://graph.microsoft.com/Mail.Send'];
export function validateOutlookConfig(value:OutlookConfig){
 if(!value||!isUuid(value.clientId)||typeof value.sender!=='string'||value.sender.length>320||!/^([^\s<>@\x00-\x1f]+)@([^\s<>@\x00-\x1f]+)\.[^\s<>@\x00-\x1f]+$/u.test(value.sender))throw new Error('OUTLOOK_CONFIGURATION_REQUIRED');
 return{clientId:value.clientId.toLowerCase(),sender:value.sender.toLowerCase()};
}
export function senderAccount(accounts:AccountInfo[],sender:string){
 const found=accounts.filter(a=>a.username?.toLowerCase()===sender.toLowerCase());
 if(found.length!==1)throw new Error('OUTLOOK_SENDER_SIGN_IN_REQUIRED');return found[0];
}
/** MSAL cache is encrypted separately from QR/email-link keys and bound to this app/sender. */
export class ProtectedOutlookCache{
 #directory:Pick<PrivateDirectory,'read'|'write'>;#keys:QrKeySource;#binding:Buffer;
 constructor(directory:Pick<PrivateDirectory,'read'|'write'>,keys:QrKeySource,config:OutlookConfig){this.#directory=directory;this.#keys=keys;this.#binding=Buffer.from('GatePass|Outlook|1|'+JSON.stringify(validateOutlookConfig(config)));}
 async load(){
  let data:Buffer;try{data=await this.#directory.read('tokens.enc',2097152);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return '';throw new Error('OUTLOOK_CACHE_UNAVAILABLE');}
  let key:Buffer|undefined;
  try{const v=JSON.parse(data.toString('utf8'));if(v.v!==1||typeof v.keyId!=='string'||!/^k_[0-9a-f]{32}$/u.test(v.keyId)||typeof v.iv!=='string'||typeof v.tag!=='string'||typeof v.data!=='string')throw new Error();
   const iv=Buffer.from(v.iv,'base64'),tag=Buffer.from(v.tag,'base64');if(iv.length!==12||tag.length!==16)throw new Error();key=await this.#keys.resolve(v.keyId);const cipher=createDecipheriv('aes-256-gcm',key,iv);cipher.setAAD(this.#binding);cipher.setAuthTag(tag);const plain=Buffer.concat([cipher.update(Buffer.from(v.data,'base64')),cipher.final()]);try{return plain.toString('utf8');}finally{plain.fill(0);}
  }catch{throw new Error('OUTLOOK_CACHE_UNAVAILABLE');}finally{key?.fill(0);data.fill(0);}
 }
 async save(serialized:string){if(Buffer.byteLength(serialized)>1048576)throw new Error('OUTLOOK_CACHE_TOO_LARGE');const {id,key}=await this.#keys.active();const plain=Buffer.from(serialized);
  try{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(this.#binding);const data=Buffer.concat([cipher.update(plain),cipher.final()]);await this.#directory.write('tokens.enc',Buffer.from(JSON.stringify({v:1,keyId:id,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')})),true);}finally{plain.fill(0);key.fill(0);}
 }
}
type OutlookApp=Pick<PublicClientApplication,'getTokenCache'|'acquireTokenByDeviceCode'|'acquireTokenSilent'>;
export class PersonalOutlookConnection{
 #config:OutlookConfig;#cache:ProtectedOutlookCache;#directory:PrivateDirectory;#factory:()=>OutlookApp;
 constructor(config:OutlookConfig,cache:ProtectedOutlookCache,directory:PrivateDirectory,factory?:()=>OutlookApp){this.#config=validateOutlookConfig(config);this.#cache=cache;this.#directory=directory;this.#factory=factory??(()=>new PublicClientApplication({auth:{clientId:this.#config.clientId,authority:'https://login.microsoftonline.com/consumers'},system:{loggerOptions:{piiLoggingEnabled:false,loggerCallback:()=>{}}}}));}
 async connect(showCode:DeviceCodeRequest['deviceCodeCallback']){return this.#directory.exclusive('.connection.lock',async()=>{
  const app=this.#factory();const result=await app.acquireTokenByDeviceCode({scopes:outlookScopes,deviceCodeCallback:showCode});
  if(!result?.account||!result.accessToken)throw new Error('OUTLOOK_SENDER_SIGN_IN_REQUIRED');senderAccount([result.account],this.#config.sender);
  await this.#cache.save(app.getTokenCache().serialize());await this.#directory.write('connection.json',Buffer.from(JSON.stringify(this.#config)),true);return{sender:this.#config.sender};
 });}
 async acquireToken(){return this.#directory.exclusive('.connection.lock',async()=>{
  const app=this.#factory(),serialized=await this.#cache.load();if(!serialized)throw new Error('OUTLOOK_SENDER_SIGN_IN_REQUIRED');app.getTokenCache().deserialize(serialized);
  const account=senderAccount(await app.getTokenCache().getAllAccounts(),this.#config.sender);
  const result=await app.acquireTokenSilent({account,scopes:outlookScopes});if(!result?.accessToken||!result.account)throw new Error('OUTLOOK_SENDER_SIGN_IN_REQUIRED');senderAccount([result.account],this.#config.sender);
  await this.#cache.save(app.getTokenCache().serialize());return result.accessToken;
 });}
 async disconnect(){await this.#directory.exclusive('.connection.lock',()=>this.#cache.save(''));}
}
export async function openPersonalOutlook(config?:OutlookConfig){
 if(process.platform!=='win32')throw new Error('OUTLOOK_WINDOWS_PROTECTION_REQUIRED');
 const directory=await PrivateDirectory.create(join(homedir(),'.gatepass','outlook-personal-v1'),[process.cwd()]);
 const selected=validateOutlookConfig(config??JSON.parse((await directory.read('connection.json',4096)).toString('utf8')));
 const keyDirectory=await PrivateDirectory.create(join(directory.root,'keys'),[]),keys=new FileQrKeySource(keyDirectory,new WindowsCurrentUserKeyProtector());await keys.initialize();
 return{config:selected,connection:new PersonalOutlookConnection(selected,new ProtectedOutlookCache(directory,keys,selected),directory)};
}
