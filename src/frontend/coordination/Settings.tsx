import { useState, type FormEvent } from "react";
import type { Contact, Definition, Options, Rule } from "./types.ts";
import { projectLabel } from "./types.ts";
export function PeopleSelect({
  label,
  people,
  value,
  onChange,
  required = false,
}: {
  label: string;
  people: Contact[];
  value: string[];
  onChange: (value: string[]) => void;
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <select
        multiple
        required={required}
        value={value}
        onChange={(e) =>
          onChange([...e.currentTarget.selectedOptions].map((o) => o.value))
        }
      >
        {value
          .filter((id) => !people.some((p) => p.userId === id))
          .map((id) => (
            <option value={id} key={id}>
              Configured contact (outside current search)
            </option>
          ))}
        {people.map((p) => (
          <option value={p.userId} key={p.userId}>
            {p.name}
            {p.email ? " · " + p.email : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
const blankRule = (location: boolean): Rule => ({
  id: crypto.randomUUID(),
  name: location ? "Office security" : "Project authority",
  kind: location ? "SECURITY" : "PROJECT",
  mode: "ALL",
  approverIds: [],
});
function PolicyEditor({
  location,
  initial,
  busy,
  people,
  onSave,
}: {
  location: boolean;
  initial?: Definition;
  busy: boolean;
  people: Contact[];
  onSave: (definition: Definition, reason: string) => Promise<void>;
}) {
  const [definition, setDefinition] = useState<Definition>(() =>
      structuredClone(
        initial ?? {
          approvalRules: [blankRule(location)],
          ...(location
            ? {
                arrangements: [],
                receptionIds: [],
                securityIds: [],
                notifyIds: [],
                vipNotifyIds: [],
                maximumAdvanceDays: 90,
                maximumVisitDays: 30,
              }
            : {}),
        },
      ),
    ),
    [reason, setReason] = useState("");
  const set = (patch: Partial<Definition>) =>
    setDefinition((d) => ({ ...d, ...patch }));
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!busy && e.currentTarget.reportValidity())
      await onSave(definition, reason.trim()).catch(() => {});
  }
  return (
    <form className="cp-form" onSubmit={submit}>
      <p className="cp-muted">
        Office requirements always apply. ALL needs every assigned authority;
        ANY closes on the first assigned decision. The invitation host cannot
        independently approve their own request.
      </p>
      {definition.approvalRules.map((r, index) => (
        <fieldset key={r.id}>
          <legend>Approval step {index + 1}</legend>
          <div className="cp-grid">
            <label>
              Step name
              <input
                required
                maxLength={120}
                value={r.name}
                onChange={(e) =>
                  set({
                    approvalRules: definition.approvalRules.map((x) =>
                      x.id === r.id ? { ...x, name: e.target.value } : x,
                    ),
                  })
                }
              />
            </label>
            <label>
              Responsibility
              <select
                value={r.kind}
                onChange={(e) =>
                  set({
                    approvalRules: definition.approvalRules.map((x) =>
                      x.id === r.id
                        ? { ...x, kind: e.target.value as Rule["kind"] }
                        : x,
                    ),
                  })
                }
              >
                <option value="PROJECT">Project authority</option>
                <option value="SECURITY">Security</option>
                <option value="CLIENT_CONFIRMATION">
                  Internal client coordinator
                </option>
              </select>
            </label>
            <label>
              Decision rule
              <select
                value={r.mode}
                onChange={(e) =>
                  set({
                    approvalRules: definition.approvalRules.map((x) =>
                      x.id === r.id
                        ? { ...x, mode: e.target.value as Rule["mode"] }
                        : x,
                    ),
                  })
                }
              >
                <option value="ALL">All must approve</option>
                <option value="ANY">Any one decides</option>
              </select>
            </label>
            <PeopleSelect
              label="Authorized internal approvers"
              people={people}
              value={r.approverIds}
              required
              onChange={(approverIds) =>
                set({
                  approvalRules: definition.approvalRules.map((x) =>
                    x.id === r.id ? { ...x, approverIds } : x,
                  ),
                })
              }
            />
          </div>
          {definition.approvalRules.length > 1 && (
            <button
              type="button"
              className="quiet"
              onClick={() =>
                set({
                  approvalRules: definition.approvalRules.filter(
                    (x) => x.id !== r.id,
                  ),
                })
              }
            >
              Remove step
            </button>
          )}
        </fieldset>
      ))}
      <button
        type="button"
        className="secondary"
        disabled={busy || definition.approvalRules.length >= 50}
        onClick={() =>
          set({
            approvalRules: [...definition.approvalRules, blankRule(location)],
          })
        }
      >
        Add approval step
      </button>
      {location && (
        <>
          <div className="cp-grid">
            <label>
              Maximum advance days
              <input
                type="number"
                min={1}
                max={366}
                required
                value={definition.maximumAdvanceDays}
                onChange={(e) =>
                  set({ maximumAdvanceDays: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Maximum visit days
              <input
                type="number"
                min={1}
                max={366}
                required
                value={definition.maximumVisitDays}
                onChange={(e) =>
                  set({ maximumVisitDays: Number(e.target.value) })
                }
              />
            </label>
          </div>
          {(definition.arrangements ?? []).map((t) => (
            <fieldset key={t.id}>
              <legend>Arrangement responsibility</legend>
              <div className="cp-grid">
                <label>
                  Name
                  <input
                    required
                    maxLength={120}
                    value={t.name}
                    onChange={(e) =>
                      set({
                        arrangements: definition.arrangements!.map((x) =>
                          x.id === t.id ? { ...x, name: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Type
                  <select
                    value={t.kind}
                    onChange={(e) =>
                      set({
                        arrangements: definition.arrangements!.map((x) =>
                          x.id === t.id
                            ? { ...x, kind: e.target.value as "STAY" | "OTHER" }
                            : x,
                        ),
                      })
                    }
                  >
                    <option value="STAY">Stay — when requested</option>
                    <option value="OTHER">Other — every visit</option>
                  </select>
                </label>
                <PeopleSelect
                  label="Assigned arrangement owners"
                  people={people}
                  value={t.ownerIds}
                  required
                  onChange={(ownerIds) =>
                    set({
                      arrangements: definition.arrangements!.map((x) =>
                        x.id === t.id ? { ...x, ownerIds } : x,
                      ),
                    })
                  }
                />
                <label className="cp-check">
                  <input
                    type="checkbox"
                    checked={t.mandatoryForEntry}
                    onChange={(e) =>
                      set({
                        arrangements: definition.arrangements!.map((x) =>
                          x.id === t.id
                            ? { ...x, mandatoryForEntry: e.target.checked }
                            : x,
                        ),
                      })
                    }
                  />
                  Required for planning readiness
                </label>
              </div>
              <button
                className="quiet"
                type="button"
                onClick={() =>
                  set({
                    arrangements: definition.arrangements!.filter(
                      (x) => x.id !== t.id,
                    ),
                  })
                }
              >
                Remove arrangement
              </button>
            </fieldset>
          ))}
          <button
            className="secondary"
            type="button"
            disabled={busy || (definition.arrangements?.length ?? 0) >= 20}
            onClick={() =>
              set({
                arrangements: [
                  ...(definition.arrangements ?? []),
                  {
                    id: crypto.randomUUID(),
                    name: "Stay arrangement",
                    kind: "STAY",
                    mandatoryForEntry: false,
                    ownerIds: [],
                  },
                ],
              })
            }
          >
            Add arrangement responsibility
          </button>
          <fieldset>
            <legend>Participants and people to inform</legend>
            <p className="cp-muted">
              FYI recipients receive a notice; they do not gain workspace or
              discussion access.
            </p>
            <div className="cp-grid">
              {(
                [
                  "receptionIds",
                  "securityIds",
                  "notifyIds",
                  "vipNotifyIds",
                ] as const
              ).map((key, index) => (
                <PeopleSelect
                  key={key}
                  label={
                    [
                      "Reception participants",
                      "Security participants",
                      "Standard FYI recipients",
                      "Leadership / VIP FYI recipients",
                    ][index]
                  }
                  people={people}
                  value={definition[key] ?? []}
                  onChange={(ids) => set({ [key]: ids })}
                />
              ))}
            </div>
          </fieldset>
        </>
      )}
      <label>
        Reason for policy change
        <input
          required
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <button className="primary" disabled={busy}>
        Save policy
      </button>
    </form>
  );
}
export function PlanningSettings({
  options,
  busy,
  onSave,
  onSearch,
}: {
  options: Options;
  busy: boolean;
  onSave: (action: string, payload: unknown) => Promise<void>;
  onSearch: (search: string) => void;
}) {
  const targets = [
    ...options.locations
      .filter((l) => l.canManage)
      .map((l) => ({
        key: "office:" + l.locationId,
        name: "Office — " + l.name,
        locationId: l.locationId,
        subProjectId: undefined as string | undefined,
      })),
    ...options.projects
      .filter((p) => p.canManage)
      .map((p) => ({
        key: p.subProjectId,
        name:
          "Project — " +
          projectLabel(options, p) +
          " · " +
          (options.locations.find((l) => l.locationId === p.locationId)?.name ??
            ""),
        locationId: p.locationId,
        subProjectId: p.subProjectId,
      })),
  ];
  const [target, setTarget] = useState(targets[0]?.key ?? ""),
    [section, setSection] = useState("projects"),
    [name, setName] = useState(""),
    [account, setAccount] = useState(
      options.accounts.find((a) => a.canManage)?.accountOfficeId ?? "",
    ),
    [editProject, setEditProject] = useState(""),
    [active, setActive] = useState(true),
    [reason, setReason] = useState(""),
    [user, setUser] = useState(""),
    [peopleSearch, setPeopleSearch] = useState("");
  const selected = targets.find((t) => t.key === target),
    scope = selected?.subProjectId
      ? { subProjectId: selected.subProjectId }
      : { locationId: selected?.locationId };
  const policy = options.policies.find(
    (p) =>
      selected &&
      (selected.subProjectId
        ? p.subProjectId === selected.subProjectId
        : !p.subProjectId && p.locationId === selected.locationId),
  );
  const hosts = options.hosts.filter(
    (h) =>
      selected &&
      (selected.subProjectId
        ? h.subProjectId === selected.subProjectId
        : !h.subProjectId && h.locationId === selected.locationId),
  );
  async function project(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const existing = options.projects.find(
        (p) => p.subProjectId === editProject,
      ),
      parent = options.accounts.find((a) => a.accountOfficeId === account);
    try {
      await onSave("PROJECT", {
        ...(existing
          ? { subProjectId: existing.subProjectId }
          : { locationId: parent?.locationId, accountOfficeId: account }),
        name: name.trim(),
        active,
        revision: existing?.revision ?? 0,
        reason: reason.trim(),
      });
      setName("");
      setEditProject("");
      setReason("");
    } catch {}
  }
  async function host(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected || busy) return;
    const existing = hosts.find((h) => h.userId === user);
    try {
      await onSave("HOST", {
        ...scope,
        userId: user,
        active: true,
        revision: existing?.revision ?? 0,
        reason: reason.trim(),
      });
      setReason("");
    } catch {}
  }
  return (
    <section className="cp-card">
      <h2>Planning settings</h2>
      <nav className="cp-tabs" aria-label="Planning settings">
        {[
          ["projects", "Sub-projects"],
          ["hosts", "Approved hosts"],
          ["policies", "Policies & responsibilities"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={section === key ? "selected" : ""}
            onClick={() => setSection(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      {section === "projects" ? (
        <>
          <form className="cp-form" onSubmit={project}>
            <div className="cp-grid">
              <label>
                Account / office
                <select
                  value={account}
                  disabled={!!editProject}
                  required
                  onChange={(e) => setAccount(e.target.value)}
                >
                  <option value="">Select account</option>
                  {options.accounts
                    .filter((a) => a.canManage)
                    .map((a) => (
                      <option key={a.accountOfficeId} value={a.accountOfficeId}>
                        {a.name} ·{" "}
                        {
                          options.locations.find(
                            (l) => l.locationId === a.locationId,
                          )?.name
                        }
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Sub-project name
                <input
                  required
                  maxLength={200}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                Reason
                <input
                  required
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <label className="cp-check">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                />
                Active
              </label>
            </div>
            <button className="primary" disabled={busy || !account}>
              {editProject ? "Update sub-project" : "Create sub-project"}
            </button>
            {editProject && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setEditProject("");
                  setName("");
                  setActive(true);
                }}
              >
                Cancel edit
              </button>
            )}
          </form>
          <div className="cp-list">
            {options.projects
              .filter((p) => p.canManage)
              .map((p) => (
                <div key={p.subProjectId} className="cp-row">
                  <span>
                    <strong>{p.name}</strong>
                    <small>
                      {
                        options.accounts.find(
                          (a) => a.accountOfficeId === p.accountOfficeId,
                        )?.name
                      }{" "}
                      ·{" "}
                      {
                        options.locations.find(
                          (l) => l.locationId === p.locationId,
                        )?.name
                      }{" "}
                      · {p.active ? "Active" : "Inactive"}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setEditProject(p.subProjectId);
                      setName(p.name);
                      setAccount(p.accountOfficeId);
                      setActive(p.active);
                    }}
                  >
                    Edit
                  </button>
                </div>
              ))}
          </div>
        </>
      ) : (
        <>
          <div className="cp-grid">
            <label>
              Scope
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">Select scope</option>
                {targets.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onSearch(peopleSearch.trim());
              }}
            >
              <label>
                Find internal contacts
                <input
                  minLength={2}
                  maxLength={80}
                  value={peopleSearch}
                  onChange={(e) => setPeopleSearch(e.target.value)}
                  placeholder="Name or email"
                />
              </label>
              <button
                className="secondary"
                disabled={busy || peopleSearch.trim().length < 2}
              >
                Search people
              </button>
            </form>
          </div>
          {selected &&
            (section === "policies" ? (
              <PolicyEditor
                key={target + ":" + (policy?.revision ?? 0)}
                location={!selected.subProjectId}
                initial={policy?.definition}
                busy={busy}
                people={options.people}
                onSave={(definition, reason) =>
                  onSave("POLICY", {
                    ...scope,
                    revision: policy?.revision ?? 0,
                    definition,
                    reason,
                  })
                }
              />
            ) : (
              <>
                <p className="cp-muted">
                  Sub-project hosts must also be currently eligible, approved
                  account-office hosts. Adding a host does not grant project
                  entry or administrator access. This roster does not restrict an approved
                    office host from requesting visits to other destinations.
                </p>
                <form className="cp-form" onSubmit={host}>
                  <div className="cp-grid">
                    <label>
                      Internal employee
                      <select
                        value={user}
                        required
                        onChange={(e) => setUser(e.target.value)}
                      >
                        <option value="">Select employee</option>
                        {options.people
                          .filter(
                            (p) =>
                              !hosts.some(
                                (h) => h.userId === p.userId && h.active,
                              ),
                          )
                          .map((p) => (
                            <option value={p.userId} key={p.userId}>
                              {p.name} · {p.email}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Reason
                      <input
                        required
                        maxLength={500}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </label>
                  </div>
                  <button className="primary" disabled={busy || !user}>
                    Add approved host
                  </button>
                </form>
                <div className="cp-list">
                  {hosts.map((h) => (
                    <div className="cp-row" key={h.userId}>
                      <span>
                        <strong>{h.name}</strong>
                        <small>
                          {h.email} · {h.active ? "Active" : "Removed"}
                        </small>
                      </span>
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy || !reason.trim()}
                        onClick={() =>
                          onSave("HOST", {
                            ...scope,
                            userId: h.userId,
                            active: !h.active,
                            revision: h.revision,
                            reason: reason.trim(),
                          }).catch(() => {})
                        }
                      >
                        {h.active ? "Remove" : "Restore"}
                      </button>
                    </div>
                  ))}
                </div>
                <p className="cp-muted">
                  Enter a reason above before removing or restoring a host.
                </p>
              </>
            ))}
        </>
      )}
    </section>
  );
}
