import { useId } from "react";
import type { Contact } from "./types.ts";
export function PeopleSelect({
  label,
  people,
  value,
  onChange,
  required = false,
}: {
  label: string;
  people: Contact[];
  value: string[];
  onChange: (value: string[]) => void;
  required?: boolean;
}) {
  const id = useId();
  return (
    <div className="cp-people-select">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        size={4}
        multiple
        required={required}
        value={value}
        onChange={(e) =>
          onChange([...e.currentTarget.selectedOptions].map((o) => o.value))
        }
      >
        {value
          .filter((id) => !people.some((p) => p.userId === id))
          .map((id) => (
            <option value={id} key={id}>
              Configured contact (outside current search)
            </option>
          ))}
        {people.map((p) => (
          <option value={p.userId} key={p.userId}>
            {p.name}
            {p.email ? " · " + p.email : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
