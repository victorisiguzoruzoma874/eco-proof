# Plan: Requester request → QR redemption → waste wallet

Status: IMPLEMENTED AND VERIFIED END-TO-END (backend + dashboard, live smoke test passed:
register → request → real signed weigh-in → hub reweigh → fulfill → QR/code issued →
redeem → wallet credited, plus double-redemption correctly rejected). Full repo
typecheck and test suite (355 tests across backend/capture/mobile) pass. Unstaged,
uncommitted. This is additive on top of the existing collector/hub/reweigh/payout
system built earlier — it does not replace it. That system stays the B2B path (informal
collectors self-report, hub re-weighs, collector gets paid). This adds a B2C path: a
household/business "requester" asks for a pickup, and once the hub verifies the collected
weight, the requester redeems a code for waste credits into a wallet.

## Why it reuses the existing trust pipeline

A weigh-in already goes: collector signs on-device (ed25519) → integrity checks →
hub re-weigh (`EventReweighEntity`, ±5% tolerance, built this session). Rather than
building a second, parallel verification path for requester-sourced material, a request
is fulfilled by **linking it to an already-reweighed event** — same signature, same
integrity checks, same hub scale, just credited to a requester's wallet instead of (or
in addition to — a collector still gets their normal payout either way) a cash payout.

## Decisions made without pausing to ask (per the goal's directive)

1. **How a request gets fulfilled**: an operator links an existing, already-verified
   weigh-in to the request (`POST /requests/:id/fulfill { eventId }`), rather than
   changing the signed capture payload schema to carry a `requestId`. Changing what a
   device signs would need a schema version bump (`proofchain.weighin.v2` →  `v3`) and
   touch the capture/mobile apps' signing code — high-risk for this pass. This keeps
   capture/mobile untouched entirely.
2. **Redemption code**: a real QR code this time (explicitly asked for, unlike the
   printable-proof lookup code from earlier, which deliberately avoided a QR dependency).
   Backend generates a short unique alphanumeric code at fulfillment time; the dashboard
   renders it as a QR image client-side via the `qrcode` npm package (new dependency,
   dashboard only).
3. **Requesters are a distinct actor from `UserEntity`**: `UserEntity`'s own doc comment
   says "Operator/auditor login" — admin-provisioned accounts. A requester is a
   self-registering consumer, a different trust boundary. New `RequesterEntity` +
   parallel auth (own JWT, own guard), not a 4th `UserEntity.role`.
4. **Wallet balance is derived, not stored**: matches this codebase's existing
   "recompute from source rows" convention (Merkle root, audit report totals). A wallet
   is an account row; balance = `SUM(wallet_transactions.amountCredits)` for that wallet,
   computed on read. Avoids balance/ledger drift entirely by construction.
5. **Credit rate is a new table**, parallel to `MaterialRateEntity` but a different
   currency for a different beneficiary (consumer credits, not collector cash) —
   `CreditRateEntity`, same resolution rule (most specific hub match, latest
   `effectiveFrom`).
6. **Request state machine**: `requested → assigned (optional) → collected (redemption
   code issued) → redeemed`, plus `cancelled` from `requested`/`assigned`. "Collected"
   is reached only once the linked event has a `verified`/`flagged` `EventReweighEntity`
   — never from a bare unverified weigh-in.

## Data model (new entities, `apps/backend/src/database/entities.ts`)

- `RequesterEntity` (`requesters`): id, name, email (unique), passwordHash, phone
  (nullable), active, createdAt.
- `CollectionRequestEntity` (`collection_requests`): id, requesterId (FK), hubId (FK),
  material (varchar, no FK — same append-only-history reasoning as everywhere else
  material codes appear), estimatedWeightKg (nullable), address (nullable varchar,
  descriptive text only — no lat/lng, consistent with `RemoveLocation.ts`), notes
  (nullable), status, assignedCollectorId (nullable FK → collectors), eventId (nullable
  FK → collection_events, set at fulfillment), redemptionCode (nullable, unique),
  redeemedAt (nullable), createdAt, updatedAt.
- `WasteWalletEntity` (`waste_wallets`): id, requesterId (FK, unique — one wallet per
  requester, created alongside the requester), createdAt. No balance column.
- `WalletTransactionEntity` (`wallet_transactions`): id, walletId (FK), type
  (`"credit"`, room for `"debit"` later), amountCredits, collectionRequestId (nullable
  FK), eventId (nullable FK), description, createdAt.
- `CreditRateEntity` (`credit_rates`): id, materialCode (FK → materials.code), hubId
  (nullable FK → hubs.id), creditsPerKg, effectiveFrom, createdAt.

## Backend modules

- `requesters/` — self-registration + login (`POST /requesters/register`,
  `POST /requesters/login`), own JWT (`RequesterAuthGuard`, separate from the operator
  `JwtAuthGuard`/`Roles`), `GET /requesters/me`.
- `requests/` — `POST /requests` (requester-authenticated: create), `GET /requests/mine`
  (requester: their own), `GET /requests` (operator: all, filterable by status/hub),
  `POST /requests/:id/assign` (operator), `POST /requests/:id/fulfill` (operator; body
  `{ eventId }`; validates the event has a `verified`/`flagged` reweigh and is not
  already linked to another request; generates the redemption code, sets
  `status: "collected"`).
