import { useState, type FormEvent } from "react";
import type { Contact, Definition, Rule } from "./types.ts";
import { PeopleSelect } from "./PeopleSelect.tsx";
const blankRule = (location: boolean): Rule => ({
  id: crypto.randomUUID(),
  name: location ? "Office security" : "Account / project host",
  kind: location ? "SECURITY" : "PROJECT",
  mode: "ALL",
  approverIds: [],
});
export function PolicyEditor({
  location,
  initial,
  busy,
  people,
  onSave,
}: {
  location: boolean;
  initial?: Definition;
  busy: boolean;
  people: Contact[];
  onSave: (definition: Definition, reason: string) => Promise<void>;
}) {
  const [definition, setDefinition] = useState<Definition>(() =>
      structuredClone(
        initial ?? {
          approvalRules: [blankRule(location)],
          ...(location
            ? {
                arrangements: [],
                receptionIds: [],
                securityIds: [],
                notifyIds: [],
                vipNotifyIds: [],
                maximumAdvanceDays: 90,
                maximumVisitDays: 30,
              }
            : {}),
        },
      ),
    ),
    [reason, setReason] = useState(""),
    [panel, setPanel] = useState("approvals");
  const set = (patch: Partial<Definition>) =>
    setDefinition((d) => ({ ...d, ...patch }));
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const invalid = e.currentTarget.querySelector<HTMLElement>(":invalid");
    if (invalid) {
      const containers = [
        ...e.currentTarget.querySelectorAll<HTMLElement>("[hidden]"),
      ];
      const container = containers.find((el) => el.contains(invalid));
      if (container) {
        setPanel(container.dataset.policyPanel ?? "approvals");
        requestAnimationFrame(() => invalid.focus());
      } else invalid.focus();
      return;
    }
    if (!busy && e.currentTarget.reportValidity())
      await onSave(definition, reason.trim()).catch(() => {});
  }
  return (
    <form className="cp-form" onSubmit={submit} noValidate>
      <p className="cp-muted">
        Choose who approves a visit, who handles support, and who receives
        updates. Office rules apply to every visit; project rules add to them.
      </p>
      {location && (
        <nav className="cp-tabs" aria-label="Policy sections">
          {[
            ["approvals", "1. Approvals"],
            ["support", "2. Support & people"],
            ["limits", "3. Visit limits"],
          ].map(([key, label]) => (
            <button
              type="button"
              key={key}
              aria-pressed={panel === key}
              className={panel === key ? "selected" : ""}
              onClick={() => setPanel(key)}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
      <div data-policy-panel="approvals" hidden={panel !== "approvals"}>
        {definition.approvalRules.map((r, index) => (
          <fieldset key={r.id}>
            <legend>Approval step {index + 1}</legend>
            <div className="cp-grid">
              <label>
                Step name
                <input
                  required
                  maxLength={120}
                  value={r.name}
                  onChange={(e) =>
                    set({
                      approvalRules: definition.approvalRules.map((x) =>
                        x.id === r.id ? { ...x, name: e.target.value } : x,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Responsibility
                <select
                  value={r.kind}
                  onChange={(e) =>
                    set({
                      approvalRules: definition.approvalRules.map((x) =>
                        x.id === r.id
                          ? { ...x, kind: e.target.value as Rule["kind"] }
                          : x,
                      ),
                    })
                  }
                >
                  <option value="PROJECT">Account / project host</option>
                  <option value="SECURITY">Security</option>
                  <option value="CLIENT_CONFIRMATION">
                    Internal client coordinator
                  </option>
                </select>
              </label>
              <label>
                How many approvals?
                <select
                  value={r.mode}
                  onChange={(e) =>
                    set({
                      approvalRules: definition.approvalRules.map((x) =>
                        x.id === r.id
                          ? { ...x, mode: e.target.value as Rule["mode"] }
                          : x,
                      ),
                    })
                  }
                >
                  <option value="ALL">All must approve</option>
                  <option value="ANY">Any one decides</option>
                </select>
              </label>
              <PeopleSelect
                label="Who must approve?"
                people={people}
                value={r.approverIds}
                required
                onChange={(approverIds) =>
                  set({
                    approvalRules: definition.approvalRules.map((x) =>
                      x.id === r.id ? { ...x, approverIds } : x,
                    ),
                  })
                }
              />
            </div>
            {definition.approvalRules.length > 1 && (
              <button
                type="button"
                className="quiet"
                onClick={() =>
                  set({
                    approvalRules: definition.approvalRules.filter(
                      (x) => x.id !== r.id,
                    ),
                  })
                }
              >
                Remove step
              </button>
            )}
          </fieldset>
        ))}
        <button
          type="button"
          className="secondary"
          disabled={busy || definition.approvalRules.length >= 50}
          onClick={() =>
            set({
              approvalRules: [...definition.approvalRules, blankRule(location)],
            })
          }
        >
          Add approval step
        </button>
      </div>
      {location && (
        <>
          <div
            className="cp-grid"
            data-policy-panel="limits"
            hidden={panel !== "limits"}
          >
            <label>
              How far ahead can a visit be planned? (days)
              <input
                type="number"
                min={1}
                max={366}
                required
                value={definition.maximumAdvanceDays}
                onChange={(e) =>
                  set({ maximumAdvanceDays: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Longest visit allowed (days)
              <input
                type="number"
                min={1}
                max={366}
                required
                value={definition.maximumVisitDays}
                onChange={(e) =>
                  set({ maximumVisitDays: Number(e.target.value) })
                }
              />
            </label>
          </div>
          <div data-policy-panel="support" hidden={panel !== "support"}>
            {(definition.arrangements ?? []).map((t) => (
              <fieldset key={t.id}>
                <legend>Support responsibility</legend>
                <div className="cp-grid">
                  <label>
                    Name
                    <input
                      required
                      maxLength={120}
                      value={t.name}
                      onChange={(e) =>
                        set({
                          arrangements: definition.arrangements!.map((x) =>
                            x.id === t.id ? { ...x, name: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Type
                    <select
                      value={t.kind}
                      onChange={(e) =>
                        set({
                          arrangements: definition.arrangements!.map((x) =>
                            x.id === t.id
                              ? {
                                  ...x,
                                  kind: e.target.value as "STAY" | "OTHER",
                                }
                              : x,
                          ),
                        })
                      }
                    >
                      <option value="STAY">Stay — when requested</option>
                      <option value="OTHER">Other — every visit</option>
                    </select>
                  </label>
                  <PeopleSelect
                    label="Who handles this?"
                    people={people}
                    value={t.ownerIds}
                    required
                    onChange={(ownerIds) =>
                      set({
                        arrangements: definition.arrangements!.map((x) =>
                          x.id === t.id ? { ...x, ownerIds } : x,
                        ),
                      })
                    }
                  />
                  <label className="cp-check">
                    <input
                      type="checkbox"
                      checked={t.mandatoryForEntry}
                      onChange={(e) =>
                        set({
                          arrangements: definition.arrangements!.map((x) =>
                            x.id === t.id
                              ? { ...x, mandatoryForEntry: e.target.checked }
                              : x,
                          ),
                        })
                      }
                    />
                    Required for planning readiness
                  </label>
                </div>
                <button
                  className="quiet"
                  type="button"
                  onClick={() =>
                    set({
                      arrangements: definition.arrangements!.filter(
                        (x) => x.id !== t.id,
                      ),
                    })
                  }
                >
                  Remove arrangement
                </button>
              </fieldset>
            ))}
            <button
              className="secondary"
              type="button"
              disabled={busy || (definition.arrangements?.length ?? 0) >= 20}
              onClick={() =>
                set({
                  arrangements: [
                    ...(definition.arrangements ?? []),
                    {
                      id: crypto.randomUUID(),
                      name: "Stay arrangement",
                      kind: "STAY",
                      mandatoryForEntry: false,
                      ownerIds: [],
                    },
                  ],
                })
              }
            >
              Add support task
            </button>
            <fieldset>
              <legend>Participants and people to inform</legend>
              <p className="cp-muted">
                FYI recipients receive a notice; they do not gain workspace or
                discussion access.
              </p>
              <div className="cp-grid">
                {(
                  [
                    "receptionIds",
                    "securityIds",
                    "notifyIds",
                    "vipNotifyIds",
                  ] as const
                ).map((key, index) => (
                  <PeopleSelect
                    key={key}
                    label={
                      [
                        "Reception participants",
                        "Security participants",
                        "Inform for every visit",
                        "Also inform for VIP visits",
                      ][index]
                    }
                    people={people}
                    value={definition[key] ?? []}
                    onChange={(ids) => set({ [key]: ids })}
                  />
                ))}
              </div>
            </fieldset>
          </div>
        </>
      )}
      <label>
        Reason for policy change
        <input
          required
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <button className="primary" disabled={busy}>
        Save policy
      </button>
    </form>
  );
}
