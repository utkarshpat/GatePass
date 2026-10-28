import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { Dialog } from "./controls.tsx";
import { GuardLanguage, Label } from "../guard/language.tsx";
type Point = {
  x: number;
  y: number;
  startX: number;
  startY: number;
  time: number;
  moved: boolean;
  type: string;
};
type Gesture =
  | { kind: "pinch"; distance: number; scale: number; ix: number; iy: number }
  | { kind: "drag"; px: number; py: number; x: number; y: number };
export function ImageViewer() {
  const language = useContext(GuardLanguage),
    [source, setSource] = useState<{
      node: HTMLImageElement;
      dialog: HTMLDialogElement;
      url: string;
      alt: string;
    } | null>(null),
    stage = useRef<HTMLDivElement>(null),
    image = useRef<HTMLImageElement>(null),
    current = useRef(source),
    geometry = useRef({ scale: 1, fit: 1, x: 0, y: 0 }),
    pointers = useRef(new Map<number, Point>()),
    gesture = useRef<Gesture | null>(null),
    lastTap = useRef<{ x: number; y: number; time: number } | null>(null);
  current.current = source;
  const clear = () => {
    const node = stage.current;
    for (const id of pointers.current.keys())
      if (node?.hasPointerCapture(id)) node.releasePointerCapture(id);
    pointers.current.clear();
    gesture.current = null;
    lastTap.current = null;
    node?.classList.remove("is-dragging");
  };
  const close = () => {
    clear();
    const prior = current.current;
    current.current = null;
    setSource(null);
    if (prior?.node.isConnected && prior.dialog.open) prior.node.focus();
  };
  const draw = () => {
    const s = stage.current,
      img = image.current,
      g = geometry.current;
    if (!s || !img) return;
    const w = img.naturalWidth * g.scale,
      h = img.naturalHeight * g.scale;
    g.x =
      w <= s.clientWidth
        ? (s.clientWidth - w) / 2
        : Math.max(s.clientWidth - w, Math.min(0, g.x));
    g.y =
      h <= s.clientHeight
        ? (s.clientHeight - h) / 2
        : Math.max(s.clientHeight - h, Math.min(0, g.y));
    img.style.transform = `translate3d(${g.x}px,${g.y}px,0) scale(${g.scale})`;
  };
  const fit = () => {
    const s = stage.current,
      img = image.current,
      g = geometry.current;
    if (!s || !img?.naturalWidth || !s.clientWidth || !s.clientHeight) return;
    g.fit = Math.min(
      1,
      Math.max(1, s.clientWidth - 32) / img.naturalWidth,
      Math.max(1, s.clientHeight - 32) / img.naturalHeight,
    );
    g.scale = g.fit;
    img.style.width = img.naturalWidth + "px";
    img.style.height = img.naturalHeight + "px";
    draw();
  };
  const bounds = (value: number) =>
    Math.max(
      geometry.current.fit,
      Math.min(Math.max(1, geometry.current.fit * 8), value),
    );
  const zoom = (value: number, point: { x: number; y: number }) => {
    const g = geometry.current,
      next = bounds(value),
      ratio = next / g.scale;
    g.x = point.x - (point.x - g.x) * ratio;
    g.y = point.y - (point.y - g.y) * ratio;
    g.scale = next;
    draw();
  };
  const point = (event: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  };
  const begin = () => {
    const points = [...pointers.current.values()],
      g = geometry.current;
    if (points.length >= 2) {
      const [a, b] = points,
        mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      gesture.current = {
        kind: "pinch",
        distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        scale: g.scale,
        ix: (mid.x - g.x) / g.scale,
        iy: (mid.y - g.y) / g.scale,
      };
      lastTap.current = null;
      for (const p of points) p.moved = true;
    } else if (points.length) {
      const p = points[0];
      gesture.current = { kind: "drag", px: p.x, py: p.y, x: g.x, y: g.y };
    } else gesture.current = null;
    stage.current?.classList.toggle("is-dragging", points.length > 0);
  };
  const release = (event: ReactPointerEvent) => {
    const p = pointers.current.get(event.pointerId);
    if (!p) return;
    const tap =
      event.type === "pointerup" &&
      p.type === "touch" &&
      !p.moved &&
      performance.now() - p.time < 300 &&
      pointers.current.size === 1;
    pointers.current.delete(event.pointerId);
    if (stage.current?.hasPointerCapture(event.pointerId))
      stage.current.releasePointerCapture(event.pointerId);
    begin();
    if (tap) {
      const now = performance.now();
      if (
        lastTap.current &&
        now - lastTap.current.time < 320 &&
        Math.hypot(p.x - lastTap.current.x, p.y - lastTap.current.y) < 32
      ) {
        fit();
        lastTap.current = null;
      } else lastTap.current = { x: p.x, y: p.y, time: now };
    } else lastTap.current = null;
  };
  const latest = useRef({ close, fit, zoom });
  latest.current = { close, fit, zoom };
  useEffect(() => {
    const target = (event: Event) => {
      const node = event.target;
      if (!(node instanceof HTMLImageElement) || node.closest("button,a"))
        return;
      const dialog = node.closest<HTMLDialogElement>(
        "dialog[open]:not(.image-viewer)",
      );
      if (!dialog || !node.complete || !node.naturalWidth) return;
      if (event instanceof KeyboardEvent && !["Enter", " "].includes(event.key))
        return;
      event.preventDefault();
      event.stopPropagation();
      setSource({
        node,
        dialog,
        url: node.currentSrc || node.src,
        alt: node.alt || language.t("Image preview"),
      });
    };
    const scan = () => {
      for (const dialog of document.querySelectorAll(
        "dialog:not(.image-viewer)",
      ))
        for (const img of dialog.querySelectorAll("img")) {
          if (img.closest("button,a")) continue;
          img.setAttribute("role", "button");
          img.tabIndex = 0;
          img.setAttribute(
            "aria-label",
            language.t("Open full size image") +
              (img.alt ? ": " + img.alt : ""),
          );
          img.classList.add("dialog-zoom-image");
        }
      const selected = current.current;
      if (
        selected &&
        (!selected.dialog.open ||
          !selected.node.isConnected ||
          selected.node.closest("[hidden]") ||
          selected.node.src !== selected.url)
      )
        latest.current.close();
    };
    const observer = new MutationObserver(scan);
    observer.observe(document.getElementById("app") ?? document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open", "src", "hidden"],
    });
    scan();
    const resize = () => {
        if (current.current) {
          clear();
          latest.current.fit();
        }
      },
      hide = () => latest.current.close();
    document.addEventListener("click", target, true);
    document.addEventListener("keydown", target);
    window.addEventListener("resize", resize);
    window.addEventListener("pagehide", hide);
    return () => {
      observer.disconnect();
      document.removeEventListener("click", target, true);
      document.removeEventListener("keydown", target);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pagehide", hide);
    };
  }, [language.mode]);
  useLayoutEffect(() => {
    if (!source) return;
    clear();
    if (image.current?.complete) fit();
    const node = stage.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? node.clientHeight
            : 1);
      latest.current.zoom(
        geometry.current.scale *
          Math.exp(
            Math.max(-1, Math.min(1, -delta * (event.ctrlKey ? 0.01 : 0.002))),
          ),
        point(event),
      );
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [source]);
  return createPortal(
    <Dialog
      id="image-viewer"
      className="image-viewer"
      aria-labelledby="image-viewer-title"
      open={!!source}
      onDismiss={close}
    >
      <div className="image-viewer-toolbar">
        <div>
          <h2 id="image-viewer-title">
            <Label textKey="Image preview" />
          </h2>
          <p id="image-viewer-hint">
            <Label textKey="Pinch or scroll to zoom · Drag to move · Double-tap to reset" />
          </p>
        </div>
        <button
          type="button"
          className="image-viewer-close"
          aria-label={language.t("Close image preview")}
          title={language.t("Close image preview")}
          onClick={close}
        >
          ×
        </button>
      </div>
      <div
        ref={stage}
        className="image-viewer-stage"
        tabIndex={0}
        role="group"
        aria-label={language.t("Image preview")}
        aria-describedby="image-viewer-hint image-viewer-keys"
        onPointerDown={(event) => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          const p = point(event);
          pointers.current.set(event.pointerId, {
            ...p,
            startX: p.x,
            startY: p.y,
            time: performance.now(),
            moved: false,
            type: event.pointerType,
          });
          event.currentTarget.setPointerCapture(event.pointerId);
          begin();
        }}
        onPointerMove={(event) => {
          const p = pointers.current.get(event.pointerId),
            g = gesture.current;
          if (!p || !g) return;
          const next = point(event);
          Object.assign(p, next);
          if (Math.hypot(p.x - p.startX, p.y - p.startY) > 8) p.moved = true;
          const points = [...pointers.current.values()],
            view = geometry.current;
          if (g.kind === "pinch" && points.length >= 2) {
            const [a, b] = points;
            view.scale = bounds(
              (g.scale * Math.hypot(a.x - b.x, a.y - b.y)) / g.distance,
            );
            view.x = (a.x + b.x) / 2 - g.ix * view.scale;
            view.y = (a.y + b.y) / 2 - g.iy * view.scale;
            draw();
          } else if (g.kind === "drag") {
            view.x = g.x + p.x - g.px;
            view.y = g.y + p.y - g.py;
            draw();
          }
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onDoubleClick={(event) => {
          event.preventDefault();
          fit();
        }}
        onKeyDown={(event) => {
          const node = stage.current!,
            g = geometry.current,
            centre = { x: node.clientWidth / 2, y: node.clientHeight / 2 };
          if (["+", "=", "-", "_"].includes(event.key))
            zoom(
              g.scale * (["+", "="].includes(event.key) ? 1.25 : 0.8),
              centre,
            );
          else if (["Home", "0"].includes(event.key)) fit();
          else if (event.key === "ArrowLeft") {
            g.x += 40;
            draw();
          } else if (event.key === "ArrowRight") {
            g.x -= 40;
            draw();
          } else if (event.key === "ArrowUp") {
            g.y += 40;
            draw();
          } else if (event.key === "ArrowDown") {
            g.y -= 40;
            draw();
          } else return;
          event.preventDefault();
        }}
      >
        <img
          ref={image}
          draggable={false}
          src={source?.url}
          alt={source?.alt ?? ""}
          onLoad={fit}
        />
      </div>
      <p id="image-viewer-keys" className="image-viewer-sr">
        Keyboard: plus or minus to zoom, arrow keys to move, Home to reset,
        Escape to close.
      </p>
    </Dialog>,
    document.body,
  );
}
