import {request} from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import sharp from 'sharp';
import {sandboxRecipient} from '../src/development/DevelopmentMailSandbox.ts';
import {isUuid} from '../src/visits/SqlVisitReadRepository.ts';
import {localEmailLinks} from '../src/email/LocalEmailLinks.ts';
// Synthetic scenario through the actual localhost HTTP/SQL/auth/photo pipeline.
const jar=new Map<string,string>();
async function call(path:string,body:unknown={},method='POST'){
 const bytes=Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body));
 return new Promise<any>((resolve,reject)=>{
  const req=request({hostname:'127.0.0.1',port:8443,path,method,headers:{host:'localhost:8443',origin:'http://localhost:8443',cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),'x-csrf-token':jar.get('gp-dev-csrf')??'','x-intake-csrf-token':jar.get('gp-dev-intake-csrf')??'',...(method==='POST'?{'content-type':Buffer.isBuffer(body)?'image/jpeg':'application/json','content-length':bytes.length}:{})}},res=>{
   const parts:Buffer[]=[];res.on('data',part=>parts.push(part));res.on('end',()=>{
    for(const cookie of res.headers['set-cookie']??[]){const [name,...value]=cookie.split(';')[0].split('=');if(value.join('='))jar.set(name,value.join('='));else jar.delete(name);}
    let result:any;try{result=JSON.parse(Buffer.concat(parts).toString());}catch{result={};}
    if(res.statusCode!==200)reject(new Error('EMAIL_TEST_HTTP_'+res.statusCode));else resolve(result);
   });
  });req.setTimeout(30000,()=>req.destroy(new Error('EMAIL_TEST_TIMEOUT')));req.on('error',reject);req.end(method==='POST'?bytes:undefined);
 });
}
try{
 if(process.env.NODE_ENV==='production')throw new Error('DEVELOPMENT_ONLY');
 const [action,arg,hostId]=process.argv.slice(2);
 if(action==='create'){
  sandboxRecipient(arg);await call('/office/noida',{},'GET');await call('/api/registration/start',{requestType:'EXTERNAL'});
  const options=await call('/api/registration/options');const project=options.projects[0];if(!project)throw new Error('NO_TEST_PROJECT');
  const candidates=await call('/api/registration/options',{projectLocationId:project.projectLocationId,search:'employee'});const host=candidates.hosts[0];if(!host)throw new Error('NO_TEST_HOST');
  const avatar=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#edf1f7"/><circle cx="200" cy="175" r="80" fill="#91a0b6"/><path d="M50 470v-80a150 140 0 0 1 300 0v80" fill="#91a0b6"/><text x="200" y="490" text-anchor="middle" font-size="20" fill="#172234">SYNTHETIC TEST</text></svg>');
  const photo=await call('/api/registration/photo',await sharp(avatar).jpeg().toBuffer());
  const payload={clientKey:randomUUID(),requestType:'EXTERNAL',projectLocationId:project.projectLocationId,hostEmployeeId:host.employeeId,reason:'GatePass email workflow test',visitDate:options.currentDate,people:[{clientPersonKey:randomUUID(),photoAssetId:photo.photoAssetId,name:'GatePass Email Test',phone:'+919876543210',email:arg}]};
  const result=await call('/api/registration/submit',payload);const replay=await call('/api/registration/submit',payload);if(JSON.stringify(result.visits)!==JSON.stringify(replay.visits))throw new Error('EMAIL_TEST_REPLAY_MISMATCH');
  const visit=result.visits[0];if(!isUuid(visit.visitRequestId)||visit.status!=='PENDING')throw new Error('EMAIL_TEST_INVALID_VISIT');
  const manifest={visitRequestId:visit.visitRequestId,hostEmployeeId:host.employeeId,hostEmail:host.officialEmail,recipient:arg,createdAt:new Date().toISOString(),origin:'http://localhost:8443',synthetic:true};
  const folder=join(homedir(),'.gatepass','email-tests');await mkdir(folder,{recursive:true});await writeFile(join(folder,visit.visitRequestId.toLowerCase()+'.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest));
 }else if(action==='approve'||action==='verify'){
  if(!isUuid(arg)||!/^EMP[0-9]{3}$/u.test(hostId??''))throw new Error('EMAIL_TEST_INVALID_ID');
  const manifest=JSON.parse(await readFile(join(homedir(),'.gatepass','email-tests',arg.toLowerCase()+'.json'),'utf8'));if(manifest.synthetic!==true||manifest.visitRequestId.toLowerCase()!==arg.toLowerCase()||manifest.hostEmployeeId!==hostId)throw new Error('EMAIL_TEST_MANIFEST_MISMATCH');
  await call('/api/dev/sso/login',{email:manifest.hostEmail,password:'Sopra@123'});
  const detail=await call('/api/email/host/detail',{visitRequestId:arg});
  if(detail.personName!=='GatePass Email Test')throw new Error('NOT_SYNTHETIC_TEST');
  if(action==='verify'){
   if(detail.status!=='APPROVED'||detail.canDecide)throw new Error('EMAIL_TEST_INVALID_APPROVAL');
   process.env.NODE_ENV='development';
   const codec=await localEmailLinks(join(homedir(),'.gatepass','private-v1'));
   const link=await codec.issue({v:1,visit:arg.toLowerCase(),emailHash:createHash('sha256').update(manifest.recipient.toLowerCase(),'utf16le').digest('hex'),snapshot:detail.snapshotHash.toLowerCase(),expires:Date.parse(detail.validUntilUtc)+86400000});
   const status=await call('/api/email/external/detail',{link});if(status.status!=='APPROVED')throw new Error('EMAIL_TEST_STATUS_MISMATCH');
   const image=await call('/api/email/external/image',{link});if(image.mimeType!=='image/png')throw new Error('EMAIL_TEST_IMAGE_MISMATCH');
   const png=Buffer.from(image.imageBase64,'base64'),metadata=await sharp(png).metadata();if(metadata.width!==1712||metadata.height!==1080)throw new Error('EMAIL_TEST_CARD_SIZE');
   await writeFile(join(homedir(),'.gatepass','email-tests',arg.toLowerCase()+'.png'),png);
   let tamperRejected=false;try{await call('/api/email/external/detail',{link:link+'x'});}catch{tamperRejected=true;}if(!tamperRejected)throw new Error('EMAIL_TEST_TAMPER_ACCEPTED');
   jar.clear();await call('/api/dev/sso/login',{email:'employee2@example.com',password:'Sopra@123'});
   let wrongHostRejected=false;try{await call('/api/email/host/detail',{visitRequestId:arg});}catch{wrongHostRejected=true;}if(!wrongHostRejected)throw new Error('EMAIL_TEST_WRONG_HOST_ACCEPTED');
   console.log(JSON.stringify({visitRequestId:arg,status:status.status,landscapePngVerified:true,tamperRejected,wrongHostRejected}));
  }else{
  const decision={clientKey:randomUUID(),visitRequestId:arg,snapshotVersion:detail.snapshotVersion,snapshotHash:detail.snapshotHash,decision:'APPROVED'};
  const result=await call('/api/email/host/decide',decision);const replay=await call('/api/email/host/decide',decision);if(JSON.stringify(result)!==JSON.stringify(replay))throw new Error('EMAIL_DECISION_REPLAY_MISMATCH');
  console.log(JSON.stringify({visitRequestId:arg,decision:result,replayVerified:true}));
  }
 }else throw new Error('EMAIL_TEST_ACTION_REQUIRED');
}catch(error){const message=error instanceof Error&&/^EMAIL_TEST_HTTP_[0-9]+$/u.test(error.message)?error.message:'EMAIL_TEST_FAILED';console.error(message);process.exitCode=1;}
