import { IBM_Plex_Mono, Poppins } from "next/font/google";
import { cookies } from "next/headers";
import { REQUESTER_TOKEN_COOKIE } from "@/lib/api";
import { RequesterTabs } from "./RequesterTabs";
import "./requester.css";

/*
 * The same two faces as the operator dashboard — see `docs/typography.md`.
 *
 * A household and an auditor are different audiences, but they are looking at
 * the same company's numbers, and a second type system made that seam visible
 * the moment anyone crossed between the two sections. What separates the two
 * products is weight, scale and colour, which is where the difference belongs.
 */

/*
 * Everything a requester reads: the screen title, their balance, every card.
 *
 * Poppins covers display and text alike, so `requester.css` aliases its own
 * display token to this one rather than loading a second family.
 */
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--rq-font-sans",
});

/*
 * A redemption code, scanned or typed back in off a collector's screen — the
 * one place in this app where a person has to get every character right, which
 * is why it stayed monospaced when everything around it became Poppins.
 */
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--rq-font-mono",
});

/**
 * The requester's shell — a distinct consumer product from the operator
 * dashboard, matching the Eco-Proof design (deep green branding, card-based
 * mobile layout) rather than `(operator)/globals.css`'s editorial ledger look.
 * The two share a text face and a type scale and nothing else. Lives outside the `(operator)` route group specifically so it
 * never inherits that section's topbar/nav — see `(operator)/layout.tsx`'s
 * doc comment for the other half of that split.
 *
 * The nav is gated here, once, on the mere PRESENCE of the requester
 * cookie — not its validity. Each page still independently calls
 * `requesterApi.me()` and redirects to `/requester/login` on a 401, which is
 * the real authorization check; this is only about whether the side nav
 * makes sense to show at all (never on /requester/login or /requester/signup,
 * always once a session cookie exists) — a cheap, no-request signal, not a
 * security boundary.
 *
 * `.rq-body` wraps nav+content together so `.rq-main` no longer centers
 * itself alone (see requester.css) — with a sidebar in the mix, the PAIR
 * needs to be centered as one unit, not `.rq-main` alone with the sidebar
 * floating off to one side of it.
 */
export default async function RequesterLayout({ children }: { children: React.ReactNode }) {
  const hasSession = Boolean((await cookies()).get(REQUESTER_TOKEN_COOKIE)?.value);

  return (
    <div className={`rq-shell ${poppins.variable} ${plexMono.variable}`}>
      <div className="rq-body">
        {hasSession ? <RequesterTabs /> : null}
        <main className="rq-main">{children}</main>
      </div>
    </div>
  );
}
