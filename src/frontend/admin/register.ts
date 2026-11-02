import type { AdminModel } from "./model.ts";
import { dateTime, human, shiftDay, type Failure } from "./types.ts";
import { passValidityLabel } from "../../shared/ValidityDisplay.ts";
export type RegisterRow = Record<string, string | null | undefined> & {
  visitRequestId: string;
  personName: string;
};
export type RegisterFilter = Record<string, unknown> & {
  from: string;
  to: string;
  filters: Record<string, string>;
  sort: string;
  direction: string;
};
type Reply = {
  rows: RegisterRow[];
  total: number;
  page: number;
  pageSize: number;
  datasetVersion?: string;
  exportSnapshotId?: string;
  exportValidated?: boolean;
};
export const registerColumns = [
  ["localVisitDate", "Visit date"],
  ["submittedAtUtc", "Registered at"],
  ["personName", "Name"],
  ["employeeId", "Employee ID"],
  ["personEmail", "Email"],
  ["personPhone", "Mobile"],
  ["companyName", "Company"],
  ["deviceTypes", "Devices"],
  ["locationName", "Office"],
  ["projectName", "Account"],
  ["hostName", "Host"],
  ["hostEmail", "Host email"],
  ["requestType", "Type"],
  ["reason", "Purpose"],
  ["publicReference", "Request reference"],
  ["publicPassNumber", "Pass number"],
  ["status", "Approval"],
  ["passStatus", "Pass status"],
  ["presence", "Recorded presence"],
  ["printStatus", "Printed / returned"],
  ["returnedAtUtc", "Returned at"],
  ["validFromUtc", "Valid from"],
  ["validUntilUtc", "Valid until"],
  ["firstEntryAtUtc", "First entry"],
  ["lastEntryAtUtc", "Latest entry"],
  ["lastExitAtUtc", "Latest exit"],
] as const;
export const registerChoices: Record<string, string[]> = {
  status: ["PENDING", "APPROVED", "DENIED", "CANCELLED"],
  passStatus: ["PENDING", "ACTIVE", "DENIED", "REVOKED"],
  requestType: ["EXTERNAL", "EMPLOYEE_PROJECT", "DIGITAL_ID"],
  presence: ["INSIDE", "OUTSIDE"],
  printStatus: ["NOT_PRINTED", "PRINTED", "RETURNED"],
  deviceTypes: ["LAPTOP", "TABLET", "PEN_DRIVE", "CAMERA", "OTHER"],
};
export const registerCell = (key: string, value?: string | null) =>
  !value
    ? "—"
    : key === "localVisitDate"
      ? value
      : key === "validUntilUtc"
        ? passValidityLabel(value)
        : key.endsWith("Utc")
          ? dateTime(value)
          : registerChoices[key] && key !== "deviceTypes"
            ? human(value)
            : value;
