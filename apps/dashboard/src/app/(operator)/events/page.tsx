import Link from "next/link";
import { api } from "@/lib/api";
import { formatDateTime, formatKg, materialEmoji, shortHash } from "@/lib/format";
import { Emoji } from "@/app/Emoji";
import { PageHeader } from "../_components/PageHeader";
import { LoadError } from "../_components/LoadError";

export const dynamic = "force-dynamic";

/**
 * The weigh-in feed, including quarantined records.
 *
 * Quarantined events are shown, never hidden: they are the raw material of fraud
 * detection and of the "% captured cleanly" pilot metric. An operator needs to
 * see a collector whose fixes keep landing outside the fence.
 */
export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ quarantined?: string }>;
}) {
  const { quarantined } = await searchParams;
  const onlyQuarantined = quarantined === "true";

  let events;
  try {
    events = await api.listEvents(
      onlyQuarantined ? "quarantined=true&limit=200" : "limit=200",
    );
  } catch (error) {
    return (
      <main>
        <PageHeader eyebrow="Field capture" title="Weigh-ins" />
        <LoadError error={error} resource="weigh-ins" />
      </main>
    );
  }

  const clean = events.filter((e) => !e.quarantined).length;

  return (
    <main>
      <PageHeader
        eyebrow="Field capture"
        title="Weigh-ins"
        actions={
          <nav className="segmented" aria-label="Filter weigh-ins">
            <Link href="/events" aria-current={onlyQuarantined ? undefined : "true"}>
              All
            </Link>
            <Link href="/events?quarantined=true" aria-current={onlyQuarantined ? "true" : undefined}>
              Quarantined only
            </Link>
          </nav>
        }
      />

      <dl className="stats">
        <div className="stat">
          <dt>Shown</dt>
          <dd>{events.length}</dd>
        </div>
        <div className="stat">
          <dt>Clean</dt>
          <dd>{clean}</dd>
        </div>
        <div className="stat">
          <dt>Quarantined</dt>
          <dd>{events.length - clean}</dd>
        </div>
        <div className="stat">
          <dt>Capture rate</dt>
          <dd>
            {events.length === 0 ? "—" : ((clean / events.length) * 100).toFixed(1)}
            <small> %</small>
          </dd>
        </div>
      </dl>

      <h2>{onlyQuarantined ? "Quarantined weigh-ins" : "Recent weigh-ins"}</h2>

      {events.length === 0 ? (
        <p className="empty">Nothing captured yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Captured</th>
                <th className="num">Weight</th>
                <th>Material</th>
                <th>Integrity</th>
                <th>Failed checks</th>
                <th>Batch</th>
                <th className="no-print">Proof</th>
                <th className="no-print">Reweigh</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const failed = (e.integrity?.findings ?? []).filter((f) => f.outcome === "fail");
                return (
                  <tr key={e.id}>
                    <td className="meta">{formatDateTime(e.capturedAt)}</td>
                    <td className="num">{formatKg(e.weightKg)} kg</td>
                    <td>
                      <Emoji>{materialEmoji(e.material)}</Emoji> {e.material}
                    </td>
                    <td>
                      <span
                        className="pill"
                        data-tone={
                          e.quarantined
                            ? "broken"
                            : e.integrity?.outcome === "warn"
                              ? "pending"
                              : "verified"
                        }
                      >
                        {e.quarantined ? "quarantined" : (e.integrity?.outcome ?? "unknown")}
                      </span>
                    </td>
                    <td className="hash">
                      {failed.length === 0
                        ? "—"
                        : failed.map((f) => f.check).join(", ")}
                    </td>
                    <td className="hash">
                      {e.batchId ? (
                        <Link href={`/batches/${e.batchId}`}>{e.batchId.slice(0, 8)}</Link>
                      ) : (
                        shortHash(null)
                      )}
                    </td>
                    <td className="no-print">
                      {e.quarantined ? (
                        "—"
                      ) : (
                        <Link className="btn" href={`/events/${e.id}/proof`}>
                          Proof
                        </Link>
                      )}
                    </td>
                    <td className="no-print">
                      {e.quarantined ? (
                        "—"
                      ) : (
                        <Link className="btn" href={`/reweigh?eventId=${e.id}`}>
                          Reweigh
                        </Link>
                      )}
                    </td>
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
