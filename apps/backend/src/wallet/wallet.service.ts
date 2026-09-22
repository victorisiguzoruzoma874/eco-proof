import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, EntityManager, IsNull, LessThanOrEqual } from "typeorm";
import {
  CollectionEventEntity,
  CollectionRequestEntity,
  CreditRateEntity,
  EventReweighEntity,
  WalletTransactionEntity,
  WasteWalletEntity,
  WeighInClaimEntity,
  WithdrawalRequestEntity,
} from "../database/entities";
import { CLAIM_CODE_PATTERN, hashClaimCode, normaliseClaimCode } from "./claim-code";

/**
 * One answer for "wrong code" and "someone else's pickup code", so the response
 * never confirms that a code belonging to another requester exists.
 */
const NO_MATCHING_CODE = "no pickup or weigh-in matches this code";

export interface WalletView {
  walletId: string;
  balanceCredits: number;
  transactions: WalletTransactionEntity[];
  /** The requester's own not-yet-paid withdrawals — money "on hold". */
  pendingWithdrawals: WithdrawalRequestEntity[];
}

/**
 * Redemption + balance. `WasteWalletEntity` deliberately carries no balance
 * column (see its doc comment) — balance is always
 * `SUM(amountCredits WHERE type='credit') - SUM(amountCredits WHERE
 * type='debit')`, computed on read.
 *
 * `getWallet` computes that sum in JS over the already-fetched transaction
 * list rather than issuing a separate SQL aggregate query: the endpoint
 * returns the full transaction history anyway, so summing the same rows it
 * already loaded is strictly less work than a second round trip, not a
 * shortcut. `redeem` reuses the identical helper for the same reason, over
 * the freshly-committed row set.
 */
