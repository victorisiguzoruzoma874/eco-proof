import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requesterApi, ApiError, type Requester, type WalletView } from "@/lib/api";
import { formatDateTime, formatNaira } from "@/lib/format";
import { ScanButton } from "./ScanButton";

export const dynamic = "force-dynamic";

/**
 * A requester's waste-credit wallet: balance, ledger, the "redeem a code"
 * form, and a cash-out (withdrawal) request form. Balance is never stored —
 * the backend computes it as `SUM(wallet_transactions.amountCredits)` on
 * every read (see `WasteWalletEntity`'s doc comment), so this page always
 * shows the true current figure with no separate reconciliation step.
 *
 * Redemption-by-code is manual-entry only, same as the reweigh page's
 * lookup-code flow — a camera scanner is a fast-follow, not needed for the
 * code printed under the QR to work today.
 *
 * The redemption catalog used to live inline here but now has its own route
 * (`/requester/rewards`, see that page's doc comment) — this page only links
 * to it, so there is a single source of truth for catalog browsing and
 * `redeemItemAction`.
 *
 * 1 credit = ₦1 is the product decision behind every "(₦…)" shown here — see
 * the wallet-workflow plan's "credit value and spending" addendum.
 */

async function redeemAction(formData: FormData) {
  "use server";

  const redemptionCode = String(formData.get("redemptionCode") ?? "").trim();

  try {
    await requesterApi.redeemCode(redemptionCode);
  } catch (error) {
    redirect(`/requester/wallet?error=${encodeURIComponent(messageOf(error))}`);
  }

  revalidatePath("/requester/wallet");
  redirect("/requester/wallet?redeemed=true");
}

/**
 * A debit is recorded only once an operator confirms the money actually
 * moved (`POST /wallet/withdrawals/:id/mark-paid`) — this call only puts the
 * amount on hold as `"pending"`. See `WithdrawalRequestEntity`'s doc comment
 * in the backend for why: recording the debit here would risk a wallet
 * showing money gone that the requester never actually received, if the
 * manual payout later falls through.
 */
async function withdrawAction(formData: FormData) {
  "use server";

  const amountCredits = Number(formData.get("amountCredits"));

  try {
    await requesterApi.withdraw(amountCredits);
  } catch (error) {
    redirect(`/requester/wallet?error=${encodeURIComponent(messageOf(error))}`);
  }

  revalidatePath("/requester/wallet");
  redirect("/requester/wallet?withdrawn=true");
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    // The backend's own message is the point: "this code is 'redeemed', not
    // ready for redemption" or "no request matches this redemption code"
    // tells the requester exactly what happened, a generic failure would not.
    return error.detail ?? `Request failed (${error.status}).`;
  }
  return "Could not reach the backend.";
}

