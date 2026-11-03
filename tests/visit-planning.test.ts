import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildVersion, parseDraft } from '../src/planning/Policy.ts';
import { canReadThread, changeVisitPlan, createVisitPlan, projectReadiness, readVisitPlan } from '../src/planning/Workflow.ts';
import { PlanningError } from '../src/planning/Types.ts';
import type { PlanningCommand, PlanningContext, VisitPlan, VisitPlanDraft } from '../src/planning/Types.ts';

const id = (n: number) => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
const host = id(1), a = id(2), b = id(3), facilities = id(4), vip = id(5), security = id(6), stranger = id(7), admin = id(8), client = id(9), reception = id(10);
const pa = id(100), pb = id(101), pc = id(102), ra = id(200), rb = id(201), rl = id(202), rc = id(203), stayTask = id(300);
function fixture() {
  const context: PlanningContext = {
    nowUtc: '2026-11-01T06:00:00.000Z',
    people: [host, a, b, facilities, vip, security, stranger, admin, client, reception].map(userId => ({ userId, active: true, internal: true, manageLocationIds: userId === admin ? [1] : [], manageAccountOfficeIds: [] })),
    locations: [{ locationId: 1, revision: 1, active: true, locationHostIds: [host],
      approvalRules: [{ id: rl, name: 'Office security', kind: 'SECURITY', mode: 'ALL', approverIds: [security] }],
      arrangements: [{ id: stayTask, name: 'Stay arrangement', kind: 'STAY', mandatoryForEntry: false, ownerIds: [facilities] }],
      receptionIds: [reception], securityIds: [security], notifyIds: [vip], vipNotifyIds: [vip], maximumAdvanceDays: 90, maximumVisitDays: 30 }],
    projects: [
      { subProjectId: pa, accountOfficeId: '1', locationId: 1, name: 'Alpha', active: true, revision: 1, hostIds: [host], approvalRules: [{ id: ra, name: 'Alpha authority', kind: 'PROJECT', mode: 'ALL', approverIds: [a] }] },
      { subProjectId: pb, accountOfficeId: '2', locationId: 1, name: 'Beta', active: true, revision: 1, hostIds: [host], approvalRules: [{ id: rb, name: 'Beta authority', kind: 'PROJECT', mode: 'ALL', approverIds: [b] }] },
      { subProjectId: pc, accountOfficeId: '3', locationId: 2, name: 'Other office', active: true, revision: 1, hostIds: [host], approvalRules: [] },
    ],
    accountHosts: [{ accountOfficeId: '1', locationId: 1, userIds: [host] }, { accountOfficeId: '2', locationId: 1, userIds: [host] }],
  };
  const draft: VisitPlanDraft = { locationId: 1, subProjectIds: [pa, pb], visitorName: 'Synthetic guest', visitorEmail: 'guest@example.com', purpose: 'Client meeting', startsAtUtc: '2026-11-02T04:30:00.000Z', untilUtc: '2026-11-03T12:30:00.000Z', vip: true };
  const create = () => createVisitPlan(randomUUID(), draft, host, context);
  const change = (plan: VisitPlan, command: PlanningCommand, user = host) => changeVisitPlan(plan, command, user, { clientKey: randomUUID(), expectedRevision: plan.revision }, context);
  const submit = () => change(create(), { kind: 'SUBMIT' });
  const decide = (plan: VisitPlan, stepId: string, user: string, decision: 'APPROVED' | 'REJECTED' = 'APPROVED') => change(plan, { kind: 'DECIDE', stepId, decision, reason: 'Synthetic reviewed decision' }, user);
  return { context, draft, create, change, submit, decide };
}
function rejects(code: PlanningError['code'], work: () => unknown) { assert.throws(work, error => error instanceof PlanningError && error.code === code); }

