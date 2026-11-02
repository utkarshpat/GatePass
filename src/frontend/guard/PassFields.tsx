import { Fragment, useContext } from "react";
import { GuardLanguage } from "./language.tsx";
import { PersonName } from "./readings.tsx";
import type { GuardModel } from "./model.ts";
import type { Visit } from "./types.ts";
import { shortPass, projectDescription } from "./Cards.tsx";
import { passValidityLabel } from "../../shared/ValidityDisplay.ts";
export function PassFields({
  visit: v,
  model,
}: {
  visit: Visit;
  model: GuardModel;
}) {
  const i18n = useContext(GuardLanguage),
    rows: [string, string][] = [
      ...(model.state.duty?.kind === "ALL" && model.state.passDuty
        ? [
            ["Allocation", model.allocationLabel(model.state.passDuty)] as [
              string,
              string,
            ],
          ]
        : []),
      ...(v.companyName
        ? [["Company", v.companyName] as [string, string]]
        : []),
      ...(v.deviceTypes?.length
        ? [
            [
              "Devices",
              v.deviceTypes
                .map((code) =>
                  i18n.t(
                    (
                      {
                        LAPTOP: "Laptop",
                        TABLET: "Tablet / iPad",
                        PEN_DRIVE: "Pen Drive",
                        CAMERA: "Camera",
                        OTHER: "Other",
                      } as Record<string, string>
                    )[code],
                  ),
                )
                .join(", "),
            ] as [string, string],
          ]
        : []),
      ["Office", v.locationName ?? ""],
      ...(v.hostName ? [["Host", v.hostName] as [string, string]] : []),
      [
        v.requestType === "DIGITAL_ID" ? "Assigned accounts" : "Account",
        projectDescription(v, model),
      ],
      [
        "Pass ID",
        shortPass(v.publicPassNumber) + " (" + v.publicPassNumber + ")",
      ],
      [
        "Valid from",
        new Intl.DateTimeFormat("en-IN", {
          timeZone: "Asia/Kolkata",
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(v.validFromUtc)) + " IST",
      ],
      ["Valid until", passValidityLabel(v.validUntilUtc)],
      ...(!v.verificationOnly
        ? [
            ["Presence", i18n.t(v.isInside ? "Inside" : "Outside")] as [
              string,
              string,
            ],
          ]
        : []),
    ];
  return (
    <>
      {rows.map(([label, value], index) => (
        <Fragment key={label + index}>
          <dt>{i18n.t(label)}</dt>
          <dd>{label === "Host" ? <PersonName name={value} /> : value}</dd>
        </Fragment>
      ))}
    </>
  );
}
