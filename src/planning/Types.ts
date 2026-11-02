/** Trusted directory/policy input. An HTTP caller must never supply this context. */
export type PlanningPerson = {
  userId: string;
  active: boolean;
  internal: boolean;
  manageLocationIds: number[];
  manageAccountOfficeIds: string[];
};
export type ApprovalRule = {
  id: string;
  name: string;
  kind: 'PROJECT' | 'SECURITY' | 'CLIENT_CONFIRMATION';
  mode: 'ALL' | 'ANY';
  approverIds: string[];
};
export type ArrangementRule = {
  id: string;
  name: string;
  kind: 'STAY' | 'OTHER';
  mandatoryForEntry: boolean;
  ownerIds: string[];
};
export type LocationPlanningPolicy = {
  locationId: number;
  revision: number;
  active: boolean;
  locationHostIds: string[];
  approvalRules: ApprovalRule[];
  arrangements: ArrangementRule[];
  receptionIds: string[];
  securityIds: string[];
  notifyIds: string[];
  vipNotifyIds: string[];
  maximumAdvanceDays: number;
  maximumVisitDays: number;
};
export type PlanningProject = {
  subProjectId: string;
  accountOfficeId: string;
  locationId: number;
  name: string;
  revision: number;
  active: boolean;
  hostIds: string[];
  approvalRules: ApprovalRule[];
};
export type PlanningContext = {
  nowUtc: string;
  people: PlanningPerson[];
  locations: LocationPlanningPolicy[];
  projects: PlanningProject[];
  /** Existing explicit AccountHosts plus current office/account eligibility. */
  accountHosts: { accountOfficeId: string; locationId: number; userIds: string[] }[];
};
export type VisitPlanDraft = {
  locationId: number;
  subProjectIds: string[];
  visitorName: string;
  visitorEmail?: string;
  company?: string;
  purpose: string;
  startsAtUtc: string;
  untilUtc: string;
  vip: boolean;
  /** Hotel check-out date is exclusive; these are office calendar dates. */
  stay?: { checkInDate: string; checkOutDate: string; notes?: string };
};
export type ApprovalStep = ApprovalRule & {
  subProjectId: string | null;
  decisions: { userId: string; decision: 'APPROVED' | 'REJECTED'; reason: string; reference?: string; atUtc: string }[];
};
export type ArrangementTask = ArrangementRule & {
  status: 'REQUESTED' | 'IN_PROGRESS' | 'CONFIRMED' | 'UNAVAILABLE';
  remark: string;
};
export type DiscussionThread = {
  id: string;
  title: string;
  audience: 'GENERAL' | 'APPROVAL' | 'OPERATIONS';
  subProjectId: string | null;
  targetId: string | null;
  createdBy: string;
  resolved: boolean;
  messages: { id: string; authorId: string; body: string; replyToId: string | null; mentionIds: string[]; atUtc: string }[];
};
export type PlanVersion = {
  number: number;
  draft: VisitPlanDraft;
  locationPolicy: LocationPlanningPolicy;
  projects: PlanningProject[];
  approvals: ApprovalStep[];
  tasks: ArrangementTask[];
  threads: DiscussionThread[];
};
export type PlanEvent = { sequence: number; kind: string; actorId: string; version: number; atUtc: string; targetId?: string; reason?: string; remark?: string; status?: ArrangementTask['status']; resolved?: boolean };
export type PlanningNotice = {
  eventSequence: number;
  recipientId: string;
  kind: 'APPROVAL' | 'ARRANGEMENT' | 'FYI' | 'DISCUSSION' | 'UPDATE' | 'CANCELLED';
  targetId?: string;
};
export type VisitPlan = {
  id: string;
  hostId: string;
  revision: number;
  state: 'DRAFT' | 'SUBMITTED' | 'CANCELLED';
  current: PlanVersion;
  history: PlanVersion[];
  events: PlanEvent[];
  notices: PlanningNotice[];
  operations: { actorId: string; clientKey: string; hash: string }[];
};
export type PlanningCommand =
  | { kind: 'SUBMIT' }
  | { kind: 'CANCEL'; reason: string }
  | { kind: 'REVISE'; draft: VisitPlanDraft; reason: string }
  | { kind: 'DECIDE'; stepId: string; decision: 'APPROVED' | 'REJECTED'; reason: string; reference?: string }
  | { kind: 'ARRANGE'; taskId: string; status: ArrangementTask['status']; remark: string }
  | { kind: 'THREAD'; threadId: string; title: string; audience: DiscussionThread['audience']; subProjectId: string | null; targetId: string | null }
  | { kind: 'COMMENT'; threadId: string; messageId: string; body: string; replyToId: string | null; mentionIds: string[] }
  | { kind: 'THREAD_STATE'; threadId: string; resolved: boolean };
export type PlanningOperation = { clientKey: string; expectedRevision: number };

export class PlanningError extends Error {
  readonly code: 'INVALID_INPUT' | 'NOT_AUTHORIZED' | 'CONFLICT' | 'POLICY_UNAVAILABLE' | 'UNAVAILABLE';
  constructor(code: PlanningError['code']) {
    super(code);
    this.code = code;
  }
}
