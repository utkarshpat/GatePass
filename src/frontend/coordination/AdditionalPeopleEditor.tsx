import { useState } from "react";
import type { AdditionalPlanningPerson } from "../../shared/VisitPreparation.ts";
import type { Contact } from "./types.ts";
import { PlanningPeoplePicker } from "./PlanningPeoplePicker.tsx";
export function AdditionalPeopleEditor({
  locationId,
  scope,
  label,
  actorId,
  people,
  contacts,
  onChange,
  onContact,
}: {
  locationId: number;
  scope?: string;
  label: string;
  actorId: string;
  people: AdditionalPlanningPerson[];
  contacts: Record<string, Contact>;
  onChange: (people: AdditionalPlanningPerson[]) => void;
  onContact: (person: Contact) => void;
}) {
  const [open, setOpen] = useState(false),
    [person, setPerson] = useState<Contact | null>(null),
    [kind, setKind] = useState<"APPROVAL" | "NOTIFY">("NOTIFY");
  const selected = people.filter((p) => p.subProjectId === scope),
    duplicate = !!person && selected.some((p) => p.userId === person.userId);
  return (
    <div className="cp-extra-people">
      <button
        type="button"
        className="secondary cp-add-person"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">＋</span> Add approval / notify · {label}
      </button>
      {open && (
        <div className="cp-person-editor">
          <PlanningPeoplePicker
            label={"Add person · " + label}
            locationId={locationId}
            value={person}
            onChange={setPerson}
            excludeId={actorId}
          />
          <label>
            Send as
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="NOTIFY">Notify only</option>
              <option value="APPROVAL">Additional required approval</option>
            </select>
          </label>
          <button
            type="button"
            className="secondary"
            disabled={!person || duplicate || people.length >= 20}
            onClick={() => {
              if (!person) return;
              onContact(person);
              onChange([
                ...people,
                {
                  userId: person.userId,
                  kind,
                  ...(scope ? { subProjectId: scope } : {}),
                },
              ]);
              setPerson(null);
              setOpen(false);
            }}
          >
            Add person
          </button>
          {duplicate && (
            <p role="status">This person is already added for this scope.</p>
          )}
        </div>
      )}
      {selected.length > 0 && (
        <ul className="cp-person-chips">
          {selected.map((p) => (
            <li key={p.userId}>
              <span>
                <strong>
                  {contacts[p.userId]?.name ?? "Selected employee"}
                </strong>
                <small>
                  {p.kind === "APPROVAL" ? "Required approval" : "Notify only"}
                </small>
              </span>
              <button
                type="button"
                className="quiet"
                aria-label={
                  "Remove " +
                  (contacts[p.userId]?.name ?? "person") +
                  " · " +
                  label
                }
                onClick={() => onChange(people.filter((item) => item !== p))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