test('source-office host may request another account without destination membership or host assignment', () => {
  const f = fixture();
  f.context.locations[0].locationHostIds = [];
  f.context.accountHosts = [f.context.accountHosts[0]];
  f.context.projects.forEach(project => { project.hostIds = []; });
  const plan = f.submit();
  assert.deepEqual(plan.current.projects.map(project => project.subProjectId), [pa, pb]);
  assert.equal(projectReadiness(plan, pb, f.context), 'PENDING');
  rejects('NOT_AUTHORIZED', () => f.decide(plan, rb, host));
  const alphaReady = f.decide(f.decide(plan, ra, a), rl, security);
  assert.equal(projectReadiness(alphaReady, pa, f.context), 'READY');
  assert.equal(projectReadiness(alphaReady, pb, f.context), 'PENDING');
  assert.equal(projectReadiness(f.decide(alphaReady, rb, b), pb, f.context), 'READY');
  f.draft.subProjectIds = [pc]; rejects('NOT_AUTHORIZED', f.create);
});
test('hosting requires a current source grant in the requested office, not a destination roster alone', () => {
  const f = fixture(); f.context.locations[0].locationHostIds = [];
  f.context.accountHosts.forEach(account => { account.userIds = []; });
  rejects('NOT_AUTHORIZED', f.create);
  f.context.accountHosts[0].userIds = [host]; f.context.accountHosts[0].locationId = 2;
  rejects('NOT_AUTHORIZED', f.create);
  f.context.accountHosts[0].locationId = 1;
  f.context.accountHosts.push(structuredClone(f.context.accountHosts[0]));
  rejects('NOT_AUTHORIZED', f.create);
});
test('one internal visitor per plan, bounded fields, canonical dates and unknown input fields', () => {
  const f = fixture();
  for (const patch of [{ actorId: admin }, { visitorName: '' }, { visitorName: '\ud800' }, { visitorEmail: 'not-an-email' }, { subProjectIds: [pa, pa] }, { subProjectIds: [1] }, { vip: 'yes' }, { locationId: 0 }, { untilUtc: f.draft.startsAtUtc }, { startsAtUtc: '2026-02-30T06:00:00.000Z' }, { company: 'a'.repeat(201) }]) rejects('INVALID_INPUT', () => parseDraft({ ...f.draft, ...patch }));
  rejects('INVALID_INPUT', () => parseDraft([]));
  rejects('INVALID_INPUT', () => parseDraft(new Date()));
  rejects('INVALID_INPUT', () => parseDraft({ ...f.draft, stay: { checkInDate: '2026-11-02', checkOutDate: '2026-11-01' } }));
  rejects('INVALID_INPUT', () => parseDraft({ ...f.draft, stay: { checkInDate: '2026-12-02', checkOutDate: '2026-12-03' } }));
  rejects('INVALID_INPUT', () => parseDraft({ ...f.draft, stay: { checkInDate: '2026-11-02', checkOutDate: '2026-11-03', notes: '\u0000' } }));
  rejects('INVALID_INPUT', () => buildVersion({ ...f.draft, startsAtUtc: '2026-10-31T06:00:00.000Z' }, host, f.context));
  rejects('INVALID_INPUT', () => buildVersion({ ...f.draft, untilUtc: '2027-02-01T06:00:00.000Z' }, host, f.context));
  rejects('INVALID_INPUT', () => buildVersion({ ...f.draft, startsAtUtc: '2027-06-01T06:00:00.000Z', untilUtc: '2027-06-02T06:00:00.000Z' }, host, f.context));
});
test('missing, duplicated, inactive, external and self-only approval configuration fails closed', () => {
  for (const corrupt of [
    (c: PlanningContext) => c.locations.splice(0),
    (c: PlanningContext) => c.locations.push(structuredClone(c.locations[0])),
    (c: PlanningContext) => c.projects[0].approvalRules.splice(0),
    (c: PlanningContext) => c.projects[0].approvalRules[0].approverIds.splice(0),
    (c: PlanningContext) => { c.projects[0].approvalRules[0].approverIds = [host]; },
    (c: PlanningContext) => { c.people[1].internal = false; },
    (c: PlanningContext) => { c.people[1].active = false; },
    (c: PlanningContext) => { c.projects[0].accountOfficeId = '9223372036854775808'; },
    (c: PlanningContext) => { c.projects[0].revision = 0; },
    (c: PlanningContext) => { c.locations[0].maximumAdvanceDays = 0; },
    (c: PlanningContext) => { c.projects[1].approvalRules[0].id = ra; },
  ]) { const f = fixture(); corrupt(f.context); rejects('POLICY_UNAVAILABLE', f.create); }
  const f = fixture(); f.context.people[0].internal = false; rejects('NOT_AUTHORIZED', f.create);
});
test('office rules cannot be skipped; projects approve independently and new readiness is not a legacy movement grant', () => {
  const f = fixture(); let plan = f.submit();
  assert.equal(projectReadiness(plan, pa, f.context), 'PENDING');
  plan = f.decide(plan, ra, a);
  assert.equal(projectReadiness(plan, pa, f.context), 'PENDING');
  plan = f.decide(plan, rl, security);
  assert.equal(projectReadiness(plan, pa, f.context), 'READY');
  assert.equal(projectReadiness(plan, pb, f.context), 'PENDING');
  plan = f.decide(plan, rb, b, 'REJECTED');
  assert.equal(projectReadiness(plan, pb, f.context), 'REJECTED');
  assert.equal(projectReadiness(plan, pa, f.context), 'READY');
  rejects('NOT_AUTHORIZED', () => projectReadiness(plan, pc, f.context));
  rejects('NOT_AUTHORIZED', () => projectReadiness(plan, null, f.context));
  assert.equal(Object.hasOwn(plan, 'passId'), false);
});
test('location-only visits require source-office hosting and office approvals, with no project access', () => {
  const f = fixture(); f.draft.subProjectIds = [];
  let plan = f.submit(); rejects('NOT_AUTHORIZED', () => projectReadiness(plan, pa, f.context));
  plan = f.decide(plan, rl, security); assert.equal(projectReadiness(plan, null, f.context), 'READY');
  f.context.locations[0].locationHostIds = []; assert.equal(f.create().state, 'DRAFT');
  f.context.accountHosts.forEach(account => { account.userIds = []; }); rejects('NOT_AUTHORIZED', f.create);
});
test('ALL requires everyone; ANY accepts the first assigned decision, never a later opposite decision', () => {
  const f = fixture(); f.context.projects[0].approvalRules[0].approverIds = [a, client];
  let plan = f.decide(f.submit(), rl, security); plan = f.decide(plan, ra, a);
  assert.equal(projectReadiness(plan, pa, f.context), 'PENDING');
  plan = f.decide(plan, ra, client); assert.equal(projectReadiness(plan, pa, f.context), 'READY');
  f.context.projects[0].approvalRules[0].mode = 'ANY';
  plan = f.decide(f.submit(), ra, client, 'REJECTED');
  rejects('CONFLICT', () => f.decide(plan, ra, a));
  assert.equal(projectReadiness(plan, pa, f.context), 'REJECTED');
});
test('only internal assigned authorities decide; client confirmation needs an internal recorded reference', () => {
  const f = fixture(); f.context.projects[0].approvalRules.push({ id: rc, name: 'Internal client coordinator', kind: 'CLIENT_CONFIRMATION', mode: 'ANY', approverIds: [client] });
  let plan = f.submit();
  for (const user of [host, facilities, vip, admin, stranger]) rejects('NOT_AUTHORIZED', () => f.decide(plan, ra, user));
  rejects('INVALID_INPUT', () => f.decide(plan, rc, client));
  plan = f.change(plan, { kind: 'DECIDE', stepId: rc, decision: 'APPROVED', reason: 'Arranged with client', reference: 'Internal approval reference 42' }, client);
  assert.equal(plan.current.approvals.find(step => step.id === rc)!.decisions[0].reference, 'Internal approval reference 42');
  f.context.people.find(person => person.userId === a)!.internal = false;
  rejects('NOT_AUTHORIZED', () => f.decide(plan, ra, a));
});
test('stay requests are provisional and facility actions cannot approve; optional arrangements do not block project approval', () => {
  const f = fixture(); f.draft.stay = { checkInDate: '2026-11-02', checkOutDate: '2026-11-04', notes: 'Synthetic guest stay' };
  let plan = f.decide(f.decide(f.submit(), ra, a), rl, security);
  assert.equal(plan.current.tasks[0].status, 'REQUESTED'); assert.equal(projectReadiness(plan, pa, f.context), 'READY');
  for (const user of [host, admin, a, vip]) rejects('NOT_AUTHORIZED', () => f.change(plan, { kind: 'ARRANGE', taskId: stayTask, status: 'CONFIRMED', remark: 'Booked' }, user));
  plan = f.change(plan, { kind: 'ARRANGE', taskId: stayTask, status: 'UNAVAILABLE', remark: 'Need alternative' }, facilities);
  assert.equal(projectReadiness(plan, pa, f.context), 'READY');
  plan = f.change(plan, { kind: 'ARRANGE', taskId: stayTask, status: 'CONFIRMED', remark: 'Alternative booking confirmed' }, facilities);
  assert.equal(plan.current.tasks[0].status, 'CONFIRMED');
  rejects('CONFLICT', () => f.change(plan, { kind: 'ARRANGE', taskId: stayTask, status: 'CONFIRMED', remark: 'Duplicate' }, facilities));
  assert.equal(f.create().current.approvals[1].decisions.length, 0);
});
test('mandatory arrangements block until confirmation and owner removal blocks readiness', () => {
  const f = fixture(); f.draft.stay = { checkInDate: '2026-11-02', checkOutDate: '2026-11-04' }; f.context.locations[0].arrangements[0].mandatoryForEntry = true;
  let plan = f.decide(f.decide(f.submit(), ra, a), rl, security);
  assert.equal(projectReadiness(plan, pa, f.context), 'PENDING');
  plan = f.change(plan, { kind: 'ARRANGE', taskId: stayTask, status: 'UNAVAILABLE', remark: 'No rooms' }, facilities);
  assert.equal(projectReadiness(plan, pa, f.context), 'BLOCKED');
  plan = f.change(plan, { kind: 'ARRANGE', taskId: stayTask, status: 'CONFIRMED', remark: 'Resolved' }, facilities);
  assert.equal(projectReadiness(plan, pa, f.context), 'READY');
  f.context.people.find(person => person.userId === facilities)!.active = false;
  assert.equal(projectReadiness(plan, pa, f.context), 'BLOCKED');
});
test('missing stay owners cannot silently skip an arrangement; no automatic stay task on a normal visit', () => {
  const f = fixture(); assert.equal(f.submit().current.tasks.length, 0);
  f.draft.stay = { checkInDate: '2026-11-02', checkOutDate: '2026-11-04' };
  f.context.locations[0].arrangements = []; rejects('POLICY_UNAVAILABLE', f.create);
});
test('VIP recipients receive a deduplicated notice intent but gain no workspace or discussion permission', () => {
  const f = fixture(), draft = f.create(); assert.equal(draft.notices.length, 0);
  const plan = f.change(draft, { kind: 'SUBMIT' });
  assert.equal(plan.notices.filter(notice => notice.recipientId === vip && notice.kind === 'FYI').length, 1);
  for (const user of [vip, stranger]) rejects('NOT_AUTHORIZED', () => readVisitPlan(plan, user, f.context));
  assert.equal(plan.current.approvals.some(step => step.approverIds.includes(vip)), false);
});
test('private project/approval threads do not leak across teams; operational users see only their arrangements', () => {
  const f = fixture(); f.draft.stay = { checkInDate: '2026-11-02', checkOutDate: '2026-11-04' };
  let plan = f.submit();
  plan = f.change(plan, { kind: 'THREAD', threadId: id(400), title: 'Alpha authority', audience: 'APPROVAL', subProjectId: pa, targetId: ra }, a);
  plan = f.change(plan, { kind: 'COMMENT', threadId: id(400), messageId: id(500), body: 'Private review\nSecond line', replyToId: null, mentionIds: [] }, a);
  plan = f.change(plan, { kind: 'THREAD', threadId: id(401), title: 'Stay booking', audience: 'OPERATIONS', subProjectId: null, targetId: stayTask }, facilities);
  assert.equal(readVisitPlan(plan, host, f.context).threads.length, 1);
  assert.equal(readVisitPlan(plan, b, f.context).threads.length, 0);
  assert.equal(readVisitPlan(plan, a, f.context).threads.length, 1);
  assert.equal(readVisitPlan(plan, a, f.context).projects.length, 1);
  const operations = readVisitPlan(plan, facilities, f.context);
  assert.equal(operations.projects.length, 0); assert.equal(operations.approvals.length, 0); assert.equal(operations.tasks.length, 1);
  assert.equal(Object.hasOwn(operations, 'visitorEmail'), false); assert.equal(Object.hasOwn(operations, 'purpose'), false);
  assert.equal(Object.hasOwn(operations, 'history'), false); assert.equal(Object.hasOwn(operations, 'notices'), false);
  assert.equal(readVisitPlan(plan, admin, f.context).threads.length, 2);
});
test('mentions cannot recruit FYI/unrelated users; replies stay in their thread and do not complete tasks', () => {
  const f = fixture(); f.draft.stay = { checkInDate: '2026-11-02', checkOutDate: '2026-11-04' };
  let plan = f.change(f.submit(), { kind: 'THREAD', threadId: id(400), title: 'Stay', audience: 'OPERATIONS', subProjectId: null, targetId: stayTask });
  const comment = { kind: 'COMMENT' as const, threadId: id(400), messageId: id(500), body: 'Please arrange stay', replyToId: null, mentionIds: [facilities] };
  for (const mentionIds of [[vip], [stranger], [facilities, facilities]]) rejects('INVALID_INPUT', () => f.change(plan, { ...comment, mentionIds }));
  plan = f.change(plan, comment);
  plan = f.change(plan, { ...comment, messageId: id(501), body: 'Checking availability', replyToId: id(500), mentionIds: [host] }, facilities);
  assert.equal(plan.current.tasks[0].status, 'REQUESTED');
  assert.equal(plan.notices.filter(notice => notice.kind === 'DISCUSSION').length, 2);
  rejects('INVALID_INPUT', () => f.change(plan, { ...comment, messageId: id(502), replyToId: id(999) }));
  rejects('NOT_AUTHORIZED', () => f.change(plan, { ...comment, threadId: id(999) }));
  rejects('CONFLICT', () => f.change(plan, comment));
});
test('thread resolution and reopening are explicit and do not approve requests', () => {
  const f = fixture(); let plan = f.change(f.submit(), { kind: 'THREAD', threadId: id(400), title: 'Arrival', audience: 'GENERAL', subProjectId: null, targetId: null });
  rejects('NOT_AUTHORIZED', () => f.change(plan, { kind: 'THREAD_STATE', threadId: id(400), resolved: true }, a));
  plan = f.change(plan, { kind: 'THREAD_STATE', threadId: id(400), resolved: true });
  rejects('CONFLICT', () => f.change(plan, { kind: 'COMMENT', threadId: id(400), messageId: id(500), body: 'Late message', replyToId: null, mentionIds: [] }));
  rejects('CONFLICT', () => f.change(plan, { kind: 'THREAD_STATE', threadId: id(400), resolved: true }));
  plan = f.change(plan, { kind: 'THREAD_STATE', threadId: id(400), resolved: false });
  assert.equal(projectReadiness(plan, pa, f.context), 'PENDING');
});
test('stale writes and changed-payload replay fail; identical retry is idempotent and rechecks identity', () => {
  const f = fixture(), plan = f.create(), op = { clientKey: randomUUID(), expectedRevision: 1 };
  const changed = changeVisitPlan(plan, { kind: 'SUBMIT' }, host, op, f.context);
  assert.deepEqual(changeVisitPlan(changed, { kind: 'SUBMIT' }, host, op, f.context), changed);
  rejects('CONFLICT', () => changeVisitPlan(changed, { kind: 'CANCEL', reason: 'Different command' }, host, op, f.context));
  rejects('CONFLICT', () => changeVisitPlan(changed, { kind: 'SUBMIT' }, host, { ...op, clientKey: randomUUID() }, f.context));
  f.context.people[0].active = false;
  rejects('NOT_AUTHORIZED', () => changeVisitPlan(changed, { kind: 'SUBMIT' }, host, op, f.context));
  assert.equal(plan.state, 'DRAFT'); assert.equal(plan.events.length, 1);
});
test('rescheduling creates a new version and invalidates decisions; cancellation retains audit and notifies previous FYI recipients', () => {
  const f = fixture(); let plan = f.decide(f.submit(), ra, a);
  plan = f.change(plan, { kind: 'REVISE', draft: { ...f.draft, startsAtUtc: '2026-11-03T04:30:00.000Z' }, reason: 'Changed arrival' });
  assert.equal(plan.current.number, 2); assert.equal(plan.history[0].approvals[1].decisions.length, 1);
  assert.equal(plan.current.approvals[1].decisions.length, 0); assert.equal(projectReadiness(plan, pa, f.context), 'DRAFT');
  plan = f.change(plan, { kind: 'SUBMIT' });
  plan = f.change(plan, { kind: 'CANCEL', reason: 'Visit cancelled' });
  assert.equal(plan.events.at(-1)!.reason, 'Visit cancelled');
  assert.equal(projectReadiness(plan, pa, f.context), 'CANCELLED');
  assert(plan.notices.some(notice => notice.recipientId === vip && notice.kind === 'CANCELLED'));
  rejects('CONFLICT', () => f.change(plan, { kind: 'SUBMIT' }));
  rejects('CONFLICT', () => f.decide(plan, ra, a));
});
test('unpublished drafts do not notify participants, including new authorities introduced during revision', () => {
  const f = fixture();
  assert.equal(f.change(f.create(), { kind: 'CANCEL', reason: 'Unsent draft' }).notices.length, 0);
  let draft = f.change(f.create(), { kind: 'REVISE', draft: f.draft, reason: 'Unsent draft correction' });
  assert.equal(draft.notices.length, 0);
  draft = f.change(draft, { kind: 'SUBMIT' });
  f.context.projects[0].approvalRules[0].approverIds = [client];
  f.context.projects[0].revision++;
  draft = f.change(draft, { kind: 'REVISE', draft: { ...f.draft, visitorName: 'Unpublished guest' }, reason: 'New draft' });
  draft = f.change(draft, { kind: 'REVISE', draft: f.draft, reason: 'Another draft' });
  draft = f.change(draft, { kind: 'CANCEL', reason: 'Cancel published visit' });
  const cancellation = draft.notices.filter(notice => notice.eventSequence === draft.events.length);
  assert(cancellation.some(notice => notice.recipientId === a));
  assert(!draft.notices.some(notice => notice.recipientId === client));
});

