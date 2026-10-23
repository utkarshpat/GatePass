import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {isAbsolute} from 'node:path';
import {connectSql} from '../src/transport/SqlProcedureClient.ts';
import {NotificationEmailWorker} from '../src/email/NotificationEmailWorker.ts';
import {GraphMailTransport,graphClientCredentials} from '../src/email/GraphMailTransport.ts';
import {openPersonalOutlook} from '../src/email/PersonalOutlookConnection.ts';
import {loadOutlookActions} from '../src/email/OutlookConfiguration.ts';
import {NotificationPhotoService} from '../src/email/NotificationPhotoService.ts';
import {PrivateDirectory} from '../src/storage/PrivateDirectory.ts';
import {FilePhotoStore} from '../src/storage/FilePhotoStore.ts';
const required=(name:string)=>{const v=process.env[name];if(!v)throw new Error('MAIL_CONFIGURATION_REQUIRED');return v;};
async function adapter(name:string,factory:string){const file=required(name);if(!isAbsolute(file))throw new Error('ABSOLUTE_MAIL_ADAPTER_REQUIRED');const module=await import(pathToFileURL(file).href);if(typeof module[factory]!=='function')throw new Error('MAIL_ADAPTER_REQUIRED');return module[factory]();}
let sql:Awaited<ReturnType<typeof connectSql>>|undefined;let stopping=false;
try{
 if(process.env.GATEPASS_SSO_MODE==='dummy'||process.env.GATEPASS_DIRECTORY_MODE==='mock')throw new Error('LIVE_MAIL_REQUIRES_APPROVED_DIRECTORY');
 const mode=process.env.GATEPASS_MAIL_AUTH_MODE??'application';if(!['application','personal'].includes(mode))throw new Error('INVALID_MAIL_AUTH_MODE');
 const personal=mode==='personal'?await openPersonalOutlook():undefined;
 if(personal&&personal.config.sender!==required('GATEPASS_MAIL_SENDER').toLowerCase())throw new Error('MAIL_SENDER_MISMATCH');
 const transport=personal?new GraphMailTransport(personal.config.sender,()=>personal.connection.acquireToken(),fetch,'delegated'):new GraphMailTransport(required('GATEPASS_MAIL_SENDER'),graphClientCredentials({tenantId:required('GATEPASS_GRAPH_TENANT_ID'),clientId:required('GATEPASS_GRAPH_CLIENT_ID'),clientSecret:required('GATEPASS_GRAPH_CLIENT_SECRET')}));
 const directory=await adapter('GATEPASS_MAIL_DIRECTORY_MODULE','createMailDirectory'),links=await adapter('GATEPASS_EMAIL_LINKS_MODULE','createEmailLinks');
 if(typeof directory.getEmployee!=='function'||typeof directory.getManager!=='function'||typeof links.issue!=='function'||typeof links.verify!=='function')throw new Error('INVALID_MAIL_ADAPTER');
 const origin=required('GATEPASS_ORIGIN');if(!origin.startsWith('https://'))throw new Error('LIVE_MAIL_REQUIRES_HTTPS');
 sql=await connectSql({server:required('GATEPASS_DB_SERVER'),port:Number(required('GATEPASS_DB_PORT')),database:required('GATEPASS_DB_NAME'),user:required('GATEPASS_WORKER_DB_USER'),password:required('GATEPASS_WORKER_DB_PASSWORD')},'worker');
 const outlook=await loadOutlookActions(process.env,origin);
 const photos=new NotificationPhotoService(sql,new FilePhotoStore(await PrivateDirectory.create(required('GATEPASS_MAIL_PHOTOS_ROOT'),[process.cwd()])));
 const worker=new NotificationEmailWorker(sql,directory,transport,links,origin,await readFile(new URL('../assets/brand/sopra-steria-logo.png',import.meta.url)),outlook?.card,photos);process.once('SIGINT',()=>{stopping=true;});process.once('SIGTERM',()=>{stopping=true;});
 do{const results=await worker.runOnce();console.log(JSON.stringify({batch:results}));if(process.argv.includes('--once'))break;for(let i=0;i<10&&!stopping;i++)await new Promise(r=>setTimeout(r,1000));}while(!stopping);
}catch{console.error('EMAIL_WORKER_UNAVAILABLE: verify Graph mailbox/app, approved directory/link-key adapters, protected mail-photo root and dedicated worker SQL identity.');process.exitCode=1;}finally{await sql?.close();}
