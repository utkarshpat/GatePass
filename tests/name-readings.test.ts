import test from 'node:test';
import assert from 'node:assert/strict';
import {NameReadings,NameReadingError,googleInputTools} from '../src/visits/NameReadings.ts';

test('name readings coalesce concurrent normalized names, separate languages and expire failures',async()=>{
 let count=0,now=0;const service=new NameReadings(async(_name,locale)=>{count++;return locale==='kn'?'ರೋಹನ್ ಮೆಹ್ತಾ':'रोहन मेहता';},()=>now);
 const [a,b]=await Promise.all([service.read({locale:'hi',names:['Rohan Mehta','Rohan  Mehta']}),service.read({locale:'hi',names:['rohan mehta']})]);
 assert.equal(count,1);assert.equal(a.items[0].reading,'रोहन मेहता');assert.equal(b.items[0].name,'rohan mehta');
 await service.read({locale:'kn',names:['Rohan Mehta']});assert.equal(count,2);
 now=86400001;await service.read({locale:'hi',names:['Rohan Mehta']});assert.equal(count,3);
 let failed=0;const down=new NameReadings(async()=>{failed++;throw Error('provider failure');},()=>now);
 assert.equal((await down.read({locale:'hi',names:['Rohan Mehta']})).items[0].reading,null);
 await down.read({locale:'hi',names:['Rohan Mehta']});assert.equal(failed,1);
 now+=60001;await down.read({locale:'hi',names:['Rohan Mehta']});assert.equal(failed,2);
});
test('disabled provider, non-Roman names, wrong scripts and unsafe outputs retain the original',async()=>{
 const disabled=new NameReadings(null);assert.equal((await disabled.read({locale:'hi',names:['Rohan Mehta']})).items[0].reading,null);
 for(const output of ['Rohan Mehta','ರೋಹನ್','<b>रोहन</b>','रोहन\u0000']){
  const service=new NameReadings(async()=>output);assert.equal((await service.read({locale:'hi',names:['Rohan Mehta']})).items[0].reading,null);
 }
 const native=new NameReadings(async()=>{throw Error('must not send already-native names');});
 assert.equal((await native.read({locale:'hi',names:['रोहन मेहता']})).items[0].reading,null);
});
test('input bounds and provider concurrency prevent an unbounded name workload',async()=>{
 let active=0,peak=0;const service=new NameReadings(async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,2));active--;return 'रोहन';});
 for(const invalid of [{locale:'ar',names:['Rohan']},{locale:'hi',names:[]},{locale:'hi',names:['Rohan'],extra:1},{locale:'hi',names:['x'.repeat(201)]},{locale:'hi',names:Array(11).fill('Rohan')},{locale:'hi',names:['<script>']}])await assert.rejects(service.read(invalid),NameReadingError);
 await service.read({locale:'hi',names:['Rohan','Kunal','Asha','Nikhil','Meera','Ishita']});assert.equal(peak,2);
});
test('Input Tools adapter uses a fixed HTTPS destination, validates the echoed name and bounds response size',async()=>{
 const calls:any[]=[];
 const provider=googleInputTools((async(url:any,options:any)=>{calls.push({url:new URL(url),options});return new Response(JSON.stringify(['SUCCESS',[['Rohan Mehta',['रोहन मेहता'],[],{}]]]),{status:200});}) as typeof fetch);
 assert.equal(await provider('Rohan Mehta','hi'),'रोहन मेहता');
 assert.equal(calls[0].url.origin,'https://inputtools.google.com');assert.equal(calls[0].url.searchParams.get('itc'),'hi-t-i0-und');assert.equal(calls[0].options.redirect,'error');
 const wrong=googleInputTools((async()=>new Response(JSON.stringify(['SUCCESS',[['Different person',['रोहन']]]]))) as typeof fetch);
 assert.equal(await wrong('Rohan Mehta','hi'),null);
 const large=googleInputTools((async()=>new Response('x'.repeat(32769))) as typeof fetch);assert.equal(await large('Rohan Mehta','hi'),null);
});
