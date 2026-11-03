import { VisitGroupManager } from "./VisitGroupManager.tsx";
import { useState, type FormEvent } from "react";
import type { Options } from "./types.ts";
import { PolicyEditor } from "./PolicyEditor.tsx";
export { PeopleSelect } from "./PeopleSelect.tsx";
import { projectLabel } from "./types.ts";
export function PlanningSettings({
  options,
  busy,
  onSave,
  onSearch,
  section: fixedSection,
  accountId,
}: {
  section?: "projects" | "hosts" | "policies" | "groups";
  accountId?: string;
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
  const [target, setTarget] = useState(
      (accountId
        ? targets.find(
            (t) =>
              t.subProjectId &&
              options.projects.some(
                (p) =>
                  p.subProjectId === t.subProjectId &&
                  p.accountOfficeId === accountId,
              ),
          )?.key
        : undefined) ??
        targets[0]?.key ??
        "",
    ),
    [section, setSection] = useState<string>(
      fixedSection ??
        (new URLSearchParams(location.search).get("settings") === "groups"
          ? "groups"
          : "projects"),
    ),
    [name, setName] = useState(""),
    [account, setAccount] = useState(
      (options.accounts.some(
        (a) => a.accountOfficeId === accountId && a.canManage,
      )
        ? accountId
        : undefined) ??
        options.accounts.find((a) => a.canManage)?.accountOfficeId ??
        "",
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
      <h3>
        {section === "groups"
          ? "Approval & notification groups"
          : section === "policies"
            ? "Approvals & responsibilities"
            : "Projects & visit hosts"}
      </h3>
      {!fixedSection && (
        <nav className="cp-tabs" aria-label="Visit setup">
          {[
            ["projects", "Sub-projects"],
            ["hosts", "Approved hosts"],
            ["policies", "Policies & responsibilities"],
            ["groups", "Visit groups"],
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
      )}
      {fixedSection === "projects" && (
        <nav className="cp-tabs" aria-label="Account project setup">
          {[
            ["projects", "Projects"],
            ["hosts", "Project / office hosts"],
          ].map(([key, label]) => (
            <button
              type="button"
              key={key}
              aria-pressed={section === key}
              className={section === key ? "selected" : ""}
              onClick={() => setSection(key)}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
      {section === "groups" ? (
        <VisitGroupManager options={options} busy={busy} onSave={onSave} />
      ) : section === "projects" ? (
        <>
          <form className="cp-form" onSubmit={project}>
            <div className="cp-grid">
              <label>
                Account / office
                <select
                  value={account}
                  disabled={!!editProject}
                  required
                  onChange={(e) => {
                    setAccount(e.target.value);
                    setReason("");
                  }}
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
                Project name
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
              {editProject ? "Update project" : "Create project"}
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
              .filter(
                (p) =>
                  p.canManage && (!account || p.accountOfficeId === account),
              )
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
                      setTarget(p.subProjectId);
                      setSection("hosts");
                      setUser("");
                      setReason("");
                    }}
                  >
                    Manage visit hosts
                  </button>
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
                {targets
                  .filter(
                    (t) =>
                      !fixedSection ||
                      fixedSection !== "projects" ||
                      !t.subProjectId ||
                      options.projects.some(
                        (p) =>
                          p.subProjectId === t.subProjectId &&
                          p.accountOfficeId === account,
                      ),
                  )
                  .map((t) => (
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
                  entry or administrator access. This roster does not restrict
                  an approved office host from requesting visits to other
                  destinations.
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
