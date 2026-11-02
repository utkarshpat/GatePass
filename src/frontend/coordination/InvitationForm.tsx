import { projectLabel } from "./types.ts";
import { useState, type FormEvent } from "react";
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
  initial,
  busy,
  onSave,
  onCancel,
}: {
  options: Options;
  initial?: Detail;
  busy: boolean;
  onSave: (draft: unknown, reason?: string) => Promise<void>;
  onCancel: () => void;
}) {
  const source = initial?.draft;
  const [location, setLocation] = useState(
    source?.locationId ??
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
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !event.currentTarget.reportValidity()) return;
    try {
      await onSave(
        {
          locationId: location,
          subProjectIds: projects,
          visitorName: name.trim(),
          ...(email.trim() ? { visitorEmail: email.trim() } : {}),
          ...(company.trim() ? { company: company.trim() } : {}),
          purpose: purpose.trim(),
          startsAtUtc: utcFromOffice(start),
          untilUtc: utcFromOffice(until),
          vip,
          ...(stay
            ? {
                stay: {
                  checkInDate: checkIn,
                  checkOutDate: checkOut,
                  ...(notes.trim() ? { notes: notes.trim() } : {}),
                },
              }
            : {}),
        },
        initial ? reason.trim() : undefined,
      );
    } catch {}
  }
  return (
    <form className="cp-form" onSubmit={submit}>
      <p className="cp-muted">
        One visitor per invitation. Dates and times use office time
        (Asia/Kolkata). Saving a draft does not send an invitation.
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
      <fieldset>
        <legend>Destination sub-projects</legend>
        <p className="cp-muted cp-destination-help">Choose projects at this office. Each destination needs its own assigned approval.</p>
        {available.map((p) => (
          <label className="cp-check" key={p.subProjectId}>
            <input
              type="checkbox"
              checked={projects.includes(p.subProjectId)}
              onChange={(e) =>
                setProjects(
                  e.target.checked
                    ? [...projects, p.subProjectId]
                    : projects.filter((id) => id !== p.subProjectId),
                )
              }
            />
            {projectLabel(options, p)}
          </label>
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
          onChange={(e) => setVip(e.target.checked)}
        />
        Leadership / VIP visit — inform configured recipients
      </label>
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
      <div className="cp-actions">
        <button
          className="secondary"
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className="primary"
          disabled={
            busy ||
            !location ||
            (!projects.length && !hostLocation?.canHostLocation)
          }
        >
          {busy ? "Saving…" : initial ? "Save revised draft" : "Save draft"}
        </button>
      </div>
    </form>
  );
}
