# Architecture

**Technical design and data model for ProofChain.**

This document describes:
1. The database schema (12 tables)
2. The integrity v1 checks and threat model
3. Why re-weigh-based verification, not a blockchain anchor
4. Known limitations and future work

## Data Model

The schema is designed backwards from the audit artifact. Every table exists because an auditor, a PRO, or a credit buyer will eventually ask about it.

### The 12 Tables

#### 1. Hubs (collection_points)

Physical locations where waste is collected. A hub defines:
- Weight bounds per weigh-in (minimum, maximum in kg)

```sql
CREATE TABLE hubs (
  id uuid PRIMARY KEY,
  code varchar UNIQUE,           -- Short identifier (e.g., "nairobi-pilot")
  name varchar,                  -- "Nairobi Pilot Hub"
  minWeightKg numeric(10,3) DEFAULT 0.1,
  maxWeightKg numeric(10,3) DEFAULT 10000,
  createdAt timestamptz
);
```

**Why it matters:** A batch is scoped to one hub, so hub membership is what makes a batch's provenance stateable.

#### 2. Collectors (waste_collection_workers)

Individuals who collect and weigh plastic. One phone ↔ one collector. Tied to mobile-money identity for payment.

```sql
CREATE TABLE collectors (
  id uuid PRIMARY KEY,
  name varchar,
  phone varchar UNIQUE,          -- Mobile-money identity
  cooperativeId varchar,         -- Group membership (optional)
  kycLevel varchar DEFAULT 'none',  -- none | basic | verified
  homeLat double precision,
  homeLng double precision,
  active boolean DEFAULT true,
  createdAt timestamptz
);
```

**Why it matters:** Identifies who collected the waste. Phone is unique so one person is one payee. KYC level tracks identity verification for credit issuance.

#### 3. Devices (capture_devices)

Enrolled phones/scales that sign weigh-ins. Each device has an ed25519 public key; the private key stays on the device and never touches the server.

```sql
CREATE TABLE devices (
  id uuid PRIMARY KEY,
  collectorId uuid REFERENCES collectors,
  label varchar,                 -- "Phone 1" | "Scale in Hub A"
  publicKeyBase64 varchar UNIQUE,  -- Base64-encoded ed25519 public key (32 bytes)
  enrolledAt timestamptz,
  revokedAt timestamptz NULL,    -- Null = active; set to revoke without deleting
  INDEX (collectorId)
);
```

**Why it matters:** The public key is the root of trust. Each weigh-in is signed with this key. Revocation (setting `revokedAt`) invalidates all future weigh-ins from this key but doesn't retroactively invalidate already-signed events.

#### 4. Collection Events (weigh_in_records)

The atomic verified fact: one weigh-in. Every event has:
- The signed payload (schema, IDs, weight, location, photo hash, timestamp, nonce)
- The signature (ed25519, base64)
- The payload hash (sha256, for deduplication)
- Integrity verdict (outcome + array of findings)
- Quarantine flag (failed integrity → never batched)

```sql
CREATE TABLE collection_events (
  id uuid PRIMARY KEY,
  collectorId uuid REFERENCES collectors,
  hubId uuid REFERENCES hubs,
  deviceId uuid REFERENCES devices,
  batchId uuid REFERENCES batches NULL,  -- Set when added to a batch; frozen when batch seals
  weightKg numeric(10,3),
  material varchar,              -- a code from the materials catalogue (table 9)
  lat double precision,
  lng double precision,
  capturedAt timestamptz,        -- Device clock
  receivedAt timestamptz,        -- Server clock (gap = integrity signal)
  photoHash varchar,             -- sha256 of photo bytes (photo stays off-chain)
  photoUri varchar NULL,         -- Optional: link to external photo storage
  nonce varchar,                 -- Random 16 bytes hex (replay detection)
  signature text,                -- Base64 ed25519 signature
  payloadHash varchar UNIQUE,    -- sha256 of canonical payload (replay protection)
  integrity jsonb,               -- Verdict with array of findings
  quarantined boolean DEFAULT false,
  createdAt timestamptz,
  UNIQUE (payloadHash),          -- Replay protection enforced by database
  INDEX (hubId, capturedAt),
  INDEX (quarantined)
);
```

