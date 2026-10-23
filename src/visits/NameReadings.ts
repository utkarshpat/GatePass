// Optional display aid only. Never used for identity, matching, approval or authorization.
export const nameLocales = ['hi','kn','ta','mr'] as const;
export type NameLocale = typeof nameLocales[number];
export type NameReadingProvider = (name:string,locale:NameLocale)=>Promise<string|null>;
const scripts = {hi:/\p{Script=Devanagari}/u,kn:/\p{Script=Kannada}/u,ta:/\p{Script=Tamil}/u,mr:/\p{Script=Devanagari}/u};
const safeName=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=200&&!/[\u0000-\u001f\u007f<>]/u.test(v);
const normalize=(v:string)=>v.normalize('NFC').trim().replace(/\s+/gu,' ');
export class NameReadingError extends Error {
 code:'INVALID_INPUT'|'BUSY';
 constructor(code:NameReadingError['code']){super(code);this.code=code;}
}
/** Uses an undocumented public Input Tools endpoint, not the paid Google Cloud API.
 * Opt in explicitly; no subscription, billing account, model or third-party JS is loaded.
 */
export function googleInputTools(fetcher:typeof fetch=fetch):NameReadingProvider {
 return async(name,locale)=>{
  const url=new URL('https://inputtools.google.com/request');
  url.search=new URLSearchParams({text:name,itc:locale+'-t-i0-und',num:'1',ie:'utf-8',oe:'utf-8'}).toString();
  const response=await fetcher(url,{signal:AbortSignal.timeout(5000),redirect:'error',headers:{Accept:'application/json'}});
  if(!response.ok||Number(response.headers.get('content-length'))>32768)return null;
  // Bound streamed data even when the provider omits Content-Length.
  if(!response.body)return null;const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>32768){await reader.cancel();return null;}chunks.push(value);}}
  finally{reader.releaseLock();}
  const data:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!Array.isArray(data)||data[0]!=='SUCCESS'||!Array.isArray(data[1])||data[1].length!==1)return null;
  const row=data[1][0];if(!Array.isArray(row)||row[0]!==name||!Array.isArray(row[1]))return null;
  return typeof row[1][0]==='string'?row[1][0]:null;
 };
}
export class NameReadings {
 #provider:NameReadingProvider|null;#cache=new Map<string,{text:string|null;until:number}>();
 #pending=new Map<string,Promise<string|null>>();#active=0;#queue:(()=>void)[]=[];#clock:()=>number;
 constructor(provider:NameReadingProvider|null,clock=Date.now){this.#provider=provider;this.#clock=clock;}
 async read(value:unknown){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new NameReadingError('INVALID_INPUT');
  const d=value as Record<string,unknown>;
  if(Object.keys(d).sort().join('|')!=='locale|names'||!nameLocales.includes(d.locale as NameLocale)||!Array.isArray(d.names)||d.names.length<1||d.names.length>10||!d.names.every(safeName))throw new NameReadingError('INVALID_INPUT');
  const locale=d.locale as NameLocale,names=d.names as string[];
  const items=await Promise.all(names.map(async name=>({name,reading:await this.#one(normalize(name),locale)})));
  return{locale,items};
 }
 async #one(name:string,locale:NameLocale):Promise<string|null>{
  // Already-native and non-Roman names remain intact; do not guess a different identity.
  if(!this.#provider||!/^[\p{Script=Latin}\p{Mark}\d .'’-]+$/u.test(name)||!/[a-z]/iu.test(name))return null;
  const key=locale+':'+name.toLowerCase(),cached=this.#cache.get(key);
  if(cached&&cached.until>this.#clock()){this.#cache.delete(key);this.#cache.set(key,cached);return cached.text;}
  if(this.#pending.has(key))return this.#pending.get(key)!;
  if(this.#pending.size>=40)throw new NameReadingError('BUSY');
  const pending=this.#run(name,locale).then(text=>{
   this.#cache.set(key,{text,until:this.#clock()+(text===null?60000:86400000)});
   while(this.#cache.size>2000)this.#cache.delete(this.#cache.keys().next().value!);
   return text;
  }).finally(()=>this.#pending.delete(key));
  this.#pending.set(key,pending);return pending;
 }
 async #run(name:string,locale:NameLocale){
  const deadline=this.#clock()+12000;
  if(this.#active>=2)await new Promise<void>(resolve=>this.#queue.push(resolve));
  else this.#active++;
  try{
   if(this.#clock()>deadline)return null;
   const value=await this.#provider!(name,locale);
   // Reject HTML, control characters and a response written in the wrong script.
   if(typeof value!=='string'||value.length>400||!scripts[locale].test(value)||/[\u0000-\u001f\u007f<>]/u.test(value))return null;
   const rest=value.replace(locale==='kn'?/[\p{Script=Kannada}]/gu:locale==='ta'?/[\p{Script=Tamil}]/gu:/[\p{Script=Devanagari}]/gu,'');
   return /^[\p{Script=Latin}\p{Mark}\p{Number}\p{Punctuation}\p{Separator}\u200c\u200d]*$/u.test(rest)?value.normalize('NFC'):null;
  }catch{return null;}
  finally{const next=this.#queue.shift();if(next)next();else this.#active--;}
 }
}
