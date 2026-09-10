# Verification Guide

**How a hub operator verifies a collector's submission, and how an auditor independently checks a payout.**

This guide covers two different people checking two different things:

1. **A hub operator**, verifying one collector's weigh-in at the moment of drop-off — looking it up, physically re-weighing the material, and recording what the scale actually reads.
2. **An auditor or credit buyer**, independently checking — after the fact, from a downloaded audit report — that a batch's Merkle proofs hold up and that a payout's amount matches the verified weight it claims to be paying for, at the rate that was actually in effect.

Neither task requires an account with us to check our claims. The audit report is public, and its Merkle proofs and arithmetic can be recomputed with nothing but `curl` and `node`.

## Part 1: Verifying a Submission at the Hub

### Step 1: Get the Lookup Code or Event Id

A collector who submitted a weigh-in has a printable proof page —
`/events/:id/proof` on the dashboard — showing a short **lookup code** (the
first 10 characters of the event's `payloadHash`, computed identically on the
device and the server) and the full weigh-in id. They bring one of these,
along with the material, to the hub.

If you only have the lookup code, the full event id is on the same page —
ask the collector to show it, or search the dashboard's weigh-ins list for an
id starting with that prefix. `GET /events` is a JWT-protected list endpoint;
`GET /events/:id` is public and takes the full id.

### Step 2: Look Up the Claim

On the dashboard, go to **Reweigh** and enter the event id — or over the API:

```bash
curl http://localhost:3000/events/<event_id> | jq '.'
```

This returns the collector's claim: material, claimed weight, capture
timestamp, and whether the event was quarantined at ingest (a quarantined
event failed an integrity check and was never batched — confirm with an
operator before acting on it; it may not be eligible for payout).

### Step 3: Physically Re-weigh the Material

This is the step that actually verifies anything. Everything before it —
the signature, the integrity checks, the Merkle seal — establishes that the
collector's *claim* hasn't been tampered with since capture. None of it
establishes that the claim was *true*. Put the material on the hub's scale and
read the number yourself.

### Step 4: Record the Re-weigh

```bash
curl -X POST http://localhost:3000/events/<event_id>/reweigh \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"verifiedWeightKg": 14.2}'
```

The server computes the variance against the claimed weight and applies a
fixed **±5% tolerance**:

- **Within tolerance** → `status: "verified"`. Nothing further is required.
- **Outside tolerance** → `status: "flagged"`, and the request is refused
  with a 400 unless `notes` explains the gap:
  ```bash
  curl -X POST http://localhost:3000/events/<event_id>/reweigh \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"verifiedWeightKg": 11.0, "notes": "material was noticeably damp"}'
  ```

**Both outcomes are payable.** This is deliberate, not an oversight: a
flagged re-weigh is not rejected, and there is no manual-review queue to wait
on. The collector is paid the *hub-verified* weight either way — never the
claim — so there is no incentive to inflate a claim in the first place, and
the `notes` field is the permanent record of why the two numbers diverged, for
anyone checking later.

One event gets exactly one re-weigh; a second attempt on the same event is
refused with a 409. There is no endpoint to edit a recorded re-weigh, so read
the scale carefully before submitting.

### Step 5: Pay the Collector

Once one or more of a collector's events have verified/flagged re-weighs, turn
them into a payout on the dashboard's **Payouts** screen, or:

```bash
curl -X POST http://localhost:3000/payouts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"collectorId": "<collector_id>", "eventReweighIds": ["<reweigh_id>", "..."], "method": "cash"}'
```

