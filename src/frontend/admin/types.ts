export type Office = {
  locationId: number;
  locationName: string;
  locationCode: string;
  canCreateProject?: boolean;
  canManageCommonAreas?: boolean;
};
export type Role = {
  roleCode: string;
  scopeType: string;
  locationId?: number;
  projectId?: string;
  projectLocationId?: string;
};
export type Scope = {
  userId: string;
  currentDate: string;
  canReport: boolean;
  canReadVisits: boolean;
  canExport?: boolean;
  canAudit: boolean;
  canManageRoles: boolean;
  canAssignGuards: boolean;
  canManageProjectGroups?: boolean;
  canResetLocalStaff?: boolean;
  roles: Role[];
  delegations: Role[];
  provisionableRoles?: Role[];
};
export type Project = {
  projectLocationId: string;
  projectId: string;
  projectName: string;
  projectCode: string;
  directoryCurrent: boolean;
  canAssignProject: boolean;
  canAssignLocation: boolean;
  canManageHosts?: boolean;
  leadRevision?: number;
  previewStale?: boolean;
  preview?: { names: string[]; more: boolean; failed?: boolean } | null;
};
export type User = {
  userId: string;
  displayName: string;
  active?: boolean;
  employeeId?: string;
  email?: string;
  localAccount?: boolean;
};
export type Lead = {
  roleGrantId: string;
  displayName: string;
  employeeId?: string;
  email?: string;
  scopeType: string;
  canRemove?: boolean;
};
export type Host = {
  employeeId: string;
  displayName: string;
  email: string;
  revision: string;
  eligible?: boolean;
  changedBy?: string;
  changedAtUtc?: string;
};
export type Area = { areaId: string; name: string };
export type CommonDuty = {
  assignmentId: string;
  areaId: string;
  areaName: string;
  guardName: string;
  guardUserId: string;
};
export type Guard = User & {
  overlappingAssignment?: boolean;
  canAllocate?: boolean;
};
export type Duty = {
  assignmentId: string;
  userId: string;
  guardName: string;
  projectLocationId: string;
  projectName: string;
  validFromUtc: string;
  validUntilUtc?: string;
  groupAssignmentId?: string;
  groupId?: string;
  groupName?: string;
};
export type Group = {
  groupId: string;
  name: string;
  revision: string;
  projects: Project[];
  assignments: (Duty & { groupAssignmentId: string })[];
  canManage?: boolean;
};
export type Grant = Role & {
  roleGrantId: string;
  userId: string;
  validFromUtc: string;
  validUntilUtc?: string;
  revoked: boolean;
  capabilities: string[];
};
export type Cursor = string | null;
export type Failure = Error & { status?: number };
export type Totals = {
  total: number | string;
  pending: number | string;
  approved: number | string;
  denied: number | string;
  cancelled: number | string;
};
export type Summary = {
  days: { localVisitDate: string; visits: Totals }[];
  visits: Totals;
  recordedPresence: {
    projectVisitsInside: number | string;
    digitalIdsInside: number | string;
  };
};
export type View =
  | "overview"
  | "projects"
  | "staff"
  | "assignments"
  | "offices"
  | "reports"
  | "audit";
export const titles: Record<View, string> = {
  overview: "Overview",
  projects: "Accounts & areas",
  staff: "Users & permissions",
  assignments: "Guard assignments",
  offices: "Offices & QR",
  reports: "Visit register",
  audit: "Audit log",
};
export const roleCaps: Record<string, string[]> = {
  GUARD: [
    "VISITS_READ",
    "PROJECT_MOVEMENT",
    "TEMP_ID_MOVEMENT",
    "RECONCILE_EXIT",
  ],
  RECEPTION: ["VISITS_READ", "PASS_PRINT", "PASS_REISSUE"],
  PROJECT_ADMIN: [
    "VISITS_READ",
    "GUARDS_MANAGE",
    "REPORTS_READ",
    "REPORTS_EXPORT",
    "AUDIT_READ",
    "ROLE_GRANTS_MANAGE",
  ],
  LOCATION_ADMIN: [
    "VISITS_READ",
    "GUARDS_MANAGE",
    "REPORTS_READ",
    "REPORTS_EXPORT",
    "AUDIT_READ",
    "GUARD_CREDENTIALS_MANAGE",
    "STAFF_CREDENTIALS_MANAGE",
    "ROLE_GRANTS_MANAGE",
  ],
};
roleCaps.INDIA_ADMIN = roleCaps.PLATFORM_ADMIN = roleCaps.LOCATION_ADMIN;
export const human = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\bproject\b/gu, "account")
    .replace(/^./u, (c) => c.toUpperCase());
export const initials = (value: string) =>
  value
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((v) => [...v][0])
    .join("")
    .toUpperCase() || "?";
export const dateTime = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value)) + " IST"
    : "No end date";
export const shiftDay = (day: string, count: number) =>
  new Date(Date.parse(day + "T12:00:00Z") + count * 86400000)
    .toISOString()
    .slice(0, 10);
export const indiaStart = (day: string) =>
  new Date(day + "T00:00:00+05:30").toISOString();
