import { describe, expect, it } from "vitest";
import { THEME_KEY, effectiveTheme, readStoredTheme } from "../src/lib/theme";

function storageWith(value: string | null) {
  return { getItem: (key: string) => (key === THEME_KEY ? value : null) };
}

describe("readStoredTheme", () => {
  it("returns an explicit choice", () => {
    expect(readStoredTheme(storageWith("dark"))).toBe("dark");
    expect(readStoredTheme(storageWith("light"))).toBe("light");
  });

  it("treats no choice as 'follow the system'", () => {
    expect(readStoredTheme(storageWith(null))).toBeNull();
  });

  it("ignores a value it did not write", () => {
    expect(readStoredTheme(storageWith("sepia"))).toBeNull();
  });

  it("survives storage that throws, as private browsing does", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(readStoredTheme(blocked)).toBeNull();
  });
});

describe("effectiveTheme", () => {
  it("follows the system when nothing was chosen", () => {
    expect(effectiveTheme(null, true)).toBe("dark");
    expect(effectiveTheme(null, false)).toBe("light");
  });

  it("lets an explicit choice win in both directions", () => {
    expect(effectiveTheme("light", true)).toBe("light");
    expect(effectiveTheme("dark", false)).toBe("dark");
  });
});
