import { useEffect, useId, useRef, useState } from "react";
import type { Contact } from "./types.ts";
import { coordinationRequest } from "./client.ts";

/** Directory lookup is scoped by the server; typed text is never treated as an employee selection. */
export function PlanningPeoplePicker({
  label,
  locationId,
  value,
  onChange,
  required = false,
  excludeId,
}: {
  label: string;
  locationId: number;
  value: Contact | null;
  onChange: (person: Contact | null) => void;
  required?: boolean;
  excludeId?: string;
}) {
  const id = useId(),
    input = useRef<HTMLInputElement>(null),
    [query, setQuery] = useState(""),
    [rows, setRows] = useState<Contact[]>([]),
    [status, setStatus] = useState(""),
    epoch = useRef(0);
  useEffect(() => {
    input.current?.setCustomValidity(
      !value && query ? "Choose an employee from the search results." : "",
    );
  }, [value, query]);
  useEffect(() => {
    const version = ++epoch.current,
      controller = new AbortController();
    let timeout: number | undefined;
    setRows([]);
    setStatus("");
    const timer = window.setTimeout(() => {
      if (value || query.trim().length < 2 || !locationId) return;
      setStatus("Searching…");
      timeout = window.setTimeout(() => controller.abort(), 15000);
      void coordinationRequest(
        "people",
        { locationId, search: query.trim() },
        controller.signal,
      )
        .then((data) => {
          if (version !== epoch.current || controller.signal.aborted) return;
          if (!Array.isArray(data.people) || data.people.length > 20)
            throw Error("Invalid directory");
          const contacts = data.people.filter(
            (p: Contact) =>
              typeof p.userId === "string" &&
              /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(
                p.userId,
              ) &&
              typeof p.name === "string" &&
              p.name.length <= 200 &&
              p.userId !== excludeId,
          );
          setRows(contacts);
          setStatus(
            contacts.length
              ? "Choose an employee below."
              : "No matching internal employee.",
          );
        })
        .catch(() => {
          if (version === epoch.current)
            setStatus("Search unavailable. Change the search or retry.");
        })
        .finally(() => window.clearTimeout(timeout));
    }, 300);
    return () => {
      epoch.current++;
      window.clearTimeout(timer);
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query, locationId, value, excludeId]);
  return (
    <div className="cp-person-picker">
      <label htmlFor={id}>{label}</label>
      <div className="cp-person-input">
        <input
          id={id}
          ref={input}
          type="search"
          required={required}
          maxLength={80}
          autoComplete="off"
          placeholder="Search employee name or email"
          value={value?.name ?? query}
          onChange={(event) => {
            onChange(null);
            setQuery(event.target.value);
          }}
        />
        {value && (
          <button
            type="button"
            className="secondary"
            aria-label={"Clear " + label}
            onClick={() => {
              onChange(null);
              setQuery("");
            }}
          >
            ×
          </button>
        )}
      </div>
      {status && (
        <p className="cp-muted" role="status">
          {status}
        </p>
      )}
      {rows.length > 0 && (
        <ul className="cp-person-results">
          {rows.map((person) => (
            <li key={person.userId}>
              <button
                type="button"
                onClick={() => {
                  onChange(person);
                  setQuery("");
                  setRows([]);
                  setStatus("");
                }}
              >
                <strong>{person.name}</strong>
                {person.email && <small>{person.email}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
