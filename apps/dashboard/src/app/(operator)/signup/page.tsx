import Link from "next/link";
import { redirect } from "next/navigation";
import { api, ApiError, type HubDirectoryEntry, type SignupRole } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Sign-up for the two kinds of people who do the work: collectors and
 * operators. Requesters have their own page at `/requester/signup`, which
 * creates an account on the spot; this one does not. Operators and collectors
 * create the records that become payouts, so what is submitted here is a
 * request that a member of staff approves at `/signups` before anything can
 * be done with it.
 *
 * No client component: the role switch is a pair of links that re-render the
 * page with the other field set, so the form stays a plain server action like
 * the sign-in page beside it.
 */

function roleOf(value: unknown): SignupRole {
  return value === "operator" ? "operator" : "collector";
}

async function signUp(formData: FormData) {
  "use server";

  const role = roleOf(formData.get("role"));
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const hubId = String(formData.get("hubId") ?? "").trim();

  try {
    // Only the chosen role's fields: the backend refuses a body carrying
    // anything it does not expect.
    await api.submitSignup(
      role === "operator"
        ? { role, name, phone, email, password }
        : { role, name, phone, email, password, hubId },
    );
  } catch (error) {
    // Everything but the password goes back so the form can be refilled.
    const back = new URLSearchParams({ role, error: messageOf(error), name, phone, email });
    if (role === "collector") back.set("hubId", hubId);
    redirect(`/signup?${back.toString()}`);
  }

  const firstName = name.split(/\s+/)[0] ?? "";
  redirect(`/signup?done=${encodeURIComponent(firstName)}`);
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return "Too many sign-ups from here just now. Please try again in a few minutes.";
    }
    return error.detail ?? `Sign-up failed (${error.status}). Please try again.`;
  }
  return "We could not reach the server, so nothing was saved. Please try again.";
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{
    role?: string;
    error?: string;
    done?: string;
    name?: string;
    phone?: string;
    email?: string;
    hubId?: string;
  }>;
}) {
  const params = await searchParams;
  const role = roleOf(params.role);

  if (params.done !== undefined) {
    return (
      <main className="signup">
        <div className="signup-done">
          <p className="page-eyebrow">Join ProofChain</p>
          <h1 className="page-title">Thanks{params.done ? `, ${params.done}` : ""}</h1>
          <p>Your details are saved and your account is waiting for approval.</p>
          <p className="signup-done-note">
            Once approved, you can sign in with your email and password. Collectors will also be
            paired to a phone at their hub.
          </p>
          <p>
            <Link href="/login">Back to sign in</Link>
          </p>
        </div>
      </main>
    );
  }

  // The hub list is public, and only the collector form needs it. A failure
  // here must not take the operator form down with it.
  let hubs: HubDirectoryEntry[] = [];
  if (role === "collector") {
    hubs = await api.hubDirectory().catch(() => []);
  }
  const noHubs = role === "collector" && hubs.length === 0;

  return (
    <main className="signup">
      <div className="signup-split">
        <section className="signup-pitch" aria-labelledby="signup-pitch-title">
          <h1 id="signup-pitch-title">Join ProofChain</h1>
          <p>
            <strong>Collectors</strong> bring in materials and get paid by weight.
          </p>
          <p>
            <strong>Operators</strong> weigh, record and manage collections at a hub.
          </p>
          <p className="signup-pitch-foot">Every account is reviewed before it goes live.</p>
        </section>

        <section className="signup-form" aria-labelledby="signup-form-title">
          <h2 id="signup-form-title">Create an account</h2>

          <nav className="signup-switch" aria-label="Account type">
            <Link
              href="/signup?role=collector"
              aria-current={role === "collector" ? "true" : undefined}
            >
              Collector
            </Link>
            <Link
              href="/signup?role=operator"
              aria-current={role === "operator" ? "true" : undefined}
            >
              Operator
            </Link>
          </nav>

          {params.error ? <p className="error">{params.error}</p> : null}

          {noHubs ? (
            <p className="note">No hubs are available yet. Please try again later.</p>
          ) : (
            <form action={signUp} className="signup-fields">
              <input type="hidden" name="role" value={role} />

              <label>
                Full name
                <input
                  name="name"
                  required
                  maxLength={200}
                  autoComplete="name"
                  defaultValue={params.name ?? ""}
                />
              </label>

              <label>
                Email
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  defaultValue={params.email ?? ""}
                />
              </label>

              <label>
                Phone number
                <input
                  name="phone"
                  type="tel"
                  required
                  pattern="\+?[0-9]{7,15}"
                  title="Digits only, with an optional + at the start. For example +2348012345678"
                  placeholder="+2348012345678"
                  autoComplete="tel"
                  defaultValue={params.phone ?? ""}
                />
              </label>

              <label>
                Password
                <input
                  name="password"
                  type="password"
                  required
                  minLength={12}
                  maxLength={200}
                  autoComplete="new-password"
                  aria-describedby="signup-password-hint"
                />
                <span id="signup-password-hint" className="signup-hint">
                  At least 12 characters.
                </span>
              </label>

              {role === "collector" ? (
                <label>
                  Your hub
                  <select name="hubId" required defaultValue={params.hubId ?? ""}>
                    <option value="" disabled>
                      Choose a hub
                    </option>
                    {hubs.map((hub) => (
                      <option key={hub.id} value={hub.id}>
                        {hub.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <button className="btn" data-variant="primary" type="submit">
                Create account
              </button>
            </form>
          )}

          <p className="signup-alt">
            Already have an account? <Link href="/login">Sign in</Link>
          </p>
        </section>
      </div>
    </main>
  );
}
