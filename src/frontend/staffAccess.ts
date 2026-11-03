export const staffDestinations = {
  ADMIN: "/admin",
  RECEPTION: "/reception",
  GUARD: "/guard",
  COORDINATION: "/coordination",
} as const;
export type StaffSection = keyof typeof staffDestinations;
export type AdminSection =
  | "overview"
  | "projects"
  | "staff"
  | "assignments"
  | "offices"
  | "reports"
  | "audit";
export type StaffAccess = {
  displayName: string;
  workspaces: { code: StaffSection; name: string }[];
  adminSections?: AdminSection[];
};
export function parseStaffAccess(value: unknown): StaffAccess {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("INVALID_STAFF_ACCESS");
  const row = value as Record<string, unknown>;
  if (
    typeof row.displayName !== "string" ||
    row.displayName.length > 200 ||
    !Array.isArray(row.workspaces) ||
    row.workspaces.length > 4
  )
    throw Error("INVALID_STAFF_ACCESS");
  const workspaces = row.workspaces.map((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error("INVALID_STAFF_ACCESS");
    const item = value as Record<string, unknown>;
    if (
      typeof item.code !== "string" ||
      !Object.hasOwn(staffDestinations, item.code) ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      item.name.length > 100
    )
      throw Error("INVALID_STAFF_ACCESS");
    return { code: item.code as StaffSection, name: item.name };
  });
  if (new Set(workspaces.map((item) => item.code)).size !== workspaces.length)
    throw Error("INVALID_STAFF_ACCESS");
  const capabilities = new Set<string>();
  if (Array.isArray(row.grants))
    for (const raw of row.grants) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const grant = raw as Record<string, unknown>;
      if (
        ![
          "PLATFORM_ADMIN",
          "INDIA_ADMIN",
          "LOCATION_ADMIN",
          "PROJECT_ADMIN",
        ].includes(String(grant.roleCode)) ||
        !Array.isArray(grant.capabilities)
      )
        continue;
      for (const code of grant.capabilities)
        if (typeof code === "string") capabilities.add(code);
    }
  const required: Record<AdminSection, string | null> = {
    overview: "REPORTS_READ",
    projects: null,
    staff: "ROLE_GRANTS_MANAGE",
    assignments: "GUARDS_MANAGE",
    offices: null,
    reports: "VISITS_READ",
    audit: "AUDIT_READ",
  };
  const adminSections = workspaces.some((item) => item.code === "ADMIN")
    ? (Object.keys(required) as AdminSection[]).filter(
        (view) => required[view] === null || capabilities.has(required[view]!),
      )
    : undefined;
  return {
    displayName: row.displayName,
    workspaces,
    ...(adminSections ? { adminSections } : {}),
  };
}
/** Login always opens an authorized section. Query parameters cannot enable a chooser or a new destination. */
export function staffLanding(access: StaffAccess): string | null {
  const code = (Object.keys(staffDestinations) as StaffSection[]).find((code) =>
    access.workspaces.some((item) => item.code === code),
  );
  return code ? staffDestinations[code] : null;
}
