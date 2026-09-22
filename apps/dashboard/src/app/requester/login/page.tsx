import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { requesterApi, REQUESTER_TOKEN_COOKIE } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Requester sign-in — mirrors `/login`'s Server Action + cookie pattern
 * exactly, just against the requester endpoints and cookie. A requester
 * account is a separate trust boundary from an operator's (own JWT, own
 * guard on the backend); this page must never set or read `proofchain_token`.
 */

async function signIn(formData: FormData) {
  "use server";

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  let accessToken: string;
  try {
    const result = await requesterApi.login({ email, password });
    accessToken = result.accessToken;
  } catch {
    redirect("/requester/login?error=1");
  }

  (await cookies()).set(REQUESTER_TOKEN_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  redirect("/requester/dashboard");
}

export default async function RequesterLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; signedOut?: string }>;
}) {
  const { error, signedOut } = await searchParams;

  return (
    <div className="rq-card" style={{ marginTop: "2.5rem" }}>
      <p className="rq-eyebrow">Requester access</p>
      <h1 style={{ margin: "0 0 1.25rem", fontSize: "1.5rem" }}>Sign in</h1>

      {error ? (
        <p className="rq-error">Those credentials were not accepted.</p>
      ) : signedOut ? (
        <p className="rq-note">You have signed out.</p>
      ) : null}

      <form action={signIn}>
        <label className="rq-field">
          Email
          <input name="email" type="email" required autoComplete="username" />
        </label>
        <label className="rq-field">
          Password
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
        <button
          className="rq-btn"
          data-variant="primary"
          type="submit"
          style={{ justifyContent: "center" }}
        >
          Sign in
        </button>
      </form>

      <p style={{ marginTop: "1.25rem", fontSize: "0.875rem", textAlign: "center" }}>
        New here? <Link href="/requester/signup">Create an account</Link> to request a pickup and
        earn waste credits.
      </p>
    </div>
  );
}
