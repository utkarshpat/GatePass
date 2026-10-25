import{test,expect as baseExpect,type Page,type BrowserContext}from'@playwright/test';
const expect=baseExpect.configure({timeout:3000});
const a='10000000-0000-4000-8000-000000000001',b='10000000-0000-4000-8000-000000000002';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=';
const row=(id:string,name:string)=>({visitRequestId:id,accessPassId:'20000000-0000-4000-8000-000000000001',personName:name,publicReference:'V-'+name,publicPassNumber:'GP-'+name,requestType:'EXTERNAL',status:'APPROVED',passStatus:'ACTIVE',isInside:false,printCount:1,projectName:'Project Alpha',hostName:'Meera Singh',locationName:'Noida',reason:'Synthetic follow-up audit',movements:[],photoAvailable:false,submittedAtUtc:'2026-10-24T06:00:00.000Z',validFromUtc:'2026-10-24T00:00:00.000Z',validUntilUtc:'2030-10-24T00:00:00.000Z',returnedAtUtc:null as string|null});
async function reception(page:Page,context:BrowserContext,{print=false}={}){
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic-regression',url:'http://localhost:18447'})));
 const s={denied:false,office:1,actionCalls:0,listCalls:0,history:false,holdList:false,releaseList:()=>{},returned:false,denyList:false,holdProfile:false,releaseProfile:()=>{},meCalls:0,holdCorrection:false,correctionFailure:0,correctionCalls:0,releaseCorrection:()=>{}};
 const visits=()=>[row(a,'Asha Rao'),row(b,'Rohan Mehta')].map(r=>({...r,...(s.returned&&r.visitRequestId===a?{returnedAtUtc:'2026-10-24T09:00:00.000Z',passStatus:'REVOKED'}:{})}));
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON();
  if(path==='/api/reception/me'){s.meCalls++;const snapshot={currentDate:'2026-10-24',displayName:'Reception audit',locations:[{locationId:s.office,locationName:s.office===1?'Noida':'Chennai',canPrint:print}]};if(s.holdProfile)await new Promise<void>(resolve=>{s.releaseProfile=resolve;});return route.fulfill({json:snapshot});}
  if(path==='/api/reception/list'){
   s.listCalls++;if(s.denyList)return route.fulfill({status:403,json:{error:'NOT_AUTHORIZED'}});if(s.holdList)await new Promise<void>(resolve=>{s.releaseList=resolve;});
   if(s.history){if(body.cursor)return route.fulfill({status:403,json:{error:'NOT_AUTHORIZED'}});return route.fulfill({json:{visits:[visits()[0]],cursor:{lastSubmittedAtUtc:'2026-10-24T06:00:00.000Z',lastVisitRequestId:a}}});}
   return route.fulfill({json:{visits:visits(),cursor:null,pendingReturnCount:0}});
  }
  if(path==='/api/reception/detail')return route.fulfill({json:visits().find(v=>v.visitRequestId===body.visitRequestId)});
  if(path==='/api/reception/preview')return route.fulfill({json:{mimeType:'image/png',imageBase64:png}});
  if(path==='/api/reception/correct-return'){s.correctionCalls++;const failure=s.correctionFailure;if(s.holdCorrection)await new Promise<void>(resolve=>{s.releaseCorrection=resolve;});if(failure)return route.fulfill({status:failure,json:{error:'UNAVAILABLE'}});s.returned=false;s.holdList=true;return route.fulfill({json:{correctedAtUtc:'2026-10-24T09:00:00.000Z'}});}
  if(path==='/api/reception/return'){s.returned=true;s.holdList=true;return route.fulfill({json:{returnedAtUtc:'2026-10-24T09:00:00.000Z'}});}
  if(path==='/api/operations/actions'){s.actionCalls++;return route.fulfill(s.denied||body.locationId!==s.office?{status:403,json:{error:'NOT_AUTHORIZED'}}:{json:{category:body.category,checkedAtUtc:new Date().toISOString(),counts:{pending:1,expiredInside:0,unreturned:0},items:[{visitRequestId:a,personName:'Asha Rao',publicPassNumber:'GP-ASHA'}],cursor:null}});}
  if(path.endsWith('/remind-host'))return route.fulfill({json:{eligible:false}});
  return route.fulfill({json:{}});
 });
 return{context,page,s};
}
const guard='20000000-0000-4000-8000-000000000001',visit='30000000-0000-4000-8000-000000000001';
const project=(n:number)=>({projectLocationId:String(n),projectId:String(n),projectName:'Project '+n,projectCode:'PRJ-'+n,directoryCurrent:true,canAssignProject:false,canAssignLocation:false});
async function admin(page:Page,context:BrowserContext,{count=1,at,mixed=false,officeDay='2026-10-24'}:{count?:number;at?:string;mixed?:boolean;officeDay?:string}={}){
 const common=false;
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic-admin-regression',url:'http://localhost:18447'})));if(at)await page.clock.install({time:new Date(at)});
 const s={projects:Array.from({length:count},(_,i)=>project(i+1)),office:1,contextCalls:0,holdContext:false,releaseContext:()=>{},scopeCalls:0,holdScope:false,releaseScope:()=>{},denyScope:false,assignmentReads:[] as string[],commonFailure:false,total:51,denyProject:false,allocations:[] as Array<{validUntilUtc?:string}>};
 const scope={userId:'10000000-0000-4000-8000-000000000001',currentDate:officeDay,canReport:true,canReadVisits:true,canAudit:false,canAssignGuards:true,canManageRoles:false,roles:[{roleCode:mixed?'PROJECT_ADMIN':'LOCATION_ADMIN',scopeType:mixed?'PROJECT_LOCATION':'LOCATION'}],delegations:[]};
 const visits={total:0,pending:0,approved:0,denied:0,cancelled:0};
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON();
  if(path==='/api/admin/context'){
   s.contextCalls++;const office=s.office;if(s.holdContext){s.holdContext=false;await new Promise<void>(resolve=>{s.releaseContext=resolve;});}
   return route.fulfill({json:{displayName:'Synthetic admin',locations:[{locationId:office,locationCode:office===1?'NOIDA':'CHENNAI',locationName:office===1?'Noida':'Chennai',canCreateProject:false,canManageCommonAreas:common}]}});
  }
  if(path==='/api/admin/projects'){
   if(body.locationId!==s.office)return route.fulfill({status:403,json:{error:'NOT_AUTHORIZED'}});const offset=Number(body.cursor?.afterProjectLocationId??0),items=s.projects.slice(offset,offset+25);return route.fulfill({json:{projects:items,cursor:offset+25<s.projects.length?{afterProjectLocationId:String(offset+25)}:null}});
  }
  if(path==='/api/admin/scope'){if(mixed&&!body.projectLocationId)return route.fulfill({status:403,json:{error:'NOT_AUTHORIZED'}});s.scopeCalls++;if(s.holdScope){s.holdScope=false;await new Promise<void>(resolve=>{s.releaseScope=resolve;});}return route.fulfill(s.denyScope||body.locationId!==s.office?{status:403,json:{error:'NOT_AUTHORIZED'}}:{json:scope});}
  if(path==='/api/admin/summary-range')return route.fulfill({json:{visits,days:[{localVisitDate:'2026-10-24',visits}],recordedPresence:{projectVisitsInside:0,digitalIdsInside:0}}});
  if(path==='/api/admin/leads')return route.fulfill({json:{leads:[],cursor:null}});
  if(path==='/api/admin/guards')return route.fulfill({json:{guards:[{userId:guard,displayName:'Rakesh Kumar',active:true,overlappingAssignment:false,canAllocate:true}],hasMore:false,afterUserId:null}});
  if(path==='/api/admin/assignments'){s.assignmentReads.push(body.projectLocationId);if(s.denyProject&&body.projectLocationId==='2')return route.fulfill({status:403,json:{error:'NOT_AUTHORIZED'}});return route.fulfill({json:{assignments:!common&&body.projectLocationId===String(count)?[{assignmentId:'1',userId:guard,guardName:'Rakesh Kumar',validFromUtc:'2026-10-01T00:00:00.000Z',validUntilUtc:null}]:[],cursor:null}});}
  if(path==='/api/admin/common-duties')return route.fulfill(s.commonFailure?{status:503,json:{error:'UNAVAILABLE'}}:{json:{areas:[{areaId:'1',name:'Lobby'}],assignments:[{assignmentId:'1',areaId:'1',areaName:'Lobby',guardUserId:guard,guardName:'Rakesh Kumar'}],hasMore:false}});
  if(path==='/api/admin/allocate'){s.allocations.push(body);return route.fulfill({json:{ok:true}});}
  if(path==='/api/admin/register'){const size=Math.min(50,Math.max(0,s.total-(body.page-1)*50));return route.fulfill({json:{rows:Array.from({length:size},(_,i)=>({visitRequestId:visit.slice(0,-4)+String((body.page-1)*50+i+1).padStart(4,'0'),personName:'Synthetic Visitor '+((body.page-1)*50+i+1),publicReference:'V-AUDIT',projectName:'Project 1',hostName:'Meera Singh',requestType:'EXTERNAL',status:'APPROVED',passStatus:'ACTIVE',presence:'INSIDE',printStatus:'NOT_PRINTED',localVisitDate:'2026-10-24',submittedAtUtc:'2026-10-24T06:00:00.000Z',validFromUtc:'2026-10-24T00:00:00.000Z',validUntilUtc:'2030-10-24T00:00:00.000Z'})),page:body.page,total:s.total,pageSize:50}});}
  if(path==='/api/operations/actions')return route.fulfill(s.denyScope?{status:403,json:{error:'NOT_AUTHORIZED'}}:{json:{category:body.category,checkedAtUtc:new Date().toISOString(),counts:{pending:1,expiredInside:0,unreturned:0},items:[{visitRequestId:visit,personName:'Asha Rao',publicPassNumber:'GP-ASHA'}],cursor:null}});
  return route.fulfill({json:{}});
 });
 await page.goto('/admin');await expect(page.locator('#summary-cards')).toContainText('Registered');await page.evaluate('liveRefresh.close()');return{page,context,s};
}

