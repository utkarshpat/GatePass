import { createStore, Resources, inspectForTests } from "../shared/model.ts";
import { LiveRefresh } from "../shared/liveRefresh.ts";
import type { PageConfig } from "../types.ts";
import type {
  Failure,
  Office,
  Project,
  Scope,
  Summary,
  View,
} from "./types.ts";
import { shiftDay } from "./types.ts";
import { Accounts } from "./accounts.ts";
import { Staff } from "./staff.ts";
import { Roster } from "./roster.ts";
import { Register } from "./register.ts";
import { Records } from "./records.ts";

/** Native React administration state. Browser effects are owned and generation guarded. */
export class AdminModel {
  resources = new Resources();
  private store = createStore({ revision: 0 });
  subscribe = this.store.subscribe;
  getSnapshot = this.store.getSnapshot;
  config: PageConfig;
  version = 0;
  initializeVersion = 0;
  requests: Record<string, number> = {};
  get profileVersion() {
    return this.requests.profile ?? 0;
  }
  fields: Record<string, string> = {};
  checks: Record<string, boolean> = {};
  capabilities: Record<string, string[]> = {};
  attempts = new Map<string, { fingerprint: string; key: string }>();
  displayName = "";
  offices: Office[] = [];
  office: Office | null = null;
  scope: Scope | null = null;
  pair: Project | null = null;
  officeWide = true;
  view: View = "overview";
  allowed: Partial<Record<View, boolean>> = {};
  writing = false;
  refreshing = false;
  loading = false;
  status = "Loading administration…";
  notices: {
    id: number;
    message: string;
    kind: "success" | "error" | "info";
  }[] = [];
  dialogs: Record<string, boolean> = {};
  accountOpen = false;
  summary: Summary | null = null;
  summaryBusy = false;
  summaryRange = "";
  profile: {
    name: string;
    scope: Scope;
    offices: Office[];
    projects: Project[];
  } | null = null;
  confirm: {
    title: string;
    action: string;
    payload: Record<string, unknown>;
    after: () => Promise<void>;
  } | null = null;
  confirmStatus = "";
  accounts: Accounts;
  staff: Staff;
  roster: Roster;
  register: Register;
  records: Records;
  liveRefresh: LiveRefresh | null = null;
  // Additional modules register native state operations without owning page DOM.
  loaders: Partial<Record<View, (quiet?: boolean) => Promise<void>>> = {};
  resets = new Set<() => void>();
  constructor(config: PageConfig) {
    this.config = config;
    const requested = new URLSearchParams(location.search).get('view');
    if(requested && ['overview','projects','staff','assignments','offices','reports','audit'].includes(requested))this.view=requested as View;
    this.accounts = new Accounts(this);
    this.staff = new Staff(this);
    this.roster = new Roster(this);
    this.register = new Register(this);
    this.records = new Records(this);
    this.loaders.projects = () =>
      this.roster.projectTab === "groups"
        ? this.roster.loadGroups()
        : this.accounts.show();
    this.loaders.overview = (quiet) => this.loadSummary(quiet);
    this.loaders.staff = () =>
      this.staff.subject ? this.staff.loadRoles() : Promise.resolve();
  }
  publish = () => {
    if (this.resources.alive)
      this.store.update((v) => ({ revision: v.revision + 1 }));
  };
  field = (id: string) => this.fields[id] ?? "";
  set = (id: string, value: string) => {
    if (!this.writing) {
      this.fields[id] = value;
      this.publish();
    }
  };
  check = (id: string, value: boolean) => {
    if (!this.writing) {
      this.checks[id] = value;
      this.publish();
    }
  };
  token(kind: string) {
    const value = (this.requests[kind] ?? 0) + 1;
    this.requests[kind] = value;
    return () => this.resources.alive && this.requests[kind] === value;
  }
  current() {
    const version = this.version;
    return () => this.resources.alive && this.version === version;
  }
  notice = (
    message: string,
    kind: "success" | "error" | "info" = "success",
  ) => {
    this.notices = [{ id: Date.now() + Math.random(), message, kind }];
    this.publish();
  };
  dismiss = (id: number) => {
    this.notices = this.notices.filter((v) => v.id !== id);
    this.publish();
  };
  failure(error: unknown) {
    const e = error as Failure;
    if (e.status === 403) {
      this.clear();
      this.status =
        "Your permissions changed or this scope is unavailable. Refresh to reload authorized access.";
    }
    this.notice(
      e.message || "Unable to complete the request. Please retry.",
      "error",
    );
  }
  async api<T>(
    action: string,
    body: Record<string, unknown> = {},
    staff = false,
    current = this.current(),
  ): Promise<T> {
    const controller = this.resources.controller();
    const timer = this.resources.timeout(() => controller.abort(), 30000);
    try {
      const csrf =
        document.cookie
          .split("; ")
          .find((v) => v.startsWith("gp-staff-csrf="))
          ?.split("=")[1] ?? "";
      const response = await fetch(
        "/api/" + (staff ? "staff/" : "admin/") + action,
        {
          method: "POST",
          credentials: "same-origin",
          signal: controller.signal,
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        if (response.status === 401 && current()) location.replace("/");
        throw Object.assign(
          new Error(
            (
              {
                400: "Check the details.",
                401: "Sign in again to continue.",
                403: "Your access to this scope is unavailable.",
                409: "This assignment changed. Refresh and try again.",
                429: "Please wait before trying again.",
              } as Record<number, string>
            )[response.status] ??
              "Unable to complete the request. Please retry.",
          ),
          { status: response.status },
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      if ((error as Failure).status) throw error;
      throw new Error(
        controller.signal.aborted
          ? "Request timed out. Refresh to check the result before retrying."
          : "Connection lost. Please retry.",
      );
    } finally {
      this.resources.clearTimeout(timer);
      this.resources.release(controller);
    }
  }
  scopeBody() {
    return {
      locationId: this.office!.locationId,
      ...(this.pair ? { projectLocationId: this.pair.projectLocationId } : {}),
    };
  }
  key(name: string, payload: unknown) {
    const fingerprint = JSON.stringify(payload);
    if (this.attempts.get(name)?.fingerprint !== fingerprint)
      this.attempts.set(name, { fingerprint, key: crypto.randomUUID() });
    return this.attempts.get(name)!.key;
  }
  async write(
    action: string,
    payload: Record<string, unknown>,
    key: string,
    after: () => Promise<void>,
    onError?: (error: Failure) => void,
  ) {
    if (this.writing || !this.scope) return false;
    const current = this.current(),
      clientKey = this.key(key, payload);
    this.writing = true;
    this.publish();
    try {
      await this.api(action, { ...payload, clientKey }, false, current);
      if (!current()) return false;
      this.attempts.delete(key);
      await after();
      return true;
    } catch (error) {
      if (current()) {
        onError?.(error as Failure);
        this.failure(error);
      }
      return false;
    } finally {
      this.writing = false;
      this.publish();
    }
  }
  open(id: string) {
    if (!this.writing) {
      this.dialogs[id] = true;
      this.publish();
    }
  }
  close(id: string) {
    if (this.writing) return;
    this.dialogs[id] = false;
    if (id === "admin-profile-dialog") {
      this.token("profile");
      this.profile = null;
    }
    if (id === "lead-dialog") this.accounts.closeLeads();
    if (id === "account-host-dialog") this.accounts.closeHosts();
    if (id === "common-dialog") this.accounts.closeCommon();
    if (id === "add-staff-dialog") this.staff.clearSetup();
    this.publish();
  }
  clear() {
    this.version++;
    this.initializeVersion++;
    this.requests = {};
    this.scope = null;
    this.pair = null;
    this.allowed = {};
    this.summary = null;
    this.summaryBusy = false;
    this.profile = null;
    this.confirm = null;
    this.dialogs = {};
    this.accountOpen = false;
    this.attempts.clear();
    this.accounts.clear();
    this.staff.clear();
    for (const reset of this.resets) reset();
    this.publish();
  }
  async initialize() {
    this.clear();
    this.loading = true;
    const generation = this.initializeVersion,
      current = () =>
        this.resources.alive && this.initializeVersion === generation;
    try {
      const result = await this.api<{
        displayName: string;
        locations: Office[];
      }>("context", {}, false, current);
      if (!current()) return;
      this.displayName = result.displayName;
      this.offices = result.locations;
      this.office = result.locations[0];
      if (!this.office) throw Error("No authorized office.");
      this.fields = {};
      this.checks = {};
      this.capabilities = {};
      await this.prepare();
    } catch (error) {
      if (current()) {
        this.status = "Accounts unavailable. Use Refresh to retry.";
        this.failure(error);
      }
    } finally {
      if (current()) {
        this.loading = false;
        this.publish();
      }
    }
  }
  async prepare() {
    if (!this.office) return;
    const previous = this.pair,
      sameOffice =
        previous && this.accounts.loadedOffice === this.office.locationId;
    this.clear();
    this.accounts.loadedOffice = this.office.locationId;
    const current = this.current();
    this.loading = true;
    this.status = "Loading authorized scope…";
    this.fields["project-search"] = "";
    this.publish();
    try {
      const result = await this.api<{
        projects: Project[];
        cursor: string | null;
      }>("projects", { locationId: this.office.locationId }, false, current);
      if (!current()) return;
      this.accounts.projects = result.projects;
      this.accounts.cursor = result.cursor;
      let scope: Scope;
      try {
        scope = await this.api<Scope>(
          "scope",
          { locationId: this.office.locationId },
          false,
          current,
        );
        this.officeWide = true;
      } catch (error) {
        if (
          (error as Failure).status !== 403 ||
          !result.projects.length ||
          !current()
        )
          throw error;
        this.pair = result.projects[0];
        this.officeWide = false;
        scope = await this.api<Scope>(
          "scope",
          this.scopeBody(),
          false,
          current,
        );
      }
      if (!current()) return;
      if (
        sameOffice &&
        previous.projectLocationId !== this.pair?.projectLocationId
      ) {
        this.pair =
          result.projects.find(
            (p) => p.projectLocationId === previous.projectLocationId,
          ) ?? previous;
        scope = await this.api<Scope>(
          "scope",
          this.scopeBody(),
          false,
          current,
        );
      }
      if (!current()) return;
      this.scope = scope;
      for (const id of [
        "overview-from",
        "overview-to",
        "report-from",
        "report-to",
        "audit-from",
        "audit-to",
      ])
        if (!this.fields[id]) this.fields[id] = scope.currentDate;
      this.applyScope();
      await this.show(this.view);
    } catch (error) {
      if (current()) {
        this.clear();
        this.status = "Administration could not load. Use Refresh to retry.";
        this.failure(error);
      }
    } finally {
      if (current()) {
        this.loading = false;
        this.publish();
      }
    }
  }
  applyScope() {
    if (!this.scope) return;
    const s = this.scope;
    if (!s.canManageProjectGroups) this.roster.projectTab = "catalogue";
    this.allowed = {
      overview: s.canReport,
      projects: true,
      staff: s.canManageRoles,
      assignments: s.canAssignGuards,
      offices: true,
      reports: s.canReadVisits,
      audit: s.canAudit,
    };
    if (!this.allowed[this.view]) this.view = "projects";
    this.staff.resetCapabilities();
    this.status = "";
    this.publish();
  }
  async selectOffice(id: string) {
    if (this.writing) return;
    this.office = this.offices.find((o) => String(o.locationId) === id) ?? null;
    await this.prepare();
  }
  async selectProject(id: string) {
    if (this.writing || this.loading || !this.scope) return;
    if (id === "__MORE__") {
      await this.accounts.catalogue(true);
      return;
    }
    const pair =
      this.accounts.known().find((p) => p.projectLocationId === id) ?? null;
    if ((!pair && !this.officeWide) || (id && !pair)) return;
    const version = ++this.version,
      current = () => this.resources.alive && this.version === version;
    this.scope = null;
    this.allowed = {};
    this.dialogs = {};
    this.profile = null;
    this.summary = null;
    this.accounts.closeLeads();
    this.accounts.closeHosts();
    this.accounts.closeCommon();
    this.accounts.fullProjects = null;
    this.accounts.areas = [];
    this.accounts.areaAssignments = [];
    this.accounts.areasLoaded = false;
    this.staff.clear();
    for (const reset of this.resets) reset();
    this.pair = pair;
    this.loading = true;
    this.publish();
    try {
      const scope = await this.api<Scope>(
        "scope",
        this.scopeBody(),
        false,
        current,
      );
      if (!current()) return;
      this.scope = scope;
      this.applyScope();
      await this.show(this.view);
    } catch (error) {
      if (current()) this.failure(error);
    } finally {
      if (current()) {
        this.loading = false;
        this.publish();
      }
    }
  }
  async show(view: View) {
    if (!this.scope || !this.allowed[view]) return;
    this.view = view;
    if (view !== "projects") this.accounts.pausePreviews();
    this.status = "";
    this.publish();
    await this.loaders[view]?.();
  }
  async refresh() {
    if (
      this.refreshing ||
      this.writing ||
      this.register.loading ||
      this.register.exporting
    )
      return;
    this.refreshing = true;
    this.profile = null;
    this.dialogs["admin-profile-dialog"] = false;
    this.token("profile");
    this.publish();
    try {
      if (!this.scope) await this.initialize();
      else await this.refreshVisible();
    } finally {
      this.refreshing = false;
      this.publish();
    }
  }
  async refreshVisible() {
    if (!this.scope) return;
    const currentScope = this.scope,
      version = this.version,
      view = this.view,
      current = () =>
        this.resources.alive && this.version === version && this.view === view;
    try {
      const fresh = await this.api<Scope>(
        "scope",
        this.scopeBody(),
        false,
        current,
      );
      if (!current()) return;
      if (JSON.stringify(fresh) !== JSON.stringify(currentScope)) {
        await this.prepare();
        return;
      }
      if (view === "projects") {
        if (this.roster.projectTab === "groups")
          await this.roster.loadGroups(true);
        else await this.accounts.refresh();
      } else if (view === "audit") await this.records.loadAudit();
      else await this.loaders[view]?.(true);
    } catch (error) {
      if (current()) this.failure(error);
    }
  }
  async loadSummary(quiet = false) {
    if (!this.scope) return;
    const from = this.field("overview-from"),
      to = this.field("overview-to"),
      currentScope = this.current(),
      request = this.token("summary"),
      current = () => currentScope() && request();
    if (
      !from ||
      !to ||
      from > to ||
      Date.parse(to) - Date.parse(from) > 30 * 86400000
    ) {
      this.notice("Choose a date range of up to 31 days.", "error");
      return;
    }
    this.summaryBusy = true;
    if (!quiet) this.summary = null;
    this.publish();
    try {
      const result = await this.api<Summary>(
        "summary-range",
        { ...this.scopeBody(), from, to },
        false,
        current,
      );
      if (!current()) return;
      this.summary = result;
      this.summaryRange = from === to ? from : from + " → " + to;
    } catch (error) {
      if (current()) this.failure(error);
    } finally {
      if (current()) {
        this.summaryBusy = false;
        this.publish();
      }
    }
  }
  setRange(days: number) {
    if (!this.scope || this.writing) return;
    this.fields["overview-to"] = this.scope.currentDate;
    this.fields["overview-from"] = shiftDay(this.scope.currentDate, 1 - days);
    void this.loadSummary();
  }
  async openProfile() {
    if (!this.scope || this.writing) return;
    this.accountOpen = false;
    this.publish();
    const scope = this.scopeBody(),
      valid = this.current(),
      request = this.token("profile"),
      current = () => valid() && request();
    try {
      const context = await this.api<{
        displayName: string;
        locations: Office[];
      }>("context", {}, false, current);
      if (!current()) return;
      const result = await this.api<Scope>("scope", scope, false, current);
      if (!current()) return;
      this.profile = {
        name: this.displayName,
        scope: result,
        offices: context.locations,
        projects: this.accounts.projects,
      };
      this.dialogs["admin-profile-dialog"] = true;
      this.publish();
    } catch (error) {
      if (current()) this.failure(error);
    }
  }
  ask(
    title: string,
    action: string,
    payload: Record<string, unknown>,
    after: () => Promise<void>,
  ) {
    if (this.writing || !this.scope) return;
    this.confirm = { title, action, payload, after };
    this.confirmStatus = "";
    this.fields["admin-confirm-reason"] = "";
    this.attempts.delete("confirm");
    this.open("admin-confirm-dialog");
  }
  async saveConfirmation() {
    const c = this.confirm,
      reason = this.field("admin-confirm-reason").trim();
    if (!c || !reason) return;
    await this.write(
      c.action,
      { ...c.payload, reason },
      "confirm",
      async () => {
        this.dialogs["admin-confirm-dialog"] = false;
        await c.after();
        this.notice("Change saved.");
      },
      (e) => {
        this.confirmStatus = e.message;
      },
    );
  }
  async logout() {
    if (this.writing) return;
    try {
      await this.api("logout", {}, true);
      location.replace("/");
    } catch (error) {
      this.failure(error);
    }
  }
  start = () => {
    this.resources.start();
    inspectForTests(
      {
        state: () => this.accounts,
        consoleState: () => this,
        roster: () => this.roster,
        registerState: () => this.register,
        liveRefresh: () => this.liveRefresh,
        leadPreview: () => ({
          active: this.accounts.previewActive,
          queue: this.accounts.previewQueue,
        }),
        initialize: () => this.initialize.bind(this),
        clearConsole: () => this.clear.bind(this),
        refreshConsole: () => this.refresh.bind(this),
        refreshVisibleAdmin: () => this.refreshVisible.bind(this),
        showAdminView: () => this.show.bind(this),
        loadAssignments: () => this.roster.load.bind(this.roster),
        loadProjectGroups: () => this.roster.loadGroups.bind(this.roster),
        openLeads: () => this.accounts.openLeads.bind(this.accounts),
        cataloguePage: () => this.accounts.catalogue.bind(this.accounts),
        invalidateProjectLeads: () => () => {
          const p = this.accounts.project;
          if (p) {
            p.leadRevision = (p.leadRevision ?? 0) + 1;
            p.preview = undefined;
          }
        },
        exportRegister: () => this.register.export.bind(this.register),
        workbookBlob: () => this.register.workbookBlob,
      },
      this.resources,
      {
        workbookBlob: (value) => {
          if (typeof value === "function")
            this.register.workbookBlob = value as Register["workbookBlob"];
        },
      },
    );
    this.liveRefresh = new LiveRefresh(
      () => this.refreshVisible(),
      () =>
        !!this.scope &&
        !this.refreshing &&
        !this.loading &&
        !this.writing &&
        !this.summaryBusy &&
        !this.register.loading &&
        !this.register.exporting &&
        !this.roster.loading &&
        !document.activeElement?.matches(
          "input,textarea,select,[role=combobox]",
        ) &&
        this.view !== "staff" &&
        !Object.values(this.dialogs).some(Boolean),
      20000,
      () =>
        this.scope && this.office && this.view !== "staff"
          ? { workspace: "ADMIN", ...this.scopeBody() }
          : null,
    );
    this.resources.on(window, "pagehide", () => this.clear());
    this.resources.on(window, "pageshow", ((event: PageTransitionEvent) => {
      if (event.persisted) void this.initialize();
    }) as EventListener);
    void this.initialize();
  };
  dispose = () => {
    this.clear();
    this.liveRefresh?.close();
    this.resources.dispose();
    this.store.clear();
  };
}
