import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {registrationDates} from '../src/registration/RegistrationDates.ts';
import {OfficeEntryContext} from '../src/development/OfficeEntryContext.ts';

test('employee has no client date; future and same-day date injection are both rejected',()=>{
  assert.deepEqual(registrationDates('DIGITAL_ID',undefined,'2026-10-20','2026-11-19'),{});
  for(const type of ['DIGITAL_ID','EMPLOYEE_PROJECT'] as const)for(const value of ['2026-10-20','2026-10-21',null])assert.throws(()=>registrationDates(type,value,'2026-10-20','2026-11-19'),{code:'INVALID_INPUT'});
});
test('employee extra project window is always the current India calendar day',()=>{
  assert.deepEqual(registrationDates('EMPLOYEE_PROJECT',undefined,'2026-10-20','2026-11-19'),{validFromUtc:'2026-10-19T18:30:00.000Z',validUntilUtc:'2026-10-20T18:30:00.000Z'});
});
test('visitor date is calendar-valid and bounded by server policy',()=>{
  assert.deepEqual(registrationDates('EXTERNAL','2026-10-21','2026-10-20','2026-11-19'),{validFromUtc:'2026-10-20T18:30:00.000Z',validUntilUtc:'2026-10-21T18:30:00.000Z'});
  for(const value of ['2026-10-19','2026-11-20','2026-02-30','2026-10-20T00:00:00Z',undefined])assert.throws(()=>registrationDates('EXTERNAL',value,'2026-10-20','2026-11-19'),{code:'INVALID_INPUT'});
});
test('office context is signed, bounded and cannot be changed by editing cookies',()=>{
  const key=randomBytes(32),context=new OfficeEntryContext(key);let cookie='';
  context.issue({setHeader(_name:string,value:string){cookie=value;}} as any,'NOIDA');
  assert.match(cookie,/HttpOnly/u);assert.match(cookie,/SameSite=Strict/u);
  assert.equal(context.read({headers:{cookie}} as any),'NOIDA');
  assert.throws(()=>context.read({headers:{cookie:cookie.replace('NOIDA','PUNE')}} as any));
  assert.throws(()=>new OfficeEntryContext(randomBytes(32)).read({headers:{cookie}} as any));
  assert.throws(()=>context.read({headers:{cookie:''}} as any));
  assert.throws(()=>context.issue({} as any,'UNKNOWN'));
});
test('camera closes tracks when leaving a step and discards late permission results',async()=>{
  const code=await readFile(new URL('../src/app/camera-session.js',import.meta.url),'utf8');
  const Camera=runInNewContext(code+'\nCameraSession');
  let resolveStream:(stream:any)=>void=()=>{};let stopped=0;
  const camera=new Camera(()=>new Promise(resolve=>{resolveStream=resolve;}));
  const pending=camera.open();camera.close();resolveStream({getTracks(){return[{stop(){stopped++;}}];}});
  assert.equal(await pending,null);assert.equal(stopped,1);assert.equal(camera.stream,null);
});
test('reopening camera releases the previous device stream',async()=>{
  const code=await readFile(new URL('../src/app/camera-session.js',import.meta.url),'utf8');const Camera=runInNewContext(code+'\nCameraSession');
  let stopped=0;const stream=()=>({getTracks(){return[{stop(){stopped++;}}];}});const camera=new Camera(async()=>stream());
  await camera.open();await camera.open();assert.equal(stopped,1);camera.close();assert.equal(stopped,2);
});