async function openCorrection(page:Page,context:BrowserContext){const{s}=await reception(page,context,{print:true});s.returned=true;await page.goto('/reception');await expect(page.locator('#visit-rows tr')).toHaveCount(2);await page.evaluate('liveRefresh.close()');await page.getByRole('button',{name:'View pass for Asha Rao',exact:true}).click();await expect(page.locator('#detail-card-control select')).toBeVisible();await page.locator('#detail-card-control select').selectOption('CORRECT');await page.locator('#correct-return-reason').fill('Receipt marked returned by mistake; visitor still has the pass');return s;}
async function settled(page:Page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
for(const selection of ['unchanged','newer','closed'])test('return correction respects '+selection+' details during its delayed list refresh',async({page,context})=>{
 const s=await openCorrection(page,context);await page.locator('#correct-return-submit').click();await expect(page.locator('#correct-return-dialog')).toBeHidden();await expect.poll(()=>s.listCalls).toBe(2);if(selection!=='unchanged'){await page.locator('#close-visit').click();await page.getByRole('button',{name:'View pass for Rohan Mehta',exact:true}).click();await expect(page.locator('#detail-name')).toHaveText('Rohan Mehta');if(selection==='closed')await page.locator('#close-visit').click();}s.holdList=false;s.releaseList();await expect.poll(()=>page.evaluate('state.listBusy')).toBe(false);await settled(page);
 if(selection==='closed')await expect(page.locator('#visit-dialog')).toBeHidden();else{await expect(page.locator('#detail-name')).toHaveText(selection==='newer'?'Rohan Mehta':'Asha Rao');if(selection==='unchanged')await expect(page.locator('#detail-card-control select option:checked')).toHaveText('Printed');}
});
for(const failure of [0,503])test('correction '+(failure?'failure':'success')+' after an office replacement cannot reopen or paint the old dialog',async({page,context})=>{
 const s=await openCorrection(page,context);s.holdCorrection=true;s.correctionFailure=failure;await page.locator('#correct-return-submit').click();await expect(page.locator('#correct-return-submit')).toBeDisabled();await expect.poll(()=>s.correctionCalls).toBe(1);s.office=2;await page.evaluate('refreshCalendar()');await expect(page.locator('#office-name')).toHaveText('Chennai');const completed=page.waitForResponse(r=>r.url().endsWith('/api/reception/correct-return'));s.releaseCorrection();await(await completed).finished();if(!failure){s.holdList=false;s.releaseList();}await expect.poll(()=>page.evaluate('state.returnBusy')).toBe(false);await settled(page);await expect(page.locator('#visit-dialog')).toBeHidden();await expect(page.locator('#correct-return-dialog')).toBeHidden();await expect(page.locator('#correct-return-status')).toBeEmpty();await expect(page.locator('#office-name')).toHaveText('Chennai');
});
for(const reset of ['denial','office','pagehide'])test('a late reception profile cannot reopen after '+reset,async({page,context})=>{
 const{s}=await reception(page,context);await page.goto('/reception');await expect(page.locator('#visit-rows tr')).toHaveCount(2);await page.evaluate('liveRefresh.close()');s.holdProfile=true;await page.locator('#account-toggle').click();await page.locator('#open-profile').click();await expect.poll(()=>s.meCalls).toBe(2);s.holdProfile=false;
 if(reset==='denial'){s.denyList=true;await page.locator('#refresh').click();await expect.poll(()=>page.evaluate('state.accessDenied')).toBe(true);}else if(reset==='office'){s.office=2;await page.evaluate('refreshCalendar()');await expect(page.locator('#office-name')).toHaveText('Chennai');}else await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
 const completed=page.waitForResponse(r=>r.url().endsWith('/api/reception/me'));s.releaseProfile();await(await completed).finished();await settled(page);await expect(page.locator('#profile-dialog')).toBeHidden();await expect(page.locator('#profile-fields')).toBeEmpty();await expect(page.locator('#profile-offices')).toBeEmpty();
});
for(const timezoneId of ['America/Los_Angeles','Asia/Tokyo','Asia/Kolkata'])test.describe('office duty time in '+timezoneId,()=>{
 test.use({timezoneId});
 test('Today only submits the same India office expiry',async({page,context})=>{
  const{s}=await admin(page,context,{count:2,at:'2026-10-24T18:00:00.000Z'});await page.locator('[data-admin-view=assignments]').click();await expect(page.locator('#roster-status')).toContainText('Showing');await page.locator('#assign-guard-open').click();await page.locator('#allocation-project').selectOption('1');await page.locator('#allocation-guard').selectOption(guard);await page.locator('[data-until=today]').click();await page.locator('#allocation-reason').fill('Front gate cover for the remaining India office day');await page.locator('#allocate-button').click();await expect.poll(()=>s.allocations.length).toBe(1);expect(s.allocations[0].validUntilUtc).toBe('2026-10-24T18:29:00.000Z');
 });
});
test.describe('office dates across midnight and custom input',()=>{
 test.use({timezoneId:'America/Los_Angeles'});
 for(const mode of ['today','custom'])test(mode+' uses the authorized India date and explicit IST input',async({page,context})=>{
  const{s}=await admin(page,context,{count:2,at:'2026-10-24T19:00:00.000Z',officeDay:'2026-10-25'});await page.locator('[data-admin-view=assignments]').click();await expect(page.locator('#roster-status')).toContainText('Showing');await page.locator('#assign-guard-open').click();await page.locator('#allocation-project').selectOption('1');await page.locator('#allocation-guard').selectOption(guard);await page.locator('[data-until='+mode+']').click();if(mode==='custom'){await page.locator('#allocation-until').fill('2026-10-25T18:00');await expect(page.locator('#allocation-timezone')).toContainText('IST');}await page.locator('#allocation-reason').fill('Office duty with explicit India expiry');await page.locator('#allocate-button').click();await expect.poll(()=>s.allocations.length).toBe(1);expect(s.allocations[0].validUntilUtc).toBe(mode==='today'?'2026-10-25T18:29:00.000Z':'2026-10-25T12:30:00.000Z');
 });
});
test('denied project coverage exposes unknown availability, clears old duties and recovers cleanly',async({page,context})=>{
 const{s}=await admin(page,context,{count:2,mixed:true});await page.locator('[data-admin-view=assignments]').click();await expect(page.locator('.roster-row')).toContainText('Project 2');s.denyProject=true;await page.evaluate('loadAssignments()');expect(await page.evaluate('consoleState.scope!==null')).toBe(true);await expect(page.locator('#roster-status')).toContainText('unavailable');await expect(page.locator('.roster-row')).not.toContainText('Project 2');await expect(page.locator('.roster-row')).toContainText('Availability unknown');await expect(page.locator('[data-guard-filter=free]')).toBeDisabled();await expect(page.locator('#guard-stats .admin-stat').filter({has:page.getByText('Free',{exact:true})}).locator('strong')).toHaveText('—');
 await page.locator('[data-roster-view=project]').click();await expect(page.locator('#project-duty-list')).not.toContainText('Project 2');await page.locator('#assign-guard-open').click();await expect(page.locator('#allocation-project option[value="2"]')).toBeDisabled();await expect(page.locator('#allocation-guard option').last()).toContainText('availability unknown');await expect(page.locator('#allocation-hint')).toContainText('unknown');await page.getByRole('button',{name:'Close guard assignment',exact:true}).click();s.denyProject=false;await page.evaluate('loadAssignments()');await expect(page.locator('#roster-status')).not.toContainText('unavailable');await expect(page.locator('[data-guard-filter=free]')).toBeEnabled();await expect(page.locator('#guard-stats .admin-stat').filter({has:page.getByText('Free',{exact:true})}).locator('strong')).toHaveText('0');
});
