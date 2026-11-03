import {
  visitorCategories,
  visitTypes,
  preparationServices,
  preparationDevices,
  specialAccessRequests,
} from "../../shared/VisitPreparation.ts";
import type { VisitPreparation } from "../../shared/VisitPreparation.ts";
import type { Contact } from "./types.ts";
import { PlanningPeoplePicker } from "./PlanningPeoplePicker.tsx";
export const emptyPreparation: VisitPreparation = {
  category: "GENERAL",
  visitType: "MEETING",
  services: [],
  devices: [],
  specialAccess: [],
};
export function PreparationFields({
  value,
  part = "all",
  onChange,
  locationId,
  contacts,
  onContact,
}: {
  value: VisitPreparation;
  part?: "all" | "details" | "arrangements";
  onChange: (value: VisitPreparation) => void;
  locationId: number;
  contacts: Record<string, Contact>;
  onContact: (person: Contact) => void;
}) {
  function contact(
    key: "coordinatorId" | "visitOwnerId" | "alternateReceiverId",
    person: Contact | null,
  ) {
    if (person) onContact(person);
    const next = { ...value };
    if (person) next[key] = person.userId;
    else delete next[key];
    onChange(next);
  }
  const selected = (
    key: "coordinatorId" | "visitOwnerId" | "alternateReceiverId",
  ) =>
    value[key]
      ? (contacts[value[key]!] ?? {
          userId: value[key]!,
          name: "Selected employee",
        })
      : null;
  return (
    <fieldset className="cp-preparation">
      <legend>
        {part === "arrangements"
          ? "Support and coordination"
          : "Visit preparation"}
      </legend>
      {part !== "arrangements" && (
        <>
          <div className="cp-grid">
            <label>
              Visitor category
              <select
                value={value.category}
                onChange={(e) =>
                  onChange({
                    ...value,
                    category: e.target.value as VisitPreparation["category"],
                  })
                }
              >
                {Object.entries(visitorCategories).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Visit type
              <select
                value={value.visitType}
                onChange={(e) =>
                  onChange({
                    ...value,
                    visitType: e.target.value as VisitPreparation["visitType"],
                  })
                }
              >
                {Object.entries(visitTypes).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Meeting location (optional)
              <input
                maxLength={200}
                value={value.meetingLocation ?? ""}
                onChange={(e) =>
                  onChange({
                    ...value,
                    meetingLocation: e.target.value || undefined,
                  })
                }
              />
            </label>
          </div>
          <label>
            Agenda / itinerary (optional)
            <textarea
              maxLength={2000}
              value={value.agenda ?? ""}
              onChange={(e) =>
                onChange({ ...value, agenda: e.target.value || undefined })
              }
            />
          </label>
        </>
      )}
      <div className="cp-preparation-choices">
        {(
          [
            ["services", "Requested support", preparationServices],
            ["devices", "Devices being carried", preparationDevices],
            ["specialAccess", "Special access requests", specialAccessRequests],
          ] as const
        )
          .filter(
            ([key]) =>
              part === "all" ||
              (part === "arrangements"
                ? key === "services"
                : key !== "services"),
          )
          .map(([key, label, values]) => (
            <fieldset key={key}>
              <legend>{label}</legend>
              {Object.entries(values).map(([code, name]) => (
                <label className="cp-check" key={code}>
                  <input
                    type="checkbox"
                    checked={(value[key] as string[]).includes(code)}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        [key]: e.target.checked
                          ? [...value[key], code]
                          : value[key].filter((item) => item !== code),
                      })
                    }
                  />
                  {name}
                </label>
              ))}
            </fieldset>
          ))}
      </div>
      <p className="cp-muted">
        Requested support creates preparation tasks for the named coordinator.
        Special access remains subject to the configured approvals; selecting an
        option does not authorize it.
      </p>
      {part !== "details" && (
        <>
          <div className="cp-grid">
            <PlanningPeoplePicker
              key={"coordinator-" + locationId}
              label="Visit coordinator"
              locationId={locationId}
              value={selected("coordinatorId")}
              required={value.services.length > 0}
              onChange={(person) => contact("coordinatorId", person)}
            />
            <PlanningPeoplePicker
              key={"owner-" + locationId}
              label="Additional contact (notify)"
              locationId={locationId}
              value={selected("visitOwnerId")}
              onChange={(person) => contact("visitOwnerId", person)}
            />
            <PlanningPeoplePicker
              key={"alternate-" + locationId}
              label="Alternate receiver (notify)"
              locationId={locationId}
              value={selected("alternateReceiverId")}
              onChange={(person) => contact("alternateReceiverId", person)}
            />
          </div>
          <label>
            Support / accessibility requirements (optional)
            <textarea
              maxLength={1000}
              value={value.requirements ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  requirements: e.target.value || undefined,
                })
              }
            />
          </label>
          <p className="cp-muted">
            The visit owner creates and coordinates the invitation. Additional
            contact/alternate notification does not grant decision or access
            rights.
          </p>
        </>
      )}
    </fieldset>
  );
}
