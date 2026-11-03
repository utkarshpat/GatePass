import {
  visitorCategories,
  visitTypes,
  preparationServices,
  preparationDevices,
  specialAccessRequests,
} from "../../shared/VisitPreparation.ts";
import type { Detail } from "./types.ts";
export function PreparationSummary({ detail }: { detail: Detail }) {
  const p = detail.preparation ?? {};
  if (!detail.preparation && !detail.additionalPeople?.length) return null;
  const roles: Record<string, string> = {
    coordinatorId: "Visit coordinator",
    visitOwnerId: "Additional contact (notify)",
    alternateReceiverId: "Alternate receiver",
  };
  return (
    <section
      className="cp-panel cp-preparation-summary"
      aria-label="Visit preparation"
    >
      <h3>Visit preparation</h3>
      <dl>
        {p.category && (
          <div>
            <dt>Visitor category</dt>
            <dd>{visitorCategories[p.category]}</dd>
          </div>
        )}
        {p.visitType && (
          <div>
            <dt>Visit type</dt>
            <dd>{visitTypes[p.visitType]}</dd>
          </div>
        )}
        {p.meetingLocation && (
          <div>
            <dt>Meeting location</dt>
            <dd>{p.meetingLocation}</dd>
          </div>
        )}
        {p.agenda && (
          <div>
            <dt>Agenda / itinerary</dt>
            <dd>{p.agenda}</dd>
          </div>
        )}
        {p.services && p.services.length > 0 && (
          <div>
            <dt>Requested support</dt>
            <dd>
              {p.services.map((key) => preparationServices[key]).join(", ")}
            </dd>
          </div>
        )}
        {p.devices && p.devices.length > 0 && (
          <div>
            <dt>Devices</dt>
            <dd>
              {p.devices.map((key) => preparationDevices[key]).join(", ")}
            </dd>
          </div>
        )}
        {p.specialAccess && p.specialAccess.length > 0 && (
          <div>
            <dt>Special access requested</dt>
            <dd>
              {p.specialAccess
                .map((key) => specialAccessRequests[key])
                .join(", ")}{" "}
              — subject to configured approval
            </dd>
          </div>
        )}
        {p.requirements && (
          <div>
            <dt>Support requirements</dt>
            <dd>{p.requirements}</dd>
          </div>
        )}
        {p.contacts?.map((person) => (
          <div key={person.role}>
            <dt>{roles[person.role] ?? "Visit contact"}</dt>
            <dd>{person.name}</dd>
          </div>
        ))}
      </dl>
      {!!detail.additionalPeople?.length && (
        <>
          <h4>Additional people</h4>
          <ul>
            {detail.additionalPeople.map((person) => (
              <li key={person.userId + (person.subProjectId ?? "")}>
                <strong>{person.name}</strong> ·{" "}
                {person.kind === "APPROVAL"
                  ? "Required approval"
                  : "Notify only"}{" "}
                ·{" "}
                {person.subProjectId
                  ? (detail.projects.find(
                      (project) => project.subProjectId === person.subProjectId,
                    )?.name ?? "Destination")
                  : "Whole visit"}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
