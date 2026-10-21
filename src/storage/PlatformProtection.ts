import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolvePowerShell } from '../runtime/PowerShellRuntime.mjs';
export async function windowsProtection(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  if(process.platform!=='win32')throw new Error('WINDOWS_PROTECTION_REQUIRED');
  return new Promise((resolve,reject)=>{
    const child=spawn(resolvePowerShell(),['-NoProfile','-File',fileURLToPath(new URL('../../tools/PrivateStorage.Windows.ps1',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='';let size=0;const timer=setTimeout(()=>{child.kill();reject(new Error('PRIVATE_STORAGE_PROTECTION_UNAVAILABLE'));},15000);
    child.stdout.on('data',part=>{size+=part.length;if(size>65536){child.kill();reject(new Error('PRIVATE_STORAGE_PROTECTION_UNAVAILABLE'));}else output+=part;});child.stderr.resume();
    child.on('error',()=>{clearTimeout(timer);reject(new Error('PRIVATE_STORAGE_PROTECTION_UNAVAILABLE'));});
    child.on('close',code=>{clearTimeout(timer);try{const result=JSON.parse(output);if(code!==0||result.ok!==true)throw new Error();resolve(result);}catch{reject(new Error('PRIVATE_STORAGE_PROTECTION_UNAVAILABLE'));}});
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));
  });
}
export interface KeyProtector { readonly scheme: string; protect(id:string,key:Buffer):Promise<Buffer>; unprotect(id:string,bytes:Buffer):Promise<Buffer> }
export class WindowsCurrentUserKeyProtector implements KeyProtector {
  readonly scheme='windows-dpapi-current-user-v1';
  async protect(id:string,key:Buffer){const result=await windowsProtection({action:'protect',id,bytes:key.toString('base64')});return Buffer.from(String(result.bytes),'base64');}
  async unprotect(id:string,bytes:Buffer){const result=await windowsProtection({action:'unprotect',id,bytes:bytes.toString('base64')});const key=Buffer.from(String(result.bytes),'base64');if(key.length!==32){key.fill(0);throw new Error('INVALID_PROTECTED_QR_KEY');}return key;}
}
