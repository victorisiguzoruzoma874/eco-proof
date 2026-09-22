import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ApiError, type CatalogItem, type CurrentUser } from "@/lib/api";
import { formatNaira } from "@/lib/format";
import { PageHeader } from "../_components/PageHeader";
import { LoadError } from "../_components/LoadError";

export const dynamic = "force-dynamic";

/**
 * The redemption catalog, administered. `GET /catalog-items` only ever returns
 * active items (see `CatalogService.list`'s doc comment: nothing in this pass
 * can retire one yet), so unlike `/materials` there is no offered/retired
 * split to render here.
 *
 * Search, category filter and column sort are all URL state, resolved on the
 * server before the rows are rendered — the house pattern `/requests` already
 * uses for its status filter. Nothing on this page is client state, so a
 * filtered view is linkable, printable and survives a reload.
 *
 * Deliberately NOT here: inline editing of cost/stock. The backend exposes
 * only `GET /catalog-items` and `POST /catalog-items` (admin) — there is no
 * update route — so an edit affordance could render but never save. A control
 * that cannot persist is worse than no control.
 */

async function addItem(formData: FormData) {
  "use server";

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const costCredits = Number(formData.get("costCredits"));
  const stock = String(formData.get("stock") ?? "").trim();

  try {
    await api.createCatalogItem({
      name,
      ...(description ? { description } : {}),
      category,
      costCredits,
      ...(stock ? { stock: Number(stock) } : {}),
    });
  } catch (error) {
    redirect(`/catalog-items?error=${encodeURIComponent(messageOf(error))}`);
  }

  revalidatePath("/catalog-items");
  redirect("/catalog-items?added=true");
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail ?? `Request failed (${error.status}).`;
  }
  return "The backend did not respond, so nothing was changed.";
}

/* ---------- URL state ---------- */

const SORT_KEYS = ["name", "category", "description", "cost", "stock"] as const;
type SortKey = (typeof SORT_KEYS)[number];

/**
 * The three categories the seed ships and the mockup names. `category` is free
 * text on the backend (not an enum), so anything an admin invents is unioned
 * in below rather than silently becoming unreachable behind the filter.
 */
const KNOWN_CATEGORIES = ["airtime", "discount", "goods"] as const;

/** Low stock is a call to action, not a status — the only thing on this page that moves. */
const LOW_STOCK_AT = 10;

function categoryColor(category: string): string {
  const key = category.trim().toLowerCase();
  if (key === "airtime") return "var(--category-airtime)";
  if (key === "discount") return "var(--category-discount)";
  if (key === "goods") return "var(--category-goods)";
  return "var(--ink-faint)";
}

function isSortKey(value: string | undefined): value is SortKey {
  return !!value && (SORT_KEYS as readonly string[]).includes(value);
}

/** `null` stock means unlimited, which sorts as "more than any number". */
function stockRank(item: CatalogItem): number {
  return item.stock === null ? Number.POSITIVE_INFINITY : item.stock;
}

function compare(a: CatalogItem, b: CatalogItem, key: SortKey): number {
  switch (key) {
    case "name":
      return a.name.localeCompare(b.name);
    case "category":
      return a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
    case "description":
      return (a.description ?? "").localeCompare(b.description ?? "") || a.name.localeCompare(b.name);
    case "cost":
      return Number(a.costCredits) - Number(b.costCredits) || a.name.localeCompare(b.name);
    case "stock":
      return stockRank(a) - stockRank(b) || a.name.localeCompare(b.name);
  }
}

