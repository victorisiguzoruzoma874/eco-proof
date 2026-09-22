import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { BACKEND_URL, TOKEN_COOKIE } from "@/lib/api";
import { PageHeader } from "../_components/PageHeader";

export const dynamic = "force-dynamic";

async function signIn(formData: FormData) {
  "use server";

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const res = await fetch(`${BACKEND_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });

  if (!res.ok) redirect("/login?error=1");

  const { accessToken } = (await res.json()) as { accessToken: string };

  // httpOnly: the token must be unreachable from client JavaScript.
  (await cookies()).set(TOKEN_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  redirect("/");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; signedOut?: string }>;
}) {
  const { error, signedOut } = await searchParams;

  return (
    <main style={{ maxWidth: "26rem", margin: "0 auto" }}>
      <PageHeader eyebrow="Operator access" title="Sign in" />

      {error ? (
        <p className="error" style={{ marginTop: 0, marginBottom: "1.25rem" }}>
          Those credentials were not accepted.
        </p>
      ) : signedOut ? (
        <p className="note" style={{ marginTop: 0, marginBottom: "1.25rem" }}>
          You have signed out.
        </p>
      ) : null}

      {/*
        The form is a contained card rather than a bare full-width column: on a
        78rem shell an unbounded sign-in form reads as an unfinished page. The
        border/ground pair is the same hairline-on-surface vocabulary the tables
        and popovers use, so this stays inside the system rather than inventing
        a card style for one screen.
      */}
      <section
        style={{
          border: "1px solid var(--rule)",
          background: "var(--surface)",
          borderRadius: "2px",
          padding: "1.75rem",
        }}
      >
        <form action={signIn} style={{ display: "grid", gap: "1rem" }}>
          <label>
            Email
            <input name="email" type="email" required autoComplete="username" />
          </label>
          <label>
            Password
            <input name="password" type="password" required autoComplete="current-password" />
          </label>
          <button className="btn" data-variant="primary" type="submit">
            Sign in
          </button>
        </form>
      </section>

      <p className="note" style={{ marginTop: "1.5rem" }}>
        Auditors get read-only access. Verification endpoints and audit reports stay public by
        design — a buyer must be able to check our claims without an account.
      </p>
    </main>
  );
}
