/**
 * Device-signed read requests.
 *
 * A field phone holds no bearer token — that is deliberate (see
 * `signing.ts`): a shared phone must not carry standing credentials, and a
 * token would expire while the device sits offline. But a collector still
 * needs to *read* the jobs assigned to them, and a GET has no signed payload
 * to piggyback on.
 *
 * So the request itself is the message. The device signs a canonical string
 * over the method, the path, its own device id, a timestamp and a nonce, and
 * sends the signature in a header. The server rebuilds the identical string
 * and verifies it against the enrolled public key — the same key, the same
 * curve, the same trust model as a weigh-in, just covering a request line
 * instead of a weight.
 *
 * This file is free of Node built-ins on purpose, exactly like
 * `canonical-core.ts`: the browser and the server must produce byte-identical
 * strings, so they import the one implementation rather than each keeping a
 * copy that can drift.
 */

/** Header names carrying the device's proof. Lowercase — HTTP/2 requires it. */
export const DEVICE_AUTH_HEADERS = {
  deviceId: "x-proofchain-device",
  timestamp: "x-proofchain-timestamp",
  nonce: "x-proofchain-nonce",
  signature: "x-proofchain-signature",
} as const;

/**
 * How far a device clock may drift from the server's before a signed request
 * is refused.
 *
 * Wider than it sounds necessary, and deliberately so: a field phone that has
 * been offline for hours comes back with a clock that NTP has not yet
 * corrected, and refusing its first request would strand the collector at a
 * doorstep. Replay inside the window is bounded by the nonce being part of
 * the signed string, so a wider window costs freshness, not authenticity.
 */
export const DEVICE_REQUEST_MAX_SKEW_SECONDS = 300;

export interface DeviceRequestEnvelope {
  /** Uppercase HTTP method, e.g. "GET". */
  method: string;
  /** Path only — no origin, no query string. e.g. "/requests/assigned". */
  path: string;
  deviceId: string;
  /** ISO-8601 UTC, from the device clock. */
  timestamp: string;
  /** Random per-request value; makes an intercepted signature single-use. */
  nonce: string;
  /**
   * sha256 hex of the request body, or "" for a body-less request.
   *
   * Without this a captured signature could be replayed onto a *different*
   * body at the same path — which for `POST /requests/:id/collect` would mean
   * swapping the weight. The hash is computed by the caller because hashing
   * differs by platform (WebCrypto vs node:crypto) while this encoder must not.
   */
  bodyHash: string;
}

/**
 * The exact bytes both sides sign and verify.
 *
 * Newline-separated rather than JSON: there is no nesting to represent, and a
 * fixed field order removes any question of key ordering mattering. Every
 * field is present in every message — an empty `bodyHash` is still its own
 * line, so a body-less request can never canonicalise to the same string as
 * one whose body happened to hash to nothing.
 */
export function canonicalDeviceRequest(envelope: DeviceRequestEnvelope): string {
  return [
    "proofchain.devicereq.v1",
    envelope.method.toUpperCase(),
    envelope.path,
    envelope.deviceId,
    envelope.timestamp,
    envelope.nonce,
    envelope.bodyHash,
  ].join("\n");
}

/**
 * Whether a signed request's timestamp is close enough to now.
 *
 * Absolute difference, not "not in the future": a device clock that runs fast
 * is exactly as common as one that runs slow, and rejecting only one direction
 * would strand half the phones.
 */
export function isDeviceRequestFresh(
  timestamp: string,
  now: Date,
  maxSkewSeconds: number = DEVICE_REQUEST_MAX_SKEW_SECONDS,
): boolean {
  const sent = Date.parse(timestamp);
  if (Number.isNaN(sent)) return false;
  return Math.abs(now.getTime() - sent) <= maxSkewSeconds * 1000;
}
