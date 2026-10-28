import type { Visit } from "../guard/types.ts";
export type ReceptionVisit = Visit & {
  employeeId?: string;
  printCount: number;
  returnedAtUtc?: string | null;
  hostEmail?: string;
  reason?: string;
  submittedAtUtc?: string;
  localVisitDate?: string;
};
export type ReceptionOffice = {
  locationId: number;
  locationCode: string;
  locationName: string;
  canPrint: boolean;
};
export type ReceptionContext = {
  displayName: string;
  currentDate: string;
  locations: ReceptionOffice[];
  queuePaging?: boolean;
  staffCode?: string;
  email?: string;
};
export type ReceptionCursor = Record<string, unknown>;
export const deviceLabels: Record<string, string> = {
  LAPTOP: "Laptop",
  TABLET: "Tablet / iPad",
  PEN_DRIVE: "Pen Drive",
  CAMERA: "Camera",
  OTHER: "Other",
};
export const effective = (row: ReceptionVisit) =>
  row.status === "CANCELLED"
    ? "CANCELLED"
    : !row.returnedAtUtc && row.passStatus === "REVOKED"
      ? "REVOKED"
      : Date.parse(row.validUntilUtc) <= Date.now()
        ? "EXPIRED"
        : row.status;
export const kind = (row: ReceptionVisit) =>
  row.requestType === "DIGITAL_ID"
    ? "Digital ID"
    : row.requestType === "EMPLOYEE_PROJECT"
      ? "Account access"
      : "Visitor";
export const dateTime = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
export const projectText = (row: ReceptionVisit) =>
  row.requestType !== "DIGITAL_ID"
    ? (row.projectName ?? "Account unavailable")
    : row.employeeProjects?.available
      ? row.employeeProjects.items.map((p) => p.name).join(" · ") +
          (row.employeeProjects.total > row.employeeProjects.items.length
            ? " · " +
              (row.employeeProjects.total - row.employeeProjects.items.length) +
              " more"
            : "") || "No assigned accounts"
      : "Assignments unavailable";
