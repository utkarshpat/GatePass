import type {
  AdditionalPlanningPerson,
  VisitPreparation,
} from "../../shared/VisitPreparation.ts";
import {
  visitorCategories,
  visitTypes,
  preparationServices,
  preparationDevices,
  specialAccessRequests,
} from "../../shared/VisitPreparation.ts";
import type {
  VisitGroupReference,
  VisitRoutingGroup,
} from "../../shared/VisitGroups.ts";
import type { Options, Contact } from "./types.ts";
import { displayTime, projectLabel } from "./types.ts";
import { GroupMembers } from "./VisitGroupCatalogue.tsx";
type ReviewDraft = {
  locationId: number;
  subProjectIds: string[];
  visitorName: string;
  visitorEmail?: string;
  company?: string;
  purpose: string;
  startsAtUtc: string;
  untilUtc: string;
  vip: boolean;
  preparation: VisitPreparation;
  additionalPeople: AdditionalPlanningPerson[];
  groups: VisitGroupReference[];
  stay?: { checkInDate: string; checkOutDate: string; notes?: string };
};
export function InvitationReview({
  draft,
  options,
  contacts,
  groups,
  onEdit,
  ownerName,
}: {
  ownerName: string;
  draft: ReviewDraft;
  options: Options;
  contacts: Record<string, Contact>;
  groups: VisitRoutingGroup[];
  onEdit: (step: number) => void;
}) {
  const time = (value: string) =>
    Number.isFinite(Date.parse(value)) ? displayTime(value) : "Not set";
  const prep = draft.preparation,
    sections = [
      {
        title: "Visitor",
        step: 0,
        rows: [
          ["Name", draft.visitorName],
          ["Visit owner", ownerName],
          ["Email", draft.visitorEmail],
          ["Company", draft.company],
          [
            "Office",
            options.locations.find(
              (office) => office.locationId === draft.locationId,
            )?.name,
          ],
        ],
      },
      {
        title: "Visit",
        step: 1,
        rows: [
          [
            "Destinations",
            draft.subProjectIds
              .map((id) => {
                const project = options.projects.find(
                  (project) => project.subProjectId === id,
                );
                return project
                  ? projectLabel(options, project)
                  : "Selected destination";
              })
              .join(", ") || "Location-only visit",
          ],
          ["Arrival", time(draft.startsAtUtc)],
          ["Departure", time(draft.untilUtc)],
          ["Purpose", draft.purpose],
          ["VIP", draft.vip ? "Yes" : "No"],
        ],
      },
      {
        title: "Details",
        step: 3,
        rows: [
          ["Category", visitorCategories[prep.category]],
          ["Visit type", visitTypes[prep.visitType]],
          ["Meeting location", prep.meetingLocation],
          ["Agenda", prep.agenda],
          [
            "Devices",
            prep.devices.map((key) => preparationDevices[key]).join(", "),
          ],
          [
            "Special access requested",
            prep.specialAccess
              .map((key) => specialAccessRequests[key])
              .join(", "),
          ],
        ],
      },
      {
        title: "Support",
        step: 4,
        rows: [
          [
            "Requested services",
            prep.services.map((key) => preparationServices[key]).join(", "),
          ],
          [
            "Coordinator",
            prep.coordinatorId ? contacts[prep.coordinatorId]?.name : undefined,
          ],
          [
            "Additional contact (notify)",
            prep.visitOwnerId ? contacts[prep.visitOwnerId]?.name : undefined,
          ],
          [
            "Alternate receiver",
            prep.alternateReceiverId
              ? contacts[prep.alternateReceiverId]?.name
              : undefined,
          ],
          ["Requirements", prep.requirements],
          [
            "Stay",
            draft.stay
              ? draft.stay.checkInDate + " to " + draft.stay.checkOutDate
              : undefined,
          ],
          ["Facilities notes", draft.stay?.notes],
        ],
      },
    ];
  return (
    <div className="cp-invitation-review">
      {sections.map((section) => (
        <section key={section.title}>
          <div className="cp-row">
            <h4>{section.title}</h4>
            <button
              type="button"
              className="quiet"
              onClick={() => onEdit(section.step)}
            >
              Edit {section.title.toLowerCase()}
            </button>
          </div>
          <dl>
            {section.rows
              .filter(([, value]) => !!value)
              .map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>
        </section>
      ))}
      <section>
        <div className="cp-row">
          <h4>Approvals & notifications</h4>
          <button type="button" className="quiet" onClick={() => onEdit(2)}>
            Edit approvals
          </button>
        </div>
        <p className="cp-muted">
          Mandatory office and destination reviews still apply. Saving this
          draft sends no email.
        </p>
        {draft.additionalPeople.map((person) => (
          <p key={person.userId + (person.subProjectId ?? "")}>
            {contacts[person.userId]?.name ?? "Selected employee"} ·{" "}
            {person.kind === "APPROVAL" ? "Required approval" : "Notify only"} ·{" "}
            {person.subProjectId
              ? options.projects.find(
                  (project) => project.subProjectId === person.subProjectId,
                )?.name
              : "Whole visit"}
          </p>
        ))}
        {draft.groups.map((ref) => {
          const group = groups.find((group) => group.id === ref.id);
          return group ? (
            <div className="cp-group-card" key={ref.id}>
              <strong>{group.name}</strong>
              <GroupMembers group={group} />
            </div>
          ) : null;
        })}
      </section>
    </div>
  );
}
