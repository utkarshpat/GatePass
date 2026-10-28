import { createContext, useContext, type ReactNode } from "react";
import { translations, labels } from "./languageData.ts";
export const languageModes = [
  "en",
  "en-hi",
  "en-kn",
  "en-ta",
  "en-mr",
] as const;
export type LanguageMode = (typeof languageModes)[number];
export function translator(mode: string) {
  const locale = mode.split("-")[1];
  const pair = (key: string, values: Record<string, string | number> = {}) => {
    const en = labels[key] ?? key,
      regional = locale ? translations[locale]?.[en] : undefined,
      format = (s: string) =>
        s.replace(/\{(\w+)\}/gu, (_, key: string) => String(values[key] ?? ""));
    return {
      en: format(en),
      regional: regional ? format(regional) : null,
      locale,
    };
  };
  return {
    mode,
    pair,
    t: (key: string, values?: Record<string, string | number>) => {
      const p = pair(key, values);
      return p.en + (p.regional ? "\n" + p.regional : "");
    },
    bilingual: (key: string, values?: Record<string, string | number>) => {
      const p = pair(key, values);
      return p.en + (p.regional ? " / " + p.regional : "");
    },
  };
}
export function initialLanguage(): LanguageMode {
  try {
    const value = localStorage.getItem("gp-guard-language");
    if (languageModes.includes(value as LanguageMode))
      return value as LanguageMode;
  } catch {}
  return "en";
}
export const GuardLanguage = createContext<ReturnType<typeof translator>>(
  translator("en"),
);
export function GuardLanguageProvider({
  mode,
  children,
}: {
  mode: string;
  children: ReactNode;
}) {
  return (
    <GuardLanguage.Provider value={translator(mode)}>
      {children}
    </GuardLanguage.Provider>
  );
}
export function Label({
  textKey,
  values = {},
}: {
  textKey: string;
  values?: Record<string, string | number>;
}) {
  const p = useContext(GuardLanguage).pair(textKey, values);
  return (
    <>
      {p.en}
      {p.regional ? <small lang={p.locale}>{p.regional}</small> : null}
    </>
  );
}
