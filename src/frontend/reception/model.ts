import { createStore, Resources, inspectForTests } from "../shared/model.ts";
import { LiveRefresh } from "../shared/liveRefresh.ts";
import { PrintCoordinator, printDocument } from "./printing.ts";
import {
  effective,
  dateTime,
  type ReceptionVisit as Visit,
  type ReceptionContext as Context,
  type ReceptionOffice as Office,
  type ReceptionCursor as Cursor,
} from "./types.ts";
export class ReceptionFailure extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}
type ListReply = {
  visits: Visit[];
  cursor: Cursor | null;
  counts?: { total: number; pending: number; inside: number };
  pendingReturnCount?: number;
};
type ImageReply = { mimeType: string; imageBase64: string };
export function createReceptionModel() {
  const resources = new Resources(),
    state = {
      initializeVersion: 0,
      profileVersion: 0,
      context: null as Context | null,
      location: null as Office | null,
      rows: [] as Visit[],
      cursor: null as Cursor | null,
      status: "ALL",
      listVersion: 0,
      calendarVersion: 0,
      calendarBusy: false,
      detailVersion: 0,
      selected: null as Visit | null,
      detail: null as Visit | null,
      listBusy: false,
      listComplete: false,
      listFailed: false,
      accessDenied: false,
      printBusy: false,
      photoUrl: null as string | null,
      cardUrl: null as string | null,
      insideOnly: false,
      pendingReturns: false,
      pendingReturnCount: null as number | null,
      returnBusy: false,
      returnKeys: new Map<string, string>(),
      search: "",
      visitDate: "",
      printFilter: "ALL",
      typeFilter: "ALL",
      renderLimit: 50,
      pageCounts: null as ListReply["counts"] | null,
      pageFilter: null as string | null,
      loadingMessage: "Loading reception…",
      dashboard: false,
      accountOpen: false,
      profileOpen: false,
      profileContext: null as Context | null,
      historyOpen: false,
      historyFrom: "",
      historyEnd: "",
      historyRows: [] as Visit[],
      historyStatus: "",
      visitOpen: false,
      detailStatus: "",
      cardStatus: "",
      retryDetail: false,
      reminderVisible: false,
      reminderBusy: false,
      reminderStatus: "",
      manualOpen: false,
      returnTarget: null as { row: Visit; office: number } | null,
      verifiedDevices: [] as string[],
      returnStatus: "",
      correction: null as { row: Visit; office: number } | null,
      correctionReason: "",
      correctionStatus: "",
      lookupSearch: "",
      lookupOpen: false,
      lookupRows: [] as Visit[],
      lookupCursor: null as Cursor | null,
      lookupStatus: "",
      lookupBusy: false,
      lookupVersion: 0,
      lookupQuery: null as string | null,
      lookupOffice: null as number | null,
      notices: [] as {
        id: number;
        message: string;
        kind: "success" | "error";
      }[],
    };
  const store = createStore({ ...state }),
    publish = () => {
      if (resources.alive) store.update({ ...state });
    },
    cookie = (name: string) =>
      document.cookie
        .split("; ")
        .find((v) => v.startsWith(name + "="))
        ?.split("=")[1];
  let searchTimer: number | undefined,
    lookupTimer: number | undefined,
    historyVersion = 0,
    noticeId = 0,
    liveRefresh: LiveRefresh | undefined,
    calendarTimer: number | undefined;
  const notify = (message: unknown, kind: "success" | "error" = "error") => {
    state.notices = [
      {
        id: ++noticeId,
        message: message instanceof Error ? message.message : String(message),
        kind,
      },
    ];
    publish();
  };
  async function api<T>(
    action: string,
    body: unknown = {},
    current = () => true,
  ): Promise<T> {
    const context = state.context,
      office = state.location?.locationId,
      initialization = state.initializeVersion,
      controller = resources.controller(),
      timer = window.setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch("/api/reception/" + action, {
        method: "POST",
        credentials: "same-origin",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token":
            cookie("gp-staff-csrf") ?? cookie("gp-reception-csrf") ?? "",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        if (
          response.status === 401 &&
          resources.alive &&
          current() &&
          context === state.context &&
          office === state.location?.locationId &&
          initialization === state.initializeVersion
        )
          showLogin();
        throw new ReceptionFailure(
          (
            {
              400: "Check the details.",
              401: "Sign in again to continue.",
              403: "Access unavailable for this office or pass.",
              409: "Pass or print state changed. Refresh and try again.",
              429: "Too many requests. Please wait.",
            } as Record<number, string>
          )[response.status] ?? "Unable to complete the request. Please retry.",
          response.status,
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ReceptionFailure) throw error;
      throw new ReceptionFailure(
        controller.signal.aborted
          ? "Request timed out. Please retry."
          : "Connection lost. Please retry.",
      );
    } finally {
      window.clearTimeout(timer);
      resources.release(controller);
    }
  }
  const pendingPrint = new PrintCoordinator(api);
  function releaseImages() {
    if (state.cardUrl) URL.revokeObjectURL(state.cardUrl);
    if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
    state.cardUrl = state.photoUrl = null;
  }
  function imageUrl(image: ImageReply) {
    if (
      !["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(
        image.mimeType,
      ) ||
      typeof image.imageBase64 !== "string" ||
      image.imageBase64.length > 16777216
    )
      throw Error("Image unavailable.");
    return URL.createObjectURL(
      new Blob(
        [Uint8Array.from(atob(image.imageBase64), (c) => c.charCodeAt(0))],
        { type: image.mimeType },
      ),
    );
  }
  function closeVisit() {
    state.detailVersion++;
    state.selected = state.detail = null;
    releaseImages();
    state.visitOpen = false;
    state.notices = [];
    publish();
  }
  function closeHistory() {
    historyVersion++;
    state.historyOpen = false;
    state.historyRows = [];
    publish();
  }
  function closeProfile() {
    state.profileVersion++;
    state.profileOpen = false;
    state.profileContext = null;
    publish();
  }
  function clearLookup() {
    state.lookupVersion++;
    resources.clearTimeout(lookupTimer);
    state.lookupRows = [];
    state.lookupCursor = null;
    state.lookupSearch = "";
    state.lookupQuery = null;
    state.lookupOpen = false;
    state.lookupStatus = "";
    state.correction = null;
    publish();
  }
  function resetProtected() {
    state.initializeVersion++;
    state.calendarVersion++;
    state.listVersion++;
    clearLookup();
    state.returnTarget = null;
    state.context = null;
    state.location = null;
    state.rows = [];
    state.cursor = null;
    state.pendingReturnCount = null;
    state.pageCounts = null;
    pendingPrint.clear();
    state.returnKeys.clear();
    closeVisit();
    state.manualOpen = false;
    closeHistory();
    closeProfile();
    state.dashboard = false;
    state.calendarBusy = false;
    document.dispatchEvent(new Event("workspace-reset"));
    publish();
  }
  function showLogin() {
    resetProtected();
    if (resources.alive) location.replace("/");
  }
  function clearProtectedVisits() {
    state.initializeVersion++;
    state.listVersion++;
    clearLookup();
    state.returnTarget = null;
    state.rows = [];
    state.cursor = null;
    state.pageCounts = null;
    state.listComplete = false;
    state.listFailed = true;
    state.accessDenied = true;
    state.listBusy = false;
    state.pendingReturnCount = null;
    closeVisit();
    closeHistory();
    closeProfile();
    state.manualOpen = false;
    document.dispatchEvent(new Event("workspace-reset"));
    publish();
  }
  function setCalendar(day: string) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/u.test(day) ||
      new Date(day + "T12:00:00Z").toISOString().slice(0, 10) !== day
    )
      throw Error("Office date unavailable.");
    if (state.context) state.context = { ...state.context, currentDate: day };
  }
  function setContext(context: Context) {
    state.initializeVersion++;
    closeProfile();
    clearLookup();
    closeVisit();
    closeHistory();
    state.manualOpen = false;
    state.returnTarget = null;
    document.dispatchEvent(new Event("workspace-reset"));
    state.context = context;
    state.location = context.locations[0];
    state.rows = [];
    state.cursor = null;
    state.pendingReturnCount = null;
    state.listComplete = state.listFailed = state.accessDenied = false;
    setCalendar(context.currentDate);
    state.visitDate = context.currentDate;
    state.search = "";
    state.status = state.printFilter = state.typeFilter = "ALL";
    state.insideOnly = state.pendingReturns = false;
    state.dashboard = true;
    state.loadingMessage = "";
    publish();
    void loadVisits();
  }
  async function initializeReception(restored = false) {
    const version = ++state.initializeVersion,
      current = () => version === state.initializeVersion;
    if (!restored) {
      state.loadingMessage = "Loading reception…";
      publish();
    }
    try {
      const context = await api<Context>("me", {}, current);
      if (current() && resources.alive) setContext(context);
    } catch (error) {
      if (!current()) return;
      if (restored) showLogin();
      else if (!(error instanceof ReceptionFailure && error.status === 401)) {
        state.loadingMessage = "Reception could not load. Reload to retry.";
        notify(error);
      }
    }
  }
  function renderRows() {
    publish();
  }
  function matchingRows() {
    return state.rows.filter((row) => {
      const pending =
        row.status === "PENDING" &&
        !row.returnedAtUtc &&
        row.passStatus === "PENDING" &&
        effective(row) === "PENDING";
      return (
        (state.status === "PENDING"
          ? pending
          : state.status === "ALL" || effective(row) === state.status) &&
        (!state.insideOnly || row.isInside) &&
        (state.printFilter !== "PRINTED" || row.printCount > 0) &&
        (state.printFilter !== "UNPRINTED" || !row.printCount) &&
        (state.printFilter !== "PENDING_RETURN" ||
          (row.printCount > 0 && !row.returnedAtUtc)) &&
        (state.printFilter !== "RETURNED" || !!row.returnedAtUtc) &&
        (state.typeFilter !== "EMPLOYEE" || row.requestType !== "EXTERNAL") &&
        (state.typeFilter !== "VISITOR" || row.requestType === "EXTERNAL")
      );
    });
  }
  function counts() {
    const rows = matchingRows(),
      inside = new Set(
        rows
          .filter((row) => row.isInside)
          .map((row) =>
            row.employeeId
              ? "employee:" + row.employeeId
              : "visit:" + row.visitRequestId,
          ),
      );
    return {
      total:
        state.context?.queuePaging && state.pageCounts
          ? state.pageCounts.total
          : rows.length,
      pending:
        state.context?.queuePaging && state.pageCounts
          ? state.pageCounts.pending
          : rows.filter(
              (row) =>
                row.status === "PENDING" &&
                !row.returnedAtUtc &&
                row.passStatus === "PENDING" &&
                effective(row) === "PENDING",
            ).length,
      inside:
        state.context?.queuePaging && state.pageCounts
          ? state.pageCounts.inside
          : inside.size,
      returns:
        state.pendingReturnCount ??
        state.rows.filter((row) => row.printCount > 0 && !row.returnedAtUtc)
          .length,
    };
  }
  async function loadVisits(more = false, quiet = false) {
    if (
      !state.context ||
      !state.location ||
      (more && state.context.queuePaging && !state.cursor)
    )
      return;
    const version = ++state.listVersion,
      filter = {
        locationId: state.location.locationId,
        visitDate: state.visitDate,
        search: state.search.trim(),
        status: state.context.queuePaging ? state.status : "ALL",
        pendingReturns: state.pendingReturns,
        ...(state.context.queuePaging
          ? {
              typeFilter: state.typeFilter,
              printFilter: state.printFilter,
              insideOnly: state.insideOnly,
            }
          : {}),
      },
      signature = JSON.stringify(filter),
      same = state.pageFilter === signature,
      target = quiet && same ? Math.max(50, state.rows.length) : 50,
      rows =
        more && (!state.context.queuePaging || same) ? [...state.rows] : [];
    let cursor = more ? state.cursor : null,
      pendingReturns = state.pendingReturnCount,
      pageCounts = state.pageCounts;
    state.listBusy = true;
    state.listFailed = state.accessDenied = false;
    if (!more && !quiet) state.renderLimit = 50;
    if (state.context.queuePaging && !same) {
      state.rows = [];
      state.pageCounts = null;
      state.cursor = null;
      state.listComplete = false;
    }
    publish();
    try {
      const seen = new Set<string>();
      do {
        const reply = await api<ListReply>(
          state.context.queuePaging ? "queue" : "list",
          {
            ...filter,
            ...(cursor ? { cursor } : {}),
            ...(quiet && state.context.queuePaging
              ? { limit: Math.min(500, Math.max(50, target - rows.length)) }
              : {}),
          },
          () => version === state.listVersion,
        );
        if (version !== state.listVersion || !resources.alive) return;
        const known = new Set(rows.map((row) => row.visitRequestId));
        for (const row of reply.visits)
          if (!known.has(row.visitRequestId)) {
            known.add(row.visitRequestId);
            rows.push(row);
          }
        cursor = reply.cursor;
        if (Number.isSafeInteger(reply.pendingReturnCount))
          pendingReturns = reply.pendingReturnCount!;
        pageCounts = reply.counts ?? pageCounts;
        if (cursor) {
          const key = JSON.stringify(cursor);
          if (seen.has(key)) throw Error("List changed. Refresh to retry.");
          seen.add(key);
        }
      } while (
        cursor &&
        (!state.context.queuePaging || (quiet && rows.length < target))
      );
      state.rows = rows;
      state.cursor = state.context.queuePaging ? cursor : null;
      state.pageCounts = pageCounts;
      state.pageFilter = signature;
      state.pendingReturnCount = pendingReturns;
      state.listComplete = true;
      if (state.context.queuePaging) state.renderLimit = rows.length;
    } catch (error) {
      if (version !== state.listVersion) return;
      if (error instanceof ReceptionFailure && error.status === 403) {
        clearProtectedVisits();
        notify(error);
        return;
      }
      state.listFailed = true;
      if (!quiet) notify(error);
    } finally {
      if (version === state.listVersion) {
        state.listBusy = false;
        publish();
      }
    }
  }
  function canPrint(row: Visit) {
    return (
      !row.returnedAtUtc &&
      !!state.location?.canPrint &&
      ["PENDING", "APPROVED"].includes(row.status) &&
      ["PENDING", "ACTIVE"].includes(row.passStatus) &&
      Date.parse(row.validUntilUtc) > Date.now()
    );
  }
  const reminderKeys = new Map<string, string>();
  async function reminderState(detail: Visit, version: number) {
    state.reminderVisible = false;
    publish();
    if (detail.requestType === "DIGITAL_ID" || effective(detail) !== "PENDING")
      return;
    state.reminderVisible = true;
    state.reminderBusy = true;
    publish();
    try {
      const result = await api<{
        eligible: boolean;
        mailStatus: string;
        nextReminderAtUtc: string;
        lastQueuedAtUtc?: string;
      }>(
        "remind-host",
        { visitRequestId: detail.visitRequestId },
        () => version === state.detailVersion,
      );
      if (version !== state.detailVersion) return;
      state.reminderVisible = result.eligible;
      state.reminderBusy =
        !result.eligible ||
        result.mailStatus === "QUEUED" ||
        Date.parse(result.nextReminderAtUtc) > Date.now();
      state.reminderStatus =
        "Host email: " +
        result.mailStatus.toLowerCase() +
        (result.lastQueuedAtUtc
          ? " · Last queued " + dateTime(result.lastQueuedAtUtc)
          : "") +
        (result.mailStatus === "SENT" ? " (delivery not confirmed)" : "") +
        (result.mailStatus !== "QUEUED" &&
        Date.parse(result.nextReminderAtUtc) > Date.now()
          ? " · Next reminder " + dateTime(result.nextReminderAtUtc)
          : "");
      publish();
    } catch {
      if (version === state.detailVersion) {
        state.reminderVisible = true;
        state.reminderBusy = false;
        state.reminderStatus = "Email status unavailable. Retry to check.";
        publish();
      }
    }
  }
  async function openVisit(row: Visit, initial?: Visit) {
    if (!state.context) return;
    state.lookupOpen = false;
    state.selected = row;
    const version = ++state.detailVersion;
    releaseImages();
    state.detail = null;
    state.visitOpen = true;
    state.reminderVisible = false;
    state.reminderStatus = "";
    state.detailStatus = "Loading details…";
    state.cardStatus = "";
    state.retryDetail = false;
    publish();
    try {
      const detail =
        initial ??
        (await api<Visit>(
          "detail",
          { visitRequestId: row.visitRequestId },
          () => version === state.detailVersion,
        ));
      if (version !== state.detailVersion || !resources.alive) return;
      Object.assign(row, detail);
      const listed = state.rows.find(
        (v) => v.visitRequestId === row.visitRequestId,
      );
      if (listed && listed !== row) Object.assign(listed, detail);
      state.detail = { ...detail, returnedAtUtc: row.returnedAtUtc };
      state.detailStatus = "";
      void reminderState(detail, version);
      publish();
      if (!canPrint({ ...detail, returnedAtUtc: row.returnedAtUtc })) {
        state.cardStatus = state.location?.canPrint
          ? "This pass is unavailable for printing."
          : "View-only access. Printing is not permitted.";
        if (detail.photoAvailable)
          void api<ImageReply>(
            "photo",
            { visitRequestId: row.visitRequestId },
            () => version === state.detailVersion,
          )
            .then((photo) => {
              if (version === state.detailVersion && resources.alive) {
                state.photoUrl = imageUrl(photo);
                publish();
              }
            })
            .catch(() => {});
        publish();
        return;
      }
      state.cardStatus = "Preparing card preview…";
      publish();
      try {
        const preview = await api<ImageReply>(
          "preview",
          { visitRequestId: row.visitRequestId },
          () => version === state.detailVersion,
        );
        if (version !== state.detailVersion || !resources.alive) return;
        state.cardUrl = imageUrl(preview);
        state.cardStatus = "";
        publish();
      } catch (error) {
        if (version === state.detailVersion) {
          state.cardStatus =
            "Preview unavailable. Retry to check the current pass.";
          state.retryDetail = true;
          notify(error);
        }
      }
    } catch (error) {
      if (version === state.detailVersion) {
        state.detailStatus = "Visit details could not be loaded.";
        state.retryDetail = true;
        notify(error);
      }
    }
  }
  async function browserPrint(row = state.selected) {
    if (state.printBusy || state.returnBusy || !row || !canPrint(row)) return;
    state.printBusy = true;
    publish();
    try {
      if (!row.accessPassId) throw Error("Refresh the pass before printing.");
      await printDocument(
        () => pendingPrint.handoff(row.visitRequestId, row.accessPassId!),
        () => {
          row.printCount++;
          publish();
        },
      );
      notify(
        "Print dialog opened. A handoff does not confirm a physical print.",
        "success",
      );
    } catch (error) {
      if ((error as { dispatched?: boolean }).dispatched && state.location) {
        try {
          const visitDate = new Intl.DateTimeFormat("en-CA", {
              timeZone: "Asia/Kolkata",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(new Date(row.validFromUtc)),
            reply = await api<ListReply>("list", {
              locationId: state.location.locationId,
              visitDate,
              search: row.publicReference,
              status: "ALL",
            }),
            current = reply.visits.find(
              (v) => v.visitRequestId === row.visitRequestId,
            );
          if (current) Object.assign(row, current);
        } catch {}
      }
      notify(error);
    } finally {
      state.printBusy = false;
      if (resources.alive) {
        await loadVisits();
        if (state.selected) {
          const current = state.rows.find(
            (v) => v.visitRequestId === state.selected!.visitRequestId,
          );
          if (current) state.selected = current;
        }
        publish();
      }
    }
  }
  async function refreshCalendar(forceToday = false) {
    if (!state.context || (!forceToday && state.calendarBusy)) return;
    state.calendarBusy = true;
    const version = ++state.calendarVersion,
      previous = state.context.currentDate,
      selected = state.visitDate;
    publish();
    try {
      const context = await api<Context>(
        "me",
        {},
        () => version === state.calendarVersion,
      );
      if (!state.context || version !== state.calendarVersion) return;
      const office = context.locations.find(
        (v) => v.locationId === state.location?.locationId,
      );
      if (!office) {
        setContext(context);
        return;
      }
      if (
        JSON.stringify(context.locations) !==
        JSON.stringify(state.context.locations)
      )
        closeProfile();
      state.location = office;
      state.context = { ...state.context, locations: context.locations };
      setCalendar(context.currentDate);
      if (
        (forceToday || selected === previous) &&
        state.visitDate === selected
      ) {
        state.visitDate = context.currentDate;
        await loadVisits();
      }
      publish();
    } catch (error) {
      if (version === state.calendarVersion && state.context) {
        if (error instanceof ReceptionFailure && error.status === 403)
          clearProtectedVisits();
        notify(error);
      }
    } finally {
      if (version === state.calendarVersion) {
        state.calendarBusy = false;
        publish();
      }
    }
  }
  function closeReturn() {
    if (state.returnBusy) return;
    state.returnTarget = null;
    state.verifiedDevices = [];
    publish();
  }
  async function returnPass(row: Visit, devicesVerified = false) {
    if (
      state.returnBusy ||
      state.printBusy ||
      row.returnedAtUtc ||
      row.printCount < 1 ||
      !state.location
    )
      return;
    if (row.isInside) {
      notify("Record all account exits before returning this pass.");
      return;
    }
    if (!devicesVerified) {
      state.returnTarget = { row, office: state.location.locationId };
      state.verifiedDevices = [];
      state.returnStatus = "";
      publish();
      return;
    }
    const id = row.visitRequestId,
      key = id + ":" + row.accessPassId + ":" + devicesVerified;
    if (!state.returnKeys.has(key))
      state.returnKeys.set(key, crypto.randomUUID());
    const wasSelected = state.selected?.visitRequestId === id,
      selectionVersion = state.detailVersion,
      office = state.location.locationId;
    let reopenVersion: number | null = null;
    state.returnBusy = true;
    publish();
    try {
      const result = await api<{ returnedAtUtc: string }>("return", {
        visitRequestId: id,
        expectedPassId: row.accessPassId,
        clientKey: state.returnKeys.get(key),
        ...(row.deviceTypes?.length && devicesVerified
          ? { devicesVerified: true }
          : {}),
      });
      state.returnKeys.delete(key);
      state.returnTarget = null;
      Object.assign(row, {
        returnedAtUtc: result.returnedAtUtc,
        passStatus: "REVOKED",
        isInside: false,
      });
      if (
        state.selected?.visitRequestId === id &&
        state.detailVersion === selectionVersion
      ) {
        closeVisit();
        if (wasSelected) reopenVersion = state.detailVersion;
      }
      notify("Pass returned. Final building exit recorded.", "success");
    } catch (error) {
      if (state.returnTarget)
        state.returnStatus =
          "Return failed. Check all account exits and device verification, then retry.";
      notify(
        error instanceof ReceptionFailure && error.status === 409
          ? "Pass could not be returned. Record all account exits and refresh to check whether the pass changed or was already returned."
          : error,
      );
    } finally {
      state.returnBusy = false;
      if (state.context && state.location?.locationId === office) {
        await loadVisits();
        if (
          reopenVersion !== null &&
          reopenVersion === state.detailVersion &&
          state.context &&
          state.location?.locationId === office &&
          !state.accessDenied &&
          !state.selected &&
          row.returnedAtUtc
        )
          await openVisit(row);
      }
      publish();
    }
  }
  async function correctReturn() {
    const correction = state.correction;
    if (
      !correction ||
      state.returnBusy ||
      !state.correctionReason.trim() ||
      correction.office !== state.location?.locationId
    )
      return;
    const office = correction.office,
      version = state.detailVersion,
      inScope = () =>
        !!state.context &&
        !state.accessDenied &&
        state.location?.locationId === office,
      current = () => inScope() && version === state.detailVersion,
      row = correction.row,
      reason = state.correctionReason.trim(),
      key = [
        "CORRECT",
        row.visitRequestId,
        row.accessPassId,
        row.returnedAtUtc,
        reason,
      ].join(":");
    if (!state.returnKeys.has(key))
      state.returnKeys.set(key, crypto.randomUUID());
    state.returnBusy = true;
    publish();
    try {
      await api("correct-return", {
        visitRequestId: row.visitRequestId,
        expectedPassId: row.accessPassId,
        expectedReturnedAtUtc: row.returnedAtUtc,
        reason,
        clientKey: state.returnKeys.get(key),
      });
      state.returnKeys.delete(key);
      row.returnedAtUtc = null;
      row.passStatus = row.status === "APPROVED" ? "ACTIVE" : "PENDING";
      if (state.correction === correction) state.correction = null;
      if (!inScope()) return;
      await loadVisits();
      if (current()) {
        const opening = openVisit(row),
          fresh = state.detailVersion;
        await opening;
        if (inScope() && fresh === state.detailVersion)
          notify(
            "Mistaken return corrected. Original return and reason are retained in the audit trail.",
            "success",
          );
      }
    } catch (error) {
      if (current() && state.correction === correction) {
        if (error instanceof ReceptionFailure && error.status === 403) {
          clearProtectedVisits();
          notify(error);
        } else
          state.correctionStatus =
            error instanceof ReceptionFailure && error.status === 409
              ? "Correction blocked: this pass changed, has account presence or a replacement request. Refresh the entry before retrying."
              : error instanceof Error
                ? error.message
                : "Correction unavailable.";
      }
    } finally {
      state.returnBusy = false;
      publish();
    }
  }
  async function loadHistory() {
    const version = ++historyVersion,
      from = state.historyFrom,
      end = state.historyEnd;
    state.historyRows = [];
    state.historyStatus = "Loading history…";
    publish();
    if (!state.location) return;
    if (from > end) {
      state.historyStatus = "From date must be on or before To date.";
      publish();
      return;
    }
    const office = state.location.locationId;
    try {
      for (
        let day = from;
        day <= end;
        day = new Date(Date.parse(day + "T12:00:00Z") + 86400000)
          .toISOString()
          .slice(0, 10)
      ) {
        let cursor: Cursor | null = null;
        const seen = new Set<string>();
        do {
          const reply: ListReply = await api<ListReply>(
            "list",
            {
              locationId: office,
              visitDate: day,
              status: "ALL",
              ...(cursor ? { cursor } : {}),
            },
            () => version === historyVersion,
          );
          if (version !== historyVersion || !resources.alive) return;
          state.historyRows = [...state.historyRows, ...reply.visits];
          publish();
          cursor = reply.cursor;
          if (cursor) {
            const key = JSON.stringify(cursor);
            if (seen.has(key)) throw Error("History changed. Retry.");
            seen.add(key);
          }
        } while (cursor);
      }
      if (version === historyVersion) {
        state.historyStatus = state.historyRows.length
          ? state.historyRows.length + " registrations"
          : "No registrations in this range.";
        publish();
      }
    } catch (error) {
      if (version === historyVersion) {
        if (error instanceof ReceptionFailure && error.status === 403) {
          clearProtectedVisits();
          notify(error);
          return;
        }
        state.historyStatus =
          "History could not be fully loaded. " +
          (error instanceof Error ? error.message : "Unavailable");
        publish();
      }
    }
  }
  async function lookupVisits(
    openSingle = false,
    more = false,
    credential: string | null = null,
  ) {
    if (!state.context || !state.location) return;
    const query = state.lookupSearch.trim();
    if (!credential && query.length < 2) {
      clearLookup();
      return;
    }
    const office = state.location.locationId;
    if (
      more &&
      (credential ||
        !state.lookupCursor ||
        state.lookupQuery !== query ||
        state.lookupOffice !== office)
    )
      return;
    const version = ++state.lookupVersion;
    if (!more) {
      state.lookupRows = [];
      state.lookupCursor = null;
    }
    state.lookupQuery = credential ? null : query;
    state.lookupOffice = office;
    state.lookupOpen = true;
    state.lookupStatus = "Searching all registrations for this office…";
    state.lookupBusy = true;
    publish();
    try {
      const reply = await api<{ matches: Visit[]; cursor: Cursor | null }>(
        "lookup",
        {
          locationId: office,
          ...(credential ? { credential } : { search: query }),
          ...(more && state.lookupCursor ? { cursor: state.lookupCursor } : {}),
        },
        () => version === state.lookupVersion,
      );
      if (
        version !== state.lookupVersion ||
        office !== state.location?.locationId ||
        !resources.alive
      )
        return;
      state.lookupRows = [...state.lookupRows, ...reply.matches];
      state.lookupCursor = reply.cursor;
      state.lookupStatus = reply.matches.length
        ? "Matching registrations (all dates)"
        : "No matching pass in this office.";
      publish();
      if (openSingle && reply.matches.length === 1 && !reply.cursor) {
        state.lookupOpen = false;
        publish();
        await openVisit({ ...reply.matches[0], printCount: 0 });
      }
    } catch (error) {
      if (version !== state.lookupVersion) return;
      state.lookupRows = [];
      state.lookupCursor = null;
      state.lookupStatus =
        error instanceof Error ? error.message : "Lookup unavailable.";
      if (error instanceof ReceptionFailure && error.status === 403)
        clearProtectedVisits();
      publish();
    } finally {
      if (version === state.lookupVersion) {
        state.lookupBusy = false;
        publish();
      }
    }
  }
  const model = {
    ...store,
    state,
    api,
    pendingPrint,
    canPrint,
    counts,
    matchingRows,
    initializeReception,
    setContext,
    refreshCalendar,
    renderRows,
    loadVisits,
    clearProtectedVisits,
    openVisit,
    async openRecord(row: { visitRequestId: string }) {
      if (!state.location || !state.context) return;
      const office = state.location.locationId,
        version = ++state.detailVersion;
      const current = () =>
        resources.alive &&
        state.location?.locationId === office &&
        version === state.detailVersion;
      try {
        const detail = await api<Visit>(
          "detail",
          { visitRequestId: row.visitRequestId },
          current,
        );
        if (current()) await openVisit(detail, detail);
      } catch (error) {
        if (current()) notify(error);
      }
    },
    closeVisit,
    browserPrint,
    reminderState,
    returnPass,
    correctReturn,
    loadHistory,
    lookupVisits,
    clearLookup,
    closeHistory,
    closeProfile,
    setSearch(value: string) {
      resources.clearTimeout(searchTimer);
      state.search = value;
      if (state.context?.queuePaging) {
        state.listVersion++;
        state.rows = [];
        state.cursor = null;
        state.pageCounts = null;
        state.pageFilter = null;
        state.listComplete = false;
        state.listBusy = true;
      }
      publish();
      searchTimer = resources.timeout(() => void loadVisits(), 350);
    },
    setVisitDate(value: string) {
      state.visitDate = value;
      publish();
      void loadVisits();
    },
    setFilter(name: "status" | "printFilter" | "typeFilter", value: string) {
      state.renderLimit = 50;
      state[name] = value;
      if (name === "status") state.insideOnly = false;
      const pending = state.printFilter === "PENDING_RETURN",
        changed = pending !== state.pendingReturns;
      state.pendingReturns = pending;
      publish();
      if (changed || state.context?.queuePaging) void loadVisits();
    },
    clearFilters() {
      state.search = "";
      state.status = state.printFilter = state.typeFilter = "ALL";
      state.insideOnly = state.pendingReturns = false;
      state.renderLimit = 50;
      publish();
      void loadVisits();
    },
    kpi(key: "total" | "pending" | "inside" | "returns") {
      if (key === "total") {
        model.clearFilters();
        return;
      }
      state.renderLimit = 50;
      state.pendingReturns = key === "returns";
      state.printFilter = key === "returns" ? "PENDING_RETURN" : "ALL";
      state.insideOnly = key === "inside";
      state.status = key === "pending" ? "PENDING" : "ALL";
      publish();
      if (state.context?.queuePaging || key === "returns") void loadVisits();
    },
    loadMore() {
      if (state.context?.queuePaging) void loadVisits(true);
      else {
        state.renderLimit += 50;
        publish();
      }
    },
    selectOffice(value: string) {
      if (state.printBusy || state.returnBusy) return;
      clearLookup();
      state.returnTarget = null;
      closeVisit();
      closeHistory();
      closeProfile();
      state.manualOpen = false;
      state.location =
        state.context?.locations.find((v) => String(v.locationId) === value) ??
        null;
      state.pendingReturnCount = null;
      state.rows = [];
      publish();
      document.dispatchEvent(new Event("workspace-reset"));
      void loadVisits();
    },
    toggleAccount() {
      state.accountOpen = !state.accountOpen;
      publish();
    },
    closeAccount() {
      state.accountOpen = false;
      publish();
    },
    async openProfile() {
      state.accountOpen = false;
      if (!state.context || state.accessDenied) return;
      const version = ++state.profileVersion,
        context = state.context,
        office = state.location?.locationId,
        current = () =>
          version === state.profileVersion &&
          context === state.context &&
          office === state.location?.locationId &&
          !state.accessDenied;
      publish();
      try {
        const result = await api<Context>("me", {}, current);
        if (!current()) return;
        state.profileContext = result;
        state.profileOpen = true;
        publish();
      } catch (error) {
        if (current()) {
          if (error instanceof ReceptionFailure && error.status === 403)
            clearProtectedVisits();
          notify(error);
        }
      }
    },
    openManual() {
      if (state.location) {
        state.manualOpen = true;
        publish();
      }
    },
    closeManual() {
      state.manualOpen = false;
      publish();
    },
    openHistory() {
      state.historyFrom = state.historyEnd = state.context?.currentDate ?? "";
      state.historyOpen = true;
      publish();
      void loadHistory();
    },
    setHistory(name: "historyFrom" | "historyEnd", value: string) {
      state[name] = value;
      publish();
      void loadHistory();
    },
    setLookup(value: string) {
      resources.clearTimeout(lookupTimer);
      state.lookupVersion++;
      state.lookupSearch = value;
      state.lookupRows = [];
      state.lookupCursor = null;
      state.lookupOpen = value.trim().length >= 2;
      if (state.lookupOpen) {
        state.lookupStatus = "Searching all registrations for this office…";
        lookupTimer = resources.timeout(() => void lookupVisits(), 350);
      }
      publish();
    },
    submitLookup() {
      resources.clearTimeout(lookupTimer);
      void lookupVisits(true);
    },
    openCorrection(row: Visit) {
      if (!state.location) return;
      state.correction = { row, office: state.location.locationId };
      state.correctionReason = state.correctionStatus = "";
      publish();
    },
    closeCorrection() {
      if (!state.returnBusy) {
        state.correction = null;
        publish();
      }
    },
    setCorrectionReason(value: string) {
      state.correctionReason = value;
      publish();
    },
    closeReturn,
    checkDevice(code: string, checked: boolean) {
      state.verifiedDevices = checked
        ? [...new Set([...state.verifiedDevices, code])]
        : state.verifiedDevices.filter((v) => v !== code);
      publish();
    },
    confirmReturn() {
      const target = state.returnTarget;
      if (!target || target.office !== state.location?.locationId) return;
      if (
        target.row.deviceTypes?.some((v) => !state.verifiedDevices.includes(v))
      )
        return;
      void returnPass(target.row, true);
    },
    async remind() {
      const v = state.detail,
        version = state.detailVersion;
      if (!v || state.reminderBusy) return;
      if (!reminderKeys.has(v.visitRequestId))
        reminderKeys.set(v.visitRequestId, crypto.randomUUID());
      state.reminderBusy = true;
      publish();
      try {
        await api(
          "remind-host",
          {
            visitRequestId: v.visitRequestId,
            clientKey: reminderKeys.get(v.visitRequestId),
          },
          () => version === state.detailVersion,
        );
        reminderKeys.delete(v.visitRequestId);
        if (version === state.detailVersion) await reminderState(v, version);
      } catch (error) {
        if (version === state.detailVersion) {
          state.reminderBusy = false;
          notify(error);
        }
      }
    },
    dismissNotice(id: number) {
      state.notices = state.notices.filter((v) => v.id !== id);
      publish();
    },
    async logout() {
      if (state.printBusy || state.returnBusy) return;
      try {
        const response = await fetch("/api/staff/logout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": cookie("gp-staff-csrf") ?? "",
          },
          credentials: "same-origin",
          body: "{}",
        });
        if (!response.ok) throw Error("Sign out failed. Retry.");
        showLogin();
      } catch (error) {
        notify(error);
      }
    },
    start() {
      resources.start();
      resources.on(window, "pagehide", () => resetProtected());
      resources.on(window, "pageshow", (event) => {
        if ((event as PageTransitionEvent).persisted)
          void initializeReception(true);
      });
      resources.on(document, "visibilitychange", () => {
        if (!document.hidden && state.context) void refreshCalendar();
      });
      calendarTimer = resources.interval(() => {
        if (!document.hidden && state.context) {
          const today = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Kolkata",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date());
          if (today !== state.context.currentDate) void refreshCalendar();
          publish();
          if (state.detail)
            void reminderState(state.detail, state.detailVersion);
        }
      }, 60000);
      liveRefresh = new LiveRefresh(
        () => loadVisits(false, true),
        () =>
          !!state.context &&
          !state.listBusy &&
          !state.calendarBusy &&
          !state.printBusy &&
          !state.returnBusy &&
          !state.accessDenied &&
          !state.visitOpen &&
          !state.profileOpen &&
          !state.manualOpen &&
          !state.historyOpen &&
          !["INPUT", "TEXTAREA", "SELECT"].includes(
            document.activeElement?.tagName ?? "",
          ),
        20000,
        () =>
          state.context && state.location && !state.accessDenied
            ? { workspace: "RECEPTION", locationId: state.location.locationId }
            : null,
      );
      inspectForTests(
        {
          state: () => state,
          initializeReception: () => initializeReception,
          setContext: () => setContext,
          loadVisits: () => loadVisits,
          renderRows: () => renderRows,
          liveRefresh: () => liveRefresh,
          openVisit: () => openVisit,
          closeVisit: () => closeVisit,
          refreshCalendar: () => refreshCalendar,
          lookupVisits: () => lookupVisits,
        },
        resources,
      );
      if (cookie("gp-staff-csrf") || cookie("gp-reception-csrf"))
        void initializeReception();
      else showLogin();
    },
    dispose() {
      resetProtected();
      resources.clearInterval(calendarTimer);
      liveRefresh?.close();
      resources.dispose();
      store.clear();
    },
  };
  return model;
}
export type ReceptionModel = ReturnType<typeof createReceptionModel>;
