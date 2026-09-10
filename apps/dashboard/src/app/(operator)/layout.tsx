import Link from "next/link";
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { ThemeToggle } from "./ThemeToggle";
import { OperatorNav } from "./OperatorNav";
import "./globals.css";

/*
 * Three faces, and the third is the one that matters most here — see
 * `docs/typography.md`.
 *
 * Loaded as CSS variables rather than class names so `globals.css` keeps
 * owning every type decision; nothing here dictates where a face is used.
 */

/*
 * Display: the wordmark and the page title.
 *
 * Fraunces carries a true optical-size axis, so unlike the Didone it replaced
 * it is redrawn for the size rather than scaled to it — which is what lets one
 * face hold a 54px page title and a 20px wordmark without either going flabby
 * or falling apart. `globals.css` pins its `SOFT` and `WONK` axes; see the
 * `--serif` token for why.
 */
const fraunces = Fraunces({
  subsets: ["latin"],
  axes: ["SOFT", "WONK", "opsz"],
  variable: "--font-display",
});

/*
 * Text: navigation, tables, forms, badges, metadata, and every figure.
 *
 * Plex was commissioned to give an engineering company a voice of its own, and
 * it reads as instrument rather than as app — the right register for a screen
 * an auditor uses to decide whether to believe a number.
 */
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});

/*
 * Machine strings: Merkle roots, transaction hashes, ledger sequences, keys.
 *
 * A real face rather than the `ui-monospace` stack this used to fall back to.
 * Those strings are the product's whole proposition — someone compares 64 hex
 * characters against the Stellar ledger by eye — and leaving them to the system
 * meant the most scrutinised text in the product rendered in a different
 * typeface on every viewer's machine.
 *
 * Plex Mono is drawn as this sans's sibling, so a hash and the weight beside it
 * share a skeleton instead of being strangers.
 */
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

/**
 * The operator/admin shell: topbar, nav, and the editorial "ledger" theme
 * (globals.css) — scoped to this route group only. `/requester/*` lives
 * outside `(operator)` on purpose and has its own layout and stylesheet, so
 * a requester (a different account, a different trust boundary — see
 * `requester-auth.guard.ts`) never sees the operator's admin chrome around
 * their own screens.
 */
export default function OperatorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${fraunces.variable} ${plexSans.variable} ${plexMono.variable} operator-root`}
    >
      <header className="topbar no-print">
        <div className="topbar-inner">
          <Link className="brand" href="/">
            ProofChain <em>ledger</em>
          </Link>
          <OperatorNav />
          <div className="topbar-actions">
            {/*
             * A requester is a different account and trust boundary from
             * the operator/auditor nav above (own login, own cookie) — kept
             * visually separate rather than folded into the nav so it
             * never reads as another item of the same kind.
             */}
            <Link className="requester-link" href="/requester/login">
              Requester login
            </Link>
            <Link className="signin-link" href="/login">
              Sign in
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <div className="shell">{children}</div>
    </div>
  );
}
