import { titles } from "../admin/types.ts";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Dialog } from "./controls.tsx";
import {
  parseStaffAccess,
  staffDestinations,
  type StaffAccess,
  type StaffSection,
} from "../staffAccess.ts";
import type { PageConfig } from "../types.ts";

export const visitFolders = [
  ["MY", "My visits"],
  ["ASSIGNED", "Assigned to me"],
  ["PARTICIPATING", "Participating"],
] as const;
export type VisitFolder = (typeof visitFolders)[number][0];
export const readVisitFolder = (): VisitFolder => {
  const value = new URLSearchParams(location.search).get("folder");
  return visitFolders.some(([key]) => key === value)
    ? (value as VisitFolder)
    : "MY";
};
type Navigation = {
  folder: VisitFolder;
  folderSequence: number;
  setFolder: (folder: VisitFolder) => void;
  access: StaffAccess | null;
  current: StaffSection;
  open: boolean;
  setOpen: (value: boolean) => void;
  openAdminCoordination: ((folder?: VisitFolder) => void) | null;
  setAdminCoordination: (
    callback: ((folder?: VisitFolder) => void) | null,
  ) => void;
};
const Context = createContext<Navigation | null>(null);
const sectionCodes = {
  admin: "ADMIN",
  reception: "RECEPTION",
  guard: "GUARD",
  coordination: "COORDINATION",
} as const;
const labels: Record<StaffSection, string> = {
  ADMIN: "Administration",
  RECEPTION: "Reception",
  GUARD: "Guard",
  COORDINATION: "Visit coordination",
};
const icons: Record<StaffSection, string> = {
  ADMIN: "M12 3 3 7v6c0 5 9 8 9 8s9-3 9-8V7l-9-4ZM8 12l3 3 5-6",
  RECEPTION: "M4 20V8h16v12M8 8V4h8v4M8 12h2m4 0h2M8 16h2m4 0h2",
  GUARD: "M5 4h5v5H5zm9 0h5v5h-5zM5 14h5v5H5zm9 0h5v5h-5z",
  COORDINATION: "M5 4h14v16H5zM8 2v4m8-4v4M5 9h14m-10 4h2m2 0h2m-6 4h2",
};
function csrf() {
  return document.cookie
    .split("; ")
    .find((value) => value.startsWith("gp-staff-csrf="))
    ?.slice(14);
}
export function StaffNavigationProvider({
  config,
  children,
}: {
  config: PageConfig;
  children: ReactNode;
}) {
  const current = sectionCodes[config.page as keyof typeof sectionCodes];
  const [access, setAccess] = useState<StaffAccess | null>(null),
    [open, setOpen] = useState(false);
  const [openAdminCoordination, registerAdminCoordination] = useState<
    ((folder?: VisitFolder) => void) | null
  >(null);
  const setAdminCoordination = useCallback(
    (callback: ((folder?: VisitFolder) => void) | null) =>
      registerAdminCoordination(() => callback),
    [],
  );
  const [folder, updateFolder] = useState<VisitFolder>(readVisitFolder);
  const [folderSequence, setFolderSequence] = useState(0);
  const setFolder = useCallback((value: VisitFolder) => {
    updateFolder(value);
    setFolderSequence((sequence) => sequence + 1);
  }, []);
  const epoch = useRef(0);
  useEffect(() => {
    let alive = true,
      controller: AbortController | undefined,
      timer: number | undefined;
    const clear = () => {
      epoch.current++;
      controller?.abort();
      window.clearTimeout(timer);
      setAccess(null);
      setOpen(false);
    };
    const load = async () => {
      const token = csrf();
      if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) {
        clear();
        return;
      }
      const version = ++epoch.current;
      controller?.abort();
      window.clearTimeout(timer);
      controller = new AbortController();
      timer = window.setTimeout(() => controller?.abort(), 15000);
      try {
        const response = await fetch("/api/staff/me", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": token,
          },
          body: "{}",
          signal: controller.signal,
        });
        if (!response.ok) throw Error("STAFF_ACCESS_UNAVAILABLE");
        const next = parseStaffAccess(await response.json());
        if (alive && version === epoch.current && csrf() === token)
          setAccess(
            next.workspaces.some((item) => item.code === current) ? next : null,
          );
      } catch {
        if (alive && version === epoch.current) {
          setAccess(null);
          setOpen(false);
        }
      } finally {
        if (version === epoch.current) window.clearTimeout(timer);
      }
    };
    void load();
    const focus = () => {
      clear();
      void load();
    };
    const show = (event: PageTransitionEvent) => {
      if (event.persisted) focus();
    };
    window.addEventListener("focus", focus);
    window.addEventListener("pagehide", clear);
    window.addEventListener("pageshow", show);
    return () => {
      alive = false;
      clear();
      window.removeEventListener("focus", focus);
      window.removeEventListener("pagehide", clear);
      window.removeEventListener("pageshow", show);
    };
  }, [current]);
  const multiple =
    !!access && (access.workspaces.length > 1 || current === "COORDINATION" || current === "ADMIN");
  useEffect(() => {
    document.body.classList.toggle("staff-navigation-active", multiple);
    return () => document.body.classList.remove("staff-navigation-active");
  }, [multiple]);
  return (
    <Context.Provider
      value={{
        access,
        folder,
        folderSequence,
        setFolder,
        current,
        open,
        setOpen,
        openAdminCoordination,
        setAdminCoordination,
      }}
    >
      {children}
      {current !== "ADMIN" && <StaffNavigation />}
      {multiple &&
        createPortal(
          <Dialog
            id="staff-navigation-drawer"
            className="staff-navigation-drawer"
            aria-labelledby="staff-navigation-title"
            open={open}
            onDismiss={() => setOpen(false)}
            onClick={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <div className="staff-navigation-heading">
              <h2 id="staff-navigation-title">Navigation</h2>
              <button
                type="button"
                className="staff-navigation-close"
                aria-label="Close navigation"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
            <NavigationLinks
              navigation={{
                access,
                folder,
                folderSequence,
                setFolder,
                current,
                open,
                setOpen,
                openAdminCoordination,
                setAdminCoordination,
              }}
            />
          </Dialog>,
          document.body,
        )}
    </Context.Provider>
  );
}
function NavigationLinks({
  navigation,
  extraOnly = false,
  onCoordination,
  activeSection,
}: {
  navigation: Navigation;
  extraOnly?: boolean;
  onCoordination?: (folder?: VisitFolder) => void;
  activeSection?: StaffSection;
}) {
  return (
    <nav aria-label="Staff sections" className="staff-section-links">
      {!extraOnly &&
        navigation.access?.adminSections?.map((view) => (
          <a key={view} href={"/admin?view=" + view}>
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d={icons.ADMIN} />
            </svg>
            <span>{titles[view]}</span>
          </a>
        ))}
      {navigation.access?.workspaces
        .filter((item) => item.code !== "ADMIN")
        .map((item) => (
          <div key={item.code}>
            {(item.code !== "COORDINATION" ||
              navigation.access?.workspaces.some(
                (workspace) => workspace.code === "ADMIN",
              )) && (
              <a
                href={
                  item.code === "COORDINATION" &&
                  navigation.access?.workspaces.some(
                    (workspace) => workspace.code === "ADMIN",
                  )
                    ? "/admin?view=coordination"
                    : staffDestinations[item.code]
                }
                aria-current={
                  (activeSection ??
                    (navigation.current === "ADMIN" &&
                    new URLSearchParams(location.search).get("view") ===
                      "coordination"
                      ? "COORDINATION"
                      : navigation.current)) === item.code
                    ? "page"
                    : undefined
                }
                onClick={(event) => {
                  const openCoordination =
                    onCoordination ?? navigation.openAdminCoordination;
                  if (
                    item.code === "COORDINATION" &&
                    openCoordination &&
                    !event.ctrlKey &&
                    !event.metaKey &&
                    !event.shiftKey &&
                    !event.altKey
                  ) {
                    event.preventDefault();
                    navigation.setFolder("MY");
                    openCoordination("MY");
                  }
                  navigation.setOpen(false);
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d={icons[item.code]} />
                </svg>
                <span>{labels[item.code]}</span>
              </a>
            )}
            {item.code === "COORDINATION" && (
              <div
                className={
                  navigation.access?.workspaces.some(
                    (workspace) => workspace.code === "ADMIN",
                  )
                    ? "staff-visit-folders nested"
                    : "staff-visit-folders"
                }
              >
                {visitFolders.map(([key, label]) => (
                  <a
                    key={key}
                    href={
                      (navigation.access?.workspaces.some(
                        (workspace) => workspace.code === "ADMIN",
                      )
                        ? "/admin?view=coordination&"
                        : "/coordination?") +
                      "folder=" +
                      key
                    }
                    aria-current={
                      (activeSection === "COORDINATION" ||
                        (!activeSection &&
                          (navigation.current === "COORDINATION" ||
                            new URLSearchParams(location.search).get("view") ===
                              "coordination"))) &&
                      navigation.folder === key
                        ? "page"
                        : undefined
                    }
                    onClick={(event) => {
                      if (
                        event.ctrlKey ||
                        event.metaKey ||
                        event.shiftKey ||
                        event.altKey
                      )
                        return;
                      const open =
                        onCoordination ?? navigation.openAdminCoordination;
                      if (open || navigation.current === "COORDINATION") {
                        event.preventDefault();
                        navigation.setFolder(key);
                        if (open) open(key);
                        else {
                          const url = new URL(location.href);
                          url.searchParams.set("folder", key);
                          url.searchParams.delete("settings");
                          url.hash = "";
                          history.replaceState(
                            null,
                            "",
                            url.pathname + url.search,
                          );
                        }
                      }
                      navigation.setOpen(false);
                    }}
                  >
                    <span>{label}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
    </nav>
  );
}
export function useAdminCoordinationNavigation(
  handler: (folder?: VisitFolder) => void,
) {
  const navigation = useContext(Context),
    register = navigation?.setAdminCoordination;
  useEffect(() => {
    register?.(handler);
    return () => register?.(null);
  }, [register, handler]);
}
export function useCoordinationFolder() {
  const navigation = useContext(Context);
  const [fallback, setFallback] = useState<VisitFolder>(readVisitFolder);
  return [
    navigation?.folder ?? fallback,
    navigation?.setFolder ?? setFallback,
    navigation?.folderSequence ?? 0,
  ] as const;
}
export function useStaffAccess() {
  return useContext(Context)?.access ?? null;
}
export function StaffNavigation({
  embedded = false,
  onCoordination,
  activeSection,
}: {
  embedded?: boolean;
  onCoordination?: (folder?: VisitFolder) => void;
  activeSection?: StaffSection;
}) {
  const navigation = useContext(Context);
  if (
    !navigation?.access ||
    (navigation.access.workspaces.length < 2 &&
      navigation.current !== "COORDINATION" && navigation.current !== "ADMIN")
  )
    return null;
  if (embedded)
    return (
      <div className="staff-extra-navigation">
        <NavigationLinks
          navigation={navigation}
          extraOnly
          onCoordination={onCoordination}
          activeSection={activeSection}
        />
      </div>
    );
  return (
    <aside
      className="staff-section-navigation"
      aria-label="Application navigation"
    >
      <div className="staff-navigation-heading">
        <span>GatePass</span>
        <small>Navigation</small>
      </div>
      <NavigationLinks navigation={navigation} />
    </aside>
  );
}
export function StaffNavigationToggle() {
  const navigation = useContext(Context);
  if (
    !navigation?.access ||
    (navigation.access.workspaces.length < 2 &&
      navigation.current !== "COORDINATION" && navigation.current !== "ADMIN")
  )
    return null;
  return (
    <button
      type="button"
      className="staff-navigation-toggle"
      aria-label="Open navigation"
      aria-haspopup="dialog"
      aria-expanded={navigation.open}
      aria-controls="staff-navigation-drawer"
      onClick={() => navigation.setOpen(true)}
    >
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  );
}
