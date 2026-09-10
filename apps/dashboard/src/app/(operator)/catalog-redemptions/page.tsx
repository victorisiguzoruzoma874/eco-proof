import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ApiError, type CatalogItem, type CatalogRedemption, type CurrentUser } from "@/lib/api";
import { formatDateTime, formatNaira } from "@/lib/format";
import { PageHeader } from "../_components/PageHeader";
import { LoadError } from "../_components/LoadError";

export const dynamic = "force-dynamic";

/**
 * The operational fulfillment queue for catalog redemptions — "send this
 * airtime / hand over this item" — same per-row-action shape as `/requests`.
 * The wallet debit already happened at redemption time (see
 * `CatalogRedemptionEntity`'s doc comment); this only tracks the hand-over,
 * walking `"pending_fulfillment" -> "fulfilled"`.
 *
 * Presentation follows the "colour-coded categories + status chips" direction:
 * category is the one thing an operator triages by (airtime is sent from a
 * phone, goods are handed over at a hub), so it is carried as a colour on every
 * row rather than as another word to read. Status stays a chip, because it is
 * the only field that changes as a result of what the operator does here.
 */

async function fulfillAction(formData: FormData) {
  "use server";

  const id = String(formData.get("id") ?? "");

  try {
    await api.fulfillCatalogRedemption(id);
  } catch (error) {
    redirect(`/catalog-redemptions?error=${encodeURIComponent(messageOf(error))}`);
  }

  revalidatePath("/catalog-redemptions");
  redirect("/catalog-redemptions?fulfilled=true");
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail ?? `Request failed (${error.status}).`;
  }
  return "The backend did not respond, so nothing was changed.";
}

/**
 * The only two values `CatalogRedemptionEntity.status` can hold — the column
 * defaults to `pending_fulfillment` and `CatalogService.fulfill` moves it to
 * `fulfilled`. There is no cancelled/failed state in this pass.
 */
const STATUSES = ["pending_fulfillment", "fulfilled"] as const;
type RedemptionStatus = (typeof STATUSES)[number];

const STATUS_LABEL: Record<RedemptionStatus, string> = {
  pending_fulfillment: "Queued",
  fulfilled: "Fulfilled",
};

/**
 * `CatalogItemEntity.category` is free text, not an enum (see its doc
 * comment), so this is a lookup with a fallback rather than an exhaustive
 * map: an operator-added category — or an item that has since disappeared
 * from `GET /catalog-items` — renders in neutral ink instead of crashing.
 */
const CATEGORY_COLOR: Record<string, string> = {
  airtime: "var(--category-airtime)",
  discount: "var(--category-discount)",
  goods: "var(--category-goods)",
};

function categoryColor(category: string | undefined): string {
  if (!category) return "var(--ink-faint)";
  return CATEGORY_COLOR[category.trim().toLowerCase()] ?? "var(--ink-faint)";
}

/*
 * Page-local CSS. Everything here is specific to this screen's layout, so it
 * stays out of `(operator)/globals.css` — but it is built only out of the
 * shared tokens and the shared keyframes (`row-in`, `bar-grow`) defined there,
 * so it moves with the palette and with the reduced-motion opt-out.
 *
 * The chips resolve amber/green through `--pending`/`--verified`, which are
 * exactly #a86a18 and #3c6b45 in light and brighten in dark — a hard-coded hex
 * would go muddy against the dark ground.
 */
