import { InvitationReview } from "./InvitationReview.tsx";
import { useVisitGroups, VisitGroupSelector } from "./VisitGroupCatalogue.tsx";
import type { VisitGroupReference } from "../../shared/VisitGroups.ts";
import { PreparationFields, emptyPreparation } from "./PreparationFields.tsx";
import { AdditionalPeopleEditor } from "./AdditionalPeopleEditor.tsx";
import { RoutingNames, usePlanningRouting } from "./RoutingPreview.tsx";
import type {
  VisitPreparation,
  AdditionalPlanningPerson,
} from "../../shared/VisitPreparation.ts";
import type { Contact } from "./types.ts";
import { projectLabel } from "./types.ts";
import { useState, useRef, useEffect, type FormEvent } from "react";
import type { Detail, Options } from "./types.ts";
import { officeInput, utcFromOffice } from "./types.ts";
function followingDay(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) return "";
  const time = Date.parse(day + "T00:00:00.000Z");
  return Number.isFinite(time)
    ? new Date(time + 86400000).toISOString().slice(0, 10)
    : "";
}
export function InvitationForm({
  options,
  preferredLocationId,
  initial,
  busy,
  onSave,
  onCancel,
}: {
  options: Options;
  preferredLocationId?: number;
  initial?: Detail;
  busy: boolean;
  onSave: (draft: unknown, reason?: string) => Promise<void>;
  onCancel: () => void;
}) {
  const source = initial?.draft;
  const [location, setLocation] = useState(
    source?.locationId ??
      options.locations.find(
        (office) =>
          office.locationId === preferredLocationId &&
          (office.canHostLocation ||
            options.projects.some(
              (project) =>
                project.locationId === office.locationId && project.canHost,
            )),
      )?.locationId ??
      options.locations.find(
        (l) =>
          l.canHostLocation ||
          options.projects.some(
            (p) => p.locationId === l.locationId && p.canHost,
          ),
      )?.locationId ??
      0,
  );
  const [projects, setProjects] = useState<string[]>(
    source?.subProjects.map((p) => p.value) ?? [],
  );
  const [name, setName] = useState(source?.visitorName ?? ""),
    [email, setEmail] = useState(source?.visitorEmail ?? ""),
    [company, setCompany] = useState(source?.company ?? ""),
    [purpose, setPurpose] = useState(source?.purpose ?? ""),
    [vip, setVip] = useState(source?.vip ?? false);
  const [start, setStart] = useState(
      officeInput(
        source?.startsAtUtc ?? new Date(Date.now() + 3 * 3600000).toISOString(),
      ),
    ),
    [until, setUntil] = useState(
      officeInput(
        source?.untilUtc ?? new Date(Date.now() + 6 * 3600000).toISOString(),
      ),
    );
  const [stay, setStay] = useState(!!source?.checkInDate),
    [checkIn, setCheckIn] = useState(source?.checkInDate ?? start.slice(0, 10)),
    [checkOut, setCheckOut] = useState(
      source?.checkOutDate ??
        followingDay(source?.checkInDate ?? start.slice(0, 10)),
    ),
    [notes, setNotes] = useState(source?.stayNotes ?? ""),
    [reason, setReason] = useState("");
  const hostLocation = options.locations.find((l) => l.locationId === location),
    available = options.projects.filter(
      (p) => p.locationId === location && p.active && p.canHost,
    );
  const [preparation, setPreparation] = useState<VisitPreparation>(
    source?.preparation ?? structuredClone(emptyPreparation),
  );
  const [additionalPeople, setAdditionalPeople] = useState<
    AdditionalPlanningPerson[]
  >(source?.additionalPeople ?? []);
  const [contacts, setContacts] = useState<Record<string, Contact>>(() =>
    Object.fromEntries(
      [
        ...options.people,
        ...(initial?.preparation?.contacts ?? []),
        ...(initial?.additionalPeople ?? []),
        { userId: options.actorId, name: options.displayName },
      ].map((person) => [person.userId, person]),
    ),
  );
  const remember = (person: Contact) =>
    setContacts((previous) => ({ ...previous, [person.userId]: person }));
  const routing = usePlanningRouting(location, projects);
  const groupCatalogue = useVisitGroups(location);
  const [groups, setGroups] = useState<VisitGroupReference[]>(
    source?.groups ?? [],
  );
  const peopleEditor = (scope: string | undefined, label: string) => (
    <AdditionalPeopleEditor
      key={scope ?? "office"}
      locationId={location}
      scope={scope}
      label={label}
      actorId={options.actorId}
      people={additionalPeople}
      contacts={contacts}
      onChange={setAdditionalPeople}
      onContact={remember}
    />
  );
  function changeArrival(value: string) {
    const previousDay = start.slice(0, 10),
      nextDay = value.slice(0, 10);
    setStart(value);
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value) ||
      !Number.isFinite(Date.parse(value + ":00+05:30"))
    )
      return;
    if (checkIn === previousDay) {
      setCheckIn(nextDay);
      if (checkOut === followingDay(previousDay))
        setCheckOut(followingDay(nextDay));
    }
    if (until <= value)
      setUntil(
        officeInput(
          new Date(Date.parse(value + ":00+05:30") + 3 * 3600000).toISOString(),
        ),
      );
  }
  function changeCheckIn(day: string) {
    setCheckIn(day);
    if (day && (!checkOut || checkOut <= day)) setCheckOut(followingDay(day));
  }
  const toUtc = (value: string) => {
    try {
      return utcFromOffice(value);
    } catch {
      return "";
    }
  };
  const draft = {
    locationId: location,
    subProjectIds: projects,
    visitorName: name.trim(),
    ...(email.trim() ? { visitorEmail: email.trim() } : {}),
    ...(company.trim() ? { company: company.trim() } : {}),
    purpose: purpose.trim(),
    startsAtUtc: toUtc(start),
    untilUtc: toUtc(until),
    vip,
    preparation,
    additionalPeople,
    groups,
    ...(stay
      ? {
          stay: {
            checkInDate: checkIn,
            checkOutDate: checkOut,
            ...(notes.trim() ? { notes: notes.trim() } : {}),
          },
        }
      : {}),
  };
  const steps = [
    "Visitor",
    "Visit",
    "Approvals",
    "Details",
    "Support",
    "Review",
  ];
  const [step, setStep] = useState(0),
    [furthest, setFurthest] = useState(0),
    [stepError, setStepError] = useState("");
  const form = useRef<HTMLFormElement>(null),
    panels = useRef<(HTMLFieldSetElement | null)[]>([]),
    heading = useRef<HTMLHeadingElement>(null),
    invalid = useRef<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null
    >(null);
  const routingUnavailable =
    routing.loading ||
    routing.error ||
    groupCatalogue.loading ||
    groupCatalogue.error;
  const invalidGroups = groups.some(
    (ref) =>
      !groupCatalogue.rows.some(
        (group) =>
          group.id === ref.id &&
          group.revision === ref.revision &&
          group.active &&
          (!group.vipOnly || vip) &&
          (!group.subProjectId || projects.includes(group.subProjectId)),
      ),
  );
  useEffect(() => {
    form.current?.closest(".cp-dialog-body")?.scrollTo({ top: 0 });
    if (invalid.current) {
      invalid.current.reportValidity();
      invalid.current = null;
    } else heading.current?.focus({ preventScroll: true });
  }, [step]);
  function go(next: number) {
    setStepError("");
    setStep(next);
    setFurthest((previous) => Math.max(previous, next));
  }
  function validate(index: number) {
    const panel = panels.current[index];
    if (!panel) return true;
    const wasDisabled = panel.disabled;
    panel.disabled = false;
    const bad = [
      ...panel.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >("input,select,textarea"),
    ].find((input) => input.willValidate && !input.checkValidity());
    panel.disabled = wasDisabled;
    let error = "";
    if (bad) error = "Complete the highlighted field before continuing.";
    if (index === 0 && (!location || !name.trim()))
      error = "Enter the visitor name and select an office.";
    if (
      index === 1 &&
      (!purpose.trim() ||
        !draft.startsAtUtc ||
        !draft.untilUtc ||
        start >= until)
    )
      error = "Enter a purpose and a valid arrival/departure window.";
    if (index === 1 && !projects.length && !hostLocation?.canHostLocation)
      error = "Select an authorized destination.";
    if (index === 2 && (routingUnavailable || invalidGroups))
      error =
        "Review the current approval recipients and groups before continuing.";
    if (
      index === 4 &&
      preparation.services.length &&
      !preparation.coordinatorId
    )
      error = "Select an internal coordinator for the requested support.";
    if (error) {
      setStep(index);
      setStepError(error);
      if (bad) {
        if (index === step) bad.reportValidity();
        else invalid.current = bad;
      }
      return false;
    }
    return true;
  }
  function next() {
    if (!busy && validate(step)) go(step + 1);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (step < 5) {
      next();
      return;
    }
    for (let index = 0; index < 6; index++) if (!validate(index)) return;
    try {
      await onSave(draft, initial ? reason.trim() : undefined);
    } catch {}
  }
  return (
    <form
      ref={form}
      className="cp-form cp-invitation-wizard"
      noValidate
      onSubmit={submit}
    >
      <nav aria-label="Invitation progress" className="cp-wizard-progress">
        <ol>
          {steps.map((name, index) => (
            <li key={name}>
              <button
                type="button"
                disabled={busy || index > furthest}
                aria-current={step === index ? "step" : undefined}
                onClick={() => {
                  if (index > step) {
                    for (let current = 0; current < index; current++)
                      if (!validate(current)) return;
                  }
                  go(index);
                }}
              >
                <span>{index + 1}</span>
                <small>{name}</small>
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <div className="cp-wizard-heading">
        <p className="cp-muted">
          Step {step + 1} of {steps.length}
        </p>
        <h3 ref={heading} tabIndex={-1}>
          {steps[step]}
        </h3>
      </div>
      {stepError && (
        <p className="cp-wizard-error" role="alert">
          {stepError}
        </p>
      )}
      <fieldset
        className="cp-step-panel"
        ref={(node) => {
          panels.current[0] = node;
        }}
        disabled={busy || step !== 0}
        hidden={step !== 0}
      >
        <legend className="sr-only">Visitor details</legend>
        <p className="cp-muted">
          Visit owner:{" "}
          <strong>{initial?.hostName ?? options.displayName}</strong>
        </p>
        <div className="cp-grid">
          <label>
            Visitor name
            <input
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Email (optional)
            <input
              type="email"
              maxLength={320}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Company (optional)
            <input
              maxLength={200}
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </label>
          <label>
            Office
            <select
              value={location}
              disabled={!!initial}
              required
              onChange={(e) => {
                setLocation(Number(e.target.value));
                setProjects([]);
                setAdditionalPeople([]);
                setGroups([]);
                setPreparation((previous) => {
                  const next = { ...previous };
                  delete next.coordinatorId;
                  delete next.visitOwnerId;
                  delete next.alternateReceiverId;
                  return next;
                });
              }}
            >
              <option value="">Select office</option>
              {options.locations
                .filter(
                  (l) =>
                    l.canHostLocation ||
                    options.projects.some(
                      (p) => p.locationId === l.locationId && p.canHost,
                    ),
                )
                .map((l) => (
                  <option key={l.locationId} value={l.locationId}>
                    {l.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
      </fieldset>
      <fieldset
        className="cp-step-panel"
        ref={(node) => {
          panels.current[1] = node;
        }}
        disabled={busy || step !== 1}
        hidden={step !== 1}
      >
        <legend className="sr-only">Visit details</legend>
        <fieldset>
          <legend>Destination sub-projects</legend>
          <p className="cp-muted cp-destination-help">
            Choose projects at this office. Each destination needs its own
            assigned approval.
          </p>
          {available.map((p) => (
            <div
              className={
                "cp-project-choice" +
                (projects.includes(p.subProjectId) ? " is-selected" : "")
              }
              key={p.subProjectId}
            >
              <label className="cp-check">
                <input
                  type="checkbox"
                  checked={projects.includes(p.subProjectId)}
                  disabled={
                    !projects.includes(p.subProjectId) && projects.length >= 10
                  }
                  onChange={(e) => {
                    setProjects(
                      e.target.checked
                        ? [...projects, p.subProjectId]
                        : projects.filter((id) => id !== p.subProjectId),
                    );
                    if (!e.target.checked)
                      setAdditionalPeople((previous) =>
                        previous.filter(
                          (person) => person.subProjectId !== p.subProjectId,
                        ),
                      );
                  }}
                />
                {projectLabel(options, p)}
              </label>
            </div>
          ))}
          {hostLocation?.canHostLocation && (
            <p className="cp-muted">
              Leave all projects unchecked for a location-only visit.
            </p>
          )}
          {!available.length && !hostLocation?.canHostLocation && (
            <p role="status">
              No approved hosting scope at this office. Ask your scoped
              administrator to configure it.
            </p>
          )}
        </fieldset>
        <div className="cp-grid">
          <label>
            Expected arrival
            <input
              type="datetime-local"
              required
              value={start}
              onChange={(e) => changeArrival(e.target.value)}
            />
          </label>
          <label>
            Expected departure
            <input
              type="datetime-local"
              min={start}
              required
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </label>
        </div>
        <label>
          Purpose
          <textarea
            required
            maxLength={1000}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          />
        </label>
        <label className="cp-check">
          <input
            type="checkbox"
            checked={vip}
            onChange={(e) => {
              setVip(e.target.checked);
              if (!e.target.checked)
                setGroups((previous) =>
                  previous.filter(
                    (ref) =>
                      !groupCatalogue.rows.find((group) => group.id === ref.id)
                        ?.vipOnly,
                  ),
                );
            }}
          />
          Leadership / VIP visit — inform configured recipients
        </label>
      </fieldset>
      <fieldset
        className="cp-step-panel"
        ref={(node) => {
          panels.current[2] = node;
        }}
        disabled={busy || step !== 2}
        hidden={step !== 2}
      >
        <legend className="sr-only">
          Approvals and notification recipients
        </legend>

        {routing.loading && (
          <p role="status">Loading approval and notification recipients...</p>
        )}
        {routing.error && (
          <p role="alert">
            Recipients could not be verified.{" "}
            <button type="button" className="secondary" onClick={routing.retry}>
              Retry recipients
            </button>
          </p>
        )}
        {!routing.loading && !routing.error && (
          <div className="cp-routing-office">
            <strong>Office-wide routing</strong>
            <RoutingNames
              row={routing.rows.find((row) => !row.subProjectId)}
              vip={vip}
              stay={stay}
            />
          </div>
        )}
        {peopleEditor(undefined, "Whole visit")}
        {available
          .filter((project) => projects.includes(project.subProjectId))
          .map((project) => (
            <div className="cp-project-choice" key={project.subProjectId}>
              <h4>{projectLabel(options, project)}</h4>
              {!routing.loading && !routing.error && (
                <RoutingNames
                  row={routing.rows.find(
                    (row) => row.subProjectId === project.subProjectId,
                  )}
                  vip={vip}
                  stay={stay}
                />
              )}
              {peopleEditor(
                project.subProjectId,
                projectLabel(options, project),
              )}
            </div>
          ))}
        <VisitGroupSelector
          catalogue={groupCatalogue}
          selected={groups}
          onChange={setGroups}
          vip={vip}
          projects={projects}
        />
      </fieldset>
      <fieldset
        className="cp-step-panel"
        ref={(node) => {
          panels.current[3] = node;
        }}
        disabled={busy || step !== 3}
        hidden={step !== 3}
      >
        <legend className="sr-only">Visit requirements</legend>
        <PreparationFields
          part="details"
          value={preparation}
          onChange={setPreparation}
          locationId={location}
          contacts={contacts}
          onContact={remember}
        />
      </fieldset>
      <fieldset
        className="cp-step-panel"
        ref={(node) => {
          panels.current[4] = node;
        }}
        disabled={busy || step !== 4}
        hidden={step !== 4}
      >
        <legend className="sr-only">Visit arrangements</legend>
        <label className="cp-check">
          <input
            type="checkbox"
            checked={stay}
            onChange={(e) => setStay(e.target.checked)}
          />
          Stay arrangement required
        </label>
        {stay && (
          <fieldset>
            <legend>Stay request</legend>
            <div className="cp-grid">
              <label>
                Check-in date
                <input
                  type="date"
                  required
                  value={checkIn}
                  onChange={(e) => changeCheckIn(e.target.value)}
                />
              </label>
              <label>
                Check-out date (exclusive)
                <input
                  type="date"
                  min={followingDay(checkIn)}
                  required
                  value={checkOut}
                  onChange={(e) => setCheckOut(e.target.value)}
                />
              </label>
            </div>
            <label>
              Facilities notes
              <textarea
                maxLength={1000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </fieldset>
        )}

        <PreparationFields
          part="arrangements"
          value={preparation}
          onChange={setPreparation}
          locationId={location}
          contacts={contacts}
          onContact={remember}
        />
      </fieldset>
      <fieldset
        className="cp-step-panel"
        ref={(node) => {
          panels.current[5] = node;
        }}
        disabled={busy || step !== 5}
        hidden={step !== 5}
      >
        <legend className="sr-only">Review invitation</legend>
        {step === 5 && (
          <InvitationReview
            ownerName={initial?.hostName ?? options.displayName}
            draft={draft}
            options={options}
            contacts={contacts}
            groups={groupCatalogue.rows}
            onEdit={go}
          />
        )}
        {initial && (
          <label>
            Reason for revision
            <input
              required
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        )}
        <p className="cp-muted">
          Saving a draft sends no invitation. Submit the saved plan when it is
          ready for review.
        </p>
      </fieldset>
      <div className="cp-actions cp-wizard-actions">
        <button
          className="quiet"
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
        <span className="cp-wizard-action-spacer" />
        {step > 0 && (
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={() => go(step - 1)}
          >
            Back
          </button>
        )}
        {step < 5 ? (
          <button
            className="primary"
            type="button"
            disabled={busy || (step === 2 && routingUnavailable)}
            key="next-step"
            onClick={(event) => {
              event.preventDefault();
              next();
            }}
          >
            Next
          </button>
        ) : (
          <button
            className="primary"
            key="save-draft"
            type="submit"
            disabled={busy || routingUnavailable || invalidGroups}
          >
            {busy ? "Saving..." : initial ? "Save revised draft" : "Save draft"}
          </button>
        )}
      </div>
    </form>
  );
}
