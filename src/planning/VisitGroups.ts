import { PlanningError } from "./Types.ts";
import type {
  VisitGroupReference,
  VisitGroupMember,
} from "../shared/VisitGroups.ts";
const id = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(v);
const revision = (v: unknown) =>
  Number.isSafeInteger(v) && Number(v) > 0 && Number(v) < 2147483647;
const text = (v: unknown, n: number) =>
  typeof v === "string" &&
  v.isWellFormed() &&
  v.trim().length > 0 &&
  v.length <= n &&
  !/[\x00-\x1f\x7f]/u.test(v);
function check(v: unknown): asserts v {
  if (!v) throw new PlanningError("INVALID_INPUT");
}
function object(v: unknown, keys: string[]) {
  check(
    v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      Object.keys(v).every((k) => keys.includes(k)),
  );
  return v as Record<string, unknown>;
}
export function parseGroupReferences(value: unknown): VisitGroupReference[] {
  check(Array.isArray(value) && value.length <= 5);
  const rows = value.map((v) => {
    const r = object(v, ["id", "revision"]);
    check(id(r.id) && revision(r.revision));
    return { id: r.id, revision: Number(r.revision) };
  });
  check(new Set(rows.map((r) => r.id.toLowerCase())).size === rows.length);
  return rows;
}
export function parseGroupMembers(value: unknown): VisitGroupMember[] {
  check(Array.isArray(value) && value.length > 0 && value.length <= 20);
  const rows = value.map((v) => {
    const r = object(v, ["userId", "email", "name", "kind"]);
    check(["APPROVAL", "NOTIFY"].includes(String(r.kind)));
    if (r.userId !== undefined) {
      check(id(r.userId) && r.email === undefined && r.name === undefined);
    } else {
      check(
        r.kind === "NOTIFY" &&
          text(r.email, 320) &&
          /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(String(r.email)) &&
          (r.name === undefined || text(r.name, 200)),
      );
    }
    return structuredClone(r) as VisitGroupMember;
  });
  check(
    new Set(rows.map((r) => r.userId?.toLowerCase() ?? r.email!.toLowerCase()))
      .size === rows.length,
  );
  return rows;
}
