import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {PrivateDirectory} from '../src/storage/PrivateDirectory.ts';
import {GuardPasswordHasher} from '../src/security/GuardPasswordHasher.ts';
import {resolvePowerShell} from '../src/runtime/PowerShellRuntime.mjs';
if(!['development','test'].includes(process.env.NODE_ENV??'')||process.env.GATEPASS_DIRECTORY_MODE!=='mock')throw Error('EXPLICIT_DEVELOPMENT_MODE_REQUIRED');
const directory=await PrivateDirectory.create(join(homedir(),'.gatepass','development-logins'),[process.cwd()]);
await directory.exclusive('.enrollment.lock',async()=>{
 const fixture=JSON.parse(await readFile(new URL('../database/development/external-staff-fixtures.json',import.meta.url),'utf8'));
 let accounts:any[];
 try{accounts=JSON.parse((await directory.read('staff.json',32768)).toString());}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;accounts=[];const hasher=new GuardPasswordHasher();for(const g of fixture.staff){const password='GP-'+randomBytes(15).toString('base64url');accounts.push({staffId:g.staffId,loginId:g.loginId,password,encodedHash:await hasher.hash(password)});}await directory.write('staff.json',Buffer.from(JSON.stringify(accounts,null,2)));}
 const hasher=new GuardPasswordHasher();let added=false;for(const f of fixture.staff){if(!accounts.some(g=>g.staffId===f.staffId)){const password='GP-'+randomBytes(15).toString('base64url');accounts.push({staffId:f.staffId,loginId:f.loginId,password,encodedHash:await hasher.hash(password)});added=true;}}
 if(added)await directory.write('staff.json',Buffer.from(JSON.stringify(accounts,null,2)),true);
 const selected=fixture.staff.map((f:any)=>accounts.find((g:any)=>g.staffId===f.staffId));
 if(selected.length!==10||selected.some((g:any,i:number)=>!g||g.loginId!==fixture.staff[i].loginId||typeof g.password!=='string'||typeof g.encodedHash!=='string'))throw Error('PRIVATE_FIXTURE_MISMATCH');
 const input=selected.map((g:any,i:number)=>({...fixture.staff[i],encodedHash:g.encodedHash}));
 const result=await new Promise<string>((resolve,reject)=>{
  const child=spawn(resolvePowerShell(),['-NoProfile','-File',fileURLToPath(new URL('./Seed-DevelopmentStaffCredentials.ps1',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe']});let output='';const timer=setTimeout(()=>{child.kill();reject(Error('STAFF_ENROLLMENT_TIMEOUT'));},30000);
  child.stdout.on('data',x=>{output+=x;if(output.length>4096)child.kill();});child.stderr.resume();child.on('error',reject);child.stdin.on('error',()=>{});child.on('close',code=>{clearTimeout(timer);code===0?resolve(output):reject(Error('STAFF_ENROLLMENT_FAILED '+output));});child.stdin.end(JSON.stringify(input));
 });
 const state=JSON.parse(result);if(state.total!==10)throw Error('STAFF_ENROLLMENT_INCOMPLETE');
 console.log(JSON.stringify({status:'PASS',created:state.created,total:state.total,credentialsFile:directory.path('staff.json'),passwordsPrinted:false,fixtureScopesOnly:true}));
});