test('current authority, policy revision and expiry are rechecked; removal does not leave a thread disclosure', () => {
  const f = fixture(); let plan = f.change(f.submit(), { kind: 'THREAD', threadId: id(400), title: 'Private Alpha', audience: 'APPROVAL', subProjectId: pa, targetId: ra }, a);
  f.context.projects[0].approvalRules[0].approverIds = [client];
  assert.equal(canReadThread(plan, plan.current.threads[0], a, f.context), false);
  rejects('NOT_AUTHORIZED', () => readVisitPlan(plan, a, f.context));
  rejects('NOT_AUTHORIZED', () => f.decide(plan, ra, a));
  f.context.projects[0].revision++;
  assert.equal(projectReadiness(plan, pa, f.context), 'POLICY_CHANGED');
  rejects('CONFLICT', () => f.decide(plan, rb, b));
  plan = f.change(plan, { kind: 'REVISE', draft: f.draft, reason: 'Refresh policy' });
  plan = f.change(plan, { kind: 'SUBMIT' });
  f.context.accountHosts[0].userIds = [];
  assert.equal(projectReadiness(plan, pa, f.context), 'PENDING');
  f.context.accountHosts.forEach(account => { account.userIds = []; });
  f.context.locations[0].locationHostIds = [];
  assert.equal(projectReadiness(plan, pa, f.context), 'BLOCKED');
  f.context.nowUtc = f.draft.untilUtc;
  assert.equal(projectReadiness(plan, pa, f.context), 'EXPIRED');
  rejects('CONFLICT', () => f.decide(plan, rb, b));
});
test('account administrators see only their selected sub-projects, while office authority stays in its location', () => {
  const f = fixture(); const person = f.context.people.find(p => p.userId === admin)!;
  person.manageLocationIds = []; person.manageAccountOfficeIds = ['1'];
  const plan = f.submit(); assert.deepEqual(readVisitPlan(plan, admin, f.context).projects.map(p => p.subProjectId), [pa]);
  person.manageAccountOfficeIds = ['3']; rejects('NOT_AUTHORIZED', () => readVisitPlan(plan, admin, f.context));
  rejects('NOT_AUTHORIZED', () => readVisitPlan(f.create(), a, f.context));
});
test('command schema prevents actor/recipient injection and invalid resource targeting', () => {
  const f = fixture(), plan = f.submit();
  for (const value of [{ kind: 'SUBMIT', actorId: admin }, { kind: 'UNKNOWN' }, null, [], { kind: 'CANCEL', reason: '' }, { kind: 'REVISE', reason: 'x', draft: { ...f.draft, recipients: [stranger] } }, { kind: 'COMMENT', threadId: id(400), messageId: id(500), body: '\u0000', replyToId: null, mentionIds: [] }]) rejects('INVALID_INPUT', () => changeVisitPlan(plan, value, host, { clientKey: randomUUID(), expectedRevision: plan.revision }, f.context));
  rejects('NOT_AUTHORIZED', () => f.change(plan, { kind: 'THREAD', threadId: id(400), title: 'Unknown destination', audience: 'GENERAL', subProjectId: pc, targetId: null }));
  rejects('INVALID_INPUT', () => changeVisitPlan(plan, { kind: 'SUBMIT' }, host, { clientKey: 'bad', expectedRevision: 1 }, f.context));
  rejects('CONFLICT', () => f.change(plan, { kind: 'SUBMIT' }));
});


