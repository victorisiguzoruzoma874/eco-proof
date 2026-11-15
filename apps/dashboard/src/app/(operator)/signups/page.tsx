import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ApiError, type CurrentUser, type PendingSignup } from "@/lib/api";
import { PageHeader } from "../_components/PageHeader";
import { LoadError } from "../_components/LoadError";

export const dynamic = "force-dynamic";

/**
 * The sign-up queue: people who asked to join at `/signup` and are waiting for
 * a decision.
 *
 * Approving is the only way a sign-up becomes anything. An approved operator
 * gets an account and can sign in with the password they chose; an approved
 * collector joins the roster, where their phone is paired as before. Which
 * requests a viewer is shown is decided by the backend (admins see all,
 * operators see collectors only), so this page renders what it is given and
 * never filters by role itself.
 */

async function approve(formData: FormData) {
  "use server";

  const id = String(formData.get("id") ?? "");
  let kind: string;
  let name: string;
  try {
    const decision = await api.approveSignup(id);
    kind = decision.signup.role;
    name = decision.signup.name;
  } catch (error) {
    redirect(`/signups?error=${encodeURIComponent(messageOf(error))}`);
  }

  revalidatePath("/signups");
  // An approved collector is on the roster from this moment.
  revalidatePath("/collectors");
  redirect(`/signups?approved=${encodeURIComponent(name)}&kind=${kind}`);
}

async function reject(formData: FormData) {
  "use server";

  const id = String(formData.get("id") ?? "");
  let name: string;
  try {
    name = (await api.rejectSignup(id)).signup.name;
  } catch (error) {
    redirect(`/signups?error=${encodeURIComponent(messageOf(error))}`);
  }

  revalidatePath("/signups");
  redirect(`/signups?rejected=${encodeURIComponent(name)}`);
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail ?? `Request failed (${error.status}).`;
  }
  return "The backend did not respond, so nothing was changed.";
}

const submittedFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Africa/Lagos",
});

const HEADER = { eyebrow: "New accounts", title: "Pending sign-ups" } as const;

export default async function SignupsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; approved?: string; rejected?: string; kind?: string }>;
}) {
  const { error, approved, rejected, kind } = await searchParams;

  let viewer: CurrentUser;
  try {
    viewer = await api.me();
  } catch {
    return (
      <main>
        <PageHeader {...HEADER} />
        <p className="error">
          Not signed in. <Link href="/login">Sign in</Link> to review sign-ups.
        </p>
      </main>
    );
  }

  if (viewer.role !== "admin" && viewer.role !== "operator") {
    return (
      <main>
        <PageHeader {...HEADER} />
        <p className="note">Sign-ups are reviewed by admins and operators.</p>
      </main>
    );
  }

  let signups: PendingSignup[];
  try {
    signups = await api.pendingSignups();
  } catch (loadError) {
    return (
      <main>
        <PageHeader {...HEADER} />
        <LoadError error={loadError} resource="the sign-up queue" />
      </main>
    );
  }

  return (
    <main>
      <PageHeader {...HEADER} />
      <p className="page-intro">
        People who signed up and are waiting for a decision. Approving an operator lets them sign
        in. Approving a collector adds them to the roster, ready to be paired to a phone.
        {viewer.role === "operator"
          ? " You can decide collector sign-ups; operator sign-ups go to an admin."
          : null}
      </p>

      {error ? <p className="error">{error}</p> : null}
      {approved ? (
        kind === "collector" ? (
          <p className="note">
            Approved {approved}. Pair their phone from the{" "}
            <Link href="/collectors">Collectors page</Link>.
          </p>
        ) : (
          <p className="note">Approved {approved}. They can now sign in.</p>
        )
      ) : null}
      {rejected ? <p className="note">Rejected {rejected}.</p> : null}

      {signups.length === 0 ? (
        <p className="empty">No sign-ups are waiting.</p>
      ) : (
        <div className="table-wrap">
          <table className="table--stack signups-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Phone</th>
                <th>Email or hub</th>
                <th>Submitted</th>
                <th className="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {signups.map((s) => (
                <tr key={s.id}>
                  <td data-label="Name">{s.name}</td>
                  <td data-label="Role">{s.role === "operator" ? "Operator" : "Collector"}</td>
                  <td data-label="Phone">{s.phone}</td>
                  <td data-label="Email or hub">
                    {s.role === "operator" ? (s.email ?? "—") : (s.hubName ?? "—")}
                  </td>
                  <td data-label="Submitted">{submittedFormat.format(new Date(s.createdAt))}</td>
                  <td className="col-actions">
                    <div className="actions">
                      <form action={approve}>
                        <input type="hidden" name="id" value={s.id} />
                        <button
                          className="btn"
                          data-variant="primary"
                          data-size="sm"
                          type="submit"
                          aria-label={`Approve ${s.name}`}
                        >
                          Approve
                        </button>
                      </form>

                      <details className="confirm">
                        <summary className="btn" data-size="sm" aria-label={`Reject ${s.name}`}>
                          Reject
                        </summary>
                        <form action={reject} className="confirm-body">
                          <input type="hidden" name="id" value={s.id} />
                          <p>
                            Reject <strong>{s.name}</strong>? Their details are kept on record and
                            they can sign up again.
                          </p>
                          <div className="actions">
                            <button className="btn" data-variant="danger" type="submit">
                              Yes, reject
                            </button>
                          </div>
                        </form>
                      </details>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
