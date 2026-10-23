import {test,expect} from '@playwright/test';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import {NotificationEmailWorker} from '../../src/email/NotificationEmailWorker.ts';
import {EmailLinkCodec} from '../../src/email/EmailLinkCodec.ts';
const key=randomBytes(32),id='k_'+'b'.repeat(32),visit=randomUUID();
const codec=new EmailLinkCodec({active:async()=>({id,key:Buffer.from(key)}),resolve:async()=>Buffer.from(key)});
const fixture=(template:string,long=false)=>({notificationId:1,visitRequestId:visit,templateCode:template,recipientKind:template==='TEMP_ID_MANAGER_NOTICE'?'MANAGER':'EMPLOYEE',recipientEmployeeId:'EMP001',details:{visitRequestId:visit,publicReference:'V-'+visit.replaceAll('-',''),requestType:template==='TEMP_ID_MANAGER_NOTICE'?'TEMP_ID':'EXTERNAL',personName:long?'VeryLongVisitorName'.repeat(10):'Kunal Verma',companyName:'NovaWorks Technologies',deviceTypes:['LAPTOP'],purpose:'Project discussion and GatePass presentation demo',locationName:'Noida',projectName:long?'P'.repeat(200):'Project 1',hostName:'Employee 19',visitStatus:template==='TEMP_ID_MANAGER_NOTICE'?'APPROVED':'PENDING',validFromUtc:'2026-10-22T18:30:00.000Z',validUntilUtc:'2026-10-23T18:30:00.000Z'}});
for(const width of [390,1366])test('email layout and inline person photos fit '+width+'px',async({page})=>{
 await page.setViewportSize({width,height:1100});
 const logo=await readFile('assets/brand/sopra-steria-logo.png');
 const worker=new NotificationEmailWorker({callProcedure:async()=>''},{getEmployee:async()=>({isActive:true,officialEmail:'host@example.com'}),getManager:async()=>({isActive:true,officialEmail:'manager@example.com'})},{send:async()=>{throw new Error('NO_REAL_EMAIL');}},codec,'https://gatepass.example',logo);
 const photo=await readFile('assets/brand/sopra-steria-icon.png');
 for(const template of ['HOST_APPROVAL_REQUEST','TEMP_ID_MANAGER_NOTICE','REQUEST_RECEIVED','EMPLOYEE_RECEIPT']){
  const make=(long=false)=>{const j:any=fixture(template==='EMPLOYEE_RECEIPT'?'REQUEST_RECEIVED':template,long);if(template==='EMPLOYEE_RECEIPT'){j.details.requestType='TEMP_ID';j.details.visitStatus='APPROVED';}if(template==='REQUEST_RECEIVED'){j.recipientKind='EMAIL';j.recipientEmail='visitor@example.com';j.details.snapshotHash='a'.repeat(64);j.details.recipientEmailHash='b'.repeat(64);}return j;};
  const m=await worker.render(make(),{bytes:photo,mimeType:'image/png'});
  await page.setContent(m.html.replace('cid:gatepass-company-logo','data:image/png;base64,'+m.inlineLogo).replace('cid:gatepass-person-photo','data:image/png;base64,'+m.personPhoto!.contentBytes));
  await expect(page.getByRole('img',{name:'Photo of Kunal Verma'})).toBeVisible();
  expect(await page.locator('img').evaluateAll(imgs=>imgs.every(img=>(img as HTMLImageElement).naturalWidth>0))).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const buttons=page.getByRole('link',{name:'Approve',exact:true});
  if(template==='HOST_APPROVAL_REQUEST'){await expect(buttons).toHaveAttribute('href',new RegExp('/approval/'+visit+'#decision=APPROVED$'));await expect(page.getByText('PENDING APPROVAL',{exact:true})).toBeVisible();}
  if(template==='TEMP_ID_MANAGER_NOTICE'){await expect(page.getByText('INFORMATION ONLY',{exact:true})).toBeVisible();await expect(page.getByRole('link')).toHaveCount(0);}
  if(template==='EMPLOYEE_RECEIPT'){await expect(page.getByText('EMPLOYEE',{exact:true})).toBeVisible();await expect(page.getByText(/You have requested a new Digital ID/u)).toBeVisible();}
  const long=await worker.render(make(true),{bytes:photo,mimeType:'image/png'});await page.setContent(long.html);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 }
 await mkdir('output/presentation',{recursive:true});
});