**Why it matters:** The source of truth for all weigh-ins. Integrity verdicts are attached at ingest and never change, so the audit trail is immutable.

#### 5. Batches (batch_aggregations)

Groups of events aggregated for processing. Lifecycle:
1. **open** — Operator adds events
2. **sealed** — Membership frozen, Merkle root computed
3. **processed** — Physical processing complete
4. **sold** — Credit buyer accepted

```sql
CREATE TABLE batches (
  id uuid PRIMARY KEY,
  hubId uuid REFERENCES hubs,
  material varchar,              -- a catalogue code; all events in a batch must match
  status varchar DEFAULT 'open', -- open | sealed | processed | sold
  totalWeightKg numeric(12,3) DEFAULT 0,
  eventCount int DEFAULT 0,
  merkleRoot varchar NULL,       -- Set once, at seal time
  sealedAt timestamptz NULL,
  createdAt timestamptz,
  updatedAt timestamptz,
  INDEX (status),
  INDEX (hubId, status)
);
```

**Why it matters:** Batches are the unit of sale. Sealing freezes membership and computes the Merkle root, proving that no event can be added, removed, or reordered after that point.

#### 6. Custody Transfers (chain_of_custody)

Records handoffs between parties (collector → hub → processor → buyer). Includes variance (moisture loss, contamination rejects).

```sql
CREATE TABLE custody_transfers (
  id uuid PRIMARY KEY,
  batchId uuid REFERENCES batches,
  fromParty varchar,
  toParty varchar,
  weightInKg numeric(12,3),
  weightOutKg numeric(12,3),
  varianceKg numeric(12,3),      -- weightIn - weightOut (stored, not derived)
  reason varchar NULL,           -- "moisture loss and contamination rejects"
  transferredAt timestamptz,
  createdAt timestamptz
);
```

**Why it matters:** Documents the physical journey of the waste. Variance is expected but auditable. Stored (not computed) so a later change to weights is visible.

#### 7. Event Reweighs (event_reweighs)

The hub's independent re-measurement of a collector's claimed weight — the
check that turns a self-reported drop-off into something payable. One per
event (1:1, enforced by a unique index on `eventId`): a second re-weigh of the
same event is a data-entry mistake to correct out of band, not a revision to
record.

Deliberately a separate table, not columns added to `collection_events`: the
event's signed/hashed columns feed the Merkle leaf and are treated as
immutable once ingested, so a re-weigh — captured later, by hub staff, never
signed by the device — has to live elsewhere. `claimedWeightKg` is copied from
the event at reweigh time rather than joined live, so a report row stays a
self-contained audit fact on its own. `varianceKg`/`variancePct` are stored,
not derived, mirroring `custody_transfers`' convention: a later change to
either weight must not silently change the recorded variance.

```sql
CREATE TABLE event_reweighs (
  id uuid PRIMARY KEY,
  eventId uuid UNIQUE REFERENCES collection_events ON DELETE RESTRICT,
  claimedWeightKg numeric(10,3),   -- copied from the event at reweigh time
  verifiedWeightKg numeric(10,3),  -- what the hub scale read
  varianceKg numeric(10,3),        -- claimed - verified, stored not derived
  variancePct numeric(6,3),
  status varchar,                  -- verified | flagged | rejected
  notes varchar NULL,              -- required when status = flagged/rejected
  verifiedByUserId uuid REFERENCES users,
  verifiedAt timestamptz,
  createdAt timestamptz
);
```

