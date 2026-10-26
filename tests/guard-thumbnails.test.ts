import test from 'node:test';import assert from 'node:assert/strict';import{createHash}from'node:crypto';
import{GuardThumbnailService}from'../src/visits/GuardThumbnailService.ts';import{PhotoThumbnails}from'../src/visits/PhotoThumbnails.ts';
const id='11111111-1111-4111-8111-111111111111',session={sessionToken:Buffer.alloc(32,1).toString('base64url'),csrfToken:Buffer.alloc(32,2).toString('base64url')},input={locationId:1,dutyKind:'PROJECT',dutyId:'1',visitRequestId:id};
function fixture(){
 let calls=0,loads=0,denied=false;const source=Buffer.from('synthetic source'),packet={visitRequestId:id,accessPassId:id,photoAssetId:id,mimeType:'image/jpeg',byteLength:source.length,storageKey:'intakes/'+ 'a'.repeat(32)+'/'+id.replaceAll('-','')+'.jpg',contentHash:createHash('sha256').update(source).digest('hex')};
 const sharp=()=>({rotate(){return this;},resize(){return this;},jpeg(){return this;},async toBuffer(){return Buffer.from('synthetic jpeg');}}),cache=new PhotoThumbnails(sharp);
 const client={async callProcedure(name:string){assert.equal(name,'gp.ReadGuardPhotoSource');calls++;if(denied)throw{number:52801};return JSON.stringify(packet);}},service=new GuardThumbnailService(client,{async read(){loads++;return Buffer.from(source);}},cache);
 return{service,packet,cache,counts:()=>({calls,loads}),deny:()=>{denied=true;}};
}
test('cold thumbnails use two metadata reads; warm pixels skip source IO while authorization remains fresh',async()=>{
 const f=fixture();try{assert.equal((await f.service.read(session,input)).mimeType,'image/jpeg');assert.deepEqual(f.counts(),{calls:2,loads:1});await f.service.read(session,input);assert.deepEqual(f.counts(),{calls:4,loads:1});f.deny();await assert.rejects(f.service.read(session,input),/NOT_AUTHORIZED/u);assert.deepEqual(f.counts(),{calls:5,loads:1});}finally{f.cache.close();}
});
test('thumbnail service rejects scope/input and metadata corruption before loading private bytes',async()=>{
 const f=fixture();try{for(const patch of [{dutyId:'0'},{dutyKind:'ALL'},{locationId:1.5},{visitRequestId:'bad'},{extra:true}])await assert.rejects(f.service.read(session,{...input,...patch}),/INVALID_INPUT/u);assert.equal(f.counts().calls,0);f.packet.storageKey='../other.jpg';await assert.rejects(f.service.read(session,input),/UNAVAILABLE/u);assert.equal(f.counts().loads,0);}finally{f.cache.close();}
});
test('source substitution and changed authority during thumbnail work cannot return pixels',async()=>{
 const f=fixture();try{const first=f.packet.contentHash;f.packet.contentHash='a'.repeat(64);await assert.rejects(f.service.read(session,input),/UNAVAILABLE/u);f.packet.contentHash=first;
 const service=new GuardThumbnailService({async callProcedure(){const r=JSON.stringify(f.packet);f.packet.accessPassId='22222222-2222-4222-8222-222222222222';return r;}},{async read(){return Buffer.from('synthetic source');}},f.cache);
 await assert.rejects(service.read(session,input),/NOT_AUTHORIZED/u);
 }finally{f.cache.close();}
});
