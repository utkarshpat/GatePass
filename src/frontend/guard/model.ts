import type { PageConfig } from "../types.ts";
import { createStore, Resources, inspectForTests } from "../shared/model.ts";
import { LiveRefresh } from "../shared/liveRefresh.ts";
import {
  initialLanguage,
  languageModes,
  translator,
  type LanguageMode,
} from "./language.tsx";
import type { Office, Duty, Visit, Cursor, Photo } from "./types.ts";
export const outcomes: Record<string, string> = {
  VALID: "Access allowed",
  PENDING: "Approval pending",
  DENIED: "Access denied",
  EXPIRED: "Pass expired",
  REVOKED: "Pass revoked",
  NOT_YET_VALID: "Pass is not valid yet",
  NOT_AUTHORIZED: "Access not allowed",
  CANCELLED: "Visit cancelled",
  NOT_AVAILABLE: "Pass unavailable for this area",
};
export class GuardFailure extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}
type Reminder = {
  eligible: boolean;
  mailStatus: string;
  nextReminderAtUtc: string;
};
type Notice = { id: number; message: string; kind: "error" | "success" };
type QueueResponse = {
  visitors: Visit[];
  hasMore?: boolean;
  total: number;
  cursor: Cursor | null;
};
type Decoder = {
  reset: () => void;
  decodeFromStream: (
    stream: MediaStream,
    video: HTMLVideoElement,
    callback: (result: { getText: () => string } | null) => void,
  ) => Promise<void>;
};
type DecoderLibrary = { BrowserQRCodeReader: new () => Decoder };
declare global {
  interface Window {
    ZXing?: DecoderLibrary;
  }
}
export function createGuardModel(
  config: PageConfig,
  getVideo: () => HTMLVideoElement | null,
) {
  const resources = new Resources(),
    state = {
      view: "recent",
      queue: "EXPECTED" as "EXPECTED" | "INSIDE",
      hasMore: false,
      profileVersion: 0,
      recentRows: [] as Visit[],
      office: null as Office | null,
      offices: [] as Office[],
      projects: [] as unknown[],
      duties: [] as Duty[],
      duty: null as Duty | null,
      contextVersion: 0,
      initializeVersion: 0,
      passVersion: 0,
      recentVersion: 0,
      visit: null as Visit | null,
      passOutcome: undefined as string | undefined,
      passActionsFresh: false,
      credential: null as string | null,
      busy: false,
      photoUrl: null as string | null,
      passDuty: null as Duty | null,
      scanDuty: null as Duty | null,
      pending: new Map<string, string>(),
      cameraVersion: 0,
      cursor: null as Cursor | null,
      queueTotal: 0,
      renderLimit: 24,
      queuePaging: false,
      liveDenied: false,
      language: initialLanguage(),
      displayName: "",
      search: "",
      dashboard: false,
      pageStatus: "Loading assignments…",
      retryContext: false,
      loadingRows: false,
      recentStatus: "",
      emptyVisible: false,
      passOpen: false,
      passStatus: "",
      passAllowed: false,
      actionStatus: "",
      profileOpen: false,
      profileAssignments: [] as { office: Office; duties: Duty[] }[],
      profileUnavailable: false,
      scannerOpen: false,
      cameraStatus: "",
      stream: null as MediaStream | null,
      allocationOpen: false,
      allocationDuties: [] as Duty[],
      allocationValue: "",
      reconcileOpen: false,
      reconcileReason: "",
      accountOpen: false,
      languageOpen: false,
      reminderVisible: false,
      reminderBusy: false,
      reminderStatus: "",
      notices: [] as Notice[],
    };
  const store = createStore({ ...state }),
    publish = () => {
      if (resources.alive) store.update({ ...state });
    },
    t = (key: string, values?: Record<string, string | number>) =>
      translator(state.language).t(key, values),
    bilingual = (key: string) => translator(state.language).bilingual(key);
  let noticeId = 0,
    passExpiry: number | undefined,
    searchTimer: number | undefined,
    liveRefresh: LiveRefresh | undefined,
    decoder: Decoder | null = null,
    decoderLoad: Promise<DecoderLibrary> | null = null,
    allocationResolve: ((duty: Duty | null) => void) | null = null,
    recentRunning = false,
    recentPending: {
      append: boolean;
      quiet: boolean;
      resolve: () => void;
    } | null = null;
  const reminderKeys = new Map<string, string>(),
    csrf = () =>
      document.cookie
        .split("; ")
        .find((v) => v.startsWith("gp-staff-csrf="))
        ?.split("=")[1];
  const notify = (error: unknown, kind: "error" | "success" = "error") => {
    state.notices = [
      {
        id: ++noticeId,
        message:
          typeof error === "string"
            ? error
            : error instanceof Error
              ? error.message
              : t("Unable to complete the request. Please retry."),
        kind,
      },
    ];
    publish();
  };
  async function api<T>(
    action: string,
    body: unknown = {},
    staff = false,
    current = () => true,
  ): Promise<T> {
    const context = state.contextVersion,
      initialization = state.initializeVersion,
      office = state.office,
      identity = csrf(),
      controller = resources.controller(),
      timer = window.setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(
        "/api/" + (staff ? "staff/" : "guard/") + action,
        {
          method: "POST",
          credentials: "same-origin",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": identity ?? "",
          },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        if (
          response.status === 401 &&
          resources.alive &&
          current() &&
          context === state.contextVersion &&
          initialization === state.initializeVersion &&
          office === state.office &&
          identity === csrf()
        ) {
          stopCamera();
          location.replace("/");
        }
        throw new GuardFailure(
          t(
            (
              {
                400: "Check the details.",
                401: "Sign in again to continue.",
                403: "This pass or area is outside your current access.",
                409: "Pass state changed. Refresh the pass before continuing.",
                429: "Please wait before trying again.",
              } as Record<number, string>
            )[response.status] ??
              "Unable to complete the request. Please retry.",
          ),
          response.status,
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof GuardFailure) throw error;
      throw new GuardFailure(
        t(
          controller.signal.aborted
            ? "Request timed out. Please retry."
            : "Connection lost. Please retry.",
        ),
      );
    } finally {
      window.clearTimeout(timer);
      resources.release(controller);
    }
  }
  function dutyContext(duty = state.passDuty ?? state.duty) {
    if (!duty || !["PROJECT", "COMMON"].includes(duty.kind) || !state.office)
      throw new GuardFailure(t("No active access assignments."));
    return {
      locationId: state.office.locationId,
      dutyKind: duty.kind,
      dutyId: duty.dutyId,
    };
  }
  function allocationLabel(duty: Duty) {
    return (
      duty.name +
      " · " +
      bilingual(duty.kind === "COMMON" ? "Common area" : "Account")
    );
  }
  function stopCamera() {
    state.cameraVersion++;
    decoder?.reset();
    decoder = null;
    for (const track of state.stream?.getTracks() ?? []) track.stop();
    state.stream = null;
    const video = getVideo();
    if (video) video.srcObject = null;
    publish();
  }
  function closeScanner() {
    stopCamera();
    state.scannerOpen = false;
    publish();
  }
  function loadQrDecoder() {
    if (window.ZXing?.BrowserQRCodeReader) return Promise.resolve(window.ZXing);
    if (decoderLoad) return decoderLoad;
    decoderLoad = new Promise<DecoderLibrary>((resolve, reject) => {
      const script = document.createElement("script");
      script.nonce =
        (document.getElementById("app-config") as HTMLScriptElement | null)
          ?.nonce ?? "";
      script.src = config.qrDecoderUrl;
      script.async = true;
      const failed = () => {
          window.clearTimeout(timer);
          script.onload = script.onerror = null;
          script.remove();
          decoderLoad = null;
          reject(
            new Error("QR decoder unavailable. Retry or search by pass ID."),
          );
        },
        timer = window.setTimeout(failed, 15000);
      script.onerror = failed;
      script.onload = () => {
        window.clearTimeout(timer);
        if (!window.ZXing?.BrowserQRCodeReader) {
          failed();
          return;
        }
        resolve(window.ZXing);
      };
      resources.own(() => {
        window.clearTimeout(timer);
        script.onload = script.onerror = null;
        script.remove();
      });
      document.head.append(script);
    });
    return decoderLoad;
  }
  async function startCamera() {
    if (state.busy || !state.office) return;
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) {
      state.cameraStatus =
        "Camera unavailable. Use the pass or request ID to find a pass.";
      publish();
      return;
    }
    const version = state.cameraVersion;
    state.cameraStatus = "Opening camera…";
    publish();
    try {
      const library = await loadQrDecoder();
      if (version !== state.cameraVersion || !resources.alive) return;
      const reader = new library.BrowserQRCodeReader();
      decoder = reader;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
      if (version !== state.cameraVersion || !resources.alive) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      state.stream = stream;
      state.cameraStatus = "Keep the QR inside the camera view.";
      publish();
      const video = getVideo();
      if (!video) {
        stopCamera();
        return;
      }
      video.srcObject = stream;
      await reader.decodeFromStream(stream, video, (result) => {
        if (!result || version !== state.cameraVersion || state.busy) return;
        const credential = result.getText();
        stopCamera();
        if (!/^[A-Za-z0-9_-]{43}$/u.test(credential)) {
          state.cameraStatus = "This is not a GatePass QR.";
          notify(t(state.cameraStatus));
          return;
        }
        void verify(credential);
      });
      if (version !== state.cameraVersion) reader.reset();
    } catch {
      if (version === state.cameraVersion && resources.alive) {
        stopCamera();
        state.cameraStatus =
          "Camera could not start. Check browser camera permission or use the pass or request ID.";
        publish();
      }
    }
  }
  function releasePhoto() {
    if (state.photoUrl) URL.revokeObjectURL(state.photoUrl);
    state.photoUrl = null;
  }
  function closeAllocationChoice() {
    const resolve = allocationResolve;
    allocationResolve = null;
    state.allocationOpen = false;
    state.allocationDuties = [];
    resolve?.(null);
    publish();
  }
  function chooseAllocation(duties: Duty[]) {
    closeAllocationChoice();
    if (!duties.length) return Promise.resolve(null);
    if (duties.length === 1) return Promise.resolve(duties[0]);
    state.allocationOpen = true;
    state.allocationDuties = duties;
    state.allocationValue = "";
    publish();
    return new Promise<Duty | null>((resolve) => {
      allocationResolve = resolve;
    });
  }
  function closePass(force = false) {
    if (state.busy && !force) return;
    resources.clearTimeout(passExpiry);
    closeAllocationChoice();
    state.passDuty = state.scanDuty = null;
    state.passVersion++;
    state.visit = null;
    state.passActionsFresh = false;
    state.credential = null;
    state.pending.clear();
    releasePhoto();
    state.passOpen = false;
    publish();
  }
  function clearDutyWorkspace() {
    clearHistoryPhotos();
    state.contextVersion++;
    state.recentVersion++;
    state.profileVersion++;
    closeScanner();
    closePass(true);
    state.recentRows = [];
    state.cursor = null;
    state.queueTotal = 0;
    state.hasMore = false;
    state.loadingRows = false;
    state.profileOpen = state.reconcileOpen = false;
    state.profileAssignments = [];
    state.emptyVisible = true;
    state.recentStatus = state.queuePaging ? "0 / 0" : "0";
    document.dispatchEvent(new Event("workspace-reset"));
    publish();
  }
  function openPass() {
    resources.clearTimeout(passExpiry);
    state.reminderVisible = false;
    state.reminderStatus = "";
    closeScanner();
    state.passVersion++;
    state.visit = null;
    state.passActionsFresh = false;
    state.credential = null;
    state.pending.clear();
    releasePhoto();
    state.passStatus = "Verifying pass…";
    state.passAllowed = false;
    state.actionStatus = "";
    state.passOpen = true;
    publish();
    return state.passVersion;
  }
  function paintPassAccess(v: Visit, outcome?: string) {
    const expired = Date.parse(v.validUntilUtc) <= Date.now(),
      effective =
        v.passStatus === "REVOKED"
          ? "REVOKED"
          : v.status === "CANCELLED"
            ? "CANCELLED"
            : v.status === "DENIED"
              ? "DENIED"
              : expired
                ? "EXPIRED"
                : !state.passActionsFresh
                  ? "NOT_AVAILABLE"
                  : (outcome ??
                    (v.status === "PENDING"
                      ? "PENDING"
                      : Date.parse(v.validFromUtc) > Date.now()
                        ? "NOT_YET_VALID"
                        : v.canEnter || v.canExit
                          ? "VALID"
                          : "NOT_AUTHORIZED"));
    state.passStatus =
      !state.passActionsFresh && !expired
        ? "Refresh for the latest pass state."
        : v.verificationOnly && !expired
          ? v.commonAccessAllowed
            ? "Identity verified"
            : "Access not allowed"
          : (outcomes[effective] ?? "Entry unavailable");
    state.passAllowed =
      state.passActionsFresh &&
      !expired &&
      !!(v.commonAccessAllowed || v.canEnter || v.canExit);
    publish();
  }
  function watchPassExpiry(v: Visit, outcome?: string) {
    resources.clearTimeout(passExpiry);
    const remaining = Date.parse(v.validUntilUtc) - Date.now(),
      version = state.passVersion;
    if (!Number.isFinite(remaining) || remaining <= 0) return;
    passExpiry = resources.timeout(
      () => {
        if (
          version !== state.passVersion ||
          state.visit !== v ||
          !state.passOpen
        )
          return;
        paintPassAccess(v, outcome);
        watchPassExpiry(v, outcome);
      },
      Math.min(remaining, 2147483000),
    );
  }
  function renderPass(v: Visit, outcome?: string) {
    state.visit = v;
    state.passActionsFresh = true;
    state.passOutcome = outcome;
    void reminderState(v, state.passVersion);
    paintPassAccess(v, outcome);
    watchPassExpiry(v, outcome);
    if (v.canReconcileExit && !v.canExit && !state.actionStatus)
      state.actionStatus = t("Exit requires an authorised reconciliation.");
    publish();
  }
  async function photo(v: Visit, version: number) {
    if (!v.photoAvailable) return;
    try {
      const r = await api<Photo>(
        "photo",
        { ...dutyContext(), visitRequestId: v.visitRequestId },
        false,
        () => version === state.passVersion,
      );
      if (version !== state.passVersion || !resources.alive) return;
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(r.mimeType) ||
        typeof r.imageBase64 !== "string" ||
        r.imageBase64.length > 7340032
      )
        throw Error();
      releasePhoto();
      state.photoUrl = URL.createObjectURL(
        new Blob(
          [Uint8Array.from(atob(r.imageBase64), (x) => x.charCodeAt(0))],
          { type: r.mimeType },
        ),
      );
      publish();
    } catch {
      if (version === state.passVersion) {
        state.actionStatus = t("Photo unavailable. Refresh to retry.");
        publish();
      }
    }
  }
  async function verify(
    credential: string,
    duty = state.scanDuty ?? state.passDuty ?? state.duty,
  ) {
    if (!duty || duty.kind === "ALL") return;
    const version = openPass();
    state.passDuty = duty;
    state.credential = credential;
    try {
      const r = await api<{ visit: Visit | null; outcome: string }>(
        "verify",
        { ...dutyContext(), credential, correlationId: crypto.randomUUID() },
        false,
        () => version === state.passVersion,
      );
      if (version !== state.passVersion || !resources.alive) return;
      if (!r.visit) {
        state.passStatus = outcomes.NOT_AVAILABLE;
        state.credential = null;
        publish();
        return;
      }
      renderPass(r.visit, r.outcome);
      void photo(r.visit, version);
    } catch (error) {
      if (version === state.passVersion) {
        state.passStatus = "Verification unavailable.";
        notify(error);
      }
    } finally {
      if (resources.alive) void recent();
    }
  }
  async function detail(
    v: Pick<Visit, "visitRequestId" | "allocations">,
    duty?: Duty | null,
  ) {
    const context = state.contextVersion,
      selected = state.duty;
    if (!duty)
      duty = await chooseAllocation(
        selected?.kind === "ALL"
          ? (v.allocations ?? [])
          : [selected].filter((v): v is Duty => !!v),
      );
    if (!duty || context !== state.contextVersion || selected !== state.duty)
      return;
    const version = openPass();
    state.passDuty = duty;
    try {
      const r = await api<Visit>(
        "detail",
        { ...dutyContext(), visitRequestId: v.visitRequestId },
        false,
        () => version === state.passVersion,
      );
      if (version !== state.passVersion || !resources.alive) return;
      renderPass(r);
      void photo(r, version);
    } catch (error) {
      if (version === state.passVersion) {
        state.passStatus = "Pass unavailable.";
        notify(error);
      }
    }
  }
  function refreshPass() {
    if (state.busy) return;
    if (state.credential) return verify(state.credential, state.passDuty);
    if (state.visit) return detail(state.visit, state.passDuty);
  }
  async function movement(
    eventType: "ENTRY" | "EXIT",
    method?: string,
    reason?: string,
  ) {
    const v = state.visit;
    if (state.busy || !v || !state.passActionsFresh) return;
    if (eventType === "ENTRY" && Date.parse(v.validUntilUtc) <= Date.now()) {
      paintPassAccess(v, state.passOutcome);
      return;
    }
    if (
      !(method === "RECONCILE"
        ? v.canReconcileExit
        : eventType === "ENTRY"
          ? v.canEnter
          : v.canExit) ||
      !state.office
    )
      return;
    const version = state.passVersion,
      payload = {
        visitRequestId: v.visitRequestId,
        accessPassId: v.accessPassId,
        locationId: state.office.locationId,
        dutyKind: "PROJECT",
        dutyId: v.dutyId,
        eventType,
        entryMethod: method || (state.credential ? "SCAN" : "MANUAL"),
        ...(method === "RECONCILE"
          ? { reason }
          : state.credential
            ? { credential: state.credential }
            : {}),
      },
      key = [
        v.visitRequestId,
        v.accessPassId,
        v.projectLocationId ?? null,
        eventType,
        payload.entryMethod,
        reason ?? "",
      ].join("|");
    if (!state.pending.has(key)) state.pending.set(key, crypto.randomUUID());
    state.busy = true;
    state.actionStatus = t(
      eventType === "ENTRY" ? "Checking in…" : "Checking out…",
    );
    publish();
    try {
      await api(
        "movement",
        { ...payload, clientKey: state.pending.get(key) },
        false,
        () => version === state.passVersion,
      );
      if (version !== state.passVersion || !resources.alive) return;
      state.pending.delete(key);
      state.passActionsFresh = false;
      paintPassAccess(v, state.passOutcome);
      state.actionStatus = t(
        eventType === "ENTRY"
          ? "Checked in successfully."
          : "Checked out successfully.",
      );
      notify(state.actionStatus, "success");
      try {
        if (state.credential) {
          const r = await api<{ visit: Visit | null; outcome: string }>(
            "verify",
            {
              ...dutyContext(),
              credential: state.credential,
              correlationId: crypto.randomUUID(),
            },
            false,
            () => version === state.passVersion,
          );
          if (version === state.passVersion) {
            if (r.visit) renderPass(r.visit, r.outcome);
            else {
              state.visit = null;
              state.passActionsFresh = false;
              state.passStatus = outcomes.NOT_AVAILABLE;
            }
          }
        } else {
          const r = await api<Visit>(
            "detail",
            { ...dutyContext(), visitRequestId: v.visitRequestId },
            false,
            () => version === state.passVersion,
          );
          if (version === state.passVersion) renderPass(r);
        }
      } catch {
        if (version === state.passVersion)
          state.actionStatus += " " + t("Refresh for the latest pass state.");
      }
      void recent();
    } catch (error) {
      if (version === state.passVersion) {
        state.actionStatus = t(
          error instanceof GuardFailure && error.status === 409
            ? "Refresh this pass to check its current state."
            : "Action not confirmed. Retry to check the same operation.",
        );
        if (error instanceof GuardFailure && error.status === 409) {
          state.passActionsFresh = false;
          paintPassAccess(v, state.passOutcome);
        }
        notify(error);
      }
    } finally {
      state.busy = false;
      publish();
    }
  }
  // Thumbnail state is keyed by authorization context and version; no photo DOM is retained.
  let historyVersion = 0,
    photoBusy = 0;
  const photoJobs: {
      row: Visit;
      duty: Duty;
      version: number;
      resolve: (url: string | null) => void;
    }[] = [],
    photoCache = new Map<string, { url: string; until: number }>(),
    photoUrls = new Set<string>();
  function clearHistoryPhotos(preserve = false) {
    historyVersion++;
    for (const job of photoJobs.splice(0)) job.resolve(null);
    for (const [key, item] of photoCache)
      if (!preserve || item.until <= Date.now()) {
        URL.revokeObjectURL(item.url);
        photoUrls.delete(item.url);
        photoCache.delete(key);
      }
    const retained = new Set([...photoCache.values()].map((v) => v.url));
    for (const url of photoUrls)
      if (!retained.has(url)) {
        URL.revokeObjectURL(url);
        photoUrls.delete(url);
      }
  }
  function thumbnail(row: Visit) {
    const duty = state.duty?.kind === "ALL" ? row.allocations?.[0] : state.duty;
    if (!duty || !row.photoAvailable) return Promise.resolve(null);
    return new Promise<string | null>((resolve) => {
      photoJobs.push({ row, duty, version: historyVersion, resolve });
      void drainPhotos();
    });
  }
  async function drainPhotos() {
    if (photoBusy >= 2) return;
    photoBusy++;
    try {
      while (photoJobs.length) {
        const job = photoJobs.shift()!;
        if (job.version !== historyVersion) {
          job.resolve(null);
          continue;
        }
        const scope = dutyContext(job.duty),
          key = job.row.photoVersion
            ? JSON.stringify([
                scope,
                job.row.visitRequestId,
                job.row.photoVersion,
              ])
            : null,
          cached = key ? photoCache.get(key) : null;
        if (cached && cached.until > Date.now()) {
          job.resolve(cached.url);
          continue;
        }
        try {
          const r = await api<Photo>(
            "photo",
            {
              ...scope,
              visitRequestId: job.row.visitRequestId,
              thumbnail: true,
            },
            false,
            () => job.version === historyVersion,
          );
          if (job.version !== historyVersion || !resources.alive) {
            job.resolve(null);
            continue;
          }
          if (
            r.mimeType !== "image/jpeg" ||
            typeof r.imageBase64 !== "string" ||
            r.imageBase64.length > 90000
          ) {
            job.resolve(null);
            continue;
          }
          const url = URL.createObjectURL(
            new Blob(
              [Uint8Array.from(atob(r.imageBase64), (c) => c.charCodeAt(0))],
              { type: r.mimeType },
            ),
          );
          photoUrls.add(url);
          if (key && r.photoVersion === job.row.photoVersion) {
            photoCache.set(key, { url, until: Date.now() + 60000 });
            while (photoCache.size > 128) {
              const first = photoCache.keys().next().value!;
              const item = photoCache.get(first)!;
              URL.revokeObjectURL(item.url);
              photoUrls.delete(item.url);
              photoCache.delete(first);
            }
          }
          job.resolve(url);
        } catch {
          job.resolve(null);
        }
      }
    } finally {
      photoBusy--;
    }
  }
  function renderRecent() {
    state.emptyVisible = !state.recentRows.length;
    const length = Math.min(state.renderLimit, state.recentRows.length);
    state.recentStatus = state.queuePaging
      ? length + " / " + state.queueTotal
      : length === state.recentRows.length
        ? String(length)
        : length + " / " + state.recentRows.length;
    publish();
  }
  function recent(append = false, quiet = false) {
    state.recentVersion++;
    return new Promise<void>((resolve) => {
      recentPending?.resolve();
      recentPending = { append, quiet, resolve };
      if (!recentRunning) void drainRecent();
    });
  }
  async function drainRecent() {
    recentRunning = true;
    try {
      while (recentPending) {
        const job = recentPending;
        recentPending = null;
        try {
          await recentNow(job.append, job.quiet);
        } finally {
          job.resolve();
        }
      }
    } finally {
      recentRunning = false;
    }
  }
  async function allocated(queue: string, search: string, version: number) {
    const duties = state.duties.filter(
        (d) => queue !== "INSIDE" || d.kind === "PROJECT",
      ),
      results = new Array<{ duty: Duty; rows: Visit[] }>(duties.length);
    let next = 0,
      failed = false;
    await Promise.all(
      Array.from({ length: Math.min(2, duties.length) }, async () => {
        while (
          next < duties.length &&
          !failed &&
          version === state.recentVersion
        ) {
          const index = next++,
            duty = duties[index],
            rows: Visit[] = [];
          let offset = 0;
          try {
            while (version === state.recentVersion) {
              const r = await api<QueueResponse>(
                "visitors",
                { ...dutyContext(duty), queue, search, offset },
                false,
                () => version === state.recentVersion,
              );
              if (version !== state.recentVersion) return;
              if (r.hasMore && !r.visitors.length)
                throw new Error(t("Visitors unavailable. Please retry."));
              rows.push(...r.visitors);
              if (!r.hasMore) break;
              offset += r.visitors.length;
            }
            results[index] = { duty, rows };
          } catch (error) {
            failed = true;
            throw error;
          }
        }
      }),
    );
    const merged = new Map<string, Visit>();
    for (const result of results) {
      if (!result) continue;
      for (const row of result.rows) {
        const key = row.visitRequestId.toLowerCase(),
          existing = merged.get(key);
        if (existing) {
          if (
            !existing.allocations!.some(
              (d) =>
                d.kind === result.duty.kind && d.dutyId === result.duty.dutyId,
            )
          )
            existing.allocations!.push(result.duty);
          if (
            result.duty.kind === "PROJECT" &&
            existing.allocations![0].kind === "COMMON"
          ) {
            Object.assign(existing, row);
            existing.allocations!.sort(
              (a, b) =>
                (a.kind === "PROJECT" ? 0 : 1) - (b.kind === "PROJECT" ? 0 : 1),
            );
          }
        } else merged.set(key, { ...row, allocations: [result.duty] });
      }
    }
    return [...merged.values()].sort(
      (a, b) =>
        a.personName.localeCompare(b.personName) ||
        a.visitRequestId.localeCompare(b.visitRequestId),
    );
  }
  async function recentNow(append: boolean, quiet: boolean) {
    if (
      !state.office ||
      !state.duty ||
      (state.queuePaging && append && !state.cursor)
    )
      return;
    const version = ++state.recentVersion,
      selected = state.duty,
      search = state.search.trim().replace(/^#/u, ""),
      queue = state.queue,
      target = quiet ? Math.max(24, state.recentRows.length) : 24,
      rows = append ? [...state.recentRows] : [];
    let cursor = append ? state.cursor : null,
      total = 0;
    if (!quiet) {
      state.renderLimit = 24;
      state.liveDenied = false;
    }
    state.loadingRows = true;
    if (!append && !quiet) {
      clearHistoryPhotos(true);
      state.recentRows = [];
      state.cursor = null;
      state.queueTotal = 0;
      state.hasMore = false;
      state.emptyVisible = false;
    }
    publish();
    try {
      if (state.queuePaging) {
        const filter = {
            locationId: state.office.locationId,
            dutyKind: selected.kind,
            ...(selected.kind === "ALL" ? {} : { dutyId: selected.dutyId }),
            queue,
            search,
          },
          seen = new Set<string>();
        do {
          const r = await api<QueueResponse>(
            "queue",
            {
              ...filter,
              ...(cursor ? { cursor } : {}),
              ...(quiet
                ? { limit: Math.min(240, Math.max(24, target - rows.length)) }
                : {}),
            },
            false,
            () => version === state.recentVersion,
          );
          if (version !== state.recentVersion || !resources.alive) return;
          const known = new Set(rows.map((v) => v.visitRequestId));
          for (const row of r.visitors)
            if (!known.has(row.visitRequestId)) {
              known.add(row.visitRequestId);
              rows.push(row);
            }
          total = r.total;
          cursor = r.cursor;
          if (cursor) {
            const key = JSON.stringify(cursor);
            if (seen.has(key))
              throw Error(t("Visitors unavailable. Please retry."));
            seen.add(key);
          }
        } while (quiet && cursor && rows.length < target);
      } else if (selected.kind === "ALL") {
        rows.push(...(await allocated(queue, search, version)));
      } else {
        let offset = append ? state.recentRows.length : 0,
          more = false;
        do {
          const r = await api<QueueResponse>(
            "visitors",
            { ...dutyContext(selected), queue, search, offset },
            false,
            () => version === state.recentVersion,
          );
          if (version !== state.recentVersion || !resources.alive) return;
          if (r.hasMore && !r.visitors.length)
            throw Error(t("Visitors unavailable. Please retry."));
          const known = new Set(rows.map((v) => v.visitRequestId));
          for (const row of r.visitors)
            if (!known.has(row.visitRequestId)) {
              known.add(row.visitRequestId);
              rows.push(row);
            }
          offset += r.visitors.length;
          more = !!r.hasMore;
        } while (more);
      }
      if (version !== state.recentVersion || !resources.alive) return;
      state.recentRows = rows;
      state.cursor = cursor;
      state.queueTotal = total;
      state.hasMore = !!cursor;
      if (state.queuePaging) state.renderLimit = rows.length;
      renderRecent();
    } catch (error) {
      if (version === state.recentVersion) {
        if (error instanceof GuardFailure && error.status === 403) {
          state.liveDenied = true;
          clearDutyWorkspace();
          state.retryContext = true;
        }
        state.recentStatus = t("Visitors unavailable. Please retry.");
        if (!quiet) notify(error);
      }
    } finally {
      if (version === state.recentVersion) {
        state.loadingRows = false;
        publish();
      }
    }
  }
  function renderProjectFilter() {
    const selected =
      state.duty?.kind === "ALL"
        ? "ALL"
        : state.duty
          ? state.duty.kind + ":" + state.duty.dutyId
          : state.duties[0]
            ? state.duties[0].kind + ":" + state.duties[0].dutyId
            : null;
    state.duty =
      selected === "ALL" && state.duties.length
        ? { kind: "ALL", dutyId: "ALL", name: "All allocations" }
        : (state.duties.find((d) => d.kind + ":" + d.dutyId === selected) ??
          null);
    publish();
  }
  async function loadOffice() {
    state.liveDenied = false;
    closeAllocationChoice();
    state.passDuty = state.scanDuty = null;
    stopCamera();
    const version = ++state.contextVersion;
    resources.clearTimeout(searchTimer);
    state.recentVersion++;
    state.recentRows = [];
    state.cursor = null;
    state.queueTotal = 0;
    state.duty = null;
    state.duties = [];
    clearHistoryPhotos();
    state.dashboard = false;
    state.pageStatus = "Loading assignments…";
    state.retryContext = false;
    publish();
    if (!state.office) return;
    try {
      const r = await api<{ duties: Duty[] }>(
        "duties",
        { locationId: state.office.locationId },
        false,
        () => version === state.contextVersion,
      );
      if (version !== state.contextVersion || !resources.alive) return;
      state.duties = r.duties;
      renderProjectFilter();
      state.pageStatus = r.duties.length ? "" : "No active access assignments.";
      state.dashboard = true;
      publish();
      void recent();
    } catch (error) {
      if (version === state.contextVersion) {
        state.pageStatus = "Assignments unavailable.";
        state.retryContext = true;
        notify(error);
      }
    }
  }
  function clearGuardContext() {
    clearHistoryPhotos();
    resources.clearTimeout(searchTimer);
    state.contextVersion++;
    state.recentVersion++;
    state.profileVersion++;
    state.liveDenied = true;
    closeScanner();
    closePass(true);
    state.accountOpen = state.languageOpen = false;
    state.notices = [];
    state.office = null;
    state.offices = [];
    state.duties = [];
    state.duty = null;
    state.recentRows = [];
    state.cursor = null;
    state.queueTotal = 0;
    state.hasMore = false;
    state.loadingRows = false;
    state.dashboard = false;
    state.displayName = "";
    state.profileOpen = state.reconcileOpen = false;
    state.profileAssignments = [];
    renderRecent();
    document.dispatchEvent(new Event("workspace-reset"));
    publish();
  }
  async function initialize() {
    const version = ++state.initializeVersion;
    clearGuardContext();
    state.pageStatus = "Loading assignments…";
    publish();
    try {
      const r = await api<{
        queuePaging?: boolean;
        locations: Office[];
        displayName: string;
      }>("context", {}, false, () => version === state.initializeVersion);
      if (version !== state.initializeVersion || !resources.alive) return;
      state.queuePaging = r.queuePaging === true;
      state.offices = r.locations;
      state.office = r.locations[0] ?? null;
      state.displayName = r.displayName;
      publish();
      await loadOffice();
    } catch (error) {
      if (version === state.initializeVersion) {
        state.pageStatus = "Guard access unavailable.";
        state.retryContext = true;
        notify(error);
      }
    }
  }
  async function loadProfile() {
    const version = ++state.profileVersion;
    state.profileAssignments = [];
    state.profileUnavailable = false;
    publish();
    try {
      for (const office of state.offices) {
        const r = await api<{ duties: Duty[] }>(
          "duties",
          { locationId: office.locationId },
          false,
          () => version === state.profileVersion && state.profileOpen,
        );
        if (version !== state.profileVersion || !resources.alive) return;
        state.profileAssignments = [
          ...state.profileAssignments,
          { office, duties: r.duties },
        ];
        publish();
      }
    } catch (error) {
      if (version === state.profileVersion) {
        state.profileUnavailable = true;
        notify(error);
      }
    }
  }
  async function reminderState(v: Visit, version: number) {
    state.reminderVisible = false;
    publish();
    if (
      (state.passDuty ?? state.duty)?.kind !== "PROJECT" ||
      v.requestType === "DIGITAL_ID" ||
      v.status !== "PENDING" ||
      Date.parse(v.validUntilUtc) <= Date.now()
    )
      return;
    try {
      const r = await api<Reminder>(
        "remind-host",
        { ...dutyContext(), visitRequestId: v.visitRequestId },
        false,
        () => version === state.passVersion,
      );
      if (version !== state.passVersion || !resources.alive) return;
      state.reminderVisible = r.eligible;
      state.reminderBusy =
        !r.eligible ||
        r.mailStatus === "QUEUED" ||
        Date.parse(r.nextReminderAtUtc) > Date.now();
      state.reminderStatus =
        t("Host email") +
        ": " +
        t(
          r.mailStatus === "SENT"
            ? "Sent (delivery not confirmed)"
            : r.mailStatus === "FAILED"
              ? "Failed"
              : r.mailStatus === "QUEUED"
                ? "Queued"
                : "Cancelled",
        );
      publish();
    } catch {
      if (version === state.passVersion) {
        state.reminderVisible = true;
        state.reminderBusy = false;
        state.reminderStatus = t("Email status unavailable.");
        publish();
      }
    }
  }
  async function remind() {
    const v = state.visit,
      version = state.passVersion;
    if (!v || state.reminderBusy) return;
    const id = v.visitRequestId;
    if (!reminderKeys.has(id)) reminderKeys.set(id, crypto.randomUUID());
    state.reminderBusy = true;
    publish();
    try {
      await api(
        "remind-host",
        {
          ...dutyContext(),
          visitRequestId: id,
          clientKey: reminderKeys.get(id),
        },
        false,
        () => version === state.passVersion,
      );
      reminderKeys.delete(id);
      if (version === state.passVersion) await reminderState(v, version);
    } catch (error) {
      if (version === state.passVersion) {
        state.reminderBusy = false;
        notify(error);
      }
    }
  }
  async function refreshDuties() {
    const version = state.contextVersion;
    if (!state.office) return;
    try {
      const r = await api<{ duties: Duty[] }>(
        "duties",
        { locationId: state.office.locationId },
        false,
        () => version === state.contextVersion,
      );
      if (version !== state.contextVersion || !resources.alive) return;
      if (JSON.stringify(r.duties) !== JSON.stringify(state.duties)) {
        clearDutyWorkspace();
        state.duties = r.duties;
        renderProjectFilter();
        if (!state.duty) {
          state.recentRows = [];
          state.cursor = null;
          state.queueTotal = 0;
          renderRecent();
          return;
        }
      }
      await recent(false, true);
    } catch (error) {
      if (
        version === state.contextVersion &&
        error instanceof GuardFailure &&
        error.status === 403
      ) {
        state.liveDenied = true;
        state.duties = [];
        state.duty = null;
        clearDutyWorkspace();
        state.retryContext = true;
        publish();
      }
    }
  }
  const model = {
    ...store,
    state,
    api,
    t,
    bilingual,
    allocationLabel,
    dutyContext,
    thumbnail,
    initialize,
    loadOffice,
    loadProfile,
    clearGuardContext,
    clearDutyWorkspace,
    recent,
    renderRecent,
    renderPass,
    detail,
    verify,
    refreshPass,
    movement,
    loadQrDecoder,
    closePass,
    closeScanner,
    closeAllocationChoice,
    chooseAllocation,
    reminderState,
    remind,
    setSearch(value: string) {
      clearHistoryPhotos(true);
      resources.clearTimeout(searchTimer);
      state.search = value;
      state.recentVersion++;
      state.recentRows = [];
      state.cursor = null;
      state.queueTotal = 0;
      state.hasMore = false;
      renderRecent();
      state.emptyVisible = false;
      publish();
      searchTimer = resources.timeout(() => void recent(), 250);
    },
    submitSearch() {
      resources.clearTimeout(searchTimer);
      void recent();
    },
    setQueue(value: "EXPECTED" | "INSIDE") {
      resources.clearTimeout(searchTimer);
      state.queue = value;
      publish();
      void recent();
    },
    loadMore() {
      if (state.queuePaging) void recent(true);
      else {
        state.renderLimit += 24;
        renderRecent();
      }
    },
    selectOffice(value: string) {
      if (state.busy) return;
      closePass();
      state.office =
        state.offices.find((v) => String(v.locationId) === value) ?? null;
      void loadOffice();
    },
    selectDuty(value: string) {
      if (state.busy) return;
      clearDutyWorkspace();
      state.duty =
        value === "ALL" && state.duties.length
          ? { kind: "ALL", dutyId: "ALL", name: "All allocations" }
          : (state.duties.find((d) => d.kind + ":" + d.dutyId === value) ??
            null);
      publish();
      void recent();
    },
    setLanguage(value: string) {
      if (!languageModes.includes(value as LanguageMode)) return;
      state.language = value as LanguageMode;
      try {
        localStorage.setItem("gp-guard-language", value);
      } catch {}
      state.notices = [];
      renderProjectFilter();
      if (state.visit) renderPass(state.visit, state.passOutcome);
      publish();
    },
    toggleLanguage() {
      state.languageOpen = !state.languageOpen;
      publish();
    },
    setAccount(open: boolean) {
      state.accountOpen = open;
      if (!open) state.languageOpen = false;
      publish();
    },
    openProfile() {
      state.accountOpen = state.languageOpen = false;
      state.profileOpen = true;
      publish();
      void loadProfile();
    },
    closeProfile() {
      state.profileVersion++;
      state.profileOpen = false;
      publish();
    },
    async scan() {
      if (state.busy || !state.office) return;
      const context = state.contextVersion,
        selected = state.duty,
        duty = await chooseAllocation(
          selected?.kind === "ALL"
            ? state.duties
            : [selected].filter((v): v is Duty => !!v),
        );
      if (!duty || context !== state.contextVersion || selected !== state.duty)
        return;
      state.scanDuty = duty;
      state.scannerOpen = true;
      publish();
      void startCamera();
    },
    setAllocation(value: string) {
      state.allocationValue = value;
      publish();
    },
    confirmAllocation() {
      const duty = state.allocationDuties.find(
        (d) => d.kind + ":" + d.dutyId === state.allocationValue,
      );
      if (!duty) return;
      const resolve = allocationResolve;
      allocationResolve = null;
      state.allocationOpen = false;
      state.allocationDuties = [];
      publish();
      resolve?.(duty);
    },
    openReconcile() {
      if (!state.busy && state.visit?.canReconcileExit) {
        state.reconcileReason = "";
        state.reconcileOpen = true;
        publish();
      }
    },
    setReconcile(value: string) {
      state.reconcileReason = value;
      publish();
    },
    closeReconcile() {
      state.reconcileOpen = false;
      publish();
    },
    confirmReconcile() {
      const reason = state.reconcileReason.trim();
      if (!reason) return;
      state.reconcileOpen = false;
      publish();
      void movement("EXIT", "RECONCILE", reason);
    },
    dismissNotice(id: number) {
      state.notices = state.notices.filter((v) => v.id !== id);
      publish();
    },
    async logout() {
      if (state.busy) return;
      state.accountOpen = state.languageOpen = false;
      stopCamera();
      try {
        await api("logout", {}, true);
        if (resources.alive) location.replace("/");
      } catch (error) {
        notify(error);
      }
    },
    start() {
      resources.start();
      const hide = () => {
          state.initializeVersion++;
          clearGuardContext();
        },
        resume = () => {
          if (state.visit && state.passOpen) {
            paintPassAccess(state.visit, state.passOutcome);
            watchPassExpiry(state.visit, state.passOutcome);
          }
        };
      resources.on(window, "pagehide", hide);
      resources.on(window, "pageshow", (event) => {
        if ((event as PageTransitionEvent).persisted) void initialize();
      });
      resources.on(window, "focus", resume);
      resources.on(document, "visibilitychange", () =>
        document.hidden ? stopCamera() : resume(),
      );
      resources.on(window, "popstate", () => {
        if (!state.busy) {
          closeScanner();
          closePass();
        }
      });
      liveRefresh = new LiveRefresh(
        refreshDuties,
        () =>
          !!state.office &&
          state.dashboard &&
          !state.busy &&
          !state.liveDenied &&
          !state.loadingRows &&
          !state.passOpen &&
          !state.profileOpen &&
          !state.scannerOpen &&
          !["INPUT", "TEXTAREA", "SELECT"].includes(
            document.activeElement?.tagName ?? "",
          ),
        20000,
        () =>
          state.office && !state.liveDenied && state.dashboard
            ? { workspace: "GUARD", locationId: state.office.locationId }
            : null,
      );
      inspectForTests(
        {
          state: () => state,
          initialize: () => initialize,
          clearGuardContext: () => clearGuardContext,
          recent: () => recent,
          renderRecent: () => renderRecent,
          renderPass: () => renderPass,
          loadOffice: () => loadOffice,
          liveRefresh: () => liveRefresh,
          historyCache: () => photoCache,
          loadQrDecoder: () => loadQrDecoder,
          verify: () => verify,
          detail: () => detail,
          refreshPass: () => refreshPass,
          closePass: () => closePass,
          i18n: () => ({
            get mode() {
              return state.language;
            },
            t,
            pair: (key: string) => translator(state.language).pair(key),
            set: model.setLanguage,
          }),
          api: () => api,
        },
        resources,
      );
      void initialize();
    },
    dispose() {
      state.initializeVersion++;
      state.contextVersion++;
      state.passVersion++;
      state.recentVersion++;
      state.profileVersion++;
      clearHistoryPhotos();
      closeAllocationChoice();
      stopCamera();
      releasePhoto();
      liveRefresh?.close();
      recentPending?.resolve();
      recentPending = null;
      resources.dispose();
      store.clear();
    },
  };
  return model;
}
export type GuardModel = ReturnType<typeof createGuardModel>;
