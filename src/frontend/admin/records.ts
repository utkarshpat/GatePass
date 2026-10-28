import type { AdminModel } from "./model.ts";
import { indiaStart, shiftDay, type Office } from "./types.ts";
import type { RegisterRow } from "./register.ts";
import type { Visit } from "../guard/types.ts";
export type AuditEvent = {
  occurredAtUtc?: string;
  actionCode: string;
  actorDisplayName: string;
  targetType?: string;
  targetDisplayName?: string;
  resultCode: string;
  staffCode?: string;
  roleCode?: string;
  scopeName?: string;
  reason?: string;
};
export type VisitDetail = Visit & {
  reason?: string;
  deviceTypes?: string[];
  companyName?: string;
  passStatus?: string;
  publicPassNumber?: string;
  hostEmail?: string;
  movementsHasMore?: boolean;
};
export type OfficeQr = {
  office: Office;
  dataUrl: string;
  locationName: string;
  url: string;
};
export class Records {
  root: AdminModel;
  events: AuditEvent[] = [];
  auditCursor: string | null = null;
  auditFilter: { from: string; to: string; all: boolean } | null = null;
  auditMore = false;
  auditStatus = "";
  selected: RegisterRow | null = null;
  detail: VisitDetail | null = null;
  detailStatus = "";
  qr: OfficeQr | null = null;
  constructor(root: AdminModel) {
    this.root = root;
    root.resets.add(() => this.clear());
    root.loaders.audit = () =>
      this.events.length ? Promise.resolve() : this.loadAudit();
  }
  clear() {
    this.events = [];
    this.auditCursor = null;
    this.auditFilter = null;
    this.auditMore = false;
    this.auditStatus = "";
    this.selected = null;
    this.detail = null;
    this.detailStatus = "";
    this.qr = null;
  }
  allAllowed() {
    return (
      !!this.root.scope?.canAudit &&
      this.root.scope.roles.some((r) =>
        ["INDIA", "PLATFORM"].includes(r.scopeType),
      )
    );
  }
  shownEvents() {
    const result = this.root.field("audit-result"),
      query = this.root.field("audit-search").trim().toLowerCase();
    return this.events.filter(
      (event) =>
        (!result || event.resultCode === result) &&
        (!query ||
          [
            event.actionCode,
            event.actorDisplayName,
            event.targetType,
            event.targetDisplayName,
            event.staffCode,
            event.roleCode,
            event.scopeName,
            event.reason,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(query)),
    );
  }
  async loadAudit(more = false) {
    const root = this.root;
    if (!root.scope?.canAudit) return;
    const valid = root.current(),
      request = root.token("audit"),
      current = () => valid() && request();
    try {
      if (!more)
        this.auditFilter = {
          ...root.register.range("audit-from", "audit-to"),
          all: this.allAllowed() && !!root.checks["audit-all"],
        };
      if (!this.auditFilter) return;
      const { from, to, all } = this.auditFilter;
      this.auditStatus = "Loading audit events…";
      root.publish();
      const result = await root.api<{
        events: AuditEvent[];
        hasMore: boolean;
        afterAuditEventId: string | null;
      }>(
        "audit",
        {
          ...(all ? {} : root.scopeBody()),
          fromUtc: indiaStart(from),
          untilUtc: indiaStart(shiftDay(to, 1)),
          pageSize: 50,
          ...(more && this.auditCursor
            ? { afterAuditEventId: this.auditCursor }
            : {}),
        },
        false,
        current,
      );
      if (!current()) return;
      this.events = more ? [...this.events, ...result.events] : result.events;
      this.auditCursor = result.afterAuditEventId;
      this.auditMore = result.hasMore;
      this.auditStatus = "";
      root.publish();
    } catch (error) {
      if (current()) {
        this.auditStatus = (error as Error).message;
        root.failure(error);
      }
    }
  }
  async viewVisit(row: RegisterRow) {
    const root = this.root;
    if (!root.scope?.canReadVisits || root.writing) return;
    const valid = root.current(),
      request = root.token("detail"),
      current = () =>
        valid() && request() && !!root.dialogs["admin-visit-dialog"];
    this.selected = row;
    this.detail = null;
    this.detailStatus = "Loading visit…";
    root.open("admin-visit-dialog");
    try {
      const result = await root.api<VisitDetail>(
        "visit-detail",
        { visitRequestId: row.visitRequestId },
        false,
        current,
      );
      if (!current()) return;
      this.detail = result;
      this.detailStatus = "";
      root.publish();
    } catch (error) {
      if (current()) {
        this.detailStatus = (error as Error).message;
        root.failure(error);
      }
    }
  }
  async loadQr(office: Office) {
    const root = this.root;
    if (!root.scope || root.writing) return;
    const valid = root.current(),
      request = root.token("qr"),
      current = () => valid() && request();
    try {
      const result = await root.api<{
        imageDataUrl: string;
        locationName: string;
        url: string;
      }>("office-qr", { locationId: office.locationId }, false, current);
      if (!current()) return;
      if (
        typeof result.imageDataUrl !== "string" ||
        !result.imageDataUrl.startsWith("data:image/png;base64,")
      )
        throw Error("QR unavailable.");
      this.qr = {
        office,
        dataUrl: result.imageDataUrl,
        locationName: result.locationName,
        url: result.url,
      };
      root.open("qr-dialog");
    } catch (error) {
      if (current()) root.failure(error);
    }
  }
}
