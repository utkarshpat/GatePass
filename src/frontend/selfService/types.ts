import type { CountryCode } from "libphonenumber-js";
export type Host = {
  employeeId: string;
  displayName: string;
  officialEmail: string;
};
export type Account = {
  projectLocationId: string;
  projectName: string;
  assigned?: boolean;
};
export type Employee = {
  employeeId: string;
  displayName: string;
  officialEmail: string;
  primaryOffice?: string;
  projects: Account[];
};
export type Options = {
  locationId: number;
  locationCode: string;
  locationName: string;
  currentDate: string;
  maxVisitDate: string;
  digitalIdEligible?: boolean;
  projects: Account[];
  hosts?: Host[];
};
export type Person = {
  key: string;
  name: string;
  phone: string;
  phoneRaw: string;
  country: CountryCode;
  email: string;
  companyName: string;
  deviceTypes: string[];
  file: File | null;
  rawFile?: File;
  url: string | null;
  croppedUrl?: string;
  flipped?: boolean;
  pan?: { x: number; y: number };
  zoom?: number;
};
export type Extra = {
  projectLocationId: string;
  projectName: string;
  host: Host;
  reason: string;
};
export type RequestBody = {
  requestType: "DIGITAL_ID" | "EXTERNAL" | "EMPLOYEE_PROJECT";
  clientKey: string;
  reason: string;
  digitalIdReason?: string;
  validUntilDate?: string;
  hostEmployeeId?: string;
  projectLocationId?: string;
};
export type Submitted = {
  visits: {
    visitRequestId: string;
    clientPersonKey: string;
    publicPassNumber: string;
    status: string;
    reused: boolean;
  }[];
};
export type CardImage = {
  mimeType: string;
  imageBase64: string;
  fileName: string;
};
export type Job = {
  body: RequestBody;
  people: Person[];
  started: boolean;
  photos: string[];
  result: Submitted | null;
  label: string;
  payload?: Record<string, unknown>;
  cardRequest?: Promise<CardImage> | null;
  cardUrl?: string;
  cardFileName?: string;
  cardError?: boolean;
  detail?: {
    status: string;
    passStatus: string;
    validUntilUtc: string;
    checkedAtUtc: string;
  };
};
