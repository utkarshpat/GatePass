import { useEffect, useState } from "react";
import type {
  VisitRoutingGroup,
  VisitGroupReference,
} from "../../shared/VisitGroups.ts";
import { coordinationRequest } from "./client.ts";
export function useVisitGroups(locationId: number, search = "") {
  const [state, setState] = useState<{
      rows: VisitRoutingGroup[];
      loading: boolean;
      error: boolean;
    }>({ rows: [], loading: true, error: false }),
    [revision, refresh] = useState(0);
  useEffect(() => {
    let live = true;
    const controller = new AbortController(),
      timer = window.setTimeout(() => controller.abort(), 20000);
    setState({ rows: [], loading: true, error: false });
    void coordinationRequest(
      "groups",
      {
        locationId,
        ...(search.trim().length >= 2 ? { search: search.trim() } : {}),
      },
      controller.signal,
    )
      .then((data) => {
        if (live) {
          if (!Array.isArray(data.groups)) throw Error("Unavailable");
          setState({ rows: data.groups, loading: false, error: false });
        }
      })
      .catch(() => {
        if (live) setState({ rows: [], loading: false, error: true });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      live = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [locationId, search, revision]);
  return { ...state, refresh: () => refresh((n) => n + 1) };
}
export function GroupMembers({
  group,
}: {
  group: Pick<VisitRoutingGroup, "members">;
}) {
  return (
    <div className="cp-group-members">
      {(["APPROVAL", "NOTIFY"] as const).map((kind) => (
        <div key={kind}>
          <span className="cp-routing-label">
            {kind === "APPROVAL" ? "Approval required (all)" : "Notify only"}
          </span>
          <ul>
            {group.members
              .filter((member) => member.kind === kind)
              .map((member, index) => (
                <li key={member.userId ?? member.email ?? index}>
                  <strong>
                    {member.name ?? member.email ?? "Unavailable employee"}
                  </strong>
                  {member.email && <small>{member.email}</small>}
                  {member.available === false && (
                    <small className="cp-danger-link">
                      Unavailable — administrator must update this group
                    </small>
                  )}
                </li>
              ))}
          </ul>
          {!group.members.some((member) => member.kind === kind) && (
            <span className="cp-muted">None</span>
          )}
        </div>
      ))}
    </div>
  );
}
export function VisitGroupSelector({
  catalogue,
  selected,
  onChange,
  vip,
  projects,
}: {
  catalogue: ReturnType<typeof useVisitGroups>;
  selected: VisitGroupReference[];
  onChange: (value: VisitGroupReference[]) => void;
  vip: boolean;
  projects: string[];
}) {
  const rows = catalogue.rows.filter(
      (group) =>
        group.active &&
        (!group.vipOnly || vip) &&
        (!group.subProjectId || projects.includes(group.subProjectId)),
    ),
    unavailable = selected.filter(
      (ref) =>
        !rows.some(
          (group) => group.id === ref.id && group.revision === ref.revision,
        ),
    );
  return (
    <fieldset className="cp-visit-groups">
      <legend>Approval & notification groups</legend>
      <p className="cp-muted">
        Choose the groups needed for this visit. Their approvals add to the
        destination reviews. Notification emails do not grant access.
      </p>
      {catalogue.loading ? (
        <p role="status">Loading visit groups…</p>
      ) : catalogue.error ? (
        <p role="alert">
          Visit groups could not be verified.{" "}
          <button
            type="button"
            className="secondary"
            onClick={catalogue.refresh}
          >
            Retry groups
          </button>
        </p>
      ) : (
        <>
          {rows.length === 0 && (
            <p>
              No matching visit groups configured. Your administrator can create
              them in Visit groups.
            </p>
          )}
          {rows.map((group) => (
            <div key={group.id} className="cp-group-card">
              <label className="cp-check">
                <input
                  type="checkbox"
                  checked={selected.some((ref) => ref.id === group.id)}
                  disabled={
                    !selected.some((ref) => ref.id === group.id) &&
                    (selected.length >= 5 ||
                      group.members.some(
                        (member) => member.available === false,
                      ))
                  }
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? [
                            ...selected,
                            { id: group.id, revision: group.revision },
                          ]
                        : selected.filter((ref) => ref.id !== group.id),
                    )
                  }
                />
                <strong>{group.name}</strong>
                {group.vipOnly && <span className="cp-status">VIP</span>}
              </label>
              {group.description && <p>{group.description}</p>}
              <GroupMembers group={group} />
            </div>
          ))}
        </>
      )}
      {unavailable.length > 0 && (
        <div role="alert">
          A selected group changed or is unavailable. Remove it, then review the
          current group before saving.
          <button
            type="button"
            className="secondary"
            onClick={() =>
              onChange(selected.filter((ref) => !unavailable.includes(ref)))
            }
          >
            Remove unavailable selections
          </button>
        </div>
      )}
    </fieldset>
  );
}