**Why it matters:** This is the independent, physical check the whole
workflow is built around — see [Why re-weigh-based verification](#why-re-weigh-based-verification-not-a-blockchain-anchor)
below. `status` is set by a fixed ±5% tolerance check at write time:
within tolerance is `verified`; outside it is `flagged`, and `notes` becomes
mandatory as the audit trail for why the numbers diverge. **Both statuses are
payable** — nothing here auto-rejects a submission or blocks payment; the
collector is paid the hub-verified (lower) weight either way. `rejected` is
not set by this automated logic; it exists on the column only for a possible
future manual-override workflow, and nothing in this release writes it.

#### 8. Users (operators_and_auditors)

Operator and auditor accounts for the dashboard. Collectors authenticate by device key, not password.

```sql
CREATE TABLE users (
  id uuid PRIMARY KEY,
  email varchar UNIQUE,
  passwordHash varchar,          -- Argon2 hash
  role varchar DEFAULT 'operator',  -- admin | operator | auditor
  active boolean DEFAULT true,
  createdAt timestamptz
);
```

**Why it matters:** Operators manage batches (seal, custody). Auditors have read-only access. Admins enroll new devices.

#### 9. Materials (material_catalogue)

The material types a collector may choose from, maintained by an administrator at
runtime rather than compiled into the apps.

```sql
CREATE TABLE materials (
  code varchar(16) PRIMARY KEY,  -- "PET" — signed into payloads, permanent
  name varchar(120),             -- "Mixed plastic" — presentation only
  description varchar(300),      -- field guidance, nullable
  examples text[] DEFAULT '{}',  -- products a collector recognises: {"Milk jugs"}
  active boolean DEFAULT true,   -- false = retired, hidden from new capture
  "sortOrder" int DEFAULT 100,
  createdAt timestamptz,
  updatedAt timestamptz,
  CONSTRAINT "CHK_materials_code_shape"
    CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,15}$')
);
```

**Why it matters, and why it is shaped like this:** `material` is a field in the
signed weigh-in payload, so a code is hashed into the Merkle leaf of every
batch containing it, and it is also the join key a `material_rates` row prices
against. Three consequences follow, and every design decision here is one of
them:

1. **Codes are append-only.** There is no rename endpoint. Renaming a code
   already used by a sealed batch would invalidate that batch's audit report —
   its stored `merkleRoot` would no longer match a root recomputed from the
   (now-renamed) event list — and no migration can retroactively fix a report
   already handed to an auditor or buyer. The code is the primary key partly
   to make this structural.
2. **Retiring is not deleting.** `active: false` removes a material from the
   capture pickers and touches no stored event. Outright deletion is allowed only
   for a code no event and no batch has ever used; anything else returns 409 with
   the reference counts and a pointer to retirement.
3. **No foreign key from `collection_events.material` or `batches.material`.**
   This is deliberate. A signed material code is a historical fact, not a
   reference to current configuration, and a FK would let a catalogue edit
   cascade into — or be blocked by — evidence already sealed into a batch.
   Existence is checked at ingest instead, where it can be reported as a 400.

The two gates differ on purpose:

| Path | Gate | Why |
|---|---|---|
| `POST /events` (ingest) | code must **exist** | Capture is offline-first. A phone can hold a queue signed hours ago against a catalogue that has since changed; rejecting those records would destroy already-signed field work nobody can redo. |
| `POST /batches` (open) | code must exist **and be active** | An operator is making a forward-looking choice with the live catalogue in front of them, so a retired code is a mistake to block. |

`examples` is the products a collector would name — "milk jugs", "bottle caps" —
and the capture apps show them as tags under the picker. It is presentation, like
`name` and `description`: never signed, never hashed, and safe for an operator to
correct when the local waste stream does not look like the one the seed data was
written for. Always an array, never null, so a picker has one empty state rather
than two. The list is normalised on the way in *and* on the way out, because a
device reads it from a cache it may have written before the field existed.

The six codes the pilot shipped with are seeded by the migration, and are also
compiled into `@proofchain/shared` as `SEED_MATERIALS` — the offline fallback for
a device that has never reached the backend.

#### 10. Payouts (payouts)

One payment run to a collector, covering one or more of their verified/flagged
re-weighs. Payout destination stays manual/cash for now (Phase 1 decision #3):
there is no structured payout-account column on `collectors`, so `method` is a
free-text record of how this specific payout was actually handed over.

```sql
CREATE TABLE payouts (
  id uuid PRIMARY KEY,
  collectorId uuid REFERENCES collectors,
  amount numeric(12,2),
  currency varchar DEFAULT 'NGN',
  method varchar,                -- free text: "cash" | "mobile_money" | "bank" | ...
  payoutRef varchar NULL,        -- receipt/transfer id, set on mark-paid
  status varchar DEFAULT 'pending',  -- pending | paid | failed
  paidByUserId uuid NULL REFERENCES users,
  paidAt timestamptz NULL,
  createdAt timestamptz
);
```

**Why it matters:** The record a collector, an auditor, or a dispute points
to. `status` moves `pending → paid` exactly once (`payouts.service.ts`'s
`markPaid()` refuses a payout that isn't `pending`); `paidByUserId`/`paidAt`
are who confirmed it and when, not who created the payout request.

#### 11. Payout Items (payout_items)

A payout can cover several drop-offs, so this is the join row carrying the
amount attributed to one specific re-weigh — not a duplicate of
`payouts.amount`, which is the sum across all of a payout's items.

```sql
CREATE TABLE payout_items (
  id uuid PRIMARY KEY,
  payoutId uuid REFERENCES payouts ON DELETE CASCADE,
  eventReweighId uuid REFERENCES event_reweighs ON DELETE RESTRICT,
  amount numeric(12,2)
);
```

**Why it matters:** This is also how "already paid" is enforced — a re-weigh
with an existing `payout_items` row cannot be attached to a second payout
(`payouts.service.ts`'s `create()` checks for this before writing anything).

#### 12. Material Rates (material_rates)

A fixed rate per kg for a material, optionally scoped to one hub. A payout
resolves the applicable rate rather than taking a manual amount per item.

```sql
CREATE TABLE material_rates (
  id uuid PRIMARY KEY,
  materialCode varchar(16) REFERENCES materials,
  hubId uuid NULL REFERENCES hubs,  -- null = global default
  ratePerKg numeric(10,2),
  effectiveFrom timestamptz,
  createdAt timestamptz
);
```

**Why it matters, and how resolution works:** `payouts.service.ts`'s
`resolveRate()` picks the most specific `hubId` match first (falling back to
the `hubId: null` global default), and within whichever tier applies, the
latest `effectiveFrom` at or before now. There is no FK from
`collection_events`/`batches` to this table, for the same reason
`materials` has none from those tables: a rate is current pricing
configuration, and a signed weigh-in's material must never be able to dangle
on a rate change. If no rate resolves at all — no hub-specific and no global
default for that material — `POST /payouts` fails with a 400 naming what was
checked, rather than silently pricing an item at zero.

## Integrity v1 Checks

Integrity checks run at ingest on every weigh-in. They are deliberately **pure** (no DB state, no crypto beyond signature verification, no system clock beyond receipt time) so every check is:
- Testable in isolation
- Identical on the server and in review tooling
- Auditable by anyone with the payload and public key

Any *fail* quarantines the event; it can never enter a batch. A *warn* is logged but doesn't block (e.g., offline sync).

### The 6 Checks

#### 1. Device Enrolled (`device_enrolled`)

**Defends against:** Using a key that is not enrolled, or from a different collector.

- Device public key must be enrolled in the database
- Device must not be revoked
- Device must belong to the collector who claims to own the weigh-in
- Collector must be active

**Outcome:** *fail* if device is unknown, revoked, or enrolled to a different collector. *fail* if collector is inactive.

#### 2. Signature Valid (`signature_valid`)

**Defends against:** Tampering with the payload after signing.

- The signature must be a valid ed25519 signature over the canonical payload
- The signature must verify against the device's enrolled public key

**Outcome:** *fail* if signature is invalid or missing.

**Note:** Canonical payload is defined in `packages/shared/src/canonical-core.ts`. All signers (mobile app, PWA, external integrations) must use the same encoding (deterministic JSON, field order) so signatures are verifiable.

#### 3. Weight in Range (`weight_in_range`)

**Defends against:** Claiming an implausible weight (e.g., 40 tonnes for a single weigh-in when the hub's max is 10 tonnes).

- Weight must be positive
- Weight must be ≥ hub's minimum (default 0.1 kg, avoids scale noise)
- Weight must be ≤ hub's maximum (default 10,000 kg — one delivery to one hub, not one truckload of many)

**Outcome:** *fail* if weight is invalid, below minimum, or above maximum.

**Note:** These bounds are per-weigh-in, not per-batch. A batch can accumulate multiple weigh-ins up to any weight.

**The ceiling was 500 kg until the HubWeightCeiling migration.** That figure assumed a weigh-in was what one collector carries to a hand scale, and it quarantined real aggregated deliveries. The migration raises both the column default and every existing hub below 10 t; hubs an operator set higher are left alone. Events quarantined under the old ceiling are not revived — a stored integrity verdict describes checks as they ran, and rewriting one would make the audit trail lie.

**Capture devices hold these bounds too.** `GET /hubs/directory` publishes them, both capture apps check a weight against them before signing, and the server checks again at ingest. The client check is a courtesy to the collector, not a security control: it turns a rejection that arrives hours later, with the material gone, into a correction they can still make. The server's check is the one that decides.

#### 4. Not a Duplicate (`not_duplicate`)

**Defends against:** Replaying an identical signed weigh-in to create credit out of thin air.

- The canonical payload hash must not already exist in the database
- (Or equivalently, the nonce must be unique per device per timestamp interval)

**Outcome:** *fail* if the payload hash is a duplicate.

**Enforcement:** The database enforces a UNIQUE constraint on `payloadHash`, so even if the check passes, a race condition replay is caught at the database layer.

**Why it works:** The nonce is random and unique per weigh-in. The payload includes the nonce. An attacker who replays the same payload (with the same nonce, weight, location, timestamp) will hash to the same payload hash and be detected. An attacker who changes the nonce must re-sign (they don't have the private key).

#### 5. Clock Plausible (`clock_plausible`)

**Defends against:** Backdated or future-dated weigh-ins (indicates either device clock drift or an attempt to forge a timestamp).

- The capturedAt timestamp must be a valid ISO-8601 datetime
- The difference between capturedAt and the server's current time must be within tolerance (default ±15 seconds)

**Outcome:** *fail* if the timestamp is invalid or future-dated beyond tolerance. *warn* if backdated beyond tolerance (e.g., offline sync after hours).

**Rationale:** 
- Future-dated is a hard fail: a device can't report a weigh-in that hasn't happened yet.
- Backdated is a warning: offline devices may sync days later, which is expected. The operator can decide whether to accept the batch based on context.

**Tolerance:** ±15 seconds accommodates NTP clock skew and network latency without being so loose that an old backdated event looks fresh.

#### 6. Photo Present (`photo_present`)

**Defends against:** Missing or invalid photo hash (indicates metadata tampering or a misconfigured device).

- The photoHash must be a valid sha256 digest (64 lowercase hex characters)

**Outcome:** *fail* if the hash is not a valid sha256.

**Note:** This check does NOT verify that the photo actually exists or that it matches the material. Photo content verification is deferred to v2 (ML-based material classification). For now, the hash is stored as a reference for later analysis.

### Integrity Verdict Format

Each event's integrity verdict is stored as a JSONB object:

```json
{
  "outcome": "pass" | "warn" | "fail",
  "findings": [
    {
      "check": "signature_valid",
      "outcome": "pass"
    },
    {
      "check": "weight_in_range",
      "outcome": "fail",
      "detail": "40000 kg above hub maximum 10000 kg"
    },
    ...
  ]
}
```

The overall `outcome` is:
- **pass** — All checks passed
- **warn** — At least one warning, no failures
- **fail** — At least one failure

A *fail* outcome means the event is quarantined (`quarantined = true`) and will never enter a batch. Operators can view quarantined events for debugging but cannot force them into production batches.

## Why Re-weigh-Based Verification, Not a Blockchain Anchor

### The Problem

A claimed weigh-in is a self-report. Signing it on-device (see Integrity v1,
above) proves *who* made the claim and that it hasn't been altered since — it
does nothing to prove the claim itself is true. A collector with a calibrated
scale can still declare 20 kg for a 15 kg sack, and no signature, hash, or
ledger entry catches that: they all faithfully preserve whatever number was
signed. An earlier version of this project anchored each sealed batch's
Merkle root to the Stellar testnet ledger — publishing an independently
checkable, tamper-evident timestamp for *when* a batch's event set was frozen
and that it hasn't changed since. That is real, but it answers the wrong
question for the fraud this platform actually has to defend against: a
ledger entry attests to a self-reported number being unchanged, not to that
number being *correct*.

### The Decision

Verification comes from an independent, physical re-measurement instead: a
collector brings the material to a hub, staff weigh it themselves on hub
equipment, and that reading — not the claim — is what gets paid.

1. **A physical re-weigh is the check a spoofed claim cannot survive.**
   Signing and hashing constrain *tampering after capture*; they cannot
   constrain a dishonest number at the moment of capture. Only a second,
   independent measurement can.
2. **The tolerance/auto-pay-lower-weight policy is the fraud mitigation.** A
   fixed ±5% band (Phase 1 decision) separates ordinary scale-to-scale
   disagreement from a discrepancy worth flagging. Outside that band the
   re-weigh is marked `flagged` and requires a stated reason — an audit
   trail — but is never auto-rejected: the collector is simply paid the
   *hub-verified* weight, which is always the number that matters for a
   fraud incentive. Someone who claims 20 kg for 15 kg gains nothing; they
   are paid for 15 kg either way, and the gap is on record. This makes the
   verification self-enforcing without a manual review queue: there is no
   reward for inflating a claim, so there is little for a review step to
   catch that the pricing logic hasn't already made pointless.
3. **The Merkle tree is kept, and still does real work — it just isn't
   anchored anywhere external.** Sealing a batch still computes and freezes
   a Merkle root over its events (`batches.service.ts`'s `seal()` is
   unchanged by this decision), so batch membership and event order are
   still tamper-evident within the system: a report reader still recomputes
   the root from the event list and checks it matches, and still checks
   individual event proofs. What changed is *where* the root's freshness is
   attested — previously an external ledger, now the re-weigh workflow that
   corroborates the underlying claim it commits to.
4. **Nothing here needs a blockchain to work.** A hub re-weigh, a tolerance
   check, and a rate-table lookup are ordinary database operations with no
   external dependency, no funded account to maintain, and no read-back
   against a third-party service that might be unreachable. The operational
   cost an anchor-based design carried — funding and monitoring a
   ledger-writing account, backing off and retrying failed submissions,
   treating "Horizon is unreachable" as a first-class outcome throughout the
   API — goes away entirely.

### What This Does Not Claim

A hub re-weigh proves the *hub's* physical measurement of *some* material
presented at the hub. It does not, by itself, prove that material is what the
collector originally captured (a different sack could in principle be
substituted between capture and hub visit), nor does it defend against
collusion between a collector and hub staff. Those are threats a future
revision could address — a chain-of-custody-style linkage between the
captured photo and the re-weighed material, or role separation between the
person who records a re-weigh and the person who approves a payout — neither
of which is implemented today. See [Known Limitations](#known-limitations)
below.

`contracts/batch-registry` — a Soroban smart contract explored for a future,
stateful credit registry — is still present in the repository. It was never
wired to the backend and nothing imports it; it is not part of the design
described here.

## Known Limitations

### 1. Timestamp-Only Integrity

Integrity v1 does not verify photo content, material type, or weight calibration. It only checks:
- Metadata plausibility (signature, enrollment, weight bounds, timestamp)
- Absence of known tampering (no replay, valid hash format)

A rogue device with a calibrated scale can report any weight it chooses (within the hub's range). Photo hashing protects against tampering post-capture, but the photo itself is not analyzed.

**Mitigation:** Post-pilot, v2 adds ML-based material classification and volume estimation from photos.

### 2. No Behavioral Baselining

Integrity v1 has no per-collector quotas, anomaly detection, or historical baselining. A collector can theoretically submit unlimited weigh-ins.

**Mitigation:** v2 adds per-collector daily/weekly quotas and outlier detection.

### 3. No Rollback After Sealing

Once a batch is sealed, the Merkle root is computed and frozen. Events cannot be added, removed, or reordered. If an operator realizes a weigh-in should not have been included, the batch is already committed.

**Workaround:** Open a new batch and exclude the problematic event. The sealed batch remains in the database as a historical record.

### 4. No Rate Limiting Per Device

A device can submit unlimited weigh-ins. There is no per-device quota or per-minute throttle at the ingest layer.

**Mitigation:** Operator can revoke a device. Behavioral baselining will detect anomalies (e.g., 1000 weigh-ins in one day).

### 5. The Re-weigh Tolerance Is Fixed, Not Configurable

±5% applies uniformly to every material and every hub. A material genuinely
prone to moisture loss or settling has no wider allowance; a hub with more
precise scales gets no narrower one. A wide reading is always `flagged`, never
auto-rejected — see [Why re-weigh-based verification](#why-re-weigh-based-verification-not-a-blockchain-anchor)
for why that's a deliberate tradeoff rather than an oversight — but the band
itself is a constant in `reweigh.service.ts`, not data.

**Mitigation:** A future revision could move the tolerance into
`material_rates` or a dedicated per-material/per-hub settings table.

### 6. No Manual-Review Gate, and No Way to Correct a Recorded Re-weigh

A flagged re-weigh is payable immediately, with no approval step — by design
(Phase 1 decision #2). `EventReweighEntity.status` includes `"rejected"` for a
possible future manual-override workflow, but nothing in this release sets
it, and there is no `PATCH`/`DELETE` on `/events/:eventId/reweigh`: a
mis-keyed verified weight is on the record permanently once submitted (the
one-re-weigh-per-event uniqueness constraint prevents a second, corrective
attempt on the same event).

**Mitigation:** A future revision could add an admin-only correction endpoint
that writes a new row (never edits the original) and marks the superseded one
`rejected`, preserving both readings in the audit trail.

### 7. Payout Destination Is Manual/Cash Only

`PayoutEntity.method` is free text ("cash", "mobile money", …), not a
validated or integrated payment rail, and there is no structured
payout-account field on `CollectorEntity` (Phase 1 decision #3 dropped this
from scope). Reconciling that a payout was actually received happens outside
the system.

**Mitigation:** A future revision could add a validated payout-destination
field on the collector record and integrate a mobile-money API for disbursal
and confirmation.

## Future Enhancements

### Integrity v2

- **Photo analysis** — ML model to classify material type and estimate weight
- **Behavioral baselining** — Per-collector historical profiles, anomaly detection
- **Tamper-evident hardware** — Integration with certified scales (Bluetooth API)
- **Volume estimation** — Reject weight claims that are implausible for the reported volume

### Re-weigh and Payout

- **Configurable tolerance** — Per-material or per-hub bands instead of one fixed ±5%
- **Correction workflow** — A supersede-and-preserve edit path for a mis-recorded re-weigh, instead of the current write-once record
- **Structured payout destinations** — A validated payout-account field on the collector record, and integration with a mobile-money disbursal API
- **Chain-of-custody linkage** — Tying the hub-verified material back to the captured photo, to narrow the substitution gap noted above

### Infrastructure

- **Batch pagination** — Optimize large audit reports (current cap: 10,000 events)
- **Photo storage** — IPFS or S3 backend for photo persistence
- **Operator analytics** — Dashboard metrics (collection rate, recycling rate, buyer engagement)

## References

- **Merkle Trees** — https://en.wikipedia.org/wiki/Merkle_tree
- **Ed25519 Signing** — https://tools.ietf.org/html/rfc8032
- **Verifiable Carbon Offsets** — https://verra.org/project/verified-carbon-standard/
