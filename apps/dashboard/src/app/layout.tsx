import type { Metadata } from "next";
import { THEME_KEY } from "@/lib/theme";

export const metadata: Metadata = {
  title: "ProofChain",
  description: "Verified waste collection, hub re-weighs, and household waste-credit wallets.",
};

/**
 * Applies a stored theme choice before the first paint — see the operator
 * layout's `ThemeToggle` for what reads it back. Kept at the root, not
 * `(operator)/layout.tsx`, because it only touches `data-theme` on `<html>`,
 * which every route shares regardless of which section's stylesheet is
 * active; `/requester/*` simply never renders a toggle or a dark palette,
 * so the attribute sits there unused rather than causing any conflict.
 *
 * This has to be a blocking inline script in the head, not an effect: an effect
 * runs after React hydrates, by which point the browser has already painted the
 * page in the system theme. Wrapped in try/catch because `localStorage` throws
 * outright in some privacy modes, and an exception here would abort the parser
 * before the page renders.
 */
const applyStoredTheme = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

/**
 * Deliberately minimal: no nav, no stylesheet import. `(operator)/layout.tsx`
 * and `requester/layout.tsx` are two unrelated visual systems for two
 * unrelated audiences (see each file's own doc comment) — this root layout
 * exists only because Next.js requires exactly one `<html>`/`<body>` pair,
 * not because the two sections share any chrome.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the script above sets `data-theme` on this
    // element before React hydrates, so the server markup and the live DOM are
    // expected to differ here. It is scoped to this element only.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: applyStoredTheme }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
