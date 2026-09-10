# ProofChain

**Verified waste-to-credit platform: signed self-report → hub re-weigh → payout**

Waste collectors record weigh-ins of recycled plastic on phones. Each weigh-in is cryptographically signed on-device with an ed25519 key (the private key never leaves the phone). The server runs integrity checks to detect spoofing, groups clean events into batches, and seals a batch by computing a Merkle tree over its events — freezing membership and order. From there, the collector brings the material to a verification hub, where staff independently re-weigh it and record the result. A re-weigh within ±5% of the claim is "verified"; further off is "flagged" but still payable, at the hub-verified weight. Hub staff turn one or more verified re-weighs into a payout, priced from a material rate table, and mark it paid. The batch's audit report ties the whole chain together — events, Merkle proofs, re-weighs and payouts — for anyone to check independently.

## Why This Matters

A plastic credit is worth $140–800 per tonne, creating direct financial incentive to spoof weigh-ins. ProofChain's guarantee is:

1. **Authenticity** — Every weigh-in is signed by an enrolled device. Tampering with the payload invalidates the signature.
2. **Integrity** — Events pass server-side checks (weight range, duplicate detection, clock plausibility, device enrollment).
3. **Independent corroboration** — A collector's claimed weight is a self-report; it only becomes payable after hub staff physically re-weigh the material and record what the scale actually reads. A ±5% tolerance separates a normal reading gap ("verified") from a discrepancy worth a stated reason ("flagged") — either way the collector is paid the *hub-verified* weight, never the claim.
4. **Verifiability** — Any third party can independently recompute a sealed batch's Merkle root from its event list, check one event's proof, and cross-check a payout's amount against the re-weigh it covers and the material rate in effect at the time — all from the one audit report.

**Maturity note:** This is a pilot build. The platform is not yet a certified credit issuer. Verra accreditation, photo content analysis, and per-collector behavioral baselining are not in scope for this release.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ Offline-first Capture (capture PWA + mobile Expo app)           │
│  • Ed25519 signing on-device                                     │
│  • Photo hash + weight from scale                                 │
│  • IndexedDB queue for offline operation                          │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ POST /events (signed payload + signature)
                         │
