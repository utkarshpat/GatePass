import type { AdminModel } from "./model.ts";
import type {
  Area,
  CommonDuty,
  Cursor,
  Failure,
  Host,
  Lead,
  Project,
  User,
} from "./types.ts";

export class Accounts {
  root: AdminModel;
  loadedOffice: number | null = null;
  projects: Project[] = [];
  fullProjects: Project[] | null = null;
  cursor: Cursor = null;
  query = "";
  renderLimit = 24;
  areas: Area[] = [];
  areaAssignments: CommonDuty[] = [];
  areasLoaded = false;
  areaStatus = "";
  project: Project | null = null;
  selected: User | null = null;
  leads: Lead[] = [];
  leadCursor: Cursor = null;
  leadStatus = "";
  candidates: User[] = [];
  searchStatus = "";
  removing: Lead | null = null;
  leadVersion = 0;
  leadSearch = 0;
  catalogueVersion = 0;
  catalogueRunning = false;
  cataloguePending: { append: boolean; resolve: () => void } | null = null;
  pendingLeads = new Map<string, Promise<{ leads: Lead[]; cursor: Cursor }>>();
  previewQueue: Project[] = [];
  previewActive = 0;
  previewQueued = new Set<Project>();
  timer: number | undefined;
  hostProject: Project | null = null;
  hosts: Host[] = [];
  hostCandidates: Host[] = [];
  hostSelection: (Host & { action: "ADD" | "REMOVE" }) | null = null;
  hostStatus = "";
  hostVersion = 0;
  hostRequest = 0;
  hostTimer: number | undefined;
  commonArea: Area | null = null;
  commonOffice: number | null = null;
  commonTab = "duties";
  commonRows: CommonDuty[] = [];
  commonGuards: User[] = [];
  commonSelected: User | null = null;
  commonRemoving: CommonDuty | null = null;
  commonStatus = "";
  commonVersion = 0;
  commonSearch = 0;
  commonTimer: number | undefined;
  createStatus = "";
  createOffice: number | null = null;
  constructor(root: AdminModel) {
    this.root = root;
  }
  clear() {
    this.leadVersion++;
    this.leadSearch++;
    this.catalogueVersion++;
    this.hostVersion++;
    this.hostRequest++;
    this.commonVersion++;
    this.commonSearch++;
    for (const timer of [this.timer, this.hostTimer, this.commonTimer])
      this.root.resources.clearTimeout(timer);
    this.projects = [];
    this.fullProjects = null;
    this.cursor = null;
    this.query = "";
    this.renderLimit = 24;
    this.areas = [];
    this.areaAssignments = [];
    this.areasLoaded = false;
    this.areaStatus = "";
    this.project = null;
    this.selected = null;
    this.leads = [];
    this.leadCursor = null;
    this.candidates = [];
    this.removing = null;
    this.pendingLeads.clear();
    this.previewQueue = [];
    this.previewQueued.clear();
    this.closeHosts();
    this.closeCommon();
    this.createStatus = "";
    this.createOffice = null;
  }
  known() {
    const rows = new Map(
      (this.fullProjects ?? []).map((p) => [p.projectLocationId, p]),
    );
    for (const p of this.projects) rows.set(p.projectLocationId, p);
    const pair = this.root.pair;
    if (pair && !rows.has(pair.projectLocationId))
      rows.set(pair.projectLocationId, pair);
    return [...rows.values()];
  }
  async all(current: () => boolean, refresh = false) {
    if (!refresh && this.fullProjects) return this.fullProjects;
    const rows: Project[] = [],
      seen = new Set<string>();
    let cursor: Cursor = null;
    for (let page = 0; page < 400; page++) {
      if (!current()) return [];
      const result: { projects: Project[]; cursor: Cursor } =
        await this.root.api(
          "projects",
          {
            locationId: this.root.office!.locationId,
            ...(cursor ? { cursor } : {}),
          },
          false,
          current,
        );
      if (!current()) return [];
      rows.push(...result.projects);
      cursor = result.cursor;
      if (!cursor) {
        this.fullProjects = rows;
        return rows;
      }
      if (!result.projects.length || seen.has(cursor))
        throw Error("Account catalogue changed. Refresh to retry.");
      seen.add(cursor);
    }
    throw Error("Too many accounts. Contact your administrator.");
  }
  matches() {
    const q = this.root.field("project-search").trim().toLowerCase();
    return [
      ...this.projects
        .filter(
          (p) =>
            !q ||
            (p.projectName + " " + p.projectCode).toLowerCase().includes(q),
        )
        .map((project) => ({
          kind: "project" as const,
          name: project.projectName,
          project,
        })),
      ...this.areas
        .filter((a) => !q || a.name.toLowerCase().includes(q))
        .map((area) => ({ kind: "area" as const, name: area.name, area })),
    ].sort((a, b) => a.name.localeCompare(b.name));
  }
  search(value: string) {
    if (this.root.writing) return;
    this.root.fields["project-search"] = value;
    this.renderLimit = 24;
    this.catalogueVersion++;
    this.root.resources.clearTimeout(this.timer);
    this.timer = this.root.resources.timeout(() => void this.catalogue(), 250);
    this.root.publish();
  }
  catalogue(append = false): Promise<void> {
    this.catalogueVersion++;
    return new Promise((resolve) => {
      this.cataloguePending?.resolve();
      this.cataloguePending = { append, resolve };
      if (!this.catalogueRunning) void this.drain();
    });
  }
  private async drain() {
    this.catalogueRunning = true;
    try {
      while (this.cataloguePending) {
        const job = this.cataloguePending;
        this.cataloguePending = null;
        try {
          await this.catalogueNow(job.append);
        } finally {
          job.resolve();
        }
      }
    } finally {
      this.catalogueRunning = false;
    }
  }
  private async catalogueNow(append: boolean) {
    const root = this.root,
      version = ++this.catalogueVersion,
      valid = root.current(),
      current = () => valid() && version === this.catalogueVersion,
      query = root.field("project-search").trim();
    if (!root.office || !root.scope) return;
    if (query !== this.query) append = false;
    const cursor = append ? this.cursor : null;
    if (append && !cursor) return;
    try {
      const result = await root.api<{ projects: Project[]; cursor: Cursor }>(
        "projects",
        {
          locationId: root.office.locationId,
          ...(cursor ? { cursor } : {}),
          ...(query ? { search: query } : {}),
        },
        false,
        current,
      );
      if (!current()) return;
      if (
        result.cursor &&
        (!result.projects.length || result.cursor === cursor)
      )
        throw Error("Account catalogue changed. Refresh to retry.");
      const rows = append ? [...this.projects] : [],
        ids = new Set(rows.map((p) => p.projectLocationId));
      for (const project of result.projects)
        if (!ids.has(project.projectLocationId)) {
          rows.push(project);
          ids.add(project.projectLocationId);
        }
      if (rows.length > 10000)
        throw Error("Too many loaded accounts. Narrow the search.");
      this.projects = rows;
      this.cursor = result.cursor;
      this.query = query;
      this.renderLimit = Math.max(24, append ? rows.length : 24);
      root.publish();
    } catch (error) {
      if (current()) root.failure(error);
    }
  }
  more() {
    if (this.renderLimit < this.matches().length) {
      this.renderLimit += 24;
      this.root.publish();
    } else void this.catalogue(true);
  }
  async show() {
    if (!this.areasLoaded) await this.loadAreas();
  }
  async commonCatalogue(locationId: number, current: () => boolean) {
    const areas = new Map<string, Area>(),
      assignments: CommonDuty[] = [];
    for (let offset = 0; offset < 10000;) {
      const result = await this.root.api<{
        areas: Area[];
        assignments: CommonDuty[];
        hasMore: boolean;
      }>("common-duties", { locationId, search: "", offset }, false, current);
      if (!current()) return null;
      for (const area of result.areas ?? []) areas.set(area.areaId, area);
      assignments.push(...(result.assignments ?? []));
      if (!result.hasMore) return { areas: [...areas.values()], assignments };
      if (!result.assignments.length) break;
      offset += result.assignments.length;
    }
    throw Error("Too many common duties. Contact your office administrator.");
  }
  async loadAreas() {
    const root = this.root;
    if (!root.office?.canManageCommonAreas || !root.scope) return;
    const valid = root.current(),
      request = root.token("areas"),
      current = () => valid() && request();
    this.areaStatus = "Loading common areas…";
    root.publish();
    try {
      const result = await this.commonCatalogue(
        root.office.locationId,
        current,
      );
      if (!result || !current()) return;
      this.areas = result.areas;
      this.areaAssignments = result.assignments;
      this.areasLoaded = true;
      this.areaStatus = "";
      root.publish();
    } catch (error) {
      if (current()) {
        this.areaStatus =
          "Common areas could not be loaded. Use Refresh to retry.";
        root.failure(error);
      }
    }
  }
  readLeads(project: Project, cursor: Cursor = null) {
    const root = this.root,
      key = JSON.stringify([
        root.version,
        root.office?.locationId,
        project.projectLocationId,
        project.leadRevision ?? 0,
        cursor,
      ]);
    let pending = this.pendingLeads.get(key);
    if (!pending) {
      pending = root
        .api<{ leads: Lead[]; cursor: Cursor }>("leads", {
          projectLocationId: project.projectLocationId,
          ...(cursor ? { cursor } : {}),
        })
        .finally(() => {
          if (this.pendingLeads.get(key) === pending)
            this.pendingLeads.delete(key);
        });
      this.pendingLeads.set(key, pending);
    }
    return pending.then((result) => structuredClone(result));
  }
  preview(project: Project) {
    if (
      !this.root.scope ||
      this.root.view !== "projects" ||
      (project.preview !== undefined && !project.previewStale) ||
      this.previewQueued.has(project)
    )
      return;
    project.previewStale = false;
    if (project.preview === undefined) project.preview = null;
    this.previewQueue.push(project);
    this.previewQueued.add(project);
    this.pumpPreviews();
  }
  private pumpPreviews() {
    while (
      this.previewActive < 3 &&
      this.previewQueue.length &&
      this.root.scope &&
      this.root.view === "projects"
    ) {
      const project = this.previewQueue.shift()!,
        current = this.root.current(),
        revision = project.leadRevision;
      this.previewActive++;
      void this.readLeads(project)
        .then(
          (result) => {
            if (current() && revision === project.leadRevision)
              project.preview = {
                names: result.leads.map((v) => v.displayName),
                more: !!result.cursor,
              };
          },
          () => {
            if (current() && revision === project.leadRevision)
              project.preview = { names: [], more: false, failed: true };
          },
        )
        .finally(() => {
          this.previewActive--;
          this.previewQueued.delete(project);
          this.root.publish();
          this.pumpPreviews();
        });
    }
  }
  pausePreviews() {
    for (const project of this.previewQueue.splice(0)) {
      this.previewQueued.delete(project);
      if (project.preview === null) project.preview = undefined;
      else project.previewStale = true;
    }
  }
  openLeads(project: Project) {
    const root = this.root;
    if (root.writing || !root.scope) return;
    this.leadVersion++;
    this.leadSearch++;
    this.project = project;
    this.selected = null;
    this.candidates = [];
    this.removing = null;
    this.leads = [];
    this.leadCursor = null;
    this.searchStatus = "";
    for (const key of ["lead-grant", "lead-revoke"]) root.attempts.delete(key);
    root.fields["employee-search"] = root.fields["grant-reason"] = "";
    root.fields["lead-scope"] = project.canAssignLocation
      ? "PROJECT_LOCATION"
      : "PROJECT";
    root.open("lead-dialog");
    void this.loadLeads();
  }
  closeLeads() {
    this.leadVersion++;
    this.leadSearch++;
    this.project = null;
    this.selected = null;
    this.candidates = [];
    this.leads = [];
    this.removing = null;
  }
  async loadLeads(more = false) {
    const project = this.project;
    if (!project) return;
    const version = this.leadVersion,
      valid = this.root.current(),
      revision = project.leadRevision,
      current = () =>
        valid() &&
        version === this.leadVersion &&
        revision === project.leadRevision;
    if (!more) this.leads = [];
    this.leadStatus = "Loading leads…";
    this.root.publish();
    try {
      const result = await this.readLeads(
        project,
        more ? this.leadCursor : null,
      );
      if (!current()) return;
      this.leads = more ? [...this.leads, ...result.leads] : result.leads;
      this.leadCursor = result.cursor;
      this.leadStatus = this.leads.length ? "" : "No account leads assigned.";
      if (!more)
        project.preview = {
          names: result.leads.map((v) => v.displayName),
          more: !!result.cursor,
        };
      this.root.publish();
    } catch (error) {
      if (current()) {
        this.leadStatus = "Leads could not be loaded.";
        this.root.failure(error);
      }
    }
  }
  searchLeads(value: string) {
    const root = this.root;
    if (root.writing) return;
    root.fields["employee-search"] = value;
    this.selected = null;
    this.candidates = [];
    this.searchStatus = value.trim().length >= 2 ? "Searching…" : "";
    const generation = ++this.leadSearch,
      version = this.leadVersion,
      valid = root.current(),
      project = this.project,
      current = () =>
        valid() &&
        generation === this.leadSearch &&
        version === this.leadVersion &&
        !root.writing;
    root.resources.clearTimeout(this.timer);
    root.publish();
    if (!project || value.trim().length < 2) return;
    this.timer = root.resources.timeout(() => {
      void root
        .api<{ employees: User[] }>(
          "candidates",
          {
            projectLocationId: project.projectLocationId,
            search: value.trim(),
          },
          false,
          current,
        )
        .then(
          (result) => {
            if (current()) {
              this.candidates = result.employees;
              this.searchStatus = result.employees.length
                ? ""
                : "No employees found.";
              root.publish();
            }
          },
          (error) => {
            if (current()) {
              this.searchStatus = "Search unavailable. Try again.";
              root.failure(error);
            }
          },
        );
    }, 300);
  }
  chooseLead(user: User) {
    if (this.root.writing) return;
    this.selected = user;
    this.candidates = [];
    this.searchStatus = "";
    this.root.publish();
  }
  removeLead(lead: Lead | null) {
    if (this.root.writing) return;
    this.removing = lead;
    this.root.fields["remove-reason"] = "";
    this.root.attempts.delete("lead-revoke");
    this.root.publish();
  }
  async saveLead(remove = false) {
    const root = this.root,
      project = this.project;
    if (!project) return;
    const scopeType = root.field("lead-scope");
    if (
      !remove &&
      (!this.selected ||
        !project.directoryCurrent ||
        !(scopeType === "PROJECT"
          ? project.canAssignProject
          : project.canAssignLocation))
    )
      return;
    if (remove && !this.removing?.canRemove) return;
    const payload = remove
      ? {
          roleGrantId: this.removing!.roleGrantId,
          reason: root.field("remove-reason").trim(),
        }
      : {
          targetUserId: this.selected!.userId,
          roleCode: "PROJECT_ADMIN",
          scopeType,
          ...(scopeType === "PROJECT"
            ? { projectId: project.projectId }
            : { projectLocationId: project.projectLocationId }),
          capabilities: [
            "VISITS_READ",
            "GUARDS_MANAGE",
            "REPORTS_READ",
            "REPORTS_EXPORT",
            "AUDIT_READ",
            "ROLE_GRANTS_MANAGE",
          ],
          reason: root.field("grant-reason").trim(),
        };
    if (!payload.reason) return;
    await root.write(
      remove ? "revoke" : "grant",
      payload,
      remove ? "lead-revoke" : "lead-grant",
      async () => {
        this.selected = null;
        this.candidates = [];
        this.removing = null;
        this.leadSearch++;
        root.fields["employee-search"] = root.fields["grant-reason"] = "";
        project.leadRevision = (project.leadRevision ?? 0) + 1;
        project.preview = undefined;
        await this.loadLeads();
        root.notice(remove ? "Account lead removed." : "Account lead added.");
      },
    );
  }
  openHosts(project: Project) {
    if (!project.canManageHosts || this.root.writing) return;
    this.closeHosts();
    this.hostProject = project;
    this.hostSelection = null;
    this.root.fields["account-host-search"] = this.root.fields[
      "account-host-reason"
    ] = "";
    this.root.open("account-host-dialog");
    void this.loadHosts();
  }
  closeHosts() {
    this.hostVersion++;
    this.hostRequest++;
    this.root.resources.clearTimeout(this.hostTimer);
    this.hostProject = null;
    this.hosts = [];
    this.hostCandidates = [];
    this.hostSelection = null;
    this.hostStatus = "";
    this.root.attempts.delete("host");
  }
  async loadHosts() {
    const project = this.hostProject;
    if (!project) return;
    const version = this.hostVersion,
      request = ++this.hostRequest,
      valid = this.root.current(),
      current = () =>
        valid() && version === this.hostVersion && request === this.hostRequest;
    const search = this.root.field("account-host-search").trim();
    this.hostStatus = "Loading approved hosts…";
    this.root.publish();
    try {
      const result = await this.root.api<{ hosts: Host[]; candidates: Host[] }>(
        "account-hosts",
        {
          projectLocationId: project.projectLocationId,
          ...(search.length >= 2 ? { search } : {}),
        },
        false,
        current,
      );
      if (!current()) return;
      this.hosts = result.hosts;
      this.hostCandidates = result.candidates;
      this.hostStatus =
        result.hosts.length +
        " approved hosts" +
        (search.length >= 2
          ? " · " + result.candidates.length + " employees available to add"
          : "");
      this.root.publish();
    } catch (error) {
      if (current()) {
        this.hostStatus = "Host list unavailable. Refresh to retry.";
        if ([401, 403].includes((error as Failure).status ?? 0)) {
          this.hosts = [];
          this.hostCandidates = [];
          this.hostSelection = null;
        }
        this.root.failure(error);
      }
    }
  }
  searchHosts(value: string) {
    if (this.root.writing) return;
    this.root.fields["account-host-search"] = value;
    this.hostRequest++;
    this.hostCandidates = [];
    this.hostSelection = null;
    this.root.attempts.delete("host");
    this.root.resources.clearTimeout(this.hostTimer);
    if (value.trim().length >= 2)
      this.hostTimer = this.root.resources.timeout(
        () => void this.loadHosts(),
        300,
      );
    this.root.publish();
  }
  chooseHost(host: Host, action: "ADD" | "REMOVE") {
    if (!this.root.writing) {
      this.hostSelection = { ...host, action };
      this.root.fields["account-host-reason"] = "";
      this.root.attempts.delete("host");
      this.root.publish();
    }
  }
  async saveHost() {
    const host = this.hostSelection,
      project = this.hostProject,
      reason = this.root.field("account-host-reason").trim();
    if (!host || !project?.canManageHosts || !reason) return;
    await this.root.write(
      "account-host",
      {
        projectLocationId: project.projectLocationId,
        employeeId: host.employeeId,
        revision: host.revision,
        action: host.action,
        reason,
      },
      "host",
      async () => {
        this.hostSelection = null;
        this.root.fields["account-host-reason"] = "";
        this.root.notice("Approved host list updated.");
        await this.loadHosts();
      },
    );
  }
  openCommon(tab: string, area: Area) {
    const root = this.root;
    if (!root.scope || !root.office?.canManageCommonAreas || root.writing)
      return;
    this.closeCommon();
    this.commonArea = area;
    this.commonOffice = root.office.locationId;
    this.commonTab = tab;
    this.commonStatus = "";
    root.fields["common-guard-search"] = root.fields["common-assign-reason"] =
      "";
    root.open("common-dialog");
    void this.loadCommon();
  }
  closeCommon() {
    this.commonVersion++;
    this.commonSearch++;
    this.root.resources.clearTimeout(this.commonTimer);
    this.commonArea = null;
    this.commonOffice = null;
    this.commonRows = [];
    this.commonGuards = [];
    this.commonSelected = null;
    this.commonRemoving = null;
    this.root.attempts.delete("common");
  }
  async loadCommon() {
    if (!this.commonArea || !this.commonOffice) return;
    const root = this.root,
      version = ++this.commonVersion,
      valid = root.current(),
      current = () => valid() && version === this.commonVersion;
    this.commonStatus = "Loading guards…";
    root.publish();
    try {
      const result = await this.commonCatalogue(this.commonOffice, current);
      if (!result || !current()) return;
      if (!result.areas.some((v) => v.areaId === this.commonArea!.areaId))
        throw Object.assign(
          Error(
            "This common area is no longer available. Refresh your office.",
          ),
          { status: 403 },
        );
      this.commonRows = result.assignments.filter(
        (v) => v.areaId === this.commonArea!.areaId,
      );
      this.commonStatus = this.commonRows.length
        ? ""
        : "No guards assigned to this area.";
      root.publish();
    } catch (error) {
      if (current()) {
        this.commonStatus = "Guards unavailable. Close and reopen to retry.";
        root.failure(error);
      }
    }
  }
  searchCommon(value: string) {
    const root = this.root;
    if (root.writing) return;
    root.fields["common-guard-search"] = value;
    this.commonSelected = null;
    this.commonGuards = [];
    const version = ++this.commonSearch,
      dialog = this.commonVersion,
      valid = root.current(),
      current = () =>
        valid() &&
        version === this.commonSearch &&
        dialog === this.commonVersion &&
        !root.writing;
    root.resources.clearTimeout(this.commonTimer);
    root.publish();
    if (value.trim().length < 2 || !this.commonOffice) return;
    this.commonTimer = root.resources.timeout(() => {
      void root
        .api<{ guards: User[] }>(
          "common-duties",
          { locationId: this.commonOffice, search: value.trim(), offset: 0 },
          false,
          current,
        )
        .then(
          (result) => {
            if (current()) {
              this.commonGuards = result.guards;
              root.publish();
            }
          },
          (error) => {
            if (current()) root.failure(error);
          },
        );
    }, 250);
  }
  chooseCommon(guard: User) {
    if (this.root.writing) return;
    this.commonSelected = guard;
    this.commonGuards = [];
    this.root.publish();
  }
  removeCommon(duty: CommonDuty | null) {
    if (this.root.writing) return;
    this.commonRemoving = duty;
    this.root.fields["common-remove-reason"] = "";
    if (!duty) this.commonTab = "duties";
    this.root.publish();
  }
  async saveCommon(remove = false) {
    const root = this.root;
    if (
      !this.commonOffice ||
      !this.commonArea ||
      (remove ? !this.commonRemoving : !this.commonSelected)
    )
      return;
    const reason = root
      .field(remove ? "common-remove-reason" : "common-assign-reason")
      .trim();
    if (!reason) return;
    this.commonSearch++;
    root.resources.clearTimeout(this.commonTimer);
    await root.write(
      "common-duty",
      {
        locationId: this.commonOffice,
        ...(remove
          ? {
              action: "REMOVE",
              assignmentId: this.commonRemoving!.assignmentId,
            }
          : {
              action: "ASSIGN",
              areaId: this.commonArea.areaId,
              guardUserId: this.commonSelected!.userId,
            }),
        reason,
      },
      "common",
      async () => {
        this.commonSelected = null;
        this.commonRemoving = null;
        this.commonGuards = [];
        this.commonTab = "duties";
        root.fields["common-guard-search"] = root.fields[
          "common-assign-reason"
        ] = "";
        await this.loadCommon();
        await this.loadAreas();
        root.notice("Guard duty saved.");
      },
    );
  }
  openCreation() {
    const root = this.root;
    if (
      !root.scope ||
      !root.office ||
      !(root.office.canCreateProject || root.office.canManageCommonAreas) ||
      root.writing
    )
      return;
    if (this.createOffice !== root.office.locationId) {
      for (const id of [
        "new-project-name",
        "new-project-code",
        "new-project-reason",
      ])
        root.fields[id] = "";
      root.attempts.delete("project-create");
    }
    this.createOffice = root.office.locationId;
    this.createStatus = "";
    const prior = root.field("new-workspace-type");
    if (
      !(prior === "project"
        ? root.office.canCreateProject
        : prior === "area" && root.office.canManageCommonAreas)
    )
      root.fields["new-workspace-type"] = root.office.canCreateProject
        ? "project"
        : "area";
    root.open("add-project-dialog");
  }
  async saveCreation() {
    const root = this.root,
      project = root.field("new-workspace-type") === "project",
      name = root.field("new-project-name").trim(),
      reason = root.field("new-project-reason").trim();
    if (
      !root.office ||
      this.createOffice !== root.office.locationId ||
      !(project
        ? root.office.canCreateProject
        : root.office.canManageCommonAreas) ||
      !name ||
      !reason
    )
      return;
    const payload = {
      locationId: this.createOffice,
      ...(project
        ? {
            projectName: name,
            projectCode: root.field("new-project-code").trim(),
          }
        : { action: "CREATE_AREA", areaName: name }),
      reason,
    };
    this.createStatus = project ? "Creating account…" : "Creating common area…";
    root.publish();
    await root.write(
      project ? "create-project" : "common-duty",
      payload,
      "project-create",
      async () => {
        root.dialogs["add-project-dialog"] = false;
        root.notice(
          (project ? "Account" : "Common area") +
            " created in " +
            root.office!.locationName +
            ".",
        );
        await root.prepare();
      },
      (error) => {
        this.createStatus =
          error.status === 409
            ? project
              ? "This account code is unavailable. Use a different code, or refresh to check an earlier request."
              : "This common area already exists or changed. Refresh to check it."
            : error.message;
      },
    );
  }
  async refresh() {
    const root = this.root,
      valid = root.current(),
      generation = this.catalogueVersion,
      current = () =>
        valid() &&
        generation === this.catalogueVersion &&
        root.view === "projects";
    const rows: Project[] = [],
      limit = Math.max(25, this.projects.length),
      seen = new Set<string>();
    let cursor: Cursor = null;
    try {
      do {
        const result: { projects: Project[]; cursor: Cursor } = await root.api(
          "projects",
          {
            locationId: root.office!.locationId,
            ...(this.query ? { search: this.query } : {}),
            ...(cursor ? { cursor } : {}),
          },
          false,
          current,
        );
        if (!current()) return;
        rows.push(...result.projects);
        cursor = result.cursor;
        if (cursor) {
          if (
            seen.has(cursor) ||
            !result.projects.length ||
            rows.length > 10000
          )
            throw Error("Account catalogue changed. Refresh to retry.");
          seen.add(cursor);
        }
      } while (cursor && rows.length < limit);
      const previous = new Map(
        this.projects.map((p) => [p.projectLocationId, p]),
      );
      this.projects = rows.map((p) => ({
        ...p,
        preview: previous.get(p.projectLocationId)?.preview,
        previewStale: true,
      }));
      this.cursor = cursor;
      root.publish();
      // React's viewport observer refreshes visible previews, still capped at three.
      if (root.office?.canManageCommonAreas) await this.loadAreas();
    } catch (error) {
      if (current()) root.failure(error);
    }
  }
}
