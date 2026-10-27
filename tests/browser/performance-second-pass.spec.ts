import{test,expect,type Page,type BrowserContext}from'@playwright/test';
import{writeFile,mkdir,readFile}from'node:fs/promises';import{randomUUID}from'node:crypto';
import{execFileSync}from'node:child_process';
const actor='11111111-1111-4111-8111-111111111111';
async function admin(page:Page,context:BrowserContext,project:(body:any)=>unknown){
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));
 await page.route('**/api/admin/**',async route=>{const a=route.request().url().split('/').at(-1),d=route.request().postDataJSON();const replies:any={context:{displayName:'Synthetic Admin',locations:[{locationId:1,locationName:'Noida',locationCode:'NOIDA',canManageCommonAreas:false}]},scope:{userId:actor,currentDate:'2026-10-25',canReport:true,canReadVisits:true,canExport:true,canAudit:false,canManageRoles:false,canAssignGuards:false,roles:[],delegations:[]},'summary-range':{from:'2026-10-25',to:'2026-10-25',visits:{total:'0',pending:'0',approved:'0',denied:'0',cancelled:'0'},recordedPresence:{projectVisitsInside:'0',digitalIdsInside:'0'},days:[]},leads:{leads:[],cursor:null}};await route.fulfill({json:a==='projects'?project(d):replies[a!]??{}});});
 await page.goto('/admin');await expect(page.locator('#console-project')).toBeEnabled();await page.evaluate(()=>{(window as any).liveRefresh?.close();});
}
test('1000-project catalogue loads one initial page, searches unseen projects and retains scope through load more',async({page,context})=>{
 const calls:any[]=[],all=Array.from({length:1000},(_,i)=>({projectLocationId:String(i+1),projectId:String(i+1),projectName:'Project '+String(i+1).padStart(4,'0'),projectCode:'SYN-'+(i+1),directoryCurrent:true,canAssignProject:false,canAssignLocation:false}));
 await admin(page,context,d=>{calls.push(d);const filtered=d.search?all.filter(p=>(p.projectName+' '+p.projectCode).toLowerCase().includes(d.search.toLowerCase())):all,start=d.cursor?filtered.findIndex(p=>p.projectLocationId===d.cursor)+1:0,rows=filtered.slice(start,start+25);return{projects:rows,cursor:start+25<filtered.length?rows.at(-1)!.projectLocationId:null};});
 expect(calls).toHaveLength(1);await page.locator('[data-admin-view=projects]').click();await expect(page.locator('#projects .project-card')).toHaveCount(24);
 await page.locator('#more-projects').click();await expect(page.locator('#projects .project-card')).toHaveCount(25);expect(calls).toHaveLength(1);await page.locator('#more-projects').click();await expect(page.locator('#projects .project-card')).toHaveCount(50);expect(calls).toHaveLength(2);
 await page.locator('#project-search').fill('Project 1000');await expect(page.locator('#projects .project-card')).toHaveCount(1);await expect(page.locator('#projects')).toContainText('Project 1000');expect(calls.at(-1).search).toBe('Project 1000');
 await page.locator('[data-admin-view=overview]').click();await page.locator('#console-project').selectOption('1000');await expect(page.locator('#console-project')).toHaveValue('1000');await page.locator('[data-admin-view=projects]').click();await page.locator('#project-search').fill('');await expect.poll(()=>calls.at(-1).search??'').toBe('');await expect(page.locator('#console-project')).toHaveValue('1000');
});
for(const staleStatus of [200,403])test('obsolete catalogue refresh '+staleStatus+' cannot overwrite or clear a newer search',async({page,context})=>{
 const project=(n:number)=>({projectLocationId:String(n),projectId:String(n),projectName:'Project '+n,projectCode:'P-'+n,directoryCurrent:true,canAssignProject:false,canAssignLocation:false});
 await admin(page,context,d=>({projects:[project(d.search?1000:1)],cursor:null}));await page.locator('[data-admin-view=projects]').click();
 let release:()=>void=()=>{},held=false;const gate=new Promise<void>(resolve=>release=resolve);
 await page.route('**/api/admin/projects',async route=>{const d=route.request().postDataJSON();if(d.search||held)return route.fallback();held=true;await gate;return route.fulfill({status:staleStatus,json:staleStatus===200?{projects:[project(2)],cursor:null}:{error:'NOT_AUTHORIZED'}});});
 await page.evaluate('void (globalThis.catalogueRefreshTest=refreshVisibleAdmin())');await expect.poll(()=>held).toBe(true);
 await page.locator('#project-search').fill('Project 1000');await expect(page.locator('#projects')).toContainText('Project 1000');release();await page.evaluate('globalThis.catalogueRefreshTest');
 await expect(page.locator('#projects')).toContainText('Project 1000');await expect(page.locator('#projects')).not.toContainText('Project 2');expect(await page.evaluate('consoleState.scope!==null')).toBe(true);
});

