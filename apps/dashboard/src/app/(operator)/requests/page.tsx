import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { api, ApiError, type CollectionRequest, type CurrentUser } from "@/lib/api";
import { formatDateTime, formatKg, materialEmoji } from "@/lib/format";
import { Emoji } from "@/app/Emoji";
import { PageHeader } from "../_components/PageHeader";
import { LoadError } from "../_components/LoadError";

export const dynamic = "force-dynamic";

/**
 * Operator triage queue for requester pickup requests — assign a collector,
 * then fulfill by linking to an already hub-verified weigh-in (same
 * lookup-code-or-id convention as `/reweigh`; `POST /requests/:id/fulfill`
 * itself only accepts a full event id, so a short code is resolved to one
 * here first, exactly as `/reweigh` resolves it before recording a reweigh).
 *
 * `GET /requests` is restricted to admin/operator (no auditor access), same
 * shape as `GET /material-rates` — this page mirrors that page's fetch and
 * error-handling structure for that reason.
 */

async function assignAction(formData: FormData) {
  "use server";

  const requestId = String(formData.get("requestId") ?? "").trim();
  const collectorId = String(formData.get("collectorId") ?? "").trim();

  try {
    await api.assignRequest(requestId, collectorId);
  } catch (error) {
    redirect(`/requests?error=${encodeURIComponent(messageOf(error))}`);
  }

  revalidatePath("/requests");
  redirect("/requests?assigned=true");
}

async function fulfillAction(formData: FormData) {
  "use server";

  const requestId = String(formData.get("requestId") ?? "").trim();
  const eventIdInput = String(formData.get("eventId") ?? "").trim();
  const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    eventIdInput,
  );

  try {
    const event = looksLikeUuid
      ? await api.getEvent(eventIdInput)
      : await api.getEventByLookupCode(eventIdInput);
    await api.fulfillRequest(requestId, event.id);
  } catch (error) {
    redirect(`/requests?error=${encodeURIComponent(messageOf(error))}`);
  }

  revalidatePath("/requests");
  redirect("/requests?fulfilled=true");
}

async function cancelAction(formData: FormData) {
  "use server";

  const requestId = String(formData.get("requestId") ?? "").trim();

  try {
    await api.cancelRequest(requestId);
  } catch (error) {
    redirect(`/requests?error=${encodeURIComponent(messageOf(error))}`);
  }

  revalidatePath("/requests");
  redirect("/requests?cancelled=true");
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail ?? `Request failed (${error.status}).`;
  }
  return "The backend did not respond, so nothing was changed.";
}

function statusTone(status: CollectionRequest["status"]): "verified" | "pending" | "broken" | "neutral" {
  if (status === "redeemed") return "verified";
  if (status === "collected") return "pending";
  if (status === "cancelled") return "broken";
  return "neutral";
}

