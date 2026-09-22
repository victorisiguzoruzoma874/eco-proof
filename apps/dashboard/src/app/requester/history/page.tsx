import { redirect } from "next/navigation";
import { requesterApi, ApiError, type CollectionRequest, type WalletTransaction } from "@/lib/api";
import { formatDateTime, formatKg, formatNaira, materialEmoji } from "@/lib/format";
import { Emoji } from "@/app/Emoji";

export const dynamic = "force-dynamic";

/**
 * The requester's activity screen: their pickup request history and their
 * wallet transaction ledger, combined into one view (the "Activity" tab in
 * `RequesterTabs`). Every figure here is a direct read or a plain sum/count
 * of real API data — no derived "impact" numbers (e.g. CO2e avoided) are
 * shown, since this system has no conversion factor for that and inventing
 * one would put a fabricated figure in front of a real user.
 */

function requestStatusTone(status: CollectionRequest["status"]): "bad" | "neutral" | undefined {
  if (status === "cancelled") return "bad";
  // "redeemed" is the successful end state — the default (unstyled) pill
  // already reads as a positive accent color, so no tone override is needed.
  if (status === "redeemed") return undefined;
  return "neutral";
}

function byCreatedAtDesc(a: { createdAt: string }, b: { createdAt: string }): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

export default async function RequesterHistoryPage() {
  try {
    await requesterApi.me();
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      redirect("/requester/login");
    }
    return (
      <div>
        <h1>Activity</h1>
        <p className="rq-error">Could not reach the backend.</p>
      </div>
    );
  }

  let requests: CollectionRequest[];
  let transactions: WalletTransaction[];
  try {
    const [reqs, wallet] = await Promise.all([requesterApi.myRequests(), requesterApi.getWallet()]);
    requests = reqs;
    transactions = wallet.transactions;
  } catch {
    return (
      <div>
        <h1>Activity</h1>
        <p className="rq-error">Could not reach the backend.</p>
      </div>
    );
  }

  // Sorted client-side rather than trusting API order, newest first.
  const sortedRequests = [...requests].sort(byCreatedAtDesc);
  const sortedTransactions = [...transactions].sort(byCreatedAtDesc);

  const creditsEarned = transactions
    .filter((t) => t.type === "credit")
    .reduce((sum, t) => sum + Number(t.amountCredits), 0);

  const redeemedCount = requests.filter((r) => r.status === "redeemed").length;

  return (
    <div>
      <h1 style={{ margin: "0 0 0.25rem" }}>Activity</h1>
      <p style={{ color: "var(--rq-text-soft)", margin: "0 0 1rem" }}>
        Every pickup and wallet transaction
      </p>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem" }}>
        <div className="rq-stat" style={{ flex: 1 }}>
          <b>
            {creditsEarned.toLocaleString()} credits ({formatNaira(creditsEarned)})
          </b>
          <span>Lifetime credits earned</span>
        </div>
        <div className="rq-stat" style={{ flex: 1 }}>
          <b>{requests.length.toLocaleString()}</b>
          <span>Total pickups</span>
        </div>
        <div className="rq-stat" style={{ flex: 1 }}>
          <b>{redeemedCount.toLocaleString()}</b>
          <span>Redeemed pickups</span>
        </div>
      </div>

      <div className="rq-grid">
        <div>
      <h2>Your pickups</h2>
      {sortedRequests.length === 0 ? (
        <p style={{ color: "var(--rq-text-soft)" }}>No pickups yet.</p>
      ) : (
        <div className="rq-card" style={{ overflowX: "auto" }}>
          <table className="rq-table">
            <thead>
              <tr>
                <th>Material</th>
                <th>Status</th>
                <th className="num">Est. weight</th>
                <th>Requested</th>
              </tr>
            </thead>
            <tbody>
              {sortedRequests.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Emoji>{materialEmoji(r.material)}</Emoji> {r.material}
                  </td>
                  <td>
                    <span className="rq-pill" data-tone={requestStatusTone(r.status)}>
                      {r.status}
                    </span>
                  </td>
                  <td className="num">
                    {r.estimatedWeightKg == null ? "—" : `${formatKg(r.estimatedWeightKg)} kg`}
                  </td>
                  <td>{formatDateTime(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
        </div>

        <div>
      <h2>Wallet transactions</h2>
      {sortedTransactions.length === 0 ? (
        <p style={{ color: "var(--rq-text-soft)" }}>No transactions yet.</p>
      ) : (
        <div className="rq-card" style={{ overflowX: "auto" }}>
          <table className="rq-table">
            <thead>
              <tr>
                <th>Type</th>
                <th className="num">Amount</th>
                <th>Description</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {sortedTransactions.map((t) => (
                <tr key={t.id}>
                  <td>
                    <span
                      style={{
                        fontWeight: 700,
                        color: t.type === "credit" ? "var(--rq-accent-700)" : "var(--rq-text-soft)",
                      }}
                    >
                      {t.type}
                    </span>
                  </td>
                  <td className="num">
                    {t.type === "credit" ? "+" : "−"}
                    {Number(t.amountCredits).toLocaleString()} credits
                  </td>
                  <td>{t.description ?? "—"}</td>
                  <td>{formatDateTime(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
        </div>
      </div>
    </div>
  );
}
