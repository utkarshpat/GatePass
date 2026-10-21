import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createLoopbackHttpHandler } from '../src/development/LoopbackHttpHandler.ts';
import { DummySsoRoutes } from '../src/development/DummySsoRoutes.ts';
import { createApiHandler } from '../src/transport/ApiHandler.ts';
const previous={NODE_ENV:process.env.NODE_ENV,GATEPASS_SSO_MODE:process.env.GATEPASS_SSO_MODE,GATEPASS_DIRECTORY_MODE:process.env.GATEPASS_DIRECTORY_MODE};
before(()=>{process.env.NODE_ENV='test';process.env.GATEPASS_SSO_MODE='dummy';process.env.GATEPASS_DIRECTORY_MODE='mock';});
after(()=>{for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
async function call(options:{peer?:string;origin?:string;host?:string;method?:string;path?:string}={}) {
 const req=Object.assign(Readable.from([]),{method:options.method??'POST',url:options.path??'/api/dev/test',socket:{remoteAddress:options.peer??'127.0.0.1'},headers:{origin:options.origin??'http://localhost:8443',host:options.host??'localhost:8443'}}) as any;
 const headers:Record<string,string>={};let body='';const res={statusCode:0,setHeader(k:string,v:string){headers[k]=v;},end(v:string){body=v;}};
 await createLoopbackHttpHandler('http://localhost:8443',{handles:p=>p==='/api/dev/test',async handle(){return{ok:true};}})(req,res as any);return{status:res.statusCode,headers,body};
}
test('local HTTP works without TLS or HSTS and retains no-store',async()=>{const r=await call();assert.equal(r.status,200);assert.equal(r.headers['Cache-Control'],'no-store');assert.equal(r.headers['Strict-Transport-Security'],undefined);});
test('remote peer, wrong Host and wrong Origin are rejected',async()=>{for(const options of [{peer:'10.0.0.1'},{host:'attacker.example'},{origin:'http://attacker.example'}])assert.equal((await call(options)).status,403);});
test('only explicit POST routes run',async()=>{assert.equal((await call({method:'GET'})).status,405);assert.equal((await call({path:'/api/sql'})).status,404);});
test('HTTP adapter refuses production at construction and after startup',async()=>{process.env.NODE_ENV='production';assert.throws(()=>createLoopbackHttpHandler('http://localhost:8443',{} as any));process.env.NODE_ENV='test';const handler=createLoopbackHttpHandler('http://localhost:8443',{} as any);process.env.NODE_ENV='production';let status=0;await handler({resume(){}} as any,{setHeader(){},set statusCode(v){status=v;},end(){}} as any);assert.equal(status,503);process.env.NODE_ENV='test';});
test('HTTP origins must be exact localhost with an explicit port',()=>{for(const origin of ['http://0.0.0.0:8443','http://company.example:8443','https://localhost:8443','http://localhost:8443/'])assert.throws(()=>createLoopbackHttpHandler(origin,{} as any));});
test('standard API still rejects HTTP configuration',()=>{assert.throws(()=>createApiHandler({origin:'http://localhost:8443',sourceKey:Buffer.alloc(32),auth:{} as any,actions:new Map()}));});
test('HTTP dummy cookies use isolated development names and retain HttpOnly/CSRF',async()=>{
 let jar:string[]=[];const sso={async signIn(){return{sessionToken:Buffer.alloc(32,1).toString('base64url'),csrfToken:Buffer.alloc(32,2).toString('base64url'),employee:{employeeId:'EMP001'}};}};
 const req=Object.assign(Readable.from([Buffer.from('{"employeeId":"EMP001","password":"Sopra@123"}')]),{url:'/api/dev/sso/login',socket:{remoteAddress:'127.0.0.1'},headers:{'content-type':'application/json'}});
 await new DummySsoRoutes(sso as any,{localHttp:true}).handle(req as any,{setHeader(_k:string,v:string[]){jar=v;}} as any);
 assert.ok(jar[0].startsWith('gp-dev-session='));assert.ok(jar[0].includes('HttpOnly'));assert.ok(jar[1].startsWith('gp-dev-csrf='));assert.ok(jar.every(c=>c.includes('SameSite=Strict')&&!c.includes('Secure')&&!c.includes('__Host-')));
});
