import { createHash } from "node:crypto";
import {
  visitorCategories,
  visitTypes,
  preparationServices,
  preparationDevices,
  specialAccessRequests,
} from "../shared/VisitPreparation.ts";
import type {
  VisitPreparation,
  AdditionalPlanningPerson,
} from "../shared/VisitPreparation.ts";
import { PlanningError } from "./Types.ts";

const check = (value: unknown) => {
  if (!value) throw new PlanningError("INVALID_INPUT");
};
const id = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(value);
const text = (v: unknown, max: number, multiline: boolean) =>
  typeof v === "string" &&
  v.isWellFormed() &&
  v.trim().length > 0 &&
  v.length <= max &&
  !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u : /[\u0000-\u001f\u007f-\u009f]/u).test(v);
function object(value: unknown, keys: string[]) {
  check(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(value)),
  );
  const d = value as Record<string, unknown>;
  check(Object.keys(d).every((key) => keys.includes(key)));
  return d;
}
function codes(value: unknown, allowed: object) {
  check(
    Array.isArray(value) &&
      value.length <= Object.keys(allowed).length &&
      value.every((v) => typeof v === "string" && Object.hasOwn(allowed, v)) &&
      new Set(value).size === value.length,
  );
}
export function parsePreparation(value: unknown): VisitPreparation {
  const d = object(value, [
    "category",
    "visitType",
    "meetingLocation",
    "agenda",
    "requirements",
    "services",
    "devices",
    "specialAccess",
    "coordinatorId",
    "visitOwnerId",
    "alternateReceiverId",
  ]);
  check(
    typeof d.category === "string" &&
      Object.hasOwn(visitorCategories, d.category) &&
      typeof d.visitType === "string" &&
      Object.hasOwn(visitTypes, d.visitType),
  );
  codes(d.services, preparationServices);
  codes(d.devices, preparationDevices);
  codes(d.specialAccess, specialAccessRequests);
  for (const [key, max] of [
    ["meetingLocation", 200],
    ["agenda", 2000],
    ["requirements", 1000],
  ] as const)
    check(d[key] === undefined || text(d[key], max, key !== 'meetingLocation'));
  for (const key of ["coordinatorId", "visitOwnerId", "alternateReceiverId"])
    check(d[key] === undefined || id(d[key]));
  check(!(d.services as unknown[]).length || id(d.coordinatorId));
  return structuredClone(d) as VisitPreparation;
}
export function parseAdditionalPeople(
  value: unknown,
  projects: readonly string[],
): AdditionalPlanningPerson[] {
  check(Array.isArray(value) && value.length <= 20);
  const rows = (value as unknown[]).map((item) => {
    const d = object(item, ["userId", "kind", "subProjectId"]);
    check(
      id(d.userId) &&
        ["APPROVAL", "NOTIFY"].includes(String(d.kind)) &&
        (d.subProjectId === undefined ||
          (id(d.subProjectId) && projects.includes(d.subProjectId))),
    );
    return d as AdditionalPlanningPerson;
  });
  check(
    new Set(
      rows.map(
        (p) =>
          p.userId.toLowerCase() + "|" + (p.subProjectId?.toLowerCase() ?? ""),
      ),
    ).size === rows.length,
  );
  return structuredClone(rows);
}
export function preparationRuleId(
  kind: string,
  user: string,
  scope: string = "",
) {
  const h = createHash("sha256")
    .update(
      "visit-preparation:" +
        kind +
        ":" +
        user.toLowerCase() +
        ":" +
        scope.toLowerCase(),
    )
    .digest("hex")
    .slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
