import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Dialog } from "./controls.tsx";
import { GuardLanguage, Label } from "../guard/language.tsx";
import { PersonName } from "../guard/readings.tsx";
export type ActionScope = {
  body: Record<string, string | number>;
  label: string;
};
type Row = {
  visitRequestId: string;
  personName: string;
  publicPassNumber: string;
};
type Reply = {
  category: string;
  checkedAtUtc: string;
  counts: Record<string, number>;
  items: Row[];
  cursor: unknown;
};
type Reminder = {
  busy?: boolean;
  until?: number;
  queued?: boolean;
  error?: boolean;
  message?: string;
};
export function ActionCentre({
  scope,
  openRecord,
  resetKey,
}: {
  scope: () => Promise<ActionScope | null>;
  openRecord: (row: Row, scope: ActionScope["body"]) => void;
  resetKey: string;
}) {
  const focusFallback = useRef(false);
  const i18n = useContext(GuardLanguage),
    [ui, setUi] = useState({
      open: false,
      selected: null as ActionScope | null,
      category: "PENDING",
      rows: [] as Row[],
      cursor: null as unknown,
      counts: null as Record<string, number> | null,
      busy: false,
      denied: false,
      status: "",
      reminders: new Map<string, Reminder>(),
    }),
    value = useRef(ui),
    generation = useRef(0),
    panel = useRef(0),
    suspended = useRef(false),
    controller = useRef<AbortController | null>(null),
    keys = useRef(new Map<string, string>()),
    requests = useRef(new Set<AbortController>()),
    alive = useRef(true);
  value.current = ui;
  const update = (patch: Partial<typeof ui>) => {
    if (!alive.current) return;
    value.current = { ...value.current, ...patch };
    setUi(value.current);
  };
  const request = async <T,>(
    path: string,
    body: unknown,
    c: AbortController,
  ): Promise<T> => {
    requests.current.add(c);
    const timer = window.setTimeout(() => c.abort(), 30000);
    try {
      const cookie = (name: string) =>
          document.cookie
            .split("; ")
            .find((v) => v.startsWith(name + "="))
            ?.split("=")[1],
        response = await fetch(path, {
          method: "POST",
          credentials: "same-origin",
          signal: c.signal,
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token":
              cookie("gp-staff-csrf") ?? cookie("gp-reception-csrf") ?? "",
          },
          body: JSON.stringify(body),
        });
      if (!response.ok)
        throw Object.assign(Error(), { status: response.status });
      return (await response.json()) as T;
    } finally {
      window.clearTimeout(timer);
      requests.current.delete(c);
    }
  };
  const close = () => {
    generation.current++;
    panel.current++;
    controller.current?.abort();
    update({ open: false, rows: [], cursor: null, counts: null, busy: false });
  };
  const load = async (more = false, quiet = false) => {
    const state = value.current;
    if (!state.open || (more && !state.cursor) || !state.selected) return;
    const version = ++generation.current;
    controller.current?.abort();
    const c = (controller.current = new AbortController()),
      category = state.category,
      rows = more ? [...state.rows] : [],
      target = quiet ? Math.max(24, state.rows.length) : 24;
    let cursor = more ? state.cursor : null;
    update({
      busy: true,
      ...(!quiet ? { status: i18n.t("Loading follow-ups…") } : {}),
    });
    try {
      const cursors = new Set<string>();
      let result: Reply;
      do {
        result = await request<Reply>(
          "/api/operations/actions",
          {
            ...state.selected.body,
            category,
            ...(cursor ? { cursor } : {}),
            ...(quiet
              ? { limit: Math.min(240, Math.max(24, target - rows.length)) }
              : {}),
          },
          c,
        );
        if (version !== generation.current) return;
        const known = new Set(rows.map((r) => r.visitRequestId));
        for (const row of result.items)
          if (!known.has(row.visitRequestId)) {
            known.add(row.visitRequestId);
            rows.push(row);
          }
        cursor = result.cursor;
        if (cursor) {
          const key = JSON.stringify(cursor);
          if (cursors.has(key)) throw Error();
          cursors.add(key);
        }
      } while (quiet && cursor && rows.length < target);
      const focused = (
        document.activeElement as Element | null
      )?.closest<HTMLElement>(".action-row")?.dataset.visitId;
      if (focused && !rows.some((row) => row.visitRequestId === focused))
        focusFallback.current = true;
      update({
        rows:
          JSON.stringify(rows) === JSON.stringify(value.current.rows)
            ? value.current.rows
            : rows,
        cursor,
        counts: result.counts,
        denied: false,
        status: rows.length
          ? rows.length +
            " / " +
            result.counts[
              category === "PENDING"
                ? "pending"
                : category === "EXPIRED_INSIDE"
                  ? "expiredInside"
                  : "unreturned"
            ] +
            " · " +
            i18n.t("Updated") +
            " " +
            new Intl.DateTimeFormat("en-IN", {
              timeZone: "Asia/Kolkata",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }).format(new Date(result.checkedAtUtc)) +
            " IST"
          : i18n.t("No follow-ups in this category."),
      });
    } catch (error) {
      if (version !== generation.current) return;
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403) {
        panel.current++;
        update({ rows: [], cursor: null, counts: null, denied: true });
      }
      update({ status: i18n.t("Follow-ups unavailable. Refresh to retry.") });
    } finally {
      if (version === generation.current) update({ busy: false });
    }
  };
  const actions = useRef({ load, close });
  actions.current = { load, close };
  useLayoutEffect(() => {
    if (focusFallback.current && ui.open) {
      focusFallback.current = false;
      document
        .querySelector<HTMLButtonElement>(
          '#action-category [aria-selected="true"]',
        )
        ?.focus({ preventScroll: true });
    }
  }, [ui.rows, ui.open]);
  useEffect(() => {
    alive.current = true;
    let timer: number | undefined;
    const startTimer = () => {
      window.clearInterval(timer);
      timer = window.setInterval(() => {
        const s = value.current;
        if (
          !suspended.current &&
          s.open &&
          !document.hidden &&
          !s.busy &&
          !s.denied
        )
          void actions.current.load(false, true);
      }, 20000);
    };
    startTimer();
    const visible = () => {
        if (
          !suspended.current &&
          !document.hidden &&
          value.current.open &&
          !value.current.busy
        )
          void actions.current.load(false, true);
      },
      hide = () => {
        suspended.current = true;
        actions.current.close();
        window.clearInterval(timer);
      },
      show = (event: PageTransitionEvent) => {
        if (event.persisted) {
          suspended.current = false;
          startTimer();
        }
      },
      reset = () => actions.current.close();
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    document.addEventListener("workspace-reset", reset);
    return () => {
      alive.current = false;
      generation.current++;
      window.clearInterval(timer);
      controller.current?.abort();
      for (const request of requests.current) request.abort();
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      document.removeEventListener("workspace-reset", reset);
    };
  }, []);
  useEffect(() => {
    actions.current.close();
  }, [resetKey]);
  const categories = [
    ["PENDING", "Approval overdue", "pending"],
    ["EXPIRED_INSIDE", "Expired but inside", "expiredInside"],
    ["UNRETURNED", "Pass return pending", "unreturned"],
  ].filter(
    ([key]) => key !== "UNRETURNED" || ui.selected?.body.workspace !== "GUARD",
  );
  const reminderKey = (row: Row, selected: ActionScope["body"]) =>
    [
      selected.workspace,
      selected.locationId,
      selected.dutyKind,
      selected.dutyId,
      row.visitRequestId,
    ].join(":");
  async function remind(row: Row, selected: ActionScope["body"]) {
    const ticket = panel.current,
      key = reminderKey(row, selected),
      current = value.current.reminders.get(key);
    if (current?.busy || (current?.until ?? 0) > Date.now()) return;
    if (!keys.current.has(key)) keys.current.set(key, crypto.randomUUID());
    const paint = (next: Reminder) =>
      update({ reminders: new Map(value.current.reminders).set(key, next) });
    paint({ busy: true, message: "" });
    try {
      const result = await request<{
        outcome: string;
        nextReminderAtUtc: string;
        mailStatus: string;
      }>(
        "/api/operations/remind",
        {
          ...selected,
          visitRequestId: row.visitRequestId,
          clientKey: keys.current.get(key),
        },
        new AbortController(),
      );
      if (
        !["QUEUED", "ALREADY_QUEUED", "COOLDOWN"].includes(result.outcome) ||
        !Number.isFinite(Date.parse(result.nextReminderAtUtc))
      )
        throw Error();
      keys.current.delete(key);
      paint({
        queued: result.mailStatus === "QUEUED",
        until: Math.max(
          Date.now() + 20000,
          Date.parse(result.nextReminderAtUtc),
        ),
        message: i18n.t(
          result.outcome === "COOLDOWN"
            ? "Please wait five minutes between reminders."
            : result.outcome === "ALREADY_QUEUED"
              ? "Approval email is already queued."
              : "Reminder queued.",
        ),
      });
    } catch (error) {
      const status = (error as { status?: number }).status;
      paint({
        error: true,
        message: i18n.t(
          status === 409
            ? "Request changed. Refresh to check."
            : "Reminder not confirmed. Retry to check.",
        ),
      });
      if (
        [401, 403].includes(status ?? 0) &&
        ticket === panel.current &&
        value.current.open &&
        JSON.stringify(value.current.selected?.body) ===
          JSON.stringify(selected)
      ) {
        panel.current++;
        generation.current++;
        controller.current?.abort();
        update({
          busy: false,
          denied: true,
          rows: [],
          cursor: null,
          counts: null,
          status: i18n.t("Follow-ups unavailable. Refresh to retry."),
        });
      }
    }
  }
  return (
    <>
      <button
        type="button"
        id="open-action-centre"
        className="secondary btn outline"
        onClick={async () => {
          if (value.current.open || suspended.current) return;
          const version = generation.current,
            selected = await scope();
          if (
            !selected ||
            value.current.open ||
            suspended.current ||
            version !== generation.current
          )
            return;
          panel.current++;
          update({
            selected,
            open: true,
            rows: [],
            cursor: null,
            denied: false,
            category:
              value.current.category === "UNRETURNED" &&
              selected.body.workspace === "GUARD"
                ? "PENDING"
                : value.current.category,
          });
          void load();
        }}
      >
        <Label textKey="Action centre" />
      </button>
      {createPortal(
        <Dialog
          id="action-centre"
          className="app-dialog action-centre"
          aria-labelledby="action-centre-title"
          open={ui.open}
          onDismiss={close}
        >
          <div className="dialog-heading">
            <h2 id="action-centre-title">
              <Label textKey="Action centre" />
            </h2>
            <button
              type="button"
              className="quiet"
              aria-label={i18n.t("Close action centre")}
              onClick={close}
            >
              ×
            </button>
          </div>
          <div className="action-navigation">
            <p className="hint">{ui.selected?.label}</p>
            <div
              id="action-category"
              className="action-tabs"
              role="tablist"
              aria-label={i18n.t("Follow-up type")}
              onKeyDown={(event) => {
                const tabs = [
                    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                      "[role=tab]",
                    ),
                  ],
                  index = tabs.indexOf(
                    document.activeElement as HTMLButtonElement,
                  );
                let next: number;
                if (event.key === "ArrowRight")
                  next = (index + 1) % tabs.length;
                else if (event.key === "ArrowLeft")
                  next = (index + tabs.length - 1) % tabs.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = tabs.length - 1;
                else return;
                event.preventDefault();
                tabs[next].focus();
                tabs[next].click();
              }}
            >
              {categories.map(([key, label, count]) => (
                <button
                  key={key}
                  id={"action-tab-" + key}
                  data-category={key}
                  role="tab"
                  type="button"
                  aria-controls="action-panel"
                  aria-selected={ui.category === key}
                  tabIndex={ui.category === key ? 0 : -1}
                  onClick={() => {
                    if (key === value.current.category) return;
                    panel.current++;
                    update({ category: key, rows: [], cursor: null });
                    void load();
                  }}
                >
                  <span className="action-tab-label">
                    <Label textKey={label} />
                  </span>
                  <span
                    className="action-tab-count"
                    data-count={count}
                    hidden={!ui.counts}
                  >
                    {ui.counts?.[count]}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div
            id="action-panel"
            className="dialog-body"
            role="tabpanel"
            aria-labelledby={"action-tab-" + ui.category}
          >
            <p role="status">{ui.status}</p>
            <div id="action-items" aria-busy={ui.busy}>
              {ui.rows.map((row) => {
                const selected = ui.selected!.body,
                  reminder = ui.reminders.get(reminderKey(row, selected)),
                  locked =
                    !!reminder?.busy || (reminder?.until ?? 0) > Date.now(),
                  label = reminder?.busy
                    ? "Notifying…"
                    : locked && reminder?.queued
                      ? "Queued"
                      : reminder?.error
                        ? "Retry"
                        : "Notify";
                return (
                  <div
                    key={row.visitRequestId}
                    className="action-row"
                    data-visit-id={row.visitRequestId}
                  >
                    <button
                      className="secondary action-item"
                      type="button"
                      onClick={() => {
                        close();
                        openRecord(row, { ...selected });
                      }}
                    >
                      <PersonName name={row.personName} as="strong" />
                      <span>{row.publicPassNumber}</span>
                    </button>
                    {ui.category === "PENDING" ? (
                      <div className="action-notify-wrap">
                        <button
                          className="secondary action-notify"
                          type="button"
                          data-notify={row.visitRequestId}
                          disabled={locked}
                          aria-label={i18n.t(label) + ": " + row.personName}
                          onClick={() => void remind(row, { ...selected })}
                        >
                          <span className="action-notify-label">
                            <Label textKey={label} />
                          </span>
                        </button>
                        <small className="action-notify-status" role="status">
                          {reminder?.message ?? ""}
                        </small>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              className="secondary"
              hidden={!ui.cursor}
              disabled={ui.busy}
              onClick={() => void load(true)}
            >
              <Label textKey="Load more" />
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => void load()}
            >
              <Label textKey="Refresh" />
            </button>
          </div>
        </Dialog>,
        document.body,
      )}
    </>
  );
}
