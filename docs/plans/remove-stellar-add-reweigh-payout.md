# Plan: Remove Stellar anchoring, add self-report → re-weigh → payout workflow

Status: IMPLEMENTED (Phases 2-9 complete, unstaged/uncommitted — see the note at the bottom of this file for the one post-verification fix and what remains unverified due to environment constraints).
Scope: `proofchain/` monorepo (backend, dashboard, capture, mobile, shared, anchor-worker, contracts).

## Phase 0 — Documentation Discovery (consolidated findings)

Four research passes were run against the live repo (not assumed). Summary of what's confirmed:

**Allowed APIs / patterns to reuse (cite, don't reinvent):**
- Signing: `packages/shared/src/signing.ts` — `generateDeviceKeypair`, `signWeighIn`, `verifyWeighInSignature`, `generateNonce`. Two runtime implementations must stay interop-compatible: Node `node:crypto` (backend) and `@noble/curves/ed25519` (capture/mobile), cross-checked by `packages/shared/test/browser-interop.test.ts`. **Reusable as-is** — no Stellar coupling.
- Merkle: `packages/shared/src/merkle.ts` — `hashLeaf`, `buildMerkleTree`, `merkleRootHex`, `merkleProof`, `verifyMerkleProof`. Pure hash math, zero Stellar coupling. **Reusable as-is.**
- Money/weight columns: Postgres `numeric(p,3)` + `numericTransformer` on the TypeORM column (`apps/backend/src/database/entities.ts` lines 34-38). No decimal.js/big.js in the repo — follow this existing convention for any new amount/weight column.
- Migration style: doc-commented class matching filename, `up`/`down` raw SQL. Templates:
  - New table: `apps/backend/src/database/migrations/1786400000000-AnchorAttempts.ts` (whole file)
  - New table + CHECK + seed: `1786600000000-Materials.ts` lines 24-61
  - Additive nullable column: `1786500000000-HubLocality.ts` lines 17-19
  - NOT NULL column + backfill: `1786700000000-MaterialExamples.ts` lines 28-40
- Module template: `apps/backend/src/custody/custody.module.ts` (14 lines) — minimal Nest module shape to copy for new modules.
- Service-with-invariant pattern: `apps/backend/src/custody/custody.service.ts` lines 28-57 — two-weight + variance + mandatory-reason-on-mismatch. This is the direct template for the re-weigh discrepancy check.
- DTO pattern: `apps/backend/src/common/dto.ts` lines 279-289 (`CreateCustodyTransferDto`) — template for new DTOs.
- Dashboard: Next.js App Router, Server Components + Server Actions, no client API routes. Central server-only client: `apps/dashboard/src/lib/api.ts` (`request<T>()` + a single `api` object). New endpoints get added to this object, not a new client. Print-oriented page pattern already exists at `apps/dashboard/src/app/batches/[id]/report/page.tsx` (uses a `no-print` CSS class convention) — **this is the direct template for the new printable-proof page**, so no PDF library needs to be added; the browser's native print-to-PDF covers "printable file."
- Nav: flat `<Link>` list hardcoded in `apps/dashboard/src/app/layout.tsx` lines 43-48.

**Anti-patterns / things NOT to do:**
- Do not sign/verify arbitrary bytes by extending `signWeighIn`/`verifyWeighInSignature` casually — they're hardcoded to `WeighInPayload` shape via `canonicalEventPayload`. Any change to what gets signed requires bumping `schema: "proofchain.weighin.v2"` (see `packages/shared/src/canonical-core.ts` doc comment) since old devices/servers must never silently disagree.
- Do not alter `CollectionEventEntity`'s signed/hashed columns (`weightKg`, `payloadHash`, etc.) — they feed the Merkle leaf and are treated as immutable once ingested (see rationale in migration `1786800000000-RemoveLocation.ts`). New re-weigh data must live in a **separate table**, not as an edit to the signed event row.
- Do not edit historical migration files (`InitialSchema.ts`, `AnchorAttempts.ts`) to remove the anchor tables — write a **new** migration that drops them, matching the project's additive-migration convention.
- Do not invent a PDF-generation dependency — no PDF/QR library exists in any app today; default to the browser-print pattern already in use unless Phase 1 decides a QR/scan workflow is required.
- Do not reuse the existing `verifyEvent`/`EventVerification` naming for the new re-weigh concept — that name is already taken by the Merkle-inclusion-proof feature (`GET /batches/:batchId/verify/:eventId`), which is being kept. The new concept is called **"reweigh"** throughout this plan to avoid confusion.

---

## Phase 1 — Decisions (LOCKED)

1. **Discrepancy tolerance: ±5%** between claimed weight and hub re-weigh. Within tolerance → `status: "verified"`. Outside tolerance → `status: "flagged"`.
2. **Discrepancy policy: auto-pay the verified (lower) weight.** A flagged reweigh is not rejected and does not block payout — the collector is paid for the hub-verified amount, not the claimed amount. `notes` is still mandatory on a flagged reweigh (audit trail of why it diverged), but there is no manual-review gate in this phase.
3. **Payout destination: manual/cash for now.** No `payoutAccount`/`payoutMethod` column added to `CollectorEntity` in this phase — Phase 4d (collector-registry changes) is dropped from scope. `PayoutEntity.method` still exists as a free-text/enum field so hub staff can record how a specific payout was actually handed over (cash, mobile money, etc.) without it being a structured, validated collector attribute yet.
4. **Pricing: fixed rate table per material/hub.** `MaterialRateEntity` (table `material_rates`) is in scope (Phase 2c), keyed by `materialCode` with an optional `hubId` override and `effectiveFrom` — the payout service looks up the applicable rate rather than taking a manual amount per item.
5. **Proof mechanism (default, not asked): plain printed lookup code.** No QR library added in this phase; Phase 5 stays as specified (reuse the existing print-page pattern). Revisit as a fast-follow if hub lookup-by-code proves too slow in practice.
6. **`contracts/batch-registry` (default, not asked): leave in place, unwired.** It is already fully deferred and nothing imports it — deleting it is a zero-value risk to take on in this pass. Phase 3's delete list and the CI `contracts` job are both updated to "leave untouched" accordingly.

---

## Phase 2 — Database: remove anchor schema, add reweigh + payout schema

**2a. Remove anchor/Stellar tables (new migration, don't edit history)**
- New file `apps/backend/src/database/migrations/<timestamp>-RemoveAnchoring.ts`, following the `AnchorAttempts.ts` template (§Phase 0).
- `down()`/`up()` drop, in order: FK `FK_anchor_attempts_batch`, table `anchor_attempts`, the `anchor_records` unique constraint/FK, table `anchor_records`.
- Edit `apps/backend/src/database/entities.ts`: delete `AnchorRecordEntity` and `AnchorAttemptEntity` classes entirely; remove `anchor: AnchorRecordEntity | null` OneToOne field from `BatchEntity`; remove both from the `ALL_ENTITIES` array; drop the now-unused `StellarNetwork` import.
- Edit `packages/shared/src/types.ts`: remove `StellarNetwork`, `AnchorRecord`, `AnchorAttemptOutcome`; strip the `onChain` field from `EventVerification`.

**2b. Add reweigh table**
- New entity `EventReweighEntity` (table `event_reweighs`) in `entities.ts`, modeled on `CustodyTransferEntity` (structural precedent) — do NOT bolt these columns onto `CollectionEventEntity` (see Phase 0 anti-pattern).
  - `id` uuid PK
  - `eventId` uuid FK → `collection_events.id`, **unique** (one reweigh per event), `ON DELETE RESTRICT`
  - `claimedWeightKg` numeric(10,3) — copied from the event at reweigh time for a self-contained audit row
  - `verifiedWeightKg` numeric(10,3) — hub staff's re-weigh
  - `varianceKg` numeric(10,3) — stored, not derived (matches `CustodyTransferEntity.varianceKg` convention)
  - `variancePct` numeric(6,3) — stored
  - `status` varchar — `"verified" | "flagged" | "rejected"` (policy from Phase 1 decision #2 drives the logic that sets this)
  - `notes` nullable varchar — required when status is `flagged`/`rejected` (mirrors `CustodyTransferEntity`'s mandatory-reason-on-mismatch pattern from `custody.service.ts` lines 28-57)
  - `verifiedByUserId` uuid FK → `users.id` (captured from `CurrentUser()`/JWT `sub`, per `auth.module.ts` `JwtPayload`)
  - `verifiedAt` timestamptz
  - `createdAt` timestamptz
- New migration `<timestamp>-EventReweighs.ts` using the new-table-with-FK template (§Phase 0).

**2c. Add payout tables**
- `PayoutEntity` (table `payouts`): `id`, `collectorId` FK → `collectors.id`, `amount` numeric(12,2), `currency` varchar default `"NGN"`, `method` varchar (`"cash" | "mobile_money" | "bank"` — free-text record of how this specific payout was handed over; not a validated collector attribute, per Phase 1 decision #3), `payoutRef` nullable varchar, `status` varchar (`"pending" | "paid" | "failed"`), `paidByUserId` nullable FK → `users.id`, `paidAt` nullable timestamptz, `createdAt`.
- `PayoutItemEntity` (table `payout_items`): `id`, `payoutId` FK → `payouts.id` `ON DELETE CASCADE`, `eventReweighId` FK → `event_reweighs.id` `ON DELETE RESTRICT` (a payout can cover multiple verified drop-offs), `amount` numeric(12,2).
- `MaterialRateEntity` (table `material_rates`), per Phase 1 decision #4: `id`, `materialCode` FK → `materials.code`, `hubId` nullable FK → `hubs.id` (null = global default), `ratePerKg` numeric(10,2), `effectiveFrom` timestamptz, `createdAt`. The payout service resolves the applicable rate (most specific `hubId` match, most recent `effectiveFrom` ≤ now) rather than taking a manual amount per item.
- No `collectors` schema change in this phase — payout destination stays manual/cash (Phase 1 decision #3); Phase 4d (collector-registry payout fields) is dropped from scope.
- New migration(s) using the new-table template: `EventReweighs`, `Payouts`, `MaterialRates`.

---

## Phase 3 — Backend: remove the Stellar/anchor layer

Delete entirely:
```
services/anchor-worker/                     (whole workspace: package.json, src/, scripts/, tests, tsconfig, vitest.config)
apps/backend/src/ledger/                    (horizon.client.ts, ledger-verification.service.ts, ledger.module.ts)
apps/backend/src/batches/anchor-attempts.service.ts
apps/backend/src/batches/anchor-backoff.ts
apps/backend/test/anchor-attempts.migration.test.ts
apps/backend/test/anchor-attempts.service.test.ts
apps/backend/test/anchor-backoff.test.ts
apps/backend/test/anchor-failure.controller.test.ts
apps/backend/test/anchor-worker-guard.test.ts
apps/backend/test/horizon.client.test.ts
apps/backend/test/ledger-verification.service.test.ts
```

`contracts/` is left in place, unwired, per Phase 1 decision #6.

Edit (remove Stellar-specific parts, keep the rest — exact method-level breakdown already confirmed in research):
- `apps/backend/src/batches/batches.service.ts` — remove `pendingAnchor()`, `anchorHealth()`, `recordAnchor()`, `recordAnchorFailure()`, `ledgerStatus()`, `anchorAttemptsFor()`, `explorerUrl()`, and the `PendingAnchorBatch`/`AnchorHealth`/`AwaitingAnchor`/`BatchLedgerStatus` interfaces; remove `anchors`/`ledger`/`attempts` constructor deps; strip the `onChain`/`confirmation` block from `verifyEvent()`; remove `relations: { anchor: true }` from `findOne()`/`list()`. **Keep** `orderedEvents()`, `leavesOf()`, `create()`, `addEvents()`, `removeEvent()`, `recomputeTotals()`, `seal()`, `advanceStatus()`, `eventsOf()` — these are generic Merkle/batch-lifecycle logic with zero Stellar coupling.
- `apps/backend/src/batches/batches.controller.ts` — remove `GET /batches/pending-anchor`, `GET /batches/anchor-health`, `GET /batches/:id/anchor-attempts`, `POST /batches/:id/anchor`, `POST /batches/:id/anchor-failure`, `GET /batches/:id/ledger`. Keep everything else including `GET /batches/:batchId/verify/:eventId` (edit its response shape only).
- `apps/backend/src/batches/batches.module.ts` — remove `AnchorAttemptEntity` from `TypeOrmModule.forFeature`, remove `LedgerModule` import/registration, remove `AnchorAttemptsService` from providers/exports.
- `apps/backend/src/reports/reports.service.ts` and `reports.module.ts` — remove `LedgerVerificationService` dependency/usage and `LedgerModule` registration; remove `onChain` from `AuditReport` (replaced by reweigh/payout fields in Phase 4c).
- `apps/backend/src/auth/auth.module.ts` — remove `AnchorWorkerGuard` class and export.
- `apps/backend/src/config/configuration.ts` — remove `stellarNetwork`, `stellarHorizonUrl`, `horizonTimeoutMs`, `anchorWorkerToken` fields and their env reads.
- `apps/backend/src/common/dto.ts` — remove `RecordAnchorDto`, `RecordAnchorFailureDto`.
- `apps/backend/test/support/services.ts` — remove `stubLedgerVerification()`, `buildAnchorAttemptsService()`.
- `apps/backend/test/reports.service.test.ts`, `batches.service.test.ts`, `test/integration/batches.integration.test.ts` — remove anchor/ledger test cases (read each file fully before editing; not itemized by the research pass).
- `apps/backend/src/database/seed.ts`, `create-admin.ts` — check for `AnchorRecordEntity`/`stellarTxHash` references and remove (flagged as unverified by research, confirm before editing).

Config/infra cleanup:
```
.env.example (root)              — remove the "Stellar (testnet)" block
apps/backend/.env.example        — remove ANCHOR_WORKER_TOKEN
package.json (root)              — remove "services/*" workspace glob, scripts stellar:account/worker, edit description
render.yaml                      — remove the "Anchor worker" service block, remove ANCHOR_WORKER_TOKEN from API service
infra/docker-compose.prod.yml    — remove backend.environment.STELLAR_NETWORK, remove the worker: service block
.github/workflows/ci.yml         — remove ANCHOR_WORKER_TOKEN env var; keep the contracts job unchanged (contracts/ stays, per Phase 1 decision #6)
Dockerfile                       — remove anchor-worker COPY/build/runtime stages
```

---

## Phase 4 — Backend: add the reweigh + payout workflow

**4a. Reweigh module** (`apps/backend/src/reweigh/`, modeled on `custody.module.ts`/`custody.service.ts`/`custody.controller.ts`)
- `reweigh.module.ts` — imports `TypeOrmModule.forFeature([EventReweighEntity, CollectionEventEntity])`, exports `ReweighService`.
- `reweigh.service.ts` — `create(eventId, dto, verifiedByUserId)`:
  - Load the `CollectionEventEntity` (404 if missing, reject if already has a reweigh — one-to-one).
  - Compute `varianceKg = claimedWeightKg - verifiedWeightKg`, `variancePct`.
  - Apply the ±5% tolerance (Phase 1 decision #1): within tolerance → `status:"verified"`; outside tolerance → `status:"flagged"`. **Both are payable** — per Phase 1 decision #2 there is no auto-reject or review gate; a flagged reweigh still proceeds to payout, just at the verified (lower) weight. `status:"rejected"` is not set automatically by this logic — it exists on the entity only as a manual override hub staff could apply separately (e.g. voiding a submission for cause), and is out of scope for this phase's automated flow.
  - `notes` is required whenever `status:"flagged"` (mirrors `custody.service.ts` lines 28-57's mandatory-reason-on-mismatch check) — this is the audit trail, not a payment gate.
  - Persist `EventReweighEntity`.
- `reweigh.controller.ts` — `POST /events/:eventId/reweigh` (`@Roles("admin","operator")`, DTO `RecordReweighDto { verifiedWeightKg, notes? }` following `CreateCustodyTransferDto` shape), `GET /events/:eventId/reweigh` (public, mirrors `GET /batches/:id/custody`).
- DTO in `apps/backend/src/common/dto.ts`: `RecordReweighDto` (template: `CreateCustodyTransferDto`, lines 279-289).

**4b. Payout module** (`apps/backend/src/payouts/`)
- `payouts.module.ts` — imports `TypeOrmModule.forFeature([PayoutEntity, PayoutItemEntity, EventReweighEntity, MaterialRateEntity, CollectorEntity])`.
- `payouts.service.ts` — `create(collectorId, eventReweighIds[], method)`: loads the given `EventReweighEntity` rows, rejects any with `status:"rejected"` or already attached to a payout item (both `"verified"` and `"flagged"` are eligible, per decision #2); for each, resolves the applicable `MaterialRateEntity` (most specific `hubId` match, latest `effectiveFrom` ≤ now) and computes `amount = verifiedWeightKg * ratePerKg`; persists `PayoutEntity` + `PayoutItemEntity` rows in a transaction (pattern: `batches.service.ts` `seal()` transactional-lock style). `markPaid(payoutId, payoutRef)` transitions `status: pending → paid`.
- `payouts.controller.ts` — `POST /payouts` (`@Roles("admin","operator")`), `POST /payouts/:id/mark-paid` (`@Roles("admin","operator")`), `GET /payouts?collectorId=` (`@Roles("admin","operator","auditor")`), `GET /payouts/:id`.

**4c. Reports** — extend `AuditReport`/`reports.service.ts` (which already aggregates `collectors[]`) to add `reweighs[]` and `payouts[]` sections, following the existing "recompute from source rows" idiom (don't cache totals).

**4d. Collector registry** — dropped from scope (Phase 1 decision #3: manual/cash payouts, no structured payout-destination field on the collector record in this phase).

**4e. Material rates** — new minimal module `apps/backend/src/material-rates/` (or fold into `materials.controller.ts`/`materials.service.ts`) exposing `POST /material-rates` and `GET /material-rates` (`@Roles("admin")`), so a rate can be set per material/hub before payouts can be computed. Seed at least one default (`hubId: null`) rate per active material in `apps/backend/src/database/seed.ts`, otherwise `payouts.service.ts` has nothing to resolve against in the demo/dev environment.

---

## Phase 5 — Printable proof

- No new page needed from scratch — copy the structure of `apps/dashboard/src/app/batches/[id]/report/page.tsx` (print-oriented layout, `no-print` CSS class convention, `formatDateTime`/`formatKg`/`shortHash` helpers from `apps/dashboard/src/lib/format.ts`).
- New route `apps/dashboard/src/app/events/[id]/proof/page.tsx` (or extend the existing `apps/dashboard/src/app/events/page.tsx` — read it in full before deciding, it wasn't in the research scope) rendering: collector name, hub, material, claimed weight, capture timestamp, a short lookup code (first 8-12 chars of `payloadHash`, already computed server-side), and instructions to present this at the verification hub.
- Backend: no new PDF generation service needed — the page IS the printable artifact via the browser's print dialog, matching the existing report page's own approach. Only add a lightweight `GET /events/:id` public lookup endpoint if one doesn't already exist for this (check `events.controller.ts` — research noted `GET /events` and `GET /events/:id` already exist).
- If Phase 1 decision #5 chooses QR: add a QR-rendering library to `apps/dashboard` (client-side, e.g. rendered only in the printable page) — this is the only place a new dependency would be introduced, and it's additive/isolated.

---

## Phase 6 — Capture & mobile apps: show proof after submit

- `apps/capture/src/main.ts`: after `commit()` (lines 805-873) succeeds and `queue.enqueue(...)` completes, add a new screen state (alongside `provisionScreen()`/`captureScreen()`) showing the lookup code and a "print/save this" prompt, or a link to the dashboard proof page once `runSync()` resolves with a server `eventId`. Given the offline-first queue, the code must be derivable locally (it can be — `payloadHash` is computed client-side already as part of signing) rather than waiting on the server.
- `apps/mobile/src/screens/CaptureScreen.tsx`: same shape — after `capture()` (lines 118-170) calls `enqueue(appStore, record)`, either show a proof step before calling `onCaptured()`, or add a "Proof" affordance reachable from the Queue tab (`apps/mobile/src/screens/QueueScreen.tsx` — read in full before implementing, not in research scope) once `serverEventId` is populated by sync.
- Neither app needs a PDF/QR library for this if Phase 1 decision #5 stays with the lookup-code approach — it's just a text/number displayed and can be photographed or handwritten if there's no printer in the field; the actual "printable file" is the dashboard proof page (Phase 5), viewed later at a hub or a location with a printer.

---

## Phase 7 — Dashboard: verification hub + payments screens

- New route `apps/dashboard/src/app/reweigh/page.tsx` (or `/verify`): a lookup form (by event ID or the short code from Phase 5) → shows claimed weight/photo/material → a form posting to `POST /events/:eventId/reweigh` (Server Action calling `api.recordReweigh`, added to `apps/dashboard/src/lib/api.ts`'s `api` object) → shows resulting status (verified/flagged/rejected) and variance.
- New route `apps/dashboard/src/app/payouts/page.tsx`: list pending-payout reweighs by collector, a form to create a payout (`POST /payouts`) and mark paid (`POST /payouts/:id/mark-paid`).
- Remove anchor-specific UI (research pass enumerated exact locations, read these files in full before editing since only grepped so far):
  - `apps/dashboard/src/lib/api.ts` — remove `Batch.anchor`, `AuditReport.onChain`, `AwaitingAnchor`/`AnchorHealth`/`AnchorAttempt` types, `api.anchorHealth()`, `api.anchorAttempts()`.
  - `apps/dashboard/src/app/page.tsx` — remove "Anchored" stat card, stuck-batches banner, "Proof" column pill; adjust subtitle copy.
  - `apps/dashboard/src/app/batches/[id]/page.tsx` — remove "Proof status"/"Anchoring history" sections (keep "Seal batch"/"Mark processed/sold" actions, unrelated to anchoring).
  - `apps/dashboard/src/app/batches/[id]/report/page.tsx` — remove the on-chain/Stellar verification section; this is also the template being copied for Phase 5, so do this edit first.
  - `apps/dashboard/src/app/layout.tsx` — update nav (add Reweigh/Payouts links, per the existing flat `<Link>` pattern lines 43-48) and metadata description copy.
  - `e2e/dashboard.mjs` — remove/replace the `stellar.expert` link assertion (line 108); add e2e coverage for the new reweigh/payout flow.

---

## Phase 8 — Docs and demo rewrite

- `README.md` — rewrite tagline, architecture diagram, pipeline steps, setup section (drop Stellar account/funding steps), demo section, API endpoint list, capability bullets around the new self-report → reweigh → payout flow.
- `docs/architecture.md` — rewrite anchor_records schema section, "Why Classic Stellar" section.
- `docs/runbook.md` — remove Stellar troubleshooting/setup steps.
- `docs/verification.md` — replace entirely: this file is currently "how to verify the Stellar anchor end-to-end"; rewrite as "how a hub operator performs a reweigh" and "how an auditor checks a payout against verified reweighs."
- `scripts/demo-e2e.mjs` — remove step 7 (Stellar anchor) and the `describeTriState()`/`describeLedger()` helpers and the `onChain`/ledger-endpoint assertions inside step 8; add new steps for reweigh + payout, keeping steps 1-6 (signing, integrity, batching, sealing, custody) unchanged.

---

## Phase 9 — Verification (final phase)

1. Grep the repo for `STELLAR|HORIZON|stellar|horizon` (excluding `contracts/` if Phase 1 decision #6 kept it deferred) — should return zero hits outside anything explicitly kept.
2. Grep for `AnchorRecordEntity|AnchorAttemptEntity|LedgerVerificationService|HorizonClient|anchor-worker` — should return zero hits.
3. Run `npm run typecheck` and `npm run test` at the repo root — all workspaces should pass with the anchor-worker workspace removed from `package.json`.
4. Run `cd apps/backend && npm run migration:run` against a fresh dev database — confirm the removal migration and the new reweigh/payout migrations apply cleanly in order.
5. Re-run `scripts/demo-e2e.mjs` (rewritten) end-to-end: signed weigh-in → integrity check → batch → seal → reweigh → payout → audit report — confirm no Stellar/ledger code path is exercised.
6. Manually exercise the dashboard: submit a weigh-in via capture app → print proof page → look it up on the new reweigh screen → record a reweigh (test both a matching and a discrepant weight) → create and mark a payout paid → confirm it appears in the audit report.

---

## Post-implementation note

Implementation (Phases 2-9) is complete and unstaged/uncommitted. One bug was found by Phase 9's verification pass and fixed directly afterward: `EventReweighEntity` declared a `@ManyToOne(() => UserEntity, ...)` relation before `UserEntity` was declared later in `entities.ts` — TypeScript's decorator metadata evaluates that reference eagerly, so it threw `ReferenceError: Cannot access 'UserEntity' before initialization` at runtime (import time, not typecheck time), breaking 9 of 17 backend test suites even though `npm run typecheck` was clean throughout. Fixed by moving the `UserEntity` class declaration earlier in the file, before `EventReweighEntity`. All 17 backend test files (251 tests) now pass, and the full `npm run build` (shared, backend, dashboard, capture) is clean.

**Genuinely unverified**, due to no Docker/Postgres/Redis being available in the environment this was built in — not fabricated as passing:
- The removal + new migrations have not been run against a live Postgres database.
- `scripts/demo-e2e.mjs` was rewritten and syntax-checked but never executed end-to-end.
- `e2e/dashboard.mjs` (Playwright) was updated but never run.
- The manual walkthrough (submit weigh-in → print proof → reweigh → payout → audit report) has not been performed against a running stack.

Before this is considered release-ready: bring up `infra/docker-compose.yml`, run migrations, seed, and actually execute the demo script and a manual walkthrough once.
