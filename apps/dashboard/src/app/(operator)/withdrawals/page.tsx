import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ApiError, type CurrentUser, type WithdrawalRequest } from "@/lib/api";
import { formatDateTime, formatNaira } from "@/lib/format";
import { PageHeader } from "../_components/PageHeader";
import { LoadError } from "../_components/LoadError";
import { Alert } from "../_components/Alert";
import { EmptyState } from "../_components/EmptyState";
import { Metric, MetricGrid } from "../_components/Metric";
import { StatusBadge } from "../_components/StatusBadge";
import { RetryButton } from "../_components/RetryButton";

export const dynamic = "force-dynamic";

/**
 * Operator queue for requester cash-out requests — mirrors `/payouts`
 * exactly, on purpose: `WithdrawalRequestEntity` walks the identical
 * `pending -> paid` pattern as `PayoutEntity` (see that entity's doc
 * comment), a debit is written only at "mark paid" time, and "reject"
 * releases the hold with no debit ever written.
 */

async function markPaidAction(formData: FormData) {
  "use server";

  const id = String(formData.get("id") ?? "");
  const payoutRef = String(formData.get("payoutRef") ?? "").trim();

  try {
    await api.markWithdrawalPaid(id, payoutRef ? { payoutRef } : undefined);
  } catch (error) {
    redirect(`/withdrawals?error=${encodeURIComponent(messageOf(error))}`);
  }

  revalidatePath("/withdrawals");
  redirect("/withdrawals?paid=true");
}

async function rejectAction(formData: FormData) {
  "use server";

  const id = String(formData.get("id") ?? "");

  try {
    await api.rejectWithdrawal(id);
  } catch (error) {
    redirect(`/withdrawals?error=${encodeURIComponent(messageOf(error))}`);
  }

  revalidatePath("/withdrawals");
  redirect("/withdrawals?rejected=true");
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail ?? `Request failed (${error.status}).`;
  }
  return "The backend did not respond, so nothing was changed.";
}

const EYEBROW = "Cash-out queue";
const TITLE = "Withdrawals";
const SUMMARY = "Manage and monitor withdrawal requests.";

/** The three states `WithdrawalRequestEntity` defines — no others exist. */
const STATUSES = ["pending", "paid", "rejected"] as const;

