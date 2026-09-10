import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ApiError, type CollectionEvent, type EventReweigh } from "@/lib/api";
import { formatDateTime, formatKg, materialEmoji } from "@/lib/format";
import { Emoji } from "@/app/Emoji";
import { PageHeader } from "../_components/PageHeader";

export const dynamic = "force-dynamic";

/**
 * The verification hub's screen.
 *
 * A collector arrives with a weigh-in id (from their printed proof page) and
 * their material. Hub staff look the weigh-in up here, weigh it themselves,
 * and record what the scale actually said. A ±5% difference from the
 * collector's claim is recorded as "verified"; anything wider is "flagged"
 * and needs a stated reason — but per policy neither blocks payment, so this
 * screen never asks staff to accept or reject a submission, only to record
 * the true weight.
 */

async function submitReweigh(formData: FormData) {
  "use server";

  const eventId = String(formData.get("eventId") ?? "").trim();
  const verifiedWeightKg = Number(formData.get("verifiedWeightKg"));
  const notes = String(formData.get("notes") ?? "").trim();

  try {
    await api.recordReweigh(eventId, {
      verifiedWeightKg,
      ...(notes ? { notes } : {}),
    });
  } catch (error) {
    redirect(
      `/reweigh?eventId=${encodeURIComponent(eventId)}&error=${encodeURIComponent(messageOf(error))}`,
    );
  }

  revalidatePath("/reweigh");
  redirect(`/reweigh?eventId=${encodeURIComponent(eventId)}`);
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    // The backend's own message is the point here: "a variance of 8.2%
    // (1.640 kg) exceeds the 5% tolerance and must carry a stated reason"
    // tells hub staff exactly what to do next, which a generic failure
    // message cannot.
    return error.detail ?? `Request failed (${error.status}).`;
  }
  return "The backend did not respond, so nothing was changed.";
}

