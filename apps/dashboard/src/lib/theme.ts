/**
 * Where the reader's theme choice is stored.
 *
 * This lives in its own module rather than alongside the toggle because the
 * root layout — a server component — needs it to build the pre-paint script,
 * and a `"use client"` module's exports arrive on the server as client
 * references, not values. Importing it from there yields `undefined` and the
 * script silently reads the wrong key, which is a bug that looks exactly like
 * "persistence doesn't work".
 */
export const THEME_KEY = "proofchain.dashboard.theme";

export type Theme = "light" | "dark";
export function applyDashboardTheme(theme: Theme) {
  if (theme !== 'light' && theme !== 'dark') throw new Error('Unsupported theme.');
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* Current session still changes. */ }
  window.dispatchEvent(new CustomEvent('proofchain:themechange', { detail: theme }));
}