export default async function WithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string; paid?: string; rejected?: string }>;
}) {
  const { status, error, paid, rejected } = await searchParams;

  let withdrawals: WithdrawalRequest[];
  let viewer: CurrentUser | null = null;
  try {
    /*
     * Unfiltered, always. The status filter is applied below, in this render,
     * rather than by passing `?status=` to the API — because the metric row has
     * to keep reporting the whole queue while the table shows one slice of it.
     * Filtering server-side would make "12 pending" read as "12 pending out of
     * the 12 pending currently on screen", which is not a fact.
     *
     * `api.listWithdrawals` still accepts the status argument and the endpoint
     * still supports it; this page just does not need it.
     */
    [withdrawals, viewer] = await Promise.all([
      api.listWithdrawals(),
      api.me().catch(() => null),
    ]);
  } catch (loadError) {
    return (
      <main>
        <PageHeader eyebrow={EYEBROW} title={TITLE} summary={SUMMARY} />
        <LoadError error={loadError} resource="withdrawal requests" />
      </main>
    );
  }

  if (!viewer) {
    return (
      <main>
        <PageHeader eyebrow={EYEBROW} title={TITLE} summary={SUMMARY} />
        <Alert
          tone="pending"
          title="You are not signed in"
          action={
            <Link className="btn" href="/login">
              Sign in
            </Link>
          }
        >
          Sign in to see withdrawal requests. This queue is visible to operator and admin
          accounts.
        </Alert>
      </main>
    );
  }

  const canEdit = viewer.role === "admin" || viewer.role === "operator";

  const pending = withdrawals.filter((w) => w.status === "pending");
  const paidRequests = withdrawals.filter((w) => w.status === "paid");
  const rejectedRequests = withdrawals.filter((w) => w.status === "rejected");
  const pendingTotal = sumCredits(pending);
  const paidTotal = sumCredits(paidRequests);

  const active = STATUSES.find((s) => s === status);
  const shown = active ? withdrawals.filter((w) => w.status === active) : withdrawals;

  return (
    <main>
      <PageHeader eyebrow={EYEBROW} title={TITLE} summary={SUMMARY} />

      {error ? (
        <Alert tone="broken" title="That action did not go through">
          {decodeURIComponent(error)}
        </Alert>
      ) : null}
      {paid ? (
        <Alert tone="verified" title="Withdrawal marked paid">
          The requester&rsquo;s wallet has been debited and the hold released.
        </Alert>
      ) : null}
      {rejected ? (
        <Alert tone="verified" title="Withdrawal rejected">
          The held amount is back in the requester&rsquo;s available balance. No debit was written.
        </Alert>
      ) : null}

      {/*
       * The queue as a whole, never the filtered slice — see the fetch above.
       * Pending leads because it is the only figure that implies work.
       */}
      <MetricGrid>
        <Metric label="Total requests" value={withdrawals.length} />
        <Metric
          label="Pending"
          value={pending.length}
          note={`${formatNaira(pendingTotal)} awaiting payment`}
          tone={pending.length > 0 ? "pending" : undefined}
        />
        <Metric label="Paid" value={paidRequests.length} note={`${formatNaira(paidTotal)} paid out`} />
        <Metric label="Rejected" value={rejectedRequests.length} />
      </MetricGrid>

      <p className="page-intro">
        1 credit = ₦1. A withdrawal is only ever debited from a requester&rsquo;s wallet once marked
        paid here, because recording it any earlier would risk showing a debit for cash the requester never
        actually received.
      </p>

      {canEdit ? null : (
        <Alert tone="pending" title="Read-only access">
          You can review this queue, but marking a withdrawal paid or rejecting one requires an
          operator or admin account.
        </Alert>
      )}

      <div className="toolbar">
        <h2>Withdrawal requests</h2>
        {/*
         * Real links carrying `?status=`, so a filtered view survives a reload,
         * can be sent to a colleague, and works with JavaScript off.
         */}
        <nav className="segmented no-print" aria-label="Filter by status">
          <Link href="/withdrawals" aria-current={!active ? "true" : undefined}>
            All
          </Link>
          {STATUSES.map((s) => (
            <Link
              key={s}
              href={`/withdrawals?status=${s}`}
              aria-current={active === s ? "true" : undefined}
            >
              {LABELS[s]}
            </Link>
          ))}
        </nav>
      </div>

      {shown.length === 0 ? (
        active ? (
          <EmptyState
            title={`No ${LABELS[active].toLowerCase()} withdrawals`}
            action={
              <Link className="btn" href="/withdrawals">
                Show all requests
              </Link>
            }
          >
            {withdrawals.length} request{withdrawals.length === 1 ? "" : "s"} in the queue overall,
            none of them {LABELS[active].toLowerCase()}.
          </EmptyState>
        ) : (
          <EmptyState title="No withdrawal requests yet" action={<RetryButton label="Refresh" />}>
            Requesters cash out from their wallet, and their requests arrive here for payment. There
            is nothing waiting at the moment.
          </EmptyState>
        )
      ) : (
        <div className="table-wrap">
          {/*
           * `table--stack` turns each row into a card below 640px — a
           * seven-column ledger cannot be read at 375px, and scrolling it
           * sideways hides the amount and the status, which are the two columns
           * anyone opened this page for. See the rule in globals.css.
           */}
          <table className="table--stack">
            <thead>
              <tr>
                <th>Request</th>
                <th className="num">Amount</th>
                <th>Status</th>
                <th>Payout reference</th>
                <th>Requested</th>
                <th>Paid</th>
                {canEdit ? <th className="no-print col-actions">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {shown.map((w) => (
                <tr key={w.id}>
                  {/* The first eight characters identify a request in
                      conversation and in a support ticket; the full uuid is
                      never needed on screen and does not fit. */}
                  <td data-label="Request" className="hash" title={w.id}>
                    {w.id.slice(0, 8)}
                  </td>
                  {/* One element, not two lines of text: in the stacked mobile
                      layout each child of the cell becomes a flex item, so a
                      bare `<br/>` would spread the amount and its credit count
                      to opposite edges of the card. */}
                  <td data-label="Amount" className="num">
                    <span className="amount">
                      <strong>{formatNaira(w.amountCredits)}</strong>
                      <span className="meta">
                        {Number(w.amountCredits).toLocaleString()} credits
                      </span>
                    </span>
                  </td>
                  <td data-label="Status">
                    <StatusBadge status={w.status} />
                  </td>
                  <td data-label="Payout reference" className="hash">
                    {w.payoutRef ?? "—"}
                  </td>
                  <td data-label="Requested" className="meta">
                    {formatDateTime(w.createdAt)}
                  </td>
                  <td data-label="Paid" className="meta">
                    {formatDateTime(w.paidAt)}
                  </td>
                  {canEdit ? (
                    <td
                      data-label=""
                      className={`no-print col-actions${w.status === "pending" ? "" : " is-empty"}`}
                    >
                      {w.status === "pending" ? (
                        <div className="actions">
                          <details className="confirm">
                            <summary className="btn" data-variant="primary">
                              Mark paid
                            </summary>
                            <form action={markPaidAction} className="confirm-body">
                              <input type="hidden" name="id" value={w.id} />
                              <label htmlFor={`ref-${w.id}`}>
                                Payout reference (optional, receipt or transfer id)
                                <input id={`ref-${w.id}`} name="payoutRef" maxLength={200} />
                              </label>
                              <p>
                                Confirming debits {formatNaira(w.amountCredits)} from the
                                requester&rsquo;s wallet. This cannot be undone.
                              </p>
                              <div className="actions">
                                <button className="btn" data-variant="primary" type="submit">
                                  Confirm paid
                                </button>
                              </div>
                            </form>
                          </details>

                          <details className="confirm">
                            <summary className="btn">
                              Reject
                            </summary>
                            <form action={rejectAction} className="confirm-body">
                              <input type="hidden" name="id" value={w.id} />
                              <p>
                                Reject this withdrawal? The held amount is released back to the
                                requester&rsquo;s available balance. No debit is ever written.
                              </p>
                              <div className="actions">
                                <button className="btn" data-variant="danger" type="submit">
                                  Confirm reject
                                </button>
                              </div>
                            </form>
                          </details>
                        </div>
                      ) : (
                        <span className="meta">—</span>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

/** Sentence case for the reader; the API's own lowercase values stay the keys. */
const LABELS: Record<(typeof STATUSES)[number], string> = {
  pending: "Pending",
  paid: "Paid",
  rejected: "Rejected",
};

function sumCredits(requests: WithdrawalRequest[]): number {
  return requests.reduce((total, w) => total + Number(w.amountCredits), 0);
}
