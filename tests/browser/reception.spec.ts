import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import sharp from 'sharp';
const visit='11111111-1111-4111-8111-111111111111',pass='22222222-2222-4222-8222-222222222222';
for(const width of [390,1366])test(`reception pending preview, filter, direct print handoff and reprint fit ${width}px`,async({page})=>{
 await page.addInitScript(() => { window.print=()=>{ (window as any).__printCalls=((window as any).__printCalls??0)+1; }; });
 await page.setViewportSize({width,height:width===390?844:768});
 const png=await sharp({create:{width:1712,height:1080,channels:3,background:'#edf1f7'}}).png().toBuffer();
 const base={visitRequestId:visit,accessPassId:pass,personName:'Reception Test Visitor',publicReference:'V-RECEPTION-TEST',publicPassNumber:'P-TEST',requestType:'EXTERNAL',status:'PENDING',passStatus:'PENDING',isInside:false,validFromUtc:new Date(Date.now()-3600000).toISOString(),validUntilUtc:new Date(Date.now()+7200000).toISOString(),submittedAtUtc:new Date().toISOString(),projectName:'Project 1',hostName:'Trusted Host',hostEmail:'host@example.com',printCount:0};
 const calls:any[]=[];const jobs=new Map<string,any>();let dispatches=0;
 await page.route('**/api/reception/**',async route=>{
  const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON();
  const reply=(value:unknown)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
  if(path.endsWith('/list')){const match=(!body.search||base.personName.toLowerCase().includes(body.search.toLowerCase()))&&['ALL','PENDING'].includes(body.status??'ALL');return reply({visits:match?[{...base,printCount:dispatches}]:[],visitDate:body.visitDate,cursor:null});}
  if(path.endsWith('/detail'))return reply({...base,locationName:'Noida',reason:'Business meeting',photoAvailable:false,printCount:dispatches});
  if(path.endsWith('/preview'))return reply({mimeType:'image/png',imageBase64:png.toString('base64')});
  if(path.endsWith('/print/request')){calls.push(body);const id=crypto.randomUUID();const job={printJobId:id,visitRequestId:visit,accessPassId:pass,status:'REQUESTED',printReason:dispatches?'REPRINT':'FIRST'};jobs.set(id,job);return reply(job);}
  if(path.endsWith('/print/status'))return reply(jobs.get(body.printJobId));
  if(path.endsWith('/print/render')){const job=jobs.get(body.printJobId);job.status='DISPATCHED';dispatches++;return reply({printJobId:job.printJobId,status:'DISPATCHED',mimeType:'image/png',imageBase64:png.toString('base64')});}
  return route.continue();
 });
 await page.goto('/');await page.getByRole('textbox',{name:'Email or Staff ID',exact:true}).fill('reception1@example.com');await page.getByRole('textbox',{name:'Password',exact:true}).fill('Sopra@123');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page).toHaveURL(/\/reception$/u);await expect(page.locator('#stat-total')).toHaveText('1');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 if(width>760){const boxes=await page.locator('#visit-rows tr').first().evaluate(row=>{const card=row.querySelector('.cell-card .status')!.getBoundingClientRect(),action=row.querySelector('.cell-actions button')!.getBoundingClientRect();return{right:card.right,left:action.left};});expect(boxes.right).toBeLessThanOrEqual(boxes.left);}
 await page.getByRole('searchbox').fill('Nobody');await expect(page.locator('#empty-visits')).toBeVisible();await expect(page.locator('#stat-total')).toHaveText('0');
 await page.getByRole('searchbox').fill('Reception');await expect(page.locator('#visit-rows tr')).toHaveCount(1);
 await page.getByRole('button',{name:'View pass for Reception Test Visitor',exact:true}).click();await expect(page.locator('#reception-card img')).toBeVisible();await expect(page.locator('#detail-print')).toBeEnabled();
 const bounds=await page.locator('#visit-dialog').boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(width+1);
 const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
 await page.screenshot({path:`output/reception-audit-${width}.png`});
 for(let copy=0;copy<2;copy++){
  await page.locator('#detail-print').click();await expect.poll(()=>dispatches).toBe(copy+1);await expect(page.locator('#detail-print')).toHaveText('Reprint pass');await expect.poll(()=>page.frames().some(f=>f.url().endsWith('/reception/print'))).toBe(true);expect(page.context().pages()).toHaveLength(1);
 }
 expect(dispatches).toBe(2);expect(calls).toHaveLength(2);expect(calls[0].clientKey).not.toBe(calls[1].clientKey);await expect(page.locator('#stat-approved')).toHaveText('0');await expect(page.locator('#detail-print-count')).toHaveText('2');await expect(page.locator('.cell-card')).toHaveText('Printed');
});
