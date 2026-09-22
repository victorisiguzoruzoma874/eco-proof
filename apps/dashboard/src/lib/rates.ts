import type { CreditRate } from "./api";

/**
 * The credit rate each material earns right now, from the full rate history.
 *
 * `GET /credit-rates` returns every rate ever set, because a rate is changed by
 * adding a newer one rather than editing the old (so past credits can always be
 * re-derived). Anything shown as "the rate" must therefore pick one row per
 * material, by the same rule the backend credits with
 * (`WalletService.resolveRate`): the latest `effectiveFrom` that has already
 * arrived. A row scheduled for later is not today's rate yet.
 *
 * Global defaults only (`hubId: null`). A hub-specific override can beat these
 * at that hub, but these screens show one figure per material, as a guide.
 */
export function currentDefaultRates(rates: CreditRate[], now: Date = new Date()): CreditRate[] {
  const current = new Map<string, CreditRate>();
  for (const rate of rates) {
    if (rate.hubId !== null) continue;
    if (new Date(rate.effectiveFrom).getTime() > now.getTime()) continue;
    const held = current.get(rate.materialCode);
    if (!held || new Date(rate.effectiveFrom) > new Date(held.effectiveFrom)) {
      current.set(rate.materialCode, rate);
    }
  }
  // Richest first: the order people read "what is my material worth" in.
  return [...current.values()].sort(
    (a, b) => Number(b.creditsPerKg) - Number(a.creditsPerKg) || a.materialCode.localeCompare(b.materialCode),
  );
}