export default async function CatalogItemsPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    added?: string;
    q?: string;
    cat?: string;
    sort?: string;
    dir?: string;
  }>;
}) {
  const params = await searchParams;
  const { error, added } = params;

  const q = (params.q ?? "").trim();
  const cat = (params.cat ?? "").trim().toLowerCase();
  const sort: SortKey | null = isSortKey(params.sort) ? params.sort : null;
  const dir: "asc" | "desc" = params.dir === "desc" ? "desc" : "asc";

  let items: CatalogItem[];
  let viewer: CurrentUser | null = null;
  try {
    [items, viewer] = await Promise.all([api.catalogItems(), api.me().catch(() => null)]);
  } catch {
    return (
      <main>
        <h1>Catalog items</h1>
        <LoadError error={error} resource="the redemption catalogue" />
      </main>
    );
  }

  if (!viewer) {
    return (
      <main>
        <h1>Catalog items</h1>
        <p className="error">
          Not signed in. <Link href="/login">Sign in</Link> to see catalog items.
        </p>
      </main>
    );
  }

  // GET is public and open to any signed-in role here; only admin can add an
  // item — matching what the backend enforces on POST /catalog-items.
  const canCreate = viewer.role === "admin";

  /* --- the whole view, computed here on the server --- */

  const total = items.length;
  const needle = q.toLowerCase();
  let shown = items.filter((item) => {
    if (cat && item.category.trim().toLowerCase() !== cat) return false;
    if (!needle) return true;
    return (
      item.name.toLowerCase().includes(needle) ||
      item.category.toLowerCase().includes(needle) ||
      (item.description ?? "").toLowerCase().includes(needle)
    );
  });

  if (sort) {
    // Copy first: `items` is the fetched array and sorting in place would make
    // the ordering depend on filter evaluation order.
    shown = [...shown].sort((a, b) => (dir === "desc" ? -compare(a, b, sort) : compare(a, b, sort)));
  }

  const categories = Array.from(
    new Set<string>([
      ...KNOWN_CATEGORIES,
      ...items.map((item) => item.category.trim().toLowerCase()).filter(Boolean),
    ]),
  );

  /** Every filter/sort link carries the rest of the current view forward. */
  function hrefWith(next: Partial<{ q: string; cat: string; sort: string; dir: string }>): string {
    const merged: Record<string, string> = {
      ...(q ? { q } : {}),
      ...(cat ? { cat } : {}),
      ...(sort ? { sort, dir } : {}),
      ...next,
    };
    const search = new URLSearchParams(
      Object.entries(merged).filter(([, value]) => value !== ""),
    ).toString();
    return search ? `/catalog-items?${search}` : "/catalog-items";
  }

  /** Clicking the active column flips direction; any other column starts ascending. */
  function sortHref(key: SortKey): string {
    return hrefWith({ sort: key, dir: sort === key && dir === "asc" ? "desc" : "asc" });
  }

  function SortHead({
    column,
    label,
    align,
  }: {
    column: SortKey;
    label: string;
    align?: "right";
  }) {
    const active = sort === column;
    return (
      <th className="ci-th" data-align={align ?? "left"} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
        <Link className="ci-sort" href={sortHref(column)} data-active={active ? "true" : "false"}>
          {label}
          <span className="ci-arrow" aria-hidden="true">
            {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
          </span>
        </Link>
      </th>
    );
  }

  return (
    <main>
      <style dangerouslySetInnerHTML={{ __html: PAGE_CSS }} />

      <header className="ci-header">
        <PageHeader
          eyebrow="Requester wallet"
          title="Catalog items"
          actions={
            <>
              <span className="ci-rate-chip">1 credit = &#8358;1</span>
              {canCreate ? (
                <a className="btn" href="#add-an-item">
                  Add an item
                </a>
              ) : null}
            </>
          }
        />

        <p className="page-intro">
          The catalogue is what a requester can spend waste credits on instead of cashing out via{" "}
          <Link href="/withdrawals">Withdrawals</Link>: airtime, discounts, physical goods. Prices
          are held in credits at a flat 1 credit = &#8358;1. Redeeming debits the requester&rsquo;s
          wallet immediately and queues the item on{" "}
          <Link href="/catalog-redemptions">Catalog redemptions</Link> for an operator to fulfil, so
          everything listed here is a promise someone has to keep.
        </p>
      </header>

      {error ? <p className="error">{decodeURIComponent(error)}</p> : null}
      {added ? <p className="note">Item added.</p> : null}

      {canCreate ? null : (
        <p className="note">Read-only: adding a catalog item requires an administrator account.</p>
      )}

      <div className="ci-toolbar no-print">
        {/*
          A plain GET form, not client state: submitting navigates to
          `/catalog-items?q=…`, which is the same URL a shared link produces.
          The hidden fields carry the current category and sort through the
          submit so searching never silently resets the rest of the view.
        */}
        <form className="ci-search" method="get" action="/catalog-items">
          {cat ? <input type="hidden" name="cat" value={cat} /> : null}
          {sort ? <input type="hidden" name="sort" value={sort} /> : null}
          {sort ? <input type="hidden" name="dir" value={dir} /> : null}
          <label className="ci-search-label" htmlFor="q">
            <span className="ci-visually-hidden">Search catalog items</span>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Search name, description, category"
              autoComplete="off"
            />
          </label>
          <button className="btn" type="submit">
            Search
          </button>
          {q ? (
            <Link className="ci-clear" href={hrefWith({ q: "" })}>
              Clear
            </Link>
          ) : null}
        </form>

        <div className="ci-segmented" role="group" aria-label="Filter by category">
          <Link
            className="ci-seg"
            data-active={cat === "" ? "true" : "false"}
            href={hrefWith({ cat: "" })}
          >
            all
          </Link>
          {categories.map((c) => (
            <Link
              key={c}
              className="ci-seg"
              data-active={cat === c ? "true" : "false"}
              href={hrefWith({ cat: c })}
              style={{ ["--seg-color" as string]: categoryColor(c) }}
            >
              {c}
            </Link>
          ))}
        </div>
      </div>

      {total === 0 ? (
        <p className="empty">
          No catalog items yet. Nothing can be redeemed until at least one exists.
        </p>
      ) : (
        <div className="ci-shell">
          <div className="ci-scroll">
            <table className="ci-table">
              <thead>
                <tr>
                  <SortHead column="name" label="Name" />
                  <SortHead column="category" label="Cat." />
                  <SortHead column="description" label="Description" />
                  <SortHead column="cost" label="Cost" align="right" />
                  <SortHead column="stock" label="Stock" align="right" />
                </tr>
              </thead>
              <tbody>
                {shown.map((item, index) => {
                  const low = item.stock !== null && item.stock <= LOW_STOCK_AT;
                  return (
                    <tr
                      key={item.id}
                      className="ci-row"
                      style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
                    >
                      <td className="ci-name">
                        <span
                          className="ci-dot"
                          aria-hidden="true"
                          style={{ background: categoryColor(item.category) }}
                        />
                        {item.name}
                      </td>
                      <td>
                        <span
                          className="ci-cat"
                          style={{ ["--cat-color" as string]: categoryColor(item.category) }}
                        >
                          {item.category}
                        </span>
                      </td>
                      <td className="ci-desc">{item.description ?? "—"}</td>
                      <td className="num">
                        {Number(item.costCredits).toLocaleString()}{" "}
                        <span className="ci-naira">({formatNaira(item.costCredits)})</span>
                      </td>
                      <td className="num">
                        {item.stock === null ? (
                          <span className="ci-unlimited">unlimited</span>
                        ) : low ? (
                          <span className="ci-low" title="Low stock">
                            {/* Dot first: after the digits it would push this
                                row's figure off the column's right edge. */}
                            <span className="ci-pulse" aria-hidden="true" />
                            {item.stock}
                            <span className="ci-visually-hidden">, low stock</span>
                          </span>
                        ) : (
                          item.stock
                        )}
                      </td>
                    </tr>
                  );
                })}
                {shown.length === 0 ? (
                  <tr>
                    <td className="ci-none" colSpan={5}>
                      Nothing matches {q ? <strong>&ldquo;{q}&rdquo;</strong> : "this view"}
                      {cat ? (
                        <>
                          {" "}
                          in <strong>{cat}</strong>
                        </>
                      ) : null}
                      .{" "}
                      <Link href="/catalog-items">Reset filters</Link>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="ci-foot">
            <span className="ci-count">
              {shown.length} of {total} {total === 1 ? "item" : "items"}
            </span>
          </div>
        </div>
      )}

      {canCreate ? (
        <section id="add-an-item" className="ci-add">
          <h2>Add an item</h2>
          <p className="note">
            Items can only be added, never edited or retired, because the backend exposes no update route,
            so a price published here is the price a requester pays.
          </p>
          <form action={addItem} className="ci-form">
            <label htmlFor="name">
              Name
              <input id="name" name="name" required maxLength={200} placeholder="₦500 airtime" />
            </label>
            <label htmlFor="description">
              Description (optional)
              <input
                id="description"
                name="description"
                maxLength={500}
                placeholder="Redeemable on any network"
              />
            </label>
            <label htmlFor="category">
              Category
              <input id="category" name="category" required maxLength={50} placeholder="airtime" />
            </label>
            <label htmlFor="costCredits">
              Cost in credits (1 credit = ₦1)
              <input
                id="costCredits"
                name="costCredits"
                type="number"
                step="0.001"
                min="0"
                required
                placeholder="500"
              />
            </label>
            <label htmlFor="stock">
              Stock (optional, leave blank for unlimited)
              <input id="stock" name="stock" type="number" min="0" placeholder="100" />
            </label>
            <div className="actions ci-form-actions">
              <button className="btn" data-variant="primary" type="submit">
                Add item
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </main>
  );
}

/*
 * Page-local CSS. It lives here rather than in `(operator)/globals.css` because
 * every selector below is scoped to this screen's `ci-` prefix and describes
 * this table alone; the shared vocabulary it builds on — `--paper`, `--rule`,
 * `row-in`, `pulse-dot`, `.page-head` — is all already global.
 *
 * Injected via dangerouslySetInnerHTML so child-combinator selectors survive
 * React's text escaping intact.
 */
const PAGE_CSS = `
.ci-header { margin-bottom: 1.5rem; }

.ci-header-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.5rem;
  flex-wrap: wrap;
}

.ci-header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

/* The exchange rate is a standing fact, not a control — dashed, so it reads as
   a note pinned to the page rather than something to press. */
.ci-rate-chip {
  font-family: var(--mono);
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  color: var(--ink-soft);
  border: 1px dashed var(--rule);
  border-radius: 2px;
  padding: 0.45rem 0.7rem;
  white-space: nowrap;
}

/* ---------- toolbar ---------- */

.ci-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem 1.5rem;
  flex-wrap: wrap;
  margin: 0 0 1.1rem;
}

.ci-search {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex: 1 1 20rem;
  min-width: 0;
}

.ci-search-label { display: block; flex: 1 1 auto; min-width: 0; }

.ci-search input {
  width: 100%;
  font-size: 0.875rem;
  border-color: var(--rule);
}

.ci-search input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
  border-color: var(--rule-strong);
}

.ci-clear {
  font-family: var(--mono);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-faint);
  text-decoration: none;
  white-space: nowrap;
}

.ci-clear:hover { color: var(--accent); }

/* One bordered strip cut by hairlines — the same rule vocabulary as the
   tables, so the filter reads as part of the ledger and not as a widget. */
.ci-segmented {
  display: inline-flex;
  border: 1px solid var(--rule);
  border-radius: 2px;
  background: var(--surface);
  overflow: hidden;
  flex: none;
}

.ci-seg {
  font-family: var(--mono);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-faint);
  text-decoration: none;
  padding: 0.55rem 0.85rem;
  line-height: 1;
  border-left: 1px solid var(--rule);
  white-space: nowrap;
  transition: color 140ms ease, background-color 140ms ease;
}

.ci-seg:first-child { border-left: 0; }
.ci-seg:hover { color: var(--ink); background: color-mix(in srgb, var(--ink) 5%, transparent); }

.ci-seg[data-active="true"] {
  color: var(--ink);
  background: color-mix(in srgb, var(--ink) 8%, transparent);
  box-shadow: inset 0 -2px 0 var(--seg-color, var(--accent));
}

/* ---------- table ---------- */

/* The same frame, head and cell rhythm as every other ledger (globals.css
   "tables"): only the sort links and the footer are this page's own. */
.ci-shell {
  border: 1px solid var(--rule);
  border-radius: var(--radius-lg);
  background: var(--surface);
  overflow: hidden;
}

.ci-scroll { overflow-x: auto; }

.ci-table { min-width: 46rem; }

/* The link carries the padding so the whole head cell is the hit target. */
.ci-table th.ci-th { padding: 0; }

.ci-th[data-align="right"] { text-align: right; }

.ci-sort {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-4);
  color: inherit;
  text-decoration: none;
  transition: color 140ms ease;
}

.ci-th[data-align="right"] .ci-sort { justify-content: flex-end; }
.ci-sort:hover { color: var(--ink); }
.ci-sort[data-active="true"] { color: var(--ink); }

/* Idle columns keep a faint double-arrow so the affordance is discoverable
   without a hover; the active one is full-strength and rust. */
.ci-arrow { font-size: 0.7rem; opacity: 0.3; line-height: 1; }
.ci-sort:hover .ci-arrow { opacity: 0.6; }
.ci-sort[data-active="true"] .ci-arrow { opacity: 1; color: var(--accent); }

.ci-row { animation: row-in 320ms cubic-bezier(0.22, 1, 0.36, 1) both; }

.ci-name {
  font-weight: 500;
  white-space: nowrap;
}

.ci-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-right: 0.55rem;
  vertical-align: 0.08em;
}

.ci-cat {
  display: inline-block;
  font-family: var(--mono);
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 0.2rem 0.5rem;
  border-radius: 2px;
  white-space: nowrap;
  color: var(--cat-color, var(--ink-soft));
  background: color-mix(in srgb, var(--cat-color, var(--ink-soft)) 12%, transparent);
}

.ci-desc {
  color: var(--ink-soft);
  max-width: 34rem;
  text-wrap: pretty;
}

.ci-naira { color: var(--ink-faint); }
.ci-unlimited { font-size: 0.8125rem; color: var(--ink-faint); }

/* Low stock is the one number on this page that is asking for a decision. */
.ci-low {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--accent);
  font-weight: 600;
}

.ci-pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  animation: pulse-dot 2.4s ease-in-out infinite;
}

.ci-none {
  text-align: center;
  color: var(--ink-faint);
  padding: 2.5rem 1rem;
}

.ci-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.65rem 1rem;
  border-top: 1px solid var(--rule);
  background: color-mix(in srgb, var(--ink) 3%, var(--surface));
}

.ci-count {
  font-family: var(--mono);
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-faint);
  font-variant-numeric: tabular-nums;
}

/* ---------- add form ---------- */

.ci-add { scroll-margin-top: 5rem; }

.ci-form {
  display: grid;
  gap: 0.9rem;
  max-width: 32rem;
  padding: 1.25rem;
  border: 1px solid var(--rule);
  background: var(--surface);
}

.ci-form-actions { margin-top: 0.25rem; }

.ci-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

@media (prefers-reduced-motion: reduce) {
  .ci-row, .ci-pulse { animation: none; }
  .ci-seg, .ci-sort, .ci-table tbody tr { transition: none; }
}

@media print {
  .ci-row, .ci-pulse { animation: none; }
  .ci-table { min-width: 0; font-size: 8.5pt; }
}
`;
