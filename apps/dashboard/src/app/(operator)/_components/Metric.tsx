import type { Tone } from "./StatusBadge";

/**
 * A summary figure, as its own bordered block.
 *
 * `note` is for the second reading of the same fact — a naira value beside a
 * credit count — and never for a different fact. `tone` colours the figure
 * only: the card keeps the plain surface, because four tinted cards in a row
 * is a traffic light rather than a summary.
 */
export function Metric({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  note?: string;
  tone?: Tone;
}) {
  return (
    <div className="metric" data-tone={tone}>
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
      {note ? <p className="metric-note">{note}</p> : null}
    </div>
  );
}

/**
 * Four up on desktop, two on a tablet, one on a phone — the grid does that
 * itself from a 13rem column floor, so a page never has to name a breakpoint
 * to lay its metrics out.
 */
export function MetricGrid({ children }: { children: React.ReactNode }) {
  return <div className="metrics">{children}</div>;
}
