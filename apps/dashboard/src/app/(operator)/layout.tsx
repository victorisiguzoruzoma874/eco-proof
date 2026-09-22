import Link from "next/link";
import { cookies } from "next/headers";
import { IBM_Plex_Mono, Poppins } from "next/font/google";
import { ThemeToggle } from "./ThemeToggle";
import { OperatorNav } from "./OperatorNav";
import { signOut } from "./sign-out";
import { TOKEN_COOKIE } from "@/lib/api";
import "./globals.css";

/*
 * Two faces, and the second is the one that matters most here — see
 * `docs/typography.md`.
 *
 * Loaded as CSS variables rather than class names so `globals.css` keeps
 * owning every type decision; nothing here dictates where a face is used.
 */

/*
 * Everything a person reads: the wordmark, the page title, navigation, tables,
 * forms, badges, metadata, and every figure.
 *
 * One family across display and text, where this sheet previously paired
 * Fraunces with IBM Plex Sans. Poppins is a geometric sans with a single
 * skeleton at every size, so the hierarchy has to come from weight, size and
 * space rather than from a change of voice — which is why the page title is
 * set at 600 and the body at 400 rather than relying on a serif to do that
 * work.
 *
 * Declared once and aliased in `globals.css`, so the display and text tokens
 * resolve to the same face without paying for a second download.
 *
 * 500 earns its place: it is the nav and table-header weight, and skipping it
 * would push those to 600 and make the bar shout.
 */
const poppins = Poppins({
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
 * Kept as Plex Mono while the rest of the product moved to Poppins, because
 * Poppins has no monospace cut and a proportional face is the wrong tool for a
 * string someone transcribes character by character. A hash and the weight
 * beside it no longer share a skeleton; legibility of the hash wins.
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
export default async function OperatorLayout({ children }: { children: React.ReactNode }) {
  // Presence of the cookie, not a /auth/me round trip on every navigation: an
  // expired token still shows "Sign out", and signing out of it is harmless.
  const signedIn = Boolean((await cookies()).get(TOKEN_COOKIE)?.value);

  return (
    <div
      className={`${poppins.variable} ${plexMono.variable} operator-root`}
    >
      <header className="topbar no-print">
        <div className="topbar-inner">
          <Link className="brand" href="/">
            ProofChain <em>ledger</em>
          </Link>
          <OperatorNav signedIn={signedIn} />
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
            {signedIn ? (
              <form action={signOut}>
                <button type="submit" className="signin-link">
                  Sign out
                </button>
              </form>
            ) : (
              <Link className="signin-link" href="/login">
                Sign in
              </Link>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>
      <div className="shell">{children}</div>
    </div>
  );
}
