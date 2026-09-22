/**
 * Light/dark theme for the capture screen.
 *
 * Same model as the dashboard's toggle: with no stored choice the screen
 * follows the phone's system setting (and keeps following it if that changes);
 * tapping the toggle stamps an explicit choice on `<html data-theme>` that wins
 * in both directions. `styles.css` does all the painting off that attribute and
 * `prefers-color-scheme` — nothing here sets a colour.
 *
 * `index.html` repeats the storage read in an inline script so a stored choice
 * applies before first paint rather than flashing the other theme.
 */

export type Theme = "light" | "dark";

/** Must match the inline script in `index.html`. */
export const THEME_KEY = "proofchain.capture.theme";

/**
 * The stored choice, or null for "follow the system".
 *
 * Storage can throw (private browsing, blocked site data) or hold anything; a
 * theme is never worth failing over, so both mean "no choice".
 */
export function readStoredTheme(storage: Pick<Storage, "getItem"> = localStorage): Theme | null {
  try {
    const value = storage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

/** What is on screen: an explicit choice if there is one, else the system's. */
export function effectiveTheme(explicit: Theme | null, systemPrefersDark: boolean): Theme {
  return explicit ?? (systemPrefersDark ? "dark" : "light");
}

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function currentTheme(): Theme {
  const explicit = document.documentElement.dataset.theme;
  return effectiveTheme(explicit === "light" || explicit === "dark" ? explicit : null, systemPrefersDark());
}

/** Flip to the other theme and remember it. Returns the theme now showing. */
export function toggleTheme(storage: Pick<Storage, "setItem"> = localStorage): Theme {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    storage.setItem(THEME_KEY, next);
  } catch {
    // Not persistable here; it still applies for this session, which is a far
    // smaller failure than a toggle that does nothing.
  }
  return next;
}

/** Call `listener` when the system theme changes and no explicit choice overrides it. */
export function onSystemThemeChange(listener: () => void): void {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!document.documentElement.dataset.theme) listener();
  });
}
