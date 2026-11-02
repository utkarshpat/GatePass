export type Contact = { userId: string; name: string; email?: string };
export type Rule = {
  id: string;
  name: string;
  kind: "PROJECT" | "SECURITY" | "CLIENT_CONFIRMATION";
  mode: "ALL" | "ANY";
  approverIds: string[];
};
export type TaskRule = {
  id: string;
  name: string;
  kind: "STAY" | "OTHER";
  mandatoryForEntry: boolean;
  ownerIds: string[];
};
export type Definition = {
  approvalRules: Rule[];
  arrangements?: TaskRule[];
  receptionIds?: string[];
  securityIds?: string[];
  notifyIds?: string[];
  vipNotifyIds?: string[];
  maximumAdvanceDays?: number;
  maximumVisitDays?: number;
};
export type Options = {
  actorId: string;
  displayName: string;
  locations: {
    locationId: number;
    name: string;
    canManage: boolean;
    canHostLocation: boolean;
  }[];
  accounts: {
    accountOfficeId: string;
    locationId: number;
    name: string;
    canManage: boolean;
  }[];
  projects: {
    subProjectId: string;
    accountOfficeId: string;
    locationId: number;
    name: string;
    revision: number;
    active: boolean;
    canManage: boolean;
    /** May request this destination; grants no entry or management permission. */
    canHost: boolean;
  }[];
  people: Contact[];
  policies: {
    id: string;
    locationId: number;
    scopeKind: string;
    subProjectId?: string;
    revision: number;
    definition: Definition;
  }[];
  hosts: {
    locationId: number;
    subProjectId?: string;
    userId: string;
    name: string;
    email: string;
    revision: number;
    active: boolean;
  }[];
};
export type VisitRow = {
  id: string;
  revision: number;
  state: string;
  visitorName: string;
  locationName: string;
  locationId: number;
  vip: boolean;
  hostName: string;
  startsAtUtc: string;
  untilUtc: string;
};
export type Thread = {
  id: string;
  title: string;
  audience: "GENERAL" | "APPROVAL" | "OPERATIONS";
  subProjectId?: string;
  targetId?: string;
  resolved: boolean;
  canResolve: boolean;
  readers: Contact[];
  messages: {
    id: string;
    replyToId?: string;
    authorId: string;
    authorName: string;
    body: string;
    atUtc: string;
    mentions: Contact[];
  }[];
};
export type Detail = VisitRow & {
  version: number;
  actorId: string;
  canEdit: boolean;
  canManage: boolean;
  visitorEmail?: string;
  company?: string;
  purpose?: string;
  locationReadiness?: string;
  projects: { subProjectId: string; name: string; readiness: string }[];
  approvals: {
    id: string;
    name: string;
    kind: string;
    mode: string;
    subProjectId?: string;
    status: string;
    canDecide: boolean;
    canDiscuss: boolean;
    decisions: {
      name: string;
      decision: string;
      reason: string;
      reference?: string;
      atUtc: string;
    }[];
  }[];
  tasks: {
    id: string;
    name: string;
    kind: string;
    mandatoryForEntry: boolean;
    status: string;
    remark: string;
    canUpdate: boolean;
    owners: Contact[];
  }[];
  stayCheckInDate?: string;
  stayCheckOutDate?: string;
  stayNotes?: string;
  threads: Thread[];
  activity: {
    sequence: number;
    version: number;
    kind: string;
    atUtc: string;
    reason?: string;
  }[];
  draft?: {
    locationId: number;
    subProjects: { value: string }[];
    visitorName: string;
    visitorEmail?: string;
    company?: string;
    purpose: string;
    startsAtUtc: string;
    untilUtc: string;
    vip: boolean;
    checkInDate?: string;
    checkOutDate?: string;
    stayNotes?: string;
  };
};
export const displayTime = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
export const officeInput = (value: string) =>
  new Date(value)
    .toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" })
    .replace(" ", "T")
    .slice(0, 16);
export const utcFromOffice = (value: string) =>
  new Date(value + ":00+05:30").toISOString();

export function projectLabel(
  options: Pick<Options, "accounts">,
  project: Pick<Options["projects"][number], "accountOfficeId" | "name">,
) {
  const account = options.accounts.find(
    (a) => a.accountOfficeId === project.accountOfficeId,
  );
  return account ? account.name + " / " + project.name : project.name;
}
