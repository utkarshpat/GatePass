import { uuid } from "./Policy.ts";
import { PlanningError } from "./Types.ts";
import type { PlanningAction } from "./PlanningRequest.ts";
const positive = (v: unknown): v is number =>
  Number.isSafeInteger(v) && Number(v) > 0 && Number(v) <= 2147483647;
function projectedObject(
  value: unknown,
  keys: string[],
): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}
function contacts(value: unknown, maximum: number) {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    value.every(
      (person) =>
        projectedObject(person, ["userId", "name", "email"]) &&
        uuid(person.userId) &&
        typeof person.name === "string" &&
        person.name.length <= 200 &&
        (person.email === undefined ||
          (typeof person.email === "string" && person.email.length <= 320)),
    )
  );
}
function routing(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length <= 11 &&
    value.every(
      (row) =>
        projectedObject(row, [
          "locationId",
          "subProjectId",
          "approvalSteps",
          "notify",
          "vipNotify",
          "arrangements",
        ]) &&
        positive(row.locationId) &&
        (row.subProjectId === undefined || uuid(row.subProjectId)) &&
        contacts(row.notify, 100) &&
        contacts(row.vipNotify, 100) &&
        Array.isArray(row.approvalSteps) &&
        row.approvalSteps.length <= 50 &&
        row.approvalSteps.every(
          (step) =>
            projectedObject(step, ["id", "name", "mode", "approvers"]) &&
            uuid(step.id) &&
            typeof step.name === "string" &&
            step.name.length <= 120 &&
            ["ALL", "ANY"].includes(String(step.mode)) &&
            contacts(step.approvers, 20),
        ) &&
        Array.isArray(row.arrangements) &&
        row.arrangements.length <= 20 &&
        row.arrangements.every(
          (task) =>
            projectedObject(task, ["name", "kind", "owners"]) &&
            typeof task.name === "string" &&
            task.name.length <= 120 &&
            ["STAY", "OTHER"].includes(String(task.kind)) &&
            contacts(task.owners, 20),
        ),
    )
  );
}
/** Normalizes identifier fields only, never visitor names, messages or remarks. */
function identifiers(value: unknown, key = "", depth = 0): unknown {
  if (depth > 16) throw new PlanningError("UNAVAILABLE");
  if (Array.isArray(value))
    return value.map((item) => identifiers(item, key, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, identifiers(v, k, depth + 1)]),
    );
  return typeof value === "string" &&
    /^(?:id|value|.*Ids?)$/u.test(key) &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(value)
    ? value.toLowerCase()
    : value;
}
/** Validate the explicit recipient projection before it can cross an application boundary. */
export function planningResponse(action: PlanningAction, response: string) {
  if (Buffer.byteLength(response) > 4 * 1024 * 1024)
    throw new PlanningError("UNAVAILABLE");
  const value = identifiers(JSON.parse(response));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PlanningError("UNAVAILABLE");
  const data = value as Record<string, unknown>;
  const allowed =
    action === "groups"
      ? ["groups"]
      : action === "people"
        ? ["people"]
        : action === "routing"
          ? ["routing"]
          : action === "options"
            ? [
                "actorId",
                "displayName",
                "locations",
                "accounts",
                "projects",
                "people",
                "policies",
                "hosts",
              ]
            : action === "list"
              ? ["visits", "hasMore"]
              : action === "thread"
                ? ["threadId", "messages", "readers", "hasMore", "nextBeforeId"]
                : action === "detail"
                  ? [
                      "id",
                      "revision",
                      "state",
                      "version",
                      "actorId",
                      "hostName",
                      "canEdit",
                      "canManage",
                      "visitorName",
                      "visitorEmail",
                      "company",
                      "locationId",
                      "locationName",
                      "vip",
                      "startsAtUtc",
                      "untilUtc",
                      "purpose",
                      "locationReadiness",
                      "projects",
                      "approvals",
                      "tasks",
                      "stayCheckInDate",
                      "stayCheckOutDate",
                      "stayNotes",
                      "threads",
                      "activity",
                      "draft",
                      "preparation",
                      "additionalPeople",
                      "selectedGroups",
                    ]
                  : ["id", "revision"];
  if (Object.keys(data).some((k) => !allowed.includes(k)))
    throw new PlanningError("UNAVAILABLE");
  if (
    action === "options" &&
    (!uuid(data.actorId) ||
      typeof data.displayName !== "string" ||
      ["locations", "accounts", "projects", "people", "policies", "hosts"].some(
        (k) => !Array.isArray(data[k]) || data[k].length > 2000,
      ))
  )
    throw new PlanningError("UNAVAILABLE");
  if (
    action === "list" &&
    (!Array.isArray(data.visits) ||
      data.visits.length > 50 ||
      typeof data.hasMore !== "boolean")
  )
    throw new PlanningError("UNAVAILABLE");
  if (
    action === "detail" &&
    (typeof data.visitorName !== "string" ||
      ["projects", "approvals", "tasks", "threads", "activity"].some(
        (k) => !Array.isArray(data[k]),
      ) ||
      typeof data.state !== "string" ||
      !["DRAFT", "SUBMITTED", "CANCELLED"].includes(data.state))
  )
    throw new PlanningError("UNAVAILABLE");
  if (
    !["options", "people", "groups", "routing", "list", "thread"].includes(
      action,
    ) &&
    (!uuid(data.id) || !positive(data.revision))
  )
    throw new PlanningError("UNAVAILABLE");
  if (
    action === "thread" &&
    (!uuid(data.threadId) ||
      !Array.isArray(data.messages) ||
      data.messages.length > 50 ||
      !Array.isArray(data.readers) ||
      data.readers.length > 100 ||
      typeof data.hasMore !== "boolean")
  )
    throw new PlanningError("UNAVAILABLE");
  if (action === "people" && !contacts(data.people, 20))
    throw new PlanningError("UNAVAILABLE");
  if (action === "routing" && !routing(data.routing))
    throw new PlanningError("UNAVAILABLE");
  if (
    action === "groups" &&
    (!Array.isArray(data.groups) ||
      data.groups.length > 200 ||
      data.groups.some(
        (g) =>
          !projectedObject(g, [
            "id",
            "locationId",
            "subProjectId",
            "name",
            "description",
            "vipOnly",
            "active",
            "revision",
            "canManage",
            "members",
          ]) ||
          !uuid(g.id) ||
          !positive(g.locationId) ||
          !positive(g.revision) ||
          (g.subProjectId!==undefined&&!uuid(g.subProjectId)) ||
          typeof g.name !== "string" ||
          g.name.length > 120 ||
          typeof g.description!=="string" || g.description.length>500 ||
          typeof g.vipOnly!=="boolean" || typeof g.active!=="boolean" || typeof g.canManage!=="boolean" ||
          !Array.isArray(g.members) ||
          g.members.length > 20 || g.members.some(member=>!projectedObject(member,['userId','name','email','kind','available'])||!['APPROVAL','NOTIFY'].includes(String(member.kind))||typeof member.name!=='string'||member.name.length>200||typeof member.email!=='string'||member.email.length>320||typeof member.available!=='boolean'||(member.userId!==undefined?!uuid(member.userId):member.kind!=='NOTIFY')),
      ))
  )
    throw new PlanningError("UNAVAILABLE");
  return data;
}
