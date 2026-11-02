import type { SqlParameter } from "../contracts/Sql.ts";
import {
  boundedText,
  distinct,
  parseDraft,
  record,
  requireInput,
  uuid,
  timestamp,
} from "./Policy.ts";
import { parsePlanningCommand } from "./Workflow.ts";
export type PlanningAction =
  "options" | "list" | "thread" | "detail" | "create" | "change" | "manage";
const positive = (v: unknown): v is number =>
  Number.isSafeInteger(v) && Number(v) > 0 && Number(v) <= 2147483647;
const big = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[1-9][0-9]{0,18}$/u.test(v) &&
  BigInt(v) <= 9223372036854775807n;
function ids(value: unknown, minimum: number, maximum: number) {
  requireInput(
    Array.isArray(value) &&
      value.length >= minimum &&
      value.length <= maximum &&
      value.every(uuid) &&
      distinct(value),
  );
}
export function validatePlanningDefinition(raw: unknown, location: boolean) {
  const d = record(
    raw,
    location
      ? [
          "approvalRules",
          "arrangements",
          "receptionIds",
          "securityIds",
          "notifyIds",
          "vipNotifyIds",
          "maximumAdvanceDays",
          "maximumVisitDays",
        ]
      : ["approvalRules"],
  );
  requireInput(
    Array.isArray(d.approvalRules) &&
      d.approvalRules.length >= 1 &&
      d.approvalRules.length <= 50,
  );
  for (const rawRule of d.approvalRules) {
    const r = record(rawRule, ["id", "name", "kind", "mode", "approverIds"]);
    requireInput(
      uuid(r.id) &&
        boundedText(r.name, 120) &&
        ["PROJECT", "SECURITY", "CLIENT_CONFIRMATION"].includes(
          String(r.kind),
        ) &&
        ["ALL", "ANY"].includes(String(r.mode)),
    );
    ids(r.approverIds, 1, 20);
  }
  requireInput(distinct(d.approvalRules.map((r) => r.id)));
  if (location) {
    requireInput(
      positive(d.maximumAdvanceDays) &&
        d.maximumAdvanceDays <= 366 &&
        positive(d.maximumVisitDays) &&
        d.maximumVisitDays <= 366,
    );
    for (const key of [
      "receptionIds",
      "securityIds",
      "notifyIds",
      "vipNotifyIds",
    ])
      ids(d[key], 0, 100);
    requireInput(Array.isArray(d.arrangements) && d.arrangements.length <= 20);
    for (const rawTask of d.arrangements) {
      const t = record(rawTask, [
        "id",
        "name",
        "kind",
        "mandatoryForEntry",
        "ownerIds",
      ]);
      requireInput(
        uuid(t.id) &&
          boundedText(t.name, 120) &&
          ["STAY", "OTHER"].includes(String(t.kind)) &&
          typeof t.mandatoryForEntry === "boolean",
      );
      ids(t.ownerIds, 1, 20);
    }
    requireInput(distinct(d.arrangements.map((t) => t.id)));
  }
  requireInput(JSON.stringify(d).length <= 30000);
  return structuredClone(d);
}
/** Compile bounded domain input to one fixed RPC contract, without sessions or I/O. */
export function planningRequest(action: PlanningAction, raw: unknown) {
  requireInput(
    [
      "options",
      "list",
      "thread",
      "detail",
      "create",
      "change",
      "manage",
    ].includes(action),
  );
  const d = record(
    raw,
    action === "options"
      ? ["locationId", "search"]
      : action === "list"
        ? ["locationId", "search", "folder", "offset", "fromUtc", "untilUtc"]
        : action === "detail"
          ? ["planId"]
          : action === "thread"
            ? ["planId", "threadId", "beforeMessageId"]
            : action === "create"
              ? ["draft", "clientKey"]
              : action === "change"
                ? ["planId", "clientKey", "revision", "command"]
                : ["clientKey", "action", "payload"],
  );
  const p: Record<string, SqlParameter> = {};
  let procedure = "gp.ReadVisitCoordination";
  if (["options", "list", "detail", "thread"].includes(action)) {
    if (d.locationId !== undefined) requireInput(positive(d.locationId));
    if (d.search !== undefined)
      requireInput(
        boundedText(d.search, 80) &&
          (action !== "options" || d.search.trim().length >= 2),
      );
    if (action === "detail" || action === "thread")
      requireInput(uuid(d.planId));
    if (action === "thread")
      requireInput(
        uuid(d.threadId) &&
          (d.beforeMessageId === undefined || uuid(d.beforeMessageId)),
      );
    if (action === "list") {
      requireInput(
        d.folder === undefined ||
          ["MY", "ASSIGNED", "PARTICIPATING"].includes(String(d.folder)),
      );
      requireInput(
        d.offset === undefined ||
          (Number.isSafeInteger(d.offset) &&
            Number(d.offset) >= 0 &&
            Number(d.offset) <= 5000),
      );
      for (const key of ["fromUtc", "untilUtc"])
        requireInput(d[key] === undefined || timestamp(d[key]));
    }
    p.Mode = { type: "text", value: action.toUpperCase() };
    p.QueryJson = { type: "text", value: JSON.stringify(d) };
  } else {
    requireInput(uuid(d.clientKey));
    p.ClientKey = { type: "guid", value: d.clientKey };
    if (action === "create") {
      procedure = "gp.CreatePlannedVisit";
      p.DraftJson = {
        type: "text",
        value: JSON.stringify(parseDraft(d.draft)),
      };
    } else if (action === "change") {
      requireInput(
        uuid(d.planId) && positive(d.revision) && d.revision < 2147483647,
      );
      procedure = "gp.ChangePlannedVisit";
      p.PlanId = { type: "guid", value: d.planId };
      p.ExpectedRevision = { type: "int", value: d.revision };
      p.CommandJson = {
        type: "text",
        value: JSON.stringify(parsePlanningCommand(d.command)),
      };
    } else {
      requireInput(["PROJECT", "HOST", "POLICY"].includes(String(d.action)));
      const kind = String(d.action),
        v = record(
          d.payload,
          kind === "PROJECT"
            ? [
                "subProjectId",
                "locationId",
                "accountOfficeId",
                "name",
                "active",
                "revision",
                "reason",
              ]
            : kind === "HOST"
              ? [
                  "subProjectId",
                  "locationId",
                  "userId",
                  "active",
                  "revision",
                  "reason",
                ]
              : [
                  "subProjectId",
                  "locationId",
                  "definition",
                  "revision",
                  "reason",
                ],
        );
      requireInput(
        Number.isSafeInteger(v.revision) &&
          Number(v.revision) >= 0 &&
          Number(v.revision) < 2147483647 &&
          boundedText(v.reason, 500),
      );
      requireInput(
        v.subProjectId === undefined
          ? positive(v.locationId)
          : uuid(v.subProjectId) &&
              v.locationId === undefined &&
              v.accountOfficeId === undefined,
      );
      if (kind === "PROJECT")
        requireInput(
          (v.subProjectId !== undefined || big(v.accountOfficeId)) &&
            boundedText(v.name, 200) &&
            typeof v.active === "boolean",
        );
      if (kind === "HOST")
        requireInput(uuid(v.userId) && typeof v.active === "boolean");
      if (kind === "POLICY")
        v.definition = validatePlanningDefinition(
          v.definition,
          v.subProjectId === undefined,
        );
      procedure = "gp.ManageVisitPlanning";
      p.Action = { type: "text", value: kind };
      p.PayloadJson = { type: "text", value: JSON.stringify(v) };
    }
  }
  return { procedure, parameters: p };
}
