import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import {
  api,
  requesterApi,
  ApiError,
  type CollectionRequest,
  type CreditRate,
  type HubDirectoryEntry,
  type Requester,
  type WalletView,
} from "@/lib/api";
import { formatDateTime, formatKg, formatNaira, materialEmoji } from "@/lib/format";
import { Emoji } from "@/app/Emoji";
import { currentDefaultRates } from "@/lib/rates";
import { ScanButton } from "../wallet/ScanButton";

export const dynamic = "force-dynamic";

/**
 * A requester's home: their own requests, their wallet balance at a glance,
 * and today's credit rates — plus a way in to `/requester/request`, the
 * dedicated (richer, stepped) pickup-booking flow built elsewhere. This page
 * itself no longer takes the booking form; it only launches it. Reachable
 * only with a valid `proofchain_requester_token` cookie — this is the
 * requester trust boundary, never the operator one used elsewhere in this
 * dashboard (see `REQUESTER_TOKEN_COOKIE`'s doc comment in `lib/api.ts`).
 *
 * A "collected" request already has its redemption code (issued when an
 * operator links it to a hub-verified weigh-in); the QR for it is rendered
 * here too — the requester's own copy of what an operator might also hand
 * them on paper via `/requests`.
 */

/**
 * Claim a code from the scan section: a walk-in weigh-in's QR, or a pickup's.
 *
 * The same `POST /wallet/redeem` the wallet page uses; the backend tells the two
 * kinds of code apart. Lands back on this page with what was credited, so the
 * person at the scale sees the result where they scanned, not on another screen.
 */
async function claimAction(formData: FormData) {
  "use server";

  const code = String(formData.get("code") ?? "").trim();
  if (!code) redirect("/requester/dashboard?claimError=" + encodeURIComponent("Scan the QR or type its code first.") + "#scan");

  let credited: { amount: number; description: string; balance: number };
  try {
    const result = await requesterApi.redeemCode(code);
    credited = {
      amount: Number(result.transaction.amountCredits),
      description: result.transaction.description ?? "",
      balance: result.balanceCredits,
    };
  } catch (error) {
    const message =
      error instanceof ApiError
        ? (error.detail ?? `Request failed (${error.status}).`)
        : "Could not reach the backend. Nothing was credited; try again.";
    redirect(`/requester/dashboard?claimError=${encodeURIComponent(message)}#scan`);
  }

  revalidatePath("/requester/dashboard");
  revalidatePath("/requester/wallet");
  const params = new URLSearchParams({
    credited: String(credited.amount),
    what: credited.description,
    balance: String(credited.balance),
  });
  redirect(`/requester/dashboard?${params.toString()}#scan`);
}

function statusTone(status: CollectionRequest["status"]): "neutral" | "bad" | undefined {
  if (status === "redeemed") return undefined; // default pill tone = accent green, reads as "done"
  if (status === "cancelled") return "bad";
  return "neutral"; // requested / assigned / collected — still in flight
}

