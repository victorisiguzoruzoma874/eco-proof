"use client";

import { useEffect, useState } from "react";
import { THEME_KEY, type Theme } from "@/lib/theme";

/**
 * Light/dark switch for the requester app.
 *
 * The same model as the operator section's toggle and the capture app's, and
 * deliberately the same stored key: someone who sets dark on one screen of this
 * dashboard means it for the other. Three states — no stored choice follows the
 * system and keeps following it, and a tap stamps a choice that wins in both
 * directions.
 *
 * Nothing here paints anything: `requester.css` owns both palettes off the same
 * `data-theme` attribute the root layout applies before first paint. This owns
 * the tap, the persistence and the label.
 */
export function ThemeToggle() {
  /**
   * Null until mounted, because the honest answer on the server is "unknown":
   * the choice lives in localStorage and the fallback is a media query, neither
   * of which exists during SSR. Rendering a guess would either mismatch on
   * hydration or announce the wrong action to a screen reader.
   */
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const explicit = document.documentElement.dataset.theme as Theme | undefined;
    setTheme(
      explicit ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
    );
  }, []);

  /** Follow the system only while the reader has not chosen for themselves. */
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = (event: MediaQueryListEvent) => {
      if (document.documentElement.dataset.theme) return;
      setTheme(event.matches ? "dark" : "light");
    };
    query.addEventListener("change", onSystemChange);
    return () => query.removeEventListener("change", onSystemChange);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // A private window or blocked storage must still switch for this session;
      // losing the preference is a far smaller failure than an inert button.
    }
  }

  // Before mount the destination is genuinely unknown, so the control names its
  // purpose rather than a theme it cannot yet promise.
  const label =
    theme === null ? "Switch theme" : theme === "dark" ? "Light mode" : "Dark mode";

  return (
    <button type="button" className="rq-tab rq-theme-toggle" onClick={toggle} aria-label={label}>
      <span className="rq-theme-icon" aria-hidden="true">
        {theme === "dark" ? SUN : MOON}
      </span>
      <span>{label}</span>
    </button>
  );
}

const MOON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </svg>
);

const SUN = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
