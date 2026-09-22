import { describe, expect, it } from "vitest";
import { CLAIM_CODE_LENGTH, formatClaimCode, generateClaimCode } from "../src/lib/claim";

/** The server's own pattern (apps/backend/src/wallet/claim-code.ts). */
const SERVER_PATTERN = /^[A-HJ-NP-Z2-9]{10}$/;

describe("generateClaimCode", () => {
  it("produces codes the server accepts", () => {
    for (let i = 0; i < 500; i++) {
      expect(generateClaimCode()).toMatch(SERVER_PATTERN);
    }
  });

  it("never uses the glyphs a person would misread", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateClaimCode()).join(""));
    for (const glyph of ["I", "O", "0", "1"]) expect(seen.has(glyph)).toBe(false);
  });

  it("maps every byte value onto the alphabet", () => {
    const allLow = generateClaimCode((b) => b.fill(0));
    const allHigh = generateClaimCode((b) => b.fill(255));
    expect(allLow).toBe("A".repeat(CLAIM_CODE_LENGTH));
    expect(allHigh).toBe("9".repeat(CLAIM_CODE_LENGTH));
  });

  it("is not the same code twice", () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateClaimCode()));
    expect(codes.size).toBe(1000);
  });
});

describe("formatClaimCode", () => {
  it("splits into two groups of five for reading aloud", () => {
    expect(formatClaimCode("K7M2QRT9XA")).toBe("K7M2Q-RT9XA");
  });
});