type ExportAttempt = {
  filter: RegisterFilter;
  snapshotId: string | null;
  validated: boolean;
  cancelled: boolean;
  cancel?: (() => void) | null;
};
export class Register {
  root: AdminModel;
  page = 1;
  rows: RegisterRow[] = [];
  total = 0;
  filter: RegisterFilter | null = null;
  loading = false;
  status = "";
  message = "";
  exporting: ExportAttempt | null = null;
  visible = new Set([
    "localVisitDate",
    "submittedAtUtc",
    "personName",
    "projectName",
    "hostName",
    "requestType",
    "publicReference",
    "status",
    "presence",
    "printStatus",
  ]);
  filters: { id: string; key: string; value: string }[] = [];
  workbookBlob: (
    header: string[],
    rows: string[][],
    attempt: ExportAttempt,
  ) => Promise<Blob>;
  constructor(root: AdminModel) {
    this.root = root;
    root.resets.add(() => this.clear());
    root.loaders.reports = (quiet) =>
      quiet
        ? this.load(false, false, true)
        : this.filter
          ? Promise.resolve()
          : this.load();
    root.fields["register-sort"] = "submittedAtUtc";
    root.fields["register-direction"] = "DESC";
    this.workbookBlob = (header, rows, attempt) =>
      new Promise((resolve, reject) => {
        const worker = new Worker(root.config.exportWorkerUrl);
        let done = false;
        const finish = (error: Error | null, blob?: Blob) => {
          if (done) return;
          done = true;
          root.resources.clearTimeout(timer);
          worker.terminate();
          attempt.cancel = null;
          if (error) reject(error);
          else resolve(blob!);
        };
        const timer = root.resources.timeout(
          () => finish(Error("Excel generation timed out. Retry the export.")),
          60000,
        );
        attempt.cancel = () => finish(Error("Export cancelled."));
        worker.onmessage = (event) =>
          event.data?.blob instanceof Blob
            ? finish(null, event.data.blob)
            : finish(Error(event.data?.error ?? "Excel generation failed."));
        worker.onerror = () =>
          finish(Error("Excel generation failed. Retry the export."));
        worker.postMessage({ header, rows });
      });
  }
  clear() {
    this.cancelSnapshot(this.exporting);
    this.exporting?.cancel?.();
    this.exporting = null;
    this.rows = [];
    this.page = 1;
    this.total = 0;
    this.filter = null;
    this.loading = false;
    this.status = "";
    this.message = "";
  }
  canExport() {
    return (
      this.root.scope?.canReadVisits === true &&
      this.root.scope.canExport === true
    );
  }
  scopeLabel() {
    return (
      (this.root.office?.locationName ?? "") +
      (this.root.pair
        ? " · " + this.root.pair.projectName
        : " · All authorized accounts")
    );
  }
  range(fromId: string, toId: string) {
    const from = this.root.field(fromId),
      to = this.root.field(toId);
    if (
      !from ||
      !to ||
      from > to ||
      Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z") >
        30 * 86400000
    )
      throw Error("Choose an ordered date range of at most 31 days.");
    return { from, to };
  }
  sortLabel(filter: RegisterFilter) {
    return (
      "Sorted by " +
      (registerColumns.find(([key]) => key === filter.sort)?.[1] ??
        "Registered at") +
      " (" +
      (filter.direction === "ASC" ? "ascending" : "descending") +
      ")"
    );
  }
  currentFilter(): RegisterFilter {
    const root = this.root,
      filters: Record<string, string> = {};
    for (const row of this.filters) {
      if (!row.value.trim())
        throw Error("Enter a value for every field filter.");
      if (Object.hasOwn(filters, row.key))
        throw Error("Use one filter per field.");
      filters[row.key] = row.value.trim();
    }
    for (const [id, key] of [
      ["report-reference", "publicReference"],
      ["quick-name", "personName"],
      ["quick-status", "status"],
      ["quick-presence", "presence"],
      ["quick-type", "requestType"],
    ]) {
      const value = root.field(id).trim();
      if (!value) continue;
      if (Object.hasOwn(filters, key))
        throw Error(
          key === "publicReference"
            ? "Use one request reference filter."
            : "Use one filter per field.",
        );
      filters[key] = value;
    }
    return {
      ...root.scopeBody(),
      ...this.range("report-from", "report-to"),
      filters,
      sort: root.field("register-sort") || "submittedAtUtc",
      direction: root.field("register-direction") || "DESC",
    };
  }
  async load(more = false, previous = false, retain = false) {
    const root = this.root;
    if (!root.scope?.canReadVisits) return;
    const valid = root.current(),
      request = root.token("reports"),
      current = () => valid() && request();
    try {
      const filter =
        more || previous || retain ? this.filter : this.currentFilter();
      if (!filter) return;
      let page = more
        ? this.page + 1
        : previous
          ? this.page - 1
          : retain
            ? this.page
            : 1;
      this.loading = true;
      if (!retain) {
        this.status = this.scopeLabel() + " · Loading visits…";
        this.message = "Loading visit register…";
        this.rows = [];
      }
      root.publish();
      let result: Reply | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        result = await root.api<Reply>(
          "register",
          { ...filter, page },
          false,
          current,
        );
        if (!current()) return;
        const last = Math.max(1, Math.ceil(result.total / 50));
        if (result.page <= last) break;
        if (attempt === 2)
          throw Error("Visit register changed. Use Apply filters to retry.");
        page = last;
      }
      if (!result) return;
      this.filter = filter;
      this.page = result.page;
      this.total = result.total;
      this.rows = result.rows;
      this.message = result.rows.length
        ? ""
        : "No visits found in this scope. Change the office, dates or filters.";
      this.status =
        this.scopeLabel() +
        " · " +
        (result.total
          ? (page - 1) * 50 +
            1 +
            "–" +
            ((page - 1) * 50 + result.rows.length) +
            " of " +
            result.total +
            " matching visits"
          : "No visits match these filters") +
        " · " +
        this.sortLabel(filter);
    } catch (error) {
      if (current()) {
        this.status = this.scopeLabel() + " · " + (error as Error).message;
        this.message =
          "Visits could not be loaded. Use Apply filters to retry.";
        this.rows = [];
        this.total = 0;
        root.failure(error);
      }
    } finally {
      if (current()) {
        this.loading = false;
        root.publish();
      }
    }
  }
  toggleColumn(key: string, checked: boolean) {
    if (this.root.writing) return;
    if (checked) this.visible.add(key);
    else if (this.visible.size > 1) this.visible.delete(key);
    this.root.publish();
  }
  addFilter() {
    if (this.root.writing) return;
    this.filters = [
      ...this.filters,
      { id: crypto.randomUUID(), key: "personName", value: "" },
    ];
    this.root.publish();
  }
  changeFilter(id: string, change: Partial<{ key: string; value: string }>) {
    if (this.root.writing) return;
    this.filters = this.filters.map((v) =>
      v.id === id ? { ...v, ...change } : v,
    );
    this.root.publish();
  }
  removeFilter(id: string) {
    if (!this.root.writing) {
      this.filters = this.filters.filter((v) => v.id !== id);
      this.root.publish();
    }
  }
  sort(key: string) {
    if (this.root.writing || this.loading) return;
    this.root.fields["register-direction"] =
      this.root.field("register-sort") === key &&
      this.root.field("register-direction") === "ASC"
        ? "DESC"
        : "ASC";
    this.root.fields["register-sort"] = key;
    void this.load();
  }
  reset() {
    if (!this.root.scope || this.root.writing) return;
    this.filters = [];
    for (const id of [
      "report-reference",
      "quick-name",
      "quick-status",
      "quick-presence",
      "quick-type",
    ])
      this.root.fields[id] = "";
    this.root.fields["report-from"] = this.root.fields["report-to"] =
      this.root.scope.currentDate;
    this.root.fields["register-sort"] = "submittedAtUtc";
    this.root.fields["register-direction"] = "DESC";
    void this.load();
  }
  days(days: number) {
    if (!this.root.scope || this.loading || this.root.writing) return;
    this.root.fields["report-to"] = this.root.scope.currentDate;
    this.root.fields["report-from"] = shiftDay(
      this.root.scope.currentDate,
      1 - days,
    );
    void this.load();
  }
  cancelSnapshot(attempt: ExportAttempt | null) {
    if (!attempt?.snapshotId || attempt.validated || attempt.cancelled) return;
    attempt.cancelled = true;
    void this.root
      .api(
        "register",
        {
          ...attempt.filter,
          page: 1,
          export: true,
          snapshot: true,
          snapshotId: attempt.snapshotId,
          cancelExport: true,
        },
        false,
        () => false,
      )
      .catch(() => {});
  }
  async export() {
    const root = this.root,
      filter = this.filter;
    if (
      !this.canExport() ||
      !filter ||
      this.loading ||
      this.exporting ||
      root.writing
    )
      return;
    const valid = root.current(),
      attempt: ExportAttempt = {
        filter,
        snapshotId: null,
        validated: false,
        cancelled: false,
      };
    this.exporting = attempt;
    const current = () => valid() && this.exporting === attempt;
    root.publish();
    try {
      const rows: RegisterRow[] = [],
        ids = new Set<string>();
      let pages = 1,
        total: number | null = null,
        dataset: string | null = null,
        pageSize: number | null = null,
        snapshotId: string | null = null;
      const changed = () =>
        Error(
          "Visit register changed during export. Refresh the register and try again.",
        );
      for (let page = 1; page <= pages; page++) {
        this.status =
          "Preparing Excel file… " +
          rows.length +
          " of " +
          (total ?? this.total) +
          " visits";
        root.publish();
        const result: Reply = await root.api<Reply>(
          "register",
          {
            ...filter,
            page,
            export: true,
            snapshot: true,
            ...(snapshotId ? { snapshotId } : {}),
          },
          false,
          current,
        );
        if (result.exportSnapshotId)
          attempt.snapshotId = result.exportSnapshotId;
        if (!current()) return;
        if (page === 1) {
          if (!Number.isSafeInteger(result.total) || result.total < 1)
            throw Error(
              "No visits remain in this scope. Refresh the register.",
            );
          if (
            ![50, 200].includes(result.pageSize) ||
            typeof result.datasetVersion !== "string" ||
            !/^[a-f0-9]{64}$/u.test(result.datasetVersion)
          )
            throw Error("Refresh the register before exporting.");
          total = result.total;
          pageSize = result.pageSize;
          pages = Math.ceil(result.total / result.pageSize);
          dataset = result.datasetVersion;
          snapshotId = result.exportSnapshotId ?? null;
          if (pages > 200)
            throw Error(
              "Too many visits to export at once. Narrow the dates or filters.",
            );
        }
        if (
          result.datasetVersion !== dataset ||
          result.total !== total ||
          result.page !== page ||
          result.pageSize !== pageSize ||
          !Array.isArray(result.rows) ||
          result.rows.length !==
            Math.min(pageSize!, total! - (page - 1) * pageSize!)
        )
          throw changed();
        for (const row of result.rows) {
          const id = String(row.visitRequestId).toLowerCase();
          if (ids.has(id)) throw changed();
          ids.add(id);
          rows.push(row);
        }
      }
      if (rows.length !== total) throw changed();
      this.status = "Building Excel file…";
      root.publish();
      const blob = await this.workbookBlob(
        registerColumns.map(([, label]) => label),
        rows.map((row) =>
          registerColumns.map(([key]) => {
            const value = registerCell(key, row[key]);
            return value === "—" ? "" : value;
          }),
        ),
        attempt,
      );
      if (!current()) return;
      if (snapshotId) {
        let verified: Reply;
        try {
          verified = await root.api<Reply>(
            "register",
            {
              ...filter,
              page: 1,
              export: true,
              snapshot: true,
              snapshotId,
              finishExport: true,
            },
            false,
            current,
          );
        } catch (error) {
          if ((error as Failure).status === 409) throw changed();
          throw error;
        }
        if (!current()) return;
        if (
          !verified.exportValidated ||
          verified.exportSnapshotId !== snapshotId ||
          verified.datasetVersion !== dataset ||
          verified.total !== total
        )
          throw changed();
        attempt.validated = true;
      }
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download =
        "GatePass-Visit-Register-" +
        root.office!.locationName.replace(/[^A-Za-z0-9_-]+/gu, "-") +
        "-" +
        filter.from +
        "_to_" +
        filter.to +
        ".xlsx";
      document.body.append(link);
      link.click();
      link.remove();
      root.resources.timeout(() => URL.revokeObjectURL(url), 4000);
      root.resources.own(() => URL.revokeObjectURL(url));
      this.status = rows.length + " visits exported to Excel.";
      root.notice("Excel file downloaded.");
    } catch (error) {
      if (current()) {
        this.status = (error as Error).message;
        root.failure(error);
      }
    } finally {
      this.cancelSnapshot(attempt);
      if (this.exporting === attempt) this.exporting = null;
      root.publish();
    }
  }
}
