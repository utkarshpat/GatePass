export type VisitGroupMember = {
  kind: "APPROVAL" | "NOTIFY";
  userId?: string;
  email?: string;
  name?: string;
  available?: boolean;
};
export type VisitGroupReference = { id: string; revision: number };
export type VisitRoutingGroup = VisitGroupReference & {
  locationId: number;
  subProjectId?: string;
  name: string;
  description: string;
  vipOnly: boolean;
  active: boolean;
  canManage?: boolean;
  members: VisitGroupMember[];
};
