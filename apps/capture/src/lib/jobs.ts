import { DEVICE_AUTH_HEADERS, canonicalDeviceRequest } from "@shared/device-auth";
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha2";
import type { DeviceIdentity } from "./identity";

/**
 * Reading work from the server, from a phone that holds no token.
 *
 * Weigh-in ingest authenticates by signing the payload. A job list has no
 * payload to sign, so the request line itself is the message: method, path,
 * device id, timestamp, nonce and a hash of the body, encoded by the shared
 * `canonicalDeviceRequest` both sides import. Same key, same curve, same trust
 * model as a weigh-in — which is what lets this work without ever putting a
 * standing credential on a shared field phone.
 */

export interface CollectorJob {
  id: string;
  hubId: string;
  hubName: string | null;
  hubCode: string | null;
  material: string;
  estimatedWeightKg: number | null;
  address: string | null;
  notes: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
  createdAt: string;
}

export interface CollectOutcome {
  requestId: string;
  eventId: string;
  payloadHash: string;
  redemptionCode: string;
  weightKg: number;
  material: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Build the headers that prove this device made this exact request.
 *
 * The body is hashed here rather than passed in already-hashed so the string
 * that gets signed and the string that gets sent are the same object — if the
 * caller serialised twice, a key-order difference between the two would fail
 * every signature with nothing to show for it.
 */
export function signRequest(
  identity: DeviceIdentity,
  deviceId: string,
  method: string,
  path: string,
  body: string | null,
): Record<string, string> {
  const timestamp = new Date().toISOString();
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const bodyHash = body ? toHex(sha256(new TextEncoder().encode(body))) : "";

  const message = canonicalDeviceRequest({ method, path, deviceId, timestamp, nonce, bodyHash });
  const signature = ed25519.sign(new TextEncoder().encode(message), fromHex(identity.privateKeyHex));

  return {
    [DEVICE_AUTH_HEADERS.deviceId]: deviceId,
    [DEVICE_AUTH_HEADERS.timestamp]: timestamp,
    [DEVICE_AUTH_HEADERS.nonce]: nonce,
    [DEVICE_AUTH_HEADERS.signature]: toBase64(signature),
  };
}

const SEEN_KEY = "proofchain.jobs.seen.v1";

/**
 * Fetch the jobs assigned to this device's collector.
 *
 * Short timeout: this is a background poll, and a request left hanging on a
 * bad link would stack up behind the next one. Missing a poll costs nothing —
 * the following one is 45 seconds away.
 */
export async function fetchAssignedJobs(
  backendUrl: string,
  identity: DeviceIdentity,
  deviceId: string,
): Promise<CollectorJob[]> {
  const path = "/requests/assigned";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(`${backendUrl}${path}`, {
      headers: { accept: "application/json", ...signRequest(identity, deviceId, "GET", path, null) },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`job list failed (${res.status})`);
    return (await res.json()) as CollectorJob[];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Post a doorstep collection: the signed weigh-in, against the request it
 * completes. Returns the redemption code to show the requester.
 *
 * No offline queue behind this one, unlike a plain weigh-in. The whole point
 * is to hand the requester a code while the collector is still standing there,
 * and a code cannot be minted on the device — it has to be unique across every
 * request in the database. A collector with no signal falls back to the normal
 * capture flow, and an operator links it later.
 */
export async function collectRequest(
  backendUrl: string,
  identity: DeviceIdentity,
  deviceId: string,
  requestId: string,
  payload: unknown,
  signature: string,
): Promise<CollectOutcome> {
  const path = `/requests/${requestId}/collect`;
  // Serialised once. The bytes that are hashed are the bytes that are sent.
  const body = JSON.stringify({ payload, signature });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(`${backendUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...signRequest(identity, deviceId, "POST", path, body),
      },
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      let message = `collection failed (${res.status})`;
      try {
        const parsed = JSON.parse(text) as { message?: string | string[] };
        if (parsed.message) {
          message = Array.isArray(parsed.message) ? parsed.message.join("; ") : parsed.message;
        }
      } catch {
        if (text) message = text.slice(0, 200);
      }
      throw new Error(message);
    }

    return (await res.json()) as CollectOutcome;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Which job ids this phone has already told the collector about.
 *
 * Kept in localStorage rather than memory so a phone that is backgrounded and
 * restored does not re-announce the same three jobs. Wrapped because private
 * browsing and blocked site data both make localStorage throw — a failure here
 * costs a duplicate notification, which must never be allowed to break the
 * poll that produced it.
 */
function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeSeen(ids: Set<string>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...ids]));
  } catch {
    /* no-op: see readSeen */
  }
}

/** The jobs in this list that the collector has not been shown before. */
export function newJobsSince(jobs: CollectorJob[]): CollectorJob[] {
  const seen = readSeen();
  const fresh = jobs.filter((job) => !seen.has(job.id));

  // Track only what is currently assigned. A completed job dropping off the
  // list also drops out of `seen`, so the set cannot grow without bound — and
  // a request cannot return to "assigned" once collected, so nothing can be
  // announced twice by being forgotten.
  writeSeen(new Set(jobs.map((job) => job.id)));
  return fresh;
}

/**
 * Tell the collector a job arrived.
 *
 * A system notification when permission was granted, so a phone in a pocket
 * still buzzes. The in-app banner is raised by the caller either way — this
 * function is the escalation, not the only signal, because notification
 * permission is routinely denied and a silently-dropped job is the one failure
 * this feature cannot have.
 */
export async function notifyNewJobs(jobs: CollectorJob[]): Promise<void> {
  if (jobs.length === 0) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const title = jobs.length === 1 ? "New pickup assigned" : `${jobs.length} new pickups assigned`;
  const first = jobs[0]!;
  const body =
    jobs.length === 1
      ? `${first.material} at ${first.address ?? first.hubName ?? "an address"}`
      : "Open ProofChain Capture to see them.";

  try {
    // Through the service worker when one is controlling this page: a
    // notification raised that way survives the tab being backgrounded, which
    // is exactly the state a collector's phone is in between jobs.
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification(title, { body, tag: "proofchain-jobs", icon: "/icon-192.png" });
      return;
    }
    new Notification(title, { body, tag: "proofchain-jobs", icon: "/icon-192.png" });
  } catch {
    // A notification that cannot be shown is not a reason to lose the job —
    // the in-app list has it regardless.
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}
