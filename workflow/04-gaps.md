# 4. Gaps Between the Intended Workflow and the Build

**Status: gaps 1–5 are closed.** This document now records what was built and
the trust decision behind it. Gap 6 remains open by choice.

The original finding was that the doorstep workflow — *collector sees the
request, drives to the address, weighs the waste, shows a QR the user scans,
user is credited* — was about 80% built, with the connective tissue missing
inside the capture app. That tissue now exists.

---

## The decision that shaped the rest

The described workflow credits the user for "the waste weighed by the
collector." Taken literally that removes the hub re-weigh from the consumer
path, which is the platform's core verification guarantee.

**What was built is the middle option: issue the code at the door off the
collector's scale, then reconcile against the hub's later re-weigh.**

A doorstep pickup credits the collector's signed weight immediately, so the
requester is paid while the van is still outside. When the material reaches the
hub and is independently weighed, `WalletService.reconcile` writes an adjusting
ledger entry for the difference — a credit if the hub found more, a debit if it
found less. The hub re-weigh still happens and still means something; it is no
longer a *gate* on the consumer path, it is a *correction*.

Two things bound the trust reduction:

- A quarantined weigh-in can never issue a code. All six integrity checks still
  run at the door, so device enrolment, signature validity, weight range,
  duplicate detection, clock plausibility and photo hash all still gate payment.
- The figure used is recorded on the request (`creditedWeightKg`), so the later
  comparison is exact rather than reconstructed.

**What this costs:** between collection and hub re-weigh, a collector could
inflate a weight and the requester would be credited for it. The correction
lands afterwards, and it can land as a *debit* on a requester who has already
spent the credits — the balance can go negative. That is the trade, stated
plainly. If it turns out to be the wrong one, the alternative is to keep the
door QR but show "pending verification" until the hub confirms.

---

## Gap 1 — Capture cannot see requests — closed

**The blocker was auth, not the endpoint.** Capture holds no bearer token by
design — the ed25519 device signature is the credential, which is why it works
offline and why a stolen phone leaks nothing.

**Built: device-signed requests.** The request line itself is the message. The
device signs a canonical string over method, path, device id, timestamp, nonce
and a hash of the body; the server rebuilds it and verifies against the enrolled
public key.

| Piece | Where |
| --- | --- |
| Canonical encoder (Node-free, shared by phone and server) | [device-auth.ts](../packages/shared/src/device-auth.ts) |
| Server-side verification | `verifyDeviceRequestSignature` in [signing.ts](../packages/shared/src/signing.ts) |
| Request guard | [device-auth.guard.ts](../apps/backend/src/common/device-auth.guard.ts) |
| Phone-side signing | [jobs.ts](../apps/capture/src/lib/jobs.ts) |
| Endpoint | `GET /requests/assigned` |

The scheme's properties are pinned by tests: a signature cannot be moved to
another path, another device id, or another request body, and a foreign key
cannot produce one. The `bodyHash` line exists specifically so a captured
`collect` signature cannot be replayed against a different weight.

The guard returns one identical message for every failure — unknown device,
revoked device, inactive collector, bad signature — so the endpoint cannot be
used as an enrolment oracle.

**Still standing:** no standing credential was added to the phone.

---

## Gap 2 — Event/request link was manual — closed

**Built:** `POST /requests/:id/collect` — device-signed, ingests the weigh-in
through the *existing* `EventsService.ingest` pipeline and issues the redemption
code in one round trip. No second copy of the integrity checks.

Three checks the operator used to perform implicitly are now enforced:

- An assigned job can only be collected by the collector it was assigned to.
- The signed payload's `deviceId` and `collectorId` must match the
  authenticated device — otherwise a phone could sign a weigh-in naming someone
  else and have it accepted.
- The weigh-in's material must match the request's.

`RequestsService.fulfill` (the hub-verified path) is unchanged and still works
for B2B. Both paths now share one `issueCode` helper, so they cannot drift on
how a code is minted or how a collision is handled.

---

## Gap 3 — QR not shown in capture — closed

The collector's screen now renders the QR the moment a collection lands, at
320px with error-correction level M and a generous quiet zone — it is scanned
off one phone by another, often in sunlight. The 8-character code sits beneath
it at full size, because a cracked screen or a dead requester phone all end with
someone typing it.

The QR still also appears on the requester's own dashboard and the operator's
print page. Nothing was removed.

---

## Gap 4 — No camera scanner — closed

[ScanButton.tsx](../apps/dashboard/src/app/requester/wallet/ScanButton.tsx) on
`/requester/wallet`, built on the native `BarcodeDetector`. Where that API is
missing (Safari, Firefox) the component renders **nothing** and the typed-code
path is what the requester uses — which is exactly how it worked before. The
scanner fills the existing input and leaves submission to the form's Server
Action, so there is only ever one redemption path to keep correct.

---

## Gap 5 — Collector weight vs credited weight — resolved by decision

See the top of this document. Implemented as:

- `redeem` credits the re-weigh when one exists, the collector's signed event
  weight when one does not, and records which in `creditedWeightKg`.
- `reconcile` runs after every re-weigh, writes the adjusting entry, and stamps
  `reconciledAt` — which is also the idempotency guard, so a second re-weigh or
  a re-run cannot apply the same correction twice.
- Reconciliation happens *after* the re-weigh is saved and outside its
  transaction. A re-weigh is a fact about material and must stand on its own; a
  wallet problem is never allowed to undo it.

The adjustment is priced at the rate in effect **now**, not at redemption — a
correction is a fresh movement of value, and pricing it at a superseded rate
would mean the ledger could not be rebuilt from the rate table as it stands.

---

## Gap 6 — No requester-side cancel — still open, by choice

`RequestsService.cancel` remains operator-only. Narrowing it keeps the
endpoint's trust boundary identical to `assign`/`fulfill` rather than
introducing a second authorization path, and the requester dashboard has no
cancel affordance, so nothing depends on it.

---

## What also changed

**Geolocation.** `collection_requests` gained nullable `latitude`/`longitude`
(`numeric(9,6)` — six decimals is ~11 cm, finer than any phone fix). The
requester shares a pin behind an explicit button on the request form, never on
mount: a permission prompt that appears before the person has said what they
want reads as a demand. Refusing costs nothing — the typed address is how every
pickup worked before.

Capture renders a map link per job, preferring the pin and falling back to the
address as a search query.

**Dispatch notifications.** The capture PWA polls `/requests/assigned` every 45
seconds and raises a system notification through its existing service worker,
falling back to an in-app banner. Polling, not push: push needs VAPID keys and a
subscription lifecycle on both ends, and 45 seconds is well inside the time it
takes to drive anywhere. Every failure degrades to a stale to-do list and never
breaks capture, which must keep working offline regardless.

**Offline behaviour.** A doorstep collection requires a signal — the code is
minted by the server because it must be unique across every request, and the
requester is standing there waiting for it. With no signal, the collector clears
the job and captures an ordinary offline weigh-in; an operator links it later
via `fulfill`. On a failed collection the photo and weight are deliberately
preserved so the collector can retry without re-photographing a sack that is
already in the van.

---

## Deploying this

The migration `1788100000000-DoorstepCollection` is additive — every column is
nullable and no existing table is rewritten — but it must be run before the new
backend serves traffic:

```bash
npm run migrate
```

No environment variables were added.
