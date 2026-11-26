import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ApiError, type Collector, type CurrentUser } from "@/lib/api";
import { PageHeader } from "../_components/PageHeader";
import { LoadError } from "../_components/LoadError";

export const dynamic = "force-dynamic";

/**
 * The collector roster, administered.
 *
 * This is the list a device picks from at pairing time (`Collector` on the
 * capture app's enrolment screen) — a hub with only one collector here is a
 * hub where every phone in the field enrols as the same person. Phone is
 * unique per collector (it doubles as their payout identity) and, like a
 * material code, is never edited once set: it is what a payout is paid to.
 *
 * Admins can delete a collector who has no history (no weigh-ins, payouts or
 * assigned requests). The backend decides who qualifies; this page only asks
 * first, because a delete cannot be undone.
 */

async function addCollector(formData: FormData) {
  "use server";

  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const cooperativeId = String(formData.get("cooperativeId") ?? "").trim();
  const kycLevel = String(formData.get("kycLevel") ?? "").trim();

  try {
    await api.createCollector({
      name,
      phone,
      ...(cooperativeId ? { cooperativeId } : {}),
      ...(kycLevel ? { kycLevel: kycLevel as "none" | "basic" | "verified" } : {}),
    });
  } catch (error) {
    redirect(`/collectors?error=${encodeURIComponent(messageOf(error))}`);
  }

  revalidatePath("/collectors");
  revalidatePath("/requests");
  redirect(`/collectors?added=${encodeURIComponent(name)}`);
}

async function deleteCollector(formData: FormData) {
  "use server";

  const id = String(formData.get("id") ?? "");
  let name: string;
  try {
    ({ name } = await api.deleteCollector(id));
  } catch (error) {
    redirect(`/collectors?error=${encodeURIComponent(messageOf(error))}`);
  }

  revalidatePath("/collectors");
  revalidatePath("/requests");
  redirect(`/collectors?deleted=${encodeURIComponent(name)}`);
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail ?? `Request failed (${error.status}).`;
  }
  return "The backend did not respond, so nothing was changed.";
}

export default async function CollectorsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; added?: string; deleted?: string }>;
}) {
  const { error, added, deleted } = await searchParams;

  let collectors: Collector[];
  let viewer: CurrentUser | null = null;
  try {
    [collectors, viewer] = await Promise.all([api.collectors(), api.me().catch(() => null)]);
  } catch {
    return (
      <main>
        <PageHeader eyebrow="Field roster" title="Collectors" />
        <LoadError error={error} resource="the collector roster" />
      </main>
    );
  }

  if (!viewer) {
    return (
      <main>
        <PageHeader eyebrow="Field roster" title="Collectors" />
        <p className="error">
          Not signed in. <Link href="/login">Sign in</Link> to see the collector roster.
        </p>
      </main>
    );
  }

  const canEdit = viewer.role === "admin" || viewer.role === "operator";
  const active = collectors.filter((c) => c.active);
  const inactive = collectors.filter((c) => !c.active);

  return (
    <main>
      <PageHeader eyebrow="Field roster" title="Collectors" />
      <p className="page-intro">
        Every collector who can be assigned a device or a pickup request is listed here. A phone
        number is permanent once set — it is the identity a payout is paid to — so double-check it
        before adding one. Once added, a collector shows up immediately in the capture app&apos;s
        device-pairing screen and in the requests queue&apos;s assignment list.
      </p>

      {error ? <p className="error">{error}</p> : null}
      {added ? (
        <p className="note">Added {added}. They can now be assigned a device or a request.</p>
      ) : null}
      {deleted ? <p className="note">Deleted {deleted}, with their devices and login.</p> : null}

      <dl className="stats">
        <div className="stat">
          <dt>Active</dt>
          <dd>{active.length}</dd>
        </div>
        <div className="stat">
          <dt>Inactive</dt>
          <dd>{inactive.length}</dd>
        </div>
      </dl>

      {canEdit ? null : (
        <p className="note">Read-only: adding a collector requires an admin or operator account.</p>
      )}

      <h2>Roster</h2>
      {collectors.length === 0 ? (
        <p className="empty">No collectors yet.</p>
      ) : (
        <CollectorTable collectors={collectors} canDelete={viewer.role === "admin"} />
      )}

      {canEdit ? (
        <>
          <h2>Add a collector</h2>
          <form action={addCollector} className="page-form">
            <label htmlFor="name">
              Name
              <input id="name" name="name" required maxLength={200} placeholder="Amina Wanjiru" />
            </label>
            <label htmlFor="phone">
              Phone (permanent, E.164-style)
              <input id="phone" name="phone" required placeholder="+254700000003" />
            </label>
            <label htmlFor="cooperativeId">
              Cooperative (optional)
              <input id="cooperativeId" name="cooperativeId" maxLength={100} placeholder="coop-nairobi-1" />
            </label>
            <label htmlFor="kycLevel">
              KYC level (optional)
              <select id="kycLevel" name="kycLevel" defaultValue="">
                <option value="">none</option>
                <option value="basic">basic</option>
                <option value="verified">verified</option>
              </select>
            </label>
            <div className="actions">
              <button className="btn" data-variant="primary" type="submit">
                Add collector
              </button>
            </div>
          </form>
        </>
      ) : null}
    </main>
  );
}

function CollectorTable({
  collectors,
  canDelete,
}: {
  collectors: Collector[];
  canDelete: boolean;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Phone</th>
            <th>Cooperative</th>
            <th>KYC</th>
            <th>Status</th>
            {canDelete ? <th className="col-actions">Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {collectors.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.phone}</td>
              <td>{c.cooperativeId ?? "—"}</td>
              <td>{c.kycLevel}</td>
              <td>
                <span className="pill" data-tone={c.active ? "verified" : "neutral"}>
                  {c.active ? "active" : "inactive"}
                </span>
              </td>
              {canDelete ? (
                <td className="col-actions">
                  <details className="confirm">
                    <summary className="btn" data-size="sm" aria-label={`Delete ${c.name}`}>
                      Delete
                    </summary>
                    <form action={deleteCollector} className="confirm-body">
                      <input type="hidden" name="id" value={c.id} />
                      <p>
                        Delete <strong>{c.name}</strong> permanently? Their devices and login go
                        too. This cannot be undone. Collectors with weigh-ins, payouts or requests
                        cannot be deleted.
                      </p>
                      <div className="actions">
                        <button className="btn" data-variant="danger" type="submit">
                          Yes, delete
                        </button>
                      </div>
                    </form>
                  </details>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
