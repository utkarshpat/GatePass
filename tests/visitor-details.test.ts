import test from 'node:test';import assert from 'node:assert/strict';
import {visitorDetails} from '../src/registration/VisitorDetails.ts';
import {randomUUID,randomBytes} from 'node:crypto';
import {RegistrationService} from '../src/registration/RegistrationService.ts';
test('optional company and device types normalize without collecting device identifiers',()=>{
 assert.deepEqual(visitorDetails(undefined,undefined),{});assert.deepEqual(visitorDetails('  ',[]),{deviceTypes:[]});assert.deepEqual(visitorDetails(' ACME ',['TABLET','LAPTOP']),{companyName:'ACME',deviceTypes:['LAPTOP','TABLET']});
 for(const [company,devices] of [['x'.repeat(201),[]],['a\nb',[]],[{},[]],['a',['LAPTOP','LAPTOP']],['a',['laptop']],['a',['LAPTOP ']],['a',['SERIAL']],['a','LAPTOP']])assert.throws(()=>visitorDetails(company,devices));
});
test('registration sends independent optional visitor details and rejects identifiers before SQL',async()=>{
 const context={intakeId:randomUUID(),intakeToken:randomBytes(32).toString('base64url'),intakeCsrfToken:randomBytes(32).toString('base64url'),requestType:'EXTERNAL' as const};let calls=0;
 const people=[{clientPersonKey:randomUUID(),photoAssetId:randomUUID(),name:'Visitor One',phone:'+919876543210',companyName:' Acme ',deviceTypes:['TABLET','LAPTOP']},{clientPersonKey:randomUUID(),photoAssetId:randomUUID(),name:'Visitor Two',phone:'+919876543211'}];
 const service=new RegistrationService({async execute(_name,p){calls++;const saved=JSON.parse(String(p.PeopleJson.value));assert.equal(saved[0].companyName,'Acme');assert.deepEqual(saved[0].deviceTypes,['LAPTOP','TABLET']);assert.equal(saved[1].companyName,undefined);assert.equal(saved[1].deviceTypes,undefined);return{status:'SUBMITTED',intakeId:context.intakeId,requestType:'EXTERNAL',visits:people.map(person=>({clientPersonKey:person.clientPersonKey,visitRequestId:randomUUID(),accessPassId:randomUUID(),publicReference:'V-'+randomUUID().replaceAll('-',''),publicPassNumber:'GP-'+randomUUID().replaceAll('-',''),status:'PENDING',reused:false}))};}},{} as any,{} as any,{} as any);
 const body={clientKey:randomUUID(),requestType:'EXTERNAL',locationId:1,projectLocationId:'1',hostEmployeeId:'EMP001',reason:'Meeting',validFromUtc:'2026-10-23T04:30:00.000Z',validUntilUtc:'2026-10-23T05:30:00.000Z',people};await service.submit(context,body);assert.equal(calls,1);
 for(const extra of [{makeModel:'Laptop'},{idProof:'123'},{deviceTypes:['LAPTOP','LAPTOP']},{companyName:'x'.repeat(201)}])await assert.rejects(service.submit(context,{...body,people:[{...people[0],...extra}]}),{code:'INVALID_INPUT'});assert.equal(calls,1);
});
