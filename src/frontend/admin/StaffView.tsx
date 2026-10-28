import type { ReactNode } from "react";
import type { AdminModel } from "./model.ts";
import { dateTime, human, roleCaps } from "./types.ts";
export function Row({
  children,
  lines,
  userId,
}: {
  children?: ReactNode;
  lines: string[];
  userId?: string;
}) {
  return (
    <article className="admin-row" data-user-id={userId}>
      <div>
        {lines.map((text, i) =>
          i ? (
            <p key={i} className="hint">
              {text}
            </p>
          ) : (
            <strong key={i}>{text}</strong>
          ),
        )}
      </div>
      {children}
    </article>
  );
}
export function Subjects({ model }: { model: AdminModel }) {
  return model.staff.subjects.map((user) => (
    <Row
      key={user.userId}
      userId={user.userId}
      lines={[
        user.displayName,
        user.active ? "Active identity" : "Inactive identity",
      ]}
    >
      <button
        type="button"
        className="secondary"
        disabled={model.writing}
        onClick={() => model.staff.select(user)}
      >
        Manage access
      </button>
    </Row>
  ));
}
export function Roles({ model }: { model: AdminModel }) {
  const staff = model.staff;
  return staff.grants.length ? (
    staff.grants.map((grant) => (
      <Row
        key={grant.roleGrantId}
        lines={[
          human(grant.roleCode) + " · " + staff.grantScope(grant),
          grant.capabilities.map(human).join(" · "),
          dateTime(grant.validFromUtc) +
            " → " +
            dateTime(grant.validUntilUtc) +
            (grant.revoked ? " · Revoked" : ""),
        ]}
      >
        {!grant.revoked &&
          !(
            grant.validUntilUtc && Date.parse(grant.validUntilUtc) <= Date.now()
          ) &&
          staff.mayRevoke(grant) && (
            <button
              type="button"
              className="quiet"
              disabled={model.writing}
              onClick={() => staff.revoke(grant)}
            >
              Revoke
            </button>
          )}
      </Row>
    ))
  ) : (
    <p className="hint">No roles in your permitted scope.</p>
  );
}
export function Capabilities({
  model,
  setup = false,
}: {
  model: AdminModel;
  setup?: boolean;
}) {
  const group = setup ? "new-staff-capabilities" : "staff-capabilities",
    role = setup
      ? model.field("new-staff-role")
      : model.scope?.delegations[Number(model.field("staff-role"))]?.roleCode;
  return (
    <>
      {setup && <legend>Permissions</legend>}
      {(roleCaps[role ?? ""] ?? []).map((capability) => (
        <label key={capability}>
          <input
            type="checkbox"
            value={capability}
            checked={(model.capabilities[group] ?? []).includes(capability)}
            disabled={model.writing}
            onChange={(event) => {
              if (model.writing) return;
              const selected = model.capabilities[group] ?? [];
              model.capabilities[group] = event.target.checked
                ? [...new Set([...selected, capability])]
                : selected.filter((v) => v !== capability);
              model.publish();
            }}
          />
          {human(capability)}
        </label>
      ))}
    </>
  );
}
export function Profile({ model }: { model: AdminModel }) {
  const profile = model.profile;
  return (
    profile && (
      <>
        <Row
          lines={[
            profile.name,
            ...profile.scope.roles.map(
              (role) => human(role.roleCode) + " · " + human(role.scopeType),
            ),
          ]}
        />
        {profile.offices.map((office) => (
          <Row
            key={office.locationId}
            lines={[office.locationName, office.locationCode]}
          />
        ))}
        <Row
          lines={[
            "Accounts in " + model.office?.locationName,
            ...profile.projects.map((project) => project.projectName),
          ]}
        />
      </>
    )
  );
}
