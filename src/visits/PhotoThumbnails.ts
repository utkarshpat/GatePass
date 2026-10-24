import{createHash}from'node:crypto';
/** Content-keyed, bounded process memory only. Callers must authorize every read. */
export class PhotoThumbnails{
 #sharp:any;#cache=new Map<string,{bytes:Buffer;until:number}>();#pending=new Map<string,Promise<Buffer>>();#clock:()=>number;#closed=false;
 constructor(sharp:any,clock=Date.now){this.#sharp=sharp;this.#clock=clock;}
 #drop(key:string){this.#cache.get(key)?.bytes.fill(0);this.#cache.delete(key);}
 async read(source:Buffer){
  if(this.#closed)throw Error('THUMBNAILS_CLOSED');
  for(const[key,item]of this.#cache)if(item.until<=this.#clock())this.#drop(key);
  const key=createHash('sha256').update(source).digest('hex'),cached=this.#cache.get(key);
  if(cached){this.#cache.delete(key);this.#cache.set(key,cached);return Buffer.from(cached.bytes);}
  let pending=this.#pending.get(key);
  if(!pending){
   if(this.#pending.size>=4)throw Error('THUMBNAILS_BUSY');
   pending=(async()=>{const bytes:Buffer=await this.#sharp(source).rotate().resize({width:192,height:256,fit:'cover',withoutEnlargement:true}).jpeg({quality:72,mozjpeg:true}).toBuffer();
    if(this.#closed||bytes.length>65536){bytes.fill(0);throw Error('THUMBNAIL_UNAVAILABLE');}
    while(this.#cache.size>=128)this.#drop(this.#cache.keys().next().value!);
    this.#cache.set(key,{bytes,until:this.#clock()+300000});return bytes;
   })().finally(()=>this.#pending.delete(key));this.#pending.set(key,pending);
  }
  return Buffer.from(await pending);
 }
 close(){this.#closed=true;for(const key of this.#cache.keys())this.#drop(key);}
}
