import { PlanningError } from './Types.ts';
import type { ApprovalRule, ApprovalStep, ArrangementTask, PlanVersion, PlanningContext, PlanningPerson, VisitPlan, VisitPlanDraft } from './Types.ts';

export const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value);
export const boundedText = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.isWellFormed() && value.trim().length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
export function requireInput(condition: unknown): asserts condition {
  if (!condition) throw new PlanningError('INVALID_INPUT');
}
export function requirePolicy(condition: unknown): asserts condition {
  if (!condition) throw new PlanningError('POLICY_UNAVAILABLE');
}
export function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  requireInput(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  requireInput(Object.keys(value).every(key => keys.includes(key)));
  return value as Record<string, unknown>;
}
export const distinct = (items: readonly unknown[]) => new Set(items).size === items.length;
export const timestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) && timestamp(value + 'T00:00:00.000Z');
export function activeInternal(context: PlanningContext, userId: string) {
  const matches = context.people.filter(person => person.userId === userId);
  return matches.length === 1 && matches[0].active && matches[0].internal;
}
export function actor(context: PlanningContext, userId: string): PlanningPerson {
  if (!uuid(userId) || !activeInternal(context, userId)) throw new PlanningError('NOT_AUTHORIZED');
  return context.people.find(person => person.userId === userId)!;
}
export function parseDraft(value: unknown): VisitPlanDraft {
  const data = record(value, ['locationId', 'subProjectIds', 'visitorName', 'visitorEmail', 'company', 'purpose', 'startsAtUtc', 'untilUtc', 'vip', 'stay']);
  requireInput(Number.isSafeInteger(data.locationId) && Number(data.locationId) > 0 && Number(data.locationId) <= 2147483647);
  requireInput(Array.isArray(data.subProjectIds) && data.subProjectIds.length <= 10 && data.subProjectIds.every(uuid) && distinct(data.subProjectIds));
  requireInput(boundedText(data.visitorName, 200) && boundedText(data.purpose, 1000) && typeof data.vip === 'boolean');
  requireInput(data.company === undefined || boundedText(data.company, 200));
  requireInput(data.visitorEmail === undefined || boundedText(data.visitorEmail, 320) && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(data.visitorEmail));
  requireInput(timestamp(data.startsAtUtc) && timestamp(data.untilUtc) && data.startsAtUtc < data.untilUtc);
  if (data.stay !== undefined) {
    const stay = record(data.stay, ['checkInDate', 'checkOutDate', 'notes']);
    requireInput(date(stay.checkInDate) && date(stay.checkOutDate) && stay.checkInDate < stay.checkOutDate);
    requireInput(stay.notes === undefined || boundedText(stay.notes, 1000));
    // Require overlap with the visit in the office timezone. Hotel check-out is
    // exclusive, independently of inclusive dates displayed on visitor passes.
    requireInput(Date.parse(stay.checkInDate + 'T00:00:00+05:30') < Date.parse(data.untilUtc) && Date.parse(stay.checkOutDate + 'T00:00:00+05:30') > Date.parse(data.startsAtUtc));
    requireInput(Date.parse(stay.checkOutDate) - Date.parse(stay.checkInDate) <= 366 * 86400000);
  }
  return structuredClone(data) as VisitPlanDraft;
}
function validateRule(rule: ApprovalRule, hostId: string, context: PlanningContext) {
  requirePolicy(uuid(rule.id) && boundedText(rule.name, 120) && ['PROJECT', 'SECURITY', 'CLIENT_CONFIRMATION'].includes(rule.kind) && ['ALL', 'ANY'].includes(rule.mode));
  requirePolicy(rule.approverIds.length > 0 && rule.approverIds.length <= 20 && distinct(rule.approverIds) && rule.approverIds.every(id => uuid(id) && activeInternal(context, id)));
  // A host's creation already records host consent. Required independent
  // approvals must not become self-approval or an impossible ALL step.
  requirePolicy(rule.mode === 'ALL' ? !rule.approverIds.includes(hostId) : rule.approverIds.some(id => id !== hostId));
}
export function hostEligible(hostId: string, version: PlanVersion, context: PlanningContext): boolean {
  if (!activeInternal(context, hostId)) return false;
  const locations = context.locations.filter(policy => policy.locationId === version.draft.locationId && policy.active);
  if (locations.length !== 1) return false;
  // A current source-office host may sponsor a request; destination approval is separate.
  if (locations[0].locationHostIds.includes(hostId)) return true;
  return context.accountHosts.some(account =>
    account.locationId === version.draft.locationId && account.userIds.includes(hostId) &&
    context.accountHosts.filter(other => other.accountOfficeId === account.accountOfficeId).length === 1
  );
}
export function buildVersion(value: unknown, hostId: string, context: PlanningContext, number = 1): PlanVersion {
  actor(context, hostId);
  requirePolicy(timestamp(context.nowUtc));
  const draft = parseDraft(value);
  const locations = context.locations.filter(policy => policy.locationId === draft.locationId);
  requirePolicy(locations.length === 1 && locations[0].active);
  const policy = locations[0];
  requirePolicy(Number.isSafeInteger(policy.revision) && policy.revision > 0 && [policy.maximumAdvanceDays, policy.maximumVisitDays].every(days => Number.isSafeInteger(days) && days >= 1 && days <= 366));
  requireInput(Date.parse(draft.startsAtUtc) >= Date.parse(context.nowUtc) && Date.parse(draft.startsAtUtc) - Date.parse(context.nowUtc) <= policy.maximumAdvanceDays * 86400000 && Date.parse(draft.untilUtc) - Date.parse(draft.startsAtUtc) <= policy.maximumVisitDays * 86400000);
  const projects = draft.subProjectIds.map(id => {
    const matches = context.projects.filter(project => project.subProjectId === id);
    if (matches.length !== 1 || !matches[0].active || matches[0].locationId !== draft.locationId) throw new PlanningError('NOT_AUTHORIZED');
    const project = matches[0];
    requirePolicy(boundedText(project.name, 200) && /^[1-9][0-9]{0,18}$/u.test(project.accountOfficeId) && BigInt(project.accountOfficeId) <= 9223372036854775807n && Number.isSafeInteger(project.revision) && project.revision > 0 && project.approvalRules.length > 0);
    return structuredClone(project);
  });
  const rules = [...policy.approvalRules.map(rule => ({ ...structuredClone(rule), subProjectId: null })), ...projects.flatMap(project => project.approvalRules.map(rule => ({ ...structuredClone(rule), subProjectId: project.subProjectId })))];
  requirePolicy(rules.length > 0 && rules.length <= 50 && distinct(rules.map(rule => rule.id)));
  rules.forEach(rule => validateRule(rule, hostId, context));
  const tasks = policy.arrangements.filter(rule => rule.kind !== 'STAY' || !!draft.stay).map(rule => {
    requirePolicy(uuid(rule.id) && boundedText(rule.name, 120) && ['STAY', 'OTHER'].includes(rule.kind) && typeof rule.mandatoryForEntry === 'boolean' && rule.ownerIds.length > 0 && rule.ownerIds.length <= 20 && distinct(rule.ownerIds) && rule.ownerIds.every(id => uuid(id) && activeInternal(context, id)));
    return { ...structuredClone(rule), status: 'REQUESTED' as const, remark: '' };
  });
  requirePolicy(tasks.length <= 20 && distinct(tasks.map(task => task.id)) && (!draft.stay || tasks.some(task => task.kind === 'STAY')));
  for (const recipients of [policy.receptionIds, policy.securityIds, policy.notifyIds, ...(draft.vip ? [policy.vipNotifyIds] : [])]) requirePolicy(recipients.length <= 100 && distinct(recipients) && recipients.every(id => uuid(id) && activeInternal(context, id)));
  const version: PlanVersion = { number, draft, locationPolicy: structuredClone(policy), projects, approvals: rules.map(rule => ({ ...rule, decisions: [] })), tasks, threads: [] };
  if (!hostEligible(hostId, version, context)) throw new PlanningError('NOT_AUTHORIZED');
  return version;
}
export function fullManager(person: PlanningPerson, version: PlanVersion) {
  return person.manageLocationIds.includes(version.draft.locationId) || version.projects.length > 0 && version.projects.every(project => person.manageAccountOfficeIds.includes(project.accountOfficeId));
}
export function projectManager(person: PlanningPerson, version: PlanVersion, subProjectId: string | null) {
  return person.manageLocationIds.includes(version.draft.locationId) || subProjectId !== null && version.projects.some(project => project.subProjectId === subProjectId && person.manageAccountOfficeIds.includes(project.accountOfficeId));
}
export function currentPolicyMatches(version: PlanVersion, context: PlanningContext) {
  const policies = context.locations.filter(policy => policy.locationId === version.draft.locationId);
  return policies.length === 1 && policies[0].active && policies[0].revision === version.locationPolicy.revision && version.projects.every(snapshot => {
    const projects = context.projects.filter(project => project.subProjectId === snapshot.subProjectId);
    return projects.length === 1 && projects[0].active && projects[0].locationId === snapshot.locationId && projects[0].accountOfficeId === snapshot.accountOfficeId && projects[0].revision === snapshot.revision;
  });
}
export function liveApprover(version: PlanVersion, step: ApprovalStep, userId: string, context: PlanningContext) {
  const definitions = step.subProjectId === null
    ? context.locations.filter(policy => policy.locationId === version.draft.locationId && policy.active).flatMap(policy => policy.approvalRules)
    : context.projects.filter(project => project.subProjectId === step.subProjectId && project.locationId === version.draft.locationId && project.active).flatMap(project => project.approvalRules);
  const matches = definitions.filter(rule => rule.id === step.id);
  return activeInternal(context, userId) && step.approverIds.includes(userId) && matches.length === 1 && matches[0].approverIds.includes(userId);
}
export function liveTaskOwner(version: PlanVersion, task: ArrangementTask, userId: string, context: PlanningContext) {
  const definitions = context.locations.filter(policy => policy.locationId === version.draft.locationId && policy.active).flatMap(policy => policy.arrangements).filter(rule => rule.id === task.id);
  return activeInternal(context, userId) && task.ownerIds.includes(userId) && definitions.length === 1 && definitions[0].ownerIds.includes(userId);
}
export function accessScope(plan: VisitPlan, userId: string, context: PlanningContext) {
  const person = actor(context, userId), version = plan.current;
  const owner = plan.hostId === userId, manager = fullManager(person, version);
  const currentLocations = context.locations.filter(policy => policy.locationId === version.draft.locationId && policy.active);
  const officeParticipant = currentLocations.length === 1 && (version.locationPolicy.receptionIds.includes(userId) && currentLocations[0].receptionIds.includes(userId) || version.locationPolicy.securityIds.includes(userId) && currentLocations[0].securityIds.includes(userId)) || version.approvals.some(step => step.subProjectId === null && liveApprover(version, step, userId, context));
  const projectIds = version.projects.filter(project => owner || officeParticipant || projectManager(person, version, project.subProjectId) || version.approvals.some(step => step.subProjectId === project.subProjectId && liveApprover(version, step, userId, context))).map(project => project.subProjectId);
  const taskIds = version.tasks.filter(task => owner || manager || liveTaskOwner(version, task, userId, context)).map(task => task.id);
  const participating = officeParticipant || version.approvals.some(step => liveApprover(version, step, userId, context)) || version.tasks.some(task => liveTaskOwner(version, task, userId, context));
  if ((!owner && !manager && !participating && projectIds.length === 0) || plan.state === 'DRAFT' && !owner && !manager) throw new PlanningError('NOT_AUTHORIZED');
  return { person, owner, manager, officeParticipant, projectIds, taskIds };
}