test('extra approval is additive, scoped and cannot replace mandatory reviewers',()=>{
 const f=fixture();f.draft.additionalPeople=[{userId:stranger,kind:'APPROVAL',subProjectId:pa}];
 let plan=f.submit();const extra=plan.current.approvals.find(step=>step.approverIds.includes(stranger))!;
 assert.equal(plan.current.approvals.length,4);assert.equal(readVisitPlan(plan,stranger,f.context).projects.length,1);
 plan=f.decide(plan,extra.id,stranger);assert.equal(projectReadiness(plan,pa,f.context),'PENDING');
 plan=f.decide(f.decide(plan,ra,a),rl,security);assert.equal(projectReadiness(plan,pa,f.context),'READY');
 assert.equal(projectReadiness(plan,pb,f.context),'PENDING');
 f.draft.additionalPeople=[{userId:host,kind:'APPROVAL'}];rejects('INVALID_INPUT',f.create);
});
test('notify-only people receive one notice without dashboard or decision authority',()=>{
 const f=fixture();f.draft.additionalPeople=[{userId:stranger,kind:'NOTIFY'}];const plan=f.submit();
 assert.equal(plan.notices.filter(notice=>notice.recipientId===stranger&&notice.kind==='FYI').length,1);
 rejects('NOT_AUTHORIZED',()=>readVisitPlan(plan,stranger,f.context));
 rejects('NOT_AUTHORIZED',()=>f.decide(plan,ra,stranger));
});
test('requested support has a current named owner, independent tasks and limited preparation visibility',()=>{
 const f=fixture();f.draft.stay={checkInDate:'2026-11-02',checkOutDate:'2026-11-03'};
 f.draft.preparation={category:'CLIENT',visitType:'MEETING',services:['MEETING_ROOM','TRANSPORT'],devices:['LAPTOP'],specialAccess:['NETWORK'],coordinatorId:stranger,visitOwnerId:vip,alternateReceiverId:vip,agenda:'PRIVATE_AGENDA',meetingLocation:'Meeting room 2',requirements:'Wheelchair route'};
 let plan=f.submit();const view=readVisitPlan(plan,stranger,f.context);
 assert.equal(view.projects.length,0);assert.equal(view.preparation?.agenda,undefined);assert.equal(view.preparation?.meetingLocation,'Meeting room 2');
 assert.equal(readVisitPlan(plan,facilities,f.context).preparation,undefined);
 assert.equal(readVisitPlan(plan,host,f.context).preparation?.agenda,'PRIVATE_AGENDA');
 const tasks=plan.current.tasks.filter(task=>task.ownerIds.includes(stranger));assert.equal(tasks.length,2);
 plan=f.decide(f.decide(plan,ra,a),rl,security);assert.equal(projectReadiness(plan,pa,f.context),'PENDING');
 for(const task of tasks){rejects('NOT_AUTHORIZED',()=>f.change(plan,{kind:'ARRANGE',taskId:task.id,status:'CONFIRMED',remark:'Done'},facilities));plan=f.change(plan,{kind:'ARRANGE',taskId:task.id,status:'CONFIRMED',remark:'Confirmed arrangement'},stranger);}
 assert.equal(projectReadiness(plan,pa,f.context),'READY');
 f.context.people.find(person=>person.userId===stranger)!.active=false;
 rejects('NOT_AUTHORIZED',()=>readVisitPlan(plan,stranger,f.context));
});
test('preparation and manual contacts reject unsupported, duplicate, external and unselected scopes',()=>{
 const f=fixture(),preparation={category:'GENERAL',visitType:'MEETING',services:[],devices:[],specialAccess:[]};
 for(const patch of [{category:'UNKNOWN'},{devices:['LAPTOP','LAPTOP']},{devices:['make/model']},{services:['PARKING']},{coordinatorId:'bad'},{agenda:'a'.repeat(2001)},{photoId:'123'}])rejects('INVALID_INPUT',()=>parseDraft({...f.draft,preparation:{...preparation,...patch}}));
 for(const additionalPeople of [[{userId:stranger,kind:'ADMIN'}],[{userId:stranger,kind:'NOTIFY',subProjectId:pc}],[{userId:stranger,kind:'NOTIFY'},{userId:stranger,kind:'APPROVAL'}]])rejects('INVALID_INPUT',()=>parseDraft({...f.draft,additionalPeople}));
 f.draft.additionalPeople=[{userId:stranger,kind:'NOTIFY'}];f.context.people.find(person=>person.userId===stranger)!.internal=false;rejects('INVALID_INPUT',f.create);
});

