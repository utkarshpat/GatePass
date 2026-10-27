import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';
import {displayedValidityEnd,passValidityLabel} from '../src/printing/ValidityDisplay.ts';
import {notificationEmailLayout} from '../src/email/NotificationEmailLayout.ts';
import {PassCardRenderer} from '../src/printing/PassCardRenderer.ts';
test('midnight validity displays the final day at 23:59 across month/year/leap boundaries; other times remain exact',()=>{
 const source=readFileSync(new URL('../src/app/validity-display.js',import.meta.url),'utf8'),scope:any={Intl,Date};runInNewContext(source+';globalThis.label=passValidityLabel',scope);
 for(const [value,expected] of [['2026-10-27T18:30:00.000Z','27 Oct 2026, 23:59 IST'],['2027-01-01T18:30:00.000Z','01 Jan 2027, 23:59 IST'],['2024-02-29T18:30:00.000Z','29 Feb 2024, 23:59 IST'],['2026-10-27T10:00:00.000Z','27 Oct 2026, 15:30 IST']]){assert.equal(passValidityLabel(value),expected);assert.equal(scope.label(value),expected);}
 const original='2026-10-27T18:30:00.000Z';assert.equal(displayedValidityEnd(original).toISOString(),'2026-10-27T18:29:00.000Z');assert.equal(original,'2026-10-27T18:30:00.000Z');
});
test('notification and printed card show the inclusive end date for Digital ID and visitor',async()=>{
 const end='2026-10-27T18:30:00.000Z';const html=notificationEmailLayout({title:'Pass',approval:false,manager:false,notice:false,digitalId:true,receipt:false,employee:true,status:'APPROVED',personName:'Employee',publicReference:'V-test',purpose:'Forgot card',validFromUtc:'2026-10-27T01:00:00.000Z',validUntilUtc:end,href:'https://example.com/request',logo:false,photo:false});assert(html.includes('27 Oct 2026, 23:59 IST'));assert(!html.includes('28 Oct'));
 const png=Buffer.from('89504e470d0a1a0a0000','hex'),renderer=new PassCardRenderer({errorCorrectionLevel:'H',async encode(){return Array.from({length:37},()=>Array(37).fill(false));}},{organisationLogoPng:png,applicationLogoPng:png,organisationIconPng:png});
 for(const requestType of ['DIGITAL_ID','EXTERNAL'] as const){const svg=(await renderer.render({requestType,visitStatus:'APPROVED',personName:'Test Person',publicReference:'V-test',publicPassNumber:'GP-test',locationName:'Noida',validFromUtc:'2026-10-27T01:00:00.000Z',validUntilUtc:end,employeeId:requestType==='DIGITAL_ID'?'EMP001':null,hostEmployeeId:requestType==='EXTERNAL'?'EMP002':null,hostName:requestType==='EXTERNAL'?'Host':null,purpose:'Visit',assignedProjectCount:0,assignedProjects:[]},png,'image/png','A'.repeat(43))).toString();assert(svg.includes('27 Oct 2026 · 23:59 IST'));assert(!svg.includes('28 Oct'));}
});
