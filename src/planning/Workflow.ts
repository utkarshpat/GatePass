import { createHash } from 'node:crypto';
import { accessScope, activeInternal, actor, boundedText, buildVersion, currentPolicyMatches, distinct, hostEligible, liveApprover, liveTaskOwner, parseDraft, projectManager, record, requireInput, timestamp, uuid } from './Policy.ts';
import { PlanningError } from './Types.ts';
import type { ApprovalStep, DiscussionThread, PlanningCommand, PlanningContext, PlanningNotice, PlanningOperation, VisitPlan } from './Types.ts';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(key => (value as Record<string, unknown>)[key] !== undefined).map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value);
}
const commandKeys: Record<PlanningCommand['kind'], readonly string[]> = {
  SUBMIT: ['kind'], CANCEL: ['kind', 'reason'], REVISE: ['kind', 'draft', 'reason'],
  DECIDE: ['kind', 'stepId', 'decision', 'reason', 'reference'], ARRANGE: ['kind', 'taskId', 'status', 'remark'],
  THREAD: ['kind', 'threadId', 'title', 'audience', 'subProjectId', 'targetId'],
  COMMENT: ['kind', 'threadId', 'messageId', 'body', 'replyToId', 'mentionIds'], THREAD_STATE: ['kind', 'threadId', 'resolved'],
};
const messageText = (value: unknown): value is string => typeof value === 'string' && value.isWellFormed() && value.trim().length > 0 && value.length <= 4000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value);
export function parsePlanningCommand(value: unknown): PlanningCommand {
  const data = record(value, ['kind', ...new Set(Object.values(commandKeys).flat())]);
  requireInput(typeof data.kind === 'string' && Object.hasOwn(commandKeys, data.kind));
  record(data, commandKeys[data.kind as PlanningCommand['kind']]);
  if (['CANCEL', 'REVISE'].includes(data.kind)) requireInput(boundedText(data.reason, 500));
  if (data.kind === 'REVISE') data.draft = parseDraft(data.draft);
  if (data.kind === 'DECIDE') requireInput(uuid(data.stepId) && ['APPROVED', 'REJECTED'].includes(data.decision as string) && boundedText(data.reason, 500) && (data.reference === undefined || boundedText(data.reference, 300)));
  if (data.kind === 'ARRANGE') requireInput(uuid(data.taskId) && ['IN_PROGRESS', 'CONFIRMED', 'UNAVAILABLE'].includes(data.status as string) && boundedText(data.remark, 1000));
  if (data.kind === 'THREAD') requireInput(uuid(data.threadId) && boundedText(data.title, 120) && ['GENERAL', 'APPROVAL', 'OPERATIONS'].includes(data.audience as string) && (data.subProjectId === null || uuid(data.subProjectId)) && (data.targetId === null || uuid(data.targetId)));
  if (data.kind === 'COMMENT') requireInput(uuid(data.threadId) && uuid(data.messageId) && messageText(data.body) && (data.replyToId === null || uuid(data.replyToId)) && Array.isArray(data.mentionIds) && data.mentionIds.length <= 10 && data.mentionIds.every(uuid) && distinct(data.mentionIds));
  if (data.kind === 'THREAD_STATE') requireInput(uuid(data.threadId) && typeof data.resolved === 'boolean');
  return structuredClone(data) as PlanningCommand;
}
function stepStatus(step: ApprovalStep, plan: VisitPlan, context: PlanningContext): 'PENDING' | 'APPROVED' | 'REJECTED' {
  const valid = step.decisions.filter(decision => liveApprover(plan.current, step, decision.userId, context));
  if (valid.some(decision => decision.decision === 'REJECTED')) return 'REJECTED';
  if (step.mode === 'ANY' ? valid.some(decision => decision.decision === 'APPROVED') : step.approverIds.every(id => valid.some(decision => decision.userId === id && decision.decision === 'APPROVED'))) return 'APPROVED';
  return 'PENDING';
}
/** Approval/arrangement readiness only. This never creates an entry credential,
 * registration, photo, movement grant or authorization for legacy account passes. */
