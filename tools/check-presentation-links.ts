import {chromium,expect as baseExpect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {localEmailLinks} from '../src/email/LocalEmailLinks.ts';
import {PrivateDirectory} from '../src/storage/PrivateDirectory.ts';

// Local browser validation only: render real signed holder links, never send mail.
if(process.env.GATEPASS_RETAIN_DEMO!=='true')throw Error('RETAINED_LOCAL_DEMO_REQUIRED');
const origin=process.env.GATEPASS_DEMO_ORIGIN??'http://localhost:18448';
if(!/^http:\/\/localhost:(8443|18448)$/u.test(origin))throw Error('LOCAL_DEMO_ONLY');
const manifest=JSON.parse(await readFile('output/presentation/manifest.json','utf8'));
const codec=await localEmailLinks(join(homedir(),'.gatepass','private-v1'));
const privateOutput=await PrivateDirectory.create(join(homedir(),'.gatepass','presentation-2026-10-23'),[resolve('.')]);
const expect=baseExpect.configure({timeout:30000}),browser=await chromium.launch();
const links:string[]=[],checks:string[]=[];
try{
 const host=await browser.newPage({baseURL:origin});
 for(const name of ['Ananya Rao','Rohan Mehta','Aarav Sharma']){
  const v=manifest.visits.find((v:any)=>v.name===name);await host.goto('/approval/'+v.visitRequestId);await expect(host.locator('#login:visible, #request:visible')).toBeVisible();
  let detail:any;
  if(await host.locator('#login').isVisible()){const response=host.waitForResponse(r=>r.url().endsWith('/api/email/host/detail')&&r.status()===200);await host.locator('#email').fill('employee19@example.com');await host.locator('#password').fill('Sopra@123');await host.locator('#sign-in').click();detail=await(await response).json();}
  else{const response=host.waitForResponse(r=>r.url().endsWith('/api/email/host/detail')&&r.status()===200);await host.locator('#refresh').click();detail=await(await response).json();}
  const email=name.toLowerCase().replaceAll(' ','.')+'@example.com';
  const link=await codec.issue({v:1,visit:v.visitRequestId,emailHash:createHash('sha256').update(email,'utf16le').digest('hex'),snapshot:detail.snapshotHash.toLowerCase(),expires:Date.parse(detail.validUntilUtc)+86400000});
  const context=await browser.newContext({baseURL:origin}),holder=await context.newPage();await holder.goto('/request/'+v.visitRequestId+'#link='+link);const status=name==='Ananya Rao'?'Approval pending':name==='Aarav Sharma'?'Revoked':'Approved';await expect(holder.locator('#message')).toHaveText(status);await expect(holder).toHaveURL(origin+'/request/'+v.visitRequestId);const cookie=(await context.cookies()).find(c=>c.name==='gp-dev-holder');expect(cookie?.httpOnly).toBe(true);expect(cookie?.path).toBe('/api/email/external/'+v.visitRequestId+'/');
  if(status==='Revoked')await expect(holder.locator('#card')).toBeHidden();else await expect(holder.locator('#card')).toBeVisible();await holder.reload();await expect(holder.locator('#message')).toHaveText(status);await holder.screenshot({path:'output/presentation/Holder-status-'+name.replaceAll(' ','-')+'.png',fullPage:true});checks.push('Signed holder status, cookie and reload: '+name+' — '+status);console.log('PASS '+checks.at(-1));
  links.push('<li><a href="http://localhost:8443/request/'+v.visitRequestId+'#link='+link+'">'+name+' — '+status+'</a></li>');await context.close();
 }
 const owner=await browser.newPage({baseURL:origin});await owner.goto('/request/'+manifest.projectRequest.visitRequestId);await expect(owner.locator('#login')).toBeVisible();await owner.locator('#email').fill('employee1@example.com');await owner.locator('#password').fill('Sopra@123');await owner.locator('#sign-in').click();await expect(owner.locator('#message')).toHaveText('Approved');await expect(owner.locator('#card')).toBeVisible();await owner.screenshot({path:'output/presentation/Employee-project-status.png',fullPage:true});checks.push('Employee project owner status and card');
 await privateOutput.write('holder-links.html',Buffer.from('<!doctype html><meta charset="utf-8"><title>GatePass local presentation links</title><h1>23 October 2026 — synthetic visitor status</h1><p>Local demonstration links. Do not share outside the presentation environment.</p><ul>'+links.join('')+'</ul>'),true);
 await writeFile('output/presentation/link-checks.json',JSON.stringify({checkedAt:new Date().toISOString(),checks,privateLinksFile:join(privateOutput.root,'holder-links.html')},null,2)+'\n');console.log('PASS employee owner status; private holder links saved outside the workspace.');
}finally{await browser.close();}
