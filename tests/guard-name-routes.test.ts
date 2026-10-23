import test from 'node:test';import assert from 'node:assert/strict';
import {Readable} from 'node:stream';import type {IncomingMessage,ServerResponse} from 'node:http';
import {GuardRoutes} from '../src/development/GuardRoutes.ts';import {NameReadings} from '../src/visits/NameReadings.ts';
import {HttpFailure} from '../src/transport/ApiHandler.ts';
function request(body:unknown){return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]),{url:'/api/guard/name-readings',socket:{remoteAddress:'127.0.0.1'},headers:{'content-type':'application/json'}}) as unknown as IncomingMessage;}
test('name transformation requires a verified staff session and current guard access before cache use',async()=>{
 const previous={NODE_ENV:process.env.NODE_ENV,GATEPASS_SSO_MODE:process.env.GATEPASS_SSO_MODE,GATEPASS_DIRECTORY_MODE:process.env.GATEPASS_DIRECTORY_MODE};
 Object.assign(process.env,{NODE_ENV:'test',GATEPASS_SSO_MODE:'dummy',GATEPASS_DIRECTORY_MODE:'mock'});
 try{
  let signedIn=true,allowed=true,reads=0,calls=0;
  const staff={session:()=>({sessionToken:'synthetic',csrfToken:'synthetic'}),verify:async()=>signedIn};
  const workspace={read:async()=>{reads++;if(!allowed)throw new HttpFailure(403);}};
  const routes=new GuardRoutes(staff as any,workspace as any,{} as any,{} as any,{} as any,undefined,new NameReadings(async()=>{calls++;return 'रोहन मेहता';}));
  const input={locale:'hi',names:['Rohan Mehta']},response={} as ServerResponse;
  assert.equal((await routes.handle(request(input),response) as any).items[0].reading,'रोहन मेहता');
  await routes.handle(request(input),response);assert.equal(reads,2);assert.equal(calls,1);
  allowed=false;await assert.rejects(routes.handle(request(input),response),(e:any)=>e.status===403);assert.equal(calls,1);
  signedIn=false;const before=reads;await assert.rejects(routes.handle(request(input),response),(e:any)=>e.status===401);assert.equal(reads,before);
  signedIn=true;allowed=true;await assert.rejects(routes.handle(request({locale:'ar',names:['Rohan']}),response),(e:any)=>e.status===400);
 }finally{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
test('guard name route rate limits a session even when its name is cached',async()=>{
 const previous={NODE_ENV:process.env.NODE_ENV,GATEPASS_SSO_MODE:process.env.GATEPASS_SSO_MODE,GATEPASS_DIRECTORY_MODE:process.env.GATEPASS_DIRECTORY_MODE};
 Object.assign(process.env,{NODE_ENV:'test',GATEPASS_SSO_MODE:'dummy',GATEPASS_DIRECTORY_MODE:'mock'});
 try{
  const routes=new GuardRoutes({session:()=>({sessionToken:'synthetic',csrfToken:'synthetic'}),verify:async()=>true} as any,{read:async()=>{}} as any,{} as any,{} as any,{} as any);
  for(let i=0;i<30;i++)await routes.handle(request({locale:'hi',names:['Rohan']}),{} as ServerResponse);
  await assert.rejects(routes.handle(request({locale:'hi',names:['Rohan']}),{} as ServerResponse),(e:any)=>e.status===429);
 }finally{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
