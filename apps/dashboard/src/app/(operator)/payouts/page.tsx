import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ApiError, type CurrentUser, type Payout } from "@/lib/api";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { PageHeader } from "../_components/PageHeader";
import { LoadError } from "../_components/LoadError";

export const dynamic = "force-dynamic";

/**
 * Turning verified re-weighs into payment runs.
 *
 * A payout covers one or more `EventReweigh` rows for a single collector — the
 * backend resolves the amount per item from the material rate table, so this
 * form only has to say *who* and *which reweighs*, not how much. There is no
 * multi-select UI elsewhere in this dashboard to reuse, so eligible reweigh
 * ids are entered as a comma-separated list, matching how `examples` works on
 * the materials page.
 */

async function createPayoutAction(formData: FormData) {
  "use server";

  const collectorId = String(formData.get("collectorId") ?? "").trim();
  const method = String(formData.get("method") ?? "").trim();
  const eventReweighIds = String(formData.get("eventReweighIds") ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  try {
    await api.createPayout({ collectorId, eventReweighIds, method });
  } catch (error) {
    redirect(`/payouts?error=${encodeURIComponent(messageOf(error))}`);
  }

  revalidatePath("/payouts");
  redirect("/payouts?created=true");
}

async function markPaidAction(formData: FormData) {
  "use server";

  const id = String(formData.get("id") ?? "");
  const payoutRef = String(formData.get("payoutRef") ?? "").trim();

  try {
    await api.markPayoutPaid(id, payoutRef ? { payoutRef } : undefined);
  } catch (error) {
    redirect(`/payouts?error=${encodeURIComponent(messageOf(error))}`);
  }

  revalidatePath("/payouts");
  redirect("/payouts?paid=true");
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail ?? `Request failed (${error.status}).`;
  }
  return "The backend did not respond, so nothing was changed.";
}

export default async function PayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string; paid?: string }>;
}) {
  const { error, created, paid } = await searchParams;

  let payouts: Payout[];
  let collectors: { id: string; name: string }[];
  let viewer: CurrentUser | null = null;
  try {
    [payouts, collectors, viewer] = await Promise.all([
      api.listPayouts(),
      api.collectors(),
      api.me().catch(() => null),
    ]);
  } catch (err) {
    return (
      <main>
        <PageHeader eyebrow="Collector payments" title="Payouts" />
        <LoadError error={err} resource="payouts" />
      </main>
    );
  }

  if (!viewer) {
    return (
      <main>
        <PageHeader eyebrow="Collector payments" title="Payouts" />
        <p className="error">
          Not signed in. <Link href="/login">Sign in</Link> to see payouts.
        </p>
      </main>
    );
  }

  // Auditors can read this page (they are one of the three roles on both list
  // endpoints) but only admin/operator can create a payout or mark one paid,
  // matching what the backend enforces.
  const canEdit = viewer.role === "admin" || viewer.role === "operator";
  const collectorNameById = new Map(collectors.map((c) => [c.id, c.name]));

  const pending = payouts.filter((p) => p.status === "pending");
  const totalPending = pending.reduce((sum, p) => sum + Number(p.amount), 0);

  return (
    <main>
      <PageHeader eyebrow="Collector payments" title="Payouts" />

      {error ? <p className="error">{decodeURIComponent(error)}</p> : null}
      {created ? <p className="note">Payout created.</p> : null}
      {paid ? <p className="note">Payout marked paid.</p> : null}

      <dl className="stats">
        <div className="stat">
          <dt>Payouts</dt>
          <dd>{payouts.length}</dd>
        </div>
        <div className="stat">
          <dt>Pending</dt>
          <dd>{pending.length}</dd>
        </div>
        <div className="stat">
          <dt>Pending total</dt>
          <dd style={{ fontSize: "1.0625rem" }}>{formatCurrency(totalPending)}</dd>
        </div>
      </dl>

      {canEdit ? null : (
        <p className="note">Read-only: creating or marking a payout requires an operator account.</p>
      )}

      <h2>All payouts</h2>
      {payouts.length === 0 ? (
        <p className="empty">No payouts recorded yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Collector</th>
                <th className="num">Amount</th>
                <th>Method</th>
                <th>Status</th>
                <th>Reference</th>
                <th>Created</th>
                <th>Paid</th>
                {canEdit ? <th className="no-print">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id}>
                  <td>{collectorNameById.get(p.collectorId) ?? p.collectorId.slice(0, 8)}</td>
                  <td className="num">{formatCurrency(p.amount, p.currency)}</td>
                  <td>{p.method}</td>
                  <td>
                    <span
                      className="pill"
                      data-tone={
                        p.status === "paid"
                          ? "verified"
                          : p.status === "failed"
                            ? "broken"
                            : "pending"
                      }
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="hash">{p.payoutRef ?? "—"}</td>
                  <td className="meta">{formatDateTime(p.createdAt)}</td>
                  <td className="meta">{formatDateTime(p.paidAt)}</td>
                  {canEdit ? (
                    <td className="no-print">
                      {p.status === "pending" ? (
                        <details className="confirm">
                          <summary className="btn">Mark paid</summary>
                          <form action={markPaidAction} className="confirm-body">
                            <input type="hidden" name="id" value={p.id} />
                            <label htmlFor={`ref-${p.id}`}>
                              Payout reference (optional) — receipt or transfer id
                              <input id={`ref-${p.id}`} name="payoutRef" maxLength={200} />
                            </label>
                            <div className="actions">
                              <button className="btn" data-variant="primary" type="submit">
                                Confirm paid
                              </button>
                            </div>
                          </form>
                        </details>
                      ) : (
                        "—"
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit ? (
        <>
          <h2>Create a payout</h2>
          <p className="note">
            Covers one or more <Link href="/reweigh">recorded reweighs</Link> for a single
            collector. Each reweigh must belong to that collector, not already be attached to
            another payout, and a rate must exist for its material — otherwise the request is
            refused and the reason is shown below.
          </p>
          <form action={createPayoutAction} className="confirm-body">
            <label htmlFor="collectorId">
              Collector
              <select id="collectorId" name="collectorId" required defaultValue="">
                <option value="" disabled>
                  Select a collector
                </option>
                {collectors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="eventReweighIds">
              Reweigh ids — comma or space separated
              <input
                id="eventReweighIds"
                name="eventReweighIds"
                required
                placeholder="00000000-…, 11111111-…"
              />
            </label>
            <label htmlFor="method">
              Method
              <input id="method" name="method" required maxLength={50} placeholder="cash" />
            </label>
            <div className="actions">
              <button className="btn" data-variant="primary" type="submit">
                Create payout
              </button>
            </div>
          </form>
        </>
      ) : null}
    </main>
  );
}