export function projectReadiness(plan: VisitPlan, subProjectId: string | null, context: PlanningContext): 'DRAFT' | 'CANCELLED' | 'EXPIRED' | 'POLICY_CHANGED' | 'BLOCKED' | 'PENDING' | 'REJECTED' | 'READY' {
  requireInput(timestamp(context.nowUtc));
  if (subProjectId !== null && !plan.current.draft.subProjectIds.includes(subProjectId) || subProjectId === null && plan.current.projects.length > 0) throw new PlanningError('NOT_AUTHORIZED');
  if (plan.state !== 'SUBMITTED') return plan.state;
  if (context.nowUtc >= plan.current.draft.untilUtc) return 'EXPIRED';
  if (!currentPolicyMatches(plan.current, context)) return 'POLICY_CHANGED';
  if (!hostEligible(plan.hostId, plan.current, context)) return 'BLOCKED';
  const required = plan.current.approvals.filter(step => step.subProjectId === null || step.subProjectId === subProjectId);
  const statuses = required.map(step => stepStatus(step, plan, context));
  if (statuses.includes('REJECTED')) return 'REJECTED';
  const tasks = plan.current.tasks.filter(task => task.mandatoryForEntry);
  if (tasks.some(task => task.status === 'UNAVAILABLE' || !task.ownerIds.some(id => liveTaskOwner(plan.current, task, id, context)))) return 'BLOCKED';
  return required.length > 0 && statuses.every(status => status === 'APPROVED') && tasks.every(task => task.status === 'CONFIRMED') ? 'READY' : 'PENDING';
}
export function canReadThread(plan: VisitPlan, thread: DiscussionThread, userId: string, context: PlanningContext) {
  try {
    const scope = accessScope(plan, userId, context);
    if (thread.subProjectId !== null && !scope.projectIds.includes(thread.subProjectId)) return false;
    if (thread.audience === 'GENERAL') return true;
    if (thread.audience === 'OPERATIONS') return scope.taskIds.includes(thread.targetId!);
    const step = plan.current.approvals.find(item => item.id === thread.targetId);
    return !!step && (projectManager(scope.person, plan.current, step.subProjectId) || liveApprover(plan.current, step, userId, context));
  } catch (error) { if (error instanceof PlanningError) return false; throw error; }
}
function participantIds(plan: VisitPlan, context: PlanningContext) {
  return [...new Set([plan.hostId, ...plan.current.approvals.flatMap(step => step.approverIds), ...plan.current.tasks.flatMap(task => task.ownerIds), ...plan.current.locationPolicy.receptionIds, ...plan.current.locationPolicy.securityIds])].filter(id => activeInternal(context, id));
}
function appendNotices(plan: VisitPlan, kind: PlanningNotice['kind'], recipients: string[], context: PlanningContext, targetId?: string) {
  const eventSequence = plan.events.length;
  for (const recipientId of new Set(recipients)) if (activeInternal(context, recipientId) && !plan.notices.some(notice => notice.eventSequence === eventSequence && notice.recipientId === recipientId && notice.kind === kind && notice.targetId === targetId)) plan.notices.push({ eventSequence, recipientId, kind, ...(targetId ? { targetId } : {}) });
}
function authorize(plan: VisitPlan, input: PlanningCommand, userId: string, context: PlanningContext) {
  const scope = accessScope(plan, userId, context);
  if (input.kind === 'SUBMIT' || input.kind === 'REVISE' || input.kind === 'CANCEL') {
    if (!scope.owner) throw new PlanningError('NOT_AUTHORIZED');
    if (input.kind !== 'CANCEL' && !hostEligible(userId, plan.current, context)) throw new PlanningError('NOT_AUTHORIZED');
  } else if (input.kind === 'DECIDE') {
    const step = plan.current.approvals.find(item => item.id === input.stepId);
    if (userId === plan.hostId || !step || !liveApprover(plan.current, step, userId, context)) throw new PlanningError('NOT_AUTHORIZED');
  } else if (input.kind === 'ARRANGE') {
    const task = plan.current.tasks.find(item => item.id === input.taskId);
    // Hosts may request arrangements, but cannot mark someone else's booking
    // confirmed. Administrative scope alone is not task ownership either.
    if (!task || !liveTaskOwner(plan.current, task, userId, context)) throw new PlanningError('NOT_AUTHORIZED');
  } else if (input.kind === 'THREAD') {
    const thread = { ...input, id: input.threadId, createdBy: userId, resolved: false, messages: [] };
    if (!canReadThread(plan, thread, userId, context)) throw new PlanningError('NOT_AUTHORIZED');
  } else {
    const thread = plan.current.threads.find(item => item.id === input.threadId);
    if (!thread || !canReadThread(plan, thread, userId, context)) throw new PlanningError('NOT_AUTHORIZED');
    if (input.kind === 'THREAD_STATE' && thread.createdBy !== userId && !scope.owner && !scope.manager) throw new PlanningError('NOT_AUTHORIZED');
  }
}
export function createVisitPlan(id: string, draft: unknown, hostId: string, context: PlanningContext): VisitPlan {
  requireInput(uuid(id));
  const current = buildVersion(draft, hostId, context);
  return { id, hostId, revision: 1, state: 'DRAFT', current, history: [], events: [{ sequence: 1, kind: 'CREATED', actorId: hostId, version: 1, atUtc: context.nowUtc }], notices: [], operations: [] };
}
/** Pure aggregate transition. Persistence must lock/CAS the plan and atomically
 * store the resulting version, event, operation receipt and notice intents. */
