import Link from "next/link";
import { redirect } from "next/navigation";
import { requesterApi } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * The requester section's index route (`/requester`) — a welcome/onboarding
 * screen for a first-time visitor, or a silent hand-off to the dashboard for
 * anyone who already has a valid session. Session validity is always
 * re-checked against the backend here (never just "cookie present" — see
 * requester/layout.tsx's doc comment on that distinction), so an expired or
 * revoked token correctly falls through to the welcome screen below instead
 * of bouncing the visitor in a redirect loop.
 *
 * `redirect()` throws internally, so the call to it below sits outside the
 * try/catch — nesting it inside would swallow the redirect as if `me()` had
 * failed.
 */
export default async function RequesterWelcomePage() {
  let hasSession = false;
  try {
    await requesterApi.me();
    hasSession = true;
  } catch {
    hasSession = false;
  }

  if (hasSession) {
    redirect("/requester/dashboard");
  }

  return (
    <div className="rq-hero">
      <p className="rq-eyebrow">PROOFCHAIN</p>
      <h1>Your waste is worth money.</h1>

      <ol className="rq-steps">
        <li>
          <strong>01</strong> Request a pickup from your gate. No fee.
        </li>
        <li>
          <strong>02</strong> The collector weighs each material in front of you.
        </li>
        <li>
          <strong>03</strong> Credits land in your wallet. Cash out or spend with partners.
        </li>
      </ol>

      <Link
        className="rq-btn"
        data-variant="on-dark"
        href="/requester/signup"
        style={{ justifyContent: "center" }}
      >
        Get started
      </Link>

      <p style={{ textAlign: "center", marginTop: "0.875rem", fontSize: "0.875rem" }}>
        Already have an account? <Link href="/requester/login">Sign in</Link>
      </p>

      <p style={{ textAlign: "center", marginTop: "1.75rem", fontSize: "0.75rem" }}>
        Free to join · your data stays yours
      </p>
    </div>
  );
}
