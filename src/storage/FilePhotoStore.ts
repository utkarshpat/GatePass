import { PrivateDirectory } from './PrivateDirectory.ts';
import type { PrivatePhotoStore } from '../registration/RegistrationPhoto.ts';
import type { PrivatePhotoReader } from '../visits/VisitReadService.ts';
const photo=/^intakes\/[0-9a-f]{32}\/[0-9a-f]{32}\.(jpg|png|webp)$/u;
/** Internal storage port only. VisitPhotoService/renderer must authorize reads through SQL. */
export class FilePhotoStore implements PrivatePhotoStore,PrivatePhotoReader {
  #directory:PrivateDirectory;#bytes:number;#files:number;
  constructor(directory:PrivateDirectory,limits={maximumBytes:512*1024*1024,maximumFiles:10000}){
    if(!Number.isSafeInteger(limits.maximumBytes)||limits.maximumBytes<1||!Number.isSafeInteger(limits.maximumFiles)||limits.maximumFiles<1)throw new Error('INVALID_PHOTO_QUOTA');
    this.#directory=directory;this.#bytes=limits.maximumBytes;this.#files=limits.maximumFiles;
  }
  async putIfAbsent(key:string,bytes:Buffer){
    if(!photo.test(key)||!key.endsWith('.jpg')||!Buffer.isBuffer(bytes)||bytes.length<4||bytes.length>5242880||!bytes.subarray(0,3).equals(Buffer.from([255,216,255])))throw new Error('INVALID_STORED_PHOTO');
    await this.#directory.exclusive('.photos-write.lock',async()=>{
      const files=(await this.#directory.inventory()).filter(x=>x.key!=='.photos-write.lock');
      if(files.length>=this.#files||files.reduce((sum,x)=>sum+x.bytes,0)+bytes.length>this.#bytes)throw new Error('PHOTO_STORAGE_QUOTA_EXCEEDED');
      await this.#directory.write(key,bytes);
    });
  }
  async read(key:string,maximumBytes:number){if(!photo.test(key)||!Number.isInteger(maximumBytes)||maximumBytes<1||maximumBytes>5242880)throw new Error('INVALID_PHOTO_READ');return this.#directory.read(key,maximumBytes);}
  async usage(){const files=(await this.#directory.inventory()).filter(x=>x.key!=='.photos-write.lock');return {files:files.length,bytes:files.reduce((sum,x)=>sum+x.bytes,0),maximumFiles:this.#files,maximumBytes:this.#bytes};}
}