export function changeVisitPlan(original: VisitPlan, raw: unknown, userId: string, operation: PlanningOperation, context: PlanningContext): VisitPlan {
  actor(context, userId); requireInput(timestamp(context.nowUtc));
  const input = parsePlanningCommand(raw);
  const op = record(operation, ['clientKey', 'expectedRevision']);
  requireInput(uuid(op.clientKey) && Number.isSafeInteger(op.expectedRevision) && Number(op.expectedRevision) > 0 && Number(op.expectedRevision) < 2147483647);
  authorize(original, input, userId, context); // Also applies to idempotent retries.
  const hash = createHash('sha256').update(canonical({ input, expectedRevision: op.expectedRevision })).digest('hex');
  const previous = original.operations.find(item => item.actorId === userId && item.clientKey === op.clientKey);
  if (previous) {
    if (previous.hash !== hash) throw new PlanningError('CONFLICT');
    return structuredClone(original);
  }
  if (original.revision !== op.expectedRevision || original.state === 'CANCELLED' || original.operations.length >= 2000 || original.events.length >= 2000) throw new PlanningError('CONFLICT');
  const plan = structuredClone(original), version = plan.current;
  if (!['SUBMIT', 'REVISE', 'CANCEL'].includes(input.kind) && (plan.state !== 'SUBMITTED' || context.nowUtc >= version.draft.untilUtc)) throw new PlanningError('CONFLICT');
  if (['SUBMIT', 'DECIDE', 'ARRANGE'].includes(input.kind) && (!currentPolicyMatches(version, context) || !hostEligible(plan.hostId, version, context))) throw new PlanningError('CONFLICT');
  let targetId: string | undefined;
  if (input.kind === 'SUBMIT') {
    if (plan.state !== 'DRAFT' || context.nowUtc > version.draft.startsAtUtc) throw new PlanningError('CONFLICT');
    plan.state = 'SUBMITTED';
  } else if (input.kind === 'REVISE') {
    if (plan.history.length >= 20) throw new PlanningError('CONFLICT');
    plan.current = buildVersion(input.draft, plan.hostId, context, version.number + 1);
    plan.history.push(version); plan.state = 'DRAFT';
  } else if (input.kind === 'CANCEL') plan.state = 'CANCELLED';
  else if (input.kind === 'DECIDE') {
    const step = version.approvals.find(item => item.id === input.stepId)!;
    if (step.decisions.some(item => item.userId === userId) || stepStatus(step, plan, context) !== 'PENDING') throw new PlanningError('CONFLICT');
    requireInput(input.decision !== 'APPROVED' || step.kind !== 'CLIENT_CONFIRMATION' || boundedText(input.reference, 300));
    step.decisions.push({ userId, decision: input.decision, reason: input.reason, ...(input.reference ? { reference: input.reference } : {}), atUtc: context.nowUtc });
    targetId = step.id;
  } else if (input.kind === 'ARRANGE') {
    const task = version.tasks.find(item => item.id === input.taskId)!;
    if (task.status === input.status) throw new PlanningError('CONFLICT');
    task.status = input.status; task.remark = input.remark; targetId = task.id;
  } else if (input.kind === 'THREAD') {
    requireInput(input.audience === 'GENERAL' ? input.targetId === null : input.audience === 'APPROVAL' ? version.approvals.some(step => step.id === input.targetId && step.subProjectId === input.subProjectId) : input.subProjectId === null && version.tasks.some(task => task.id === input.targetId));
    requireInput(input.subProjectId === null || version.draft.subProjectIds.includes(input.subProjectId));
    if (version.threads.length >= 100 || [...plan.history, version].some(item => item.threads.some(thread => thread.id === input.threadId))) throw new PlanningError('CONFLICT');
    version.threads.push({ id: input.threadId, title: input.title, audience: input.audience, subProjectId: input.subProjectId, targetId: input.targetId, createdBy: userId, resolved: false, messages: [] });
    targetId = input.threadId;
  } else {
    const thread = version.threads.find(item => item.id === input.threadId)!;
    if (input.kind === 'THREAD_STATE') {
      if (thread.resolved === input.resolved) throw new PlanningError('CONFLICT');
      thread.resolved = input.resolved;
    } else {
      if (thread.resolved || version.threads.reduce((count, item) => count + item.messages.length, 0) >= 500 || [...plan.history, version].some(item => item.threads.some(candidate => candidate.messages.some(message => message.id === input.messageId)))) throw new PlanningError('CONFLICT');
      requireInput(input.replyToId === null || thread.messages.some(message => message.id === input.replyToId));
      requireInput(input.mentionIds.every(id => canReadThread(plan, thread, id, context)));
      thread.messages.push({ id: input.messageId, authorId: userId, body: input.body, replyToId: input.replyToId, mentionIds: input.mentionIds, atUtc: context.nowUtc });
    }
    targetId = thread.id;
  }
  plan.revision++;
  plan.operations.push({ actorId: userId, clientKey: op.clientKey, hash });
  plan.events.push({ sequence: plan.events.length + 1, kind: input.kind, actorId: userId, version: plan.current.number, atUtc: context.nowUtc, ...(targetId ? { targetId } : {}), ...('reason' in input ? { reason: input.reason } : {}), ...(input.kind === 'ARRANGE' ? { remark: input.remark, status: input.status } : {}), ...(input.kind === 'THREAD_STATE' ? { resolved: input.resolved } : {}) });
  if (input.kind === 'SUBMIT') {
    for (const step of version.approvals) appendNotices(plan, 'APPROVAL', step.approverIds.filter(id => id !== plan.hostId), context, step.id);
    for (const task of version.tasks) appendNotices(plan, 'ARRANGEMENT', task.ownerIds, context, task.id);
    appendNotices(plan, 'FYI', [...version.locationPolicy.notifyIds, ...(version.draft.vip ? version.locationPolicy.vipNotifyIds : [])], context);
  } else if (input.kind === 'COMMENT') appendNotices(plan, 'DISCUSSION', input.mentionIds.filter(id => id !== userId), context, input.threadId);
  else if (input.kind === 'CANCEL' || input.kind === 'REVISE') {
    const publishedNumber = original.events.findLast(event => event.kind === 'SUBMIT')?.version;
    const published = [...original.history, original.current].find(item => item.number === publishedNumber);
    if (published) {
      const informed = original.notices.filter(notice => notice.kind === 'FYI').map(notice => notice.recipientId);
      appendNotices(plan, input.kind === 'CANCEL' ? 'CANCELLED' : 'UPDATE', [...participantIds({ ...original, current: published }, context), ...informed], context);
    }
  } else if (input.kind === 'DECIDE' || input.kind === 'ARRANGE') appendNotices(plan, 'UPDATE', [plan.hostId], context, targetId);
  return plan;
}
/** Explicit projection: no history, idempotency hashes, FYI recipient lists or
 * unrelated projects/private threads leave the aggregate through this view. */
