import { MailFailure } from "./MailContracts.ts";
import { isUuid, isUtc } from "../visits/SqlVisitReadRepository.ts";
import { boundedText } from "../planning/Policy.ts";
export type PlanningMailJob = {
  status: "READY";
  noticeId: string;
  planId: string;
  kind:
    "APPROVAL" | "ARRANGEMENT" | "FYI" | "DISCUSSION" | "UPDATE" | "CANCELLED";
  audience: "APPROVAL" | "ARRANGEMENT" | "FYI" | "DISCUSSION" | "UPDATE";
  eventKind: string;
  version: number;
  recipientEmail: string;
  canReview: boolean;
  details: {
    visitorName: string;
    locationName: string;
    /** Legacy SQL projection name for the invitation creator / Visit owner. */
    hostName: string;
    vip: boolean;
    startsAtUtc: string;
    untilUtc: string;
    company?: string;
    targetName?: string;
    destinations: { name: string; accountName: string }[];
    checkInDate?: string;
    checkOutDate?: string;
    stayNotes?: string;
  };
};
export type PlanningMailClaim = { noticeId: string; claimToken: string };
const kinds = [
  "APPROVAL",
  "ARRANGEMENT",
  "FYI",
  "DISCUSSION",
  "UPDATE",
  "CANCELLED",
] as const;
const audiences = [
  "APPROVAL",
  "ARRANGEMENT",
  "FYI",
  "DISCUSSION",
  "UPDATE",
] as const;
const events = [
  "SUBMIT",
  "REVISE",
  "CANCEL",
  "DECIDE",
  "ARRANGE",
  "COMMENT",
] as const;
const recipient = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length <= 320 &&
  /^[^\s<>\x00-\x1f\x7f@]+@[^\s<>\x00-\x1f\x7f@]+\.[^\s<>\x00-\x1f\x7f@]+$/u.test(
    v,
  );
function ensure(value: unknown): asserts value {
  if (!value) throw new MailFailure("RENDER_FAILED");
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  ensure(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).every((k) => keys.includes(k)),
  );
  return value as Record<string, unknown>;
}
const date = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
  isUtc(value + "T00:00:00.000Z");
function member<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): value is T[number] {
  return typeof value === "string" && allowed.includes(value);
}
export function planningMailJob(value: unknown): PlanningMailJob {
  const r = object(value, [
    "status",
    "noticeId",
    "planId",
    "kind",
    "audience",
    "eventKind",
    "version",
    "recipientEmail",
    "canReview",
    "details",
  ]);
  ensure(
    r.status === "READY" &&
      isUuid(r.noticeId) &&
      isUuid(r.planId) &&
      member(r.kind, kinds) &&
      member(r.audience, audiences) &&
      member(r.eventKind, events) &&
      typeof r.version === "number" &&
      Number.isSafeInteger(r.version) &&
      r.version >= 1 &&
      r.version <= 21 &&
      typeof r.canReview === "boolean",
  );
  ensure(
    ["UPDATE", "CANCELLED"].includes(r.kind)
      ? ["UPDATE", "FYI"].includes(r.audience)
      : r.kind === r.audience,
  );
  if (!recipient(r.recipientEmail)) throw new MailFailure("INVALID_RECIPIENT");
  const d = object(r.details, [
    "visitorName",
    "locationName",
    "hostName",
    "vip",
    "startsAtUtc",
    "untilUtc",
    "company",
    "targetName",
    "destinations",
    "checkInDate",
    "checkOutDate",
    "stayNotes",
  ]);
  ensure(
    boundedText(d.visitorName, 200) &&
      boundedText(d.locationName, 100) &&
      boundedText(d.hostName, 200) &&
      typeof d.vip === "boolean" &&
      isUtc(d.startsAtUtc) &&
      isUtc(d.untilUtc) &&
      d.startsAtUtc < d.untilUtc,
  );
  ensure(d.company === undefined || boundedText(d.company, 200));
  ensure(d.targetName === undefined || boundedText(d.targetName, 120));
  ensure(Array.isArray(d.destinations) && d.destinations.length <= 10);
  const destinations = d.destinations.map((raw: unknown) => {
    const p = object(raw, ["name", "accountName"]);
    ensure(boundedText(p.name, 200) && boundedText(p.accountName, 200));
    return { name: p.name as string, accountName: p.accountName as string };
  });
  ensure(
    ["APPROVAL", "DISCUSSION"].includes(r.audience) ||
      destinations.length === 0,
  );
  const stay =
    d.checkInDate !== undefined ||
    d.checkOutDate !== undefined ||
    d.stayNotes !== undefined;
  let stayDetails:
    | Pick<
        PlanningMailJob["details"],
        "checkInDate" | "checkOutDate" | "stayNotes"
      >
    | undefined;
  if (stay) {
    ensure(
      r.audience === "ARRANGEMENT" &&
        date(d.checkInDate) &&
        date(d.checkOutDate) &&
        d.checkInDate < d.checkOutDate &&
        (d.stayNotes === undefined || boundedText(d.stayNotes, 1000)),
    );
    stayDetails = {
      checkInDate: d.checkInDate,
      checkOutDate: d.checkOutDate,
      ...(d.stayNotes === undefined ? {} : { stayNotes: d.stayNotes }),
    };
  }
  ensure(r.audience !== "FYI" || r.canReview === false);
  return {
    status: "READY",
    noticeId: r.noticeId.toLowerCase(),
    planId: r.planId.toLowerCase(),
    kind: r.kind,
    audience: r.audience,
    eventKind: r.eventKind,
    version: r.version,
    recipientEmail: r.recipientEmail,
    canReview: r.canReview,
    details: {
      visitorName: d.visitorName,
      locationName: d.locationName,
      hostName: d.hostName,
      vip: d.vip,
      startsAtUtc: d.startsAtUtc,
      untilUtc: d.untilUtc,
      destinations,
      ...(d.company === undefined ? {} : { company: d.company }),
      ...(d.targetName === undefined ? {} : { targetName: d.targetName }),
      ...stayDetails,
    },
  };
}
