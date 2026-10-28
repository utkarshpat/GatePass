import type { AdminModel } from "./model.ts";
import {
  dateTime,
  human,
  roleCaps,
  type Failure,
  type Grant,
  type Role,
  type User,
} from "./types.ts";

export class Staff {
  root: AdminModel;
  subjects: User[] = [];
  subject: User | null = null;
  subjectCursor: string | null = null;
  subjectQuery = "";
  subjectMore = false;
  subjectBusy = false;
  grants: Grant[] = [];
  roleCursor: string | null = null;
  rolesMore = false;
  setupRoles: Role[] = [];
  setupTarget: User | null = null;
  setupGuard = false;
  setupOpen = false;
  setupToken: string | null = null;
  setupAttempt: { fingerprint: string; key: string } | null = null;
  setupResult: { link: string; summary: string; expiry: string } | null = null;
  setupStatus = "";
  constructor(root: AdminModel) {
    this.root = root;
  }
  clear() {
    this.subjects = [];
    this.subject = null;
    this.subjectCursor = null;
    this.subjectQuery = "";
    this.subjectMore = false;
    this.subjectBusy = false;
    this.grants = [];
    this.roleCursor = null;
    this.rolesMore = false;
    this.clearSetup();
  }
  searchChanged(value: string) {
    const root = this.root;
    if (root.writing) return;
    root.fields["subject-search"] = value;
    root.token("subjects");
    this.subjects = [];
    this.subjectCursor = null;
    this.subjectQuery = "";
    this.subjectMore = false;
    root.status = "";
    root.publish();
  }
  async search(more = false) {
    const root = this.root,
      query = root.field("subject-search").trim();
    if (
      !root.scope?.canManageRoles ||
      query.length < 2 ||
      (more && (!this.subjectCursor || query !== this.subjectQuery))
    )
      return;
    const valid = root.current(),
      request = root.token("subjects"),
      current = () => valid() && request();
    if (!more) {
      this.subjects = [];
      this.subjectCursor = null;
      this.subjectMore = false;
    }
    this.subjectQuery = query;
    this.subjectBusy = true;
    root.status = "Searching staff…";
    root.publish();
    try {
      const result = await root.api<{
        users: User[];
        hasMore: boolean;
        afterUserId: string | null;
      }>(
        "subjects",
        {
          namePrefix: query,
          ...(more ? { afterUserId: this.subjectCursor } : {}),
        },
        false,
        current,
      );
      if (!current()) return;
      this.subjects = more ? [...this.subjects, ...result.users] : result.users;
      this.subjectCursor = result.afterUserId;
      this.subjectMore = result.hasMore;
      root.status = this.subjects.length ? "" : "No matching staff.";
    } catch (error) {
      if (current()) root.failure(error);
    } finally {
      if (current()) {
        this.subjectBusy = false;
        root.publish();
      }
    }
  }
  select(user: User) {
    if (this.root.writing || !this.root.scope) return;
    this.subject = user;
    this.grants = [];
    this.roleCursor = null;
    this.root.fields["role-state"] ||= "CURRENT";
    this.resetCapabilities();
    this.root.publish();
    void this.loadRoles();
  }
  resetCapabilities() {
    const root = this.root,
      index = Number(root.field("staff-role")),
      roles = root.scope?.delegations ?? [];
    if (!roles[index]) root.fields["staff-role"] = "0";
    const role = roles[Number(root.field("staff-role"))];
    root.capabilities["staff-capabilities"] = (
      roleCaps[role?.roleCode ?? ""] ?? []
    ).filter((c) =>
      ["VISITS_READ", "PROJECT_MOVEMENT", "REPORTS_READ"].includes(c),
    );
  }
  grantScope(grant: Role) {
    const root = this.root,
      projects = root.accounts.known();
    return grant.scopeType === "LOCATION"
      ? (root.offices.find((v) => v.locationId === grant.locationId)
          ?.locationName ?? "Office " + grant.locationId)
      : grant.scopeType === "PROJECT_LOCATION"
        ? (projects.find((p) => p.projectLocationId === grant.projectLocationId)
            ?.projectName ?? "Account office")
        : grant.scopeType === "PROJECT"
          ? (projects.find((p) => p.projectId === grant.projectId)
              ?.projectName ?? "Account")
          : human(grant.scopeType);
  }
  mayRevoke(grant: Grant) {
    const root = this.root;
    if (!root.scope || this.subject?.userId === root.scope.userId) return false;
    const projects = root.accounts.known();
    if (
      grant.roleCode === "PROJECT_ADMIN" &&
      (grant.scopeType === "PROJECT"
        ? projects.some(
            (p) => p.projectId === grant.projectId && p.canAssignProject,
          )
        : grant.scopeType === "PROJECT_LOCATION" &&
          projects.some(
            (p) =>
              p.projectLocationId === grant.projectLocationId &&
              p.canAssignLocation,
          ))
    )
      return true;
    return (
      root.scope.delegations.some(
        (d) => d.roleCode === grant.roleCode && d.scopeType === grant.scopeType,
      ) &&
      (grant.scopeType === "LOCATION"
        ? grant.locationId === root.office?.locationId
        : grant.scopeType === "PROJECT"
          ? grant.projectId === root.pair?.projectId
          : grant.scopeType === "PROJECT_LOCATION"
            ? grant.projectLocationId === root.pair?.projectLocationId
            : true)
    );
  }
  async loadRoles(more = false) {
    const root = this.root,
      subject = this.subject;
    if (!subject || !root.scope) return;
    const valid = root.current(),
      request = root.token("roles"),
      current = () => valid() && request() && this.subject === subject;
    try {
      await root.accounts.all(current, !more);
      if (!current()) return;
      const result = await root.api<{
        grants: Grant[];
        hasMore: boolean;
        afterRoleGrantId: string | null;
      }>(
        "roles",
        {
          targetUserId: subject.userId,
          state: root.field("role-state") || "CURRENT",
          ...(more && this.roleCursor
            ? { afterRoleGrantId: this.roleCursor }
            : {}),
        },
        false,
        current,
      );
      if (!current()) return;
      this.grants = more ? [...this.grants, ...result.grants] : result.grants;
      this.rolesMore = result.hasMore;
      this.roleCursor = result.afterRoleGrantId;
      root.publish();
    } catch (error) {
      if (current()) root.failure(error);
    }
  }
  until(id: string, offset = "") {
    const value = this.root.field(id);
    if (!value) return undefined;
    const date = new Date(value + offset);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now())
      throw Error("End time must be in the future.");
    return date.toISOString();
  }
  async grant() {
    const root = this.root,
      subject = this.subject,
      delegation = root.scope?.delegations[Number(root.field("staff-role"))];
    if (
      !subject?.active ||
      !root.scope ||
      subject.userId === root.scope.userId ||
      !delegation
    )
      return;
    try {
      const capabilities = root.capabilities["staff-capabilities"] ?? [];
      if (
        (["PROJECT", "PROJECT_LOCATION"].includes(delegation.scopeType) &&
          !root.pair) ||
        !capabilities.length ||
        capabilities.length > 8
      )
        throw Error("Choose between one and eight permissions.");
      if (
        ["GUARD", "RECEPTION"].includes(delegation.roleCode)
          ? !capabilities.includes("VISITS_READ")
          : !capabilities.some((c) =>
              [
                "VISITS_READ",
                "REPORTS_READ",
                "GUARDS_MANAGE",
                "ROLE_GRANTS_MANAGE",
              ].includes(c),
            )
      )
        throw Error(
          ["GUARD", "RECEPTION"].includes(delegation.roleCode)
            ? "Visit reading is required for this workspace."
            : "Choose a workspace permission: visit reading, reports, guard management or role management.",
        );
      const reason = root.field("staff-reason").trim(),
        until = this.until("staff-until");
      if (!reason) return;
      await root.write(
        "grant",
        {
          targetUserId: subject.userId,
          roleCode: delegation.roleCode,
          scopeType: delegation.scopeType,
          capabilities,
          reason,
          ...(delegation.scopeType === "LOCATION"
            ? { locationId: root.office!.locationId }
            : delegation.scopeType === "PROJECT"
              ? { projectId: root.pair!.projectId }
              : delegation.scopeType === "PROJECT_LOCATION"
                ? { projectLocationId: root.pair!.projectLocationId }
                : {}),
          ...(until ? { validUntilUtc: until } : {}),
        },
        "staff-grant",
        async () => {
          await this.loadRoles();
          root.notice("Change saved.");
        },
      );
    } catch (error) {
      root.failure(error);
    }
  }
  revoke(grant: Grant) {
    if (!this.subject || !this.mayRevoke(grant)) return;
    this.root.ask(
      "Revoke " + human(grant.roleCode) + " for " + this.subject.displayName,
      "revoke",
      { roleGrantId: grant.roleGrantId },
      () => this.loadRoles(),
    );
  }
  clearSetup() {
    this.setupOpen = false;
    this.setupToken = null;
    this.setupAttempt = null;
    this.setupTarget = null;
    this.setupResult = null;
    this.setupStatus = "";
    this.setupRoles = [];
    for (const id of [
      "new-staff-name",
      "new-staff-login",
      "new-staff-reason",
      "staff-reset-reason",
    ])
      this.root.fields[id] = "";
    this.root.dialogs["add-staff-dialog"] = false;
  }
  openSetup(guard = false, reset = false) {
    const root = this.root;
    if (!root.scope || root.writing) return;
    this.clearSetup();
    this.setupGuard = guard;
    if (reset) {
      if (
        !this.subject?.localAccount ||
        !this.subject.active ||
        this.subject.userId === root.scope.userId ||
        !root.scope.canResetLocalStaff
      )
        return;
      this.setupTarget = this.subject;
    } else {
      this.setupRoles = (root.scope.provisionableRoles ?? []).filter((v) =>
        guard ? v.roleCode === "GUARD" : v.roleCode !== "GUARD",
      );
      if (!this.setupRoles.length) return;
      root.fields["new-staff-role"] = this.setupRoles[0].roleCode;
      this.setupCapabilities();
      root.checks["new-guard-project"] = guard && !!root.pair;
    }
    this.setupOpen = true;
    root.open("add-staff-dialog");
  }
  setupCapabilities() {
    this.root.capabilities["new-staff-capabilities"] = [
      ...(roleCaps[this.root.field("new-staff-role")] ?? []),
    ];
  }
  async submitSetup(reset = false) {
    const root = this.root,
      version = root.version;
    if (
      !this.setupOpen ||
      root.writing ||
      !root.scope ||
      (reset && !this.setupTarget)
    )
      return;
    try {
      const roleCode = root.field("new-staff-role"),
        capabilities = root.capabilities["new-staff-capabilities"] ?? [];
      const payload = reset
        ? {
            targetUserId: this.setupTarget!.userId,
            reason: root.field("staff-reset-reason").trim(),
          }
        : {
            displayName: root.field("new-staff-name").trim(),
            loginId: root.field("new-staff-login").trim().toLowerCase(),
            roleCode,
            locationId: root.office!.locationId,
            capabilities,
            reason: root.field("new-staff-reason").trim(),
            ...(roleCode === "GUARD" &&
            root.pair &&
            root.scope.canAssignGuards &&
            root.checks["new-guard-project"]
              ? { projectLocationId: root.pair.projectLocationId }
              : {}),
          };
      if (!payload.reason) return;
      if (
        !reset &&
        (!this.setupRoles.some((v) => v.roleCode === roleCode) ||
          !capabilities.length ||
          (["GUARD", "RECEPTION"].includes(roleCode) &&
            !capabilities.includes("VISITS_READ")))
      )
        throw Error(
          "Choose workspace permissions, including visit reading for guards and reception.",
        );
      const fingerprint = JSON.stringify(payload);
      if (this.setupAttempt?.fingerprint !== fingerprint) {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        this.setupToken = btoa(String.fromCharCode(...bytes))
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replaceAll("=", "");
        bytes.fill(0);
        this.setupAttempt = { fingerprint, key: crypto.randomUUID() };
      }
      root.writing = true;
      this.setupStatus = "Saving account and audit trail…";
      root.publish();
      try {
        const result = await root.api<{
          displayName: string;
          loginId: string;
          roleCode: string;
          setupExpiresAtUtc: string;
        }>(reset ? "reset-staff-setup" : "create-staff", {
          ...payload,
          setupToken: this.setupToken,
          clientKey: this.setupAttempt.key,
        });
        if (root.version !== version) return;
        this.setupResult = {
          link: location.origin + "/#staff-setup=" + this.setupToken,
          summary:
            result.displayName +
            " · " +
            result.loginId +
            " · " +
            human(result.roleCode),
          expiry: "Setup link expires " + dateTime(result.setupExpiresAtUtc),
        };
        this.setupStatus =
          "Saved. Account creation/setup is recorded in the audit log.";
        root.token("audit");
        if (!reset && root.view === "assignments")
          await root.loaders.assignments?.();
      } finally {
        root.writing = false;
        root.publish();
      }
    } catch (error) {
      if (version === root.version) {
        this.setupStatus =
          (error as Failure).status === 409
            ? "This login ID is already used, or this request changed. Check the account before retrying."
            : (error as Error).message;
        root.failure(error);
      }
    }
  }
  async copySetup() {
    if (!this.setupResult) return;
    try {
      await navigator.clipboard.writeText(this.setupResult.link);
      this.root.notice("Setup link copied. Share it privately.");
    } catch {
      this.root.notice("Select and copy the setup link.", "info");
    }
  }
}