const CSS = `
.rdmq-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.5rem 2.5rem;
}

.rdmq-tiles {
  display: flex;
  gap: 2.5rem;
  padding-bottom: 0.25rem;
}

.rdmq-tile-num {
  font-family: var(--mono);
  font-size: clamp(1.75rem, 1.4rem + 1.2vw, 2.25rem);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  line-height: 1;
  color: var(--ink);
}

.rdmq-tile-cap {
  font-family: var(--mono);
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--ink-faint);
  margin-top: 0.5rem;
  white-space: nowrap;
}

.rdmq-tile-bar {
  height: 3px;
  margin-top: 0.55rem;
  transform-origin: bottom;
  animation: bar-grow 620ms both cubic-bezier(0.2, 0.8, 0.2, 1);
}

.rdmq-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0 0 1.1rem;
}

.rdmq-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.4rem 0.95rem;
  border: 1px solid var(--rule);
  border-radius: 100px;
  background: var(--surface);
  color: var(--ink-soft);
  font-size: 0.8125rem;
  text-decoration: none;
  white-space: nowrap;
  transition:
    color 140ms ease,
    border-color 140ms ease,
    background-color 140ms ease;
}

.rdmq-tab:hover {
  color: var(--ink);
  border-color: var(--rule-strong);
}

.rdmq-tab-count {
  font-family: var(--mono);
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  color: var(--ink-faint);
}

.rdmq-tab[data-active="true"] {
  background: var(--ink);
  border-color: var(--ink);
  color: var(--paper);
}

.rdmq-tab[data-active="true"] .rdmq-tab-count {
  color: color-mix(in srgb, var(--paper) 68%, transparent);
}

.rdmq-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 1.35rem;
  margin: 0 0 1.1rem;
  font-family: var(--mono);
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--ink-faint);
}

.rdmq-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.rdmq-swatch {
  width: 9px;
  height: 9px;
  flex: none;
}

.rdmq-table thead th {
  font-family: var(--mono);
  font-size: 10.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--ink-soft);
  background: var(--surface);
  padding: 0.7rem 1rem;
  border-bottom: 1.5px solid var(--rule-strong);
}

.rdmq-table tbody tr {
  animation: row-in 380ms both cubic-bezier(0.22, 1, 0.36, 1);
}

.rdmq-item {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}

/* A vertical 3px stripe, not a dot: it reads as a colour band down the column
   when several rows share a category, which is exactly the scan an operator
   makes ("how much airtime is queued?"). */
.rdmq-cat-bar {
  width: 3px;
  height: 1.05em;
  flex: none;
  border-radius: 1px;
  align-self: center;
}

.rdmq-ref {
  font-family: var(--mono);
  font-size: 0.75rem;
  color: var(--ink-soft);
  white-space: nowrap;
}

.rdmq-chip {
  display: inline-block;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  padding: 5px 9px;
  border-radius: 100px;
  border: 1px solid;
  white-space: nowrap;
}

.rdmq-chip[data-status="pending_fulfillment"] {
  color: var(--pending);
  background: color-mix(in srgb, var(--pending) 12%, transparent);
  border-color: color-mix(in srgb, var(--pending) 42%, transparent);
}

.rdmq-chip[data-status="fulfilled"] {
  color: var(--verified);
  background: color-mix(in srgb, var(--verified) 12%, transparent);
  border-color: color-mix(in srgb, var(--verified) 42%, transparent);
}

.rdmq-sub {
  display: block;
  font-family: var(--mono);
  font-size: 0.6875rem;
  color: var(--ink-faint);
  margin-top: 0.3rem;
}

@media (prefers-reduced-motion: reduce) {
  .rdmq-tile-bar,
  .rdmq-table tbody tr {
    animation: none;
    transform: none;
  }

  .rdmq-tab {
    transition: none;
  }
}

@media print {
  .rdmq-tile-bar,
  .rdmq-table tbody tr {
    animation: none;
    transform: none;
  }
}
`;