export function readVisitPlan(plan: VisitPlan, userId: string, context: PlanningContext) {
  const scope = accessScope(plan, userId, context), version = plan.current;
  return {
    id: plan.id, revision: plan.revision, state: plan.state, version: version.number,
    visitorName: version.draft.visitorName, locationId: version.draft.locationId, startsAtUtc: version.draft.startsAtUtc, untilUtc: version.draft.untilUtc, vip: version.draft.vip,
    ...(scope.owner || scope.manager || scope.officeParticipant || scope.projectIds.length > 0 ? { purpose: version.draft.purpose } : {}),
    ...(scope.owner || scope.manager || scope.officeParticipant ? { visitorEmail: version.draft.visitorEmail } : {}),
    projects: version.projects.filter(project => scope.projectIds.includes(project.subProjectId)).map(project => ({ subProjectId: project.subProjectId, name: project.name, readiness: projectReadiness(plan, project.subProjectId, context) })),
    ...(version.projects.length === 0 ? { locationReadiness: projectReadiness(plan, null, context) } : {}),
    approvals: version.approvals.filter(step => scope.owner || scope.manager || step.subProjectId === null && scope.officeParticipant || step.subProjectId !== null && scope.projectIds.includes(step.subProjectId)).map(step => ({ id: step.id, name: step.name, subProjectId: step.subProjectId, mode: step.mode, status: stepStatus(step, plan, context), ...(liveApprover(version, step, userId, context) || projectManager(scope.person, version, step.subProjectId) ? { decisions: structuredClone(step.decisions) } : {}) })),
    tasks: version.tasks.filter(task => scope.taskIds.includes(task.id)).map(task => structuredClone(task)),
    ...(version.draft.stay && scope.taskIds.some(id => version.tasks.some(task => task.id === id && task.kind === 'STAY')) ? { stay: structuredClone(version.draft.stay) } : {}),
    threads: version.threads.filter(thread => canReadThread(plan, thread, userId, context)).map(thread => structuredClone(thread)),
    // Detailed audit projection will be supplied by the scoped persistence layer.
    activity: plan.events.filter(event => scope.owner || scope.manager || event.kind === 'SUBMIT' || event.kind === 'CANCEL').map(event => ({ sequence: event.sequence, kind: event.kind, atUtc: event.atUtc, version: event.version })),
  };
}
