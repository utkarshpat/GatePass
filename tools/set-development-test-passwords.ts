// Explicit synthetic fixture reset; never imported by application startup.
import {argon2,randomBytes} from 'node:crypto';
import {readFile,unlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {homedir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
import {PrivateDirectory} from '../src/storage/PrivateDirectory.ts';
import {GuardPasswordHasher} from '../src/security/GuardPasswordHasher.ts';
import {resolvePowerShell} from '../src/runtime/PowerShellRuntime.mjs';
if(!['development','test'].includes(process.env.NODE_ENV??'')||process.env.GATEPASS_DIRECTORY_MODE!=='mock')throw Error('EXPLICIT_DEVELOPMENT_MODE_REQUIRED');
const directory=await PrivateDirectory.create(join(homedir(),'.gatepass','development-logins'),[process.cwd()]);
await directory.exclusive('.enrollment.lock',async()=>{
 const guards=JSON.parse((await directory.read('guards.json',32768)).toString()),staff=JSON.parse((await directory.read('staff.json',32768)).toString());
 const gf=JSON.parse(await readFile(new URL('../database/development/staff-fixtures.json',import.meta.url),'utf8')).guards;
 const sf=JSON.parse(await readFile(new URL('../database/development/external-staff-fixtures.json',import.meta.url),'utf8')).staff;
 const selected=[...gf.map((f:any)=>guards.find((a:any)=>a.guardId===f.guardId&&a.loginId===f.loginId)),...sf.map((f:any)=>staff.find((a:any)=>a.staffId===f.staffId&&a.loginId===f.loginId))];
 if(selected.length!==22||selected.some(a=>!a)||new Set(selected.map(a=>a.loginId)).size!==22)throw Error('FIXTURE_SET_MISMATCH');
 const rows:{loginId:string;oldHash:string;newHash:string}[]=[];const verifier=new GuardPasswordHasher();
 for(const a of selected){const salt=randomBytes(16),tag=await new Promise<Buffer>((resolve,reject)=>argon2('argon2id',{message:Buffer.from('Sopra@123'),nonce:salt,parallelism:1,tagLength:32,memory:19456,passes:2},(e,r)=>e?reject(e):resolve(r)));const encoded='$argon2id$v=19$m=19456,t=2,p=1$'+salt.toString('base64').replace(/=+$/u,'')+'$'+tag.toString('base64').replace(/=+$/u,'');tag.fill(0);if(!await verifier.verify('Sopra@123',encoded))throw Error('HASH_VERIFICATION_FAILED');rows.push({loginId:a.loginId,oldHash:a.encodedHash,newHash:encoded});a.password='Sopra@123';a.encodedHash=encoded;}
 await directory.write('test-password-reset.pending.json',Buffer.from(JSON.stringify({guards,staff})),true);
 const output=await new Promise<string>((resolve,reject)=>{const c=spawn(resolvePowerShell(),['-NoProfile','-File',fileURLToPath(new URL('./Set-DevelopmentTestPasswords.ps1',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='';c.stdout.on('data',b=>out+=b);c.stderr.resume();c.on('error',reject);c.on('close',code=>code===0?resolve(out):reject(Error('SYNTHETIC_RESET_FAILED '+out)));c.stdin.on('error',()=>{});c.stdin.end(JSON.stringify(rows));});
 if(JSON.parse(output).updated!==22)throw Error('RESET_COUNT_MISMATCH');
 await directory.write('guards.json',Buffer.from(JSON.stringify(guards,null,2)),true);await directory.write('staff.json',Buffer.from(JSON.stringify(staff,null,2)),true);
 await unlink(directory.path('test-password-reset.pending.json'));
 console.log('PASS: 22 active synthetic local accounts updated; protected inventories synchronised; previous sessions revoked. Retired/disabled accounts and production password policy unchanged.');
});
