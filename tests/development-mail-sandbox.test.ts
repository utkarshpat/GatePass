import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sandboxRecipient,sandboxSql,sandboxTransport} from '../src/development/DevelopmentMailSandbox.ts';
test('development sandbox always redirects all recipient kinds to the explicitly chosen address',async()=>{
 const old={...process.env};try{process.env.NODE_ENV='development';process.env.GATEPASS_SSO_MODE='dummy';process.env.GATEPASS_DIRECTORY_MODE='mock';
 const sent:any[]=[];const transport=sandboxTransport({send:async m=>{sent.push(m);return{};}},'owner@gmail.com');
 for(const to of ['employee1@example.com','visitor@other.com','manager@example.com'])await transport.send({notificationId:'1',to,subject:'Approval',html:'<p>Test</p>'});
 assert.equal(sent.length,3);assert(sent.every(m=>m.to==='owner@gmail.com'&&m.subject==='[GatePass TEST] Approval'));
 process.env.NODE_ENV='production';await assert.rejects(transport.send({notificationId:'1',to:'other@x.com',subject:'x',html:'x'}));assert.equal(sent.length,3);
 }finally{process.env=old;}
});
test('sandbox refuses absent invalid and fixture recipients',()=>{for(const value of ['',null,'x@example.com','x@example.invalid','x@gmail.com\r\nBcc:a@x.com'])assert.throws(()=>sandboxRecipient(value as any));});
test('sandbox fences job content to selected visit and cannot claim the global queue',async()=>{
 const old={...process.env};try{process.env.NODE_ENV='test';process.env.GATEPASS_SSO_MODE='dummy';process.env.GATEPASS_DIRECTORY_MODE='mock';
 const id=randomUUID();let visit=id,calls=0;const sql=sandboxSql({async callProcedure(){calls++;return JSON.stringify({status:'READY',visitRequestId:visit});}},id);
 await sql.callProcedure('gp.GetNotificationEmail',{});visit=randomUUID();await assert.rejects(sql.callProcedure('gp.GetNotificationEmail',{}),/SANDBOX_VISIT_MISMATCH/u);
 await assert.rejects(sql.callProcedure('gp.ClaimNotifications',{}),/SANDBOX_RPC_REJECTED/u);assert.equal(calls,2);
 assert.throws(()=>sandboxSql({callProcedure:async()=>''},'invalid'));
 }finally{process.env=old;}
});
