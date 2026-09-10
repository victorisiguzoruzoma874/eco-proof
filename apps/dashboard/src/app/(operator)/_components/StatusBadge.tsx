/**
 * A status, shown as a word on a tint.
 *
 * The word is always present and is never abbreviated to a dot or a colour:
 * "paid" and "rejected" are both muted earth tones in this palette, and a
 * reader with a red-green deficiency would otherwise be reading a coin flip.
 * The tint only ranks the word.
 */

/** The three tones the palette defines, plus the absence of one. */
export type Tone = "verified" | "pending" | "broken" | "neutral";

/**
 * Every `pending -> paid | rejected` queue in this product uses these three
 * words — payouts, withdrawals, catalog redemptions — so the mapping lives
 * here once rather than as a ternary at each call site. An unrecognised status
 * renders neutral rather than throwing: a new backend state should look
 * unremarkable, not break the page an operator is working in.
 */
export function toneForStatus(status: string): Tone {
  switch (status) {
    case "paid":
    case "sealed":
    case "processed":
    case "sold":
    case "approved":
    case "redeemed":
      return "verified";
    case "pending":
    case "requested":
    case "open":
      return "pending";
    case "rejected":
    case "failed":
    case "quarantined":
    case "cancelled":
      return "broken";
    default:
      return "neutral";
  }
}

export function StatusBadge({ status, tone }: { status: string; tone?: Tone }) {
  return (
    <span className="pill" data-tone={tone ?? toneForStatus(status)}>
      {status}
    </span>
  );
}
