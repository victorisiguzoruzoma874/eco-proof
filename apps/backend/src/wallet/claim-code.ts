import { createHash } from "node:crypto";

/**
 * Walk-in claim codes: the string behind the QR a collector's phone shows after
 * a weigh-in (see `WeighInClaimEntity`).
 *
 * Minted on the phone by `apps/capture/src/lib/claim.ts`, which must use this
 * same alphabet and length. Ten characters from a 32-letter alphabet is 50 bits:
 * far beyond guessing at the rate `POST /wallet/redeem` allows, and still short
 * enough to type from the screen when a camera will not focus. The alphabet is
 * the redemption-code one (no I, O, 0 or 1), because this is read by eye too.
 *
 * Deliberately a different length from a pickup's 8-character redemption code,
 * so the two can never collide and one input field can take either.
 */
export const CLAIM_CODE_LENGTH = 10;
export const CLAIM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{10}$/;

/** Uppercase and strip what a person adds when typing a code back in. */
export function normaliseClaimCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, "");
}

/**
 * What is stored and looked up. SHA-256 without a salt is enough here: the
 * input is 50 random bits rather than a human-chosen password, so there is no
 * dictionary to precompute against.
 */
export function hashClaimCode(code: string): string {
  return createHash("sha256").update(normaliseClaimCode(code)).digest("hex");
}
