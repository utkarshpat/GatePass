export type Office = {
  locationId: number;
  locationName: string;
  locationCode?: string;
};
export type Duty = {
  kind: "PROJECT" | "COMMON" | "ALL";
  dutyId: string;
  name: string;
};
export type Movement = {
  projectName?: string;
  accessEventId: string | number;
  eventType: "ENTRY" | "EXIT";
  occurredAtUtc: string;
  guardName?: string;
  entryMethod?: string;
};
export type Visit = {
  visitRequestId: string;
  accessPassId?: string;
  personName: string;
  companyName?: string;
  deviceTypes?: string[];
  publicPassNumber?: string;
  publicReference?: string;
  locationName?: string;
  projectName?: string;
  projectLocationId?: string;
  requestType: string;
  hostName?: string;
  status: string;
  passStatus: string;
  validFromUtc: string;
  validUntilUtc: string;
  isInside: boolean;
  canEnter?: boolean;
  canExit?: boolean;
  canReconcileExit?: boolean;
  verificationOnly?: boolean;
  commonAccessAllowed?: boolean;
  dutyId?: string;
  dutyKind?: string;
  photoAvailable?: boolean;
  photoVersion?: string;
  submittedAtUtc?: string;
  allocations?: Duty[];
  employeeProjects?: {
    available: boolean;
    total: number;
    items: { name: string }[];
  };
  movements?: Movement[];
  movementsHasMore?: boolean;
};
export type Cursor = { submittedAtUtc: string; visitRequestId: string };
export type Photo = {
  mimeType: string;
  imageBase64: string;
  photoVersion?: string;
};