export default async function CatalogRedemptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string; fulfilled?: string }>;
}) {
  const { status, error, fulfilled } = await searchParams;

  let redemptions: CatalogRedemption[];
  let items: CatalogItem[];
  let viewer: CurrentUser | null = null;
  try {
    /*
     * The whole queue is fetched unfiltered and narrowed here rather than via
     * `?status=` on the API call, because the tabs and the tiles have to state
     * counts for the statuses you are *not* looking at — a "Queued 4" tab that
     * read 0 whenever you were on the Fulfilled tab would be a lie. The filter
     * itself is still a URL param handled on the server (see `visible` below),
     * same as `/requests`; only where the narrowing happens moved.
     */
    [redemptions, items, viewer] = await Promise.all([
      api.listCatalogRedemptions(),
      api.catalogItems(),
      api.me().catch(() => null),
    ]);
  } catch {
    return (
      <main>
        <h1>Catalog redemptions</h1>
        <LoadError error={error} resource="catalog redemptions" />
      </main>
    );
  }

  if (!viewer) {
    return (
      <main>
        <h1>Catalog redemptions</h1>
        <p className="error">
          Not signed in. <Link href="/login">Sign in</Link> to see catalog redemptions.
        </p>
      </main>
    );
  }

  const canEdit = viewer.role === "admin" || viewer.role === "operator";
  const itemById = new Map(items.map((i) => [i.id, i]));

  const countByStatus: Record<RedemptionStatus, number> = {
    pending_fulfillment: redemptions.filter((r) => r.status === "pending_fulfillment").length,
    fulfilled: redemptions.filter((r) => r.status === "fulfilled").length,
  };
  const creditsSpent = redemptions.reduce((sum, r) => sum + Number(r.costCredits), 0);

  const activeStatus = STATUSES.find((s) => s === status);
  const visible = activeStatus ? redemptions.filter((r) => r.status === activeStatus) : redemptions;

  const tiles = [
    {
      value: countByStatus.pending_fulfillment,
      caption: "Queued",
      color: "var(--pending)",
      delay: "0.2s",
    },
    {
      value: countByStatus.fulfilled,
      caption: "Fulfilled",
      color: "var(--verified)",
      delay: "0.3s",
    },
    {
      value: creditsSpent.toLocaleString(undefined, { maximumFractionDigits: 0 }),
      caption: "Credits spent",
      color: "var(--accent)",
      delay: "0.4s",
    },
  ];

  return (
    <main>
      <style precedence="medium" href="catalog-redemptions" dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="rdmq-head">
        <PageHeader eyebrow="Fulfilment queue" title="Catalog redemptions" />
        <div className="rdmq-tiles">
          {tiles.map((tile) => (
            <div key={tile.caption}>
              <div className="rdmq-tile-num">{tile.value}</div>
              <div className="rdmq-tile-cap">{tile.caption}</div>
              <div
                className="rdmq-tile-bar"
                style={{ background: tile.color, animationDelay: tile.delay }}
              />
            </div>
          ))}
        </div>
      </div>

      <p className="page-intro">
        Every catalog redemption a requester has made from{" "}
        <Link href="/catalog-items">Catalog items</Link>. The wallet debit already happened at
        redemption time — mark fulfilled once the item has actually been handed over or sent.
      </p>

      {error ? <p className="error">{decodeURIComponent(error)}</p> : null}
      {fulfilled ? <p className="note">Marked fulfilled.</p> : null}

      {canEdit ? null : (
        <p className="note">Read-only: marking fulfilled requires an operator account.</p>
      )}

      <div className="rdmq-tabs no-print">
        {STATUSES.map((s) => (
          <Link
            key={s}
            className="rdmq-tab"
            data-active={activeStatus === s}
            href={`/catalog-redemptions?status=${s}`}
          >
            {STATUS_LABEL[s]}
            <span className="rdmq-tab-count">{countByStatus[s]}</span>
          </Link>
        ))}
        <Link className="rdmq-tab" data-active={!activeStatus} href="/catalog-redemptions">
          All
          <span className="rdmq-tab-count">{redemptions.length}</span>
        </Link>
      </div>

      <div className="rdmq-legend">
        {(["airtime", "discount", "goods"] as const).map((c) => (
          <span key={c} className="rdmq-legend-item">
            <span className="rdmq-swatch" style={{ background: categoryColor(c) }} />
            {c}
          </span>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="empty">
          No redemptions{activeStatus ? ` in "${STATUS_LABEL[activeStatus].toLowerCase()}"` : ""} yet.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="rdmq-table">
            <thead>
              <tr>
                <th>Ref</th>
                <th>Requester</th>
                <th>Item</th>
                <th className="num">Cost</th>
                <th>Requested</th>
                <th>Status</th>
                {canEdit ? <th className="no-print">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => {
                const item = itemById.get(r.itemId);
                return (
                  <tr
                    key={r.id}
                    style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                  >
                    <td className="rdmq-ref" title={r.id}>
                      {r.id.slice(0, 8)}
                    </td>
                    <td className="rdmq-ref" title={r.requesterId}>
                      {r.requesterId.slice(0, 8)}
                    </td>
                    <td>
                      <span className="rdmq-item">
                        <span
                          className="rdmq-cat-bar"
                          style={{ background: categoryColor(item?.category) }}
                          aria-hidden="true"
                        />
                        <span>
                          {item?.name ?? r.itemId.slice(0, 8)}
                          <span className="rdmq-sub">{item?.category ?? "unlisted"}</span>
                        </span>
                      </span>
                    </td>
                    <td className="num">
                      {Number(r.costCredits).toLocaleString()}
                      <span className="rdmq-sub">{formatNaira(r.costCredits)}</span>
                    </td>
                    <td className="meta">{formatDateTime(r.createdAt)}</td>
                    <td>
                      <span className="rdmq-chip" data-status={r.status}>
                        {STATUS_LABEL[r.status]}
                      </span>
                      {r.fulfilledAt ? (
                        <div className="rdmq-sub">{formatDateTime(r.fulfilledAt)}</div>
                      ) : null}
                    </td>
                    {canEdit ? (
                      <td className="no-print">
                        {r.status === "pending_fulfillment" ? (
                          <details className="confirm">
                            <summary className="btn">Mark fulfilled</summary>
                            <form action={fulfillAction} className="confirm-body">
                              <input type="hidden" name="id" value={r.id} />
                              <p>Confirm this item has been handed over or sent?</p>
                              <div className="actions">
                                <button className="btn" data-variant="primary" type="submit">
                                  Confirm fulfilled
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
