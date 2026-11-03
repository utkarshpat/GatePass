import { useEffect, useState } from "react";
import type { Contact } from "./types.ts";
import { coordinationRequest } from "./client.ts";
export type Routing = {
  locationId: number;
  subProjectId?: string;
  approvalSteps: {
    id: string;
    name: string;
    mode: string;
    approvers: Contact[];
  }[];
  notify: Contact[];
  vipNotify: Contact[];
  arrangements?: { name: string; kind: string; owners: Contact[] }[];
};
export function usePlanningRouting(locationId: number, projects: string[]) {
  const key = [...projects].sort().join(","),
    [state, setState] = useState<{
      rows: Routing[];
      error: boolean;
      loading: boolean;
    }>({ rows: [], error: false, loading: true }),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    const controller = new AbortController(),
      timeout = window.setTimeout(() => controller.abort(), 15000);
    setState({ rows: [], error: false, loading: true });
    void coordinationRequest(
      "routing",
      { locationId, subProjectIds: key ? key.split(",") : [] },
      controller.signal,
    )
      .then((data) => {
        if (alive) {
          if (!Array.isArray(data.routing) || data.routing.length > 11)
            throw Error("Invalid routing");
          setState({ rows: data.routing, error: false, loading: false });
        }
      })
      .catch(() => {
        if (alive) setState({ rows: [], error: true, loading: false });
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      alive = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [locationId, key, retry]);
  return { ...state, retry: () => setRetry((n) => n + 1) };
}
export function RoutingNames({
  row,
  vip,
  stay,
}: {
  row?: Routing;
  vip: boolean;
  stay: boolean;
}) {
  if (!row)
    return (
      <p className="cp-muted">
        No current approval configuration. Ask your scoped administrator.
      </p>
    );
  const notify = [
    ...new Map(
      [...row.notify, ...(vip ? row.vipNotify : [])].map((person) => [
        person.userId,
        person,
      ]),
    ).values(),
  ];
  return (
    <div className="cp-routing-names">
      {row.approvalSteps.map((step) => (
        <div key={step.id}>
          <span className="cp-routing-label">
            {row.subProjectId ? "Host approval required" : "Approval required"}{" "}
            · {step.name} ({step.mode === "ALL" ? "all required" : "any one"})
          </span>
          <strong>
            {step.approvers.map((person) => person.name).join(", ") ||
              "No active approver configured"}
          </strong>
        </div>
      ))}
      {notify.length > 0 && (
        <div>
          <span className="cp-routing-label">Notify</span>
          <strong>{notify.map((person) => person.name).join(", ")}</strong>
        </div>
      )}
      {row.arrangements
        ?.filter((task) => task.kind !== "STAY" || stay)
        .map((task) => (
          <div key={task.name}>
            <span className="cp-routing-label">Arrange · {task.name}</span>
            <strong>
              {task.owners.map((person) => person.name).join(", ")}
            </strong>
          </div>
        ))}
    </div>
  );
}