const STATUSES = ["requested", "assigned", "collected", "redeemed", "cancelled"] as const;

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    error?: string;
    assigned?: string;
    fulfilled?: string;
    cancelled?: string;
  }>;
}) {
  const { status, error, assigned, fulfilled, cancelled } = await searchParams;

  let requests: CollectionRequest[];
  let collectors: { id: string; name: string }[];
  let hubs: { id: string; code: string; name: string }[];
  let viewer: CurrentUser | null = null;
  try {
    [requests, collectors, hubs, viewer] = await Promise.all([
      api.listRequests(status ? { status } : undefined),
      api.collectors(),
      api.hubs(),
      api.me().catch(() => null),
    ]);
  } catch {
    return (
      <main>
        <PageHeader eyebrow="Pickup queue" title="Requests" />
        <LoadError error={error} resource="pickup requests" />
      </main>
    );
  }

  if (!viewer) {
    return (
      <main>
        <PageHeader eyebrow="Pickup queue" title="Requests" />
        <p className="error">
          Not signed in. <Link href="/login">Sign in</Link> to see requests.
        </p>
      </main>
    );
  }

  const canEdit = viewer.role === "admin" || viewer.role === "operator";
  const hubNameById = new Map(hubs.map((h) => [h.id, `${h.name} (${h.code})`]));
  const collectorNameById = new Map(collectors.map((c) => [c.id, c.name]));

  // One QR per collected-and-not-yet-redeemed request, server rendered via
  // `qrcode`'s toDataURL — an operator handing a physical printout to a
  // requester who isn't signed in is a real scenario per the plan, and this
  // is the same code the requester's own `/requester/dashboard` also shows.
  const collectedWithQr = await Promise.all(
    requests
      .filter((r) => r.status === "collected" && r.redemptionCode)
      .map(async (r) => ({ request: r, dataUrl: await QRCode.toDataURL(r.redemptionCode as string) })),
  );

  return (
    <main>
      <PageHeader
        eyebrow="Pickup queue"
        title="Requests"
        actions={
          <nav className="segmented" aria-label="Filter by status">
            <Link href="/requests" aria-current={status ? undefined : "true"}>
              All
            </Link>
            {STATUSES.map((s) => (
              <Link
                key={s}
                href={`/requests?status=${s}`}
                aria-current={status === s ? "true" : undefined}
              >
                {s}
              </Link>
            ))}
          </nav>
        }
      />
      <p className="page-intro">
        Fulfilling links a request to an already hub-verified weigh-in. Enter its lookup code or
        full id, same as <Link href="/reweigh">Reweigh</Link>. Only a <code>verified</code> or{" "}
        <code>flagged</code> reweigh (never <code>rejected</code>, and never a bare unverified
        weigh-in) is eligible.
      </p>

      {error ? <p className="error">{decodeURIComponent(error)}</p> : null}
      {assigned ? <p className="note">Assigned.</p> : null}
      {fulfilled ? <p className="note">Fulfilled. Redemption code issued.</p> : null}
      {cancelled ? <p className="note">Cancelled.</p> : null}

      <dl className="stats">
        <div className="stat">
          <dt>Shown</dt>
          <dd>{requests.length}</dd>
        </div>
        <div className="stat">
          <dt>Requested</dt>
          <dd>{requests.filter((r) => r.status === "requested").length}</dd>
        </div>
        <div className="stat">
          <dt>Assigned</dt>
          <dd>{requests.filter((r) => r.status === "assigned").length}</dd>
        </div>
        <div className="stat">
          <dt>Collected</dt>
          <dd>{requests.filter((r) => r.status === "collected").length}</dd>
        </div>
        <div className="stat">
          <dt>Redeemed</dt>
          <dd>{requests.filter((r) => r.status === "redeemed").length}</dd>
        </div>
      </dl>

      {canEdit ? null : (
        <p className="note">
          Read-only: assigning, fulfilling or cancelling requires an operator account.
        </p>
      )}

      {requests.length === 0 ? (
        <p className="empty">No requests{status ? ` with status "${status}"` : ""} yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Material</th>
                <th>Hub</th>
                <th className="num">Est. weight</th>
                <th>Status</th>
                <th>Collector</th>
                <th>Requested</th>
                {canEdit ? <th className="no-print col-actions">Actions</th> : null}
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
                    <span className="pill" data-tone={statusTone(r.status)}>
                      {r.status}
                    </span>
                  </td>
                  <td>
                    {r.assignedCollectorId
                      ? (collectorNameById.get(r.assignedCollectorId) ?? r.assignedCollectorId.slice(0, 8))
                      : "—"}
                  </td>
                  <td className="meta">{formatDateTime(r.createdAt)}</td>
                  {canEdit ? (
                    <td className="no-print col-actions">
                      <div className="actions">
                        {r.status === "requested" ? (
                          <details className="confirm">
                            <summary className="btn">Assign</summary>
                            <form action={assignAction} className="confirm-body">
                              <input type="hidden" name="requestId" value={r.id} />
                              <label htmlFor={`collector-${r.id}`}>
                                Collector
                                <select
                                  id={`collector-${r.id}`}
                                  name="collectorId"
                                  required
                                  defaultValue=""
                                >
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
                              <div className="actions">
                                <button className="btn" data-variant="primary" type="submit">
                                  Assign
                                </button>
                              </div>
                            </form>
                          </details>
                        ) : null}

                        {r.status === "requested" || r.status === "assigned" ? (
                          <details className="confirm">
                            <summary className="btn">Fulfill</summary>
                            <form action={fulfillAction} className="confirm-body">
                              <input type="hidden" name="requestId" value={r.id} />
                              <label htmlFor={`event-${r.id}`}>
                                Lookup code or weigh-in id
                                <input
                                  id={`event-${r.id}`}
                                  name="eventId"
                                  required
                                  placeholder="e.g. 0700123e3c"
                                />
                              </label>
                              <p>
                                Must already have a hub-verified reweigh (verified or flagged, not
                                rejected).
                              </p>
                              <div className="actions">
                                <button className="btn" data-variant="primary" type="submit">
                                  Fulfill
                                </button>
                              </div>
                            </form>
                          </details>
                        ) : null}

                        {r.status === "requested" || r.status === "assigned" ? (
                          <details className="confirm">
                            <summary className="btn">Cancel</summary>
                            <form action={cancelAction} className="confirm-body">
                              <input type="hidden" name="requestId" value={r.id} />
                              <p>Cancel this request? This cannot be undone.</p>
                              <div className="actions">
                                <button className="btn" type="submit">
                                  Confirm cancel
                                </button>
                              </div>
                            </form>
                          </details>
                        ) : null}

                        {r.status !== "requested" && r.status !== "assigned" ? "—" : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {collectedWithQr.length > 0 ? (
        <>
          <h2>Redemption codes</h2>
          <p className="note">
            Collected and awaiting redemption. Print or show one of these to the requester if they
            aren&rsquo;t signed in to their own dashboard. The same code and QR appear on{" "}
            <code>/requester/dashboard</code> once they are.
          </p>
          <div
            style={{
              display: "grid",
              gap: "1.5rem",
              gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))",
            }}
          >
            {collectedWithQr.map(({ request, dataUrl }) => (
              <div key={request.id} className="lookup-code-box">
                <img
                  className="qr-code"
                  src={dataUrl}
                  alt={`QR code for redemption code ${request.redemptionCode}`}
                  width={180}
                  height={180}
                />
                <p className="lookup-code" style={{ fontSize: "1.25rem", marginTop: "0.75rem" }}>
                  {request.redemptionCode}
                </p>
                <p className="note" style={{ margin: "0.5rem auto 0" }}>
                  <Emoji>{materialEmoji(request.material)}</Emoji> {request.material} ·{" "}
                  {hubNameById.get(request.hubId) ?? ""}
                </p>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </main>
  );
}
