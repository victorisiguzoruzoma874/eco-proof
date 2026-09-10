import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { requesterApi, REQUESTER_TOKEN_COOKIE, ApiError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Self-registration for a requester — a household/business asking for a
 * pickup. Distinct account, distinct cookie (`REQUESTER_TOKEN_COOKIE`), from
 * the operator sign-in at `/login`: see that cookie's doc comment in
 * `lib/api.ts`. A wallet is created alongside the requester on the backend,
 * so there is nothing else to provision here — sign up, sign in, done.
 */

async function signUp(formData: FormData) {
  "use server";

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const phone = String(formData.get("phone") ?? "").trim();

  let accessToken: string;
  try {
    const result = await requesterApi.register({
      name,
      email,
      password,
      ...(phone ? { phone } : {}),
    });
    accessToken = result.accessToken;
  } catch (error) {
    redirect(`/requester/signup?error=${encodeURIComponent(messageOf(error))}`);
  }

  // httpOnly: the token must be unreachable from client JavaScript, same
  // reasoning as the operator cookie in /login.
  (await cookies()).set(REQUESTER_TOKEN_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  redirect("/requester/dashboard");
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail ?? `Request failed (${error.status}).`;
  }
  return "Could not reach the backend.";
}

export default async function RequesterSignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="rq-card" style={{ marginTop: "2.5rem" }}>
      <p className="rq-eyebrow">Requester access</p>
      <h1 style={{ margin: "0 0 1.25rem", fontSize: "1.5rem" }}>Create your account</h1>

      {error ? <p className="rq-error">{decodeURIComponent(error)}</p> : null}

      <form action={signUp}>
        <label className="rq-field">
          Name
          <input name="name" required maxLength={200} autoComplete="name" />
        </label>
        <label className="rq-field">
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label className="rq-field">
          Password
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </label>
        <label className="rq-field">
          Phone (optional)
          <input name="phone" type="tel" placeholder="+2348012345678" autoComplete="tel" />
        </label>
        <button
          className="rq-btn"
          data-variant="primary"
          type="submit"
          style={{ justifyContent: "center" }}
        >
          Create account
        </button>
      </form>

      <p style={{ marginTop: "1.25rem", fontSize: "0.875rem", textAlign: "center" }}>
        Already have an account? <Link href="/requester/login">Sign in</Link>.
      </p>
    </div>
  );
}
