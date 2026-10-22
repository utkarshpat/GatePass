import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/app/reception.js',import.meta.url),'utf8');
function apiFixture(fetch:typeof globalThis.fetch){let timer:()=>void=()=>{},cleared=0;const context:any={cookie:()=>undefined,AbortController,fetch,setTimeout(cb:()=>void,ms:number){assert.equal(ms,30000);timer=cb;return 1;},clearTimeout(){cleared++;},showLogin(){}};vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function api('),source.indexOf('\nstate.pendingPrint=')),context);return{run:context.api,expire:()=>timer(),cleared:()=>cleared};}
test('reception request deadline covers a stalled response body as well as connection setup',async()=>{
 let reading=false;const f=apiFixture(async(_url,options)=>({ok:true,json(){reading=true;return new Promise((_resolve,reject)=>{options!.signal!.addEventListener('abort',()=>reject(Object.assign(new Error(),{name:'AbortError'})),{once:true});});}}) as any);
 const pending=f.run('list');await new Promise(resolve=>setImmediate(resolve));assert.equal(reading,true);assert.equal(f.cleared(),0);f.expire();await assert.rejects(pending,/Request timed out/u);assert.equal(f.cleared(),1);
});
test('reception request deadline is cleaned up after success and HTTP failures retain their safe status',async()=>{
 const f=apiFixture(async()=>({ok:true,json:async()=>({visits:[]})}) as any);assert.equal((await f.run('list')).visits.length,0);assert.equal(f.cleared(),1);
 const denied=apiFixture(async()=>({ok:false,status:403}) as any);await assert.rejects(denied.run('list'),(e:any)=>e.status===403&&!e.message.includes('Connection'));assert.equal(denied.cleared(),1);
});
