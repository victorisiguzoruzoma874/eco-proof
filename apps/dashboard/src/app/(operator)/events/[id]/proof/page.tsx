import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { formatDateTime, formatKg, materialEmoji } from "@/lib/format";
import { Emoji } from "@/app/Emoji";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

/**
 * The collector's receipt.
 *
 * A collector who submits a weigh-in from their own device has no dashboard
 * account, so this route is reachable and readable without one (the backend
 * endpoint is `@Public()`) — the same reasoning as the batch report page. It
 * exists to hand the collector one thing: a short lookup code hub staff can
 * later use to find this exact submission and re-weigh it, matching Phase 1
 * decision #5 (plain printed code, no QR library).
 */
export default async function EventProofPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let event;
  try {
    event = await api.getEvent(id);
  } catch (error) {
    // Same reasoning as the batch report page: a collector checking this
    // without an account must be able to tell "no such weigh-in" apart from
    // "the service is temporarily unreachable" — those call for different
    // next steps, so they must not be collapsed into one vague message.
    const status = error instanceof ApiError ? error.status : null;

    const explanation =
      status === 404
        ? "No weigh-in exists with this identifier."
        : status === 401 || status === 403
          ? "This proof is not publicly readable. Sign in as an operator to view it."
          : "The lookup service could not be reached. This says nothing about the validity of the weigh-in, so try again shortly.";

    return (
      <main>
        <h1>Weigh-in proof</h1>
        <p className="error">{explanation}</p>
        <p className="note">
          Weigh-in <span className="hash">{id}</span>
          {status === null ? "" : ` · HTTP ${status}`}
        </p>
        <p className="no-print">
          <Link className="btn" href="/events">
            ← Weigh-ins
          </Link>
        </p>
      </main>
    );
  }

  const lookupCode = event.payloadHash.slice(0, 10);

  return (
    <main>
      <div className="page-head">
        <div>
          <p className="eyebrow">Proof of submission · captured {formatDateTime(event.capturedAt)}</p>
          <h1>Weigh-in receipt</h1>
        </div>
        <div className="actions no-print">
          <Link className="btn" href="/events">
            ← Weigh-ins
          </Link>
          <PrintButton />
        </div>
      </div>

      <p className="note no-print">
        Print this page (Ctrl/Cmd+P → Save as PDF), or simply keep it on this screen. Either way,
        bring it to the verification hub.
      </p>

      {event.quarantined ? (
        <div className="proof" data-state="broken">
          <h3>This submission did not pass verification</h3>
          <p style={{ margin: 0, fontSize: "0.875rem" }}>
            This weigh-in was flagged and quarantined at capture time, so it was never included in
            a batch. It may not be eligible for re-weigh and payout. Hub staff should check the
            weigh-in record in the dashboard before acting on the code below.
          </p>
        </div>
      ) : null}

      <h2>Lookup code</h2>
      <div className="lookup-code-box">
        <p className="lookup-code">{lookupCode}</p>
        <p className="hash" style={{ marginTop: "0.75rem" }}>
          Full reference: {event.payloadHash}
        </p>
      </div>
      <p className="note">
        Present this at the verification hub with your collected material to be re-weighed and
        paid.
      </p>

      <h2>Submission details</h2>
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

      <div className="table-wrap" style={{ marginTop: "1.5rem" }}>
        <table className="table--kv">
          <tbody>
            <tr>
              <th>Collector id</th>
              <td className="hash">{event.collectorId}</td>
            </tr>
            <tr>
              <th>Hub id</th>
              <td className="hash">{event.hubId}</td>
            </tr>
            <tr>
              <th>Weigh-in id</th>
              <td className="hash">{event.id}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>
  );
}
