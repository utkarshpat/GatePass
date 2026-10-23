import {createHash,timingSafeEqual} from 'node:crypto';
import type {EmailSql} from './EmailWorkflowService.ts';
import type {PrivatePhotoReader} from '../visits/VisitReadService.ts';
import {isUuid} from '../visits/SqlVisitReadRepository.ts';

export type NotificationClaim={notificationId:number;claimToken:string};
export type MailPhoto={bytes:Buffer;mimeType:'image/jpeg'|'image/png'|'image/webp'};
export interface NotificationPhotos{read(claim:NotificationClaim,visitRequestId:string):Promise<MailPhoto|null>}
export const photoTemplates=['HOST_APPROVAL_REQUEST','TEMP_ID_MANAGER_NOTICE','REQUEST_RECEIVED','VISIT_DECIDED','PASS_DELIVERY'];
/** Only a current, relevant notification lease can resolve its own person's photo. No QR access. */
export class NotificationPhotoService implements NotificationPhotos{
 #sql:EmailSql;#store:PrivatePhotoReader;
 constructor(sql:EmailSql,store:PrivatePhotoReader){this.#sql=sql;this.#store=store;}
 async read(claim:NotificationClaim,visitRequestId:string):Promise<MailPhoto|null>{
  let bytes:Buffer|undefined;
  try{
   if(!Number.isSafeInteger(claim.notificationId)||claim.notificationId<1||!isUuid(claim.claimToken)||!isUuid(visitRequestId))throw new Error();
   const resolve=async()=>{
    const p=JSON.parse(await this.#sql.callProcedure('gp.ResolveNotificationPhoto',{NotificationId:{type:'bigint',value:String(claim.notificationId)},ClaimToken:{type:'guid',value:claim.claimToken}}));
    if(!p||p.visitRequestId?.toLowerCase()!==visitRequestId.toLowerCase()||typeof p.available!=='boolean')throw new Error();
    if(!p.available)return null;
    const extensions={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
    if(!isUuid(p.photoAssetId)||!Object.hasOwn(extensions,p.mimeType)||!Number.isInteger(p.byteLength)||p.byteLength<1||p.byteLength>5242880||typeof p.contentHash!=='string'||!/^[a-f0-9]{64}$/iu.test(p.contentHash)||typeof p.storageKey!=='string'||!new RegExp('^intakes/[0-9a-f]{32}/'+p.photoAssetId.replaceAll('-','').toLowerCase()+'\\.'+extensions[p.mimeType as keyof typeof extensions]+'$','u').test(p.storageKey))throw new Error();
    return {photoAssetId:p.photoAssetId,storageKey:p.storageKey,length:p.byteLength,hash:p.contentHash,mimeType:p.mimeType as MailPhoto['mimeType']};
   };
   const before=await resolve();if(!before)return null;
   bytes=Buffer.from(await this.#store.read(before.storageKey,before.length));
   if(bytes.length!==before.length||!timingSafeEqual(createHash('sha256').update(bytes).digest(),Buffer.from(before.hash,'hex')))throw new Error();
   if(JSON.stringify(before)!==JSON.stringify(await resolve()))throw new Error();
   return {bytes,mimeType:before.mimeType};
  }catch{bytes?.fill(0);throw new Error('NOTIFICATION_PHOTO_UNAVAILABLE');}
 }
}
