import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const adminId='11111111-1111-4111-8111-111111111111',guardA='22222222-2222-4222-8222-222222222222',guardB='33333333-3333-4333-8333-333333333333';
const visit=(n:number,status:string)=>({visitRequestId:'00000000-0000-4000-8000-00000000000'+n,localVisitDate:'2026-10-22',submittedAtUtc:'2026-10-22T04:30:00.000Z',personName:'Visitor '+n,employeeId:null,personEmail:null,personPhone:null,companyName:null,deviceTypes:null,locationName:'Noida',projectName:'Project Alpha',hostName:'Employee Host',hostEmail:null,requestType:'EXTERNAL',reason:'Meeting',publicReference:'V-'+n,publicPassNumber:'P-'+n,status,passStatus:'ACTIVE',presence:'OUTSIDE',printStatus:'PRINTED',returnedAtUtc:null,validFromUtc:'2026-10-22T04:30:00.000Z',validUntilUtc:'2026-10-22T12:30:00.000Z',firstEntryAtUtc:null,lastEntryAtUtc:null,lastExitAtUtc:null});
test('admin pages show scope controls only where they apply, roster, visit timeline, Excel export and log view',async({page,context})=>{
 await context.addCookies(['gp-staff-session','gp-staff-csrf'].map(name=>({name,value:'synthetic',url:'http://localhost:18447'})));
 const registerCalls:any[]=[];
 await page.route('**/api/admin/**',async route=>{
  const action=new URL(route.request().url()).pathname.split('/').at(-1),d=route.request().postDataJSON(),reply=(json:any)=>route.fulfill({json});
  if(action==='context')return reply({displayName:'Scoped Admin',locations:[{locationId:1,locationCode:'NOIDA',locationName:'Noida',canManageCommonAreas:true}]});
  if(action==='projects')return reply({projects:['1','2'].map(n=>({projectLocationId:n,projectId:n,projectName:n==='1'?'Project Alpha':'Project Beta',projectCode:n==='1'?'ALPHA':'BETA',directoryCurrent:true,canAssignLocation:true,canAssignProject:false})),cursor:null});
  if(action==='scope')return reply({userId:adminId,currentDate:'2026-10-22',canReport:true,canReadVisits:true,canAudit:true,canManageRoles:true,canAssignGuards:true,roles:[{roleCode:'LOCATION_ADMIN',scopeType:'LOCATION'}],delegations:[]});
  if(action==='summary')return reply({visits:{total:'0',pending:'0',approved:'0',denied:'0',cancelled:'0'},recordedPresence:{projectVisitsInside:'0',digitalIdsInside:'0'}});
  if(action==='leads')return reply({leads:d.projectLocationId==='1'?[{roleGrantId:'1',displayName:'Lead One',employeeId:'E1',email:'lead@example.invalid',scopeType:'PROJECT_LOCATION',canRemove:false}]:[],cursor:null});
  if(action==='guards')return reply({guards:[{userId:guardA,displayName:'Guard A',overlappingAssignment:false,canAllocate:true},{userId:guardB,displayName:'Guard B',overlappingAssignment:false,canAllocate:true}],hasMore:false,afterUserId:null});
  if(action==='assignments')return reply({assignments:d.projectLocationId==='1'?[{assignmentId:'7',userId:guardA,guardName:'Guard A',validFromUtc:'2026-10-21T00:00:00.000Z',validUntilUtc:null}]:[],cursor:null});
  if(action==='common-duties')return reply({areas:[],assignments:[],hasMore:false});
  if(action==='register'){registerCalls.push(d);return reply({rows:[visit(1,'APPROVED'),visit(2,'PENDING')],page:1,total:2,pageSize:50});}
  if(action==='visit-detail')return reply({personName:'Visitor 1',status:'APPROVED',passStatus:'ACTIVE',locationName:'Noida',projectName:'Project Alpha',hostName:'Employee Host',reason:'Meeting',publicPassNumber:'P-1',validFromUtc:'2026-10-22T04:30:00.000Z',validUntilUtc:'2026-10-22T12:30:00.000Z',movements:[{accessEventId:'1',eventType:'ENTRY',entryMethod:'SCAN',guardName:'Guard A',occurredAtUtc:'2026-10-22T05:00:00.000Z'},{accessEventId:'2',eventType:'EXIT',entryMethod:'MANUAL',guardName:'Guard B',occurredAtUtc:'2026-10-22T09:15:00.000Z'}],movementsHasMore:false});
  if(action==='audit')return reply({events:[{actionCode:'ROLE_GRANTED',actorDisplayName:'Scoped Admin',occurredAtUtc:'2026-10-22T04:00:00.000Z',targetType:'ROLE',resultCode:'SUCCESS',reason:'Delegation'},{actionCode:'ROLE_GRANTED',actorDisplayName:'Scoped Admin',occurredAtUtc:'2026-10-22T03:00:00.000Z',targetType:'ROLE',resultCode:'DENIED'}],hasMore:false});
  return reply({});
 });
 await page.goto('/admin');await expect(page.locator('#summary-cards')).toContainText('Registered');
 await expect(page.locator('#console-project')).toBeVisible();await expect(page.locator('#console-scope #refresh')).toBeVisible();

 await page.locator('[data-admin-view="projects"]').click();
 await expect(page.locator('#console-scope')).toBeHidden();await expect(page.locator('#admin-projects #refresh')).toBeVisible();
 await expect(page.locator('#common-duties-open')).toBeVisible();await expect(page.locator('#common-area-new')).toBeVisible();
 await expect(page.locator('#projects .project-card').filter({hasText:'Project Alpha'})).toContainText('Lead One');
 await expect(page.locator('#projects .project-card').filter({hasText:'Project Beta'})).toContainText('No project lead assigned');
 await page.locator('#project-search').fill('beta');await expect(page.locator('#projects .project-card')).toHaveCount(1);await page.locator('#project-search').fill('');

 await page.locator('[data-admin-view="assignments"]').click();
 await expect(page.locator('#console-scope')).toBeHidden();await expect(page.locator('#admin-assignments #refresh')).toBeVisible();
 await expect(page.locator('#guard-stats')).toContainText('Total guards');await expect(page.locator('#assignment-list .roster-row')).toHaveCount(2);
 await expect(page.locator('#assignment-list [data-user-id="'+guardA+'"]')).toContainText('Project Alpha');await expect(page.locator('#assignment-list [data-user-id="'+guardB+'"]')).toContainText('Free');
 await page.locator('[data-guard-filter="free"]').click();await expect(page.locator('#assignment-list .roster-row')).toHaveCount(1);await expect(page.locator('#assignment-list')).toContainText('Guard B');
 await page.locator('[data-roster-view="project"]').click();await page.locator('[data-guard-filter="all"]').click();await expect(page.locator('#project-duty-list')).toContainText('No guard');
 await page.locator('#assign-guard-open').click();await expect(page.locator('#assign-dialog')).toBeVisible();await page.locator('#allocation-project').selectOption('2');await expect(page.locator('#allocation-guard option').filter({hasText:'Guard B · free'})).toHaveCount(1);await page.locator('[data-close="assign-dialog"]').first().click();

 await page.locator('[data-admin-view="reports"]').click();await expect(page.locator('#report-list tr')).toHaveCount(2);await expect(page.locator('#console-scope')).toBeVisible();
 await page.locator('#quick-status').selectOption('APPROVED');await expect.poll(()=>registerCalls.at(-1)?.filters).toEqual({status:'APPROVED'});
 await page.locator('#report-list tr').first().click();await expect(page.locator('#admin-visit-dialog')).toBeVisible();
 await expect(page.locator('#admin-visit-timeline')).toContainText('Entered premises');await expect(page.locator('#admin-visit-timeline')).toContainText('Left premises');await expect(page.locator('#admin-visit-timeline')).toContainText('Request registered');
 await page.locator('[data-close="admin-visit-dialog"]').click();
 await expect(page.locator('#register-export')).toBeEnabled();
 const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#register-export').click()]);
 expect(download.suggestedFilename()).toMatch(/^GatePass-Visit-Register-Noida-2026-10-22_to_2026-10-22\.xlsx$/u);
 expect(readFileSync(await download.path()!).subarray(0,2).toString()).toBe('PK');

 await page.locator('[data-admin-view="audit"]').click();await expect(page.locator('#audit-list .log-line')).toHaveCount(2);
 await page.locator('#audit-result').selectOption('DENIED');await expect(page.locator('#audit-list .log-line')).toHaveCount(1);await expect(page.locator('#audit-status')).toContainText('1 of 2');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
