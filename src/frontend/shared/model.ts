import { useEffect, useState, useSyncExternalStore } from "react";
export type Model<T> = {
  getSnapshot: () => T;
  subscribe: (listener: () => void) => () => void;
  start: () => void;
  dispose: () => void;
};
export function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update: (next: Partial<T> | ((value: T) => T)) => {
      value =
        typeof next === "function"
          ? (next as (value: T) => T)(value)
          : { ...value, ...next };
      for (const listener of listeners) listener();
    },
    clear: () => listeners.clear(),
  };
}
export function useModel<M extends Model<unknown>>(create: () => M) {
  const [model] = useState(create);
  const ui = useSyncExternalStore(
    model.subscribe,
    model.getSnapshot,
  ) as ReturnType<M["getSnapshot"]>;
  useEffect(() => {
    model.start();
    return () => model.dispose();
  }, [model]);
  return [model, ui] as const;
}
/** Resources owned by a native React model; no DOM proxy or legacy page mounting. */
export class Resources {
  private static active = new Set<Resources>();
  private static external = new Set<
    () => { timers: number; streams: number }
  >();
  static watch(read: () => { timers: number; streams: number }) {
    this.external.add(read);
    return () => {
      this.external.delete(read);
    };
  }
  private timers = new Set<number>();
  private intervals = new Set<number>();
  private cleanup = new Set<() => void>();
  private requests = new Set<AbortController>();
  alive = false;
  static diagnostics() {
    const external = [...this.external].map((read) => read());
    return {
      scopes: this.active.size,
      timers:
        external.reduce((n, value) => n + value.timers, 0) +
        [...this.active].reduce(
          (n, r) => n + r.timers.size + r.intervals.size,
          0,
        ),
      streams: external.reduce((n, value) => n + value.streams, 0),
    };
  }
  start() {
    this.alive = true;
    Resources.active.add(this);
  }
  timeout(callback: () => void, ms: number) {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      if (this.alive) callback();
    }, ms);
    this.timers.add(id);
    return id;
  }
  clearTimeout(id: number | undefined) {
    if (id !== undefined) {
      window.clearTimeout(id);
      this.timers.delete(id);
    }
  }
  interval(callback: () => void, ms: number) {
    const id = window.setInterval(() => {
      if (this.alive) callback();
    }, ms);
    this.intervals.add(id);
    return id;
  }
  clearInterval(id: number | undefined) {
    if (id !== undefined) {
      window.clearInterval(id);
      this.intervals.delete(id);
    }
  }
  on(
    target: EventTarget,
    type: string,
    listener: EventListener,
    options?: AddEventListenerOptions,
  ) {
    target.addEventListener(type, listener, options);
    const remove = () => target.removeEventListener(type, listener, options);
    this.cleanup.add(remove);
    return remove;
  }
  own(callback: () => void) {
    this.cleanup.add(callback);
  }
  controller() {
    const c = new AbortController();
    this.requests.add(c);
    return c;
  }
  release(controller: AbortController) {
    this.requests.delete(controller);
  }
  dispose() {
    this.alive = false;
    Resources.active.delete(this);
    for (const fn of this.cleanup) fn();
    for (const id of this.timers) window.clearTimeout(id);
    for (const id of this.intervals) window.clearInterval(id);
    for (const c of this.requests) c.abort();
    this.cleanup.clear();
    this.timers.clear();
    this.intervals.clear();
    this.requests.clear();
  }
}
declare const __GATEPASS_UI_TEST__: boolean;
export function inspectForTests(
  bindings: Record<string, () => unknown>,
  resources: Resources,
  setters: Record<string, (value: unknown) => void> = {},
) {
  if (!__GATEPASS_UI_TEST__) return;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, get] of Object.entries(bindings)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get,
      ...(setters[name] ? { set: setters[name] } : {}),
    });
  }
  resources.own(() => {
    for (const [name, descriptor] of previous)
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
  });
}
