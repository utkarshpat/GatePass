import type { Movement } from "../guard/types.ts";
import { dateTime } from "./types.ts";
export function ReceptionTimeline({
  movements = [],
  hasMore = false,
}: {
  movements?: Movement[];
  hasMore?: boolean;
}) {
  if (!movements.length) return <>No movements recorded.</>;
  const list = [...movements].sort(
    (a, b) =>
      Date.parse(a.occurredAtUtc) - Date.parse(b.occurredAtUtc) ||
      (BigInt(a.accessEventId) < BigInt(b.accessEventId) ? -1 : 1),
  );
  return (
    <>
      <ol className="reception-timeline">
        {list.map((m) => (
          <li key={m.accessEventId}>
            <strong>{m.eventType === "ENTRY" ? "Entry" : "Exit"}</strong>
            <time dateTime={m.occurredAtUtc}>
              {dateTime(m.occurredAtUtc) + " IST"}
            </time>
            <p>
              {(m.projectName ? m.projectName + " / " : "") +
                (m.guardName ?? "") +
                " · " +
                ((
                  {
                    SCAN: "QR scan",
                    MANUAL: "Manual",
                    RECONCILE: "Reconciled exit",
                  } as Record<string, string>
                )[m.entryMethod ?? ""] ?? m.entryMethod)}
            </p>
          </li>
        ))}
      </ol>
      {hasMore ? (
        <p>{"Showing the latest " + movements.length + " movements."}</p>
      ) : null}
    </>
  );
}
