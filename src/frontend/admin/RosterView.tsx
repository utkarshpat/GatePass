import type { AdminModel } from "./model.ts";
import type { Duty } from "./types.ts";
import { initials } from "./types.ts";
import { Stat } from "./Overview.tsx";
import type { PersonDuty } from "./roster.ts";
const shortDay = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
  }).format(new Date(value));
function period(duty: Duty) {
  return (
    (Date.parse(duty.validFromUtc) > Date.now()
      ? "from " + shortDay(duty.validFromUtc) + " "
      : "") +
    (duty.validUntilUtc
      ? "until " + shortDay(duty.validUntilUtc)
      : "no end date")
  );
}
function DutyChip({
  model,
  duty,
  name,
  project = true,
}: {
  model: AdminModel;
  duty: PersonDuty;
  name: string;
  project?: boolean;
}) {
  const roster = model.roster;
  if (duty.kind === "common")
    return (
      <span className="duty-chip common">
        <span>{duty.areaName}</span>
        <small>Common area</small>
      </span>
    );
  const group = roster.groups.find((g) => g.groupId === duty.groupId),
    removable = duty.groupAssignmentId
      ? !!model.scope?.canManageProjectGroups && !!group
      : !!model.scope?.canAssignGuards;
  return (
    <span
      className="duty-chip"
      title={
        duty.groupAssignmentId
          ? (group?.projects.map((p) => p.projectName).join(", ") ??
            duty.projectName)
          : undefined
      }
    >
      <span>{project ? (duty.groupName ?? duty.projectName) : name}</span>
      <small>{(duty.groupName ? "Group · " : "") + period(duty)}</small>
      {removable && (
        <button
          type="button"
          className="chip-remove"
          disabled={model.writing}
          aria-label={
            "Remove " +
            name +
            " from " +
            (duty.groupAssignmentId
              ? "group " + duty.groupName
              : duty.projectName)
          }
          onClick={() => roster.removeDuty(duty, name)}
        >
          ×
        </button>
      )}
    </span>
  );
}
export function GuardStats({ model }: { model: AdminModel }) {
  const r = model.roster,
    people = r.people(),
    assigned = people.filter((p) => p.duties.length).length,
    incomplete = !!r.deniedProjects.length,
    covered = new Set(r.duties.map((d) => d.projectLocationId)).size,
    uncovered = r.projects().length - covered;
  return (
    <>
      <Stat
        label={incomplete ? "Visible guards" : "Total guards"}
        value={people.length}
        tone="total"
      />
      <Stat
        label={incomplete ? "Known assigned" : "Assigned"}
        value={assigned}
        tone="approved"
      />
      <Stat
        label="Free"
        value={incomplete ? "—" : people.length - assigned}
        tone="pending"
      />
      <Stat
        label="Accounts without a guard"
        value={incomplete ? "—" : uncovered}
        tone={incomplete || uncovered ? "denied" : "approved"}
      />
    </>
  );
}
export function RosterRows({ model }: { model: AdminModel }) {
  const r = model.roster,
    people = r.shownPeople();
  return people.length ? (
    people.map((person, i) => (
      <article
        className="roster-row"
        data-user-id={person.userId}
        key={person.userId}
      >
        <span
          className={"roster-avatar avatar-tone-" + (i % 5)}
          aria-hidden="true"
        >
          {initials(person.name)}
        </span>
        <div className="roster-person">
          <strong>{person.name}</strong>
          <span
            className={
              "status-chip " +
              (person.duties.length
                ? "info"
                : r.deniedProjects.length
                  ? "warn"
                  : "ok")
            }
          >
            {person.duties.length
              ? person.duties.length +
                (person.duties.length === 1 ? " duty" : " duties")
              : r.deniedProjects.length
                ? "Availability unknown"
                : "Free"}
          </span>
        </div>
        <div className="duty-chips">
          {!person.duties.length && (
            <span className="roster-free">
              {r.deniedProjects.length
                ? "Some account duties are unavailable."
                : "Not assigned to any account"}
            </span>
          )}
          {person.duties.map((duty, j) => (
            <DutyChip key={j} model={model} duty={duty} name={person.name} />
          ))}
        </div>
        {model.scope?.canAssignGuards && (
          <button
            type="button"
            className="secondary"
            disabled={model.writing}
            aria-label={"Assign " + person.name + " to a account"}
            onClick={() => void r.openAssign({ guardId: person.userId })}
          >
            Assign
          </button>
        )}
      </article>
    ))
  ) : (
    <p className="empty-note">
      {r.people().length
        ? "No guards match these filters."
        : "No guards found for this office."}
    </p>
  );
}
export function ProjectRoster({ model }: { model: AdminModel }) {
  const r = model.roster,
    q = r.search.trim().toLowerCase(),
    projects = r
      .projects()
      .map((p, i) => ({
        p,
        i,
        duties: r.duties.filter(
          (d) => d.projectLocationId === p.projectLocationId,
        ),
      }))
      .filter(
        ({ p, duties }) =>
          r.keep(duties.length > 0) &&
          (!q ||
            (p.projectName + " " + p.projectCode).toLowerCase().includes(q) ||
            duties.some((d) => d.guardName.toLowerCase().includes(q))),
      );
  return (
    <>
      {projects.map(({ p, i, duties }) => {
        const guards = new Set(duties.map((d) => d.userId)).size;
        return (
          <article key={p.projectLocationId} className="roster-project">
            <div className="roster-project-head">
              <span
                className={"project-avatar avatar-tone-" + (i % 5)}
                aria-hidden="true"
              >
                {initials(p.projectName)}
              </span>
              <div>
                <span className="workspace-kind">Account</span>
                <h3>{p.projectName}</h3>
                <p className="project-code">{p.projectCode}</p>
              </div>
              <span className={"status-chip " + (guards ? "info" : "warn")}>
                {guards
                  ? guards + (guards === 1 ? " guard" : " guards")
                  : "No guard"}
              </span>
            </div>
            <div className="duty-chips">
              {!duties.length && (
                <span className="roster-free">Nobody is posted here yet</span>
              )}
              {duties.map((duty, j) => (
                <DutyChip
                  key={j}
                  model={model}
                  duty={{ ...duty, kind: "project" }}
                  name={duty.guardName}
                  project={false}
                />
              ))}
            </div>
            {model.scope?.canAssignGuards && (
              <div className="project-card-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={model.writing}
                  aria-label={"Assign a guard to " + p.projectName}
                  onClick={() =>
                    void r.openAssign({
                      projectLocationId: p.projectLocationId,
                    })
                  }
                >
                  Assign guard
                </button>
              </div>
            )}
          </article>
        );
      })}
      {r.common.length > 0 && r.filter !== "free" && (
        <article className="roster-project">
          <div className="roster-project-head">
            <div>
              <h3>Common areas</h3>
              <p className="hint">Managed from Accounts & leads</p>
            </div>
            <span className="status-chip info">
              {r.common.length + (r.common.length === 1 ? " guard" : " guards")}
            </span>
          </div>
          <div className="duty-chips">
            {r.common.map((d) => (
              <span key={d.assignmentId} className="duty-chip common">
                <span>{d.guardName}</span>
                <small>{d.areaName}</small>
              </span>
            ))}
          </div>
        </article>
      )}
      {!projects.length && !r.common.length && (
        <p className="empty-note">No accounts match these filters.</p>
      )}
    </>
  );
}
export function Groups({ model }: { model: AdminModel }) {
  const r = model.roster;
  return (
    <>
      {r.groups.map((group) => (
        <article key={group.groupId} className="roster-project">
          <div className="roster-project-head">
            <div>
              <span className="workspace-kind">Active</span>
              <h3>{group.name}</h3>
              <p className="hint">
                {group.projects.map((p) => p.projectName).join(" · ")}
              </p>
            </div>
            <span className="status-chip info">
              {group.projects.length +
                " accounts / " +
                group.assignments.length +
                " guards"}
            </span>
          </div>
          <p className="hint">
            {group.assignments.length
              ? "Assigned: " +
                group.assignments.map((a) => a.guardName).join(", ")
              : "No guards assigned"}
          </p>
          <p className="hint">
            Assign or remove guards from Guard assignments.
          </p>
          <div className="project-card-actions">
            <button
              type="button"
              className="quiet"
              disabled={model.writing}
              onClick={() => void r.openGroup(group)}
            >
              Edit group
            </button>
            <button
              type="button"
              className="quiet"
              disabled={model.writing}
              onClick={() => r.archive(group)}
            >
              Archive group
            </button>
          </div>
        </article>
      ))}
      {r.groupsLoaded && !r.groups.length && (
        <p className="hint">
          No groups yet. Create a floor or entry group, then assign it from
          Guard assignments.
        </p>
      )}
    </>
  );
}
export function GroupMembers({ model }: { model: AdminModel }) {
  return model.roster.groupChoices.map((project) => (
    <label key={project.projectLocationId} className="group-project-option">
      <input
        type="checkbox"
        value={project.projectLocationId}
        checked={model.roster.members.includes(project.projectLocationId)}
        disabled={model.writing}
        onChange={(event) =>
          model.roster.toggleMember(
            project.projectLocationId,
            event.target.checked,
          )
        }
      />
      <span>{project.projectName + " · " + project.projectCode}</span>
    </label>
  ));
}
