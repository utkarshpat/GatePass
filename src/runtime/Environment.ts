import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {isAbsolute} from 'node:path';
import {parseEnv} from 'node:util';

export const environmentFile=fileURLToPath(new URL('../../.env',import.meta.url));
/** Server entry points only. Values and raw file/parser errors never enter logs. */
export function loadRuntimeEnvironment(file=environmentFile,env:NodeJS.ProcessEnv=process.env){
 let source:string;
 try{source=readFileSync(file,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'&&env.NODE_ENV!=='production')return false;throw Error('ENV_FILE_UNAVAILABLE');}
 if(Buffer.byteLength(source)>131072)throw Error('ENV_FILE_INVALID');
 let parsed:NodeJS.ProcessEnv;try{parsed=parseEnv(source);}catch{throw Error('ENV_FILE_INVALID');}
 if(parsed.NODE_ENV==='production'&&env.NODE_ENV&&env.NODE_ENV!=='production')throw Error('ENV_PRODUCTION_MODE_CONFLICT');
 for(const [key,value] of Object.entries(parsed))if((key==='NODE_ENV'||/^GATEPASS_[A-Z0-9_]+$/u.test(key))&&env[key]===undefined)env[key]=value;
 return true;
}
const common=['NODE_ENV','GATEPASS_ORIGIN','GATEPASS_DB_SERVER','GATEPASS_DB_PORT','GATEPASS_DB_NAME'];
export function configurationProblems(service:'api'|'email',env:NodeJS.ProcessEnv=process.env):string[]{
 const required=[...common,...(service==='api'?['GATEPASS_SOURCE_KEY','GATEPASS_TLS_KEY_FILE','GATEPASS_TLS_CERT_FILE','GATEPASS_API_DB_USER','GATEPASS_API_DB_PASSWORD','GATEPASS_AUTH_DB_USER','GATEPASS_AUTH_DB_PASSWORD']:['GATEPASS_WORKER_DB_USER','GATEPASS_WORKER_DB_PASSWORD','GATEPASS_MAIL_SENDER','GATEPASS_GRAPH_TENANT_ID','GATEPASS_GRAPH_CLIENT_ID','GATEPASS_GRAPH_CLIENT_SECRET','GATEPASS_MAIL_DIRECTORY_MODULE','GATEPASS_EMAIL_LINKS_MODULE','GATEPASS_MAIL_PHOTOS_ROOT']),...(env.GATEPASS_OUTLOOK_ACTIONS_ENABLED==='true'?['GATEPASS_OUTLOOK_PROVIDER_ID','GATEPASS_OUTLOOK_TENANT_ID','GATEPASS_OUTLOOK_APPLICATION_ID','GATEPASS_OUTLOOK_SCOPE','GATEPASS_OUTLOOK_KEYS_MODULE',...(service==='api'?['GATEPASS_OUTLOOK_DB_USER','GATEPASS_OUTLOOK_DB_PASSWORD']:[])]:[])];
 const bad=new Set(required.filter(key=>!env[key]?.trim()));
 if(env.NODE_ENV!=='production')bad.add('NODE_ENV');
 for(const [key,expected] of [['GATEPASS_SSO_MODE','corporate'],['GATEPASS_DIRECTORY_MODE','api'],['GATEPASS_MAIL_AUTH_MODE','application']])if(env[key]!==undefined&&env[key]!==expected)bad.add(key);
 try{const url=new URL(env.GATEPASS_ORIGIN??'');if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)bad.add('GATEPASS_ORIGIN');}catch{bad.add('GATEPASS_ORIGIN');}
 const port=Number(env.GATEPASS_DB_PORT);if(!Number.isInteger(port)||port<1||port>65535)bad.add('GATEPASS_DB_PORT');
 if(env.GATEPASS_DB_NAME==='GatePass_DesignTest')bad.add('GATEPASS_DB_NAME');
 if(env.GATEPASS_OUTLOOK_ACTIONS_ENABLED!==undefined&&!['true','false'].includes(env.GATEPASS_OUTLOOK_ACTIONS_ENABLED))bad.add('GATEPASS_OUTLOOK_ACTIONS_ENABLED');
 if(service==='api'){
  const key=env.GATEPASS_SOURCE_KEY??'';if(!/^[A-Za-z0-9_-]{43}$/u.test(key)||Buffer.from(key,'base64url').length!==32||Buffer.from(key,'base64url').toString('base64url')!==key)bad.add('GATEPASS_SOURCE_KEY');
  if(env.GATEPASS_API_DB_USER&&env.GATEPASS_AUTH_DB_USER&&env.GATEPASS_API_DB_USER.toLowerCase()===env.GATEPASS_AUTH_DB_USER.toLowerCase())bad.add('GATEPASS_AUTH_DB_USER');
 }
 for(const key of ['GATEPASS_TLS_KEY_FILE','GATEPASS_TLS_CERT_FILE','GATEPASS_MAIL_DIRECTORY_MODULE','GATEPASS_EMAIL_LINKS_MODULE','GATEPASS_MAIL_PHOTOS_ROOT'])if(required.includes(key)&&env[key]&&!isAbsolute(env[key]!))bad.add(key);
 if(service==='email')for(const key of ['GATEPASS_GRAPH_TENANT_ID','GATEPASS_GRAPH_CLIENT_ID'])if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(env[key]??''))bad.add(key);
 if(service==='email'&&!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/u.test(env.GATEPASS_MAIL_SENDER??''))bad.add('GATEPASS_MAIL_SENDER');
 return [...bad].sort();
}
export function requireServiceConfiguration(service:'api'|'email'){if(configurationProblems(service).length)throw Error('SERVICE_ENV_CONFIGURATION_INVALID');}
