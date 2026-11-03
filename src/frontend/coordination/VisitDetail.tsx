import { coordinationRole } from "./roles.ts";
import { GroupMembers } from "./VisitGroupCatalogue.tsx";
import { PreparationSummary } from "./PreparationSummary.tsx";
import { useState, useRef, useEffect, type FormEvent } from "react";
import type { Detail, Thread } from "./types.ts";
import { displayTime } from "./types.ts";
import { coordinationRequest } from "./client.ts";
import { PeopleSelect } from "./Settings.tsx";
import { Icon, initials, type CoordinationIconName } from "./Icons.tsx";
const pretty = (value: string) =>
  value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
export function PlanningStatus({ value }: { value: string }) {
  return (
    <span className={"cp-status cp-status-" + value.toLowerCase()}>
      <span className="cp-status-dot" />
      {pretty(value)}
    </span>
  );
}
type Act = (command: unknown) => Promise<void>;
function ApprovalAction({
  step,
  busy,
  onAction,
}: {
  step: Detail["approvals"][number];
  busy: boolean;
  onAction: Act;
}) {
  const [reason, setReason] = useState(""),
    [reference, setReference] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const button = (e.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    if (busy || !button || !e.currentTarget.reportValidity()) return;
    try {
      await onAction({
        kind: "DECIDE",
        stepId: step.id,
        decision: button.value,
        reason: reason.trim(),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      });
    } catch {}
  }
  return (
    <form className="cp-form" onSubmit={submit}>
      <label>
        Decision remarks
        <input
          required
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {step.kind === "CLIENT_CONFIRMATION" && (
        <label>
          Internal client permission reference
          <input
            maxLength={300}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </label>
      )}
      <div className="cp-actions">
        <button
          className="secondary"
          name="decision"
          value="REJECTED"
          disabled={busy}
        >
          Reject
        </button>
        <button
          className="primary"
          name="decision"
          value="APPROVED"
          disabled={
            busy || (step.kind === "CLIENT_CONFIRMATION" && !reference.trim())
          }
        >
          Approve
        </button>
      </div>
    </form>
  );
}
function TaskAction({
  task,
  busy,
  onAction,
}: {
  task: Detail["tasks"][number];
  busy: boolean;
  onAction: Act;
}) {
  const [status, setStatus] = useState(
      task.status === "REQUESTED" ? "IN_PROGRESS" : task.status,
    ),
    [remark, setRemark] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !e.currentTarget.reportValidity()) return;
    try {
      await onAction({
        kind: "ARRANGE",
        taskId: task.id,
        status,
        remark: remark.trim(),
      });
      setRemark("");
    } catch {}
  }
  return (
    <form className="cp-form" onSubmit={submit}>
      <div className="cp-grid">
        <label>
          Arrangement result
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="IN_PROGRESS">In progress</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="UNAVAILABLE">Unavailable</option>
          </select>
        </label>
        <label>
          Result / correction remarks
          <input
            maxLength={1000}
            required
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
          />
        </label>
      </div>
      <button className="secondary" disabled={busy || status === task.status}>
        Update arrangement
      </button>
    </form>
  );
}
function Discussion({
  thread,
  detail,
  busy,
  onAction,
  onError,
}: {
  thread: Thread;
  detail: Detail;
  busy: boolean;
  onAction: Act;
  onError: (error: unknown) => void;
}) {
  const [body, setBody] = useState(""),
    [reply, setReply] = useState<string | null>(null),
    [mentions, setMentions] = useState<string[]>([]),
    [messages, setMessages] = useState<Thread["messages"]>([]),
    [readers, setReaders] = useState(thread.readers),
    [before, setBefore] = useState<string | undefined>(),
    [more, setMore] = useState(false),
    [loading, setLoading] = useState(false);
  const messageId = useRef(crypto.randomUUID()),
    generation = useRef(0),
    controllers = useRef(new Set<AbortController>());
  async function load(cursor?: string) {
    const epoch = generation.current,
      controller = new AbortController();
    controllers.current.add(controller);
    const timer = setTimeout(() => controller.abort(), 25000);
    setLoading(true);
    try {
      const page = await coordinationRequest(
        "thread",
        {
          planId: detail.id,
          threadId: thread.id,
          ...(cursor ? { beforeMessageId: cursor } : {}),
        },
        controller.signal,
      );
      if (epoch === generation.current) {
        setMessages((previous) =>
          cursor
            ? [
                ...page.messages,
                ...previous.filter(
                  (m) =>
                    !page.messages.some((n: { id: string }) => n.id === m.id),
                ),
              ]
            : page.messages,
        );
        setReaders(page.readers);
        setMore(page.hasMore);
        setBefore(page.nextBeforeId);
      }
    } catch (error) {
      if (epoch === generation.current && !controller.signal.aborted) {
        setMessages([]);
        onError(error);
      }
    } finally {
      clearTimeout(timer);
      controllers.current.delete(controller);
      if (epoch === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    generation.current++;
    void load();
    return () => {
      generation.current++;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
    };
  }, [detail.id, detail.revision, thread.id]);
  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !e.currentTarget.reportValidity()) return;
    try {
      await onAction({
        kind: "COMMENT",
        threadId: thread.id,
        messageId: messageId.current,
        body: body.trim(),
        replyToId: reply,
        mentionIds: mentions,
      });
      messageId.current = crypto.randomUUID();
      setBody("");
      setReply(null);
      setMentions([]);
    } catch {}
  }
  const open =
    detail.state === "SUBMITTED" && Date.parse(detail.untilUtc) > Date.now();
  return (
    <section className="cp-thread">
      <div className="cp-row">
        <div>
          <h3>{thread.title}</h3>
          <small>
            {pretty(thread.audience)} · {thread.resolved ? "Resolved" : "Open"}
          </small>
        </div>
        {thread.canResolve && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() =>
              void onAction({
                kind: "THREAD_STATE",
                threadId: thread.id,
                resolved: !thread.resolved,
              }).catch(() => {})
            }
          >
            {thread.resolved ? "Reopen" : "Resolve"}
          </button>
        )}
      </div>
      {more && (
        <button
          className="secondary"
          type="button"
          disabled={loading}
          onClick={() => void load(before)}
        >
          Load earlier messages
        </button>
      )}
      {loading && <p role="status">Loading messages…</p>}
      <ol className="cp-messages">
        {messages.map((m) => (
          <li key={m.id}>
            <div className="cp-row">
              <strong>{m.authorName}</strong>
              <time dateTime={m.atUtc}>{displayTime(m.atUtc)}</time>
            </div>
            {m.replyToId && (
              <p className="cp-reply">
                Reply to{" "}
                {messages.find((x) => x.id === m.replyToId)?.authorName ??
                  "earlier message"}
              </p>
            )}
            <p className="cp-message-body">{m.body}</p>
            {m.mentions.length > 0 && (
              <small>
                Mentioned: {m.mentions.map((p) => p.name).join(", ")}
              </small>
            )}
            {open && !thread.resolved && (
              <button
                className="quiet"
                type="button"
                onClick={() => setReply(m.id)}
              >
                Reply
              </button>
            )}
          </li>
        ))}
      </ol>
      {open && !thread.resolved ? (
        <form className="cp-form" onSubmit={send}>
          {reply && (
            <div className="cp-row">
              <span>
                Replying to{" "}
                {messages.find((m) => m.id === reply)?.authorName ??
                  "earlier message"}
              </span>
              <button
                type="button"
                className="quiet"
                onClick={() => setReply(null)}
              >
                Cancel reply
              </button>
            </div>
          )}
          <label>
            Message
            <textarea
              maxLength={4000}
              required
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <PeopleSelect
            label="Mention participants (optional)"
            people={readers.filter((p) => p.userId !== detail.actorId)}
            value={mentions}
            onChange={setMentions}
          />
          <button className="primary" disabled={busy || !body.trim()}>
            Send message
          </button>
        </form>
      ) : (
        <p className="cp-muted">
          {thread.resolved
            ? "This thread is resolved."
            : "This visit is not open for new messages."}
        </p>
      )}
    </section>
  );
}
function ThreadForm({
  detail,
  busy,
  onAction,
  onCreated,
}: {
  detail: Detail;
  busy: boolean;
  onAction: Act;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState(""),
    [scope, setScope] = useState("GENERAL");
  const threadId = useRef(crypto.randomUUID());
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !e.currentTarget.reportValidity()) return;
    const [kind, id] = scope.split(":");
    const approval = detail.approvals.find((a) => a.id === id);
    try {
      await onAction({
        kind: "THREAD",
        threadId: threadId.current,
        title: title.trim(),
        audience: kind === "PROJECT" ? "GENERAL" : kind,
        subProjectId:
          kind === "PROJECT"
            ? id
            : kind === "APPROVAL"
              ? (approval?.subProjectId ?? null)
              : null,
        targetId: kind === "APPROVAL" || kind === "OPERATIONS" ? id : null,
      });
      onCreated(threadId.current);
      threadId.current = crypto.randomUUID();
      setTitle("");
    } catch {}
  }
  return (
    <form className="cp-form" onSubmit={submit}>
      <div className="cp-grid">
        <label>
          Thread topic
          <input
            required
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Audience
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="GENERAL">General visit coordination</option>
            {detail.projects.map((p) => (
              <option key={p.subProjectId} value={"PROJECT:" + p.subProjectId}>
                Project discussion · {p.name}
              </option>
            ))}
            {detail.approvals
              .filter((a) => a.canDiscuss)
              .map((a) => (
                <option key={a.id} value={"APPROVAL:" + a.id}>
                  Private {a.subProjectId ? "host" : "authority"} review ·{" "}
                  {a.name}
                </option>
              ))}
            {detail.tasks
              .filter((t) => detail.canEdit || detail.canManage || t.canUpdate)
              .map((t) => (
                <option key={t.id} value={"OPERATIONS:" + t.id}>
                  Arrangement · {t.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <p className="cp-muted">
        A general thread is shared with authorized visit participants. Private
        reviews and arrangement threads have a narrower audience.
      </p>
      <button className="secondary" disabled={busy || !title.trim()}>
        Create thread
      </button>
    </form>
  );
}

const activityNames: Record<string, string> = {
  CREATED: "Invitation created",
  SUBMIT: "Sent for review",
  DECIDE: "Approval decision recorded",
  ARRANGE: "Arrangement updated",
  THREAD: "Discussion started",
  COMMENT: "Message added",
  THREAD_STATE: "Discussion updated",
  CANCEL: "Visit cancelled",
  REVISE: "Visit revised",
};
const datePart = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
const timePart = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
function duration(from: string, until: string) {
  const minutes = Math.round((Date.parse(until) - Date.parse(from)) / 60000),
    days = Math.floor(minutes / 1440),
    hours = Math.floor((minutes % 1440) / 60),
    rest = minutes % 60;
  return (
    [days ? days + "d" : "", hours ? hours + "h" : "", rest ? rest + "m" : ""]
      .filter(Boolean)
      .join(" ") || "Less than a minute"
  );
}
export function VisitDetail({
  detail,
  busy,
  onAction,
  onEdit,
  onBack,
  onError,
  projectLabels = {},
}: {
  detail: Detail;
  busy: boolean;
  onAction: Act;
  onEdit: () => void;
  onBack: () => void;
  onError: (error: unknown) => void;
  projectLabels?: Record<string, string>;
}) {
  const [section, setSection] = useState("process"),
    [cancel, setCancel] = useState(false),
    [reason, setReason] = useState(""),
    [activeThread, setActiveThread] = useState<string | null>(null);
  const open =
      detail.state === "SUBMITTED" && Date.parse(detail.untilUtc) > Date.now(),
    closed = detail.state === "CANCELLED",
    expired = Date.parse(detail.untilUtc) <= Date.now();
  const approved = detail.approvals.filter(
    (step) => step.status === "APPROVED",
  ).length;
  const lastCancellation = detail.activity.find(
    (event) => event.kind === "CANCEL",
  );
  const role = coordinationRole(detail);
  const tabs: {
    key: string;
    label: string;
    name: string;
    icon: CoordinationIconName;
    count: number;
  }[] = [
    {
      key: "process",
      label: "Approvals",
      name: "Process & approvals",
      icon: "shield",
      count: detail.approvals.length,
    },
    {
      key: "arrangements",
      label: "Arrangements",
      name: "Arrangements",
      icon: "building",
      count: detail.tasks.length,
    },
    {
      key: "discussion",
      label: "Discussion",
      name: "Discussion (" + detail.threads.length + ")",
      icon: "chat",
      count: detail.threads.length,
    },
    {
      key: "activity",
      label: "Activity",
      name: "Activity",
      icon: "history",
      count: detail.activity.length,
    },
  ];
  return (
    <>
      <div className="cp-detail-breadcrumb">
        <button type="button" className="quiet" onClick={onBack}>
          <Icon name="back" />
          All visits
        </button>
        <span className="cp-version">Revision {detail.version}</span>
      </div>
      <section className="cp-summary" aria-label="Visit summary">
        <div className="cp-summary-top">
          <div className="cp-identity">
            <span className="cp-avatar cp-avatar-large" aria-hidden="true">
              {initials(detail.visitorName)}
            </span>
            <div>
              <div className="cp-heading">
                <h2>{detail.visitorName}</h2>
                {detail.vip && <span className="cp-vip">Leadership / VIP</span>}
              </div>
              <div className="cp-inline-meta">
                <span>
                  <Icon name="pin" size={14} />
                  {detail.locationName}
                </span>
                <span>
                  <Icon name="user" size={14} />
                  Visit owner: {detail.hostName}
                </span>
              </div>
            </div>
          </div>
          <PlanningStatus value={detail.state} />
        </div>
        <div className="cp-schedule">
          <div className="cp-schedule-stop">
            <span className="cp-field-icon">
              <Icon name="calendar" />
            </span>
            <div>
              <small>Arrival</small>
              <strong>
                {datePart(detail.startsAtUtc)}
                <span>{timePart(detail.startsAtUtc)}</span>
              </strong>
            </div>
          </div>
          <span className="cp-duration">
            <Icon name="clock" size={14} />
            {duration(detail.startsAtUtc, detail.untilUtc)}
            <Icon name="arrow" size={16} />
          </span>
          <div className="cp-schedule-stop">
            <span className="cp-field-icon">
              <Icon name="calendar" />
            </span>
            <div>
              <small>Departure</small>
              <strong>
                {datePart(detail.untilUtc)}
                <span>{timePart(detail.untilUtc)}</span>
              </strong>
            </div>
          </div>
        </div>
        {(detail.purpose || detail.visitorEmail || detail.company) && (
          <div className="cp-summary-extra">
            {detail.purpose && (
              <div className="cp-purpose">
                <small>Purpose of visit</small>
                <p>{detail.purpose}</p>
              </div>
            )}
            {(detail.visitorEmail || detail.company) && (
              <div className="cp-inline-meta">
                {detail.visitorEmail && (
                  <span>
                    <Icon name="mail" size={15} />
                    {detail.visitorEmail}
                  </span>
                )}
                {detail.company && (
                  <span>
                    <Icon name="building" size={15} />
                    {detail.company}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </section>
      {closed ? (
        <div className="cp-state-note cp-state-note-closed">
          <Icon name="close" />
          <div>
            <strong>This visit was cancelled</strong>
            <p>
              {lastCancellation?.reason ??
                "This invitation is closed. Previous decisions and activity remain available below."}
            </p>
          </div>
          {lastCancellation && (
            <time dateTime={lastCancellation.atUtc}>
              {displayTime(lastCancellation.atUtc)}
            </time>
          )}
        </div>
      ) : expired ? (
        <div className="cp-state-note">
          <Icon name="clock" />
          <div>
            <strong>The visit window has ended</strong>
            <p>
              Review the recorded approvals, arrangements and discussion below.
            </p>
          </div>
        </div>
      ) : detail.state === "DRAFT" ? (
        <div className="cp-state-note">
          <Icon name="edit" />
          <div>
            <strong>Draft invitation</strong>
            <p>
              {detail.canEdit
                ? "Review the visit details, then submit it for approval."
                : "The visit owner has not submitted this invitation yet."}
            </p>
          </div>
          {detail.canEdit && (
            <button
              className="primary"
              type="button"
              disabled={busy}
              onClick={() => void onAction({ kind: "SUBMIT" }).catch(() => {})}
            >
              Submit visit plan
              <Icon name="arrow" size={16} />
            </button>
          )}
        </div>
      ) : null}
      {detail.canEdit && !closed && (
        <div className="cp-detail-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onEdit}
          >
            <Icon name="edit" size={16} />
            {detail.state === "DRAFT" ? "Edit draft" : "Revise / reschedule"}
          </button>
          <button
            type="button"
            className="quiet cp-danger-link"
            disabled={busy}
            aria-expanded={cancel}
            onClick={() => setCancel(!cancel)}
          >
            <Icon name="close" size={16} />
            Cancel visit
          </button>
        </div>
      )}
      {cancel && (
        <form
          className="cp-card cp-form cp-cancel-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && e.currentTarget.reportValidity())
              void onAction({ kind: "CANCEL", reason: reason.trim() })
                .then(() => setCancel(false))
                .catch(() => {});
          }}
        >
          <label>
            Cancellation reason
            <input
              required
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="cp-actions">
            <button
              className="secondary"
              type="button"
              onClick={() => setCancel(false)}
            >
              Keep visit
            </button>
            <button className="primary" disabled={busy}>
              Confirm cancellation
            </button>
          </div>
        </form>
      )}
      <PreparationSummary detail={detail} />
      {!!detail.selectedGroups?.length && (
        <section className="cp-panel" aria-label="Selected visit groups">
          <h3>Selected approval & notification groups</h3>
          {detail.selectedGroups.map((group) => (
            <div key={group.id} className="cp-group-card">
              <h4>{group.name}</h4>
              <small>Revision {group.revision}</small>
              <GroupMembers group={group} />
            </div>
          ))}
        </section>
      )}
      <div className="cp-detail-layout">
        <div className="cp-detail-content">
          <nav className="cp-tabs cp-detail-tabs" aria-label="Visit sections">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={section === tab.key ? "selected" : ""}
                aria-label={tab.name}
                aria-pressed={section === tab.key}
                onClick={() => setSection(tab.key)}
              >
                <Icon name={tab.icon} size={17} />
                <span>{tab.label}</span>
                <span className="cp-tab-count" aria-hidden="true">
                  {tab.count}
                </span>
              </button>
            ))}
          </nav>
          {section === "process" && (
            <section className="cp-panel" aria-label="Approval progress">
              <div className="cp-panel-heading">
                <div>
                  <h3>{closed ? "Approval history" : "Approval progress"}</h3>
                  <p>
                    {closed
                      ? "Decisions recorded before this visit was closed."
                      : "Office and project reviews are tracked separately."}
                  </p>
                </div>
                <span className="cp-progress-count">
                  {approved}
                  <span> / {detail.approvals.length} approved</span>
                </span>
              </div>
              <div
                className="cp-progress-track"
                role="progressbar"
                aria-label="Approved review steps"
                aria-valuenow={approved}
                aria-valuemin={0}
                aria-valuemax={Math.max(1, detail.approvals.length)}
              >
                <span
                  style={{
                    width:
                      (detail.approvals.length
                        ? (approved / detail.approvals.length) * 100
                        : 0) + "%",
                  }}
                />
              </div>
              <ol className="cp-approval-list">
                {detail.approvals.map((step, index) => (
                  <li
                    key={step.id}
                    className={
                      "cp-approval cp-approval-" + step.status.toLowerCase()
                    }
                  >
                    <div className="cp-step-marker" aria-hidden="true">
                      {step.status === "APPROVED" ? (
                        <Icon name="check" size={16} />
                      ) : step.status === "REJECTED" ? (
                        <Icon name="close" size={16} />
                      ) : (
                        index + 1
                      )}
                    </div>
                    <div className="cp-approval-body">
                      <div className="cp-row">
                        <div>
                          <span className="cp-step-kind">
                            {step.subProjectId
                              ? "Host approval"
                              : "Office review"}
                            {step.kind === "CLIENT_CONFIRMATION"
                              ? " · Client permission"
                              : ""}
                          </span>
                          <h3>{step.name}</h3>
                          <p className="cp-step-rule">
                            {step.mode === "ALL"
                              ? "Every assigned reviewer must approve"
                              : "One assigned reviewer's decision is required"}
                          </p>
                        </div>
                        <PlanningStatus value={step.status} />
                      </div>
                      {step.approvers && (
                        <p className="cp-step-rule">
                          {step.subProjectId
                            ? "Assigned hosts:"
                            : "Assigned reviewers:"}{" "}
                          {step.approvers
                            .map((person) => person.name)
                            .join(", ") || "No current active reviewer"}
                        </p>
                      )}
                      {step.decisions.map((decision, i) => (
                        <div key={i} className="cp-decision">
                          <span
                            className="cp-avatar cp-avatar-small"
                            aria-hidden="true"
                          >
                            {initials(decision.name)}
                          </span>
                          <div>
                            <p>
                              <strong>{decision.name}</strong> ·{" "}
                              {pretty(decision.decision)}
                            </p>
                            <p>{decision.reason}</p>
                            {decision.reference && (
                              <small>
                                Client reference: {decision.reference}
                              </small>
                            )}
                            <time dateTime={decision.atUtc}>
                              {displayTime(decision.atUtc)}
                            </time>
                          </div>
                        </div>
                      ))}
                      {step.canDecide && (
                        <ApprovalAction
                          step={step}
                          busy={busy}
                          onAction={onAction}
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              {!detail.approvals.length && (
                <div className="cp-empty-inline">
                  <Icon name="shield" size={24} />
                  <p>No approval steps are visible in your current role.</p>
                </div>
              )}
            </section>
          )}
          {section === "arrangements" && (
            <div className="cp-panel-stack">
              {detail.stayCheckInDate && (
                <section className="cp-panel cp-stay-window">
                  <span className="cp-tile-icon">
                    <Icon name="building" />
                  </span>
                  <div>
                    <h3>Stay request</h3>
                    <p>
                      {detail.stayCheckInDate} <span aria-hidden="true">→</span>{" "}
                      {detail.stayCheckOutDate}
                      <small>Check-in to check-out</small>
                    </p>
                    {detail.stayNotes && <p>{detail.stayNotes}</p>}
                  </div>
                </section>
              )}
              {detail.tasks.map((task) => (
                <section className="cp-panel" key={task.id}>
                  <div className="cp-panel-heading">
                    <div>
                      <h3>{task.name}</h3>
                      <p>{task.owners.map((owner) => owner.name).join(", ")}</p>
                    </div>
                    <PlanningStatus value={task.status} />
                  </div>
                  <div className="cp-task-requirement">
                    <Icon
                      name={task.mandatoryForEntry ? "shield" : "building"}
                      size={14}
                    />
                    {task.mandatoryForEntry
                      ? "Required for planning readiness"
                      : "Coordination request"}
                  </div>
                  {task.remark && (
                    <p className="cp-result-note">{task.remark}</p>
                  )}
                  {task.canUpdate && (
                    <TaskAction
                      key={task.id + task.status}
                      task={task}
                      busy={busy}
                      onAction={onAction}
                    />
                  )}
                </section>
              ))}
              {!detail.tasks.length && (
                <section className="cp-panel cp-empty-inline">
                  <Icon name="building" size={28} />
                  <div>
                    <h3>No arrangements to manage</h3>
                    <p>No arrangements are assigned to you for this visit.</p>
                  </div>
                </section>
              )}
            </div>
          )}
          {section === "discussion" && (
            <div className="cp-panel-stack">
              <section className="cp-panel">
                <div className="cp-panel-heading">
                  <div>
                    <h3>Visit discussion</h3>
                    <p>Keep requests, replies and coordination in one place.</p>
                  </div>
                  <span className="cp-tile-icon">
                    <Icon name="chat" />
                  </span>
                </div>
                {open ? (
                  <ThreadForm
                    detail={detail}
                    busy={busy}
                    onAction={onAction}
                    onCreated={setActiveThread}
                  />
                ) : (
                  <p className="cp-muted">
                    {closed
                      ? "This visit is closed. Existing discussions remain available to their authorized participants."
                      : "Discussion opens after submission and closes when the visit ends."}
                  </p>
                )}
              </section>
              {detail.threads.map((thread) => (
                <div key={thread.id}>
                  <button
                    className="cp-thread-toggle"
                    type="button"
                    aria-expanded={activeThread === thread.id}
                    onClick={() =>
                      setActiveThread(
                        activeThread === thread.id ? null : thread.id,
                      )
                    }
                  >
                    <span className="cp-thread-title">
                      <Icon name="chat" />
                      <span>
                        <strong>{thread.title}</strong>
                        <small>
                          {pretty(thread.audience)} ·{" "}
                          {thread.resolved ? "Resolved" : "Open"}
                        </small>
                      </span>
                    </span>
                    <Icon name="chevron" size={16} />
                  </button>
                  {activeThread === thread.id && (
                    <Discussion
                      thread={thread}
                      detail={detail}
                      busy={busy}
                      onAction={onAction}
                      onError={onError}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
          {section === "activity" && (
            <section className="cp-panel">
              <div className="cp-panel-heading">
                <div>
                  <h3>Activity history</h3>
                  <p>Changes recorded for this invitation.</p>
                </div>
                <Icon name="history" />
              </div>
              <ol className="cp-timeline">
                {detail.activity.map((event) => (
                  <li key={event.sequence}>
                    <span className="cp-timeline-dot" aria-hidden="true" />
                    <div>
                      <strong>
                        {activityNames[event.kind] ?? pretty(event.kind)}
                      </strong>
                      {event.reason && <p>{event.reason}</p>}
                      <small>
                        Revision {event.version} ·{" "}
                        <time dateTime={event.atUtc}>
                          {displayTime(event.atUtc)}
                        </time>
                      </small>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
        <aside className="cp-visit-aside" aria-label="Visit information">
          <section className="cp-panel">
            <div className="cp-aside-heading">
              <Icon name="pin" />
              <h3>Destinations</h3>
            </div>
            <p className="cp-aside-office">{detail.locationName}</p>
            {detail.projects.map((project) => (
              <div className="cp-destination" key={project.subProjectId}>
                <strong>
                  {projectLabels[project.subProjectId] ?? project.name}
                </strong>
                <PlanningStatus value={project.readiness} />
              </div>
            ))}
            {!detail.projects.length && (
              <p className="cp-muted">
                {detail.locationReadiness
                  ? "Location visit"
                  : "No project details shared with your role"}
              </p>
            )}
            {detail.locationReadiness && (
              <PlanningStatus value={detail.locationReadiness} />
            )}
            <p className="cp-entry-note">
              <Icon name="shield" size={14} />
              Gate entry is verified separately.
            </p>
          </section>
          <section className="cp-panel">
            <div className="cp-aside-heading">
              <Icon name="people" />
              <h3>People & access</h3>
            </div>
            <div className="cp-person-row">
              <span className="cp-avatar" aria-hidden="true">
                {initials(detail.hostName)}
              </span>
              <div>
                <small>Visit owner</small>
                <strong>{detail.hostName}</strong>
              </div>
            </div>
            <div className="cp-your-role">
              <small>Your role for this visit</small>
              <strong>{role}</strong>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
