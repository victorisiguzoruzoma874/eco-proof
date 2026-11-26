import { IBM_Plex_Mono, Poppins } from "next/font/google";
import "../requester/requester.css";

/*
 * Same faces as the requester and operator shells; see `docs/typography.md`.
 */
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--rq-font-sans",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--rq-font-mono",
});

/**
 * The collector's shell. A collector signs in at `/login` like staff (same
 * `users` table, role `collector`), but is not staff, so this lives outside
 * the `(operator)` route group and never shows the staff nav. That layout
 * sends a collector here; the backend's `JwtAuthGuard` is what actually keeps
 * them off staff routes.
 *
 * Borrows the requester app's stylesheet, which is scoped under `.rq-shell`:
 * both are people outside the hub looking at their own account.
 */
export default function CollectorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`rq-shell ${poppins.variable} ${plexMono.variable}`}>
      <div className="rq-body">
        <main className="rq-main">{children}</main>
      </div>
    </div>
  );
}
