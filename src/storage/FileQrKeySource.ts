import { randomBytes,randomUUID } from 'node:crypto';
import type { QrKeySource } from '../registration/QrCredentialEnvelope.ts';
import type { KeyProtector } from './PlatformProtection.ts';
import { PrivateDirectory } from './PrivateDirectory.ts';
const valid=(id:unknown):id is string=>typeof id==='string'&&/^k_[0-9a-f]{32}$/u.test(id);
export class FileQrKeySource implements QrKeySource {
  #directory:PrivateDirectory;#protector:KeyProtector;
  constructor(directory:PrivateDirectory,protector:KeyProtector){this.#directory=directory;this.#protector=protector;}
  async #manifest(){const value=JSON.parse((await this.#directory.read('active.json',4096)).toString('utf8'));
    if(value?.schemaVersion!==1||value.scheme!==this.#protector.scheme||!valid(value.activeId))throw new Error('INVALID_QR_KEY_MANIFEST');return value as {schemaVersion:1;scheme:string;activeId:string};}
  async #newKey(){const id='k_'+randomUUID().replaceAll('-','');const key=randomBytes(32);
    try{const protectedKey=await this.#protector.protect(id,key);if(!Buffer.isBuffer(protectedKey)||protectedKey.length<1||protectedKey.length>16384)throw new Error('INVALID_KEY_PROTECTOR');
      await this.#directory.write('versions/'+id+'.json',Buffer.from(JSON.stringify({schemaVersion:1,id,scheme:this.#protector.scheme,protectedKey:protectedKey.toString('base64')})));
      await this.#directory.write('active.json',Buffer.from(JSON.stringify({schemaVersion:1,scheme:this.#protector.scheme,activeId:id})),true);
      return {id,scheme:this.#protector.scheme};
    }finally{key.fill(0);}}
  async initialize(){return this.#directory.exclusive('.key-write.lock',async()=>{
    try{const manifest=await this.#manifest();const key=await this.resolve(manifest.activeId);key.fill(0);return {id:manifest.activeId,scheme:manifest.scheme};}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;const files=(await this.#directory.inventory()).filter(x=>x.key!=='.key-write.lock');if(files.length)throw new Error('QR_MANIFEST_MISSING_WITH_EXISTING_KEYS');return this.#newKey();}
  });}
  async rotate(){return this.#directory.exclusive('.key-write.lock',async()=>{const current=await this.#manifest();const key=await this.resolve(current.activeId);key.fill(0);const files=await this.#directory.inventory();if(files.filter(x=>x.key.startsWith('versions/')).length>=1000)throw new Error('QR_KEY_VERSION_LIMIT');return this.#newKey();});}
  async active(){const manifest=await this.#manifest();return {id:manifest.activeId,key:await this.resolve(manifest.activeId)};}
  async resolve(id:string){if(!valid(id))throw new Error('INVALID_QR_KEY_ID');const value=JSON.parse((await this.#directory.read('versions/'+id+'.json',32768)).toString('utf8'));
    if(value?.schemaVersion!==1||value.id!==id||value.scheme!==this.#protector.scheme||typeof value.protectedKey!=='string'||Buffer.from(value.protectedKey,'base64').toString('base64')!==value.protectedKey)throw new Error('INVALID_PROTECTED_QR_KEY');
    const protectedKey=Buffer.from(value.protectedKey,'base64');if(protectedKey.length<1||protectedKey.length>16384)throw new Error('INVALID_PROTECTED_QR_KEY');
    const key=await this.#protector.unprotect(id,protectedKey);if(!Buffer.isBuffer(key)||key.length!==32)throw new Error('INVALID_PROTECTED_QR_KEY');return key;
  }
  async versions(){const manifest=await this.#manifest();return (await this.#directory.inventory()).filter(x=>/^versions\/k_[0-9a-f]{32}\.json$/u.test(x.key)).map(x=>{const id=x.key.slice(9,-5);return{id,active:id===manifest.activeId};});}
}
