import type { AdminModel } from "./model.ts";
import type {
  CommonDuty,
  Duty,
  Failure,
  Group,
  Guard,
  Project,
} from "./types.ts";
export type PersonDuty =
  (Duty & { kind: "project" }) | (CommonDuty & { kind: "common" });
export type RosterPerson = {
  userId: string;
  name: string;
  duties: PersonDuty[];
};
async function paged<T>(
  fetchPage: (
    cursor: string | null,
  ) => Promise<{ items: T[]; cursor?: string | null }>,
  current: () => boolean,
) {
  const rows: T[] = [],
    seen = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < 40; page++) {
    if (!current()) return [];
    const result = await fetchPage(cursor);
    if (!current()) return [];
    rows.push(...result.items);
    if (!result.cursor) return rows;
    if (!result.items.length || seen.has(result.cursor))
      throw Error("Guard roster changed. Refresh to retry.");
    seen.add(result.cursor);
    cursor = result.cursor;
  }
  throw Error("Too many guard duties. Narrow the office scope.");
}
export class Roster {
  root: AdminModel;
  guards: Guard[] = [];
  duties: Duty[] = [];
  common: CommonDuty[] = [];
  deniedProjects: string[] = [];
  groups: Group[] = [];
  groupsLoaded = false;
  groupStatus = "";
  projectTab = "catalogue";
  groupEditing: Group | null = null;
  groupContext: { version: number; office: number } | null = null;
  groupChoices: Project[] = [];
  members: string[] = [];
  filter = "all";
  view = "guard";
  search = "";
  status = "";
  loading = false;
  allocationMode = "none";
  constructor(root: AdminModel) {
    this.root = root;
    root.resets.add(() => this.clear());
    root.loaders.assignments = () => this.load();
  }
  clear() {
    this.guards = [];
    this.duties = [];
    this.common = [];
    this.deniedProjects = [];
    this.groups = [];
    this.groupsLoaded = false;
    this.groupEditing = null;
    this.groupContext = null;
    this.groupChoices = [];
    this.members = [];
    this.status = "";
    this.groupStatus = "";
    this.loading = false;
  }
  async load() {
    const root = this.root;
    if (!root.scope?.canAssignGuards) return;
    const valid = root.current(),
      request = root.token("assignments"),
      current = () => valid() && request() && root.view === "assignments";
    this.status = "Loading guard roster…";
    this.loading = true;
    root.publish();
    try {
      const projects = await root.accounts.all(current, true);
      if (!current()) return;
      let guards: Guard[] = [];
      for (const project of projects) {
        try {
          guards = await paged<Guard>(async (cursor) => {
            const result = await root.api<{
              guards: Guard[];
              hasMore: boolean;
              afterUserId?: string;
            }>(
              "guards",
              {
                projectLocationId: project.projectLocationId,
                pageSize: 50,
                ...(cursor ? { afterUserId: cursor } : {}),
              },
              false,
              current,
            );
            return {
              items: result.guards,
              cursor: result.hasMore ? result.afterUserId : null,
            };
          }, current);
          break;
        } catch (error) {
          if ((error as Failure).status !== 403) throw error;
        }
      }
      if (!current()) return;
      const records: { duties: Duty[]; denied?: string }[] = new Array(
        projects.length,
      );
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, projects.length) }, async () => {
          while (next < projects.length && current()) {
            const index = next++,
              project = projects[index];
            try {
              const duties = await paged<Duty>(async (cursor) => {
                const result = await root.api<{
                  assignments: Duty[];
                  cursor: string | null;
                }>(
                  "assignments",
                  {
                    projectLocationId: project.projectLocationId,
                    ...(cursor ? { afterAssignmentId: cursor } : {}),
                  },
                  false,
                  current,
                );
                return { items: result.assignments, cursor: result.cursor };
              }, current);
              records[index] = {
                duties: duties.map((d) => ({
                  ...d,
                  projectLocationId: project.projectLocationId,
                  projectName: project.projectName,
                })),
              };
            } catch (error) {
              if ((error as Failure).status !== 403) throw error;
              records[index] = {
                duties: [],
                denied: project.projectLocationId,
              };
              if (current()) {
                if (!this.deniedProjects.includes(project.projectLocationId))
                  this.deniedProjects.push(project.projectLocationId);
                this.duties = this.duties.filter(
                  (d) => d.projectLocationId !== project.projectLocationId,
                );
                if (this.filter === "free") this.filter = "all";
                root.publish();
              }
            }
          }
        }),
      );
      if (!current()) return;
      const common = root.office!.canManageCommonAreas
        ? ((
            await root.accounts.commonCatalogue(
              root.office!.locationId,
              current,
            )
          )?.assignments ?? [])
        : [];
      const groups = root.scope?.canManageProjectGroups
        ? (
            await root.api<{ groups: Group[] }>(
              "project-groups",
              { locationId: root.office!.locationId },
              false,
              current,
            )
          ).groups
        : [];
      if (!current()) return;
      this.guards = guards;
      this.duties = records.flatMap((v) => v.duties);
      this.deniedProjects = records.flatMap((v) =>
        v.denied ? [v.denied] : [],
      );
      this.common = common;
      this.groups = groups;
      this.groupsLoaded = !!root.scope?.canManageProjectGroups;
      this.status = "";
      if (this.deniedProjects.length && this.filter === "free")
        this.filter = "all";
    } catch (error) {
      if (current()) {
        this.status = "Guard roster could not be loaded. Use Refresh to retry.";
        root.failure(error);
      }
    } finally {
      if (current()) {
        this.loading = false;
        root.publish();
      }
    }
  }
  people() {
    const map = new Map<string, RosterPerson>(),
      get = (id: string, name: string) => {
        const key = id.toLowerCase();
        if (!map.has(key)) map.set(key, { userId: key, name, duties: [] });
        return map.get(key)!;
      };
    for (const guard of this.guards) get(guard.userId, guard.displayName);
    const seen = new Set<string>();
    for (const duty of this.duties) {
      if (duty.groupAssignmentId) {
        if (seen.has(duty.groupAssignmentId)) continue;
        seen.add(duty.groupAssignmentId);
      }
      get(duty.userId, duty.guardName).duties.push({
        ...duty,
        kind: "project",
      });
    }
    for (const duty of this.common)
      get(duty.guardUserId, duty.guardName).duties.push({
        ...duty,
        kind: "common",
      });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  shownPeople() {
    const query = this.search.trim().toLowerCase();
    return this.people().filter(
      (p) =>
        this.keep(p.duties.length > 0) &&
        (!query ||
          p.name.toLowerCase().includes(query) ||
          p.duties.some((d) =>
            (d.kind === "common"
              ? d.areaName
              : [
                  d.groupName,
                  d.projectName,
                  this.groups
                    .find((g) => g.groupId === d.groupId)
                    ?.projects.map((v) => v.projectName)
                    .join(" "),
                ].join(" ")
            )
              .toLowerCase()
              .includes(query),
          )),
    );
  }
  keep(assigned: boolean) {
    return this.filter === "all" || (this.filter === "free") === !assigned;
  }
  projects() {
    return (
      this.root.accounts.fullProjects ?? this.root.accounts.projects
    ).filter((p) => !this.deniedProjects.includes(p.projectLocationId));
  }
  async showTab(tab: string) {
    if (
      this.root.writing ||
      !this.root.scope ||
      (tab === "groups" && !this.root.scope.canManageProjectGroups)
    )
      return;
    this.projectTab = tab;
    if (tab === "groups") this.root.accounts.pausePreviews();
    this.root.publish();
    if (tab === "groups") await this.loadGroups();
    else await this.root.accounts.show();
  }
  async loadGroups(quiet = false) {
    const root = this.root;
    if (!root.scope?.canManageProjectGroups || !root.office) {
      this.groups = [];
      this.groupsLoaded = false;
      root.publish();
      return;
    }
    const valid = root.current(),
      request = root.token("groups"),
      current = () =>
        valid() &&
        request() &&
        root.view === "projects" &&
        this.projectTab === "groups";
    if (!quiet) this.groupStatus = "Loading account groups…";
    root.publish();
    try {
      const result = await root.api<{ groups: Group[] }>(
        "project-groups",
        { locationId: root.office.locationId },
        false,
        current,
      );
      if (!current()) return;
      this.groups = result.groups;
      this.groupsLoaded = true;
      this.groupStatus = "";
      root.publish();
    } catch (error) {
      if (current()) {
        this.groupStatus = this.groupsLoaded
          ? "Account groups could not be refreshed. Showing the previous list; use Refresh to retry."
          : "Account groups could not be loaded. Use Refresh to retry.";
        if ((error as Failure).status === 403 || !quiet) root.failure(error);
        else root.publish();
      }
    }
  }
  async openGroup(group: Group | null = null) {
    const root = this.root;
    if (
      !root.scope?.canManageProjectGroups ||
      root.writing ||
      root.view !== "projects" ||
      this.projectTab !== "groups"
    )
      return;
    const valid = root.current(),
      current = () =>
        valid() && root.view === "projects" && this.projectTab === "groups";
    try {
      const projects = await root.accounts.all(current);
      if (!current()) return;
      this.groupEditing = group;
      this.groupContext = {
        version: root.version,
        office: root.office!.locationId,
      };
      root.fields["project-group-name"] = group?.name ?? "";
      root.fields["project-group-reason"] = "";
      this.members = group?.projects.map((p) => p.projectLocationId) ?? [];
      const map = new Map(projects.map((p) => [p.projectLocationId, p]));
      for (const p of group?.projects ?? [])
        if (!map.has(p.projectLocationId)) map.set(p.projectLocationId, p);
      this.groupChoices = [...map.values()];
      root.open("project-group-dialog");
    } catch (error) {
      if (current()) root.failure(error);
    }
  }
  toggleMember(id: string, checked: boolean) {
    if (this.root.writing) return;
    this.members = checked
      ? [...new Set([...this.members, id])]
      : this.members.filter((v) => v !== id);
    this.root.publish();
  }
  impact() {
    const group = this.groupEditing,
      before = new Set(group?.projects.map((p) => p.projectLocationId) ?? []),
      added = this.groupChoices.filter(
        (p) =>
          this.members.includes(p.projectLocationId) &&
          !before.has(p.projectLocationId),
      ),
      removed =
        group?.projects.filter(
          (p) => !this.members.includes(p.projectLocationId),
        ) ?? [];
    return (
      this.members.length +
      " accounts selected. " +
      (group
        ? "Adding: " +
          (added.map((p) => p.projectName + " · " + p.projectCode).join(", ") ||
            "none") +
          ". Removing: " +
          (removed.map((p) => p.projectName).join(", ") || "none") +
          ". "
        : "") +
      (group?.assignments.length
        ? "Saving updates group-derived access for " +
          group.assignments.length +
          " guards: " +
          group.assignments.map((a) => a.guardName).join(", ") +
          "."
        : "No guards linked yet.") +
      " Individual assignments and other groups remain in effect."
    );
  }
  async saveGroup() {
    const root = this.root,
      group = this.groupEditing;
    if (
      !root.scope?.canManageProjectGroups ||
      !root.dialogs["project-group-dialog"] ||
      root.view !== "projects" ||
      this.projectTab !== "groups" ||
      this.groupContext?.version !== root.version ||
      this.groupContext.office !== root.office?.locationId
    )
      return;
    if (!this.members.length || this.members.length > 50) {
      root.notice("Select between 1 and 50 accounts.", "error");
      return;
    }
    const name = root.field("project-group-name").trim(),
      reason = root.field("project-group-reason").trim();
    if (!name || !reason) return;
    await root.write(
      "project-group",
      {
        locationId: root.office.locationId,
        action: "SAVE",
        name,
        projectLocationIds: this.members,
        reason,
        ...(group ? { groupId: group.groupId, revision: group.revision } : {}),
      },
      "group-save",
      async () => {
        root.dialogs["project-group-dialog"] = false;
        this.groupEditing = null;
        this.groupContext = null;
        await this.loadGroups();
        root.notice("Change saved.");
      },
    );
  }
  archive(group: Group) {
    if (!this.root.scope?.canManageProjectGroups) return;
    this.root.ask(
      "Archive " +
        group.name +
        " and remove its " +
        group.assignments.length +
        " linked guard assignments",
      "project-group",
      {
        locationId: this.root.office!.locationId,
        groupId: group.groupId,
        revision: group.revision,
        action: "ARCHIVE",
      },
      () => this.loadGroups(),
    );
  }
  removeDuty(duty: Duty, name: string) {
    const root = this.root;
    if (duty.groupAssignmentId) {
      const group = this.groups.find((g) => g.groupId === duty.groupId);
      if (!group || !root.scope?.canManageProjectGroups) return;
      root.ask(
        "Remove " +
          name +
          " from group " +
          group.name +
          " (" +
          group.projects.length +
          " accounts)",
        "project-group-guard",
        {
          locationId: root.office!.locationId,
          groupId: group.groupId,
          revision: group.revision,
          action: "REMOVE",
          groupAssignmentId: duty.groupAssignmentId,
        },
        () => this.load(),
      );
    } else if (root.scope?.canAssignGuards)
      root.ask(
        "Remove " + name + " from " + duty.projectName,
        "deallocate",
        { assignmentId: duty.assignmentId },
        () => this.load(),
      );
  }
  async openAssign({
    guardId = "",
    projectLocationId = "",
    groupId = "",
  } = {}) {
    const root = this.root;
    if (!root.scope?.canAssignGuards || root.writing) return;
    const valid = root.current(),
      view = root.view,
      current = () => valid() && view === root.view;
    try {
      const projects = await root.accounts.all(current);
      if (!current()) return;
      if (!projects.length) {
        root.notice("No accounts available in this office.", "error");
        return;
      }
      root.fields["allocation-project"] =
        projectLocationId ||
        (projects.length === 1
          ? projects[0].projectLocationId
          : (root.pair?.projectLocationId ?? ""));
      root.fields["allocation-group"] = groupId;
      root.fields["allocation-kind"] = groupId ? "group" : "project";
      root.fields["allocation-guard"] = guardId;
      root.fields["allocation-reason"] = "";
      this.setUntil("none");
      root.open("assign-dialog");
    } catch (error) {
      if (current()) root.failure(error);
    }
  }
  group() {
    return this.groups.find(
      (g) => g.groupId === this.root.field("allocation-group"),
    );
  }
  already(userId: string) {
    return this.root.field("allocation-kind") === "group"
      ? !!this.group()?.assignments.some(
          (a) => a.userId.toLowerCase() === userId.toLowerCase(),
        )
      : this.duties.some(
          (d) =>
            d.userId.toLowerCase() === userId.toLowerCase() &&
            !d.groupAssignmentId &&
            d.projectLocationId === this.root.field("allocation-project"),
        );
  }
  setUntil(mode: string) {
    const root = this.root;
    if (root.writing) return;
    this.allocationMode = mode;
    const india = (date: Date) =>
      new Date(date.getTime() + 330 * 60000).toISOString().slice(0, 16);
    root.fields["allocation-until"] =
      mode === "none"
        ? ""
        : mode === "today"
          ? root.scope!.currentDate + "T23:59"
          : mode === "custom"
            ? root.field("allocation-until") ||
              india(new Date(Date.now() + 86400000)).slice(0, 10) + "T18:00"
            : india(new Date(Date.now() + Number(mode) * 86400000));
    root.publish();
  }
  async allocate() {
    const root = this.root,
      groupMode = root.field("allocation-kind") === "group",
      group = this.group(),
      project = root.field("allocation-project"),
      user = root.field("allocation-guard"),
      reason = root.field("allocation-reason").trim();
    if (
      !root.scope?.canAssignGuards ||
      !user ||
      !reason ||
      this.already(user) ||
      (groupMode
        ? !root.scope.canManageProjectGroups || !group
        : !project || this.deniedProjects.includes(project))
    )
      return;
    try {
      const until = root.staff.until("allocation-until", "+05:30");
      await root.write(
        groupMode ? "project-group-guard" : "allocate",
        {
          guardUserId: user,
          reason,
          ...(until ? { validUntilUtc: until } : {}),
          ...(groupMode
            ? {
                locationId: root.office!.locationId,
                groupId: group!.groupId,
                revision: group!.revision,
                action: "ASSIGN",
              }
            : { projectLocationId: project }),
        },
        "allocation",
        async () => {
          root.dialogs["assign-dialog"] = false;
          await this.load();
          root.notice("Change saved.");
        },
      );
    } catch (error) {
      root.failure(error);
    }
  }
}
