import { createHash, sign as cryptoSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalDeviceRequest,
  isDeviceRequestFresh,
  DEVICE_REQUEST_MAX_SKEW_SECONDS,
  type DeviceRequestEnvelope,
} from "../src/device-auth.js";
import {
  generateDeviceKeypair,
  publicKeyToBase64,
  verifyDeviceRequestSignature,
} from "../src/signing.js";

const envelope: DeviceRequestEnvelope = {
  method: "GET",
  path: "/requests/assigned",
  deviceId: "device-abc",
  timestamp: "2026-09-21T09:15:00.000Z",
  nonce: "b".repeat(32),
  bodyHash: "",
};

function sign(e: DeviceRequestEnvelope, privateKey: Parameters<typeof cryptoSign>[2]): string {
  return cryptoSign(null, Buffer.from(canonicalDeviceRequest(e), "utf8"), privateKey).toString("base64");
}

/**
 * A field phone holds no bearer token, so a signed request line is the only
 * credential it has for reading its own work. These tests pin the properties
 * that makes it worth anything: it covers every field, it cannot be moved to
 * another route or another body, and a foreign key cannot produce it.
 */
describe("device request signing", () => {
  it("verifies a signature the enrolled key produced", () => {
    const { privateKey, publicKey } = generateDeviceKeypair();
    const signature = sign(envelope, privateKey);

    expect(verifyDeviceRequestSignature(envelope, signature, publicKeyToBase64(publicKey))).toBe(true);
  });

  it("rejects a signature from a key that was never enrolled", () => {
    const { privateKey } = generateDeviceKeypair();
    const other = generateDeviceKeypair();

    expect(
      verifyDeviceRequestSignature(envelope, sign(envelope, privateKey), publicKeyToBase64(other.publicKey)),
    ).toBe(false);
  });

  /**
   * The replay that matters most: a signature captured from a harmless job-list
   * poll must not be reusable on the endpoint that completes a collection.
   */
  it("does not carry a signature from one path to another", () => {
    const { privateKey, publicKey } = generateDeviceKeypair();
    const signature = sign(envelope, privateKey);

    const moved = { ...envelope, path: "/requests/abc/collect" };
    expect(verifyDeviceRequestSignature(moved, signature, publicKeyToBase64(publicKey))).toBe(false);
  });

  it("does not carry a signature from one device id to another", () => {
    const { privateKey, publicKey } = generateDeviceKeypair();
    const signature = sign(envelope, privateKey);

    const impersonated = { ...envelope, deviceId: "device-xyz" };
    expect(verifyDeviceRequestSignature(impersonated, signature, publicKeyToBase64(publicKey))).toBe(false);
  });

  /**
   * The weight-swap attack. Without the body hash in the signed string, a
   * captured `collect` signature could be replayed against a body claiming a
   * different weight — which is the whole value being moved.
   */
  it("binds the signature to the request body", () => {
    const { privateKey, publicKey } = generateDeviceKeypair();

    const original = {
      ...envelope,
      method: "POST",
      path: "/requests/abc/collect",
      bodyHash: createHash("sha256").update('{"weightKg":12.5}').digest("hex"),
    };
    const signature = sign(original, privateKey);

    const tampered = {
      ...original,
      bodyHash: createHash("sha256").update('{"weightKg":125}').digest("hex"),
    };

    expect(verifyDeviceRequestSignature(original, signature, publicKeyToBase64(publicKey))).toBe(true);
    expect(verifyDeviceRequestSignature(tampered, signature, publicKeyToBase64(publicKey))).toBe(false);
  });

  it("returns false rather than throwing on malformed input", () => {
    const { publicKey } = generateDeviceKeypair();
    const key = publicKeyToBase64(publicKey);

    expect(verifyDeviceRequestSignature(envelope, "", key)).toBe(false);
    expect(verifyDeviceRequestSignature(envelope, "not-base64!!", key)).toBe(false);
    // Right encoding, wrong length — ed25519 signatures are exactly 64 bytes.
    expect(verifyDeviceRequestSignature(envelope, Buffer.alloc(32).toString("base64"), key)).toBe(false);
    expect(verifyDeviceRequestSignature(envelope, sign(envelope, generateDeviceKeypair().privateKey), "nonsense")).toBe(
      false,
    );
  });

  /**
   * A body-less request and one whose body happens to hash to nothing must not
   * canonicalise to the same string, which is why `bodyHash` is always its own
   * line rather than being omitted when empty.
   */
  it("keeps every field on its own line", () => {
    expect(canonicalDeviceRequest(envelope).split("\n")).toHaveLength(7);
  });

  it("normalises the method so casing cannot split the two sides", () => {
    expect(canonicalDeviceRequest({ ...envelope, method: "get" })).toBe(canonicalDeviceRequest(envelope));
  });
});

describe("device request freshness", () => {
  const now = new Date("2026-09-21T09:15:00.000Z");

  it("accepts a timestamp inside the window in both directions", () => {
    const behind = new Date(now.getTime() - (DEVICE_REQUEST_MAX_SKEW_SECONDS - 1) * 1000);
    const ahead = new Date(now.getTime() + (DEVICE_REQUEST_MAX_SKEW_SECONDS - 1) * 1000);

    expect(isDeviceRequestFresh(behind.toISOString(), now)).toBe(true);
    expect(isDeviceRequestFresh(ahead.toISOString(), now)).toBe(true);
  });

  /**
   * Both directions, deliberately: a phone whose clock runs fast is exactly as
   * common as one that runs slow, and rejecting only one would strand half the
   * devices in the field.
   */
  it("rejects a timestamp outside the window in both directions", () => {
    const stale = new Date(now.getTime() - (DEVICE_REQUEST_MAX_SKEW_SECONDS + 1) * 1000);
    const future = new Date(now.getTime() + (DEVICE_REQUEST_MAX_SKEW_SECONDS + 1) * 1000);

    expect(isDeviceRequestFresh(stale.toISOString(), now)).toBe(false);
    expect(isDeviceRequestFresh(future.toISOString(), now)).toBe(false);
  });

  it("rejects a timestamp it cannot parse", () => {
    expect(isDeviceRequestFresh("not a date", now)).toBe(false);
    expect(isDeviceRequestFresh("", now)).toBe(false);
  });
});
