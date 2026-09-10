import Link from "next/link";
import { api, ApiError, kg } from "@/lib/api";
import { batchTone, formatDateTime, formatKg, materialEmoji, shortHash } from "@/lib/format";
import { Emoji } from "@/app/Emoji";
import { PageHeader } from "./_components/PageHeader";
import { LoadError } from "./_components/LoadError";

export const dynamic = "force-dynamic";

export default async function BatchesPage() {
  let batches;
  try {
    batches = await api.listBatches();
  } catch (error) {
    const unauthorised =
      error instanceof ApiError && (error.status === 401 || error.status === 403);
    return (
      <main>
        <PageHeader eyebrow="Evidence" title="Batches" />
        <LoadError error={error} resource="the batch list" />
      </main>
    );
  }

  const sealed = batches.filter((b) => b.status !== "open").length;
  const totalKg = batches.reduce((sum, b) => sum + kg(b.totalWeightKg), 0);

  return (
    <main>
      <PageHeader eyebrow="Evidence" title="Batches" />
      <p className="page-intro">
          A batch becomes evidence at seal, freezing its membership and fixing its Merkle root.
        </p>

      <dl className="stats">
        <div className="stat">
          <dt>Batches</dt>
          <dd>{batches.length}</dd>
        </div>
        <div className="stat">
          <dt>Sealed</dt>
          <dd>
            {sealed}
            <small> / {batches.length}</small>
          </dd>
        </div>
        <div className="stat">
          <dt>Collected</dt>
          <dd>
            {formatKg(totalKg)}
            <small> kg</small>
          </dd>
        </div>
        <div className="stat">
          <dt>Tonnes</dt>
          <dd>{(totalKg / 1000).toFixed(4)}</dd>
        </div>
      </dl>

      <h2>All batches</h2>

      {batches.length === 0 ? (
        <p className="empty">No batches yet. Open one once weigh-ins have been captured.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Batch</th>
                <th>Material</th>
                <th>Status</th>
                <th className="num">Weigh-ins</th>
                <th className="num">Weight</th>
                <th>Merkle root</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link href={`/batches/${b.id}`} className="hash">
                      {b.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td>
                    <Emoji>{materialEmoji(b.material)}</Emoji> {b.material}
                  </td>
                  <td>
                    <span className="pill" data-tone={batchTone(b.status)}>
                      {b.status}
                    </span>
                  </td>
                  <td className="num">{b.eventCount}</td>
                  <td className="num">{formatKg(b.totalWeightKg)} kg</td>
                  <td className="hash">{shortHash(b.merkleRoot, 8)}</td>
                  <td className="meta">{formatDateTime(b.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
