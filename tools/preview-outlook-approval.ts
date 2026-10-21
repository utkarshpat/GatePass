import {mkdir,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {OutlookApprovalCard,outlookCardScript} from '../src/email/OutlookApprovalCard.ts';
import {OutlookActionCodec} from '../src/email/OutlookActionCodec.ts';
// Offline sample only: ephemeral key, reserved example origin, no registered provider or live mailbox call.
const key=randomBytes(32),id='k_'+'e'.repeat(32),visit=randomUUID();
try{
 const codec=new OutlookActionCodec({active:async()=>({id,key:Buffer.from(key)}),resolve:async()=>Buffer.from(key)},'offline-preview-only');
 const card=await new OutlookApprovalCard({providerId:'00000000-0000-4000-8000-000000000001',origin:'https://gatepass.example.com'},codec).render({notificationId:1,templateCode:'HOST_APPROVAL_REQUEST',recipientKind:'EMPLOYEE',recipientEmployeeId:'EMP001',visitRequestId:visit,details:{visitRequestId:visit,snapshotHash:'a'.repeat(64),validUntilUtc:new Date(Date.now()+86400000).toISOString(),personName:'Preview Visitor',publicReference:'V-PREVIEW',locationName:'Noida',projectName:'Project 1',hostName:'Preview Host',purpose:'Business meeting'}},'host@example.com');
 const folder=join(homedir(),'.gatepass','email-previews');await mkdir(folder,{recursive:true});
 await writeFile(join(folder,'outlook-approval-card.json'),JSON.stringify(card,null,2));
 const html='<!doctype html><html lang="en"><head>'+outlookCardScript(card)+'</head><body><p>Offline preview only. This sample cannot approve a real visit.</p><h1>Visit approval</h1><p>Preview Visitor · Noida · Project 1</p><p>View request in GatePass if your email client does not display interactive actions.</p></body></html>';
 await writeFile(join(folder,'outlook-approval.eml'),'MIME-Version: 1.0\r\nFrom: gatepass@example.com\r\nTo: host@example.com\r\nSubject: GatePass Outlook approval — offline preview\r\nContent-Type: text/html; charset=utf-8\r\n\r\n'+html);
 console.log('Offline card JSON and .eml saved to '+folder+'. No external email sent; no live provider configured.');
}finally{key.fill(0);}