- `wallet/` — `POST /requests/redeem` (requester-authenticated; body
  `{ redemptionCode }`; validates the code, resolves the `CreditRateEntity`, computes
  `amountCredits = verifiedWeightKg × creditsPerKg`, writes a `WalletTransactionEntity`,
  sets the request `status: "redeemed"`, `redeemedAt`); `GET /wallet` (requester: balance
  + transaction history, balance computed via `SUM`).
- `credit-rates/` — `POST`/`GET /credit-rates` (operator/admin), mirrors
  `material-rates/` exactly.

## Dashboard (new section, `apps/dashboard/src/app/requester/...`)

Separate auth cookie (`proofchain_requester_token`) from the operator one
(`proofchain_token`) — different actor, different login, must not be confused.

- `/requester/signup`, `/requester/login` — public.
- `/requester/dashboard` — requester home: their open requests + "Request a pickup" form.
- `/requester/wallet` — balance + transaction history + "Redeem a code" form (manual
  entry; a camera-based scanner is a fast-follow, not in this pass — entering the code
  printed under the QR works today without adding camera-permission complexity).
- Operator side, inside the existing operator area: `/requests` — list/filter requests,
  assign, and fulfill (pick an eligible reweighed event) with a QR code rendered for the
  requester once fulfilled (operators can show/print this for a requester who isn't
  present, but the requester's own `/requester/dashboard` shows it too once they're
  logged in).

## Addendum: credit value and spending (added after initial build)

**Decision (user-specified, not assumed): 1 credit = ₦1, directly cashable, PLUS a
redemption catalog** — both paths exist, not one or the other. This is a real financial
commitment (every credit issued must eventually be payable), so the seeded
`creditsPerKg` default is a placeholder rate representing actual Naira, priced below the
collector's ₦50/kg cash-payout rate (the requester didn't do the collection labor, so the
existing precedent from the collector-payout side — "reward the person who did the
work more" — still applies): **₦15/kg**, clearly commented as a placeholder for the
operator to change via `POST /credit-rates`, same as the ₦50/kg collector rate always
has been.

**Withdrawal (cash-out)** — mirrors `payouts.service.ts`'s pending → paid pattern
exactly, on purpose: a debit is only ever recorded once money has actually moved, never
at the moment of request (recording it at request-time risks a wallet showing a debit
for cash the requester never actually received, if the manual payout falls through).
- `WithdrawalRequestEntity` (`withdrawal_requests`): id, requesterId (FK), amountCredits,
  status (`"pending"|"paid"|"rejected"`), payoutRef (nullable), paidByUserId (nullable
  FK -> users), paidAt (nullable), createdAt.
- `POST /wallet/withdraw` (requester) `{ amountCredits }` — validates the computed
  balance covers it, creates a `"pending"` withdrawal. Balance calculation must count
  pending withdrawals as already-spoken-for (an unpaid pending withdrawal reduces
  "available to withdraw again", or a requester could request the same balance twice).
- `POST /wallet/withdrawals/:id/mark-paid` (operator) `{ payoutRef? }` — writes the debit
  `WalletTransactionEntity` at this moment (not before), sets `status:"paid"`.
- `POST /wallet/withdrawals/:id/reject` (operator) — releases the held amount without
  debiting anything.
- `GET /wallet/withdrawals` (operator, `?status=`) and the requester sees their own via
  `GET /wallet` (add pending withdrawals to that response so a requester can see money
  "on hold").

**Redemption catalog** — instant debit on redemption (unlike withdrawal): the requester
is exchanging credits for a listed item, not asking the platform to move real money on
their behalf, so there's no reason to delay the ledger entry — a physical/airtime
fulfillment step still exists but doesn't gate the debit.
- `CatalogItemEntity` (`catalog_items`): id, name, description (nullable), category
  (varchar, e.g. `"airtime"|"goods"|"discount"`), costCredits, stock (nullable int, null
  = unlimited), active, createdAt.
- `CatalogRedemptionEntity` (`catalog_redemptions`): id, requesterId (FK), itemId (FK),
  costCredits (copied at redemption time — an item's price changing later must not
  rewrite history), status (`"pending_fulfillment"|"fulfilled"`), fulfilledByUserId
  (nullable FK -> users), fulfilledAt (nullable), createdAt.
- `POST /catalog-items`, `GET /catalog-items` (admin manages; public/requester-readable
  list of active items — mirrors `materials`'s active/retired split).
- `POST /wallet/redeem-catalog-item` (requester) `{ itemId }` — validates balance and
  stock, decrements stock if tracked, writes the debit `WalletTransactionEntity`
  immediately, creates a `"pending_fulfillment"` `CatalogRedemptionEntity`.
- `POST /catalog-redemptions/:id/fulfill` (operator) — the operational queue: "send this
  airtime / hand over this item", marks `"fulfilled"`.
- `GET /catalog-redemptions` (operator, `?status=`) — the fulfillment queue.

**UI**: `/requester/wallet` shows the balance explicitly as "X credits (₦X)" given the
1:1 peg, adds withdrawal and catalog-redemption forms; a new operator page
`/wallet-admin` (or split across `/withdrawals` + `/catalog`) handles mark-paid/reject
and the fulfillment queue; `/catalog-items` (admin) manages the catalog, mirroring
`/material-rates`.

## Verification

Same bar as the earlier work this session: typecheck + full test suite + build across
every touched workspace before considering a phase done. No git commit without being
asked.
