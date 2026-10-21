import {createHash,timingSafeEqual} from 'node:crypto';
import {recoverQrCredential} from '../registration/QrCredentialEnvelope.ts';
import type {QrKeySource} from '../registration/QrCredentialEnvelope.ts';
import type {PrivatePhotoReader} from '../visits/VisitReadService.ts';
import type {PassCardData,PassCardRenderer} from './PassCardRenderer.ts';
import type {SqlParameter} from '../transport/SqlProcedureClient.ts';
import {isUuid} from '../visits/SqlVisitReadRepository.ts';
export class OwnCardError extends Error {status:number;constructor(status:number){super('CARD_UNAVAILABLE');this.status=status;}}
interface CardClient {callProcedure(name:string,parameters:Record<string,SqlParameter>):Promise<string>}
function digest(token:string){
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/u.test(token))throw new OwnCardError(403);
 const bytes=Buffer.from(token,'base64url');try{if(bytes.length!==32||bytes.toString('base64url')!==token)throw new OwnCardError(403);return createHash('sha256').update(bytes).digest();}finally{bytes.fill(0);}
}
const requireOutput=(valid:unknown)=>{if(!valid)throw new OwnCardError(503);};
/** Render source remains internal; only the authorized PNG crosses the HTTP boundary. */
export class OwnDigitalIdCardService {
 #client:CardClient;#keys:QrKeySource;#photos:PrivatePhotoReader;#renderer:PassCardRenderer;#rasterize:(svg:Buffer)=>Promise<Buffer>;#active=0;#scope:'OWN'|'RECEPTION';
 constructor(client:CardClient,keys:QrKeySource,photos:PrivatePhotoReader,renderer:PassCardRenderer,rasterize:(svg:Buffer)=>Promise<Buffer>,scope:'OWN'|'RECEPTION'='OWN'){if(!['OWN','RECEPTION'].includes(scope))throw new Error('INVALID_CARD_SCOPE');this.#client=client;this.#keys=keys;this.#photos=photos;this.#renderer=renderer;this.#rasterize=rasterize;this.#scope=scope;}
 async image(session:{sessionToken:string;csrfToken:string},visitRequestId:unknown){
  if(!isUuid(visitRequestId))throw new OwnCardError(400);
  if(this.#active>=2)throw new OwnCardError(429);
  const id=String(visitRequestId).toLowerCase(),parameters:Record<string,SqlParameter>={SessionHash:{type:'binary',value:digest(session.sessionToken)},CsrfHash:{type:'binary',value:digest(session.csrfToken)},VisitRequestId:{type:'guid',value:id}};
  this.#active++;let photo:Buffer|undefined,rawQr:Buffer|undefined,svg:Buffer|undefined,png:Buffer|undefined;
  const read=async()=>{try{return JSON.parse(await this.#client.callProcedure(this.#scope==='OWN'?'gp.GetOwnDigitalIdCard':'gp.GetReceptionCardSource',parameters));}catch(error){if([52001,52801,53101,53105,53401,53501].includes(Number((error as any)?.number)))throw new OwnCardError(403);throw new OwnCardError(503);}};
  try {
   const packet=await read(),fingerprint=createHash('sha256').update(JSON.stringify(packet)).digest();
   requireOutput(packet&&typeof packet==='object'&&packet.visitRequestId?.toLowerCase()===id&&isUuid(packet.accessPassId)&&isUuid(packet.photoAssetId)&&(this.#scope==='OWN'?packet.requestType==='DIGITAL_ID'&&packet.visitStatus==='APPROVED':['DIGITAL_ID','EMPLOYEE_PROJECT','EXTERNAL'].includes(packet.requestType)&&['APPROVED','PENDING'].includes(packet.visitStatus)));
   const ext:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
   requireOutput(Object.hasOwn(ext,packet.mimeType)&&Number.isInteger(packet.byteLength)&&packet.byteLength>0&&packet.byteLength<=5242880&&typeof packet.photoContentHash==='string'&&/^[0-9a-f]{64}$/iu.test(packet.photoContentHash)&&typeof packet.storageKey==='string');
   requireOutput(new RegExp('^intakes/[0-9a-f]{32}/'+packet.photoAssetId.replaceAll('-','').toLowerCase()+'\\.'+ext[packet.mimeType]+'$','u').test(packet.storageKey));
   photo=Buffer.from(await this.#photos.read(packet.storageKey,packet.byteLength));
   requireOutput(photo.length===packet.byteLength&&timingSafeEqual(createHash('sha256').update(photo).digest(),Buffer.from(packet.photoContentHash,'hex')));
   rawQr=await recoverQrCredential({...packet,clientPersonKey:id},this.#keys);
   const detail=packet.cardDetails;requireOutput(detail&&typeof detail==='object');
   const data:PassCardData={requestType:packet.requestType,visitStatus:packet.visitStatus,personName:packet.personName,publicReference:packet.publicReference,publicPassNumber:packet.publicPassNumber,locationName:packet.locationName,validFromUtc:packet.validFromUtc,validUntilUtc:packet.validUntilUtc,employeeId:detail.employeeId,hostEmployeeId:detail.hostEmployeeId,hostName:detail.hostName,purpose:detail.purpose,assignedProjects:detail.assignedProjects,assignedProjectCount:detail.assignedProjectCount,...(packet.projectName?{projectName:packet.projectName}:{})};
   svg=await this.#renderer.render(data,photo,packet.mimeType,rawQr.toString('base64url'));
   png=await this.#rasterize(svg);requireOutput(Buffer.isBuffer(png)&&png.length>8&&png.length<=5242880&&png.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')));
   const current=await read();if(!timingSafeEqual(fingerprint,createHash('sha256').update(JSON.stringify(current)).digest()))throw new OwnCardError(409);
   return {mimeType:'image/png' as const,fileName:(this.#scope==='OWN'?'Digital-ID-':'Pass-')+id+'.png',imageBase64:png.toString('base64')};
  }catch(error){if(error instanceof OwnCardError)throw error;throw new OwnCardError(503);}
  finally{photo?.fill(0);rawQr?.fill(0);svg?.fill(0);png?.fill(0);this.#active--;}
 }
}
