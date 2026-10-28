import {
  useEffect,
  useRef,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { SelfServiceModel } from "./model.ts";
export function usePhotoGestures(
  model: SelfServiceModel,
  stage: RefObject<HTMLDivElement | null>,
) {
  const points = useRef(new Map<number, { x: number; y: number }>()),
    gesture = useRef<
      | {
          kind: "drag";
          startX: number;
          startY: number;
          panX: number;
          panY: number;
        }
      | { kind: "pinch"; distance: number; zoom: number }
      | null
    >(null);
  const begin = () => {
    const entry = model.state.people[model.state.photoIndex],
      values = [...points.current.values()];
    if (values.length === 1) {
      const p = values[0];
      gesture.current = {
        kind: "drag",
        startX: p.x,
        startY: p.y,
        panX: entry.pan?.x ?? 0,
        panY: entry.pan?.y ?? 0,
      };
    } else if (values.length >= 2)
      gesture.current = {
        kind: "pinch",
        distance: Math.hypot(
          values[0].x - values[1].x,
          values[0].y - values[1].y,
        ),
        zoom: entry.zoom ?? 1,
      };
    else gesture.current = null;
  };
  const finish = (event: ReactPointerEvent) => {
    points.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    begin();
    if (!points.current.size) stage.current?.classList.remove("is-dragging");
  };
  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      const state = model.state,
        entry = state.people[state.photoIndex];
      if (state.busy || !entry.url || state.stream) return;
      event.preventDefault();
      model.setZoom(
        Math.round(
          ((entry.zoom ?? 1) + (event.deltaY < 0 ? 0.1 : -0.1)) * 100,
        ) / 100,
      );
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [model, stage]);
  return {
    onPointerDown: (event: ReactPointerEvent) => {
      const state = model.state,
        entry = state.people[state.photoIndex];
      if (
        state.busy ||
        !entry.url ||
        state.stream ||
        (event.target as Element).closest("#photo-zoom-controls")
      )
        return;
      event.preventDefault();
      points.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      event.currentTarget.setPointerCapture(event.pointerId);
      stage.current?.classList.add("is-dragging");
      begin();
    },
    onPointerMove: (event: ReactPointerEvent) => {
      if (model.state.busy || !points.current.has(event.pointerId)) return;
      event.preventDefault();
      points.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      const active = gesture.current;
      if (active?.kind === "drag" && points.current.size === 1)
        model.pan(
          active.panX + event.clientX - active.startX,
          active.panY + event.clientY - active.startY,
        );
      else if (active?.kind === "pinch" && points.current.size >= 2) {
        const [a, b] = [...points.current.values()];
        if (active.distance > 0)
          model.setZoom(
            Math.round(
              ((active.zoom * Math.hypot(a.x - b.x, a.y - b.y)) /
                active.distance) *
                100,
            ) / 100,
          );
      }
    },
    onPointerUp: finish,
    onPointerCancel: finish,
  };
}
