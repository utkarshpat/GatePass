import {sessionIdentity} from '../security/SessionProof.ts';
import {isUuid} from './SqlVisitReadRepository.ts';
import {GuardDutyError} from './GuardDutyService.ts';
import type {SqlParameter} from '../contracts/Sql.ts';
import type {PrivatePhotoReader} from './VisitReadService.ts';
import type {PhotoThumbnails} from './PhotoThumbnails.ts';
type Client={callProcedure(name:string,parameters:Record<string,SqlParameter>):Promise<string>};
/** Cached pixels never substitute for fresh scope/source checks before and after. */
export class GuardThumbnailService{
 #client:Client;#photos:PrivatePhotoReader;#thumbnails:PhotoThumbnails;
 constructor(client:Client,photos:PrivatePhotoReader,thumbnails:PhotoThumbnails){this.#client=client;this.#photos=photos;this.#thumbnails=thumbnails;}
 async read(session:{sessionToken:string;csrfToken:string},value:unknown){
  const d=value as Record<string,unknown>;
  if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!['locationId','dutyKind','dutyId','visitRequestId'].includes(k))||!Number.isInteger(d.locationId)||Number(d.locationId)<=0||Number(d.locationId)>2147483647||!['PROJECT','COMMON'].includes(String(d.dutyKind))||typeof d.dutyId!=='string'||!/^[1-9][0-9]{0,18}$/u.test(d.dutyId)||BigInt(d.dutyId)>9223372036854775807n||!isUuid(d.visitRequestId))throw new GuardDutyError('INVALID_INPUT');
  const parameters={...sessionIdentity(session),LocationId:{type:'int' as const,value:Number(d.locationId)},DutyKind:{type:'text' as const,value:d.dutyKind as string},DutyId:{type:'bigint' as const,value:d.dutyId},VisitRequestId:{type:'guid' as const,value:d.visitRequestId as string}};
  const read=async()=>{
   let p;try{p=JSON.parse(await this.#client.callProcedure('gp.ReadGuardPhotoSource',parameters));}catch(e){throw new GuardDutyError([52801,52001].includes(Number((e as any)?.number))?'NOT_AUTHORIZED':'UNAVAILABLE');}
   const ext:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
   if(!p||p.visitRequestId?.toLowerCase()!==String(d.visitRequestId).toLowerCase()||!isUuid(p.accessPassId)||!isUuid(p.photoAssetId)||!Object.hasOwn(ext,p.mimeType)||!Number.isInteger(p.byteLength)||p.byteLength<1||p.byteLength>5242880||typeof p.contentHash!=='string'||!/^[a-f0-9]{64}$/u.test(p.contentHash)||typeof p.storageKey!=='string'||!new RegExp('^intakes/[a-f0-9]{32}/'+p.photoAssetId.replaceAll('-','').toLowerCase()+'\\.'+ext[p.mimeType]+'$','u').test(p.storageKey))throw new GuardDutyError('UNAVAILABLE');
   return p;
  };
  const before=await read();let bytes:Buffer|undefined;
  try{
   bytes=await this.#thumbnails.readHashed(before.contentHash,()=>this.#photos.read(before.storageKey,before.byteLength));
   const after=await read();if(JSON.stringify(before)!==JSON.stringify(after))throw new GuardDutyError('NOT_AUTHORIZED');
   return{mimeType:'image/jpeg',imageBase64:bytes.toString('base64'),photoVersion:before.contentHash};
  }finally{bytes?.fill(0);}
 }
}
