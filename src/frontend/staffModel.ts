import { useEffect, useRef, useState, type FormEvent } from "react";
type Workspace = { code: "GUARD" | "ADMIN" | "RECEPTION" | "COORDINATION"; name: string };
type Context = { displayName: string; workspaces: Workspace[] };
const destinations = {
  GUARD: "/guard",
  ADMIN: "/admin",
  RECEPTION: "/reception",
  COORDINATION: "/coordination",
};
const csrf = () =>
  document.cookie
    .split("; ")
    .find((v) => v.startsWith("gp-staff-csrf="))
    ?.split("=")[1];
class Failure extends Error {
  status: number;
  timedOut: boolean;
  constructor(status: number, timedOut = false) {
    super("Staff request failed");
    this.status = status;
    this.timedOut = timedOut;
  }
}
export function useStaffModel() {
  const token = useRef(
    location.hash.startsWith("#staff-setup=") ? location.hash.slice(13) : null,
  );
  const [screen, setScreen] = useState<
    "login" | "setup" | "loading" | "access"
  >(token.current ? "setup" : csrf() ? "loading" : "login");
  const [context, setContext] = useState<Context | null>(null),
    [login, setLogin] = useState(""),
    [password, setPassword] = useState(""),
    [showPassword, setShowPassword] = useState(false),
    [newPassword, setNewPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(false),
    [setupStatus, setSetupStatus] = useState(""),
    [recovery, setRecovery] = useState(false),
    [setupBlocked, setSetupBlocked] = useState(false),
    [notice, setNotice] = useState<string | null>(null);
  const loginRef = useRef<HTMLInputElement>(null),
    passwordRef = useRef<HTMLInputElement>(null),
    active = useRef(true),
    pending = useRef(false),
    version = useRef(0),
    requests = useRef(new Set<AbortController>());
  const currentScreen = useRef(screen);
  currentScreen.current = screen;
  const api = async (action: string, body: unknown = {}) => {
    const controller = new AbortController();
    requests.current.add(controller);
    const timer = window.setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch("/api/staff/" + action, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...(csrf() ? { "X-CSRF-Token": csrf()! } : {}),
        },
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Failure(response.status);
      return (await response.json()) as unknown;
    } catch (error) {
      if (error instanceof Failure) throw error;
      throw new Failure(0, controller.signal.aborted);
    } finally {
      window.clearTimeout(timer);
      requests.current.delete(controller);
    }
  };
  const display = (input: unknown) => {
    const c = input as Context;
    if (
      !c ||
      typeof c.displayName !== "string" ||
      !Array.isArray(c.workspaces) ||
      c.workspaces.length > 5 ||
      c.workspaces.some(
        (w) =>
          !Object.hasOwn(destinations, w.code) || typeof w.name !== "string",
      )
    )
      throw new Failure(503);
    const params=new URLSearchParams(location.search);
    if(params.get('next')==='coordination' && c.workspaces.some(w=>w.code==='COORDINATION')) {
      const visit=params.get('visit'); location.replace('/coordination'+(visit && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(visit)?'#visit='+visit:''));return;
    }
    const operational=c.workspaces.filter(w=>w.code!=='COORDINATION');
    if(!params.has('choose') && operational.length===1 && c.workspaces.length>1){location.replace(destinations[operational[0].code]);return;}
    if (c.workspaces.length === 1 && !params.has('choose')) {
      location.replace(destinations[c.workspaces[0].code]);
      return;
    }
    setContext(c);
    setScreen("access");
  };
  const message = (error: unknown) => {
    const e = error as Failure;
    return e.timedOut
      ? "Request timed out. Please retry."
      : e.status === 401
        ? "Unable to sign in. Check your email or staff ID and password."
        : e.status === 403
          ? "Your staff access is unavailable."
          : e.status === 429
            ? "Too many attempts. Please wait."
            : e.status === 0
              ? "Connection lost. Please retry."
              : "Unable to complete sign-in. Please retry.";
  };
  useEffect(() => {
    active.current = true;
    if (token.current)
      history.replaceState(null, "", location.pathname + location.search);
    const probeSession = () => {
      const epoch = version.current;
      void api("me")
        .then((value) => {
          if (active.current && epoch === version.current) display(value);
        })
        .catch(() => {
          if (active.current && epoch === version.current) setScreen("login");
        });
    };
    if (!token.current && csrf()) probeSession();
    const hide = () => {
      version.current++;
      token.current = null;
      setPassword("");
      setNewPassword("");
      setConfirm("");
      for (const request of requests.current) request.abort();
    };
    const show = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      if (currentScreen.current === "loading") probeSession();
      if (currentScreen.current === "setup" && !token.current) {
        setRecovery(true);
        setSetupBlocked(true);
        setSetupStatus(
          "This setup page can no longer continue. Reopen the original setup link, or sign in if your password was already set.",
        );
      }
    };
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    return () => {
      active.current = false;
      hide();
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
    };
    // Only the initial mount probes the session. Explicit actions own subsequent requests.
  }, []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending.current || !event.currentTarget.reportValidity()) return;
    pending.current = true;
    setBusy(true);
    const epoch = version.current,
      value = password;
    setPassword("");
    try {
      const result = await api("login", {
        login: login.trim(),
        password: value,
      });
      if (active.current && epoch === version.current) display(result);
    } catch (error) {
      if (active.current && epoch === version.current) {
        setNotice(message(error));
        passwordRef.current?.focus();
      }
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  };
  const submitSetup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending.current || !event.currentTarget.reportValidity()) return;
    if (!token.current) {
      setRecovery(true);
      setSetupBlocked(true);
      setSetupStatus(
        "This setup page can no longer continue. Reopen the original setup link, or sign in if your password was already set.",
      );
      return;
    }
    if (newPassword !== confirm) {
      setSetupStatus("Passwords do not match.");
      return;
    }
    pending.current = true;
    setBusy(true);
    const epoch = ++version.current;
    try {
      await api("setup", { token: token.current, password: newPassword });
      if (!active.current || epoch !== version.current) return;
      token.current = null;
      setNewPassword("");
      setConfirm("");
      setScreen("login");
      setNotice("Password set. Sign in with your staff ID.");
      window.setTimeout(() => loginRef.current?.focus(), 0);
    } catch (error) {
      if (active.current && epoch === version.current) {
        const e = error as Failure;
        setSetupStatus(
          e.timedOut
            ? "Setup timed out. Your password may already be set. Try signing in, or retry this setup request."
            : "Setup failed. Check the password requirements; the link may have expired or already been used. Ask your administrator for a new link if needed.",
        );
        if (e.timedOut) setRecovery(true);
        setNewPassword("");
        setConfirm("");
      }
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  };
  return {
    screen,
    context,
    login,
    setLogin,
    password,
    setPassword,
    showPassword,
    setShowPassword,
    newPassword,
    setNewPassword,
    confirm,
    setConfirm,
    busy,
    setupStatus,
    recovery,
    setupBlocked,
    notice,
    setNotice,
    loginRef,
    passwordRef,
    submit,
    submitSetup,
    destinations,
    signInInstead: () => {
      version.current++;
      token.current = null;
      setNewPassword("");
      setConfirm("");
      setScreen("login");
      window.setTimeout(() => loginRef.current?.focus(), 0);
    },
    logout: async () => {
      try {
        await api("logout");
        location.reload();
      } catch (error) {
        setNotice(message(error));
      }
    },
  };
}