┌────────────────────────▼────────────────────────────────────────┐
│ Backend (NestJS + Postgres + Redis)                             │
│  • Integrity v1 checks (6 checks: signature, weight, etc.)      │
│  • Batch management + Merkle tree sealing                        │
│  • Chain of custody tracking                                     │
│  • event_reweighs, payouts, payout_items, material_rates         │
└───────┬───────────────────────────────────────┬──────────────────┘
        │                                       │
        │ printable proof page                  │ GET /batches/:id/report
        │ (lookup code = first 10 chars          │  events + Merkle proofs
        │  of the event's payloadHash)           │  + reweighs[] + payouts[]
        │                                       │
┌───────▼─────────────────┐           ┌─────────▼──────────────────┐
│ Collector                │           │ Auditor / Credit Buyer      │
│  • Prints/shows the code  │           │  • Downloads the audit      │
│  • Brings material to a   │           │    report                    │
│    verification hub        │           │  • Recomputes the Merkle     │
└───────┬───────────────────┘           │    root and one proof         │
        │ presents code + material      │  • Cross-checks a payout's    │
        │                               │    amount against verified    │
┌───────▼───────────────────┐           │    weight × the material rate │
│ Hub staff (dashboard)      │           └────────────────────────────┘
│  • /reweigh: look up the    │
│    event, record the        │
│    verified weight            │
│  • ±5% tolerance -> verified  │
│    or flagged (both payable)  │
│  • /payouts: pay a collector  │
│    for one or more re-weighs, │
│    priced from material_rates │
└────────────────────────────┘
```

### Data Flow: Weigh-In to Payout to Audit Report

1. **Capture** — Collector uses phone/PWA to photograph a weigh-in. Device signs the payload (schema, IDs, weight, material, photo hash, timestamp, nonce) with its ed25519 private key.
2. **Ingest** — Server receives payload + signature. Signature verification ensures authenticity. A unique constraint on the payload hash prevents replay.
3. **Integrity** — Server runs 6 checks: device enrolled, signature valid, weight in range, not a duplicate, clock plausible, photo hash is valid sha256. Any *fail* quarantines the event; it never enters a batch.
4. **Batch** — Operator opens a batch for a hub + material. Clean events are added to the batch. Operator seals the batch, which computes a Merkle tree from the event hashes and freezes membership.
5. **Proof** — The collector (or an operator, on their behalf) opens the printable proof page for the event, which shows a short lookup code — the first 10 characters of the event's `payloadHash`, computed the same way on the client and the server. The collector brings this code, and the material, to a verification hub.
6. **Re-weigh** — Hub staff look the event up by id or lookup code on the dashboard's Reweigh screen, weigh the material themselves, and record what the scale reads. The server computes the variance against the claimed weight and applies a fixed ±5% tolerance: within it, `status: "verified"`; outside it, `status: "flagged"` with a mandatory note explaining the gap. Neither status blocks payment — a flagged re-weigh still proceeds, at the lower, hub-verified weight.
7. **Payout** — Hub staff select one or more of a collector's re-weighs and create a payout on the Payouts screen. Each item's amount is resolved from the `material_rates` table (a rate per kg for the material, optionally overridden per hub, at the most recent `effectiveFrom` on or before now). Marking the payout paid records who confirmed it and when.
8. **Report** — Anyone can download the audit report for a batch. It contains every event with its Merkle proof, the sealed root, the chain of custody, and — for every event that has one — its re-weigh and the payout that covers it. A reader can recompute the root and proofs independently, and cross-check a payout's amount against the verified weight and the rate that applied, without trusting ProofChain's word for it.

## Repo Layout

```
proofchain/
├── README.md                      # This file
├── docs/
│   ├── runbook.md                 # Operational guide
│   ├── verification.md            # How to verify a re-weigh and a payout
│   └── architecture.md            # Data model, integrity checks, design decisions
├── apps/
│   ├── backend/                   # NestJS API + Postgres + batch sealing + reweigh/payouts
│   ├── dashboard/                 # Next.js operator/hub-staff/auditor UI
│   ├── capture/                   # Vite PWA for field weigh-ins
│   └── mobile/                    # Expo/React Native collector app
├── packages/
│   └── shared/                    # Trust kernel: signing, Merkle tree, types
├── contracts/
│   └── batch-registry/            # Soroban contract — left in place, unwired; not part of the running system
├── infra/
│   └── docker-compose.yml         # Postgres (port 5433) + Redis (port 6380)
└── scripts/
    └── demo-e2e.mjs               # End-to-end smoke test
```

## Quickstart

### Prerequisites
- Node.js 20.11+
- Docker (for Postgres + Redis)

### Setup

1. **Clone and install dependencies:**
   ```bash
   npm install
   ```

2. **Start Postgres and Redis:**
   ```bash
   npm run db:up
   ```
   Postgres listens on localhost:5433 (not 5432). Redis on localhost:6380.

3. **Set up environment variables:**
   ```bash
   cp .env.example .env
   ```
   The `.env` file contains placeholders for:
   - `DATABASE_URL` — Postgres connection (already set to localhost:5433)
   - `REDIS_URL` — Redis connection (already set to localhost:6380)
   - `JWT_SECRET` — Backend session secret (change in production)
   - `PHOTO_STORAGE_DIR` / `MAX_PHOTO_BYTES` — where uploaded weigh-in photos are stored on disk, and the per-photo size ceiling

4. **Run database migrations and seed:**
   ```bash
   cd apps/backend
   npm run migration:run
   npm run seed
   ```
   The seed creates:
   - One hub (Nairobi Pilot Hub)
   - Two collectors (Amina Wanjiru, Joseph Otieno)
   - One enrolled ed25519 device per collector, with the private keys written to
     `apps/backend/var/seed-devices.json` so the capture app and the demo can
     sign as a real enrolled device
   - Three users: `operator@proofchain.local` / `operator-dev-password`, plus
     `auditor@` and `admin@` with matching `-dev-password` suffixes
   - A default `material_rates` row (50/kg, no hub override) for every active
     material, so a payout has something to price against out of the box —
     `POST /payouts` fails with a clear error for any material/hub combination
     that has none

5. **Build and start services:**
   ```bash
   # Build all workspaces
   npm run build

   # Terminal 1: Backend API (port 3000)
   cd apps/backend && npm run start:dev

   # Terminal 2 (optional): Dashboard (port 3001)
   cd apps/dashboard && npm run dev

   # Terminal 3 (optional): Capture PWA (port 3002)
   cd apps/capture && npm run dev
   ```

### Run the End-to-End Demo

The demo smoke-tests the entire pipeline: creates 12 signed weigh-ins, opens a batch, seals it, records chain of custody, re-weighs two of one collector's drop-offs at the hub (one within tolerance, one flagged with a stated reason), creates a payout from both, marks it paid, and downloads the audit report to confirm the re-weighs and payout both appear in it.

**Requirements:** Backend running on :3000, database migrated and seeded.

```bash
node scripts/demo-e2e.mjs
```

**Expected output** (ids, hashes and the randomised weights vary run to run — the shape and the pass/fail wording do not):
```
[1/9] Authenticating as the hub operator
  logged in as operator
  hub NBO-01

[2/9] Capturing signed weigh-ins from enrolled devices
  12/12 weigh-ins passed integrity v1
  12 photos uploaded and hash-checked by the server
  substituted photo rejected: true (HTTP 400)

[3/9] Proving a tampered weigh-in is rejected
  inflated weigh-in quarantined=true; failed checks: weight_in_range

[4/9] Opening a batch and adding the clean events
  batch 5c1e2a3b-...

[5/9] Sealing the batch (membership and Merkle root freeze here)
  root      : 7f2d1ab3c9...
  weight    : 187.442 kg across 12 weigh-ins

[6/9] Recording chain of custody with reconciliation
  custody transfer recorded

[7/9] Recording hub re-weighs (within-tolerance and flagged cases)
  event a1b2c3d4: claimed 14.223 kg, verified 14.223 kg -> verified (0% variance)
  event e5f6a7b8: claimed 21.56 kg, verified 17.248 kg -> flagged (20% variance)
  duplicate re-weigh of an already-recorded event rejected: true (HTTP 409)
  GET /events/:id/reweigh returns 1 record(s) for that event

[8/9] Creating a payout from verified re-weighs and marking it paid
  rate in effect: 50/kg for PET (global default)
  payout 9c8b7a6d: 1573.55 NGN (pending), covering 2 re-weigh(s)
  payout marked paid, ref demo-cash-handover-001
  double mark-paid rejected: true (HTTP 409)

[9/9] Fetching the audit artifact and verifying it independently
  report version   : proofchain.audit.v1
  tonnes           : 0.187442
  sealed root      : 7f2d1ab3c9...
  recomputed root  : 7f2d1ab3c9...
  roots agree      : true
  all proofs valid : true
  reconciliation   : gap 1.4 kg (0.75%)
  reweighs         : 2 recorded (1 verified, 1 flagged)
  payouts          : 1 recorded, 1 paid
  independent proof check on event a1b2c3d4-...: true
  verify endpoint agrees: true
  photo evidence  : 12/12 events
  photo round-trip: true

End-to-end verified. batch=5c1e2a3b-...
Audit report : http://localhost:3000/batches/5c1e2a3b-.../report
Event CSV    : http://localhost:3000/batches/5c1e2a3b-.../report/events.csv
Payout       : http://localhost:3000/payouts/9c8b7a6d-...
```

## What's Included in This Release

- **Weigh-in signing** — Devices sign payloads on-device; server verifies.
- **Integrity v1** — 6 checks covering signature, enrollment, weight, duplicates, clock, photo hash.
- **Batch sealing** — Merkle tree computation, membership freeze.
- **Printable proof** — A dashboard page per event showing a short lookup code, meant to be printed (or just shown on-screen) and brought to a hub.
- **Hub re-weigh** — An operator/hub-staff screen to look an event up and record an independently-measured weight, with a fixed ±5% tolerance driving a `verified`/`flagged` outcome — never an auto-reject.
- **Payouts** — Turning one or more verified/flagged re-weighs into a priced, trackable payout, resolved from a material rate table and markable as paid.
- **Independent verification** — Merkle proofs and an audit report anyone can recompute and cross-check without trusting our word for it — see [verification.md](docs/verification.md).
- **Operator dashboard** — Batches, events, custody transfers, re-weighs, payouts and material rates.
- **Offline-first capture** — PWA and Expo app with IndexedDB queue.
- **Photo evidence** — Photos upload separately from the weigh-in and are stored only if they hash to the digest the device signed.

## What's NOT in Scope Yet

- **Automated fraud detection beyond the tolerance check** — The ±5% re-weigh tolerance is the only automated discrepancy signal; there is no cross-event or cross-collector anomaly detection.
- **Photo content analysis** — Bytes are stored and checked against the signed hash, so an auditor can view the image and confirm it is the one captured. What the image *depicts* is still not analysed: no material classification, no tamper or staging detection.
- **Behavioral baselining** — Per-collector anomaly detection deferred to v2.
- **Structured payout destinations** — Payouts are recorded as manual/cash (or another free-text `method`); there is no mobile-money integration or a validated payout-account field on a collector record yet.
- **Correcting a recorded re-weigh** — One re-weigh per event, and there is no API to edit or reject one after it's recorded; `status: "rejected"` exists on the entity for a future manual-override workflow but nothing sets it today.
- **Soroban credit contract** — `contracts/batch-registry` exists in the repo but is intentionally unwired; nothing imports or calls it.
- **Verra accreditation** — This is a technical pilot, not a credit issuer.

## Documentation

- **[Runbook](docs/runbook.md)** — How to run each service and troubleshoot common problems.
- **[Verification](docs/verification.md)** — How a hub operator verifies a submission, and how an auditor independently checks a payout.
- **[Architecture](docs/architecture.md)** — Data model, integrity v1 checks, design rationale.

## API Endpoints (Swagger at /docs in dev mode)

### Public (no auth required)
- `GET /materials` — The material catalogue, retired entries included and flagged
- `GET /hubs/directory` — Hub identities, for capture devices
- `POST /events` — Ingest a signed weigh-in
- `GET /events/:id` — Look up a weigh-in (used by the printable proof page)
- `POST /events/:id/photo` — Upload photo bytes for a signed weigh-in
- `GET /events/:id/photo` — The stored photo, if uploaded
- `GET /events/:eventId/reweigh` — A weigh-in's re-weigh history (usually 0 or 1 record)
- `GET /batches/:id/report` — Audit artifact (JSON): events, Merkle proofs, reweighs, payouts
- `GET /batches/:id/report/events.csv` — Event CSV export
- `GET /batches/:id/verify/:eventId` — Merkle proof for one event
- `POST /auth/login` — Exchange email and password for a JWT

### Operator (JWT required)
- `GET /batches`, `GET /batches/:id`, `GET /batches/:id/events` — any signed-in role
- `POST /batches` — Open a batch
- `POST /batches/:id/events` / `DELETE /batches/:id/events/:eventId` — Add/remove events on an open batch
- `POST /batches/:id/seal` — Seal and compute Merkle root
- `POST /batches/:id/status` — Advance to `processed`/`sold`
- `POST /batches/:batchId/custody` — Record chain of custody

### Reweigh, payouts and material rates
- `POST /events/:eventId/reweigh` — Record a hub re-weigh (admin/operator). Computes variance against the claimed weight and applies a fixed ±5% tolerance: within it, `status: "verified"`; outside it, `status: "flagged"` and `notes` is required. Both are payable — neither blocks payment, and there is no manual-review gate in this release.
- `POST /payouts` — Create a payout for one collector covering one or more of their re-weighs (admin/operator). Each item's amount is resolved from `material_rates` (most specific `hubId` match, latest `effectiveFrom` at or before now); the request fails with a clear error if no rate is configured for that material/hub.
- `POST /payouts/:id/mark-paid` — Transition a payout `pending` → `paid` (admin/operator). A payout cannot be marked paid twice.
- `GET /payouts`, `GET /payouts/:id` — admin, operator or auditor
- `GET /material-rates` — List rates, optionally filtered by `materialCode`/`hubId` (admin/operator)
- `POST /material-rates` — Add a rate (admin only)

### Materials (admin only)
- `POST /materials` — Add a material. The code becomes permanent once a device signs it.
- `PATCH /materials/:code` — Edit the name, field guidance or product list, or retire with `{"active": false}`
- `DELETE /materials/:code` — Only succeeds for a code no event and no batch has used

A material code is part of the signed weigh-in payload, so it is hashed into the
Merkle leaf of every batch containing it. There is deliberately **no way to rename a
code** — doing so would invalidate the audit report of every batch containing it.
Retire it instead: the capture apps stop offering it, and every stored weigh-in
keeps verifying. `name`, the field guidance and the `examples` product list are
presentation only and safe to change at any time. The products — "milk jugs",
"bottle caps" — are what the capture apps show a collector so they can tell what a
code covers without knowing the resin names.

Ingest (`POST /events`) accepts a retired code but not an unknown one, so a phone
syncing a queue it signed hours ago still lands its work; opening a batch requires
an active one. See [architecture.md](docs/architecture.md#9-materials-material_catalogue).

### Accounts
- `POST /auth/login` — Exchange email and password for a JWT
- `GET /auth/me` — Who the presented token belongs to, as the database sees them now
- `POST /auth/password` — Change your own password
- `GET|POST /users`, `GET|PATCH /users/:id`, `POST /users/:id/password` — Admin only

Deactivating a user (`PATCH /users/:id {"active": false}`) takes effect on their
next request rather than when their token expires: the guard re-reads the row.
The last active admin cannot be demoted or deactivated.

### Health
- `GET /health` — Liveness check, including a database query

## Known Limitations

- **The re-weigh tolerance is fixed, not configurable** — ±5% applies to every material and every hub. A material genuinely prone to moisture loss has no per-material allowance; a wide reading is simply `flagged` with a note.
- **No manual-review gate on a flagged re-weigh** — By design (Phase 1 decision #2): a flagged re-weigh is payable immediately, at the verified weight, with no approval step. `status: "rejected"` exists on the entity for a future override but nothing in this release sets it.
- **One re-weigh per event, uncorrectable via the API** — A mis-keyed verified weight cannot be edited or removed once recorded; there is no PATCH/DELETE on `/events/:eventId/reweigh`.
- **Timestamp-only integrity** — Clock skew tolerance is ±15 seconds by default (`MAX_CLOCK_SKEW_SECONDS`). Offline sync is allowed (warn outcome) but flagged.
- **No rollback** — Once a batch is sealed, it cannot be modified. Events cannot be removed from a sealed batch.
- **Photos are stored on local disk** — `PHOTO_STORAGE_DIR` is a filesystem path,
  so it needs a mounted volume and a backup policy; there is no object store or
  replication yet. Photos are personal data about identifiable collectors and
  should be treated accordingly.
- **No rate limiting per collector** — Integrity v1 has no behavioral throttling; v2 will add per-collector quotas.
- **Payout destination is manual/cash only** — `method` is free text (e.g. "cash", "mobile money"), not a validated or integrated payment rail.
- **No automated fraud detection beyond the ±5% tolerance check** — See "What's NOT in Scope Yet" above.

## Development

### Running Tests

```bash
npm run test         # All workspaces
npm run typecheck    # TypeScript type-check
npm run lint         # ESLint (if configured per-workspace)
```

### Adding a New Check

Integrity checks live in `apps/backend/src/events/integrity.ts`. To add a check:

1. Add a function `checkYourCheck(payload, ctx): IntegrityFinding`.
2. Add it to the `findings` array in `evaluateIntegrity()`.
3. Document what it defends against.
4. Add tests in the backend's test suite.

### Modifying the Data Model

Database schema is managed via TypeORM migrations:

```bash
cd apps/backend

# After changing an entity file:
npm run migration:generate -- -n YourMigrationName

# Then review and apply:
npm run migration:run
```

Never use `synchronize: true` in production.

## History

Earlier revisions of this project anchored each sealed batch's Merkle root to
the Stellar testnet ledger and independently verified it via Horizon. That
architecture has been fully replaced by the hub re-weigh → payout workflow
described above: no blockchain-anchoring code remains anywhere in the backend
or any app, and the `services/anchor-worker` workspace has been deleted.
`contracts/batch-registry` (a Soroban smart contract explored for a future,
stateful credit registry) is still present in the repo but was never wired up
and is not part of the running system today.

## Support

For operational issues, see [Runbook](docs/runbook.md).  
For verification questions, see [Verification](docs/verification.md).  
For architecture questions, see [Architecture](docs/architecture.md).

## License

MIT
