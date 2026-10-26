import{createHash}from'node:crypto';
/** Content-keyed, bounded process memory only. Callers must authorize every read. */
export class PhotoThumbnails{
 #sharp:any;#cache=new Map<string,{bytes:Buffer;until:number}>();#pending=new Map<string,Promise<Buffer>>();#clock:()=>number;#closed=false;
 constructor(sharp:any,clock=Date.now){this.#sharp=sharp;this.#clock=clock;}
 #drop(key:string){this.#cache.get(key)?.bytes.fill(0);this.#cache.delete(key);}
 async read(source:Buffer){
  return this.#read(createHash('sha256').update(source).digest('hex'),async()=>({source,owned:false}));
 }
 async readHashed(hash:string,load:()=>Promise<Buffer>){
  if(!/^[a-f0-9]{64}$/u.test(hash))throw Error('THUMBNAIL_UNAVAILABLE');
  // The loader transfers ownership of its private source buffer.
  return this.#read(hash,async()=>{const source=await load();if(!Buffer.isBuffer(source))throw Error('THUMBNAIL_UNAVAILABLE');if(createHash('sha256').update(source).digest('hex')!==hash){source.fill(0);throw Error('THUMBNAIL_UNAVAILABLE');}return{source,owned:true};});
 }
 async #read(key:string,load:()=>Promise<{source:Buffer;owned:boolean}>){
  if(this.#closed)throw Error('THUMBNAILS_CLOSED');
  for(const[key,item]of this.#cache)if(item.until<=this.#clock())this.#drop(key);
  const cached=this.#cache.get(key);
  if(cached){this.#cache.delete(key);this.#cache.set(key,cached);return Buffer.from(cached.bytes);}
  let pending=this.#pending.get(key);
  if(!pending){
   if(this.#pending.size>=4)throw Error('THUMBNAILS_BUSY');
   pending=(async()=>{const {source,owned}=await load();try{const bytes:Buffer=await this.#sharp(source).rotate().resize({width:192,height:256,fit:'cover',withoutEnlargement:true}).jpeg({quality:72,mozjpeg:true}).toBuffer();
    if(this.#closed||bytes.length>65536){bytes.fill(0);throw Error('THUMBNAIL_UNAVAILABLE');}
    while(this.#cache.size>=128)this.#drop(this.#cache.keys().next().value!);
    this.#cache.set(key,{bytes,until:this.#clock()+300000});return bytes;}finally{if(owned)source.fill(0);}
   })().finally(()=>this.#pending.delete(key));this.#pending.set(key,pending);
  }
  return Buffer.from(await pending);
 }
 close(){this.#closed=true;for(const key of this.#cache.keys())this.#drop(key);}
}
