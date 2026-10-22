import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/app/admin.js',import.meta.url),'utf8');
function fixture(fetch:any){let timer=()=>{},cleared=0;const context:any={csrf:()=>'',AbortController,fetch,location:{replace(){}},setTimeout(cb:()=>void,ms:number){assert.equal(ms,30000);timer=cb;return 1;},clearTimeout(){cleared++;}};vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function api('),source.indexOf('\nfunction node')),context);return{run:context.api,expire:()=>timer(),cleared:()=>cleared};}
test('admin deadline covers slow response bodies and preserves mutation requests for safe retries',async()=>{
 let body:any;const f=fixture(async(_url:any,options:any)=>{body=JSON.parse(options.body);return{ok:true,json:()=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted'))))};});
 const pending=f.run('grant',{clientKey:'retained'});await new Promise(resolve=>setImmediate(resolve));f.expire();await assert.rejects(pending,/Request timed out/u);assert.equal(body.clientKey,'retained');assert.equal(f.cleared(),1);
});
test('admin HTTP denials remain authorization failures rather than network errors',async()=>{
 const f=fixture(async()=>({ok:false,status:403}));await assert.rejects(f.run('scope'),(error:any)=>error.status===403);assert.equal(f.cleared(),1);
 const success=fixture(async()=>({ok:true,json:async()=>({ok:true})}));assert.equal((await success.run('scope')).ok,true);assert.equal(success.cleared(),1);
});
