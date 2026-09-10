import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, EntityManager, IsNull, LessThanOrEqual } from "typeorm";
import {
  CollectionRequestEntity,
  CreditRateEntity,
  EventReweighEntity,
  WalletTransactionEntity,
  WasteWalletEntity,
  WithdrawalRequestEntity,
} from "../database/entities";

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
   * Redeem a fulfilled request's code into its owner's wallet.
   *
   * Every check happens inside one transaction against freshly-read rows:
   * the code must belong to the AUTHENTICATED requester (never leaking
   * whether it exists for someone else), the request must be exactly
   * `"collected"` (not yet redeemed, not still open), and the credited
   * amount is computed from the reweigh's `verifiedWeightKg` — the
   * hub-verified figure, never the collector's original claimed weight, same
   * "credit what the hub actually confirmed" policy as `PayoutsService`.
   */
  async redeem(requesterId: string, redemptionCode: string): Promise<{ transaction: WalletTransactionEntity; balanceCredits: number }> {
    // Codes are generated uppercase (see requests.service.ts); normalise
    // here so a manually-typed lowercase entry still matches.
    const code = redemptionCode.trim().toUpperCase();

    return this.dataSource.transaction(async (manager) => {
      const request = await manager.findOne(CollectionRequestEntity, { where: { redemptionCode: code } });

      // Same 404 whether the code does not exist at all or exists but belongs
      // to a different requester — a requester must never learn from this
      // response that a code they don't own is real.
      if (!request || request.requesterId !== requesterId) {
        throw new NotFoundException("no request matches this redemption code");
      }

      if (request.status !== "collected") {
        throw new BadRequestException(
          `this code is "${request.status}", not ready for redemption — ` +
            `only a "collected" request can be redeemed`,
        );
      }

      // Structurally guaranteed by RequestsService.fulfill (a request only
      // reaches "collected" once its event has a verified/flagged reweigh),
      // but re-checked here defensively rather than trusted blindly.
      const reweigh = await manager.findOne(EventReweighEntity, { where: { eventId: request.eventId as string } });
      if (!reweigh) {
        throw new BadRequestException("the linked weigh-in has no hub verification on record");
      }

      const wallet = await manager.findOne(WasteWalletEntity, { where: { requesterId } });
      if (!wallet) throw new NotFoundException(`no wallet found for requester ${requesterId}`);

      const now = new Date();
      const rate = await this.resolveRate(manager, request.material, request.hubId, now);
      const amountCredits = Number((Number(reweigh.verifiedWeightKg) * Number(rate.creditsPerKg)).toFixed(3));

      const transaction = await manager.save(
        manager.create(WalletTransactionEntity, {
          walletId: wallet.id,
          type: "credit",
          amountCredits,
          collectionRequestId: request.id,
          eventId: request.eventId,
          description: `Credited for ${request.material} pickup — ${reweigh.verifiedWeightKg} kg verified at ${rate.creditsPerKg}/kg`,
        }),
      );

      await manager.update(CollectionRequestEntity, { id: request.id }, { status: "redeemed", redeemedAt: now });

      const transactions = await manager.find(WalletTransactionEntity, { where: { walletId: wallet.id } });
      const balanceCredits = WalletService.computeBalance(transactions);

      return { transaction, balanceCredits };
    });
  }
}
