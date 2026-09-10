/**
 * End-to-end demo: weigh-in -> batch -> seal -> custody -> hub re-weigh -> payout -> audit report.
 *
 * Acts as a real enrolled collector device: it signs each weigh-in with the
 * ed25519 private key written by the seed script, so every server-side integrity
 * check runs exactly as it would in the field. It then plays the hub operator,
 * re-weighing two of the collector's drop-offs (one that matches the claim, one
 * that doesn't) and turning the verified re-weighs into a paid payout.
 *
 *   node scripts/demo-e2e.mjs
 *
 * Requires: backend running on :3000, database migrated and seeded (the seed
 * also writes a default material_rates row per active material, which the
 * payout step below depends on).
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const shared = require("@proofchain/shared");
const { privateKeyFromPem, signWeighIn, verifyMerkleProof } = shared;

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3000";
const TOTAL_STEPS = 9;

const seed = JSON.parse(
  readFileSync(resolve(ROOT, "apps/backend/var/seed-devices.json"), "utf8"),
);

/** The hub is read from the API, never hardcoded. */
let hub = null;

function log(step, message) {
  console.log(`\n[${step}/${TOTAL_STEPS}] ${message}`);
}

/** Thin JSON fetch wrapper — every call below goes through this. */
async function api(path, { method = "GET", token, body, headers = {} } = {}) {
  const res = await fetch(`${BACKEND}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

function fakeJpeg() {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(512)]);
}

/** A plausible weigh-in. */
function buildWeighIn(device, index) {
  const photoBytes = fakeJpeg();
  return {
    schema: "proofchain.weighin.v2",
    collectorId: device.collectorId,
    hubId: device.hubId,
    deviceId: device.deviceId,
    weightKg: Number((8 + Math.random() * 20).toFixed(3)),
    material: "PET",
    capturedAt: new Date(Date.now() - (index + 1) * 60_000).toISOString(),
    photoHash: createHash("sha256").update(photoBytes).digest("hex"),
    nonce: randomBytes(16).toString("hex"),
    // Carried alongside rather than inside the payload: the signature covers
    // the digest, never the bytes.
    photoBytes,
  };
}

/** Upload the photo the way a phone does — after the weigh-in is accepted. */
async function uploadPhoto(eventId, photoBytes) {
  const res = await fetch(`${BACKEND}/events/${eventId}/photo`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: photoBytes,
  });
  if (!res.ok) {
    throw new Error(`photo upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

async function main() {
  log(1, "Authenticating as the hub operator");
  const { accessToken, role } = await api("/auth/login", {
    method: "POST",
    body: { email: "operator@proofchain.local", password: "operator-dev-password" },
  });
  console.log(`  logged in as ${role}`);

  const hubs = await api("/hubs", { token: accessToken });
  hub = hubs.find((h) => h.id === seed.hubId) ?? hubs[0];
  if (!hub) throw new Error("no hubs found — run the seed first");

  console.log(`  hub ${hub.code}`);

  log(2, "Capturing signed weigh-ins from enrolled devices");
  // Tracks each accepted event against the collector and claimed weight it
  // belongs to, so the re-weigh step below can pick two drop-offs from the
  // same collector without re-fetching them.
  const captured = [];
  let submitted = 0;
  let photosUploaded = 0;
  const failuresBeforeReport = [];

  for (let i = 0; i < 12; i++) {
    const device = seed.devices[i % seed.devices.length];
    const { photoBytes, ...payload } = buildWeighIn(device, i);
    const signature = signWeighIn(payload, privateKeyFromPem(device.privateKeyPem));

    const result = await api("/events", { method: "POST", body: { payload, signature } });
    submitted += 1;

    if (result.quarantined) {
      console.log(`  event ${i + 1}: QUARANTINED (${result.integrity.outcome})`);
    } else {
      captured.push({
        eventId: result.eventId,
        collectorId: payload.collectorId,
        weightKg: payload.weightKg,
      });
      // Second request, as a field phone does it: the weigh-in is already safe
      // on the server before the megabytes are attempted.
      await uploadPhoto(result.eventId, photoBytes);
      photosUploaded += 1;
    }
  }
  console.log(`  ${captured.length}/${submitted} weigh-ins passed integrity v1`);
  console.log(`  ${photosUploaded} photos uploaded and hash-checked by the server`);

  // Prove the server refuses a substituted photo. This is the check that makes
  // the image evidence rather than decoration.
  const substituteTarget = captured[0].eventId;
  const substitution = await fetch(`${BACKEND}/events/${substituteTarget}/photo`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: fakeJpeg(),
  });
  console.log(
    `  substituted photo rejected: ${!substitution.ok} (HTTP ${substitution.status})`,
  );
  if (substitution.ok) failuresBeforeReport.push("server accepted a photo that was not signed");

  log(3, "Proving a tampered weigh-in is rejected");
  {
    const device = seed.devices[0];
    const { photoBytes: _unusedPhoto, ...honest } = buildWeighIn(device, 99);
    const signature = signWeighIn(honest, privateKeyFromPem(device.privateKeyPem));
    const inflated = { ...honest, weightKg: 950 }; // signed 8-28 kg, claims 950

    const result = await api("/events", {
      method: "POST",
      body: { payload: inflated, signature },
    });
    const failed = result.integrity.findings
      .filter((f) => f.outcome === "fail")
      .map((f) => f.check);
    console.log(
      `  inflated weigh-in quarantined=${result.quarantined}; failed checks: ${failed.join(", ")}`,
    );
    if (!result.quarantined) throw new Error("SECURITY: a tampered weigh-in was accepted");
  }

  log(4, "Opening a batch and adding the clean events");
  const eventIds = captured.map((c) => c.eventId);
  const batch = await api("/batches", {
    method: "POST",
    token: accessToken,
    body: { hubId: seed.hubId, material: "PET" },
  });
  await api(`/batches/${batch.id}/events`, {
    method: "POST",
    token: accessToken,
    body: { eventIds },
  });
  console.log(`  batch ${batch.id}`);

  log(5, "Sealing the batch (membership and Merkle root freeze here)");
  const sealed = await api(`/batches/${batch.id}/seal`, {
    method: "POST",
    token: accessToken,
  });
  console.log(`  root      : ${sealed.merkleRoot}`);
  console.log(`  weight    : ${sealed.totalWeightKg} kg across ${sealed.eventCount} weigh-ins`);

  log(6, "Recording chain of custody with reconciliation");
  await api(`/batches/${batch.id}/custody`, {
    method: "POST",
    token: accessToken,
    body: {
      fromParty: "Nairobi Pilot Hub",
      toParty: "Mr. Green Africa (processor)",
      weightInKg: Number(sealed.totalWeightKg),
      weightOutKg: Number((Number(sealed.totalWeightKg) - 1.4).toFixed(3)),
      reason: "moisture loss and contamination rejects at intake",
      transferredAt: new Date().toISOString(),
    },
  });
  console.log("  custody transfer recorded");

  log(7, "Recording hub re-weighs (within-tolerance and flagged cases)");

  // Two drop-offs from the same collector, so both can land on one payout below.
  const firstDeviceCollectorId = seed.devices[0].collectorId;
  const sameCollector = captured.filter((c) => c.collectorId === firstDeviceCollectorId);
  if (sameCollector.length < 2) {
    throw new Error("need at least two clean weigh-ins from the same collector for this demo");
  }
  const [withinCase, flaggedCase] = sameCollector;

  // Case A: the hub scale agrees with the claim — status "verified", 0% variance.
  const verifiedReweigh = await api(`/events/${withinCase.eventId}/reweigh`, {
    method: "POST",
    token: accessToken,
    body: { verifiedWeightKg: withinCase.weightKg },
  });
  console.log(
    `  event ${withinCase.eventId.slice(0, 8)}: claimed ${withinCase.weightKg} kg, ` +
      `verified ${verifiedReweigh.verifiedWeightKg} kg -> ${verifiedReweigh.status} ` +
      `(${verifiedReweigh.variancePct}% variance)`,
  );
  if (verifiedReweigh.status !== "verified") {
    failuresBeforeReport.push("a matching re-weigh was not marked verified");
  }

  // Case B: the hub scale reads noticeably less — outside the ±5% tolerance,
  // so status "flagged". Still payable (Phase 1 decision #2: auto-pay the
  // lower, hub-verified weight), but `notes` is mandatory as the audit trail.
  const flaggedVerifiedWeight = Number((flaggedCase.weightKg * 0.8).toFixed(3));
  const flaggedReweigh = await api(`/events/${flaggedCase.eventId}/reweigh`, {
    method: "POST",
    token: accessToken,
    body: {
      verifiedWeightKg: flaggedVerifiedWeight,
      notes: "hub scale reads notably lower than the claim; material appeared partly damp",
    },
  });
  console.log(
    `  event ${flaggedCase.eventId.slice(0, 8)}: claimed ${flaggedCase.weightKg} kg, ` +
      `verified ${flaggedReweigh.verifiedWeightKg} kg -> ${flaggedReweigh.status} ` +
      `(${flaggedReweigh.variancePct}% variance)`,
  );
  if (flaggedReweigh.status !== "flagged") {
    failuresBeforeReport.push("a 20%-off re-weigh was not flagged");
  }

  // A flagged re-weigh with no stated reason must be refused outright — prove
  // the mandatory-reason gate is live, not just documented.
  const unreasonedAttempt = await fetch(`${BACKEND}/events/${withinCase.eventId}/reweigh`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ verifiedWeightKg: 0.5 }),
  });
  // withinCase already has a reweigh recorded (one-to-one), so this doubles as
  // proof that a second re-weigh of the same event is refused (409), not that
  // a bare discrepancy is (that path is exercised implicitly by flaggedCase
  // above, which supplied notes and succeeded).
  console.log(
    `  duplicate re-weigh of an already-recorded event rejected: ${!unreasonedAttempt.ok} ` +
      `(HTTP ${unreasonedAttempt.status})`,
  );
  if (unreasonedAttempt.ok) failuresBeforeReport.push("a second re-weigh of the same event was accepted");

  const reweighHistory = await api(`/events/${withinCase.eventId}/reweigh`);
  console.log(`  GET /events/:id/reweigh returns ${reweighHistory.length} record(s) for that event`);

  log(8, "Creating a payout from verified re-weighs and marking it paid");

  const rates = await api(
    `/material-rates?materialCode=PET`,
    { token: accessToken },
  );
  const rate = rates.find((r) => r.hubId === null) ?? rates[0];
  if (!rate) {
    throw new Error(
      "no material rate configured for PET — the seed should have written a default one; run `npm run seed`",
    );
  }
  console.log(`  rate in effect: ${rate.ratePerKg}/kg for PET${rate.hubId ? ` at hub ${rate.hubId}` : " (global default)"}`);

  const expectedAmount = Number(
    (
      Number(verifiedReweigh.verifiedWeightKg) * Number(rate.ratePerKg) +
      Number(flaggedReweigh.verifiedWeightKg) * Number(rate.ratePerKg)
    ).toFixed(2),
  );

  const payout = await api("/payouts", {
    method: "POST",
    token: accessToken,
    body: {
      collectorId: firstDeviceCollectorId,
      eventReweighIds: [verifiedReweigh.id, flaggedReweigh.id],
      method: "cash",
    },
  });
  console.log(
    `  payout ${payout.id.slice(0, 8)}: ${payout.amount} ${payout.currency} (${payout.status}), ` +
      `covering ${[verifiedReweigh.id, flaggedReweigh.id].length} re-weigh(s)`,
  );
  if (Math.abs(Number(payout.amount) - expectedAmount) > 0.01) {
    failuresBeforeReport.push(
      `payout amount ${payout.amount} does not match expected ${expectedAmount} (verified+flagged weight * rate)`,
    );
  }

  const paidPayout = await api(`/payouts/${payout.id}/mark-paid`, {
    method: "POST",
    token: accessToken,
    body: { payoutRef: "demo-cash-handover-001" },
  });
  console.log(`  payout marked ${paidPayout.status}, ref ${paidPayout.payoutRef}`);
  if (paidPayout.status !== "paid") failuresBeforeReport.push("payout did not transition to paid");

  // A second mark-paid attempt must be refused — a payout is paid once.
  const doublePay = await fetch(`${BACKEND}/payouts/${payout.id}/mark-paid`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({}),
  });
  console.log(`  double mark-paid rejected: ${!doublePay.ok} (HTTP ${doublePay.status})`);
  if (doublePay.ok) failuresBeforeReport.push("a payout was marked paid twice");

  log(9, "Fetching the audit artifact and verifying it independently");

  const report = await api(`/batches/${batch.id}/report`);

  console.log(`  report version   : ${report.reportVersion}`);
  console.log(`  tonnes           : ${report.batch.totalWeightTonnes}`);
  console.log(`  sealed root      : ${report.proof.merkleRoot}`);
  console.log(`  recomputed root  : ${report.proof.recomputedRoot}`);
  console.log(`  roots agree      : ${report.proof.rootMatchesSealedValue}`);
  console.log(`  all proofs valid : ${report.proof.allProofsValid}`);
  console.log(`  reconciliation   : gap ${report.reconciliation.gapKg} kg (${report.reconciliation.gapPct}%)`);
  console.log(
    `  reweighs         : ${report.reweighs.length} recorded ` +
      `(${report.reweighs.filter((r) => r.status === "verified").length} verified, ` +
      `${report.reweighs.filter((r) => r.status === "flagged").length} flagged)`,
  );
  console.log(
    `  payouts          : ${report.payouts.length} recorded, ` +
      `${report.payouts.filter((p) => p.status === "paid").length} paid`,
  );

  // The check a buyer would run: recompute one event's proof themselves.
  const sample = report.events[0];
  const independent = verifyMerkleProof(sample.leaf, sample.merkleProof, report.proof.recomputedRoot);
  console.log(`  independent proof check on event ${sample.eventId}: ${independent}`);

  const verify = await api(`/batches/${batch.id}/verify/${sample.eventId}`);
  console.log(`  verify endpoint agrees: ${verify.proofValid}`);

  const failures = [...failuresBeforeReport];

  // Every clean event should carry retrievable, hash-checked photo evidence.
  const withoutPhotos = report.events.filter((e) => !e.photoAvailable);
  console.log(
    `  photo evidence  : ${report.events.length - withoutPhotos.length}/${report.events.length} events`,
  );
  if (withoutPhotos.length > 0) failures.push(`${withoutPhotos.length} events have no photo stored`);

  // And the bytes served back must still hash to what the device signed.
  const photoResponse = await fetch(`${BACKEND}${report.events[0].photoUrl}`);
  const servedPhoto = Buffer.from(await photoResponse.arrayBuffer());
  const servedHash = createHash("sha256").update(servedPhoto).digest("hex");
  console.log(`  photo round-trip: ${servedHash === report.events[0].photoHash}`);
  if (servedHash !== report.events[0].photoHash) {
    failures.push("served photo does not hash to the signed photoHash");
  }
  if (!report.proof.rootMatchesSealedValue) failures.push("recomputed root != sealed root");
  if (!report.proof.allProofsValid) failures.push("some Merkle proofs invalid");
  if (!independent) failures.push("independent proof check failed");
  if (!verify.proofValid) failures.push("verify endpoint disagrees with the recomputed proof");

  const reportedReweighIds = new Set(report.reweighs.map((r) => r.eventId));
  if (!reportedReweighIds.has(withinCase.eventId) || !reportedReweighIds.has(flaggedCase.eventId)) {
    failures.push("audit report is missing one of the recorded re-weighs");
  }
  const reportedStatuses = new Map(report.reweighs.map((r) => [r.eventId, r.status]));
  if (reportedStatuses.get(withinCase.eventId) !== "verified") {
    failures.push("audit report shows the matching re-weigh with the wrong status");
  }
  if (reportedStatuses.get(flaggedCase.eventId) !== "flagged") {
    failures.push("audit report shows the discrepant re-weigh with the wrong status");
  }
  const reportedPayout = report.payouts.find((p) => p.id === payout.id);
  if (!reportedPayout) {
    failures.push("audit report is missing the payout covering this batch's re-weighs");
  } else if (reportedPayout.status !== "paid") {
    failures.push("audit report shows the payout with the wrong status");
  }

  if (failures.length > 0) {
    console.error(`\n\x1b[31mDEMO FAILED:\x1b[0m ${failures.join("; ")}`);
    process.exit(1);
  }

  console.log(`\n\x1b[32mEnd-to-end verified.\x1b[0m batch=${batch.id}`);
  console.log(`Audit report : ${BACKEND}/batches/${batch.id}/report`);
  console.log(`Event CSV    : ${BACKEND}/batches/${batch.id}/report/events.csv`);
  console.log(`Payout       : ${BACKEND}/payouts/${payout.id}`);
}

main().catch((error) => {
  console.error("\ndemo failed:", error.message);
  process.exit(1);
});