test('agenda and support notes retain multiline planning details while rejecting controls',()=>{
 const f=fixture(),preparation={category:'CLIENT',visitType:'MEETING',services:[],devices:[],specialAccess:[],agenda:'Welcome\nMeeting and site tour',requirements:'Accessible entrance\nGround floor'};
 assert.equal(parseDraft({...f.draft,preparation}).preparation?.agenda,preparation.agenda);
 rejects('INVALID_INPUT',()=>parseDraft({...f.draft,preparation:{...preparation,agenda:'bad\u0000text'}}));
});

test('versioned visit groups add internal approvals, deduplicate FYI and never grant email identity',()=>{
 const f=fixture();const group={id:id(900),revision:1,locationId:1,subProjectId:pa,name:'Noida VIP group',description:'Leadership',vipOnly:true,active:true,members:[{userId:stranger,kind:'APPROVAL' as const},{userId:vip,kind:'NOTIFY' as const},{email:'leaders@example.invalid',kind:'NOTIFY' as const}]};
 f.context.groups=[group];f.draft.groups=[{id:group.id,revision:1}];let plan=f.submit();
 const step=plan.current.approvals.find(review=>review.name==='Group approval')!;assert(step);
 assert.equal(readVisitPlan(plan,stranger,f.context).projects.length,1);assert.equal(plan.notices.filter(notice=>notice.recipientId===vip&&notice.kind==='FYI').length,1);assert.equal(plan.notices.filter(notice=>notice.recipientEmail==='leaders@example.invalid').length,1);
 plan=f.decide(plan,step.id,stranger);assert.equal(projectReadiness(plan,pa,f.context),'PENDING');
 group.revision=2;assert.equal(projectReadiness(plan,pa,f.context),'POLICY_CHANGED');rejects('NOT_AUTHORIZED',()=>readVisitPlan(plan,stranger,f.context));rejects('CONFLICT',f.create);
});
test('group selection rejects wrong office, unselected project, non-VIP and self approval',()=>{
 const f=fixture();const group={id:id(901),revision:1,locationId:1,subProjectId:pa,name:'Leadership',description:'',vipOnly:true,active:true,members:[{userId:stranger,kind:'APPROVAL' as const}]};f.context.groups=[group];f.draft.groups=[{id:group.id,revision:1}];
 f.draft.vip=false;rejects('NOT_AUTHORIZED',f.create);f.draft.vip=true;group.locationId=2;rejects('NOT_AUTHORIZED',f.create);group.locationId=1;group.subProjectId=pc;rejects('NOT_AUTHORIZED',f.create);group.subProjectId=pa;group.members[0].userId=host;rejects('INVALID_INPUT',f.create);
 for(const groups of [[{id:group.id,revision:1},{id:group.id,revision:1}],[{id:group.id,revision:0}],[{id:'bad',revision:1}]])rejects('INVALID_INPUT',()=>parseDraft({...f.draft,groups}));
});
