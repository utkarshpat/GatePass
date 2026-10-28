import {
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
  type CSSProperties,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
export function css(value: string): CSSProperties {
  return Object.fromEntries(
    value
      .split(";")
      .filter(Boolean)
      .map((pair) => {
        const index = pair.indexOf(":");
        return [
          pair
            .slice(0, index)
            .trim()
            .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()),
          pair.slice(index + 1).trim(),
        ];
      }),
  ) as CSSProperties;
}
export function VisitorTemplate({
  children,
  onReady,
}: {
  children: ReactNode;
  onReady?: () => void;
}) {
  const [element, setElement] = useState<HTMLTemplateElement | null>(null);
  useLayoutEffect(() => {
    if (element) onReady?.();
  }, [element, onReady]);
  return (
    <template id="visitor-template" ref={setElement}>
      {element ? createPortal(children, element.content) : null}
    </template>
  );
}
type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<unknown>;
};
export function InstallButton({
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const ready = (event: Event) => {
      if (matchMedia("(display-mode: standalone)").matches) return;
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const installed = () => setPrompt(null);
    window.addEventListener("beforeinstallprompt", ready);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", ready);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  return (
    <button
      {...props}
      id="pwa-install"
      type="button"
      hidden={!prompt}
      disabled={busy}
      onClick={async () => {
        if (!prompt || busy) return;
        setBusy(true);
        try {
          await prompt.prompt();
          await prompt.userChoice;
        } finally {
          setPrompt(null);
          setBusy(false);
        }
      }}
    >
      {children}
    </button>
  );
}
export function usePwa(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    let active = true;
    const register = () => {
      if (active)
        void navigator.serviceWorker
          .register("/service-worker.js", {
            scope: "/",
            updateViaCache: "none",
          })
          .catch(() => {});
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => {
      active = false;
      window.removeEventListener("load", register);
    };
  }, [enabled]);
}
export function ToastNotice({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  const timer = useRef<number | undefined>(undefined),
    latest = useRef(onDismiss);
  latest.current = onDismiss;
  const clear = () => window.clearTimeout(timer.current),
    arm = () => {
      clear();
      timer.current = window.setTimeout(
        () => latest.current(),
        message?.startsWith("Password set.") ? 6000 : 12000,
      );
    };
  useEffect(() => {
    if (message) arm();
    return clear;
  }, [message]);
  return createPortal(
    <div
      className="toast-region"
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      aria-relevant="additions"
    >
      {message ? (
        <div
          className={
            "toast toast-" +
            (message.startsWith("Password set.") ? "success" : "error")
          }
          role={message.startsWith("Password set.") ? "status" : "alert"}
          aria-atomic="true"
          onPointerEnter={clear}
          onPointerLeave={arm}
          onFocus={clear}
          onBlur={arm}
        >
          <span className="toast-icon" aria-hidden="true">
            {message.startsWith("Password set.") ? "✓" : "!"}
          </span>
          <p>{message}</p>
          <button
            className="toast-dismiss"
            aria-label="Dismiss notification"
            onClick={onDismiss}
          >
            ×
          </button>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
