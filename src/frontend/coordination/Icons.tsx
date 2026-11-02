export type CoordinationIconName =
  | "plus"
  | "refresh"
  | "back"
  | "arrow"
  | "calendar"
  | "clock"
  | "pin"
  | "user"
  | "building"
  | "shield"
  | "chat"
  | "history"
  | "grid"
  | "logout"
  | "settings"
  | "mail"
  | "check"
  | "close"
  | "edit"
  | "chevron"
  | "search"
  | "people";
const paths: Record<CoordinationIconName, string> = {
  plus: "M12 5v14M5 12h14",
  refresh:
    "M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 18 17",
  back: "M19 12H5m6-6-6 6 6 6",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  calendar: "M8 3v4m8-4v4M4 10h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Z",
  clock: "M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  pin: "M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  user: "M20 21v-2a8 8 0 0 0-16 0v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  building: "M4 21V3h12v18M16 9h4v12M2 21h20M8 7h4M8 11h4M8 15h4M9 21v-3h2v3",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6",
  chat: "M21 11a8 8 0 0 1-8 8H7l-4 3V5a2 2 0 0 1 2-2h8a8 8 0 0 1 8 8ZM7 8h10M7 12h7",
  history: "M3 11a9 9 0 1 1 2.5 7M3 4v7h7M12 7v5l3 2",
  grid: "M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z",
  logout: "M9 4H4v16h5m5-12 4 4-4 4M8 12h11",
  settings:
    "m10 3-.6 2-2 .8-1.9-.5-2 3.4L5 10v2l-1.5 1.3 2 3.4 1.9-.5 2 .8.6 2h4l.6-2 2-.8 1.9.5 2-3.4L19 12v-2l1.5-1.3-2-3.4-1.9.5-2-.8L14 3h-4Zm5 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  mail: "M3 5h18v14H3V5Zm0 1 9 7 9-7",
  check: "m5 12 4 4L19 6",
  close: "m6 6 12 12M18 6 6 18",
  edit: "m15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z",
  chevron: "m9 5 7 7-7 7",
  search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  people:
    "M16 21v-2a6 6 0 0 0-12 0v2M14 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm4-3a4 4 0 0 1 0 8m3 9v-2a6 6 0 0 0-3-5",
};
export function Icon({
  name,
  size = 18,
  className = "",
}: {
  name: CoordinationIconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={"cp-icon " + className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
export const initials = (value: string) =>
  value
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join("")
    .toUpperCase() || "GP";