export default async function RequesterWalletPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    redeemed?: string;
    withdrawn?: string;
    itemRedeemed?: string;
  }>;
}) {
  const { error, redeemed, withdrawn, itemRedeemed } = await searchParams;

  let viewer: Requester;
  try {
    viewer = await requesterApi.me();
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      redirect("/requester/login");
    }
    return (
      <div>
        <p className="rq-eyebrow">ProofChain wallet</p>
        <h1>Wallet</h1>
        <p className="rq-error">Could not reach the backend.</p>
      </div>
    );
  }

  let wallet: WalletView;
  try {
    wallet = await requesterApi.getWallet();
  } catch {
    return (
      <div>
        <p className="rq-eyebrow">ProofChain wallet</p>
        <h1>Wallet</h1>
        <p className="rq-error">Could not reach the backend.</p>
      </div>
    );
  }

  return (
    <div>
      <p style={{ margin: "1rem 0 0", color: "var(--rq-text-faint)", fontSize: "0.8125rem" }}>
        {viewer.email}
      </p>

      <section className="rq-hero">
        <p className="rq-eyebrow">ProofChain wallet</p>
        <p className="rq-balance">{wallet.balanceCredits.toLocaleString()} credits</p>
        <p>({formatNaira(wallet.balanceCredits)})</p>
      </section>

      <div className="rq-row" style={{ margin: "1.25rem 0" }}>
        <a className="rq-btn" data-variant="primary" href="#withdraw" style={{ flex: 1 }}>
          Cash out
        </a>
        <Link className="rq-btn" data-variant="secondary" href="/requester/rewards" style={{ flex: 1 }}>
          Spend on rewards
        </Link>
      </div>

      {error ? <p className="rq-error">{decodeURIComponent(error)}</p> : null}
      {redeemed ? (
        <p className="rq-note">
          <strong>Credited!</strong> That code&rsquo;s hub-verified weight has been added to your
          balance above.
        </p>
      ) : null}
      {withdrawn ? <p className="rq-note">Withdrawal requested — it is held pending payout below.</p> : null}
      {itemRedeemed ? <p className="rq-note">Item redeemed — awaiting fulfillment.</p> : null}

      <div className="rq-grid">
      <section className="rq-section">
        <h2>Redeem a code</h2>
        <p style={{ color: "var(--rq-text-soft)", marginBottom: "0.75rem" }}>
          Scan the QR your collector shows you at the door — or type the code printed under it —
          to credit the weight they collected to your wallet. Each code redeems once.
        </p>
        {/* Renders nothing where BarcodeDetector is unavailable, leaving the
            typed-code path below as the only one. See ScanButton. */}
        <ScanButton />
        <form action={redeemAction}>
          <label className="rq-field" htmlFor="redemptionCode">
            Redemption code
            {/* `rq-code-input` sets the mono face and the casing — see its rule
                in requester.css for why a code is typed in mono and a label is
                not. */}
            <input
              id="redemptionCode"
              name="redemptionCode"
              className="rq-code-input"
              required
              maxLength={16}
              placeholder="7K9M2QRT"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <button className="rq-btn" data-variant="primary" type="submit">
            Redeem
          </button>
        </form>
      </section>

      <section className="rq-section" id="withdraw">
        <h2>Request a withdrawal</h2>
        <p style={{ color: "var(--rq-text-soft)", marginBottom: "0.75rem" }}>
          1 credit = ₦1. A withdrawal is held as <code>pending</code> until an operator confirms
          the payout has actually been sent — it is not deducted from your balance above until
          then, but it is no longer available to request again while held.
        </p>
        <form action={withdrawAction}>
          <label className="rq-field" htmlFor="amountCredits">
            Amount (credits)
            <input
              id="amountCredits"
              name="amountCredits"
              type="number"
              step="0.001"
              min="0.001"
              required
              placeholder="e.g. 50"
            />
          </label>
          <button className="rq-btn" data-variant="primary" type="submit">
            Request withdrawal
          </button>
        </form>

        {wallet.pendingWithdrawals.length > 0 ? (
          <div style={{ marginTop: "1.25rem", overflowX: "auto" }}>
            <table className="rq-table">
              <thead>
                <tr>
                  <th className="num">Amount</th>
                  <th>Status</th>
                  <th>Requested</th>
                </tr>
              </thead>
              <tbody>
                {wallet.pendingWithdrawals.map((w) => (
                  <tr key={w.id}>
                    <td className="num">
                      {Number(w.amountCredits).toLocaleString()} ({formatNaira(w.amountCredits)})
                    </td>
                    <td>
                      <span className="rq-pill" data-tone="neutral">
                        {w.status}
                      </span>
                    </td>
                    <td>{formatDateTime(w.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
      </div>

      <section className="rq-section">
        <h2>Transaction history</h2>
        {wallet.transactions.length === 0 ? (
          <p style={{ color: "var(--rq-text-faint)" }}>
            No transactions yet. Redeem a code to earn your first credits.
          </p>
        ) : (
          <div>
            {wallet.transactions.map((t) => (
              <div className="rq-ledger-row" key={t.id}>
                <div>
                  <div>{t.description ?? (t.type === "credit" ? "Credit" : "Debit")}</div>
                  <div className="rq-ledger-meta">{formatDateTime(t.createdAt)}</div>
                </div>
                <div className="rq-amount" data-tone={t.type === "credit" ? "in" : "out"}>
                  {t.type === "debit" ? "−" : "+"}
                  {Number(t.amountCredits).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
