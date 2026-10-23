import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {requireDummySso} from '../src/development/DummyEmployeeSso.ts';
import {LocalDevelopmentApiClient} from '../src/development/LocalDevelopmentApiClient.ts';
import {claimDevelopmentEmail,sandboxSql,sandboxTransport,sandboxRecipient} from '../src/development/DevelopmentMailSandbox.ts';
import {openPersonalOutlook} from '../src/email/PersonalOutlookConnection.ts';
import {GraphMailTransport} from '../src/email/GraphMailTransport.ts';
import {NotificationEmailWorker} from '../src/email/NotificationEmailWorker.ts';
import {localEmailLinks} from '../src/email/LocalEmailLinks.ts';
import {isUuid} from '../src/visits/SqlVisitReadRepository.ts';
import {NotificationPhotoService} from '../src/email/NotificationPhotoService.ts';
import {PrivateDirectory} from '../src/storage/PrivateDirectory.ts';
import {FilePhotoStore} from '../src/storage/FilePhotoStore.ts';
let stop=false;
try{
 if(process.env.NODE_ENV==='production')throw new Error('DEVELOPMENT_ONLY');
 process.env.NODE_ENV='development';process.env.GATEPASS_SSO_MODE='dummy';process.env.GATEPASS_DIRECTORY_MODE='mock';requireDummySso();
 const [visitId,recipient,option]=process.argv.slice(2);if(!isUuid(visitId)||option!==undefined&&option!=='--watch')throw new Error('SELECTED_VISIT_REQUIRED');sandboxRecipient(recipient);
 const {connection,config}=await openPersonalOutlook();await connection.acquireToken();
 const fixture=JSON.parse(await readFile(new URL('../database/development/directory-fixtures.json',import.meta.url),'utf8'));
 const employee=(id:string)=>fixture.employees.find((p:any)=>p.employeeId===id&&p.isActive)??null;
 const directory={getEmployee:async(id:string)=>employee(id),getManager:async(id:string)=>{const owner=employee(id);return owner?.managerEmployeeId?employee(owner.managerEmployeeId):null;}};
 const sql=sandboxSql(new LocalDevelopmentApiClient(),visitId),photos=new NotificationPhotoService(sql,new FilePhotoStore(await PrivateDirectory.create(join(homedir(),'.gatepass','private-v1','photos'),[process.cwd()])));
 const worker=new NotificationEmailWorker(sql,directory,sandboxTransport(new GraphMailTransport(config.sender,()=>connection.acquireToken(),fetch,'delegated'),recipient),await localEmailLinks(join(homedir(),'.gatepass','private-v1')),'http://localhost:8443',await readFile(new URL('../assets/brand/sopra-steria-logo.png',import.meta.url)),undefined,photos);
 process.once('SIGINT',()=>{stop=true;});process.once('SIGTERM',()=>{stop=true;});const deadline=Date.now()+20*60000;
 console.log('DEVELOPMENT_MAIL_SANDBOX: only selected visit; every recipient redirected to '+recipient+'. Links work on this laptop only.');
 do{const claims=await claimDevelopmentEmail(visitId);for(const claim of claims){if(stop)break;const result=await worker.deliver(claim);console.log(JSON.stringify({notificationId:claim.notificationId,status:result.status}));}if(option!=='--watch')break;for(let i=0;i<10&&!stop;i++)await new Promise(r=>setTimeout(r,1000));}while(!stop&&Date.now()<deadline);
}catch{console.error('DEVELOPMENT_MAIL_UNAVAILABLE: use mail:dev -- <selected-visit-uuid> <test-email> [--watch]; verify Outlook connection, synthetic SQL and local API. No global queue fallback.');process.exitCode=1;}
