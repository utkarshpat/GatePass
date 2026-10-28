/** Email capability/decision state is independent of rendering. React subscribes to snapshots. */
export type EmailVisit = {
  visitRequestId: string;
  personName: string;
  companyName?: string;
  deviceTypes?: string[];
  publicReference: string;
  locationName: string;
  projectName?: string;
  hostName?: string;
  reason: string;
  validFromUtc: string;
  validUntilUtc: string;
  status: string;
  passStatus: string;
  canDecide: boolean;
  canCancel: boolean;
  accessPassId?: string;
  snapshotVersion: number;
  snapshotHash: string;
  photoAvailable: boolean;
};
type Snapshot = {
  host: boolean;
  visit: string;
  message: string;
  detail: EmailVisit | null;
  showLogin: boolean;
  showRequest: boolean;
  refreshing: boolean;
  busy: boolean;
  card: string | null;
  photo: string | null;
  imageBusy: boolean;
  password: string;
  email: string;
  focusRevoke: boolean;
};
class ApiFailure extends Error {
  status: number;
  timedOut: boolean;
  constructor(status = 0, timedOut = false) {
    super("Email request failed");
    this.status = status;
    this.timedOut = timedOut;
  }
}
declare const __GATEPASS_UI_TEST__: boolean;
export function createEmailModel() {
  const host = location.pathname.startsWith("/approval/"),
    visit =
      location.pathname.split("/").filter(Boolean).at(-1)?.toLowerCase() ?? "",
    fragment = new URLSearchParams(location.hash.slice(1));
  let bearer = host ? null : fragment.get("link"),
    external =
      !host &&
      (history.state?.gatepassExternal === visit ||
        (() => {
          try {
            return sessionStorage.getItem("gp-ext-" + visit) === "1";
          } catch {
            return false;
          }
        })()),
    revokeLink = !host && bearer ? fragment.get("revoke") : null,
    revokeIntent = !host && fragment.has("revoke");
  fragment.delete("link");
  fragment.delete("revoke");
  let view: Snapshot = {
    host,
    visit,
    message: "Loading…",
    detail: null,
    showLogin: false,
    showRequest: false,
    refreshing: false,
    busy: false,
    card: null,
    photo: null,
    imageBusy: false,
    password: "",
    email: "",
    focusRevoke: false,
  };
  const subscribers = new Set<() => void>(),
    keys = new Map<string, string>(),
    requests = new Set<AbortController>();
  let current: EmailVisit | null = null,
    version = 0,
    poll: number | undefined,
    validityTimer: number | undefined,
    suspended = false,
    disposed = false,
    retryDelay = 0,
    retryUntil: number | null = null;
  const emit = (patch: Partial<Snapshot>) => {
    if (disposed) return;
    view = { ...view, ...patch };
    for (const callback of subscribers) callback();
  };
  const csrf = () =>
    document.cookie
      .split("; ")
      .find((c) => c.startsWith("gp-dev-csrf="))
      ?.slice("gp-dev-csrf=".length) ?? "";
  const api = async (path: string, body: unknown) => {
    const controller = new AbortController();
    requests.add(controller);
    const timer = window.setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf() },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new ApiFailure(response.status);
      return (await response.json()) as Record<string, any>;
    } catch (error) {
      if (controller.signal.aborted) throw new ApiFailure(0, true);
      throw error;
    } finally {
      clearTimeout(timer);
      requests.delete(controller);
    }
  };
  const message = (error: unknown) => {
    const e = error as ApiFailure;
    emit({
      message: e.timedOut
        ? "Request timed out. Use Refresh to check the latest status before retrying."
        : e.status === 401
          ? "Sign in to continue."
          : e.status === 403
            ? "This request is unavailable or its link has expired."
            : e.status === 409
              ? "This request changed or was already decided. Refresh to check its status."
              : "Request unavailable. Please try again.",
    });
  };
  const clearMedia = () => {
    if (view.card) URL.revokeObjectURL(view.card);
    emit({ card: null, photo: null });
  };
  const invalidate = () => {
    clearTimeout(validityTimer);
    validityTimer = undefined;
    current = null;
    clearMedia();
    emit({ detail: null, focusRevoke: false });
  };
  const path = (action: string) =>
      "/api/email/" +
      (external ? "external/" + visit : host ? "host" : "request") +
      "/" +
      action,
    payload = () => (external ? {} : { visitRequestId: visit });
  const downloadable = (v: EmailVisit) =>
    !host &&
    Date.parse(v.validUntilUtc) > Date.now() &&
    ["PENDING", "APPROVED"].includes(v.status) &&
    ["PENDING", "ACTIVE"].includes(v.passStatus);
  const revocable = (v: EmailVisit) =>
    !host &&
    v.canCancel &&
    !!v.accessPassId &&
    Date.parse(v.validUntilUtc) > Date.now() &&
    ["PENDING", "APPROVED"].includes(v.status) &&
    ["PENDING", "ACTIVE"].includes(v.passStatus);
  const render = (v: EmailVisit) => {
    current = v;
    const expired = Date.parse(v.validUntilUtc) <= Date.now();
    emit({
      detail: v,
      showLogin: false,
      showRequest: true,
      message: expired
        ? "Expired"
        : v.passStatus === "REVOKED"
          ? "Revoked"
          : ({
              PENDING: "Approval pending",
              APPROVED: "Approved",
              DENIED: "Declined",
              CANCELLED: "Cancelled",
            }[v.status] ?? "Request unavailable"),
      focusRevoke: revokeIntent && revocable(v),
    });
    if (revokeIntent && revocable(v)) revokeIntent = false;
  };
  const showPass = async (download = false, expected = version) => {
    if (!current || !downloadable(current) || (download && view.busy)) return;
    emit({ imageBusy: true });
    try {
      const r = await api(path("image"), payload());
      if (expected !== version || !current || !downloadable(current)) return;
      if (
        r.mimeType !== "image/png" ||
        typeof r.imageBase64 !== "string" ||
        r.imageBase64.length > 7340032
      )
        throw new Error();
      const bytes = Uint8Array.from(atob(r.imageBase64), (x) =>
        x.charCodeAt(0),
      );
      if (view.card) URL.revokeObjectURL(view.card);
      const card = URL.createObjectURL(
        new Blob([bytes], { type: "image/png" }),
      );
      emit({ card });
      if (download) {
        const a = document.createElement("a");
        a.href = card;
        a.download = "GatePass-" + visit + ".png";
        a.click();
      }
    } catch (error) {
      if (expected === version) {
        clearMedia();
        if (download) message(error);
      }
    } finally {
      if (expected === version) emit({ imageBusy: false });
    }
  };
  const watchValidity = (v: EmailVisit, expected: number) => {
    clearTimeout(validityTimer);
    validityTimer = undefined;
    if (suspended || disposed || expected !== version || current !== v) return;
    const remaining = Date.parse(v.validUntilUtc) - Date.now();
    if (!Number.isFinite(remaining)) return;
    if (remaining <= 0) {
      clearTimeout(poll);
      poll = undefined;
      retryDelay = 0;
      clearMedia();
      render(v);
      return;
    }
    validityTimer = window.setTimeout(
      () => watchValidity(v, expected),
      Math.min(remaining, 2147483000),
    );
  };
  const schedulePoll = (expected = version) => {
    clearTimeout(poll);
    poll = undefined;
    if (suspended || disposed || expected !== version) return;
    let delay = retryDelay;
    if (current) {
      if (!["PENDING", "ACTIVE"].includes(current.passStatus)) return;
      const remaining = Date.parse(current.validUntilUtc) - Date.now();
      if (!Number.isFinite(remaining)) return;
      if (remaining <= 0) {
        watchValidity(current, expected);
        return;
      }
      delay = 30000;
    } else if (!delay || (retryUntil !== null && Date.now() >= retryUntil))
      return;
    poll = window.setTimeout(() => {
      if (
        expected !== version ||
        suspended ||
        disposed ||
        view.busy ||
        document.hidden
      )
        return;
      if (!current && retryUntil !== null && Date.now() >= retryUntil) {
        retryDelay = 0;
        return;
      }
      void load();
    }, delay);
  };
  async function load() {
    if (suspended || disposed) return;
    const expected = ++version;
    clearTimeout(poll);
    invalidate();
    emit({ refreshing: true, showRequest: false });
    try {
      const v = (await api(path("detail"), payload())) as EmailVisit;
      if (expected !== version) return;
      if (
        typeof v.visitRequestId !== "string" ||
        v.visitRequestId.toLowerCase() !== visit
      )
        throw new Error();
      retryDelay = 0;
      retryUntil = Number.isFinite(Date.parse(v.validUntilUtc))
        ? Date.parse(v.validUntilUtc)
        : null;
      render(v);
      watchValidity(v, expected);
      if (downloadable(v)) void showPass(false, expected);
      if (host && v.photoAvailable) {
        try {
          const p = await api("/api/email/host/photo", {
            visitRequestId: visit,
          });
          if (expected !== version || Date.parse(v.validUntilUtc) <= Date.now())
            return;
          if (
            ["image/png", "image/jpeg", "image/webp"].includes(p.mimeType) &&
            typeof p.imageBase64 === "string" &&
            p.imageBase64.length <= 7340032
          )
            emit({ photo: "data:" + p.mimeType + ";base64," + p.imageBase64 });
        } catch {}
      }
    } catch (error) {
      if (expected !== version) return;
      invalidate();
      const e = error as ApiFailure;
      retryDelay =
        !e.status ||
        e.status === 408 ||
        e.status === 429 ||
        (e.status >= 500 && e.status <= 599)
          ? Math.min(retryDelay ? retryDelay * 2 : 5000, 30000)
          : 0;
      emit({ showRequest: false });
      if ([401, 403].includes(e.status) && !external)
        emit({
          showLogin: true,
          message:
            e.status === 403
              ? host
                ? "Sign in with the assigned host’s email."
                : "Sign in with the request owner’s email."
              : "Sign in to continue.",
        });
      else {
        emit({ showLogin: false });
        message(error);
      }
    } finally {
      if (expected === version) {
        emit({ refreshing: false });
        schedulePoll(expected);
      }
    }
  }
  async function refresh() {
    if (view.busy || disposed) return;
    if (bearer) {
      emit({ refreshing: true });
      try {
        const r = await api("/api/email/external/session", {
          link: bearer,
          ...(revokeLink ? { revokeLink } : {}),
        });
        if (r.visitRequestId?.toLowerCase() !== visit) throw new Error();
        external = true;
        bearer = revokeLink = null;
        try {
          sessionStorage.setItem("gp-ext-" + visit, "1");
        } catch {}
        history.replaceState(
          { gatepassExternal: visit },
          "",
          location.pathname,
        );
      } catch (error) {
        invalidate();
        emit({ showRequest: false, showLogin: false, refreshing: false });
        message(error);
        return;
      }
    }
    await load();
  }
  const signIn = async () => {
    if (view.busy) return;
    emit({ busy: true });
    try {
      const request = api("/api/dev/sso/login", {
        email: view.email.trim(),
        password: view.password,
      });
      emit({ password: "" });
      await request;
      await load();
    } catch (error) {
      const e = error as ApiFailure;
      if (e.timedOut) message(error);
      else
        emit({
          message:
            e.status === 401
              ? "Email or password is incorrect."
              : "Sign-in unavailable. Please try again.",
        });
    } finally {
      emit({ password: "", busy: false });
      schedulePoll();
    }
  };
  const decide = async (decision: "APPROVED" | "DENIED") => {
    if (
      view.busy ||
      !current?.canDecide ||
      Date.parse(current.validUntilUtc) <= Date.now()
    )
      return;
    emit({ busy: true, refreshing: true, message: "Saving…" });
    const binding = current.snapshotHash + "|" + decision;
    if (!keys.has(binding)) keys.set(binding, crypto.randomUUID());
    try {
      await api("/api/email/host/decide", {
        visitRequestId: visit,
        clientKey: keys.get(binding),
        snapshotVersion: current.snapshotVersion,
        snapshotHash: current.snapshotHash,
        decision,
      });
      await load();
    } catch (error) {
      message(error);
    } finally {
      emit({ busy: false, refreshing: false });
      schedulePoll();
    }
  };
  const revoke = async () => {
    if (
      view.busy ||
      !current ||
      !revocable(current) ||
      !window.confirm(
        "Revoke this pass because you did not request it? It will stop working for entry. This cannot be undone.",
      )
    )
      return;
    const pass = current.accessPassId,
      binding = "REVOKE|" + pass;
    if (!keys.has(binding)) keys.set(binding, crypto.randomUUID());
    emit({ busy: true, refreshing: true, message: "Revoking pass…" });
    version++;
    clearTimeout(poll);
    invalidate();
    try {
      await api(path("revoke"), {
        ...payload(),
        clientKey: keys.get(binding),
        expectedPassId: pass,
        confirm: true,
      });
      await load();
    } catch (error) {
      message(error);
    } finally {
      emit({ busy: false, refreshing: false });
      schedulePoll();
    }
  };
  const hide = () => {
    suspended = true;
    version++;
    clearTimeout(poll);
    retryDelay = 0;
    retryUntil = null;
    bearer = revokeLink = null;
    emit({ password: "" });
    invalidate();
  };
  const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        suspended = false;
        if (!host && !external && location.hash) {
          location.reload();
          return;
        }
        void refresh();
      }
    },
    onVisible = () => {
      if (!document.hidden && !view.busy) void refresh();
    },
    onHash = () => {
      if (!host) {
        const next = new URLSearchParams(location.hash.slice(1));
        if (next.has("link") || next.get("revoke") === "confirm")
          location.reload();
      }
    };
  let debugCleanup = () => {};
  return {
    getSnapshot: () => view,
    subscribe: (fn: () => void) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    setEmail: (email: string) => emit({ email }),
    setPassword: (password: string) => emit({ password }),
    refresh,
    signIn,
    decide,
    revoke,
    download: () => showPass(true),
    downloadable,
    revocable,
    start: () => {
      disposed = false;
      if (!bearer && location.hash)
        history.replaceState(history.state, "", location.pathname);
      window.addEventListener("pagehide", hide);
      window.addEventListener("pageshow", onShow);
      window.addEventListener("hashchange", onHash);
      document.addEventListener("visibilitychange", onVisible);
      if (typeof __GATEPASS_UI_TEST__ !== "undefined" && __GATEPASS_UI_TEST__) {
        const getters = {
          fragment: () => fragment,
          bearer: () => bearer,
          revokeLink: () => revokeLink,
        };
        for (const [key, get] of Object.entries(getters))
          Object.defineProperty(globalThis, key, { configurable: true, get });
        debugCleanup = () => {
          for (const key of Object.keys(getters))
            Reflect.deleteProperty(globalThis, key);
        };
      }
      void refresh();
    },
    dispose: () => {
      hide();
      disposed = true;
      for (const request of requests) request.abort();
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("hashchange", onHash);
      document.removeEventListener("visibilitychange", onVisible);
      debugCleanup();
      subscribers.clear();
    },
  };
}
