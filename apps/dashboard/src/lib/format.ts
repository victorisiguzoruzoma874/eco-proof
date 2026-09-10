export function formatKg(value: number | string): string {
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

export function formatTonnes(kg: number | string): string {
  return (Number(kg) / 1000).toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatCurrency(value: number | string, currency = "NGN"): string {
  return Number(value).toLocaleString(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * A waste credit's Naira equivalent, at the product-decided 1 credit = ₦1
 * peg (see the wallet-workflow plan's "credit value and spending" addendum).
 * Deliberately not `formatCurrency`: that renders a formal two-decimal
 * currency amount, whereas credits are shown as plain counts elsewhere on
 * this page (`wallet.balanceCredits.toLocaleString()`) — this mirrors that
 * same plain-number style with a ₦ prefix so a balance reads as one
 * consistent figure, e.g. "127 credits (₦127)".
 */
export function formatNaira(value: number | string): string {
  return `₦${Number(value).toLocaleString()}`;
}

/**
 * A quick visual anchor for a material code in a select/list — not a claim
 * about resin identity, just something faster to scan than six similar-looking
 * three-letter codes. Codes come from `packages/shared/src/materials.ts`'s
 * `SEED_MATERIALS`; an operator-added material with no entry here still shows
 * fine, just without an emoji prefix — this must never block rendering an
 * otherwise-valid material.
 */
const MATERIAL_EMOJI: Record<string, string> = {
  PET: "🧴",
  HDPE: "🥛",
  LDPE: "🛍️",
  PP: "🥤",
  PS: "🍱",
  MIXED: "♻️",
};

export function materialEmoji(code: string): string {
  return MATERIAL_EMOJI[code.toUpperCase()] ?? "🧩";
}

export function shortHash(hash: string | null, chars = 10): string {
  if (!hash) return "—";
  return hash.length <= chars * 2 ? hash : `${hash.slice(0, chars)}…${hash.slice(-chars)}`;
}

/**
 * A batch is "verified" once it is sealed — sealing is what fixes its Merkle
 * root and freezes membership, which is the whole of what this system proves
 * about a batch. `open` is the only state with nothing yet to verify.
 */
export function batchTone(status: string): "verified" | "neutral" {
  return status === "open" ? "neutral" : "verified";
}
