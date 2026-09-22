import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ApiError, type CurrentUser, type MaterialRate } from "@/lib/api";
import { formatCurrency, formatDateTime, materialEmoji } from "@/lib/format";
import { Emoji } from "@/app/Emoji";
import { PageHeader } from "../_components/PageHeader";
import { LoadError } from "../_components/LoadError";

export const dynamic = "force-dynamic";

/**
 * The rate table a payout resolves against.
 *
 * Without a rate here, `POST /payouts` has nothing to compute an amount from
 * and refuses the request — so this page has to exist before payouts can flow
 * at all. A rate can be global (no hub) or scoped to one hub, which the
 * payout service resolves as: most specific hub match wins, and within that,
 * the latest `effectiveFrom` at or before now wins.
 */

async function addRate(formData: FormData) {
  "use server";

  const materialCode = String(formData.get("materialCode") ?? "").trim();
  const hubId = String(formData.get("hubId") ?? "").trim();
  const ratePerKg = Number(formData.get("ratePerKg"));
  const effectiveFrom = String(formData.get("effectiveFrom") ?? "").trim();

  try {
    await api.createMaterialRate({
      materialCode,
      ...(hubId ? { hubId } : {}),
      ratePerKg,
      ...(effectiveFrom ? { effectiveFrom: new Date(effectiveFrom).toISOString() } : {}),
    });
  } catch (error) {
    redirect(`/material-rates?error=${encodeURIComponent(messageOf(error))}`);
  }

  revalidatePath("/material-rates");
  redirect("/material-rates?added=true");
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail ?? `Request failed (${error.status}).`;
  }
  return "The backend did not respond, so nothing was changed.";
}

export default async function MaterialRatesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; added?: string }>;
}) {
  const { error, added } = await searchParams;

  let rates: MaterialRate[];
  let materials: { code: string; name: string }[];
  let hubs: { id: string; code: string; name: string }[];
  let viewer: CurrentUser | null = null;
  try {
    [rates, materials, hubs, viewer] = await Promise.all([
      api.listMaterialRates(),
      api.materials(),
      api.hubs(),
      api.me().catch(() => null),
    ]);
  } catch {
    return (
      <main>
        <PageHeader eyebrow="Collector pricing" title="Material rates" />
        <LoadError error={error} resource="material rates" />
      </main>
    );
  }

  if (!viewer) {
    return (
      <main>
        <PageHeader eyebrow="Collector pricing" title="Material rates" />
        <p className="error">
          Not signed in. <Link href="/login">Sign in</Link> to see material rates.
        </p>
      </main>
    );
  }

  // GET is open to admin and operator; only admin can set a rate — matching
  // what the backend enforces on POST /material-rates.
  const canView = viewer.role === "admin" || viewer.role === "operator";
  const canCreate = viewer.role === "admin";

  if (!canView) {
    return (
      <main>
        <PageHeader eyebrow="Collector pricing" title="Material rates" />
        <p className="error">Viewing material rates requires an admin or operator account.</p>
      </main>
    );
  }

  const hubNameById = new Map(hubs.map((h) => [h.id, `${h.name} (${h.code})`]));

  return (
    <main>
      <PageHeader eyebrow="Collector pricing" title="Material rates" />
      <p className="page-intro">
          A rate is per kg, per material, optionally overridden per hub. A payout looks up the
          most specific rate that applies (hub-specific over global default, most recent{" "}
          <code>effectiveFrom</code> at or before now). It never takes a manual amount per item.
        </p>

      {error ? <p className="error">{decodeURIComponent(error)}</p> : null}
      {added ? <p className="note">Rate added.</p> : null}

      {canCreate ? null : (
        <p className="note">Read-only: setting a rate requires an administrator account.</p>
      )}

      <h2>Current rates</h2>
      {rates.length === 0 ? (
        <p className="empty">
          No rates configured yet. Payouts cannot be computed until at least one is set.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Material</th>
                <th>Hub</th>
                <th className="num">Rate / kg</th>
                <th>Effective from</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.id}>
                  <td className="hash">
                    <Emoji>{materialEmoji(r.materialCode)}</Emoji> {r.materialCode}
                  </td>
                  <td>
                    {r.hubId ? (
                      (hubNameById.get(r.hubId) ?? r.hubId.slice(0, 8))
                    ) : (
                      <span className="pill" data-tone="neutral">
                        global default
                      </span>
                    )}
                  </td>
                  <td className="num">{formatCurrency(r.ratePerKg)}</td>
                  <td className="meta">{formatDateTime(r.effectiveFrom)}</td>
                  <td className="meta">{formatDateTime(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canCreate ? (
        <>
          <h2>Add a rate</h2>
          <form action={addRate} className="confirm-body">
            <label htmlFor="materialCode">
              Material
              <select id="materialCode" name="materialCode" required defaultValue="">
                <option value="" disabled>
                  Select a material
                </option>
                {materials.map((m) => (
                  <option key={m.code} value={m.code}>
                    {materialEmoji(m.code)} {m.name} ({m.code})
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="hubId">
              Hub override (optional, leave blank for the global default)
              <select id="hubId" name="hubId" defaultValue="">
                <option value="">Global default (all hubs)</option>
                {hubs.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name} ({h.code})
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="ratePerKg">
              Rate per kg
              <input
                id="ratePerKg"
                name="ratePerKg"
                type="number"
                step="0.01"
                min="0"
                required
                placeholder="150.00"
              />
            </label>
            <label htmlFor="effectiveFrom">
              Effective from (optional, defaults to now)
              <input id="effectiveFrom" name="effectiveFrom" type="datetime-local" />
            </label>
            <div className="actions">
              <button className="btn" data-variant="primary" type="submit">
                Add rate
              </button>
            </div>
          </form>
        </>
      ) : null}
    </main>
  );
}
