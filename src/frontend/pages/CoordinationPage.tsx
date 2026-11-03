import {
  StaffNavigationToggle,
  useStaffAccess,
  useCoordinationFolder,
} from "../shared/StaffNavigation.tsx";
import { Icon, initials } from "../coordination/Icons.tsx";
import { flushSync } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PageProps } from "../types.ts";
import type { Detail, Options, VisitRow } from "../coordination/types.ts";
import {
  displayTime,
  officeInput,
  utcFromOffice,
  projectLabel,
} from "../coordination/types.ts";
import {
  CoordinationFailure,
  coordinationRequest,
  csrf,
} from "../coordination/client.ts";
import { PlanningSettings } from "../coordination/Settings.tsx";
import { InvitationForm } from "../coordination/InvitationForm.tsx";
import { PlanningStatus, VisitDetail } from "../coordination/VisitDetail.tsx";
import { Dialog } from "../shared/controls.tsx";

const empty: Options = {
  actorId: "",
  displayName: "",
  locations: [],
  accounts: [],
  projects: [],
  people: [],
  policies: [],
  hosts: [],
};
const selectedHash = () =>
  /^#visit=([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/iu
    .exec(location.hash)?.[1]
    .toLowerCase() ?? null;
export default function CoordinationPage({
  config,
  embedded = false,
  officeId,
  setupSection,
  accountId,
}: PageProps & {
  embedded?: boolean;
  officeId?: number;
  setupSection?: "projects" | "hosts" | "policies" | "groups";
  accountId?: string;
}) {
  const staffAccess = useStaffAccess();
  useEffect(() => {
    if (
      !embedded &&
      staffAccess?.workspaces.some((workspace) => workspace.code === "ADMIN")
    ) {
      const query = new URLSearchParams(location.search);
      query.set("view", "coordination");
      location.replace("/admin?" + query.toString() + location.hash);
    }
  }, [embedded, staffAccess]);
  const Content = embedded ? "section" : "main";
  const [folder, , folderSequence] = useCoordinationFolder();

  const [options, setOptions] = useState<Options>(empty),
    [visits, setVisits] = useState<VisitRow[]>([]),
    [detail, setDetail] = useState<Detail | null>(null),
    [selected, setSelected] = useState<string | null>(selectedHash),
    [search, setSearch] = useState(""),
    [office, setOffice] = useState(officeId ? String(officeId) : ""),
    [from, setFrom] = useState(
      officeInput(new Date(Date.now() - 30 * 86400000).toISOString()).slice(
        0,
        10,
      ),
    ),
    [untilDate, setUntilDate] = useState(
      officeInput(new Date(Date.now() + 90 * 86400000).toISOString()).slice(
        0,
        10,
      ),
    ),
    [offset, setOffset] = useState(0),
    [hasMore, setHasMore] = useState(false),
    [settings, setSettings] = useState(
      !!setupSection ||
        ["groups", "planning"].includes(
          new URLSearchParams(location.search).get("settings") ?? "",
        ),
    ),
    [dialog, setDialog] = useState<"NEW" | "EDIT" | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [message, setMessage] = useState(""),
    [authRequired, setAuthRequired] = useState(false),
    [blocked, setBlocked] = useState(false),
    [initial, setInitial] = useState(true);
  const previousFolder = useRef(folderSequence);
  useEffect(() => {
    if (previousFolder.current !== folderSequence) {
      setOffset(0);
      setSelected(null);
      setDetail(null);
      setSettings(false);
      previousFolder.current = folderSequence;
    }
  }, [folderSequence]);
  const previousOffice = useRef(officeId);
  useEffect(() => {
    if (embedded && officeId) {
      setOffice(String(officeId));
      if (previousOffice.current !== officeId) {
        setSelected(null);
        setDetail(null);
        setOffset(0);
        const target = new URL(location.href);
        target.hash = "";
        history.replaceState(null, "", target.pathname + target.search);
      }
      previousOffice.current = officeId;
    }
  }, [embedded, officeId]);
  const createKey = useRef(crypto.randomUUID()),
    commandKey = useRef({ signature: "", key: "" }),
    manageKey = useRef({ signature: "", key: "" });
  const lifecycle = useRef(0),
    resume = useRef<() => Promise<void>>(async () => {});
  const live = useRef(false),
    pending = useRef(false),
    controllers = useRef(new Set<AbortController>()),
    versions = useRef<Record<string, number>>({}),
    currentSelected = useRef(selected);
  currentSelected.current = selected;
  const request = useCallback(async (action: string, body: unknown) => {
    if (!live.current) throw new DOMException("Cancelled", "AbortError");
    const epoch = lifecycle.current;
    const controller = new AbortController();
    controllers.current.add(controller);
    const timeout = window.setTimeout(() => controller.abort(), 25000);
    try {
      const result = await coordinationRequest(action, body, controller.signal);
      if (!live.current || epoch !== lifecycle.current)
        throw new DOMException("Obsolete", "AbortError");
      return result;
    } catch (error) {
      if (!live.current || epoch !== lifecycle.current)
        throw new DOMException("Obsolete", "AbortError");
      throw error;
    } finally {
      clearTimeout(timeout);
      controllers.current.delete(controller);
    }
  }, []);
  const report = useCallback((error: unknown) => {
    if (
      !live.current ||
      (error instanceof DOMException &&
        error.name === "AbortError" &&
        error.message === "Obsolete")
    )
      return;
    setMessage(
      error instanceof CoordinationFailure
        ? error.message
        : "The connection was interrupted. Retry to load the current status.",
    );
    if (
      error instanceof CoordinationFailure &&
      (error.status === 401 || error.status === 403 || !csrf())
    ) {
      setAuthRequired(error.status === 401 || !csrf());
      setBlocked(error.status === 403 && !!csrf());
      setOptions(empty);
      setVisits([]);
      setDetail(null);
      setDialog(null);
      setSettings(false);
    }
  }, []);
  const loadOptions = useCallback(
    async (peopleSearch?: string) => {
      const v = (versions.current.options ?? 0) + 1;
      versions.current.options = v;
      const data = await request(
        "options",
        peopleSearch ? { search: peopleSearch } : {},
      );
      if (live.current && versions.current.options === v) {
        setOptions(data);
        setInitial(false);
        setAuthRequired(false);
        setBlocked(false);
      }
      return data as Options;
    },
    [request],
  );
  const loadDetail = useCallback(
    async (id: string) => {
      const v = (versions.current.detail ?? 0) + 1;
      versions.current.detail = v;
      const data = await request("detail", { planId: id });
      if (
        live.current &&
        versions.current.detail === v &&
        currentSelected.current === id
      )
        setDetail(data);
      return data as Detail;
    },
    [request],
  );
  const loadList = useCallback(async () => {
    if (setupSection) return;
    const v = (versions.current.list ?? 0) + 1;
    versions.current.list = v;
    const data = await request("list", {
      folder,
      offset,
      ...(from ? { fromUtc: utcFromOffice(from + "T00:00") } : {}),
      ...(untilDate
        ? {
            untilUtc: new Date(
              Date.parse(untilDate + "T00:00:00+05:30") + 86400000,
            ).toISOString(),
          }
        : {}),
      ...(office ? { locationId: Number(office) } : {}),
      ...(search.trim() ? { search: search.trim() } : {}),
    });
    if (live.current && versions.current.list === v) {
      setVisits(data.visits);
      setHasMore(data.hasMore);
    }
  }, [request, folder, offset, office, search, from, untilDate, setupSection]);
  const select = useCallback((id: string | null) => {
    versions.current.detail = (versions.current.detail ?? 0) + 1;
    setSelected(id);
    setDetail(null);
    const target = new URL(location.href);
    target.searchParams.delete("settings");
    target.hash = id ? "visit=" + id : "";
    history.replaceState(
      null,
      "",
      target.pathname + target.search + target.hash,
    );
    setSettings(false);
  }, []);
  resume.current = async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadOptions(),
        loadList(),
        ...(currentSelected.current
          ? [loadDetail(currentSelected.current)]
          : []),
      ]);
    } catch (error) {
      report(error);
    } finally {
      if (live.current) {
        setInitial(false);
        setLoading(false);
      }
    }
  };
  useEffect(() => {
    live.current = true;
    const onHash = () => {
      if (!location.hash || selectedHash()) {
        setSelected(selectedHash());
        setDetail(null);
      }
    };
    const hide = () => {
      live.current = false;
      lifecycle.current++;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
      for (const key of Object.keys(versions.current)) versions.current[key]++;
      pending.current = false;
      // Clear the DOM before the browser freezes a back/forward-cache snapshot.
      flushSync(() => {
        setBusy(false);
        setLoading(false);
        setInitial(true);
        setOptions(empty);
        setVisits([]);
        setDetail(null);
        setDialog(null);
        setSettings(false);
        setMessage("");
        setAuthRequired(false);
        setBlocked(false);
      });
    };
    const show = (event: PageTransitionEvent) => {
      if (event.persisted) {
        live.current = true;
        void resume.current();
      }
    };
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    window.addEventListener("hashchange", onHash);
    void loadOptions()
      .catch(report)
      .finally(() => {
        if (live.current) setInitial(false);
      });
    return () => {
      live.current = false;
      lifecycle.current++;
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      window.removeEventListener("hashchange", onHash);
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
      for (const key of Object.keys(versions.current)) versions.current[key]++;
    };
  }, [loadOptions, report]);
  useEffect(() => {
    if (authRequired || blocked) return;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void loadList()
        .catch(report)
        .finally(() => {
          if (live.current) setLoading(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [loadList, authRequired, blocked, report]);
  useEffect(() => {
    if (!selected || authRequired) return;
    void loadDetail(selected).catch((error) => {
      if (live.current && currentSelected.current === selected) setDetail(null);
      report(error);
    });
  }, [selected, authRequired, loadDetail, report]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (
        document.visibilityState !== "visible" ||
        pending.current ||
        authRequired ||
        blocked
      )
        return;
      void Promise.all([
        loadList(),
        ...(currentSelected.current
          ? [loadDetail(currentSelected.current)]
          : []),
      ]).catch(report);
    }, 30000);
    return () => clearInterval(timer);
  }, [loadList, loadDetail, report, authRequired, blocked]);
  async function refresh() {
    setMessage("");
    setLoading(true);
    try {
      await Promise.all([
        loadOptions(),
        loadList(),
        ...(selected ? [loadDetail(selected)] : []),
      ]);
    } catch (e) {
      report(e);
    } finally {
      if (live.current) setLoading(false);
    }
  }
  async function write(
    action: string,
    body: unknown,
    after?: (result: any) => Promise<void>,
  ) {
    if (pending.current) throw new Error("Already saving");
    const epoch = lifecycle.current;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await request(action, body);
      if (after) await after(result);
      return result;
    } catch (e) {
      report(e);
      throw e;
    } finally {
      if (epoch === lifecycle.current) {
        pending.current = false;
        if (live.current) setBusy(false);
      }
    }
  }
  async function command(value: unknown) {
    if (!detail) throw new Error("No visit");
    const id = detail.id,
      signature =
        id +
        ":" +
        detail.revision +
        ":" +
        String((value as { kind: string }).kind);
    if (commandKey.current.signature !== signature)
      commandKey.current = { signature, key: crypto.randomUUID() };
    try {
      await write(
        "change",
        {
          planId: id,
          revision: detail.revision,
          clientKey: commandKey.current.key,
          command: value,
        },
        async () => {
          await Promise.all([loadDetail(id), loadList()]);
        },
      );
      commandKey.current = { signature: "", key: "" };
    } catch (error) {
      if (error instanceof CoordinationFailure && error.status === 409)
        await loadDetail(id).catch(report);
      throw error;
    }
  }
  async function saveDraft(draft: unknown, reason?: string) {
    if (dialog === "EDIT") {
      await command({ kind: "REVISE", draft, reason });
      if (live.current) setDialog(null);
    } else {
      await write(
        "create",
        { draft, clientKey: createKey.current },
        async (result) => {
          if (live.current) {
            setDialog(null);
            select(result.id);
          }
          await loadList();
        },
      );
    }
  }
  async function manage(action: string, payload: unknown) {
    const p = payload as {
        subProjectId?: string;
        locationId?: number;
        revision: number;
        id?: string;
      },
      signature = JSON.stringify({ action, payload });
    if (manageKey.current.signature !== signature)
      manageKey.current = { signature, key: crypto.randomUUID() };
    await write(
      "manage",
      { action, payload, clientKey: manageKey.current.key },
      async () => {
        await loadOptions();
      },
    );
    manageKey.current = { signature: "", key: "" };
    if (live.current)
      setMessage(
        "Visit setup saved. Submitted plans need a revision if their policy changed.",
      );
  }
  const canInvite =
      options.locations.some((l) => l.canHostLocation) ||
      options.projects.some((p) => p.canHost),
    canManage =
      options.locations.some((l) => l.canManage) ||
      options.accounts.some((a) => a.canManage);
  const login =
    "/?next=coordination" +
    (selected ? "&visit=" + encodeURIComponent(selected) : "");
  return (
    <>
      {!embedded && (
        <>
          <a className="skip" href="#coordination-main">
            Skip to content
          </a>
          <header className="cp-header">
            <StaffNavigationToggle />
            <a href="/" aria-label="GatePass home">
              <img src={config.companyLogo} width={164} alt="Sopra Steria" />
            </a>
            <div className="cp-header-actions">
              <div className="cp-current-user">
                <span className="cp-avatar" aria-hidden="true">
                  {initials(options.displayName)}
                </span>
                <span>
                  {options.displayName}
                  <small>Staff portal</small>
                </span>
              </div>
              <button
                type="button"
                className="secondary cp-header-control"
                aria-label="Sign out"
                title="Sign out"
                disabled={busy}
                onClick={() => {
                  const controller = new AbortController();
                  controllers.current.add(controller);
                  const token = csrf();
                  void fetch("/api/staff/logout", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: {
                      "Content-Type": "application/json",
                      "X-CSRF-Token": token ?? "",
                    },
                    body: "{}",
                    signal: controller.signal,
                  })
                    .then((r) => {
                      if (r.ok) location.replace("/");
                      else throw new Error();
                    })
                    .catch(() =>
                      setMessage("Unable to sign out. Please retry."),
                    )
                    .finally(() => controllers.current.delete(controller));
                }}
              >
                <Icon name="logout" />
                <span>Sign out</span>
              </button>
            </div>
          </header>
        </>
      )}
      <Content
        id={setupSection ? "planning-setup-main" : "coordination-main"}
        className="cp-main"
      >
        {!setupSection && (
          <div
            className={
              "cp-toolbar cp-page-heading" +
              (selected ? " cp-page-heading-detail" : "")
            }
          >
            <div>
              <h1>{selected ? "Visit details" : "Visit Coordination"}</h1>
              {!selected && !settings && (
                <p>
                  Plan visits and keep approvals, arrangements and conversations
                  together.
                </p>
              )}
            </div>
            <div className="cp-actions">
              <button
                type="button"
                className="secondary cp-icon-button"
                title="Refresh coordination"
                disabled={loading || busy}
                onClick={() => void refresh()}
                aria-label="Refresh coordination"
              >
                <Icon name="refresh" className={loading ? "cp-spinning" : ""} />
              </button>
              {canInvite && (
                <button
                  className="primary"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    createKey.current = crypto.randomUUID();
                    setDialog("NEW");
                  }}
                >
                  <Icon name="plus" size={18} />
                  Invite visitor
                </button>
              )}
            </div>
          </div>
        )}
        {message && (
          <div className="cp-alert" role="status">
            <span>{message}</span>
            <button
              type="button"
              className="quiet"
              aria-label="Dismiss message"
              onClick={() => setMessage("")}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        {authRequired ? (
          <section className="cp-card">
            <h2>Sign in to continue</h2>
            <p>Your current staff session is unavailable.</p>
            <a className="primary" href={login}>
              Sign in
            </a>
          </section>
        ) : blocked ? (
          <section className="cp-card">
            <h2>Access unavailable</h2>
            <p>This visit or workspace is outside your current access.</p>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setBlocked(false);
                select(null);
                void loadOptions().catch(report);
              }}
            >
              Back to my visits
            </button>
          </section>
        ) : initial ? (
          <section className="cp-card" role="status">
            Loading your coordination workspace…
          </section>
        ) : (setupSection || settings) && canManage ? (
          <PlanningSettings
            options={
              setupSection && officeId
                ? {
                    ...options,
                    locations: options.locations.filter(
                      (l) => l.locationId === officeId,
                    ),
                    accounts: options.accounts.filter(
                      (a) => a.locationId === officeId,
                    ),
                    projects: options.projects.filter(
                      (p) => p.locationId === officeId,
                    ),
                  }
                : options
            }
            section={setupSection}
            accountId={accountId}
            busy={busy}
            onSave={manage}
            onSearch={(q) => void loadOptions(q).catch(report)}
          />
        ) : setupSection ? (
          <p role="status">You cannot manage visit setup in this scope.</p>
        ) : selected ? (
          detail ? (
            <VisitDetail
              detail={detail}
              projectLabels={Object.fromEntries(
                options.projects.map((project) => [
                  project.subProjectId,
                  projectLabel(options, project),
                ]),
              )}
              busy={busy}
              onAction={command}
              onEdit={() => setDialog("EDIT")}
              onBack={() => select(null)}
              onError={report}
            />
          ) : (
            <section className="cp-card" role="status">
              {message
                ? "This visit could not be loaded with your current access."
                : "Loading visit…"}
              <button
                type="button"
                className="secondary"
                onClick={() => select(null)}
              >
                Back to visits
              </button>
            </section>
          )
        ) : (
          <>
            <div className="cp-filters">
              <label className="cp-search">
                Search visitors
                <input
                  type="search"
                  maxLength={80}
                  placeholder="Visitor name or visit reference"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setOffset(0);
                  }}
                />
              </label>
              <label>
                Office
                <select
                  value={office}
                  onChange={(e) => {
                    setOffice(e.target.value);
                    setOffset(0);
                  }}
                >
                  <option value="">All authorized offices</option>
                  {options.locations.map((l) => (
                    <option key={l.locationId} value={l.locationId}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                From date
                <input
                  type="date"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    setOffset(0);
                  }}
                />
              </label>
              <label>
                To date
                <input
                  type="date"
                  min={from}
                  value={untilDate}
                  onChange={(e) => {
                    setUntilDate(e.target.value);
                    setOffset(0);
                  }}
                />
              </label>
            </div>
            <div className="cp-visits" aria-busy={loading}>
              {visits.map((visit) => (
                <button
                  className="cp-visit"
                  type="button"
                  key={visit.id}
                  onClick={() => select(visit.id)}
                >
                  <div className="cp-visit-top">
                    <span className="cp-avatar" aria-hidden="true">
                      {initials(visit.visitorName)}
                    </span>
                    <PlanningStatus value={visit.state} />
                  </div>
                  <strong className="cp-visit-name">{visit.visitorName}</strong>
                  <p className="cp-inline-meta">
                    <Icon name="pin" size={14} />
                    {visit.locationName}
                    {visit.vip && <span className="cp-vip">VIP</span>}
                  </p>
                  <div className="cp-visit-schedule">
                    <Icon name="calendar" size={16} />
                    <span>{displayTime(visit.startsAtUtc)}</span>
                  </div>
                  <small className="cp-visit-host">
                    Visit owner: {visit.hostName}
                  </small>
                  <div className="cp-visit-footer">
                    <span>View visit</span>
                    <Icon name="arrow" size={16} />
                  </div>
                </button>
              ))}
            </div>
            {!visits.length && (
              <section className="cp-card cp-empty-state">
                <span className="cp-empty-icon">
                  <Icon name="calendar" size={25} />
                </span>
                <h2>{loading ? "Loading visits…" : "No matching visits"}</h2>
                <p>
                  {folder === "ASSIGNED"
                    ? "Approvals and arrangement requests assigned to you will appear here."
                    : "Invitations you can access will appear here."}
                </p>
              </section>
            )}
            <div className="cp-toolbar cp-pagination">
              <button
                type="button"
                className="secondary"
                disabled={loading || offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 50))}
              >
                Previous
              </button>
              <span className="cp-muted">
                Page {Math.floor(offset / 50) + 1}
              </span>
              <button
                type="button"
                className="secondary"
                disabled={loading || !hasMore}
                onClick={() => setOffset(offset + 50)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </Content>
      <Dialog
        id="coordination-invitation"
        open={dialog !== null}
        onDismiss={() => {
          if (!busy) setDialog(null);
        }}
        aria-labelledby="coordination-invitation-title"
      >
        <div className="cp-dialog-head">
          <h2 id="coordination-invitation-title">
            {dialog === "EDIT" ? "Revise invitation" : "Invite visitor"}
          </h2>
          <button
            type="button"
            className="quiet"
            aria-label="Close invitation form"
            disabled={busy}
            onClick={() => setDialog(null)}
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="cp-dialog-body">
          {dialog && (
            <InvitationForm
              key={dialog + ":" + (detail?.id ?? "new")}
              options={options}
              preferredLocationId={officeId ?? (Number(office) || undefined)}
              initial={dialog === "EDIT" ? (detail ?? undefined) : undefined}
              busy={busy}
              onSave={saveDraft}
              onCancel={() => setDialog(null)}
            />
          )}
        </div>
      </Dialog>
    </>
  );
}