export default async function ReweighPage({
  searchParams,
}: {
  searchParams: Promise<{ eventId?: string; error?: string }>;
}) {
  const { eventId, error } = await searchParams;
  const trimmedId = eventId?.trim();
  // A weigh-in id is a full UUID; anything else typed here is treated as the
  // short lookup code the proof page prints (payloadHash.slice(0, 10)) — the
  // artifact a collector actually has in hand, since typing the raw id was
  // never the intended flow (see the proof page's own doc comment).
  const looksLikeUuid = trimmedId ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmedId) : false;

  let event: CollectionEvent | null = null;
  let existing: EventReweigh[] = [];
  let lookupError: string | null = null;

  if (trimmedId) {
    try {
      event = looksLikeUuid
        ? await api.getEvent(trimmedId)
        : await api.getEventByLookupCode(trimmedId);
      existing = await api.getReweigh(event.id);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : null;
      lookupError =
        status === 404
          ? "No weigh-in matches this id or lookup code."
          : status === 401 || status === 403
            ? "Not signed in."
            : status === 400
              ? // The backend's own message here is specific and actionable —
                // e.g. "N submissions match this code — use the full weigh-in
                // id instead" — a generic fallback would throw that away.
                (err instanceof ApiError ? (err.detail ?? "That id or code is not valid.") : "That id or code is not valid.")
              : "Could not reach the backend.";
    }
  }

  const latest = existing.at(-1) ?? null;

  return (
    <main>
      <PageHeader eyebrow="Verification hub" title="Reweigh" />
      <p className="page-intro">
          Enter the lookup code from the collector&rsquo;s proof page (or the full weigh-in id, found
          on the <Link href="/events">weigh-ins list</Link>) to look up what was claimed, then
          record what the hub scale actually reads. Within ±5% of the claim is recorded as verified;
          outside that is flagged and needs a note — either way the collector is paid the
          hub-verified weight.
        </p>

      <form className="confirm-body" style={{ maxWidth: "36rem" }}>
        <label htmlFor="eventId">
          Lookup code or weigh-in id
          <input
            id="eventId"
            name="eventId"
            defaultValue={trimmedId ?? ""}
            required
            placeholder="e.g. 0700123e3c"
          />
        </label>
        <div className="actions">
          <button className="btn" data-variant="primary" type="submit">
            Look up
          </button>
        </div>
      </form>

      {trimmedId && lookupError ? (
        <p className="error">
          {lookupError}
          {lookupError === "Not signed in." ? (
            <>
              {" "}
              <Link href="/login">Sign in</Link> to record a reweigh.
            </>
          ) : null}
        </p>
      ) : null}

      {error ? <p className="error">{decodeURIComponent(error)}</p> : null}

      {event ? (
        <>
          <h2>Weigh-in {event.id.slice(0, 8)}</h2>

          {event.quarantined ? (
            <div className="proof" data-state="broken">
              <h3>This submission is quarantined</h3>
              <p style={{ margin: 0, fontSize: "0.875rem" }}>
                It failed integrity checks at capture and was never included in a batch. Confirm
                with an operator before recording a reweigh against it.
              </p>
            </div>
          ) : null}

          <dl className="stats">
            <div className="stat">
              <dt>Material</dt>
              <dd style={{ fontSize: "1.25rem" }}>
                <Emoji>{materialEmoji(event.material)}</Emoji> {event.material}
              </dd>
            </div>
            <div className="stat">
              <dt>Claimed weight</dt>
              <dd>
                {formatKg(event.weightKg)}
                <small> kg</small>
              </dd>
            </div>
            <div className="stat">
              <dt>Captured</dt>
              <dd style={{ fontSize: "0.8125rem" }}>{formatDateTime(event.capturedAt)}</dd>
            </div>
          </dl>

          {latest ? (
            <>
              <h2>Reweigh recorded</h2>
              <div
                className="proof"
                data-state={
                  latest.status === "verified"
                    ? "verified"
                    : latest.status === "flagged"
                      ? "pending"
                      : "broken"
                }
              >
                <h3>{latest.status}</h3>
                <dl>
                  <dt>Claimed</dt>
                  <dd>{formatKg(latest.claimedWeightKg)} kg</dd>
                  <dt>Verified</dt>
                  <dd>{formatKg(latest.verifiedWeightKg)} kg</dd>
                  <dt>Variance</dt>
                  <dd>
                    {formatKg(latest.varianceKg)} kg ({Number(latest.variancePct)}%)
                  </dd>
                  {latest.notes ? (
                    <>
                      <dt>Notes</dt>
                      <dd>{latest.notes}</dd>
                    </>
                  ) : null}
                  <dt>Recorded</dt>
                  <dd>{formatDateTime(latest.verifiedAt)}</dd>
                </dl>
              </div>
              <p className="note">
                One reweigh per weigh-in — this one is done. Once verified, it becomes eligible
                for a <Link href="/payouts">payout</Link>.
              </p>
            </>
          ) : (
            <>
              <h2>Record a reweigh</h2>
              <form action={submitReweigh} className="confirm-body" style={{ maxWidth: "36rem" }}>
                <input type="hidden" name="eventId" value={event.id} />
                <label htmlFor="verifiedWeightKg">
                  Verified weight (kg) — what the hub scale reads
                  <input
                    id="verifiedWeightKg"
                    name="verifiedWeightKg"
                    type="number"
                    step="0.001"
                    min="0.001"
                    required
                  />
                </label>
                <label htmlFor="notes">
                  Notes — required if the weight differs from the claim by more than 5%
                  <input id="notes" name="notes" maxLength={500} placeholder="e.g. wet material" />
                </label>
                <div className="actions">
                  <button className="btn" data-variant="primary" type="submit">
                    Record reweigh
                  </button>
                </div>
              </form>
            </>
          )}
        </>
      ) : null}
    </main>
  );
}
