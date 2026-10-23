import test from 'node:test';import assert from 'node:assert/strict';
import {FileQrKeySource} from '../src/storage/FileQrKeySource.ts';
import type {PrivateDirectory} from '../src/storage/PrivateDirectory.ts';
const id='k_'+'a'.repeat(32),other='k_'+'b'.repeat(32),third='k_'+'c'.repeat(32);
function fixture(options:{cacheTtlMs?:number;maximumCachedKeys?:number}={}){
 const records=new Map<string,Buffer>();for(const [index,name]of [id,other,third].entries())records.set(name,Buffer.from(JSON.stringify({schemaVersion:1,id:name,scheme:'test',protectedKey:Buffer.from([index+1]).toString('base64')})));
 let calls=0,release:()=>void=()=>{};let gate:Promise<void>|null=null;const decoded:Buffer[]=[];
 const source=new FileQrKeySource({async read(path:string){const value=records.get(path.slice(9,-5));if(!value)throw Error('missing key');return value;}} as unknown as PrivateDirectory,{scheme:'test',async protect(){throw Error('unused');},async unprotect(_name,bytes){calls++;if(gate)await gate;const key=Buffer.alloc(32,bytes[0]);decoded.push(key);return key;}},options);
 return{source,records,decoded,calls:()=>calls,hold(){gate=new Promise<void>(resolve=>{release=resolve;});},release(){release();gate=null;}};
}
test('key cache returns independent copies, coalesces unprotect and wipes temporary decoded buffers',async()=>{
 const f=fixture();f.hold();const requests=Array.from({length:12},()=>f.source.resolve(id));await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls(),1);f.release();
 const keys=await Promise.all(requests);assert(keys.every(key=>key.equals(Buffer.alloc(32,1))));keys[0].fill(0);assert.equal(keys[1][0],1);assert.equal(f.calls(),1);assert(f.decoded.every(key=>key.every(v=>v===0)));f.source.clearCache();
});
test('warm cache never hides deleted or malformed protected files and changed bytes require new unprotect',async()=>{
 const f=fixture();await f.source.resolve(id);const original=f.records.get(id)!;
 f.records.delete(id);await assert.rejects(f.source.resolve(id),/missing/u);
 f.records.set(id,original);await f.source.resolve(id);assert.equal(f.calls(),2);
 f.records.set(id,Buffer.from('{}'));await assert.rejects(f.source.resolve(id),/INVALID/u);
 const record=JSON.parse(original.toString());record.protectedKey=Buffer.from([9]).toString('base64');f.records.set(id,Buffer.from(JSON.stringify(record)));
 assert.equal((await f.source.resolve(id))[0],9);assert.equal(f.calls(),3);f.source.clearCache();
});
test('short cache expires, explicit clearing re-decrypts, and disabled cache never reuses keys',async()=>{
 const f=fixture({cacheTtlMs:20});await f.source.resolve(id);await f.source.resolve(id);assert.equal(f.calls(),1);
 await new Promise(resolve=>setTimeout(resolve,35));await f.source.resolve(id);assert.equal(f.calls(),2);f.source.clearCache();await f.source.resolve(id);assert.equal(f.calls(),3);f.source.clearCache();
 const disabled=fixture({cacheTtlMs:0});await disabled.source.resolve(id);await disabled.source.resolve(id);assert.equal(disabled.calls(),2);
});
test('key cache is bounded with least-recently-used eviction across versions',async()=>{
 const f=fixture({maximumCachedKeys:2});for(const name of [id,other,id,third,other])await f.source.resolve(name);assert.equal(f.calls(),4);f.source.clearCache();
});
test('invalid settings and IDs cannot initiate unprotect',async()=>{
 const f=fixture();await assert.rejects(f.source.resolve('../key'),/INVALID/u);assert.equal(f.calls(),0);assert.throws(()=>fixture({cacheTtlMs:60001}));assert.throws(()=>fixture({maximumCachedKeys:0}));
});
test('a protected file removed while unprotect is pending cannot populate a usable cache hit',async()=>{
 const f=fixture();f.hold();const request=f.source.resolve(id);await new Promise(resolve=>setImmediate(resolve));f.records.delete(id);f.release();
 await assert.rejects(request,/missing/u);await assert.rejects(f.source.resolve(id),/missing/u);assert.equal(f.calls(),1);f.source.clearCache();
});