export default async function RequesterDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ credited?: string; what?: string; balance?: string; claimError?: string }>;
}) {
  const { credited, what, balance, claimError } = await searchParams;

  let viewer: Requester;
  try {
    viewer = await requesterApi.me();
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      redirect("/requester/login");
    }
    return (
      <div className="rq-card">
        <p className="rq-error">Could not reach the backend.</p>
      </div>
    );
  }

  let requests: CollectionRequest[];
  let hubs: HubDirectoryEntry[];
  let wallet: WalletView;
  let creditRates: CreditRate[];
  try {
    [requests, hubs, wallet, creditRates] = await Promise.all([
      requesterApi.myRequests(),
      api.hubDirectory(),
      requesterApi.getWallet(),
      api.listCreditRates(),
    ]);
  } catch {
    return (
      <div className="rq-card">
        <p className="rq-error">Could not reach the backend.</p>
      </div>
    );
  }

  const hubNameById = new Map(hubs.map((h) => [h.id, `${h.name} (${h.code})`]));

  // One row per material: the rate in effect now. The API returns the whole
  // history, so filtering alone listed every material once per rate change.
  const defaultRates = currentDefaultRates(creditRates);

  // Rendered server side via the `qrcode` package's toDataURL, embedded as a
  // data: URI — no client-side QR library, matching this dashboard's
  // server-component-first approach (see the proof page's printed lookup
  // code for the same "legible fallback" reasoning, one QR per collected
  // request's redemption code).
  const collectedWithQr = await Promise.all(
    requests
      .filter((r) => r.status === "collected" && r.redemptionCode)
      .map(async (r) => ({ request: r, dataUrl: await QRCode.toDataURL(r.redemptionCode as string) })),
  );

  return (
    <>
      <header style={{ padding: "1.5rem 0 1rem" }}>
        <p className="rq-eyebrow">Good day</p>
        {/* The screen title. Styled by `.rq-title` rather than inline so it
            takes the display serif with every other page title in the product. */}
        <h1 className="rq-title">
          {viewer.name || viewer.email}
        </h1>
      </header>

      {/*
        Scan to get credited. First on the page because it is the one thing
        done with someone waiting: the collector is holding their phone out.
      */}
      <section className="rq-claim" id="scan" aria-labelledby="scan-title">
        <div className="rq-claim-body">
          <div>
            <p className="rq-eyebrow">Dropped off at a collector?</p>
            <h2 id="scan-title">Scan to get credited</h2>
          </div>
          <p className="rq-claim-lede">
            After your material is weighed, the collector shows a QR code on their phone. Scan it
            here and the weight goes straight into your wallet as credits. Each code can be claimed
            once.
          </p>

          {credited ? (
            <div className="rq-credited" role="status">
              <strong>+{Number(credited).toLocaleString()} credits</strong>
              {what ? <p>{what}</p> : null}
              {balance ? (
                <p>
                  New balance: {Number(balance).toLocaleString()} credits ({formatNaira(Number(balance))})
                </p>
              ) : null}
            </div>
          ) : null}
          {claimError ? (
            <p className="rq-claim-error" role="alert">
              {claimError}
            </p>
          ) : null}

          {/* Fills #claimCode and submits the form below through its own action. */}
          <ScanButton targetInputId="claimCode" autoSubmit primary label="Scan QR code" />

          <form action={claimAction} className="rq-claim-form">
            <label htmlFor="claimCode">
              Or type the code under the QR
              <input
                id="claimCode"
                name="code"
                required
                maxLength={16}
                placeholder="K7M2Q-RT9XA"
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </label>
            <button className="rq-btn" data-variant="on-dark" type="submit">
              Claim
            </button>
          </form>
        </div>

        {/* Decorative — the collector-and-bin loop just illustrates the flow
            described in the copy, so it's hidden from assistive tech. */}
        <img
          className="rq-claim-media"
          src="/illustrations/collector-scan.gif"
          alt=""
          aria-hidden="true"
          width={160}
          height={160}
        />
      </section>

      <div className="rq-grid">
        <div className="rq-card" style={{ marginBottom: 0 }}>
          <p style={{ margin: "0 0 0.75rem", fontWeight: 700 }}>
            Got material ready? Book a pickup.
          </p>
          <Link className="rq-btn" data-variant="primary" href="/requester/request">
            Request a pickup
          </Link>
        </div>

        <Link href="/requester/wallet" className="rq-card rq-row" style={{ marginBottom: 0 }}>
          <span className="rq-eyebrow" style={{ margin: 0 }}>
            Wallet balance
          </span>
          <strong style={{ fontSize: "1.125rem", fontVariantNumeric: "tabular-nums" }}>
            {wallet.balanceCredits.toLocaleString()} credits ({formatNaira(wallet.balanceCredits)})
          </strong>
        </Link>
      </div>

      {collectedWithQr.length > 0 ? (
        <section className="rq-section">
          <h2>Ready to redeem</h2>
          <p className="rq-note">
            Collected and hub-verified. Redeem the code below for waste credits from{" "}
            <Link href="/requester/wallet">your wallet</Link>. Scan the QR or type the code
            printed underneath.
          </p>
          <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(13rem, 1fr))" }}>
            {collectedWithQr.map(({ request, dataUrl }) => (
              <div key={request.id} className="rq-card" style={{ textAlign: "center", marginBottom: 0 }}>
                <img
                  src={dataUrl}
                  alt={`QR code for redemption code ${request.redemptionCode}`}
                  width={160}
                  height={160}
                  style={{ maxWidth: "100%", height: "auto" }}
                />
                <p style={{ fontSize: "1.125rem", fontWeight: 800, margin: "0.75rem 0 0" }}>
                  {request.redemptionCode}
                </p>
                <p className="rq-note" style={{ margin: "0.5rem 0 0" }}>
                  <Emoji>{materialEmoji(request.material)}</Emoji> {request.material} ·{" "}
                  {hubNameById.get(request.hubId) ?? ""}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/*
       * Rates and requests stack in reading order, not side by side: a
       * requester checks the rate for a material, then looks below it for
       * where their own pickups stand. `.rq-grid` (used above, and on
       * history/wallet) is the shared two-up layout for pairs of blocks
       * that are independent of each other; these two aren't, so they get
       * a plain stack instead of that class.
       */}
      <div>
        <section className="rq-section">
          <h2>Today&rsquo;s rates</h2>
          {defaultRates.length === 0 ? (
            <p className="rq-note">No published rates yet.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="rq-table">
                <thead>
                  <tr>
                    <th>Material</th>
                    <th className="num">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {defaultRates.map((rate) => (
                    <tr key={rate.id}>
                      <td>
                        <Emoji>{materialEmoji(rate.materialCode)}</Emoji> {rate.materialCode}
                      </td>
                      <td className="num">
                        {Number(rate.creditsPerKg).toLocaleString()} credits/kg (
                        {formatNaira(rate.creditsPerKg)}/kg)
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rq-section">
          <h2>Your requests</h2>
        {requests.length === 0 ? (
          <p className="rq-note">No pickups requested yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="rq-table">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Hub</th>
                  <th className="num">Est. weight</th>
                  <th>Status</th>
                  <th>Requested</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Emoji>{materialEmoji(r.material)}</Emoji> {r.material}
                    </td>
                    <td>{hubNameById.get(r.hubId) ?? r.hubId.slice(0, 8)}</td>
                    <td className="num">
                      {r.estimatedWeightKg == null ? "—" : `${formatKg(r.estimatedWeightKg)} kg`}
                    </td>
                    <td>
                      <span className="rq-pill" data-tone={statusTone(r.status)}>
                        {r.status}
                      </span>
                    </td>
                    <td>{formatDateTime(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </section>
      </div>
    </>
  );
}
