/** Network invalidation/polling protocol. React models own payloads, readiness and cleanup. */
import { Resources } from "./model.ts";
export class LiveRefresh {
  private unwatch: () => void;
  refresh: () => Promise<void>;
  ready: () => boolean;
  scope: () => unknown;
  intervalMs: number;
  running = false;
  closed = false;
  suspended = false;
  last = Date.now();
  dirty = false;
  online = false;
  key: string | null = null;
  blocked: string | null = null;
  failures = 0;
  nextConnect = 0;
  stream: { controller: AbortController } | null = null;
  timer: number | undefined;
  focusTimer: number | undefined;
  pollDelay: number;
  constructor(
    refresh: () => Promise<void>,
    ready: () => boolean,
    intervalMs = 20000,
    scope: () => unknown = () => null,
  ) {
    this.unwatch = Resources.watch(() => ({
      timers:
        this.closed || this.suspended
          ? 0
          : Number(this.timer !== undefined) +
            Number(this.focusTimer !== undefined),
      streams: this.stream ? 1 : 0,
    }));
    this.refresh = refresh;
    this.ready = ready;
    this.scope = scope;
    this.intervalMs = intervalMs;
    this.pollDelay = this.pollInterval();
    this.timer = window.setInterval(() => this.tick(), 1000);
    document.addEventListener("visibilitychange", this.wake);
    window.addEventListener("focus", this.wake);
    window.addEventListener("pagehide", this.hide);
    window.addEventListener("pageshow", this.show);
  }
  pollInterval = () => this.intervalMs * (0.9 + Math.random() * 0.1);
  wake = () => {
    if (document.hidden) this.disconnect();
    window.clearTimeout(this.focusTimer);
    this.focusTimer = window.setTimeout(() => {
      if (!document.hidden && Date.now() - this.last >= 2000) {
        this.dirty = true;
        this.tick();
      }
    }, 300);
  };
  hide = () => {
    this.suspended = true;
    window.clearInterval(this.timer);
    window.clearTimeout(this.focusTimer);
    this.disconnect();
  };
  show = (event: PageTransitionEvent) => {
    if (event.persisted && !this.closed) {
      this.suspended = false;
      window.clearInterval(this.timer);
      this.timer = window.setInterval(() => this.tick(), 1000);
      this.wake();
    }
  };
  disconnect() {
    const stream = this.stream;
    this.stream = null;
    this.online = false;
    stream?.controller.abort();
  }
  tick() {
    if (this.closed || this.suspended || document.hidden) {
      this.disconnect();
      return;
    }
    const scope = this.scope(),
      key = scope ? JSON.stringify(scope) : null;
    if (key !== this.key) {
      this.disconnect();
      this.key = key;
      this.blocked = null;
      this.failures = 0;
      this.nextConnect = 0;
    }
    if (
      key &&
      !this.stream &&
      this.blocked !== key &&
      Date.now() >= this.nextConnect &&
      this.ready()
    )
      void this.connect(key, scope);
    if (
      (this.dirty && Date.now() - this.last >= 1000) ||
      Date.now() - this.last >= (this.online ? 60000 : this.pollDelay)
    )
      void this.run();
  }
  async connect(key: string, scope: unknown) {
    const ticket = { controller: new AbortController() };
    this.stream = ticket;
    let watchdog = window.setTimeout(() => ticket.controller.abort(), 10000),
      reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const csrf = document.cookie
        .split("; ")
        .find((c) => c.startsWith("gp-staff-csrf="))
        ?.split("=")[1];
      const response = await fetch("/api/workspace/events", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf ?? "",
        },
        body: JSON.stringify(scope),
        signal: ticket.controller.signal,
      });
      if (this.stream !== ticket) return;
      if ([401, 403, 404, 405].includes(response.status)) {
        this.blocked = key;
        throw Error();
      }
      if (response.status === 429) this.failures = Math.max(this.failures, 4);
      if (
        !response.ok ||
        !response.headers
          .get("content-type")
          ?.startsWith("text/event-stream") ||
        !response.body
      )
        throw Error();
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (this.stream === ticket) {
        window.clearTimeout(watchdog);
        watchdog = window.setTimeout(() => ticket.controller.abort(), 45000);
        const part = await reader.read();
        if (part.done) break;
        if (this.stream !== ticket) return;
        buffer += decoder.decode(part.value, { stream: true });
        if (buffer.length > 4096) throw Error();
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (frame.startsWith("event: ready\n")) {
            this.online = true;
            this.failures = 0;
            this.dirty = true;
          } else if (frame.startsWith("event: invalidate\n")) this.dirty = true;
        }
      }
    } catch {
      /* Normal authorized polling remains the fallback. */
    } finally {
      window.clearTimeout(watchdog);
      void reader?.cancel().catch(() => {});
      ticket.controller.abort();
      if (this.stream === ticket) {
        this.stream = null;
        this.online = false;
        this.failures++;
        this.nextConnect =
          Date.now() +
          Math.min(60000, 5000 * 2 ** Math.min(this.failures - 1, 4)) *
            (0.8 + Math.random() * 0.4);
      }
    }
  }
  async run() {
    if (
      this.closed ||
      this.suspended ||
      this.running ||
      document.hidden ||
      !this.ready()
    )
      return;
    this.running = true;
    this.last = Date.now();
    this.pollDelay = this.pollInterval();
    this.dirty = false;
    try {
      await this.refresh();
    } catch {
    } finally {
      this.running = false;
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.unwatch();
    this.hide();
    document.removeEventListener("visibilitychange", this.wake);
    window.removeEventListener("focus", this.wake);
    window.removeEventListener("pagehide", this.hide);
    window.removeEventListener("pageshow", this.show);
  }
}