Each item's amount is computed as `verifiedWeightKg × ratePerKg`, from
whichever `material_rates` row applies (the most specific hub match, at the
most recent `effectiveFrom` on or before now — see
[architecture.md](architecture.md#12-material-rates-material_rates)). The
request fails with a clear error if no rate is configured. Once the collector
has actually been paid:

```bash
curl -X POST http://localhost:3000/payouts/<payout_id>/mark-paid \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"payoutRef": "receipt-0042"}'
```

## Part 2: An Auditor Independently Checking a Batch

### Step 1: Download the Audit Report

The report is **public and requires no authentication**:

```bash
curl http://localhost:3000/batches/<batch_id>/report > report.json
jq 'keys' report.json
```

Expected keys:

```json
[
  "reportVersion",
  "generatedAt",
  "batch",
  "hub",
  "collectors",
  "chainOfCustody",
  "reconciliation",
  "proof",
  "events",
  "reweighs",
  "payouts",
  "attestationNotes"
]
```

- **batch** — Sealed batch metadata (id, material, total weight, event count, sealed timestamp).
- **proof** — The Merkle tree: sealed root, recomputed root, whether they agree, and whether every event's proof verifies.
- **events** — Every event in the batch, with its own Merkle leaf and proof.
- **reweighs** — One entry per event that has been re-weighed: claimed weight, verified weight, variance, and status. An event with no re-weigh yet simply has no entry here.
- **payouts** — Every payout that covers at least one of this batch's re-weighs: amount, currency, method, status, and when it was paid.

### Step 2: Verify the Merkle Tree Locally

Every event carries its own leaf hash and proof steps; the report also states
the sealed root and a `recomputedRoot` derived fresh from the event list on
every request (never cached against the batch row).

```bash
cd packages/shared && npm install
```

```javascript
const { verifyMerkleProof, merkleRootHex } = require("@proofchain/shared");
const report = require("./report.json");

// Check one event's proof against the sealed root.
const event = report.events[0];
console.log(verifyMerkleProof(event.leaf, event.merkleProof, report.proof.merkleRoot));

// Recompute the whole root from the event list and compare.
const recomputed = merkleRootHex(report.events.map((e) => e.leaf));
console.log(recomputed === report.proof.merkleRoot);
```

If both are `true`, the event list hasn't been modified since sealing and the
tree structure is correct — the same two facts `report.proof.rootMatchesSealedValue`
and `report.proof.allProofsValid` already assert, now checked independently
rather than taken on our word.

The same check, one event at a time, is also exposed directly:

```bash
curl http://localhost:3000/batches/<batch_id>/verify/<event_id> | jq '.'
```

```json
{
  "eventId": "...",
  "batchId": "...",
  "leaf": "9a3c8e...",
  "proof": [{ "hash": "f1d2e...", "side": "right" }],
  "merkleRoot": "7f2d1a...",
  "proofValid": true
}
```

**What this proves, and what it doesn't.** A valid Merkle proof shows an
event was part of the batch's committed set at seal time, and that the set
hasn't changed since. It says nothing about whether the *claimed* weight in
that event was accurate — that's what Part 1's re-weigh establishes, which is
why the next step cross-checks the two together.

### Step 3: Cross-Check a Payout Against Its Re-weigh

This is the check that actually verifies money changed hands for the right
amount. Pick a payout from `report.payouts` and a re-weigh it should cover
from `report.reweighs`:

```bash
jq '.payouts[0], .reweighs' report.json
```

A payout's `amount` is the sum, across every re-weigh it covers, of
`verifiedWeightKg × ratePerKg` at the rate in effect when the payout was
created. To check one item by hand:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/material-rates?materialCode=PET" | jq '.'
```

Find the rate whose `effectiveFrom` is on or before the payout's
`createdAt` (from `GET /payouts/:id`) and — if present — matches the batch's
hub; otherwise the `hubId: null` global default applies. Multiply that rate
by the re-weigh's `verifiedWeightKg`, sum across every re-weigh the payout
covers, and compare to the payout's `amount`. They must match, because that
arithmetic is exactly what `payouts.service.ts` performs at creation time —
this is independent recomputation, not a different formula.

Two things are worth confirming beyond the arithmetic:

- The re-weigh's `status` is `"verified"` or `"flagged"` — never `"rejected"`
  (a rejected re-weigh cannot be attached to a payout; the backend refuses
  it).
- If `status` is `"flagged"`, `notes` is present and gives a real reason. A
  flagged re-weigh with no explanation would mean the mandatory-reason gate
  described in Part 1 was somehow bypassed — treat that as a finding worth
  escalating, not a formatting nit.

### Step 4: Verify the Weigh-in Photo

Each event carries `photoHash` — a sha256 the capture device signed into the
payload. Where `photoAvailable` is `true`, the bytes are stored and served
back:

```bash
EVENT_ID=$(jq -r '.events[0].eventId' report.json)
curl -s "http://localhost:3000/events/$EVENT_ID/photo" -o photo.bin
sha256sum photo.bin
jq -r '.events[0].photoHash' report.json
```

The two digests must be identical. If they are, the image is the one the
device photographed and signed at capture — not one substituted afterwards.
**What this proves, and what it does not:** it proves provenance, not
content. It does not prove the image depicts the claimed material, or that it
wasn't staged. Photo content analysis is out of scope for this release.

`photoAvailable: false` means the bytes were never uploaded, usually a device
that hasn't finished syncing. The weigh-in is still validly signed and in the
Merkle tree; only this corroboration is missing.

## What If Verification Fails?

### A Merkle proof is invalid, or the recomputed root doesn't match

**Possible causes:** the event list was altered after sealing (should be
structurally impossible — sealing freezes `batchId` on every member event and
there is no endpoint that edits a sealed event), corruption in transit, or a
bug in the Merkle library.

**What to do:** re-download the report to rule out a transmission error, then
escalate with the batch id and the specific event whose proof failed.

### A payout's amount doesn't match `verifiedWeightKg × ratePerKg`

**Possible causes:** the rate looked up by hand doesn't match the one that
actually applied at creation time (check `effectiveFrom` and `hubId`
carefully — the most specific hub match wins, not the most recent row
overall), or the payout covers more re-weighs than were checked.

**What to do:** fetch `GET /payouts/:id` for the full item breakdown if the
report's summary isn't enough, and re-check each `material_rates` row's
`effectiveFrom` against the payout's `createdAt`.

### A flagged re-weigh has no `notes`

This should be structurally impossible — the backend refuses to record a
flagged re-weigh without one. If it happens, treat it as a data-integrity
finding, not a documentation gap: escalate with the event id.

### The photo's sha256 does not match `photoHash`

Stop and escalate. The server refuses to store bytes that don't match the
signed digest, so a mismatch here means either the stored file was altered on
disk after the fact, or the report and the photo came from different
sources. Do not accept the batch on the strength of the remaining evidence
until it's explained.

## Summary

- **A hub operator** verifies a submission by physically re-weighing the
  material and recording the result — the one step in this whole system that
  checks a claim against reality, rather than checking that a claim hasn't
  been tampered with.
- **An auditor** independently verifies a batch by downloading its public
  audit report, recomputing the Merkle root and proofs, and cross-checking
  every payout's amount against the verified weight and rate it should have
  been computed from — all without trusting ProofChain's word for either.
