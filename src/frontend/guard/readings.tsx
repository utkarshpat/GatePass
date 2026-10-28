import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createStore } from "../shared/model.ts";
import { GuardLanguage } from "./language.tsx";
type Request = <T>(
  action: string,
  body: unknown,
  staff?: boolean,
  current?: () => boolean,
) => Promise<T>;
export function createReadings(request: Request, mode: () => string) {
  const cache = new Map<string, { reading: string | null; until: number }>(),
    nodes = new Map<
      Element,
      { name: string; paint: (value: string | null) => void }
    >();
  let stopped = false,
    busy = false,
    scheduled = false;
  const key = (name: string, locale: string) =>
    locale + ":" + name.normalize("NFC").trim().replace(/\s+/gu, " ");
  const visible = () =>
    [...nodes].filter(([node]) => {
      if (
        !node.isConnected ||
        node.closest("[hidden]") ||
        node.closest("dialog:not([open])")
      )
        return false;
      const rect = node.getBoundingClientRect();
      return rect.bottom >= -600 && rect.top <= innerHeight + 600;
    });
  function paint() {
    const locale = mode().split("-")[1];
    for (const [, item] of nodes) {
      const value = cache.get(key(item.name, locale));
      item.paint(
        locale && value && value.until > Date.now() ? value.reading : null,
      );
    }
  }
  async function drain() {
    if (busy || stopped) return;
    busy = true;
    try {
      for (;;) {
        const locale = mode().split("-")[1];
        if (!locale || stopped) return;
        const names = [...new Set(visible().map(([, item]) => item.name))]
          .filter((name) => {
            const value = cache.get(key(name, locale));
            return (
              name &&
              /[a-z]/iu.test(name) &&
              (!value || value.until <= Date.now())
            );
          })
          .slice(0, 10);
        if (!names.length) return;
        let items: { name: string; reading: string | null }[] = [];
        try {
          const result = await request<{
            locale: string;
            items: { name: string; reading: string | null }[];
          }>("name-readings", { locale, names }, false, () => !stopped);
          if (
            result.locale === locale &&
            Array.isArray(result.items) &&
            result.items.length === names.length &&
            result.items.every(
              (v, i) =>
                v?.name === names[i] &&
                (v.reading === null ||
                  (typeof v.reading === "string" && v.reading.length <= 400)),
            )
          )
            items = result.items;
        } catch {}
        if (stopped) return;
        for (const name of names) {
          const reading = items.find((v) => v.name === name)?.reading ?? null;
          cache.set(key(name, locale), {
            reading,
            until: Date.now() + (reading ? 86400000 : 60000),
          });
        }
        while (cache.size > 1000) cache.delete(cache.keys().next().value!);
        paint();
      }
    } finally {
      busy = false;
    }
  }
  const schedule = () => {
    if (scheduled || stopped) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      void drain();
    });
  };
  return {
    bind(node: Element, name: string, paint: (value: string | null) => void) {
      nodes.set(node, { name, paint });
      const locale = mode().split("-")[1],
        cached = cache.get(key(name, locale));
      paint(
        locale && cached && cached.until > Date.now() ? cached.reading : null,
      );
      schedule();
      return () => {
        nodes.delete(node);
      };
    },
    refresh() {
      paint();
      schedule();
    },
    start() {
      stopped = false;
      document.addEventListener("scroll", schedule, {
        capture: true,
        passive: true,
      });
      window.addEventListener("resize", schedule, { passive: true });
      schedule();
    },
    dispose() {
      stopped = true;
      document.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      nodes.clear();
      cache.clear();
    },
  };
}
export const ReadingsContext = createContext<ReturnType<
  typeof createReadings
> | null>(null);
export function PersonName({
  name,
  as = "span",
  className = "",
}: {
  name: string;
  as?: "span" | "strong" | "h3";
  className?: string;
}) {
  const model = useContext(ReadingsContext),
    language = useContext(GuardLanguage),
    ref = useRef<HTMLElement | null>(null),
    [reading, setReading] = useState<string | null>(null);
  useEffect(() => {
    setReading(null);
    if (ref.current) return model?.bind(ref.current, name, setReading);
  }, [model, name, language.mode]);
  const Tag = as,
    locale = language.mode.split("-")[1];
  return (
    <Tag
      ref={(node) => {
        ref.current = node;
      }}
      data-person-name={name}
      className={className + (reading ? " has-name-reading" : "")}
      title={name}
    >
      {reading && locale ? (
        <>
          <span className="name-reading-original" lang="en">
            {name}
          </span>{" "}
          <small
            className="name-reading-local"
            lang={locale}
            title={language
              .t("* Reading aid; pronunciation may be inaccurate.")
              .replace(/^\*\s*/gmu, "")}
          >
            ({reading}) *
          </small>
        </>
      ) : (
        name
      )}
    </Tag>
  );
}