test('load more before a changed search dispatch never reuses the previous query cursor',async({page,context})=>{
 const calls:any[]=[],projects=Array.from({length:25},(_,i)=>({projectLocationId:String(i+1),projectId:String(i+1),projectName:'Project '+(i+1),projectCode:'P-'+(i+1),directoryCurrent:true,canAssignProject:false,canAssignLocation:false}));
 await admin(page,context,d=>{calls.push(d);return{projects,cursor:'25'};});
 await page.evaluate(`document.getElementById('project-search').value='Project';cataloguePage(true)`);
 expect(calls.at(-1).search).toBe('Project');expect(calls.at(-1).cursor).toBeUndefined();expect(await page.evaluate('state.projects.length')).toBe(25);
});

test('newly loaded catalogue project stays selectable when a complete metadata cache exists',async({page,context})=>{
 const project=(n:number)=>({projectLocationId:String(n),projectId:String(n),projectName:'Project '+n,projectCode:'P-'+n,directoryCurrent:true,canAssignProject:false,canAssignLocation:false});const scopes:any[]=[];
 await admin(page,context,d=>({projects:[project(d.search?1000:1)],cursor:null}));await page.evaluate('state.fullProjects=[...state.projects]');
 await page.route('**/api/admin/scope',async route=>{scopes.push(route.request().postDataJSON());return route.fallback();});
 await page.locator('[data-admin-view=projects]').click();await page.locator('#project-search').fill('Project 1000');await expect(page.locator('#projects')).toContainText('Project 1000');await page.locator('[data-admin-view=overview]').click();await page.locator('#console-project').selectOption('1000');
 await expect.poll(()=>scopes.at(-1)?.projectLocationId).toBe('1000');await expect(page.locator('#console-project')).toHaveValue('1000');
});

test('10k-row Excel worker remains responsive and creates a compressed workbook',async({page,context})=>{
 await admin(page,context,()=>({projects:[],cursor:null}));
 const observed=await page.evaluate(async()=>{
  const header=Array.from({length:26},(_,i)=>'Column '+i),rows=Array.from({length:10000},(_,r)=>header.map((_,c)=>c===13?'Synthetic visit purpose with multiple devices and office access. '.repeat(8):`Synthetic value ${r} column ${c}`));
  let ticks=0;const timer=setInterval(()=>ticks++,10),start=performance.now();
  try{const blob=await (window as any).workbookBlob(header,rows,{}),bytes=new Uint8Array(await blob.arrayBuffer());return{durationMs:performance.now()-start,ticks,bytes:blob.size,magic:[...bytes.slice(0,4)],compressionMethod:bytes[8]|bytes[9]<<8};}finally{clearInterval(timer);}
 });
 expect(observed.ticks).toBeGreaterThan(2);expect(observed.magic).toEqual([80,75,3,4]);expect(observed.compressionMethod).toBe(8);expect(observed.bytes).toBeLessThan(3*1024*1024);
 const folder='output/performance-second-pass/'+randomUUID();await mkdir(folder,{recursive:true});await writeFile(folder+'/workbook.json',JSON.stringify(observed,null,2));console.log('WORKBOOK_DIAGNOSTIC '+folder+'/workbook.json');
 // Downloaded content is validated by the existing export consistency suite.
 expect((await readFile('src/app/register-export-worker.js','utf8')).includes('new CompressionStream')).toBe(true);
});

