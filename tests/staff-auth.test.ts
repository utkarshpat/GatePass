import test from 'node:test';import assert from 'node:assert/strict';
import {StaffAuthService,SqlStaffAuthRepository} from '../src/security/StaffAuthService.ts';
import {GuardPasswordHasher} from '../src/security/GuardPasswordHasher.ts';
import {SqlProcedureClient} from '../src/transport/SqlProcedureClient.ts';
const password='individual local staff passphrase';
test('generic staff engine verifies real Argon2 passwords using only generic staff RPCs',async()=>{
 const hash=await new GuardPasswordHasher().hash(password),calls:any[]=[];
 const service=await StaffAuthService.create({async execute(name,p){calls.push({name,p});if(name==='gp.BeginStaffLogin')return{status:'READY',encodedPasswordHash:hash};if(name==='gp.CompleteStaffLogin')return p.PasswordVerified.value?{status:'OK',idleExpiresAtUtc:'2099-01-01T00:00:00Z',absoluteExpiresAtUtc:'2099-01-01T01:00:00Z'}:{status:'DENIED'};return{status:'OK'};}});
 const context={sourceHash:Buffer.alloc(32,5)};const result=await service.signIn('reception1@example.com',password,context);assert.equal(result.ok,true);assert.equal(calls[1].p.PasswordVerified.value,true);assert.equal(calls[1].p.SessionHash.value.length,32);assert.ok(!JSON.stringify(calls).includes(password));assert.equal((await service.signIn('admin1@example.com','incorrect',context)).ok,false);if(result.ok)assert.equal((await service.sessionAction('logout',result.sessionToken,result.csrfToken)).ok,true);assert.ok(calls.every(c=>c.name.includes('Staff')));
});
test('staff verifier repository cannot switch to guard RPCs or supply authority fields',async()=>{
 const executed:string[]=[];const repository=new SqlStaffAuthRepository({async callProcedure(name){executed.push(name);return JSON.stringify({status:'READY',encodedPasswordHash:'bounded-placeholder'});}});
 const params={LoginId:{type:'text',value:'admin1@example.com'},AttemptHash:{type:'binary',value:Buffer.alloc(32)},SourceHash:{type:'binary',value:Buffer.alloc(32)}} as const;
 await assert.rejects(repository.execute('gp.BeginGuardLogin',params));await assert.rejects(repository.execute('gp.BeginStaffLogin',{...params,Role:{type:'text',value:'INDIA_ADMIN'}}));assert.equal(executed.length,0);assert.equal((await repository.execute('gp.BeginStaffLogin',params)).status,'READY');assert.deepEqual(executed,['gp.BeginStaffLogin']);
});
test('staff SQL verifier role is disjoint from API and legacy guard authorization',async()=>{
 const pool={request(){return{input(){},async execute(){return{recordsets:[[{value:'{}'}]]};}};},async close(){}};
 const api=new SqlProcedureClient(pool,'api'),guard=new SqlProcedureClient(pool,'auth'),staff=new SqlProcedureClient(pool,'staffAuth');
 await assert.rejects(api.callProcedure('gp.BeginStaffLogin',{}));await assert.rejects(guard.callProcedure('gp.BeginStaffLogin',{}));await assert.rejects(staff.callProcedure('gp.ManageStaffCredential',{}));await assert.rejects(staff.callProcedure('gp.BeginGuardLogin',{}));assert.equal(await staff.callProcedure('gp.ResolveStaffLoginIdentity',{LoginId:{type:'text',value:'admin1@example.com'}}),'{}');
});
