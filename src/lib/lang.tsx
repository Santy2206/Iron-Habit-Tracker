"use client";

import { useEffect, useSyncExternalStore } from "react";

export type Lang = "en" | "es";

const KEY = "iron.lang";

let lang: Lang = "en";
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function setLang(l: Lang) {
  lang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {}
  if (typeof document !== "undefined") document.documentElement.lang = l;
  listeners.forEach((f) => f());
}

/** Reactive current language. Defaults to "en"; hydrates from localStorage
 *  on first mount. */
export function useLang(): Lang {
  const l = useSyncExternalStore<Lang>(
    subscribe,
    () => lang,
    () => "en",
  );
  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if ((v === "es" || v === "en") && v !== lang) setLang(v);
    } catch {}
  }, []);
  return l;
}

/** t(en, es) — English default; pass the Spanish string to translate. */
export function useT() {
  const l = useLang();
  return {
    lang: l,
    locale: l === "es" ? "es-CO" : "en-US",
    t: (en: string, es?: string) => (l === "es" ? (es ?? en) : en),
  };
}
