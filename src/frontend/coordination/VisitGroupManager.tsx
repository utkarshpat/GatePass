import { useState } from "react";
import type { Options, Contact } from "./types.ts";
import type {
  VisitRoutingGroup,
  VisitGroupMember,
} from "../../shared/VisitGroups.ts";
import { PlanningPeoplePicker } from "./PlanningPeoplePicker.tsx";
import { GroupMembers, useVisitGroups } from "./VisitGroupCatalogue.tsx";
export function VisitGroupManager({
  options,
  busy,
  onSave,
}: {
  options: Options;
  busy: boolean;
  onSave: (action: string, payload: unknown) => Promise<void>;
}) {
  const offices = options.locations.filter(
    (office) =>
      office.canManage ||
      options.projects.some(
        (project) =>
          project.locationId === office.locationId && project.canManage,
      ),
  );
  const [locationId, setLocation] = useState(
      offices.find(
        (office) =>
          office.locationId ===
          Number(new URLSearchParams(location.search).get("office")),
      )?.locationId ??
        offices[0]?.locationId ??
        0,
    ),
    [search, setSearch] = useState(""),
    [editing, setEditing] = useState<VisitRoutingGroup | null | undefined>(
      undefined,
    );
  const catalogue = useVisitGroups(locationId, search);
  const scopes = [
    ...(options.locations.find((office) => office.locationId === locationId)
      ?.canManage
      ? [{ id: "", name: "Whole office" }]
      : []),
    ...options.projects
      .filter(
        (project) =>
          project.locationId === locationId &&
          project.canManage &&
          project.active,
      )
      .map((project) => ({
        id: project.subProjectId,
        name:
          (options.accounts.find(
            (account) => account.accountOfficeId === project.accountOfficeId,
          )?.name ?? "Account") +
          " / " +
          project.name,
      })),
  ];
  return (
    <section aria-label="Visit routing group management">
      <div className="cp-toolbar">
        <div>
          <h3>Visit approval & notification groups</h3>
          <p className="cp-muted">
            Create VIP, leadership, client or other named recipient groups.
            Visit owners see every member and choose the appropriate group. Only
            scoped administrators can create or change these lists; visit owners
            cannot edit them.
          </p>
        </div>
        <button
          type="button"
          className="primary"
          disabled={busy || !scopes.length}
          onClick={() => setEditing(null)}
        >
          ＋ Create visit group
        </button>
      </div>
      <div className="cp-grid">
        <label>
          Group office
          <select
            value={locationId}
            disabled={editing !== undefined || busy}
            onChange={(e) => {
              setLocation(Number(e.target.value));
              setSearch("");
            }}
          >
            {offices.map((office) => (
              <option key={office.locationId} value={office.locationId}>
                {office.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Find visit groups
          <input
            type="search"
            maxLength={80}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {editing !== undefined && (
        <GroupEditor
          key={editing?.id ?? "new"}
          initial={editing}
          scopes={scopes}
          locationId={locationId}
          busy={busy}
          onCancel={() => setEditing(undefined)}
          onSave={async (payload) => {
            await onSave("GROUP", payload);
            setEditing(undefined);
            catalogue.refresh();
          }}
        />
      )}
      {catalogue.loading ? (
        <p role="status">Loading visit groups…</p>
      ) : catalogue.error ? (
        <p role="alert">
          Unable to load groups.{" "}
          <button
            className="secondary"
            type="button"
            onClick={catalogue.refresh}
          >
            Retry groups
          </button>
        </p>
      ) : (
        <div className="cp-group-list">
          {catalogue.rows
            .filter((group) => group.canManage)
            .map((group) => (
              <article key={group.id} className="cp-group-card">
                <div className="cp-row">
                  <h3>{group.name}</h3>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => setEditing(group)}
                  >
                    Edit group
                  </button>
                </div>
                <p>
                  {group.subProjectId
                    ? scopes.find((scope) => scope.id === group.subProjectId)
                        ?.name
                    : "Whole office"}{" "}
                  · {group.vipOnly ? "VIP visits only" : "Any visit"} ·{" "}
                  {group.active ? "Active" : "Disabled"} · Revision{" "}
                  {group.revision}
                </p>
                {group.description && <p>{group.description}</p>}
                <GroupMembers group={group} />
              </article>
            ))}
          {!catalogue.rows.some((group) => group.canManage) && (
            <p>
              No visit groups in your management scope. Create a group to start.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
function GroupEditor({
  initial,
  scopes,
  locationId,
  busy,
  onSave,
  onCancel,
}: {
  initial: VisitRoutingGroup | null;
  scopes: { id: string; name: string }[];
  locationId: number;
  busy: boolean;
  onSave: (payload: unknown) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? ""),
    [description, setDescription] = useState(initial?.description ?? ""),
    [scope, setScope] = useState(initial?.subProjectId ?? scopes[0]?.id ?? ""),
    [vip, setVip] = useState(initial?.vipOnly ?? false),
    [active, setActive] = useState(initial?.active ?? true),
    [members, setMembers] = useState<VisitGroupMember[]>(
      initial?.members ?? [],
    ),
    [person, setPerson] = useState<Contact | null>(null),
    [kind, setKind] = useState<"APPROVAL" | "NOTIFY">("NOTIFY"),
    [email, setEmail] = useState(""),
    [label, setLabel] = useState(""),
    [reason, setReason] = useState(""),
    [error, setError] = useState("");
  function add(member: VisitGroupMember) {
    if (
      members.length >= 20 ||
      members.some(
        (existing) =>
          (existing.userId ?? existing.email?.toLowerCase()) ===
          (member.userId ?? member.email?.toLowerCase()),
      )
    ) {
      setError(
        "This recipient is already in the group, or the twenty-member limit was reached.",
      );
      return;
    }
    setMembers([...members, member]);
    setPerson(null);
    setEmail("");
    setLabel("");
    setError("");
  }
  return (
    <form
      className="cp-form cp-group-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy || !members.length || !e.currentTarget.reportValidity())
          return;
        void onSave({
          ...(initial ? { id: initial.id } : {}),
          ...(scope ? { subProjectId: scope } : { locationId }),
          name: name.trim(),
          description: description.trim(),
          vipOnly: vip,
          active,
          revision: initial?.revision ?? 0,
          reason: reason.trim(),
          members: members.map((member) =>
            member.userId
              ? { userId: member.userId, kind: member.kind }
              : {
                  email: member.email?.trim().toLowerCase(),
                  kind: "NOTIFY",
                  ...(member.name ? { name: member.name } : {}),
                },
          ),
        }).catch(() => {});
      }}
    >
      <h3>{initial ? "Edit visit group" : "Create visit group"}</h3>
      <div className="cp-grid">
        <label>
          Group name
          <input
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Noida VIP approval and notification"
          />
        </label>
        <label>
          Group scope
          <select
            disabled={!!initial}
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            {scopes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Group description
        <textarea
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className="cp-check">
        <input
          type="checkbox"
          checked={vip}
          onChange={(e) => setVip(e.target.checked)}
        />
        Show this group for VIP visits only
      </label>
      <label className="cp-check">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        Group active
      </label>
      <fieldset>
        <legend>Add internal employee</legend>
        <PlanningPeoplePicker
          key={scope + "-" + locationId}
          label="Group employee"
          locationId={locationId}
          value={person}
          onChange={setPerson}
        />
        <div className="cp-grid">
          <label>
            Member role
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="NOTIFY">Notify only</option>
              <option value="APPROVAL">Required approval</option>
            </select>
          </label>
          <button
            type="button"
            className="secondary"
            disabled={!person || busy || members.length >= 20}
            onClick={() => {
              if (person)
                add({
                  userId: person.userId,
                  name: person.name,
                  email: person.email,
                  kind,
                });
            }}
          >
            Add employee to group
          </button>
        </div>
      </fieldset>
      <fieldset>
        <legend>Add notification email</legend>
        <p className="cp-muted">
          An email or distribution list can be notified; approval always
          requires an authorized internal employee. Use employee search for
          directory users.
        </p>
        <div className="cp-grid">
          <label>
            Notification email
            <input
              type="email"
              maxLength={320}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Email display name (optional)
            <input
              maxLength={200}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
        </div>
        <button
          type="button"
          className="secondary"
          disabled={
            busy ||
            members.length >= 20 ||
            !email.trim() ||
            !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(email.trim())
          }
          onClick={() =>
            add({
              email: email.trim().toLowerCase(),
              ...(label.trim() ? { name: label.trim() } : {}),
              kind: "NOTIFY",
            })
          }
        >
          Add notification email
        </button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <ul className="cp-group-edit-members">
        {members.map((member, index) => (
          <li key={member.userId ?? member.email ?? index}>
            <span>
              <strong>{member.name ?? member.email}</strong>
              <small>
                {member.kind === "APPROVAL"
                  ? "Required approval"
                  : "Notify only"}
                {member.email ? " · " + member.email : ""}
              </small>
            </span>
            <button
              type="button"
              className="quiet"
              aria-label={
                "Remove group member " + (member.name ?? member.email)
              }
              onClick={() => setMembers(members.filter((_, i) => i !== index))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <label>
        Reason for group change
        <input
          required
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="cp-actions">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel group edit
        </button>
        <button className="primary" disabled={busy || !members.length}>
          Save visit group
        </button>
      </div>
      <p className="cp-muted">
        Group changes are audited. Existing invitations using this group must be
        revised before proceeding under the new membership.
      </p>
    </form>
  );
}
