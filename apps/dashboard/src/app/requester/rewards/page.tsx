import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { api, requesterApi, ApiError, type CatalogItem } from "@/lib/api";
import { formatNaira } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * The requester's redemption catalog, on its own route: browse listed items
 * and spend wallet credits on them. Split out of `requester/wallet/page.tsx`
 * (which still owns balance + ledger + the redeem-a-code / withdraw forms) so
 * that page doesn't have to carry the full catalog browsing experience too.
 *
 * Like the wallet page's version, a catalog redemption debits the wallet
 * immediately — the requester is exchanging credits for a listed item, not
 * asking the platform to move real money on their behalf, so there is no
 * reason to delay the ledger entry (see `CatalogRedemptionEntity`'s doc
 * comment).
 */

async function redeemItemAction(formData: FormData) {
  "use server";

  const itemId = String(formData.get("itemId") ?? "").trim();

  try {
    await requesterApi.redeemCatalogItem(itemId);
  } catch (error) {
    redirect(`/requester/rewards?error=${encodeURIComponent(messageOf(error))}`);
  }

  revalidatePath("/requester/rewards");
  revalidatePath("/requester/wallet");
  redirect("/requester/rewards?redeemed=true");
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    // The backend's own message is the point: "out of stock" or "insufficient
    // balance" tells the requester exactly what happened, a generic failure
    // would not.
    return error.detail ?? `Request failed (${error.status}).`;
  }
  return "Could not reach the backend.";
}

export default async function RequesterRewardsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; redeemed?: string }>;
}) {
  const { error, redeemed } = await searchParams;

  try {
    await requesterApi.me();
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      redirect("/requester/login");
    }
    return (
      <div>
        <p className="rq-eyebrow">Rewards</p>
        <h1>Spend your credits</h1>
        <p className="rq-error">Could not reach the backend.</p>
      </div>
    );
  }

  const [wallet, catalogItems] = await Promise.all([
    requesterApi.getWallet().catch(() => null),
    // The catalog is public (`GET /catalog-items`), so a failure here is
    // treated as "nothing to browse right now" rather than a page-wide error.
    api.catalogItems().catch(() => [] as CatalogItem[]),
  ]);

  const balanceCredits = wallet?.balanceCredits ?? 0;

  return (
    <div>
      <p className="rq-eyebrow">Rewards</p>
      <h1>Spend your credits</h1>
      <p className="rq-row">
        <span>
          Balance: {balanceCredits.toLocaleString()} credits ({formatNaira(balanceCredits)})
        </span>
        <Link href="/requester/wallet">&larr; Wallet</Link>
      </p>

      {error ? <p className="rq-error">{decodeURIComponent(error)}</p> : null}
      {redeemed ? <p className="rq-note">Item redeemed &mdash; awaiting fulfillment.</p> : null}

      {catalogItems.length === 0 ? (
        <p className="rq-note">Nothing in the catalog right now.</p>
      ) : (
        <div
          style={{
            display: "grid",
            gap: "1rem",
            gridTemplateColumns: "repeat(auto-fit, minmax(15rem, 1fr))",
          }}
        >
          {catalogItems.map((item) => {
            const outOfStock = item.stock !== null && item.stock <= 0;
            return (
              <div key={item.id} className="rq-card">
                <p className="rq-eyebrow">{item.category.toUpperCase()}</p>
                <h3 style={{ margin: "0 0 0.375rem", fontSize: "1.0625rem" }}>{item.name}</h3>
                {item.description ? (
                  <p className="rq-note" style={{ margin: "0 0 0.75rem" }}>
                    {item.description}
                  </p>
                ) : null}
                <p style={{ margin: "0 0 0.75rem", fontVariantNumeric: "tabular-nums" }}>
                  {Number(item.costCredits).toLocaleString()} credits ({formatNaira(item.costCredits)})
                  {item.stock !== null ? ` · ${item.stock} left` : ""}
                </p>
                <form action={redeemItemAction}>
                  <input type="hidden" name="itemId" value={item.id} />
                  <button className="rq-btn" data-variant="primary" type="submit" disabled={outOfStock}>
                    {outOfStock ? "Out of stock" : "Redeem"}
                  </button>
                </form>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