@Injectable()
export class WalletService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  private static computeBalance(transactions: Pick<WalletTransactionEntity, "type" | "amountCredits">[]): number {
    const total = transactions.reduce((sum, t) => {
      const amount = Number(t.amountCredits);
      return t.type === "credit" ? sum + amount : sum - amount;
    }, 0);
    return Number(total.toFixed(3));
  }

  /**
   * Resolve the applicable credits-per-kg rate for a material at a hub —
   * structurally identical to `PayoutsService.resolveRate`, just
   * `CreditRateEntity`/`creditsPerKg` instead of
   * `MaterialRateEntity`/`ratePerKg`: most specific `hubId` match wins over
   * the `hubId: null` default, and within whichever tier applies, the latest
   * `effectiveFrom` at or before now wins.
   */
  private async resolveRate(
    manager: EntityManager,
    materialCode: string,
    hubId: string,
    now: Date,
  ): Promise<CreditRateEntity> {
    const [hubSpecific] = await manager.find(CreditRateEntity, {
      where: { materialCode, hubId, effectiveFrom: LessThanOrEqual(now) },
      order: { effectiveFrom: "DESC" },
      take: 1,
    });
    if (hubSpecific) return hubSpecific;

    const [globalDefault] = await manager.find(CreditRateEntity, {
      where: { materialCode, hubId: IsNull(), effectiveFrom: LessThanOrEqual(now) },
      order: { effectiveFrom: "DESC" },
      take: 1,
    });
    if (globalDefault) return globalDefault;

    throw new BadRequestException(
      `no credit rate configured for "${materialCode}" (checked hub ${hubId} and the global default) — ` +
        `set one via POST /credit-rates`,
    );
  }

  /**
   * Reusable balance lookup for other services — `WithdrawalsService` and
   * `CatalogService` both need "how much can this requester spend right now"
   * without needing the full transaction history `getWallet` returns below.
   * Takes a manager (rather than owning its own transaction) so a caller
   * running inside its own `dataSource.transaction(...)` reads a consistent
   * view of the same rows it is about to act on; pass `this.dataSource.manager`
   * for a plain read outside any transaction.
   */
  async getBalance(
    manager: EntityManager,
    requesterId: string,
  ): Promise<{ wallet: WasteWalletEntity; balanceCredits: number }> {
    const wallet = await manager.findOne(WasteWalletEntity, { where: { requesterId } });
    if (!wallet) throw new NotFoundException(`no wallet found for requester ${requesterId}`);

    const transactions = await manager.find(WalletTransactionEntity, { where: { walletId: wallet.id } });
    return { wallet, balanceCredits: WalletService.computeBalance(transactions) };
  }

  async getWallet(requesterId: string): Promise<WalletView> {
    const wallet = await this.dataSource.manager.findOne(WasteWalletEntity, { where: { requesterId } });
    if (!wallet) throw new NotFoundException(`no wallet found for requester ${requesterId}`);

    const transactions = await this.dataSource.manager.find(WalletTransactionEntity, {
      where: { walletId: wallet.id },
      order: { createdAt: "DESC" },
    });

    const pendingWithdrawals = await this.dataSource.manager.find(WithdrawalRequestEntity, {
      where: { requesterId, status: "pending" },
      order: { createdAt: "DESC" },
    });

    return {
      walletId: wallet.id,
      balanceCredits: WalletService.computeBalance(transactions),
      transactions,
      pendingWithdrawals,
    };
  }

  /**
   * Settle a credit paid before the hub weighed the material.
   *
   * This is what keeps both at-the-scale QRs honest. A doorstep collection and
   * a walk-in weigh-in both credit the collector's scale reading so the person
   * is paid on the spot; when the material reaches the hub and is weighed
   * independently, any difference becomes an adjusting ledger entry: a
   * `credit` if the hub found more than the collector recorded, a `debit` if it
   * found less.
   *
   * Called by `ReweighService` after a re-weigh is recorded. Silent no-op in
   * every case where there is nothing to settle, because a re-weigh on a B2B
   * event has neither a request nor a claimed ticket behind it, and that is the
   * common path.
   *
   * Never throws for a missing request, claim or wallet: a re-weigh is a fact
   * about material that must be recorded whether or not a wallet somewhere
   * needs adjusting, and failing the re-weigh because a reconciliation could
   * not complete would be the tail wagging the dog.
   */
  async reconcile(eventId: string, verifiedWeightKg: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const now = new Date();

      const request = await manager.findOne(CollectionRequestEntity, { where: { eventId } });
      if (request) {
        // Not redeemed yet: `redeem` will read the reweigh directly and credit
        // the verified figure first time, with nothing to adjust. Already
        // settled: the guard that stops a second re-weigh applying the same
        // correction twice.
        if (request.status !== "redeemed") return;
        if (request.reconciledAt || request.creditedWeightKg === null) return;

        await this.settleDifference(manager, {
          requesterId: request.requesterId,
          material: request.material,
          hubId: request.hubId,
          creditedWeightKg: Number(request.creditedWeightKg),
          verifiedWeightKg,
          eventId,
          collectionRequestId: request.id,
          subject: `${request.material} pickup`,
          now,
        });
        await manager.update(CollectionRequestEntity, { id: request.id }, { reconciledAt: now });
        return;
      }

      // A walk-in: settled the same way, against its claim ticket. Unclaimed
      // tickets need nothing: whoever claims later is credited the verified
      // figure directly.
      const claim = await manager.findOne(WeighInClaimEntity, { where: { eventId } });
      if (!claim?.claimedAt || !claim.requesterId) return;
      if (claim.reconciledAt || claim.creditedWeightKg === null) return;

      const event = await manager.findOne(CollectionEventEntity, { where: { id: eventId } });
      if (!event) return;

      await this.settleDifference(manager, {
        requesterId: claim.requesterId,
        material: event.material,
        hubId: event.hubId,
        creditedWeightKg: Number(claim.creditedWeightKg),
        verifiedWeightKg,
        eventId,
        collectionRequestId: null,
        subject: `${event.material} drop-off`,
        now,
      });
      await manager.update(WeighInClaimEntity, { id: claim.id }, { reconciledAt: now });
    });
  }

  /**
   * Write the adjusting entry for one early credit, if one is owed. The caller
   * stamps the credit as settled whatever happens here.
   */
  private async settleDifference(
    manager: EntityManager,
    s: {
      requesterId: string;
      material: string;
      hubId: string;
      creditedWeightKg: number;
      verifiedWeightKg: number;
      eventId: string;
      collectionRequestId: string | null;
      subject: string;
      now: Date;
    },
  ): Promise<void> {
    const deltaKg = Number((s.verifiedWeightKg - s.creditedWeightKg).toFixed(3));

    // The scales agreed. Settle without writing a zero-value row that would
    // only clutter the ledger.
    if (deltaKg === 0) return;

    const wallet = await manager.findOne(WasteWalletEntity, { where: { requesterId: s.requesterId } });
    if (!wallet) return;

    // The rate in effect NOW, not at redemption. A correction is a fresh
    // movement of value, and pricing it at a rate that has since been
    // superseded would mean the ledger could not be rebuilt from the rate
    // table as it stands.
    const rate = await this.resolveRate(manager, s.material, s.hubId, s.now);
    const amountCredits = Number((Math.abs(deltaKg) * Number(rate.creditsPerKg)).toFixed(3));

    // A rate low enough that the difference rounds away.
    if (amountCredits === 0) return;

    await manager.save(
      manager.create(WalletTransactionEntity, {
        walletId: wallet.id,
        type: deltaKg > 0 ? "credit" : "debit",
        amountCredits,
        collectionRequestId: s.collectionRequestId,
        eventId: s.eventId,
        description:
          `Hub re-weigh adjustment for ${s.subject} — ` +
          `${s.verifiedWeightKg} kg verified against ${s.creditedWeightKg} kg at collection ` +
          `(${deltaKg > 0 ? "+" : ""}${deltaKg} kg at ${rate.creditsPerKg}/kg)`,
      }),
    );
  }

  /**
   * Redeem a code into the signed-in requester's wallet.
   *
   * One field, two kinds of code, told apart by what they match:
   *
   *  - a pickup's 8-character redemption code, issued at the door or at hub
   *    fulfilment for a request this requester booked (`redeemRequest`);
   *  - a walk-in weigh-in's 10-character claim code, shown as a QR on the
   *    collector's phone, which whoever scans first is credited for
   *    (`claimWalkIn`).
   *
   * Every check happens inside one transaction against freshly-read rows.
   */
  async redeem(
    requesterId: string,
    redemptionCode: string,
  ): Promise<{ transaction: WalletTransactionEntity; balanceCredits: number }> {
    // Codes are generated uppercase; normalise so a typed entry still matches,
    // including the dash the capture screen prints in the middle of a claim code.
    const code = normaliseClaimCode(redemptionCode);

    return this.dataSource.transaction(async (manager) => {
      const request = await manager.findOne(CollectionRequestEntity, { where: { redemptionCode: code } });
      return request
        ? this.redeemRequest(manager, requesterId, request)
        : this.claimWalkIn(manager, requesterId, code);
    });
  }

  /**
   * A pickup's code. It must belong to the AUTHENTICATED requester (never
   * leaking whether it exists for someone else), and the request must be
   * exactly `"collected"` (not yet redeemed, not still open).
   */
  private async redeemRequest(
    manager: EntityManager,
    requesterId: string,
    request: CollectionRequestEntity,
  ): Promise<{ transaction: WalletTransactionEntity; balanceCredits: number }> {
    // Same 404 as a code that does not exist at all — a requester must never
    // learn from this response that a code they don't own is real.
    if (request.requesterId !== requesterId) {
      throw new NotFoundException(NO_MATCHING_CODE);
    }

    if (request.status !== "collected") {
      throw new BadRequestException(
        `this code is "${request.status}", not ready for redemption — ` +
          `only a "collected" request can be redeemed`,
      );
    }

    // Which weight to credit depends on how the request was collected.
    //
    // A request fulfilled through the hub (`RequestsService.fulfill`) always
    // has a reweigh, and that independently-confirmed figure is what gets
    // credited. A doorstep collection (`RequestsService.collect`) issues its
    // code at the gate, so no reweigh exists yet and the collector's signed
    // weight stands in. `creditedWeightKg` records which figure was used, and
    // `reconcile` settles it once the hub weighs in.
    const reweigh = await manager.findOne(EventReweighEntity, { where: { eventId: request.eventId as string } });

    const event = await manager.findOne(CollectionEventEntity, { where: { id: request.eventId as string } });
    if (!event) {
      throw new BadRequestException("the linked weigh-in no longer exists");
    }

    const creditedWeightKg = reweigh ? Number(reweigh.verifiedWeightKg) : Number(event.weightKg);
    const basis = reweigh ? "verified at the hub" : "weighed at collection";

    const wallet = await manager.findOne(WasteWalletEntity, { where: { requesterId } });
    if (!wallet) throw new NotFoundException(`no wallet found for requester ${requesterId}`);

    const now = new Date();
    const rate = await this.resolveRate(manager, request.material, request.hubId, now);
    const amountCredits = Number((creditedWeightKg * Number(rate.creditsPerKg)).toFixed(3));

    const transaction = await manager.save(
      manager.create(WalletTransactionEntity, {
        walletId: wallet.id,
        type: "credit",
        amountCredits,
        collectionRequestId: request.id,
        eventId: request.eventId,
        description: `Credited for ${request.material} pickup — ${creditedWeightKg} kg ${basis} at ${rate.creditsPerKg}/kg`,
      }),
    );

    await manager.update(
      CollectionRequestEntity,
      { id: request.id },
      {
        status: "redeemed",
        redeemedAt: now,
        creditedWeightKg,
        // A credit already computed from the hub's own figure has nothing
        // left to reconcile, so it is closed out immediately rather than
        // left looking like outstanding work.
        reconciledAt: reweigh ? now : null,
      },
    );

    const transactions = await manager.find(WalletTransactionEntity, { where: { walletId: wallet.id } });
    return { transaction, balanceCredits: WalletService.computeBalance(transactions) };
  }

  /**
   * A walk-in weigh-in's claim code: first scan wins.
   *
   * Unlike a pickup code this is not tied to an account in advance (the
   * person at the scale has no booking), so it is a bearer token, and the
   * checks are about the weigh-in rather than the owner: it must exist, must
   * not be claimed, must have passed verification, and must not also be
   * payable through a pickup.
   */
  private async claimWalkIn(
    manager: EntityManager,
    requesterId: string,
    code: string,
  ): Promise<{ transaction: WalletTransactionEntity; balanceCredits: number }> {
    const wellFormed = CLAIM_CODE_PATTERN.test(code);
    const claim = wellFormed
      ? await manager.findOne(WeighInClaimEntity, { where: { claimCodeHash: hashClaimCode(code) } })
      : null;

    if (!claim) {
      // The phone mints the code offline and sends it when it next syncs, so a
      // code scanned seconds after the weigh-in can arrive before its ticket.
      // Say so rather than implying the code is wrong. The format alone gives
      // nothing away: every well-formed claim code looks like this.
      throw new NotFoundException(
        wellFormed
          ? "no weigh-in matches this code yet — if it was weighed just now, the collector's phone " +
              "may still be sending it; try again in a minute"
          : NO_MATCHING_CODE,
      );
    }

    if (claim.claimedAt) {
      throw new BadRequestException(
        claim.requesterId === requesterId
          ? "you have already claimed this weigh-in"
          : "this weigh-in has already been claimed",
      );
    }

    const event = await manager.findOne(CollectionEventEntity, { where: { id: claim.eventId } });
    if (!event) throw new BadRequestException("the weigh-in behind this code no longer exists");

    // Quarantined means it failed an integrity check at ingest (signature,
    // weight bounds, clock). Paying out on evidence the system itself rejected
    // would defeat the point of checking it.
    if (event.quarantined) {
      throw new BadRequestException(
        "this weigh-in did not pass verification, so it cannot be credited — ask the collector to check it",
      );
    }

    // One weigh-in, one credit. An operator can link a hub weigh-in to a
    // booked pickup (`RequestsService.fulfill`), and that pickup's own code is
    // then the way it gets paid.
    const linked = await manager.findOne(CollectionRequestEntity, {
      where: { eventId: event.id },
      select: { id: true },
    });
    if (linked) {
      throw new BadRequestException(
        "this weigh-in belongs to a booked pickup and is credited through that pickup's code",
      );
    }

    const reweigh = await manager.findOne(EventReweighEntity, { where: { eventId: event.id } });
    const creditedWeightKg = reweigh ? Number(reweigh.verifiedWeightKg) : Number(event.weightKg);
    const basis = reweigh ? "verified at the hub" : "weighed at collection";

    const wallet = await manager.findOne(WasteWalletEntity, { where: { requesterId } });
    if (!wallet) throw new NotFoundException(`no wallet found for requester ${requesterId}`);

    const now = new Date();
    const rate = await this.resolveRate(manager, event.material, event.hubId, now);
    const amountCredits = Number((creditedWeightKg * Number(rate.creditsPerKg)).toFixed(3));

    // Conditional on still being unclaimed, so two phones scanning the same QR
    // at once cannot both pass the check above and both be credited: the
    // second update waits on the first's row lock, re-reads, and matches
    // nothing.
    const won = await manager.update(
      WeighInClaimEntity,
      { id: claim.id, claimedAt: IsNull() },
      {
        claimedAt: now,
        requesterId,
        creditedWeightKg,
        reconciledAt: reweigh ? now : null,
      },
    );
    if (!won.affected) throw new BadRequestException("this weigh-in has already been claimed");

    const transaction = await manager.save(
      manager.create(WalletTransactionEntity, {
        walletId: wallet.id,
        type: "credit",
        amountCredits,
        collectionRequestId: null,
        eventId: event.id,
        description: `Credited for ${event.material} drop-off — ${creditedWeightKg} kg ${basis} at ${rate.creditsPerKg}/kg`,
      }),
    );

    const transactions = await manager.find(WalletTransactionEntity, { where: { walletId: wallet.id } });
    return { transaction, balanceCredits: WalletService.computeBalance(transactions) };
  }
}
