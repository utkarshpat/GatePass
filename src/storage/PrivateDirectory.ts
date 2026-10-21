import { mkdir,lstat,realpath,open,unlink,rename,link,readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute,resolve,relative,dirname,parse,join,sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { windowsProtection } from './PlatformProtection.ts';
const normalized=(p:string)=>process.platform==='win32'?resolve(p).toLowerCase():resolve(p);
export const inside=(root:string,path:string)=>normalized(root)===normalized(path)||normalized(path).startsWith(normalized(root)+sep);
async function noLinks(path:string){
  const absolute=resolve(path);const parts=absolute.slice(parse(absolute).root.length).split(sep).filter(Boolean);let current=parse(absolute).root;
  for(const part of parts){current=join(current,part);const item=await lstat(current);if(item.isSymbolicLink()||!item.isDirectory())throw new Error('PRIVATE_DIRECTORY_LINK_OR_NON_DIRECTORY');}
}
/** Restrictive OS ownership is mandatory; same-account/admin compromise is outside this boundary. */
export class PrivateDirectory {
  readonly root:string;
  private constructor(root:string){this.root=root;}
  static async create(root:string,forbiddenRoots:string[]){
    if(!isAbsolute(root)||resolve(root)===parse(resolve(root)).root||forbiddenRoots.some(p=>inside(p,root)||inside(root,p)))throw new Error('INVALID_PRIVATE_STORAGE_ROOT');
    const target=resolve(root);const missing:string[]=[];let parent=target;
    while(true){try{await lstat(parent);break;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;missing.unshift(parent);parent=dirname(parent);}}
    await noLinks(parent);for(const directory of missing)await mkdir(directory,{mode:0o700});await noLinks(target);
    // Packaged Windows apps may virtualize LocalAppData without a filesystem
    // symlink. Pin the actual location, recheck boundaries, and use it thereafter.
    const canonical=await realpath(target);await noLinks(canonical);
    if(forbiddenRoots.some(p=>inside(p,canonical)||inside(canonical,p)))throw new Error('INVALID_PRIVATE_STORAGE_ROOT');
    if(process.platform==='win32'){await windowsProtection({action:missing.includes(target)?'seal':'verify',path:canonical});}
    else{const stat=await lstat(canonical);if((stat.mode&0o077)!==0||stat.uid!==process.getuid?.())throw new Error('PRIVATE_DIRECTORY_PERMISSIONS_REQUIRED');}
    return new PrivateDirectory(canonical);
  }
  async validate(){await noLinks(this.root);if(normalized(await realpath(this.root))!==normalized(this.root))throw new Error('PRIVATE_DIRECTORY_ALIAS_REJECTED');}
  path(key:string){if(typeof key!=='string'||!/^[A-Za-z0-9._/-]+$/u.test(key)||key.split('/').some(p=>!p||p==='.'||p==='..'||p.endsWith('.')||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(p))||!inside(this.root,resolve(this.root,key)))throw new Error('INVALID_PRIVATE_STORAGE_KEY');return resolve(this.root,key);}
  async parents(key:string){await this.validate();const path=this.path(key);const parts=relative(this.root,dirname(path)).split(sep).filter(Boolean);let current=this.root;
    for(const part of parts){current=join(current,part);try{await mkdir(current,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}const stat=await lstat(current);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('PRIVATE_DIRECTORY_LINK_OR_NON_DIRECTORY');}return path;}
  async read(key:string,maximum:number){await this.validate();const path=this.path(key);await noLinks(dirname(path));const before=await lstat(path);
    if(!Number.isInteger(maximum)||maximum<1||maximum>5242880||!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>maximum)throw new Error('INVALID_PRIVATE_FILE');
    const file=await open(path,constants.O_RDONLY|(process.platform==='win32'?0:constants.O_NOFOLLOW));
    try{const stat=await file.stat();if(stat.ino!==before.ino||stat.dev!==before.dev||!stat.isFile()||stat.nlink!==1)throw new Error('PRIVATE_FILE_CHANGED');const buffer=Buffer.alloc(maximum+1);let length=0;
      while(length<buffer.length){const {bytesRead}=await file.read(buffer,length,buffer.length-length,null);if(!bytesRead)break;length+=bytesRead;}if(length>maximum){buffer.fill(0);throw new Error('PRIVATE_FILE_TOO_LARGE');}return buffer.subarray(0,length);
    }finally{await file.close();}}
  async write(key:string,bytes:Buffer,replace=false){const path=await this.parents(key);const temp=join(dirname(path),'.tmp-'+randomUUID());const file=await open(temp,'wx',0o600);
    try{await file.writeFile(bytes);await file.sync();}catch(error){await file.close();await unlink(temp).catch(()=>{});throw error;}await file.close();
    try{if(replace)await rename(temp,path);else{await link(temp,path);await unlink(temp);}}finally{await unlink(temp).catch(()=>{});}}
  async exclusive<T>(name:string,action:()=>Promise<T>){await this.validate();const path=this.path(name);let lock;
    try{lock=await open(path,'wx',0o600);}catch{throw new Error('PRIVATE_STORE_BUSY');}
    try{return await action();}finally{await lock.close();await unlink(path);}}
  async inventory(){await this.validate();const result:{key:string;bytes:number}[]=[];
    const walk=async(key:string)=>{const path=key?this.path(key):this.root;for(const entry of await readdir(path)){const child=key?key+'/'+entry:entry;const stat=await lstat(this.path(child));if(stat.isSymbolicLink())throw new Error('PRIVATE_STORAGE_LINK_REJECTED');if(stat.isDirectory())await walk(child);else if(stat.isFile()&&stat.nlink===1)result.push({key:child,bytes:stat.size});else throw new Error('INVALID_PRIVATE_FILE');}};
    await walk('');return result;}
}