test('live SQL export serves owned snapshot pages, validates the full dataset and cleans storage before download',async({page})=>{
 test.setTimeout(120000);const run=randomUUID(),fixture=(action:string)=>execFileSync('pwsh',['-NoProfile','-File','tests/browser/ExportSnapshotFixture.ps1','-RunId',run,'-Action',action],{encoding:'utf8',timeout:60000});
 try{
  const f=JSON.parse(fixture('Create')),calls:any[]=[],timings:any[]=[];
  page.on('request',r=>{if(r.url().endsWith('/api/admin/register')&&r.postDataJSON().export)calls.push(r.postDataJSON());});
  page.on('response',async r=>{const request=r.request();if(!r.url().endsWith('/api/admin/register')||!request.postDataJSON().export)return;await r.finished();const d=request.postDataJSON();timings.push({page:d.page,phase:d.finishExport?'final-validation':d.cancelExport?'cancellation':d.snapshot&&!d.snapshotId?'snapshot-create':'snapshot-page',status:r.status(),milliseconds:request.timing().responseEnd});});
  await page.goto('/');await page.getByRole('textbox',{name:'Email or Staff ID',exact:true}).fill(f.adminLogin);await page.getByRole('textbox',{name:'Password',exact:true}).fill('Sopra@123');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).toHaveURL(/\/admin$/u);await expect(page.locator('#console-project')).toBeEnabled();
  await page.locator('#console-project').selectOption(String(f.pair));await page.locator('[data-admin-view=reports]').click();await expect(page.locator('#register-export')).toBeEnabled();
  const total=Number(await page.evaluate('registerState.total'));expect(total).toBeGreaterThanOrEqual(1000);
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#register-export').click()]);expect(download.suggestedFilename()).toMatch(/\.xlsx$/u);await expect(page.locator('#report-status')).toContainText('visits exported');
  expect(calls.filter(d=>!d.finishExport&&!d.cancelExport)).toHaveLength(Math.ceil(total/200));expect(calls.filter(d=>d.finishExport)).toHaveLength(1);expect(calls[0].snapshotId).toBeUndefined();expect(calls[1].snapshotId).toBeTruthy();expect(JSON.parse(fixture('Inspect')).snapshots).toBe(0);
  const folder='output/performance-second-pass/'+run;await mkdir(folder,{recursive:true});await writeFile(folder+'/live-export.json',JSON.stringify({runId:run,total,requests:timings,limits:'Sequential real browser export on the shared local SQL host; per-request timings are observations, not a load-test p95.'},null,2));console.log('LIVE_EXPORT_DIAGNOSTIC '+folder+'/live-export.json');
 }finally{fixture('Cleanup');}
});

test('guard thumbnails reuse only an authorized matching content version and clear on scope loss',async({page,context})=>{
 const {createRequire}=await import('node:module'),sharp=createRequire(import.meta.url)(process.env.GATEPASS_SHARP_PATH??'sharp');
 const jpeg=(await sharp({create:{width:8,height:8,channels:3,background:'#7799aa'}}).jpeg().toBuffer()).toString('base64');let version='a'.repeat(64),photos=0,denied=false;
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));
 await page.route('**/api/**',route=>{const action=route.request().url().split('/').at(-1);const replies:any={context:{queuePaging:true,displayName:'Synthetic Guard',locations:[{locationId:1,locationName:'Noida'},{locationId:2,locationName:'Chennai'}]},duties:{duties:[{kind:'PROJECT',dutyId:'1',name:'Project'}]},queue:{visitors:[{visitRequestId:actor,personName:'Synthetic Person',publicReference:'SYN-1',publicPassNumber:'GP-1',requestType:'EXTERNAL',projectName:'Project',status:'APPROVED',passStatus:'ACTIVE',isInside:false,validUntilUtc:'2030-10-25T00:00:00.000Z',photoAvailable:true,photoVersion:version,allocations:[{kind:'PROJECT',dutyId:'1',name:'Project'}]}],total:1,cursor:null}};
  if(action==='queue'&&denied)return route.fulfill({status:403,json:{error:'NOT_AUTHORIZED'}});if(action==='photo'){photos++;return route.fulfill({json:{mimeType:'image/jpeg',imageBase64:jpeg,photoVersion:version}});}return route.fulfill({json:replies[action!]??{}});
 });
 await page.goto('/guard');await expect(page.locator('.guard-card-avatar img')).toHaveCount(1);await page.evaluate('liveRefresh.close()');expect(photos).toBe(1);
 await page.locator('#refresh-recent').click();await expect(page.locator('#recent-scans')).toHaveAttribute('aria-busy','false');await expect(page.locator('.guard-card-avatar img')).toHaveCount(1);expect(photos).toBe(1);
 version='b'.repeat(64);await page.locator('#refresh-recent').click();await expect.poll(()=>photos).toBe(2);await expect(page.locator('.guard-card-avatar img')).toHaveCount(1);
 await page.locator('#guard-office-trigger').click();await page.getByRole('option',{name:'Chennai',exact:true}).click();await expect.poll(()=>photos).toBe(3);await expect(page.locator('.guard-card-avatar img')).toHaveCount(1);
 denied=true;await page.locator('#refresh-recent').click();await expect(page.locator('#recent-status')).toContainText('Visitors unavailable');await expect(page.locator('#recent-scans')).toHaveAttribute('aria-busy','false');await expect(page.locator('.guard-card-avatar img')).toHaveCount(0);expect(await page.evaluate('historyCache.size')).toBe(0);
});
