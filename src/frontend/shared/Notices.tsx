import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
type Notice = {
  id: number;
  message: string;
  kind: "success" | "error" | "info";
};
function NoticeItem({
  item,
  dismiss,
}: {
  item: Notice;
  dismiss: (id: number) => void;
}) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(
      () => dismiss(item.id),
      item.kind === "error" ? 12000 : 6000,
    );
    return () => window.clearTimeout(timer);
  }, [item.id, paused]);
  return (
    <div
      className={"toast toast-" + item.kind}
      role={item.kind === "error" ? "alert" : "status"}
      aria-atomic="true"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setPaused(false);
      }}
    >
      <span className="toast-icon" aria-hidden="true">
        {item.kind === "success" ? "✓" : item.kind === "error" ? "!" : "i"}
      </span>
      <p>{item.message}</p>
      <button
        type="button"
        className="toast-dismiss"
        aria-label="Dismiss notification"
        onClick={() => dismiss(item.id)}
      >
        ×
      </button>
    </div>
  );
}
export function Notices({
  items,
  dismiss,
}: {
  items: Notice[];
  dismiss: (id: number) => void;
}) {
  return createPortal(
    <div
      className="toast-region"
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      aria-relevant="additions"
    >
      {items.map((item) => (
        <NoticeItem key={item.id} item={item} dismiss={dismiss} />
      ))}
    </div>,
    document.body,
  );
}
