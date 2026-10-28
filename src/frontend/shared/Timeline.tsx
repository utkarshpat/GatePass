import { useContext } from "react";
import { GuardLanguage, Label } from "../guard/language.tsx";
import type { Movement } from "../guard/types.ts";
export function Timeline({
  movements,
  hasMore = false,
}: {
  movements?: Movement[];
  hasMore?: boolean;
}) {
  const list = Array.isArray(movements) ? [...movements] : [];
  useContext(GuardLanguage);
  list.sort(
    (a, b) =>
      Date.parse(a.occurredAtUtc) - Date.parse(b.occurredAtUtc) ||
      (BigInt(a.accessEventId) < BigInt(b.accessEventId) ? -1 : 1),
  );
  let entries = 0;
  return list.length ? (
    <ol className="timeline-list">
      {list.map((m) => {
        const entry = m.eventType === "ENTRY";
        if (entry) entries++;
        return (
          <li
            key={m.accessEventId}
            className={"timeline-item " + (entry ? "is-entry" : "is-exit")}
          >
            <div className="timeline-marker" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="13" height="13">
                <path
                  d={
                    entry
                      ? "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"
                      : "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
                  }
                />
              </svg>
            </div>
            <div className="timeline-content">
              <div className="timeline-row">
                <strong className="timeline-action">
                  <Label
                    textKey={
                      entry
                        ? entries === 1 && !hasMore
                          ? "First Entry"
                          : "Entry"
                        : "Exit"
                    }
                  />
                </strong>
                <time className="timeline-time" dateTime={m.occurredAtUtc}>
                  {new Intl.DateTimeFormat("en-IN", {
                    timeZone: "Asia/Kolkata",
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: true,
                  }).format(new Date(m.occurredAtUtc)) + " IST"}
                </time>
              </div>
              <div className="timeline-meta">
                <span className="timeline-guard">
                  <span className="timeline-guard-icon">
                    <svg
                      viewBox="0 0 24 24"
                      width="12"
                      height="12"
                      aria-hidden="true"
                    >
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                  </span>
                  <Label
                    textKey="by {guard}"
                    values={{ guard: m.guardName || "Security" }}
                  />
                </span>
                <span className="timeline-method">
                  <Label
                    textKey={
                      m.entryMethod === "SCAN"
                        ? "via Scan"
                        : m.entryMethod === "RECONCILE"
                          ? "via Reconcile"
                          : "via Manual"
                    }
                  />
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  ) : (
    <div className="timeline-empty">
      <p className="timeline-empty-text">
        <Label textKey="No movements recorded yet" />
      </p>
    </div>
  );
}
