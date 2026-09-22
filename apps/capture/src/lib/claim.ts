/**
 * Walk-in claim codes: what the QR after a plain weigh-in encodes. Whoever
 * scans it first in their ProofChain wallet is credited for the weigh-in.
 *
 * Minted here, on the phone, because capture works offline and the customer is
 * standing at the scale now. The phone sends it to the server alongside the
 * weigh-in when it syncs; the server keeps only its hash. The format must match
 * `apps/backend/src/wallet/claim-code.ts`: ten characters from the same 32-letter
 * alphabet as a pickup's redemption code, which leaves out I, O, 0 and 1 so a
 * code read off the screen can be typed back without guessing.
 */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CLAIM_CODE_LENGTH = 10;

/**
 * A fresh code from the platform CSPRNG. 256 is an exact multiple of 32, so
 * `byte % 32` is uniform and needs no rejection step.
 */
export function generateClaimCode(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const bytes = random(new Uint8Array(CLAIM_CODE_LENGTH));
  let code = "";
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];
  return code;
}

/**
 * For reading off the screen: two groups of five. The wallet strips the dash,
 * so a customer can type it either way.
 */
export function formatClaimCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}
